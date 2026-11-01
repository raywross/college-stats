# Part 2, Publishing: the snapshot, the change log, the loader

> Part of [the data platform](README.md). Code: `scripts/publish-snapshot.mts` and `scripts/lib/data-platform/*.mts`
> (compose, render, upload, pointer, change log), `.github/workflows/publish-snapshot.yml`, `lib/data.ts` (the loader),
> `lib/data-platform/snapshot.ts` (shared: object names, manifest, pointer shape).

## The publisher
`npm run publish-snapshot` turns the layers in Supabase into the documents the app reads. It runs in GitHub Actions
(`publish-snapshot.yml`: `workflow_dispatch`; `repository_dispatch` with type `publish-snapshot` sent by each pipeline's
last step; a nightly run at 08:00 UTC as a catch-up) and can run locally with the secret key. One run takes two to
four minutes. Steps:

1. **Decide whether to publish.** Read the change sets since the last published snapshot. If any is `held`, stop and
   say so (the console shows it); if none, stop with "nothing to publish" unless `--force`. Automatic runs obey this;
   a person's run from the console passes `--force` after a publish decision.
2. **Load the layers**: every collection in [storage.md](storage.md) at its current version, plus the live field
   edits and `essay_prompt_overrides`. Record each collection's max version in the manifest.
