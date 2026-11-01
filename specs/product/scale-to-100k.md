# Scale to 100k students: the audit, the load test, and the fixes it will surface

> Status: **planned** 2026-11-01 (owner: "over a million new students each year… my hope is that we can get to
> something like 10%, so about 100k students. I want to structure something that will scale to that number of users").
> Builds on [serving-architecture.md](../serving-architecture.md) (the public pages read an in-memory dataset),
> [data-platform/](../data-platform/README.md) (the dataset is a published snapshot; the database holds people's data),
> [launch-database.md](../launch-database.md) (a production project next to Vercel) and
> [telemetry.md](telemetry.md) (what is measured).

## The target, in numbers
100,000 accounts is the ambition. What that means for the system, using the usual shape of a planning site's traffic:

| Measure | Working figure | Why it matters |
|---|---|---|
| Accounts | 100,000 students, plus parents and counselors on many of them | Sizes the people's tables: plans, lists, timelines, essays, households |
| Active in a peak hour | 1–2 % of accounts, 1,000–2,000 people | Sizes concurrent requests |
| Requests at peak | 100–300 a second, most of them public pages | Sizes Vercel instances and the CDN |
| Writes at peak | A few plan edits a second; one view record per profile visit | Sizes the database's write path and the hot tables |
| Weekly digests | Up to 100,000 emails in one window | Sizes the email provider and the cron |

These are planning figures, not measurements; the load test below replaces them with real ones.

## What already scales, and why
- **Public pages never touch the database.** Profiles, Explore, Compare and the trends read the dataset the instance
  holds in memory from the bundled snapshot ([data-platform/publish.md](../data-platform/publish.md) "The loader");
  the only database read on a public page is the live edits overlay, one small query cached for 30 seconds per
  instance and failing open. Prerendered pages are served by the CDN. This scales with Vercel instances, and the
  dataset's storage format (JSON documents in Supabase) is nowhere on this path.
- **People's data is relational** with row-level security, one row per plan item, list item, essay, timeline entry.
  Postgres handles this volume on a small instance when the queries are indexed and the policies cheap, which is
  what the audit checks.
- **The estimate and the advisor** compute per request from the in-memory dataset and the student's plan: CPU-bound,
  milliseconds each, scaling with instances.
- **The pipelines and the publisher** run in GitHub Actions, off the user path; a publish reads about 60 MB a few times
  a day and never during a request.

## Where the risks are
Found by reading the code on 2026-11-01; each becomes an audit item below.

1. **Compute tier and region.** The one Supabase project is the free plan's Nano instance in Montréal, while the app's
   functions run in Washington: 15–25 ms per database call ([launch-database.md](../launch-database.md)). Every
   signed-in page pays that several times. The production project next to Vercel is already planned; this work makes
   its compute tier an explicit decision.
2. **Policies with subqueries.** About a dozen row-level policies use `exists (select … from lists … can_read_student(…))`
   to reach a student through a list or a plan. Correct, and fine at today's size; at 100,000 students each such
   policy runs per row scanned, so the tables behind them (`lists`, `list_items`, `plan_*`, `essays`) must have the
   indexes the planner needs, or a page that lists a student's items turns into a sequential scan.
3. **Indexes.** 71 indexes exist across the migrations, 21 of them on owner columns. Not every people's table has an
   index on the column its policies and queries filter by; the audit lists the gaps against a seeded 100k dataset.
4. **One write per profile view.** `POST /api/college-view` calls `record_college_view` for every profile page load,
   signed in or not ([college-views.md](college-views.md)). At 300 requests a second that is the busiest write path
   in the system, for an analytics purpose. It should be batched, sampled for signed-out visitors, or sent to the
   analytics service, keeping only the signed-in "colleges I looked at" records in Postgres.
5. **The other hot tables.** `visit_events` (151 MB after one archive) grows with every calendar sync, not with users,
   but its reads on the visit pages must stay indexed by college and date; `plan_opens` and `access_log` grow with use.
6. **Email volume.** The digests cron sends through Resend one message at a time. 100,000 digests in a window needs
   batching, a sending plan the provider allows, and a cron that resumes where it stopped.
7. **The dataset in memory per instance.** About 150–200 MB of heap per function instance for 1,893 colleges, loaded
   in about 300 ms from the bundled copy. Fine on Vercel's 1 GB functions; the audit records the real number so a
   larger dataset (every two-year college, say) is a known cost before it is added.
8. **Connections.** The app reaches Postgres through Supabase's REST layer (`@supabase/ssr`), which pools on the
   server side; only scripts open direct connections. No change expected, but the audit confirms no code path in
   `app/` or `lib/` opens a direct connection.

## The work
### 1. The audit (an afternoon, read-only)
- Every table a signed-in page reads: the query, the policy, the index it uses, from `explain (analyze, buffers)` on a
  seeded copy (below). Output: a table in this spec's "As built" section with one line per query and a verdict.
- Every write path a visitor can trigger (grep `insert`, `upsert`, `rpc` under `app/` outside the cron routes) with
  its rate at peak.
- The function instance's heap after the dataset loads, from the `[data] loaded …` log and `process.memoryUsage()`
  in a one-off route behind the admin.
- The email path's sending rate and the provider's limits.

### 2. The seeded copy and the load test
- A Supabase **branch** (or the planned production project before it has people) seeded with 100,000 students,
  150,000 guardians, their plans, lists and timelines in realistic proportions, by a script
  (`scripts/seed-scale.mts`, never pointed at a project with real people: it refuses a URL that is not a branch or an
  empty project).
- A load script (`k6` or `autocannon`, kept in `scripts/load/`) that plays the real mix against a Preview deployment
  pointed at the seeded copy: 70 % public pages, 20 % signed-in plan pages, 5 % Explore with filters, 5 % writes, at
  100, 200 and 300 requests a second for ten minutes each.
- What is recorded: p50 and p95 latency per route group, error rate, Postgres CPU and the slowest queries from
  `pg_stat_statements`, function cold-start count and heap. Output: a short report in `specs/product/scale-reports/`.

### 3. The fixes the audit and test will likely surface
Each is its own small PR, done only when the measurement says so, in this order of likelihood:
- Indexes the planner wanted (and the policies rewritten to use them, e.g. a `student_id` column denormalized onto
  `list_items` so the policy needs no join).
- Profile views: signed-out views sampled or sent to PostHog; signed-in views batched by the browser and written in
  one call per minute.
- The digest cron sending in batches with a cursor, under the provider's rate.
- The compute tier for the production project: start at Small, with the measured headroom written down.
- Anything the p95 shows: a plan page making N+1 reads, a bundle (`lib/bundles.ts`) that should load more in one call.

### 4. Guards, so it stays true
- A nightly or weekly **smoke load** (a tenth of the peak mix for two minutes against Preview) in a workflow, with
  the p95 recorded to the telemetry tables; a regression over a threshold opens an issue.
- The admin console's Operations page shows the last smoke run's p95 beside the data health, so the trend is visible.

## Owner decisions
1. **When to create the production project and at what compute tier** (Pro plan plus a Small compute add-on is the
   recommendation: about 40 dollars a month, with a read replica available later). The load test can run on a branch
   of the dev project first.
2. **Profile views for signed-out visitors**: keep writing them to Postgres (sampled), or send them to PostHog only.
3. **The target itself**: the load test's top rate (300 a second) assumes 1–2 % peak concurrency; say if the launch
   plan expects spikes (a press mention, a school-wide roll-out) and the top rate rises to match.

## Out of scope
Rewriting the college dataset into relational tables (its storage is off the request path; see "What already
scales"); a CDN or edge cache in front of the API beyond what Vercel does; the native apps' own caching (the roadmap's
"Native apps" group).

## Complexity
Moderate: the audit and the load test are a few days of work with no product change; the fixes are small and
measured. The main cost is the seeded copy and keeping the load script honest to the real traffic mix.
