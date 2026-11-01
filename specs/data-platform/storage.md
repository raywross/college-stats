# Part 1, Storage: layers as versioned documents, change sets, edits, snapshots

> Part of [the data platform](README.md). Migrations `supabase/migrations/20261031120000_data_platform.sql` (tables,
> policies, functions) and `20261031130000_data_platform_admin.sql` (the console's functions). Tested in the PGlite
> harness like every other migration (`tests/data-platform-policies.test.mts`).

## Why documents, not typed tables
The college dataset is read whole and sliced in memory ([database-architecture.md](../database-architecture.md)
"Why documents are right for the published data"); nothing queries it by column in SQL, and its shape is 399
registered paths deep. Each pipeline's output is already a JSON document per college or per organization. So the
store is a **document store with versions**, one table for every layer, with a `collection` column naming the layer
and a `key` naming the document (a unit id, an organization, a run id, a file name). Typed columns exist only for
what the console filters on: change sets, holds, edits.

## Tables

### `data_documents`: the current version of every document
Bodies are Postgres `json`, not `jsonb` (as built): `jsonb` reorders object keys, and a document read back must render
the same bytes it was written from. `data_write_documents` takes each body as a JSON string and stores it as written;
"unchanged" is judged with a `jsonb` cast, so a key-order-only rewrite writes no version.
```sql
create table public.data_documents (
  collection    text not null check (collection ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  key           text not null check (length(key) between 1 and 200),
  version       integer not null check (version >= 1),
  body          json not null,
  change_set_id bigint not null references public.data_change_sets(id),
  updated_at    timestamptz not null default now(),
  primary key (collection, key)
);
create index data_documents_change_set on public.data_documents (change_set_id);
```
A document that is deleted is removed from this table and its last version in `data_document_versions` carries
`deleted = true`, so "the document as of change set N" is always answerable.

### `data_document_versions`: every version, append-only
```sql
create table public.data_document_versions (
  id            bigint generated always as identity primary key,
  collection    text not null,
  key           text not null,
  version       integer not null,
  body          json,                       -- null when deleted
  deleted       boolean not null default false,
  change_set_id bigint not null references public.data_change_sets(id),
  created_at    timestamptz not null default now(),
  unique (collection, key, version)
);
create index data_document_versions_doc on public.data_document_versions (collection, key, version desc);
```
No update or delete policy exists for anyone; the only writer is `data_write_documents()` below. History per table is
this table filtered by collection; history per college is this table filtered by key.

### `data_change_sets`: one per run, import, edit batch or revert
```sql
create table public.data_change_sets (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('pipeline','import','edit','revert','publish-fix')),
  source       text not null,                 -- 'college-reported', 'essay-prompts', 'identity', 'sync-data', 'console', …
  run_ref      text,                          -- the workflow run id or the script's run stamp
  status       text not null default 'applied' check (status in ('open','applied','held','reverted')),
  held_reason  text,                          -- the breaker's sentence, or the hold's
  summary      jsonb not null default '{}',   -- {documents: n, added, changed, removed, collections: [...], cost_usd, …}
  created_by   uuid references auth.users(id) on delete set null,   -- null for pipelines
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  snapshot_id  bigint references public.data_snapshots(id),         -- the first snapshot that carried it
  reverted_by  bigint references public.data_change_sets(id)        -- the revert change set, when reverted
);
create index data_change_sets_status on public.data_change_sets (status, created_at desc);
```
- `open`: the run is writing (a pipeline writes after every college, like today's state files, so a cancelled run
  keeps its progress). `applied`: closed and eligible for the next snapshot. `held`: closed but the breaker tripped or
  a person held it; the automatic publish skips it and every later change set until a person publishes or reverts it
  (holding blocks the line, because later layers may depend on it). `reverted`: a `revert` change set restored every
  document this one touched to its prior version.
- A pipeline's holds for a person (today's review-queue items) are documents in the `reported.review_queue` collection
  written by the same change set; the console reads them from there ([change-sets.md](change-sets.md)).