3. **Compose**, in the order `sync-data` uses today, with the same functions: base colleges → `applyIdentity`
   (identity layer) → legacy overrides (`overrides.legacy`, with `lineageForPatch`) → `applyOpenAdmission` → trends
   carried from the previous snapshot → meta (`base.meta` plus the `add*Meta` of each layer present) → Common App →
   Coalition → essays (records, held excluded, `essay_prompt_overrides` as confirmed records) → `mergeReported`
   (entries and CDS records) → cross-checks → directories (`applyDirectories`, CCCU, LGBTQ policies) → `mergeDetails`
   → **field edits** (the new last step: set each live edit's value at its path, write its lineage record) →
   `buildSelectivity` with hysteresis against the previous snapshot's tiers and index → `validateLineage`. A lineage
   failure fails the publish (status `failed`, the console shows the first problems); nothing is uploaded.
4. **Render** the objects (below), each gzipped, with a sha256 in the manifest. Rendering is deterministic: the same
   layer versions give the same bytes (`tests/data-platform-publish.test.mts` proves it on the mini fixture).
5. **Upload** to the bucket under `<id>/` (the bucket is itself named `snapshots`, so a public URL reads
   `…/object/public/snapshots/<id>/colleges.json.gz`), then write the manifest, then move the pointer `current.json` to
   the new id. Objects are immutable once written (cache headers a year); the pointer is `no-cache`. The publisher then
   **waits 75 seconds** before the revalidate call in step 6: a warm instance re-reads the pointer at most once a
   minute, and revalidating sooner would regenerate static pages from the old snapshot.
6. **Record**: `data_finish_snapshot(published)`; the change log (`diffSchools` of this snapshot's colleges against the
   previous snapshot's, with the release calendar, through `stage_dataset_changes`/`publish_changes`, `git_commit =
   "snapshot:<id>"`); selectivity history (`record_selectivity_run`); `college_data_failures` upsert; the high-school
   tables when the `high_schools` layer changed (today's `publish-high-schools`); `revalidatePath("/", "layout")`
   through `POST /api/revalidate` so prerendered pages pick the new snapshot up at once.
7. **Prune**: keep the newest 30 snapshots' objects and every snapshot the pointer has ever been pointed back to;
   delete the rest from Storage (rows stay).

### Objects in a snapshot
| Object | Content | Who reads it |
|---|---|---|
| `colleges.json.gz` | The `School[]` array, one college per line (today's `schools.json` format), about 6 MB gzipped | `getData()`, once per instance |
| `meta.json`, `release-calendar.json`, `aliases.json` | As today | `getData()` |
| `history/shared.json.gz` | `{meta, national, facts, cpi}` in one object | `getHistoryFiles()` |
| `history/<unit>.json` | `SchoolHistory`, 1,893 objects, about 12 KB each | `getHistory(unit)` per request |
| `detail/<unit>.json` | `SchoolDetail`, 1,893 objects | `getDetail(unit)` per request |
| `trends/<name>.json` | The national trend files | `getTrendFile(name)` |
| `reference/<name>.json` | `platform-prompts`, `organizations`, `common-app-trends`, `essay-guidance.md` (as text), `zcta-centroids.csv` | Their readers in `lib/` |
| `search-index.json` | The browser's search index, built from the composed colleges | `app/search-index.json` serves it as is |
| `high-schools/<ST>.json` and the shared files | The JSON fallback for keyless environments | `lib/high-school-store.ts` |
| `manifest.json` | `{id, created_at, previous_id, colleges, objects: {name: {bytes, sha256}}, layers}` | The loader, the console |

About 3,900 objects per snapshot; Storage's object listing isn't used, so the count is harmless. The bucket is
**public-read** (`snapshots`), created once by the migration (`insert into storage.buckets … public = true`) with a
write policy for the service role only.

## The loader
`lib/data.ts` keeps every exported function and its contract. What changes is where `readDatasetFiles` gets bytes.

- **Source selection.** `DATA_SNAPSHOT_URL` set (the bucket's public base URL, no key): the snapshot mode below.
  Unset: the bundled copy at `.data/snapshot/` (what `fetch-snapshot` wrote at build time; CI and keyless Preview),
  else the legacy `data/` files while they still exist in the repo (phase 1 only).
- **Cold start.** Read the bundled copy from disk and serve it (the same 300 ms as today). Then, off the request
  path, fetch `current.json`; if its id is newer than the bundled one, download `colleges.json.gz`, `meta.json`,
  `release-calendar.json`, `aliases.json`, build a new dataset and swap the module-level reference. Readers always see
  a whole dataset, never a half-loaded one.
- **Staying fresh.** Every request calls `maybeRefresh()`, which re-reads the pointer at most once a minute per
  instance (a 1 KB request) and swaps when it moves. So a publish is live on every warm instance within a minute and
  on a cold one at once.
- **Shards.** `getHistory`, `getDetail`, `getTrendFile` and the reference readers fetch `${base}/snapshots/${id}/…`
  for the snapshot the instance currently serves, with Next's fetch cache (`cache: "force-cache"`, the id is in the
  URL so a new snapshot is a new cache key), falling back to the bundled file when the fetch fails. A profile render
  adds one 12 KB and one 10 KB fetch from the same region's CDN, about 20–40 ms, cached after the first.
- **Fail soft.** A pointer or object fetch that fails leaves the current dataset in place and logs once per minute.
  The bundled copy means a brand-new instance renders even if Storage is unreachable; it may be a day stale, never
  empty.
- **Build.** `npm run fetch-snapshot` (in `prebuild`) downloads the current snapshot into `.data/snapshot/` (git-ignored)
  when `DATA_SNAPSHOT_URL` is set, else copies the mini fixture (`tests/fixtures/snapshot-mini/`, about 25 colleges)
  so `next build` and the test suite work with no network and no keys. `outputFileTracingIncludes` traces
  `.data/snapshot/**` into every function in place of the `data/**` entries.
- **Timing and telemetry.** `[data] loaded N colleges (snapshot <id>) in M ms` once per load and once per swap;
  a `data_snapshot_swap` server event with `{from, to, ms}`; the console shows which snapshot each environment serves
  by reading the `<meta name="x-quad-snapshot">` tag every page carries (as built: a response header can't follow a
  swap because `proxy.ts` and `headers()` can't see the loader's state; the header exists only where the id is fixed
  for the deploy, and on `/search-index.json`).
- **Big objects are fetched with `node:http(s)`, not `fetch`** (as built): Next patches `fetch`, and an uncached fetch
  during a static render would make the page dynamic. Shards use `fetch` with `force-cache`. No swap happens during
  `next build`, so every prerendered page comes from one snapshot. A swap follows any pointer change, newer or older,
  so a point-back is honored, and every object's hash is checked against the manifest before the swap.

## The change log and tier history
`scripts/publish-changes.mts` and `publish-selectivity-history.mts` stop running on `deployment_status`. The publisher
calls their library code with two snapshots' colleges and metas in place of two git commits:
- `diffSchools(previous.colleges, next.colleges, NOTIFY_FIELDS, {calendar})` → `stage_dataset_changes`,
  `publish_changes(school_count, retrieved, "snapshot:<id>", "publisher", expected)`.
- `selectivity-history.mts`'s comparison of two indexes → `record_selectivity_run`, linked to the publish.
A snapshot that is pointed back to does not create a publish (the digest never reports a revert as news); the
console shows the point-back in the snapshot list and the admin log.

## The admin's publish controls
In `/admin/data` ([change-sets.md](change-sets.md)): **Publish now** dispatches `publish-snapshot.yml` with `force`
(the existing `dispatchRun` path, logged `ops.dispatch`); **Point back here** on a snapshot calls
`admin_data_point_snapshot` and dispatches the workflow's `point` job, which rewrites `current.json` and revalidates.
Both show the run's status like Operations shows runs today.

## Environments
One bucket, in the data project. `DATA_SNAPSHOT_URL` is the same on Vercel Production, Preview and local
`.env.local`. People's data keeps `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` per environment. The pipelines and the
publisher write with `DATA_SUPABASE_URL`/`DATA_SUPABASE_SECRET_KEY` (GitHub secrets), which today are the dev
project's values and at launch may stay there or move to a dedicated data project without touching the app.

## As built, phase 2 (2026-10-31)
- **Step order** differs from the plan: objects → manifest → pointer → the tables (`college_data_failures` upsert on
  every publish; the high-school tables when the snapshot's high-school objects' hashes changed) →
  `data_finish_snapshot` with the tables' log in the row's manifest → change log and tier history → wait 75 s →
  revalidate → **deploy hook** (`VERCEL_DEPLOY_HOOK_URL`, so the deploy's bundled copy stays current and cold starts
  download nothing; a failure never fails the publish; `--skip-deploy`) → prune. A `--point` run also waits,
  revalidates and calls the hook. Flags: `--skip-tables`, `--republish-high-schools`, `--skip-deploy`.
- **Trends** are derived from the history layer (`deriveTrends`) rather than carried; a college with no history
  document keeps the previous snapshot's.
- **Tables** are written with the data project's client; if the app's project ever differs from the data project,
  the change log, failures and high-school tables must move to the app's.
- **First real publish**: snapshot 1 from the dev project's layers, 3,809 objects, 52 MB, in 201 s; the change log
  recorded "no changes" against the committed files; a local server with `DATA_SNAPSHOT_URL` set loaded 1,893
  colleges from it. `DATA_SNAPSHOT_URL` is `<project url>/storage/v1/object/public/snapshots`.

## As built, phase 3 (2026-10-31)

### `edits.json`
A new object in every snapshot (`SNAPSHOT_OBJECTS.edits`, `edits.json`; listed in the manifest and hashed like every
other object, written on every publish whether or not any edit applied):
```ts
{ snapshot: number; edits: { id, unit_id, path, value, note, created_at,
  pipeline: { value, lineage } | null }[] }
```
`compose.mts` builds the array as its last step (after every pipeline layer, before the edits themselves are applied):
for each live edit it captures the composed college's value and lineage record at that path **as the pipelines left
it**, before the edit overwrites either. `pipeline` is `null` only when the path held no value at all — a stored
`null` is a real value and is kept as `{ value: null, lineage: ... }`, distinct from "nothing there." The lineage half
may be `null` even when the pipeline value isn't (a field cited to its registry default, with no per-school record).
The array is sorted by `unit_id` then `path`, so the rendered bytes are deterministic given the same edits. The
console's "a newer pipeline value exists" marker (F2) reads this object from the snapshot the instance currently
serves; the loader and `fetch-snapshot` ignore it entirely — nothing in the app reads `edits.json` except that one
admin check, and it is never required for a page to render. The mini fixture's copy
(`tests/fixtures/snapshot-mini/snapshot/edits.json`) is `{ "snapshot": 0, "edits": [] }`.

### The production switch's one observed fact (2026-10-31)
After a publish, dynamic request handling (the loader's `maybeRefresh()`, read fresh on every request up to once a
minute per instance) shows the new snapshot within a minute everywhere. Prerendered pages are slower: they keep
showing the snapshot id that was **bundled into the deploy** (`.data/snapshot/`, written by `fetch-snapshot` at build
time) until the deploy hook's own deploy finishes and lands, which took two to five minutes in the switch. The reason
is the cold-start path in "The loader" above: a fresh instance always serves the bundled copy first and only swaps
off the request path, so a prerendered page that regenerates on a cold instance before that instance's first
background refresh bakes the *bundled* snapshot id back in, not the one the warm instances are already serving. A
publish's revalidation and the deploy hook together are what eventually make every instance's bundled copy current
again.
