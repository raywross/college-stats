# Serving the Dataset From the Deploy: Deployment, Database, and Search

> Status: **planned** 2026-10-07, from the owner's review of deployment failures, database outages, and slow search.
> Decides the open question in [database-architecture.md](database-architecture.md#serving-the-public-dataset-an-open-decision)
> and reshapes [supabase.md](supabase.md)'s serving path. Keeps [data-layer.md](data-layer.md)'s in-memory query
> layer. Platform work ([backlog](backlog.md#platform)).

## The question
The owner's review (2026-10-07) raised four things: deploys fail often; the database "crashes"; the school search is
slow and it isn't clear whether that's the browser or the server; and a suspicion that the design is wrong, that
"when we deploy we take a ton of data from Supabase and store it at Vercel", that every search runs on a server that
has to warm up a big in-memory file, and that a client-server shape with small Supabase calls would be better.

This spec answers in two parts: what is actually happening (measured and cited), and what to change. The short
version: **the in-memory query layer is the right design for this dataset and stays; the way the data reaches it,
and the way search reaches the data, are wrong for a serverless host and change.**

## Verdict in short
| Owner's point | Finding | Verdict |
|---|---|---|
| "We take a ton of data from Supabase and store it at Vercel" | Yes, twice over. Production runs with `DATA_SOURCE=supabase`, so the **build** downloads the whole dataset from Supabase to prerender 50 profiles, the home page, `/data`, and the trends pages, and then **every new function instance** downloads it again on its first request: about 9 sequential requests moving 16.7 MB, parsed into about 57 MB of heap. The same 16.7 MB is already in the deploy (git has it; `outputFileTracingIncludes` ships it with every function). The copy from Supabase is redundant | **Change.** The deploy carries the dataset; production reads it from disk like CI and Preview already do |
| "Deploys fail" | Every merge that touches `data/**` starts a Vercel build *and* a publish Action at the same moment. The publish deletes and re-inserts the whole `schools` table; the build's reads hit Postgres's statement timeout mid-swap (#80 failed this way; the Action now retries once after 60 s and the reader waits up to a minute). GitHub has also dropped push events twice, skipping deploys | **Change.** With the data in the deploy there is no publish of the dataset and no race. The Action shrinks to writing the small change log the digest needs |
| "The database crashes" | The live site reads the **dev** project: Supabase's free plan, a Nano instance (0.5 GB RAM, shared CPU), a 3-second statement timeout for public reads, 5 GB of egress a month, and automatic pausing after seven days of low activity. Each cold instance pulls 16.7 MB through it; each publish pushes about 100 MB through it (colleges, history, details, high schools, two full read-backs). The high-school search already hit the 3-second limit once when the table was cold | **Change.** Supabase stops serving the dataset and holds only people's data and the searchable tables. The public pages then work even while the project is paused or busy; the free plan stays ([owner decision](#owner-decisions-2026-10-07)) |
| "Search is slow" | Both search boxes go to the server on every keystroke. The header typeahead calls `/api/schools` after 120 ms; that function calls `getData()`, which in Supabase mode runs a version query against Supabase before every answer and, on a cold instance, the full 9-request download first. Explore's text filter is worse: it pushes a new URL every 250 ms, and each one is a full server render of `/explore` that recomputes about 50 facet passes and a sources note over every matched college. The matching itself costs 2–4 ms | **Change.** Search runs in the browser over a small index built at deploy time (about 200 KB, a quarter of that gzipped). Zero server work per keystroke. Explore's render gets its facets cached |
| "Vercel shuts instances down and we pay the warm-up again" | Right in substance. Vercel's Fluid compute reuses instances and caches bytecode, but instances still start cold after idleness or on scale-up, and a cold start here is the Supabase download, not the JavaScript. Reading the same files from the function's own disk takes about 300 ms (measured: 81 ms read, 217 ms parse) | **Change the cost, keep the model.** After the change a cold start is 300 ms of local parse; later phases can cut that further if measured cold starts justify it |
| "Should it be client-server, with small calls to Supabase?" | For **people's data**, yes, and it already is (row-level security, one query per page). For **high schools** (35,000 rows), yes, and it already is (a trigram-indexed table). For the **college dataset**, no: Explore, Compare, ranks, medians, similar colleges, and every citation need all 1,893 rows at once; it is 17 MB that changes monthly; it is a static asset, not a live table | **Defend.** Keep the in-memory layer. Put the asset where static assets go: in the deploy |

## Owner decisions (2026-10-07)
From the owner's review of the first draft:
- **Stay on the free plans** of Vercel and Supabase for now. The changes here take the pressure off; upgrading later
  makes a sound design stronger rather than propping up a weak one. The spec's owner steps assume the free plans and
  the existing dev project; [when to upgrade](#2-supabase-holds-peoples-data-and-the-searchable-tables) is stated as
  a trigger, not a date.
- **The deploy failures were all cleared by redeploying.** That matches the race diagnosis: a second build with no
  publish running beside it reads a settled table. Nothing was wrong with the code.
- **The search symptom**: no matches at all, then, about a minute later, fast and responsive. That is the cold path
  exactly. The first keystrokes reach a function instance that has no dataset yet; it starts the nine-request
  download from Supabase, waits through statement-timeout retries if the database is busy or waking from a pause,
  and the browser's request is aborted by the next keystroke or returns an error, which the search box shows as an
  empty list (`searchSchoolsApi` returns `[]` on any failure). A minute later the instance holds the data in memory
  and every search is a 2–4 ms scan. Phase 1 removes the download; phase 2 removes the server from the keystroke
  path altogether, so the first letter typed is as fast as the hundredth.

## How it works today
Facts, with where they live. Measured 2026-10-07 unless cited.

**Data path.**
- `data/schools.json` is 16.7 MB (1,893 colleges, about 8.8 KB each); `data/aliases.json` 422 KB (4,079 rows);
  `data/history/` 28 MB (one shard per college plus shared files and 1.6 MB of trend files); `data/detail/` 19 MB;
  `data/high-schools/` 35 MB in 51 state shards. The specs still say 3.6 MB and 8 MB ([supabase.md](supabase.md),
  [database-architecture.md](database-architecture.md)); both are stale.
- `lib/data.ts` loads the dataset lazily on the first `getData()` per server instance and holds it
  (`lib/dataset-loader.ts`). In `json` mode it reads the four files with `fs` (81 ms) and parses them (217 ms,
  about 55 MB of heap) once, and never checks again. In `supabase` mode it pages `schools` 1,000 rows at a time
  (2 requests), reads `dataset_files` (1), pages `school_aliases` (5), and checks the publish version before and
  after (1): **about 9 sequential HTTP requests per cold instance**, then the same parse. After that, **every call
  to `getData()` runs one version query** against Supabase before answering (`fetchPublishedVersion`), and
  `getHistoryFiles()` runs a second; that is every `/explore`, `/compare/*`, `/api/schools`, `/trends/movers`,
  `/schools/[id]/history`, and `/l/[token]` request.
- Per-college history, detail, and trend files are read per request with no cross-request cache: from disk in
  `json` mode, one Supabase row (and a new client object) each in `supabase` mode. `/trends/states/[state]`
  refetches the 804 KB states file at each regeneration.
- Production (`college-stats-nine.vercel.app`) runs `DATA_SOURCE=supabase` against the **dev** project; Preview and
  CI run `json` ([supabase.md](supabase.md#current-state-pre-release-dev-only)).

**Deploy path.**
- A merge to `main` triggers a Vercel production build through the GitHub integration (no workflow drives it). With
  `DATA_SOURCE=supabase`, `next build` prerenders `/`, `/data`, the 50 most-applied-to profiles, and every
  `/trends/*` page **from Supabase**, so the build process downloads the dataset too.
- A merge that touches `data/**` also triggers `.github/workflows/publish-data.yml`, which runs
  `scripts/publish-data.mts` against prod: a lineage check, a full read of the published dataset to diff changes,
  13 staging calls of 150 colleges, a swap that deletes and re-inserts the `schools` table in one transaction, a
  second full read-back and byte compare, then history (28 MB), details (19 MB), aliases, and high schools (35 MB)
  written in batches **into the live tables, not atomically** (accepted 2026-10-02 after the atomic swaps hit the
  statement timeout), each read back again, then a POST to `/api/revalidate`.
- The two run at once. The build's reads can time out while the swap holds the table (#80, 2026-10-05); the
  publish's statements can time out under the build's reads. Fixes so far: the reader waits up to about a minute
  on a statement timeout, the Action retries once after 60 s, and a second job revalidates after every production
  deploy to close the "deploy race" ([supabase.md](supabase.md#revalidation)). Push events dropped by GitHub have
  skipped deploys twice ([release note #17](../release-notes/verify-by-hand.md), [#30](../release-notes/publish-error-message.md)).
- `next.config.ts` traces about 64 MB of data files into **every** server function (`data/*.json` including
  working files the app never reads, such as the 3.7 MB site probe; all of history; all of details) and does not
  trace `data/high-schools/`, so a `json`-mode deployment (Preview) may find no high-school files.

**Search path.**
- Header and home typeahead: `components/search/SchoolSearch.tsx` → after 120 ms → `GET /api/schools?q=` →
  `getData()` (version query; cold load on a new instance) → `searchSchools`, a linear scan with the alias scorer
  (`lib/aliases.ts`; 2–4 ms measured) → JSON with `Cache-Control: public, max-age=300` (browser only; no
  `s-maxage`, so Vercel's CDN doesn't keep it). The compare picker does the same with `limit=10`. Nothing about
  search ships to the browser.
- Explore's text box: `components/explore/Toolbar.tsx` → after 250 ms → `router.push('/explore?q=…')` → a full
  dynamic render: `getData()`, `getSchools(filters)`, `buildFacets` (about 50 passes over all colleges, not cached
  across requests), and a `MultiSourceNote` that walks every matched college × about 48 fields.
- So "slow" is the server, not the browser: on a warm instance in `json` mode a keystroke costs a function
  invocation and a few milliseconds; in `supabase` mode it costs that plus a Supabase round trip; on a cold instance
  it costs the whole download first. The user sees the cold case as a one- to several-second stall on the first
  letters, and the warm case as a visible lag on every letter.

**Hosting facts that matter** (vendor documentation, 2026-10-07).
- Vercel: Fluid compute is the default; one instance serves many requests concurrently; bytecode caching is on for
  Node 20+ and cuts cold starts by up to 60%; functions run with 2 GB on Hobby and by default on Pro; a production
  instance is archived after two weeks idle; Pro's "Scale to One" keeps one instance warm. Cold starts still occur
  on scale-up and after idleness, so **what a cold start does** is what matters.
- Supabase: the Free plan is a Nano instance (0.5 GB RAM, shared CPU) with 5 GB egress a month, pausing after seven
  days of low database activity; the Data API's default statement timeout is 3 s for the public (`anon`) role and
  8 s for signed-in users; Pro is $25 a month with a Micro instance (1 GB), daily backups, and no pausing.

## The client-server alternative, weighed
Moving the college queries into SQL would mean: rewriting the 600 lines of `lib/dataset.ts` plus `lib/insights.ts`
(ranks, medians, distributions, facets, similar colleges, the "standouts") and the lineage helpers as SQL or RPCs;
three to eight round trips per page from Vercel's region to Supabase's (20–80 ms each, more when the instance is a
Nano); the same cold start for the function itself; and a database that becomes the single point of failure for
public pages that today need nothing but a file. It would make Explore slower, not faster, and it would move the
load onto the weakest component in the system. Per-row reads are right for per-user data and for tables too big to
hold (high schools now, programs later, as [database-architecture.md](database-architecture.md#limits-of-the-in-memory-pattern)
already says); they are wrong for a 17 MB read-mostly dataset that every page slices differently.

What *is* right in the owner's instinct is the direction for search (do the work near the user) and for the data
source (don't fetch over the network what you already have). The design below does both.

## Design

### 1. The deploy carries the dataset
Production runs `DATA_SOURCE=json`, the mode CI and Preview already use and the code path `tests/supabase.test.mts`
already covers ("JSON loads once and is never checked").
- `getData()` reads the files from the function's own disk once per instance (about 300 ms) and never queries a
  version. The per-request Supabase round trip on every dynamic page disappears, and so does the second one for
  history files.
- A data change is live when its deploy is: the merge builds the site with the new files, and prerendered pages are
  built from them. **There is no publish step for the dataset, so there is no deploy race, no revalidation after
  deploy, and no mid-swap timeout.** `/api/revalidate` and the `revalidate = 86400` fallbacks stay (harmless, and
  useful by hand); the `revalidate-after-deploy` job goes.
- `lib/data.ts` and `lib/dataset-loader.ts` keep the `supabase` branch for now (local comparison, rollback), marked
  deprecated; it is removed with the tables in phase 4.
- **Rollback** is the same switch in the other direction: set `DATA_SOURCE=supabase` in Vercel and redeploy, as long
  as the tables still hold a current publish (phase 4 waits a full release cycle for that reason).

### 2. Supabase holds people's data and the searchable tables
| Stays in Supabase | Why |
|---|---|
| Auth, households, student profiles, lists, follows, notification prefs, digests, the planner's tables | Per-user, written by users, row-level security |
| `high_schools`, `high_school_files`, `search_high_schools()` | 35,000 rows searched by trigram; already a real table |
| `dataset_publishes`, `dataset_changes` | The digest's record of what changed and when ([follow-colleges.md](product/follow-colleges.md#the-digest)); small, indexed, read per profile for the What changed panel |

| Leaves the serving path | Replaced by |
|---|---|
| `schools`, `dataset_files`, `school_aliases` | the files in the deploy |
| `school_histories`, `history_files` (incl. trend rows), `school_details` | the files in the deploy, read per profile from disk |
| `publish_dataset`, `stage_schools`, `publish_schools_staged*`, `stage_history`, `publish_history*`, `stage_details`, `publish_details_staged`, `publish_aliases` | nothing |

**The publish Action becomes the change log.** `publish-data.yml` keeps its triggers but `scripts/publish-data.mts`
splits:
- `scripts/publish-changes.mts` (new, small): computes the change record by diffing `data/schools.json` at the
  merge commit against the previous `dataset_publishes.git_commit` (both read from git with `git show`, **no network
  read of the old dataset**), stages and writes `dataset_changes` in one transaction with a `dataset_publishes` row,
  as `publish_schools_staged_with_changes` does today minus the schools. The digest job and the What changed panel
  keep working unchanged. Runs after the deploy succeeds (`deployment_status`), so a change is never announced
  before the site shows it; a dropped push event means a missing digest line, not a broken site.
- `scripts/publish-high-schools.mts` (existing code, now its own command): the high-school table publish, run when
  `data/high-schools/**` changes.
- `publish-data` itself is retired with the tables (phase 4). Until then it still works for the `supabase` fallback.

**Plan and project.** The free plan and the existing dev project stay (owner decision). What that means after the
change:
- The free plan's limits stop touching the public site. Egress falls from 17 MB per cold instance to a few kilobytes
  per signed-in request; the 3-second public statement timeout applies only to the high-school search (already
  indexed) and the What changed panel (one indexed query, fail-soft); a **paused project no longer takes the site
  down**: every college page, Explore, Compare, trends, and search work from the deploy, and only sign-in, lists,
  and the planner wait for the project to wake (about a minute, or sooner if the daily digest cron's query keeps it
  active).
- A Nano instance is enough for the per-user queries the site makes today.
- **Upgrade triggers**, to revisit rather than decide now: the formal release (daily backups of real households are
  worth $25 a month on their own); a week in which the pause actually hits a signed-in user; the planner's texts
  and nudges going live (writes from a cron every day); or the Supabase dashboard showing memory pressure during the
  high-school publish. The prod project comes with the formal release as the backlog already says.

### 3. Search in the browser
A **search index** is built at deploy time and shipped as a static file; the browser fetches it once and matches
locally with the same scorer the server uses today.
- **Build step** `scripts/build-search-index.mts`, run from `prebuild` (and `npm run verify` checks it's current):
  writes `public/search/index-<hash>.json` and `lib/search-index.generated.ts` exporting the file name. One entry
  per college: `id, name, city, state, type, acceptance, applicants, brand (two colors or null), keys (the alias keys
  and the normalized name, from lib/aliases.ts)`. About 1,893 × 100 bytes ≈ 200 KB; roughly 50 KB gzipped, served
  immutable from the CDN with `Cache-Control: public, max-age=31536000, immutable` (the hash changes with the data).
- **Client** `lib/search-client.ts`: fetches the index on first focus of a search box (or on idle after load for the
  header), keeps it in module memory, and runs `scoreSchool` / `compareMatches` from `lib/aliases.ts` (pure
  functions; the file loses nothing by being imported on the client). Results are instant; typing never calls a
  function. `SchoolSearch` and `CompareHeader` switch to it; `useSchoolEntries(ids)` resolves from the index too, so
  the compare tray stops calling `/api/schools?ids=` on every page.
- **`/api/schools` stays one release** for anything not yet migrated, then is removed. Its handler no longer pays a
  version query once production is in `json` mode anyway.
- **Explore's text filter** keeps its meaning (narrow the grid) and its URL (shareable), but the typing path
  changes: the client filters the *visible* result list against the index while typing and pushes the URL once on
  pause (600 ms) or Enter, so a word costs one render, not four. The server render itself gets cheaper
  ([section 5](#5-explore-render-cost)).
- The index is public data only (name, place, type, admit rate, applicants, brand colors): nothing a profile page
  doesn't already show, and no lineage is lost because the index is a navigation aid, not a displayed figure. The
  `SourceNote` rules don't apply to a typeahead row, as today.

### 4. Fewer bytes per function
`outputFileTracingIncludes` lists what the runtime reads, nothing else:
```
"/*": [
  "./data/schools.json", "./data/meta.json", "./data/release-calendar.json", "./data/aliases.json",
  "./data/history/**/*.json", "./data/detail/**/*.json", "./data/high-schools/**/*.json",
  "./data/directories/organizations.json", "./data/reference/zcta-centroids.csv"
]
```
That drops about 10 MB of working files (`site-probe.json`, `review-queue.json`, `link-issues.json`, `wikidata.json`,
brand files) and adds the high-school shards that `json` mode needs. A guard test reads `next.config.ts` and
`lib/` and fails when a `data/` path the code reads isn't traced, or a traced path isn't read. The high-school store
also stops loading all 51 shards for a stateless search: in `json` mode it reads a small name index built by the same
prebuild step, and in production high schools stay on their table anyway.

### 5. Explore render cost
`/explore` stays a server-rendered dynamic page (its URL is the filter state, and that is right). Three changes make
each render cheap enough that typing and filtering feel immediate on a warm instance:
- `buildFacets` moves into `lib/dataset.ts` behind the same per-dataset memo as `metricValues`: computed once per
  instance for the unfiltered set, and per request only the counts that depend on the filter.
- `MultiSourceNote` for Explore takes the metric set, not the matched colleges: the sources behind a metric are the
  same for every college except overrides, so the note is computed from `meta` plus the set of override sources
  present in the dataset (a per-dataset memo), not by walking 1,893 × 48 fields per request.
- The `aliasKey(query)` normalization moves out of the per-college loop in `scoreSchool` (it is recomputed 1,893
  times per search today).
Target: under 30 ms server time for an unfiltered `/explore` on a warm instance, measured in the test with a
fixture dataset.

### 6. Cold starts: measure, then decide
The change above makes a cold start "read 17 MB from local disk and parse it", about 300 ms, plus Next's own start,
which bytecode caching already shortens. That is acceptable. Two cheap things make it visible:
- `instrumentation.ts` logs one line per instance start with the dataset load time, and the Vercel runtime log's
  "start type" field says whether a request was cold. A weekly look at those two answers "how many cold starts,
  how slow" with no telemetry dependency.
- If cold starts turn out frequent on a Hobby plan, Pro's Scale to One is the switch; if the 300 ms itself matters,
  the later options below apply.

### 7. Later options, with their triggers
Not built now; listed so the next step is a decision, not a search.
| Option | When |
|---|---|
| **Precomputed derived files** at build (sorted metric arrays, similar-college ids per college, the home lenses) so a profile render reads one shard and one small file instead of parsing all 1,893 colleges | if measured cold renders of profiles exceed about a second at p95 |
| **A lighter index for list pages** (the `SchoolIndexEntry` fields plus the filter facets) so Explore parses 2 MB instead of 17 | same trigger, for Explore |
| **Cache Components** (`cacheComponents: true`, `'use cache'` on Explore's result list keyed by its params, `cacheLife('days')`) so repeated filter combinations are served from Next's cache | after the Next 16 migration is otherwise settled; it changes rendering defaults and needs its own pass |
| **One gzipped object per collection in Storage** (the old option 2) | never, now: the deploy already carries the files |

## What the owner sees afterwards
- A data merge deploys and is live when Vercel says so; nothing else has to succeed. No publish retries, no
  revalidation jobs, no mid-swap failures.
- Search results appear as fast as the user types, on first load as well as later; the compare picker likewise.
- Supabase's dashboard shows user queries and the high-school search, nothing else; egress is a fraction of today's;
  a pause is impossible on Pro.
- The build no longer needs Supabase at all: a Supabase outage can't fail a deploy, and a deploy can't hurt Supabase.
- A paused or slow Supabase project leaves every public page, and search, untouched; only signed-in features wait.

## Measurement
Before the change (one week, from Vercel's logs and Supabase's reports) and after each phase:
| Measure | How |
|---|---|
| Cold starts per day and cold `getData()` time | runtime logs: start type, the instrumentation line |
| `/api/schools` p50 and p95 (phase 2 removes it; the browser-side time replaces it: index fetch size and time, match time) | runtime logs; a `performance.measure` in `search-client.ts` reported through telemetry when it exists |
| `/explore` server time, warm | runtime logs; the fixture test |
| Build duration and failures | Vercel deployments; the Actions tab |
| Supabase egress, CPU, memory, statement timeouts | Supabase reports |
| Publish Action duration and failures | the Actions tab (should become seconds, then disappear) |

## Phases
```
1. Switch production to the deploy      ─► 2. Search in the browser  ─► 3. Explore render cost
   (env change, tracing fix, change-log       (index build, client,          (facets memo, sources memo,
    Action, Pro plan + prod project)           Explore typing)                 scorer fix)
                                                                       ─► 4. Retire the dataset tables and the
                                                                            supabase data branch (one cycle later)
```
Phase 1 is one PR plus owner steps and removes the failures; it changes no page. Phase 2 removes the slowness.
Phase 3 is a follow-up measured by the fixture test. Phase 4 is cleanup after a full data cycle has run on the new
path.

## Files (planned)
- Phase 1: `next.config.ts` (tracing list), `tests/tracing.test.mts` (the guard), `scripts/publish-changes.mts` +
  `tests/publish-changes.test.mts` (diff from two git blobs, one transaction, idempotent on re-run),
  `.github/workflows/publish-data.yml` (change log after deploy; high schools on their path; the revalidate job
  removed), `instrumentation.ts`, `specs/supabase.md` and `specs/database-architecture.md` updated to the new
  shape, `specs/migration-plan.md` corrected.
- Phase 2: `scripts/build-search-index.mts`, `lib/search-index.ts` (shape, builder, pure), `lib/search-client.ts`,
  `components/search/SchoolSearch.tsx`, `components/compare/CompareHeader.tsx`, `lib/school-api.ts` (index-backed),
  `components/explore/Toolbar.tsx`, `tests/search-index.test.mts` (every college present; keys match the server
  scorer; size under 300 KB; the generated file name matches the hash).
- Phase 3: `lib/dataset.ts` (facets and sources memos), `lib/aliases.ts`, `tests/explore-cost.test.mts`.
- Phase 4: a migration that drops the dataset tables and functions; `lib/data.ts` without the `supabase` branch;
  `scripts/publish-data.mts` removed; `tests/supabase.test.mts` reduced to the loader.

## Owner steps (phase 1)
Free plans, existing dev project (owner decision 2026-10-07).
1. Vercel, Production environment: set `DATA_SOURCE=json`. Leave `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` as they
   are (the app still needs them for accounts and high schools) and keep `REVALIDATE_SECRET` if set.
2. GitHub secrets: `PROD_SUPABASE_URL` and `PROD_SUPABASE_SECRET_KEY` pointing at the dev project, so the change-log
   Action can write `dataset_changes` (today it skips because they're unset, which is why the update emails have
   nothing to say); the `PROD_REVALIDATE_*` pair becomes unused.
3. Redeploy `main` once by hand (Vercel → Redeploy) so the first production build runs in `json` mode. Check
   `/explore`, a profile, and the search box; then check that signing in still works.
4. Nothing to do in Supabase. The dataset tables keep their last publish until phase 4 drops them.

## Risks
- **Function size.** Each function already carries about 64 MB of data; the tracing fix makes it about 62 MB plus
  35 MB of high-school shards. Vercel's limit is 250 MB uncompressed per function; Fluid compute consolidates routes
  into few functions, so the cost is paid once per deploy, not per route. If size ever bites, the high-school shards
  are the first to leave (they're a table in production already).
- **Build-time memory.** Prerendering reads the dataset once per build worker, as today; measured parse is 55 MB.
  Fine.
- **A stale digest** if the change-log Action fails: a missed email, nothing on the site. It retries like today.
- **The `supabase` branch rots** between phases 1 and 4; it is covered by tests until removed.
- **Cold starts remain**, at about 300 ms of local parse plus Next's own start. Vercel's Hobby plan has no Scale to
  One, so a quiet site will still start cold for its first visitor of the hour; the difference is that the cold
  start no longer depends on Supabase, and search no longer waits for it at all. If the 300 ms shows up in the
  measurements, the precomputed files in [section 7](#7-later-options-with-their-triggers) are the next step, not a
  plan change.

## Open questions for the owner
Answered 2026-10-07 and recorded [above](#owner-decisions-2026-10-07): what the failures looked like (deploys fixed
by redeploying; search empty, then fast a minute later) and the plans (stay free). Still open:
1. **Regions.** Which region the Vercel project and the Supabase project run in. If they differ, every signed-in
   query pays the distance; it is worth knowing before the prod project is created at the formal release, since a
   project's region can't be changed afterwards.
2. Keep `/api/revalidate`? Recommendation: yes, unused in the normal path, handy by hand; it costs nothing.