### `data_field_edits`: admin edits, the last layer
```sql
create table public.data_field_edits (
  id            bigint generated always as identity primary key,
  unit_id       text not null check (unit_id ~ '^[0-9]{1,12}$'),
  path          text not null,                -- a registered FieldPath (lib/fields.ts); checked by the function
  value         jsonb,                        -- null clears the value (the pipeline's value shows again only when released)
  note          text,                         -- optional, shown in the popover: "Per the registrar's email, 2026-10-30"
  created_by    uuid not null references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  released_at   timestamptz,                  -- set when the admin lets the pipelines' value take over again
  released_by   uuid references auth.users(id) on delete set null,
  change_set_id bigint not null references public.data_change_sets(id)
);
create index data_field_edits_live on public.data_field_edits (unit_id, path) where released_at is null;
```
The live edit for a path is the newest unreleased row; older rows are its history. Reverting an edit is releasing it
(or releasing it and re-saving the previous row's value). Edits apply at publish after every layer and overlay the
snapshot live in the app ([change-sets.md](change-sets.md) "Admin edits"), so an edit shows on the next page load.

### `data_snapshots`: what was published
```sql
create table public.data_snapshots (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  status         text not null default 'building' check (status in ('building','published','failed','withdrawn')),
  manifest       jsonb not null default '{}',   -- {colleges: n, objects: n, bytes, sha256 per object, layers: {collection: max version}}
  change_set_ids bigint[] not null default '{}',
  previous_id    bigint references public.data_snapshots(id),
  pointer_at     timestamptz,                  -- when the pointer last moved to this snapshot (also set on a point-back)
  notes          text
);
```
The pointer object in Storage (`snapshots/current.json`) names the live snapshot; this table is its history. "Point
back here" moves the pointer to an older snapshot and records it (`pointer_at`, `admin_log`), without rebuilding.

### What stays as it is
`dataset_publishes`/`dataset_changes` (the change log), `selectivity_publishes`/history, `high_schools*`,
`college_data_failures`, `visit_events`, `app_settings`, `essay_prompt_overrides`. The publisher writes the first two
groups from snapshots instead of git diffs ([publish.md](publish.md)); `essay_prompt_overrides` is read by the
publisher as part of the essays layer and keeps its console.

## Collections (the layers)
| Collection | Key | Document | Written by |
|---|---|---|---|
| `base.colleges` | unit id | `toSchool()` + the IPEDS stages' output for one college, before any later layer (what `sync-data` has at stage 7) | sync-data |
| `base.detail` | unit id | The detail tables the base stage builds (majors, programs, residence, transfers, field of study) | sync-data |
| `base.meta` | `meta` | `DatasetMeta` as `buildMeta` + the `add*Meta` calls produce it | sync-data |
| `base.release_calendar` | `calendar` | `ReleaseCalendar` | sync-data (`updateReleaseCalendar`), the console (hand) |
| `base.aliases` | `aliases` | The alias rows the base produces (Common App adds its own at publish) | sync-data |
| `identity.wikidata`, `identity.probe`, `identity.link_issues`, `identity.brand_colors`, `identity.brand_logos` | unit id | One college's slice of today's five files | identity-refresh |
| `identity.brand_overrides` | unit id | The hand-kept overrides | console |
| `reported.entries` | unit id | `ReportedEntry` | college-reported |
| `reported.cds_records` | unit id | The college's CDS record (`data/cds-records/<unit>.json`) | college-reported |
| `reported.sources` | unit id | `Recipe` | college-reported |
| `reported.docs` | sha256 | A document's manifest entry | college-reported |
| `reported.batches` | batch id | An open Message Batch | college-reported |
| `reported.review_queue` | `unit|edition|code` | `ReviewItem` | college-reported, `hold-misread`, the console (resolve) |
| `reported.failures` | unit id | A college's failure rows | college-reported (derived, rebuilt per run) |
| `reported.reports` | run id | `RunSummary` | college-reported |
| `directories.listings` | organization | Today's `data/directories/<org>.json` | sync-directories |
| `directories.unmatched`, `directories.blocked` | organization / `blocked` | | sync-directories |
| `campus.pages` | unit id | The campus-pilot facts for one college | campus-pilot |
| `common_app.grid` | `<cycle>_<updated>` | `GridEdition` (the PDF stays in the archive) | sync-common-app |
| `common_app.members` | `members` | `MembersFile` | sync-common-app |
| `coalition.members` | `members` | | sync-coalition |
| `essays.records`, `essays.held` | unit id | `EssayRecord` / `HeldRecord` | essay-prompts |
| `essays.pages` | unit id | `PageRecipe` | essay-prompts |
| `history.schools` | unit id | `SchoolHistory` | sync-history |
| `history.shared` | `meta`, `national`, `facts`, `cpi` | | sync-history |
| `high_schools.*` | state / id | The shards, ledger, recipes, pilot, review queue (the tables stay the serving copy) | high-school syncs |
| `reference.files` | file name | As built, phase 3: the eleven names in `REFERENCE_FILES` (`scripts/lib/data-platform/layers.mts`) — `aid-policies`, `aliases-curated`, `application-cycle`, `guaranteed-admission`, `major-admission`, `state-laws`, `organizations`, `common-app-trends`, `excluded-campuses`, `essay-guidance/guidance` (text in `body.text`), `zcta-centroids` (CSV text in `body.text`) | import, the console (`/admin/data/reference/[name]`) |
| `overrides.legacy` | unit id | Today's `data/overrides.json` entries, imported once and applied where `sync-data` applied them; new corrections are field edits | import only |
| `health.colleges` | `health` | `college-health.json` | college-health (derived) |

Derived at publish and not stored as layers: the composed `School`, `selectivity` (built with hysteresis against the
previous snapshot), `trends/*`, the search index, `aliases` (base plus Common App's), `college-failures` (rebuilt by
the publisher from `reported.*` and loaded into `college_data_failures` as today).

## Row-level security
- `data_documents` and `data_document_versions`: **select for everyone** (`anon`, `authenticated`), because every
  layer is public data or pipeline state about public data; the console reads them with the viewer's own session.
  Pipeline state that is large (the review queue, docs manifest) is fine to expose; nothing in any layer is a person's
  data. No insert, update or delete policy for any role.
- `data_change_sets`, `data_snapshots`: select for everyone; writes through functions only.
- `data_field_edits`: select for everyone (the app overlays them for every visitor); writes through `admin_*`.
- Writers: pipelines use the secret key (`supabaseClient("publish")`) and call the `data_*` functions; the console
  calls the `admin_*` functions with the admin's session (`is_admin()`, aal2, the console header for reads, as
  [admin](../product/admin.md) requires).

