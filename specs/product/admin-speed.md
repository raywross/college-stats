# Admin Console Speed: Where the Time Goes, and the Fixes

**Status:** review and plan (2026-11-10). Nothing here is built yet.

The owner's report after a day on the redesigned console (`admin-redesign.md`): the pages are good, but every one of
them is slow, and the Inbox is the worst. This document is the review: what each page reads, what those reads cost
against the live database, why the Inbox pays several seconds, and a plan in three waves, from a one-line index to
restructuring how the review queue is stored.

## Summary

The console is slow for five reasons, in order of weight:

1. **The review queue is read whole, over and over.** `reported.review_queue` holds **21,977** documents (11 MB), every
   one of them open. The console reads it in **22 sequential pages of 1,000** (2.6 s measured end to end, 12 MB over
   the wire) whenever an instance's five-minute cache is cold or any document was written since; the Inbox starts that
   read **twice in the same request**. And the check that decides whether the cache is still good, "newest write to the
   collection", is itself a **sequential scan of the whole 41,000-row table** (230 ms idle, 2.0 s under load,
   4.8 s worst case recorded), because the table has no index on `(collection, updated_at)`. That check runs on
   every Inbox, Findings, To do, and college Review load, cache or no cache.
2. **Every console page reads a 446 KB row to show one badge.** The layout's "Needs you" count reads the last
   published snapshot with `select *`, and the snapshot's manifest carries a 510 KB `objects` map (one entry per
   lineage shard). The Inbox reads the same row again for its tiles. The badge needs one date and one number.
3. **Pages read in waves instead of at once.** A college's page runs six dependent reads one after another; a person's
   page about eight; a student's about seven plus the estimate. Each wave is a round trip from Vercel (`iad1`) to the
   Supabase project in **`ca-central-1`**, plus PostgREST's own time, so a page of seven waves spends ~0.5 s waiting
   even when each query is instant.
4. **The Inbox waits for GitHub.** "What the Steward did" and the job rows call the GitHub API **once per workflow
   (13 calls)** on every Inbox load, and the page's HTML doesn't start until the slowest answers. Nothing on the page
   streams: the first byte waits for the slowest of the fourteen sources.
5. **The database is the smallest Supabase offers, and it is busy.** The project runs on the default **Nano** compute
   (shared CPU, no add-on). The visit-events sync writes single rows at **677 ms each on average** (7.2 s worst) and
   its reads take 300–500 ms; while a job runs, every console query queues behind it. `data_document_versions` is
   135 MB (63,649 versions of queue items alone; `reported.reports` versions 117 MB), which the Nano's disk I/O pays
   for on every scan.

The fixes, in the order to build them (details under "The plan"):

- **Wave 1, a day, no schema change but one index:** the `(collection, updated_at)` index; select the snapshot's
  columns, not its manifest; one queue read per request and per instance (in-flight sharing, React `cache()`); the
  Inbox and the badge share their reads; Suspense around the Inbox panels so the shell paints first; GitHub consulted
  from a 60-second per-instance memo and never on the response path; the dependent reads of the college, person, and
  student pages collapsed into two or three waves; the Data overview's environment check made cheap. Expected: Inbox
  from several seconds to about a second cold and under half a second warm; other pages from 1–2 s to 0.3–0.6 s.
- **Wave 2, the restructure:** the review queue leaves the document store for a table of its own, `review_items`,
  with a status column and indexes, so the console counts, filters, and reads one college's items in SQL and never
  loads the queue; the clusters the Findings screen shows are written by the Steward's run as one small document,
  like the health document already is. Expected: no console page reads more than a few hundred queue rows.
- **Wave 3, the platform:** a compute add-on (Micro, ~$10/month, or Small, ~$15/month) for the project that serves
  production until the prod project exists; batch writes in the visit-events sync; a retention rule for document
  versions of high-churn collections; and timing lines for the admin routes so production logs show the numbers.

## What was measured, and how

Measured 2026-11-10 against the dev project (the one production serves today), three ways:

- **Each console read, as the pages issue it**, through PostgREST from a laptop with the service key (the same
  query shapes and 1,000-row pages; `data_documents` selects for every role, so those numbers are the pages' own;
  the RLS-guarded tables ran without the admin policy's `is_admin()` call, so those are a little optimistic). The
  laptop's round trip to `ca-central-1` is ~40 ms; Vercel's `iad1` is ~15–20 ms, so the per-call numbers below are
  ~20 ms higher than production's, and the 22-page read ~0.5 s higher.
- **`EXPLAIN (ANALYZE, BUFFERS)`** through the Management API's query endpoint for the queue's three query shapes.
- **`pg_stat_statements`** (the `extensions` schema), which carries every statement's calls, mean, and worst time since
  the last reset: the production console's own history.

### The read timings

| Read (who issues it) | Calls | Bytes | Time |
|---|---|---|---|
| `is_admin_any_aal` RPC (every page, `adminState`) | 1 | — | 50 ms warm, 520 ms as the first call of a cold client |
| Queue: newest `updated_at` (every `readQueue`) | 1 | — | **230–437 ms**; 2,022 ms by `EXPLAIN` under load; 298 ms mean / 4,810 ms max over 559 calls in `pg_stat_statements` |
| Queue: every document (`readCollection`) | **22 sequential** | **12.2 MB** | **2,633 ms** |
| Queue: keys only (what the clusters' "fetched" check reads of `reported.docs`) | 22 | 730 KB | 949 ms |
| `reported.failures` whole (To do) | 2 | 846 KB | 174 ms |
| `reported.docs` keys (Findings) | 2 | 101 KB | 108 ms |
| `steward.todo` whole | 1 | 203 KB | 81 ms |
| `steward.proposals`, `.decisions`, `.runs`, `.issues` prefix | 1 each | <35 KB | 36–48 ms each |
| `health.colleges` document (cold instance only) | 1 | 810 KB | ~300 ms |
| The seven `adminCounts` head counts (Inbox tiles) | 7 parallel | — | 40–133 ms each; `students` count 430 ms mean / 6,108 ms max over 16 calls in `pg_stat_statements` |
| Deletions, waiting invitations, held change sets (badge + Inbox) | 1 each | — | 108–157 ms each; `invitations_admin` 188 ms mean / 2,408 ms max |
| Last published snapshot, `select *` (badge, Inbox, Data overview) | 1 | **446 KB** | **305 ms**; 44 ms mean / 1,799 ms max over 223 calls |
| Change sets since the last publish | 1 | 25 KB | 120 ms |
| `list_items` page (To do demand, health's family filter) | 1 | 11 KB | 100 ms |
| `job_runs` newest 60 (Inbox, Jobs) | 1 | — | 70 ms |
| `admin_log` newest 51 (Log) | 1 | 65 KB | 106 ms |
| `selectivity_latest_rows` RPC (Selectivity) | 1 | 677 KB | **830 ms**; 220 ms mean / 874 ms max |

The queue's three shapes under `EXPLAIN`:

| Query | Plan | Time |
|---|---|---|
| newest `updated_at` for the collection | **Seq Scan** of `data_documents` (41,023 rows, 4,336 buffers), top-N sort | 2,022 ms (loaded), 230 ms (idle) |
| one 1,000-row page by key | Index Scan on the primary key `(collection, key)` | 20 ms |
| 1,000 keys of a collection | Index Only Scan on the primary key | 20 ms |

So the pages themselves are cheap in Postgres; the cost is the number of pages (22, in series), the bytes they carry
(12 MB of JSON serialized by PostgREST and parsed by Node), and the one un-indexed query that runs before them.

### The store's shape

| Collection | Documents | Body bytes | Note |
|---|---|---|---|
| `reported.cds_records` | 535 | 43 MB | one per college with a CDS; read one at a time (fine) |
| `history.schools`, `base.colleges`, `base.detail` | 1,893 each | 22, 15, 12 MB | the publisher's, not the console's |
| **`reported.review_queue`** | **21,977** | **11 MB** | **all 21,977 open**; queued 2026-10-03 → 2026-11-09; 19,843 rewritten on 2026-11-08, 996 on 11-10 |
| `reported.failures` | 1,866 | 797 KB | read whole by To do and the Inbox |
| `health.colleges` | 1 | 810 KB | read once per instance |
| `steward.todo` | 263 | 194 KB | |
| `steward.proposals`, `.issues`, `.decisions`, `.runs` | 13, 16, 3, 5 | <35 KB each | |

Tables: `visit_events` 211 MB (266,450 rows), `data_document_versions` 135 MB (98,403 rows; 63,649 are queue
versions, 29 MB; `reported.reports` versions 117 MB), `data_documents` 91 MB. The only index on `data_documents`
beside the primary key is on `change_set_id`.

Compute: no add-on (Nano). `shared_buffers` 224 MB, 60 connections. Region `ca-central-1`; Vercel functions run in
`iad1` by default (`vercel.json` sets no region).

### What `pg_stat_statements` says about the load

The ten heaviest statements by total time are the visit-events sync's single-row inserts (250 calls, **677 ms mean,
7,242 ms max**) and reads (194 calls, 508 ms mean, 6,621 ms max), the queue's newest-write scan (559 calls, 298 ms
mean), and the Steward's document writes. The console's own small queries show the same signature: tiny means with
multi-second maxima (`students` count 6.1 s, `invitations_admin` 2.4 s, the snapshot row 1.8 s). That is contention,
not the queries: a Nano instance running one job at a time.

## Page by page

What each page reads today, in waves (reads inside one wave run in parallel; a new wave waits for the one before).
"Layout" is `app/admin/layout.tsx`, which runs on every full page load and whenever the tree re-renders after a
Server Action: `adminState()` (the claims check, local; one `is_admin_any_aal` RPC), then `needsYouCount()`, which
is one wave of seven reads (decisions, proposals, deletions, waiting invitations, held change sets, collision
issues, **the 446 KB snapshot row**). Client-side navigation between console pages re-renders only the page
segment, so the layout's cost is paid on a reload, a typed URL, a link from outside, and after every action.

| Page | Reads | Waves | What hurts |
|---|---|---|---|
| **Inbox** `/admin` | 14 sources in one `Promise.all`: decisions, proposals, To do (= `steward.todo` + `reported.failures` + `directories.blocked` + **the whole queue**), runs, jobs (`job_runs` + **13 GitHub calls**), deletions, invitations, held changes, seven counts, organization count, the snapshot row, **the whole queue again** (the tile), health (810 KB, cold), collisions | 1 wave of 14, but the queue source is itself 1 + 22 sequential calls | the queue read (2.6 s, twice), the un-indexed newest-write check (0.2–2 s), GitHub, and nothing streams |
| Findings `/admin/steward/findings` | `readClusters` (newest-write check + whole queue + `reported.docs` keys), issues, runs, `collegesToReview` (**the queue again** + proposals), `getData()` | 2 | same queue read; `readClusters` and `collegesToReview` don't share it |
| To do `/admin/steward/todo` | `listsByUnit` (list_items pages), then To do (queue + failures + todo + blocked), logins | 2 | the queue read, to find the few hundred unreachable/not-a-url items |
| A college's Review `/admin/data/colleges/[unit]/review` | `readClusters` (the whole queue), the college's record, proposals, failures, todo, `getData()` | 1 | the whole queue, to show one college's rows |
| A college `/admin/data/colleges/[unit]` | `adminCollege` (`getData` + GPA model + health), viewers RPC, `historyInstalled`, `collegeHistory`, `readCollegeDocuments`, `collegeInputsFor` | **6 sequential** | each `await` on its own line; two or three waves would do |
| A person `/admin/people/[user]` | profile; eight reads; own memberships; households + members; names; names; lists; items; access log; plus `logStudentView` (a write) | **~8 sequential** | round trips |
| A student `/admin/students/[id]` | record; profile + lists + membership; items + tasks; notes/visits/offers/letters/snapshots/household; names; access log; then `standingForStudent` (profile, student, lists → items → visits → `estimateContext`), org grants (2), `findPeople`, a view write | **~7 + 4** | round trips; the estimate's reads repeat the page's |
| A household `/admin/households/[id]` | household; members + invitations + homes; names; names | 4 | fine |
| People, Households, Organizations, Log, Admins, Settings | one RPC or one or two reads | 1–2 | fine (the lists are paged in SQL) |
| Data overview `/admin/data` | **an HTTP GET of each environment's home page** (production's full HTML, 4 s timeout) + the snapshot row; then change sets + holds | 2 | fetching ~250 KB of HTML to read one `<meta>` tag, on every load |
| Health `/admin/data/health` | `healthOverview` (810 KB document, cached; `dataset_changes`), `getData()`, `familyListUnits` (list_items pages); Sources tab adds the selectivity summary (runs + a run's changes, paged), visit-events health, source files, estimate inputs | 2–3 | cold instance only: the document and the dataset (~0.9 s together) |
| Selectivity `/admin/data/selectivity` | `historyInstalled`, runs, a run's changes (paged RPC), `getData()`; movers call `selectivity_latest_rows` (677 KB, 830 ms) | 2–3 | the 677 KB RPC result |
| Jobs `/admin/steward/jobs` | `job_runs` + 13 GitHub calls + reviews | 2 | GitHub on the response path |
| A job, a run | `job_runs` + 1–2 GitHub calls | 2 | GitHub on the response path |
| Essays `/admin/data/essays` | `getData()`, `listsByUnit`, overrides, held essays (41 docs) | 2 | fine |

Common to every page: the layout's seven reads (with the 446 KB row) and, on a cold instance, the dataset load
(`[data] loaded 1893 colleges … 550–600 ms`, `serving-architecture.md`).

### The Inbox, step by step

Cold instance, from the numbers above (production's round trips are shorter than the laptop's, so take these as
upper bounds):

1. `adminState`: the claims check and one RPC, ~50 ms (500 ms on the first call of a cold client).
2. Layout and page start together. The layout's wave: 7 reads, the slowest the 446 KB snapshot row, ~300 ms.
3. The page's wave of 14. Twelve finish inside ~300 ms. Two don't:
   - **the queue** (through To do, and again through the tile): newest-write check 230–2,000 ms, then 22 pages,
     2.6 s, **twice at once** (the cache has no in-flight sharing, so both callers miss and both read); the second
     caller's pages run beside the first's, so the wall time is ~2.9 s and the database does 44 page queries;
   - **jobs**: 13 GitHub calls in parallel (each ~150–400 ms from `iad1`; the first mints an installation token, two
     more calls) — ~0.5–1 s;
   - health on a cold instance: the 810 KB document, ~300 ms.
4. Then the page renders and the first byte leaves: nothing was streamed.

Warm instance, cache valid: the newest-write check still runs (230 ms idle, up to 2 s while a job runs), GitHub still
runs, the snapshot row is still read twice. About 0.6–1 s on a quiet database, more under load. After a Steward run
or any queue write, the next load is cold again, and 19,843 documents were rewritten on 2026-11-08 alone.

## The plan

### Wave 1: the same data, read once and read small (a day)

1. **Index `data_documents (collection, updated_at desc)`.** One additive migration. The newest-write check becomes
   an index lookup (<1 ms). Every `readQueue` call, cached or not, stops paying 0.2–2 s.
2. **Read the snapshot's columns.** `lastPublishedSnapshot` selects `id, created_at, created_by, status,
   change_set_ids, previous_id, pointer_at, notes` and `manifest->colleges`, `manifest->layers` (PostgREST's JSON
   path selection), never `objects`. Versions (`loadSnapshots`) does the same; the one place that needs the objects
   (the compare/download links, if any) reads them for one snapshot. 446 KB → ~1 KB per page.
3. **One queue read per request and per instance.** `readQueue` keeps an in-flight promise: concurrent callers wait
   on the same read. `loadInboxInput` reads To do once and derives the tile's open/new-this-week counts from it
   instead of a second `readQueue`; Findings passes the clusters' items to `collegesToReview` instead of reading again.
4. **The layout and the page share reads.** The seven badge reads and the Inbox's copies go through React `cache()`
   per request (decisions, proposals, deletions, invitations, held, collisions, the snapshot row). On every other
   page the badge's wave shrinks with fix 2; a per-instance memo of 30 s for the badge, reset by the console's
   actions, takes it off most reloads entirely.
5. **Stream the Inbox.** `loading.tsx` under `/admin` so the shell (rail, tab bar, header) paints at once, and the
   three Inbox panels in their own `<Suspense>` boundaries: "Needs you" first (the cheap sources, then the queue-backed
   rows fill in), "The Steward did" (runs, from the store), "How things are" (tiles) and the jobs rows last. The
   rule for the rest of the console: a panel that waits on GitHub or on a whole collection streams; the page's
   first byte never does.
6. **GitHub off the response path.** The Inbox and Jobs pages read the last run of each GitHub job from a
   per-instance memo (60 s TTL, filled in the background with `after()`), and, better, from `job_runs`: each
   workflow records its run there at start and end (the pipeline already writes `data_change_sets.run_ref`), so the
   console needs GitHub only for a run's log on the run page. Until the workflows write `job_runs`, the memo alone
   makes the Inbox independent of GitHub's latency after the first load.
7. **Collapse the waves.** The college page reads viewers, `historyInstalled` + history, the documents, and the
   inputs in one `Promise.all` after `adminCollege` (6 → 2 waves). `adminPerson` reads households and members in one
   wave with the memberships and collapses the two `withNames`/`namesFor` calls into one. `adminStudent` and
   `standingForStudent` share the profile, lists, items, and visits reads through `cache()` (7 + 4 → ~5 waves).
   Longer term, each of these pages is one `admin_person_bundle(uuid)` / `admin_student_bundle(uuid)` SQL function,
   as the counselor portal's pages became (`counselor-portal.md` "The reads"): one round trip, the policy checked once.
8. **The Data overview's environment check.** Fetch `HEAD` or a tiny endpoint (`/api/snapshot`, returning the
   loaded snapshot id as JSON) instead of each environment's home page; and stream the environments panel, since it
   is the one source on that page that depends on another deployment.
9. **`selectivity_latest_rows`** returns the columns the movers need, not every row's full record (677 KB → tens of
   KB); or the movers RPC takes the window and does the filtering in SQL.

Expected after wave 1 (production, `iad1` → `ca-central-1`): Inbox ~0.3 s to the shell and "Needs you", the
queue-backed rows ~0.5–0.8 s warm and ~2 s cold (the 22 pages remain until wave 2); other pages 0.3–0.6 s; the
badge's cost on every page ~50 ms.

### Wave 2: the review queue as a table (two or three days)

The queue is the one collection the console must see whole to answer small questions ("how many are open", "which
are unreachable", "this college's rows", "what clusters"). Documents can't be counted, filtered, or indexed by their
contents without reading them, and `body` is `json` (not `jsonb`), so even expression indexes are awkward. The fix is
a table:

```sql
create table public.review_items (
  key           text primary key,              -- unit|edition|code, as today (lib/reported.ts reviewKey)
  unit_id       text not null,
  edition       text,
  code          text,
  sha256        text,
  status        text not null default 'open'   -- open | accepted | rejected
                check (status in ('open','accepted','rejected')),
  checks        text[] not null,               -- the failures' check names, for filters and clusters
  queued        date not null,
  run           text not null,
  body          jsonb not null,                -- the whole ReviewItem, as the document was
  resolved_on   date,
  resolved_note text,
  change_set_id bigint not null references public.data_change_sets (id),
  updated_at    timestamptz not null default now()
);
create index review_items_status_queued on public.review_items (status, queued desc);
create index review_items_unit on public.review_items (unit_id) where status = 'open';
create index review_items_checks on public.review_items using gin (checks) where status = 'open';
```

- **Writes** go through the same change-set functions the store uses (`data_open_change_set` → `data_write_documents` →
  `data_close_change_set`, and `admin_data_resolve_review` for Holds), so a run's queue changes stay one change set with one version history; the per-item version
  rows move to `review_item_versions` (or are kept only for resolutions, which is what anyone ever looks up). The
  pipeline's `enqueueItems` and the scripts that touch the queue (`check-cds-records`, `drop-document`,
  `hold-misread`, `college-failures`, `college-health`) switch to the table through `scripts/lib/data-platform`.
- **Reads** become SQL, each a single round trip:
  - the Inbox's tile: `select status, count(*) … group by status`, and "new this week" from `queued`;
  - To do: `where status = 'open' and checks && '{unreachable,not-a-url}'` — a few hundred rows, not 21,977;
  - a college's Review page: `where unit_id = $1 and status = 'open'`;
  - the Findings clusters: computed by the Steward at the end of each run and written as one document,
    `steward.clusters` (the cluster key, kind, counts, member keys), the way `health.colleges` is reduced from 42 MB
    of sources by `college-health`. The console reads one document (tens of KB). A `review_clusters()` SQL function
    over `checks` and `sha256` is the fallback if the Steward's write is ever late;
  - Holds (Accept/Reject) resolve by key, as today, with `status` set in the row.
- **Migration:** one script copies the documents into the table (the body as `jsonb`, `checks` from
  `failures[].check`, `status` from `resolved`), runs both for one release with the console reading the table and
  the pipeline writing both, then the collection is dropped from `COLLECTIONS` and the publisher's layers. The
  snapshot never carried the queue, so publishing is unaffected.
- **Retention, an owner decision:** every one of the 21,977 items is open and the oldest dates from 2026-10-03. The
  table makes a rule cheap (`delete where status <> 'open' and resolved_on < now() - interval '90 days'`, or an
  `expired` status for items whose document a later run superseded). Without one the table grows ~1,000 rows a run.

Expected after wave 2: no console page reads more than a few hundred queue rows; the Inbox warm ~0.3 s, cold
~0.8 s (the dataset and the health document); Findings, To do, and Review in one wave each.

### Wave 3: the platform

1. **Compute.** The project serving production is a Nano. A **Micro** add-on (~$10/month: 2 shared cores, 1 GB,
   87 MB/s baseline disk) or **Small** (~$15/month, 2 GB) is the single change that helps every page and every job at
   once; the Management API lists both as available. Owner decision; it applies to the dev project now and to the
   prod project when it is created (`supabase.md`), which should also sit in `us-east-1` beside Vercel.
2. **The visit-events sync** inserts one row per call (677 ms mean, 250 calls in the window). Batch its writes
   (`upsert` of a few hundred rows per call) and run it when people are asleep; it is the load that makes a quiet
   query take seconds (`product/visit-events.md`).
3. **Version retention** for high-churn collections: keep every version of the Steward's and the edits' collections,
   but for `reported.review_queue` (until wave 2), `reported.reports` (117 MB of versions), `identity.probe`, and
   `reported.sources`, keep the last N versions or 90 days. A weekly job with a `delete … where` per collection and
   the rule written in `data-platform/change-sets.md`.
4. **Timing lines for the console.** Wrap `/admin`, the Steward screens, a college, a person, and a student in
   `withTiming` (`serving-architecture.md` "Timing a request"); `QUAD_TIMING=1` is already on in production, so the
   logs will show `[timing] /admin 812ms: db 23× in 3 waves …` and the next review measures instead of estimating.

## Owner decisions

1. **Compute add-on** for the project that serves production: Micro (~$10/month) or Small (~$15/month), or stay on
   Nano until the prod project exists.
2. **Queue retention:** should resolved items leave the queue after a time, and should an item whose document a later
   run superseded be closed as `expired`? (The table makes either a one-line rule.)
3. **Order:** wave 1 first in any case (a day, additive). Wave 2 is the structural fix and can follow in the same
   week; wave 3's items are independent and can go whenever.

## Files this touches

| Area | Files |
|---|---|
| Index, snapshot columns | `supabase/migrations/2026…_data_documents_updated_at.sql`; `lib/admin/data-reads.ts` |
| Queue reads | `lib/admin/review-queue.ts` (in-flight sharing), `lib/admin/inbox-reads.ts`, `lib/admin/steward-reads.ts` |
| Badge and Inbox sharing, streaming | `app/admin/layout.tsx`, `app/admin/loading.tsx`, `app/admin/page.tsx` (panels as async components under `<Suspense>`), `lib/admin/inbox-reads.ts` |
| GitHub off the path | `lib/jobs/runs.ts`, `lib/github-app.ts` (memo), the workflows writing `job_runs` |
| Waves | `app/admin/data/colleges/[unit]/page.tsx`, `lib/admin/people.ts`, `lib/admin/standing.ts` |
| Data overview | `lib/admin/data-reads.ts` (`fetchEnvironmentSnapshot`), `app/api/snapshot/route.ts` (new; nothing serves the loaded snapshot id today) |
| Wave 2 | `supabase/migrations/2026…_review_items.sql`, `scripts/lib/data-platform/` (writer), `lib/reported.ts`, `lib/admin/review-queue.ts`, `lib/admin/steward-reads.ts`, `lib/steward/cluster.ts` (the Steward writes `steward.clusters`), `scripts/check-cds-records.mts`, `scripts/drop-document.mts`, `scripts/hold-misread.mts`, `scripts/college-failures.mts`, `scripts/college-health.mts` |
| Wave 3 | `scripts/sync-visit-events.mts` (batching), a versions-retention job, `withTiming` on the admin routes |

Tests to add with each wave: the in-flight sharing and the per-request sharing (`tests/admin-inbox-reads.test.mts`),
the column list of the snapshot read (no `objects`), the `review_items` reads against the mini fixture, and a
`tests/timing.test.mts` case for the admin labels.

## As built

### The store (2026-11-10)
Wave 2's table landed with wave 1, as a **read model** rather than a move: the queue's documents stay the write path
and the version history, and `public.review_items` follows them by trigger
(`supabase/migrations/20261110120000_admin_speed.sql`; the details are in `data-platform/change-sets.md` "The review
queue's read model"). So no pipeline, script, or Steward tool changed, and the clusters are still computed in the
console (the Steward's `steward.clusters` document is left for later).
- **The migration:** the `data_documents (collection, updated_at desc)` index; the `review_items` table with four
  indexes, a select-for-everyone policy, and no write grant; `review_items_put` (the one row-writer, never raises),
  `review_items_date`, and the trigger function behind two triggers (`review_items_sync`,
  `review_items_sync_delete`); the backfill; `review_items_light(p_status)` and `review_items_counts()`.
- **The reads** (`lib/admin/review-queue.ts`): `readQueue` is one counts call (the cache key) plus, on a miss, one
  `review_items_light(null)` call in place of the 22 pages, and concurrent callers share the read in flight. The
  items carry no `extraction` (nothing that reads the whole queue uses it; Accept reads its items by key, and the
  Review page reads its college's whole items). New: `readQueueCounts`, `readCollegeQueueItems`,
  `readAcquisitionQueueItems`. `readTodo` and `readReviewRows` (lib/admin/steward-reads.ts) no longer read the whole
  queue; `collegesToReview` takes the clusters' items. Each falls back to the documents when the migration isn't
  applied.
- **Tested:** `tests/review-items.test.mts` (PGlite, 9 tests: the trigger on insert, resolution, delete and other
  collections; a malformed body warns and the write commits, with a guard that a raising sync would block it; the
  backfill equals the trigger; the two functions; no direct writes); `tests/admin-review-queue.test.mts` (9 tests:
  one RPC per read, two concurrent reads share one, the cache keyed on the newest write, the fallback, the narrow
  readers' queries, `LIGHT_FIELDS` equal to the migration's list); `tests/steward-review-rows.test.mts` (To do and
  Review never touch the whole queue; with and without the read model the pages agree). Measured on dev by the
  integrator.

### As built: U2 (reads), 2026-11-10

Wave 1's fixes 2, 6, 7, and 8, and the timing lines for the pages they touch. Nothing measured against the live
database yet (the integrator measures); the numbers below are wave counts read from the code.

- **The snapshot row, read small** (`lib/admin/data-reads.ts`). Every snapshot read selects `SNAPSHOT_COLUMNS`:
  `id, created_at, created_by, status, change_set_ids, previous_id, pointer_at, notes, colleges:manifest->colleges,
  layers:manifest->layers`, and `snapshotRow()` puts the two JSON paths back under `manifest`, so callers
  (`manifest.colleges` on the Inbox tile, the Data overview, Published versions) didn't change. The brief's
  `manifest->tables` is left out: a manifest has no `tables` key (`lib/data-platform/snapshot.ts SnapshotManifest`).
  The badge and the Inbox (`lastPublishAndWaiting`) read only these columns: ~1 KB instead of 446 KB.
- **The size, in Postgres.** The Data overview's Size and every row of Published versions show a snapshot's total
  bytes, which used to be summed from the `objects` map (446 KB a row; 50 rows on Versions). A small additive
  migration, `supabase/migrations/20261110130000_snapshot_bytes.sql`, adds `snapshot_bytes(data_snapshots)`, a
  PostgREST computed field (`bytes:snapshot_bytes`; `security invoker`, never raises on a malformed manifest),
  and those two reads (`lastPublishedSnapshot(…, { bytes: true })`, `loadSnapshots`) select it. Until the migration
  is applied they fall back to selecting `objects:manifest->objects` for the rows they show (the old cost, those two
  screens only), with one `console.warn` per instance; the badge never reads `objects` either way.
  `tests/snapshot-bytes.test.mts` (PGlite), `tests/admin-data.test.mts`.
- **`GET /api/snapshot`** (`app/api/snapshot/route.ts`): `{ "snapshot": "<id>" | null }` from `getSnapshotId()`, the
  same source as the `x-quad-snapshot` meta tag; `force-dynamic`, `Cache-Control: no-store`, no auth.
  `fetchEnvironmentSnapshot` asks it with a 2 s timeout; a non-200 or an answer that isn't that JSON (a deploy from
  before the endpoint) falls back once to the home page's meta tag (4 s, as before); a timeout or network error is
  "unknown" at once.
- **GitHub off the response path** (`lib/jobs/github-memo.ts latestGithubRuns`, free of Next and the GitHub client
  so a Server Action can import its reset; `lib/jobs/runs.ts loadJobsOverview` passes `listRuns` and `after()`).
  The newest run of each workflow, memoized
  per instance for `GITHUB_MEMO_MS` (60 s). The first call on a cold instance waits for GitHub, and concurrent first
  calls share that one fill; within the minute every call answers from the memo with no GitHub call; after it, the
  stale memo answers at once and one refresh is scheduled with `after()` (stale-while-revalidate), so no page waits on
  GitHub once the instance has an answer. A refresh never throws, and a workflow GitHub answered nothing for (listRuns
  answers an empty list on any failure) keeps the run the memo had, so a failed refresh keeps the old memo. The Jobs
  actions (`app/admin/steward/jobs/actions.ts`, Run now and the pull-request actions) call `resetJobsMemo()` before
  `refresh()`, so the re-rendered list shows the dispatched run; a refresh that started before the reset can't
  overwrite the newer answer (a generation counter). Other screens that dispatch workflows (Publish now, the Steward's
  actions) don't reset it: their runs show within a minute. A job's page and a run's page still ask GitHub for their
  detail. `tests/admin-jobs.test.mts`.
- **Fewer waves** (a wave is an `await` that waits on the one before; counted from the code, the admin check
  included; `tests/admin-waves.test.mts` reads the source):

  | Page | Before | After | How |
  |---|---|---|---|
  | A college | 7 | **2** | after the check, `adminCollege`, viewers, `historyInstalled` → history (chained inside), the documents, and the inputs in one `Promise.all`; none needs the college's record, so they start beside it |
  | A person | 12 (13 with the college-views record) | **5** (6) | `adminPerson`: the profile beside the eight account reads; then own memberships, lists, and the access log; then households, members, and list items; then one `namesFor` over every id beside the members' student records (it was ten waves; `withNames` twice and `accessFor`'s second names read are gone). The page reads college views, sign-in activity, and the organization beside `adminPerson` |
  | A student | ~16 (the page's 9 and the standing panel's ~6, in series, plus the grants) | **6** | the check; the access row (still first: nothing is read before it exists); then `adminStudent` (four waves: record, profile, lists, membership, snapshots, access log; items, tasks, household; notes, visits, offers, letters; one names read), `standingForStudent`, the organization grants, the dataset, and the attach search (when open) in one `Promise.all`. The record, profile, lists, items, and visits are `cache()`d readers in `lib/admin/people.ts` (`readStudent*`) that both use, so each runs once per request; their columns are the union of what both read (the items add the five hook columns; the page still shows only its own). The panel reads its household's home state in its first wave and builds the estimate's context beside the items |
  | A household | 5 (6 with the add search) | **3** | the household beside its members, invitations, and home; then one names read beside the students; the add search beside it all |

- **Timing lines** (`withTiming`, labels are route patterns): `/admin/data/colleges/[unit]`, `/admin/people/[user]`,
  `/admin/students/[id]`, `/admin/households/[id]`, `/admin/data`, `/admin/data/health`, `/admin/steward/jobs`
  (`serving-architecture.md` "Timing a request").

### As built: U3 (Inbox), 2026-11-10

Wave 1's fixes 3 (Findings), 4, and 5, and the timing lines for the three Steward screens. The Inbox's words, order,
links, and help ids are as they were (`admin-redesign.md` "The home: Steward › Inbox"). Nothing measured against the
live database yet (the integrator measures).

- **Shared reads** (`lib/admin/inbox-reads.ts`). Every read is a React `cache()`d, soft function with no arguments:
  the client (`adminSupabase`), the badge's seven (decisions, proposals, deletions, invitations, held changes,
  collisions, the last publish), and the page's others (To do, the runs, the jobs, people, organizations, the queue's
  counts, health). The layout's `needsYouCount` and the Inbox's panels render in the same request, so each source is
  read once and the client made once; a source that failed is null for every reader and isn't asked again in that
  request. The badge keeps its meaning: it awaits only the seven (`cheapInput`) and is null only when decisions,
  proposals, deletions, invitations, and held changes all failed. The invitations' seven-day cutoff is taken when the
  read starts, so the badge and the page share one read rather than each passing its own `now`.
- **Three loaders** in place of `loadInboxInput`: `loadNeedsYou` (the seven, To do, the jobs, and the runs for the
  empty line's "The Steward last looked at"), `loadStewardDid` (the runs), `loadHowThingsAre` (people, organizations,
  the last publish, the queue's counts, health, the jobs and the runs for their tiles). The queue tile reads
  `readQueueCounts` (`open`, `newWeek`), never the whole queue; To do reads the acquisition items only (U1). Until the
  read model's migration is applied, the counts are null and the tile says "Couldn't read" (the rest of the Inbox is
  unaffected); it no longer falls back to the 22-page read.
- **Streaming** (`app/admin/page.tsx`). The shell (the phone's search and the header) waits only on `connection()` and
  the admin check; "Needs you", "The Steward did", and "How things are" are async components, each under its own
  `<Suspense>` with its frame as the fallback (`components/admin/InboxSkeletons.tsx`: the same `Panel` title, id, help,
  and the "Every run" link; the tiles' heading and six frames at the tiles' heights, two across on a phone). Each
  streams when its reads finish; the jobs (GitHub, now behind U2's memo) hold only the panels that show them.
  `app/admin/loading.tsx` (`ConsolePageSkeleton`: a header and three panel frames) sits inside the layout, so the
  rail and tab bar stay and every console navigation paints a frame at once. The layout's guards (the 404, the
  second-factor step) run before it, so non-admins still get a real 404; the layout still awaits the badge (the seven
  cheap reads, ~1 KB snapshot row since U2) before the frame, and the Inbox's "Needs you" then answers from the same
  promises.
- **Findings** (`app/admin/steward/findings/page.tsx`) passes the clusters' items to `collegesToReview(client, { items })`,
  chained on `readClusters` inside the page's one `Promise.all`, so the queue is read once. **To do**
  (`app/admin/steward/todo/page.tsx`) reads the logins beside the lists instead of after them.
- **Timing lines.** `/admin/steward/findings` and `/admin/steward/todo` wrap the page's data work after the admin check
  (the Steward screens' test pins `connection()` and `requireAdmin()` as the page's first lines). The Inbox's panels
  render after the page function has returned, outside any timing the page could start, so each times its own loader:
  `/admin needs-you`, `/admin steward-did`, `/admin how-things-are` (three lines per Inbox load). The layout's badge
  isn't timed, so a round trip it started (the seven cheap reads) shows on no line; "Needs you"'s time still includes
  waiting for them.
- **Actions stay current:** the console's Server Actions already call `revalidatePath`/`refresh()`; the per-request
  memo can't outlive the request, so the badge and the panels re-read on the re-render.
- **Not done:** the spec's 30-second per-instance memo for the badge (fix 4's last sentence) was left out: with the
  snapshot row small and the reads shared, the badge's cost is the seven small reads in one wave.
- **Tested:** `tests/admin-inbox-reads.test.mts` (6 tests, every read a counting stand-in and `cache()` with React's
  per-request contract: the badge and the three panels in one request read each source once and make one client; the
  badge alone reads only the seven; a new request reads again; a failed source is shared, not retried, and the others
  answer; null counts are "Couldn't read", never the whole queue); `tests/admin-console-ui.test.mts` (`loading.tsx`
  and the skeletons read nothing; three `<Suspense>` boundaries in order with their fallbacks; the shell awaits only
  the admin check; each panel calls one loader under its label; the skeletons' titles, ids, and help match the panels;
  the seven badge reads are `cache()`d and the tile never calls `readQueue`; Findings passes the items);
  `tests/admin-waves.test.mts` (the Findings and To do labels; the Inbox's panel labels are `/admin` and a panel id
  on the page); `tests/admin-steward.test.mts` renders Findings and To do through a `withTiming` stand-in.
