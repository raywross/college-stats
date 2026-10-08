# Database Architecture

> Status: **guide** (reviewed 2026-10-02; revised 2026-10-07). Not a work item: the rules here apply as the roadmap
> specs are built. Companion to [supabase.md](supabase.md) (what Supabase holds and how it's published) and
> [product/README.md](product/README.md) (the user-data rules).
>
> **Revised 2026-10-07** ([serving-architecture.md](serving-architecture.md)): the college dataset, history, details,
> and aliases are no longer Supabase tables. They ship with the deploy and are read from the function's own files.
> The "published artifacts" column below now describes only the high-school dataset; the sections on document tables
> and on generalizing them are kept as the record of why that shape was chosen and why it was retired for the
> college data (it duplicated what the deploy already carried, and the publish raced the build).

## The question
Today Supabase holds simple tables with one JSON document per row (`schools.data`, `school_histories.data`), replaced
whole on each publish, and the app loads the entire dataset into memory. Is that the right shape for everything on
the roadmap: more college data (detail tables, majors, earnings by major), a high school dataset, accounts and
households, saved lists, finances, award letters, scattergrams, counselor organizations, and an API?

**Answer: yes for the published data, no for the product data.** The database has two parts with different rules.

| | Published artifacts | Application data |
|---|---|---|
| What | The high-school dataset (since 2026-10-07 the only published collection in Postgres; the college dataset ships with the deploy) and the change log | Accounts, households, profiles, lists, finances, offers, scattergram points, organizations, API keys |
| Source of truth | Git (`data/**`), reviewed in PRs | Supabase only; no JSON counterpart |
| Shape | Typed columns for what's searched, a `json` document for the rest | Typed columns; `jsonb` only for loose groups |
| Writes | Batches by `publish-high-schools`; the change log by `publish-changes` in one transaction | Row by row, by the signed-in user through RLS |
| Reads | One row by key, or a trigram search | Indexed queries per user |
| Who may read | Everyone | Owner, household, organization, per the policy |
| Backup | Reproducible from git | Supabase backups; the real backup need |

## Why documents are right for the published data
- Every page needs the whole set: percentile ranks, medians, similar schools, Explore's filters and sorts all run over
  all 1,893 colleges. Loading once per instance and querying in memory ([data-layer.md](data-layer.md)) is faster
  than row-by-row SQL and gives the same answer whichever store served the rows.
- A publish must be all-or-nothing; swapping a collection in one transaction does that.
- The document must read back byte for byte to match git, which is why columns are `json`, not `jsonb` (jsonb
  reorders keys and the UI iterates some objects in key order). Nothing filters inside documents in SQL, so jsonb's
  indexing isn't missed. If a SQL filter on one field is ever needed, add a generated column from the document
  rather than normalizing.
- Measured 2026-10-02: the snapshot is 8.0 MB (1,893 rows, ~4.8 KB each; admissions, campus, cost, outcomes, and
  trends are the largest sections), parses in ~36 ms and takes ~31 MB of heap; history is 19 MB in 7.7 KB shards
  read one per profile. The pattern has room for several times this: waves 2 and 3 add scalars to the snapshot and
  put large tables in the per-college detail file, read per profile ([majors.md](data-expansion/majors.md#store-and-the-detail-file)).

### Limits of the in-memory pattern
It assumes the collection fits comfortably in one process and is needed whole. Two roadmap items break that
assumption and must not be loaded into memory:
- **High schools** (~24,000 rows, ~25 MB; [high-school-data.md](product/high-school-data.md)): a table with real
  columns for what's searched (`ncessch`, `name` with a trigram index, `state`, `district`) and a `json` document for
  the rest, read by key or by search.
- **Programs across colleges** (~100,000 rows of earnings by major; [field-of-study.md](data-expansion/field-of-study.md)):
  the per-college detail document serves profiles, and a `programs(unit_id, cip4, …)` table with an index on `cip4`
  serves "colleges by earnings for one major" and the API.

## Generalize the document tables (not done; retired 2026-10-07)
> The college collections left Postgres before this was built ([serving-architecture.md](serving-architecture.md)),
> so there is nothing left to generalize; high schools keep their own typed table. Kept as written for the record.

Each document collection has grown its own tables and publish functions (`publish_dataset`, `publish_history`,
`stage_history` + `publish_history_staged`), and history needed staging because one call exceeded the API's
statement timeout. The detail file and the high school dataset would repeat both. Replace the per-collection
functions with one shape:

```sql
published_documents (collection text, key text, data json, primary key (collection, key))
published_files     (collection text, name text, data json, primary key (collection, name))
publishes           (collection text, published_at timestamptz, count integer, git_commit text, published_by text)
document_staging    (collection text, key text, data json)
stage_documents(p_collection, p_rows json, p_reset boolean)              -- batches, secret key only
publish_collection(p_collection, p_files json, p_expected integer)       -- one transaction swap, secret key only
```
- Collections: `schools`, `history`, `details`, `high-schools`. Each has its own version
  (`publishes.published_at` for that collection), so the app's per-collection version check and reload
  ([supabase.md](supabase.md#revalidation)) stay as they are.
- The app reads with one function per access pattern: `readCollection(name)` (paged, ordered by key or a stored
  position) and `readDocument(name, key)`.
- Migrate `schools` and `school_histories` into it in one migration that creates the new tables, copies the rows,
  and drops the old functions; the existing read-back and PGlite tests move over unchanged. Keep `position` in the
  document or as a column so `schools` lists in the file's order.

## Serving the public dataset: an open decision
> **Decided 2026-10-07:** option 1, bundle the JSON, with search moved into the browser and the dataset tables
> retired a cycle later. The reasons, measurements, phases, and owner steps are in
> [serving-architecture.md](serving-architecture.md). The text below is the question as it stood.

Every data change reaches production as a merge to `main`, which already triggers a Vercel build. Serving the
dataset from Supabase therefore buys little that bundling the JSON into the build wouldn't, and it costs:
- a full download per cold function instance (Vercel recycles instances often, so Supabase egress follows cold
  starts, not traffic; the free plan allows 5 GB a month),
- one version query per dynamic render,
- the deploy race that `publish-data.yml` works around.

Two defensible options, to decide before the formal release ([backlog.md](backlog.md#platform)):
1. **Bundle the JSON** (`DATA_SOURCE=json` in production; `outputFileTracingIncludes` already traces `data/**`).
   Supabase then holds application data only. Simplest; a data change is live when its deploy is.
2. **Keep Supabase, read one object.** Publish each collection as one gzipped object in Supabase Storage and read
   that instead of paging rows, so a cold load is one request. Keeps publishing without redeploying, which matters
   only if data ever changes without a merge (it doesn't today).
Measure cold-start counts with [telemetry](product/telemetry.md) first; if they are low, option 2's cost is small
and the decision can wait.

## Application data: rules
These apply to every table in the product specs ([product/README.md](product/README.md#shared-rules-for-user-data)).
- **Typed columns** for money, counts, dates, enums, and anything filtered or summed. `jsonb` for loose groups that
  are read whole (profile preferences, offer line items), never for a value a policy or threshold depends on.
- **One access helper.** A `security definer` function such as `can_view_student(student_id)` encodes household and
  organization membership ([accounts.md](product/accounts.md#privacy-model)); every policy calls it, so a rule is
  written once. Tables a student must never read (household finances) have no policy a student session can satisfy.
- **Thresholds in views.** Aggregates with a minimum count (scattergrams, pooled offers) are SQL views that apply
  the threshold and binning; clients are granted the view, never the point tables
  ([scattergrams.md](product/scattergrams.md#display-rules)).
- **Policy tests on real Postgres.** Every migration that adds a policy adds a PGlite test that fails when the policy
  is removed, as `tests/supabase.test.mts` does for the dataset tables.
- **Writes through Server Actions** with the signed-in user's token, so RLS applies. The secret key stays in scripts.
- **Migrations are additive** (add, don't rename), applied to dev before prod, because app and database deploy
  separately ([supabase.md](supabase.md#environments-two-projects)).
- **Indexes** on every foreign key used in a policy (`household_members(user_id)`, `(student_id)`), and on
  `(student_id, …)` for list and offer lookups.

## Not in Postgres
| Need | Where | Why |
|---|---|---|
| Telemetry | PostHog ([telemetry.md](product/telemetry.md)) | Event volume and dashboards aren't a job for the app database |
| Uploaded award letters, profile PDFs | Supabase Storage, private buckets with RLS | Files, not rows |
| Search | In memory for colleges; `pg_trgm` for high schools | No separate search service at this scale |
| Rate limiting (API) | A small Postgres function first; a KV store if counting load matters | [data-api.md](product/data-api.md) |

## Plan and backups
Move to the Supabase Pro plan at the formal release: daily backups, no auto-pausing, and the auth user ceiling
([accounts.md](product/accounts.md#research-2026-10-02)). Add point-in-time recovery once finances and award letters
exist; the public data needs no backup beyond git.

## Checklist when a roadmap spec adds tables
1. Published or application data? Published goes in a collection through `publish_collection`; application data gets
   typed tables.
2. Will it be loaded whole into memory? Only if it stays a few tens of MB and every page needs all of it.
3. Which policy helper decides access, and which test proves it?
4. Any aggregate with a minimum count? Put it in a view.
5. Version and reload behavior for a new collection; fail-soft reads like `getHistory()`.