## Functions

### For pipelines (security definer, `service_role` only)
```sql
-- Opens a change set and returns its id.
create function public.data_open_change_set(p_kind text, p_source text, p_run_ref text, p_summary jsonb) returns bigint;

-- Writes documents in one transaction: each {collection, key, body | null (delete)} becomes the next version of that
-- document and the current row. Refuses when p_change_set is not 'open', or when an optional p_expect_version per
-- document doesn't match the current version (optimistic concurrency for two runs on one layer).
create function public.data_write_documents(p_change_set bigint, p_documents jsonb) returns integer;

-- Closes the set: 'applied', or 'held' with the reason. Fills summary counts from the versions written.
create function public.data_close_change_set(p_change_set bigint, p_status text, p_held_reason text default null, p_summary jsonb default null) returns void;

-- Reads: the current documents of a collection (optionally one key or a key prefix), or a document at a version.
create function public.data_read_collection(p_collection text, p_key_prefix text default null) returns setof public.data_documents;
```
Reads from scripts go through PostgREST on the tables directly (select is open); the function exists for callers that
want one round trip for a whole collection.

### For the console (security definer, `is_admin()`)
```sql
create function public.admin_data_edit(p_unit text, p_path text, p_value jsonb, p_note text) returns bigint;        -- a field edit (one change set of kind 'edit' per call); logs data.edit
create function public.admin_data_release_edit(p_edit bigint) returns void;                                         -- logs data.release
create function public.admin_data_hold(p_change_set bigint, p_reason text) returns void;                            -- logs data.hold
create function public.admin_data_unhold(p_change_set bigint) returns void;                                          -- 'held' → 'applied'; logs data.unhold
create function public.admin_data_revert(p_change_set bigint, p_note text) returns bigint;                            -- writes a 'revert' change set restoring prior versions; logs data.revert
create function public.admin_data_resolve_review(p_key text, p_resolution text, p_note text) returns void;           -- 'rejected' | 'accepted'; writes the review item's document; logs data.review
create function public.admin_data_point_snapshot(p_snapshot bigint) returns void;                                     -- records a point-back (the Storage pointer is moved by the publisher's small 'point' job); logs data.point
create function public.admin_data_set_reference(p_name text, p_body text, p_note text) returns bigint;                -- a reference document (release calendar, aid policies, …) as JSON text, stored as written; logs data.reference
```
`admin_log.target_kind`'s check constraint gains `'college'`, `'change_set'`, `'snapshot'`, `'document'`. Every
function follows the existing shape: `is_admin()` first, named exceptions with error codes, one `admin_log_write` in
the same transaction with before and after in `details`.

### For the publisher (secret key)
```sql
create function public.data_begin_snapshot(p_change_set_ids bigint[], p_previous bigint) returns bigint;           -- a 'building' row
create function public.data_finish_snapshot(p_snapshot bigint, p_status text, p_manifest jsonb, p_notes text) returns void;
```
The publisher also calls the existing `stage_dataset_changes`/`publish_changes` (with the snapshot id in place of a
git commit in `git_commit`, prefixed `snapshot:`) and `record_selectivity_run`.

## Sizes and limits
About 1,893 documents per per-college collection; the whole layer set is roughly 60 MB of JSON today (the base is
most of it) and grows by one version per changed document per run. Postgres handles this comfortably on a Nano
instance for writes from one pipeline at a time; reads of a whole collection (the publisher) are one query of about
20 MB, which is why the publisher runs in GitHub Actions and not in a Vercel function. Versions are kept forever in
this plan; a pruning function for versions older than a year, keeping the first of each month, is listed in
[rollout.md](rollout.md) as a later step.

## As built, phase 3 (2026-10-31)
The release calendar (`base.release_calendar`, key `calendar`) is edited from the same console screen as every other
reference document, `/admin/data/reference/[name]`, not a screen of its own: the console's reference list
(`/admin/data/reference`) shows it beside the eleven `reference.files` documents, named `calendar`, with no dedicated
validator — like most of those documents, a save only needs to parse to a JSON object or array (see
[change-sets.md](change-sets.md) "As built, phase 3" for the validator table).
