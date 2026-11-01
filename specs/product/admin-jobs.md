# Admin console: Jobs

> Status: **built 2026-11-01** on `feature/admin-jobs`. Part of the [admin console](admin.md); the rail's **Jobs**
> section. Code: `lib/jobs/` (the table, the cron parser, the recorder, the reads, the view), `app/admin/jobs/**`,
> `components/admin/jobs/`, migration `20261101120000_job_runs.sql`. Tests: `tests/jobs.test.mts`,
> `tests/jobs-pages.test.mts`.

## Goal
The owner asked (2026-11-01) for one place that shows every batch job the site runs: what each does, its schedule,
when it runs next, and a history of past runs that opens into the details of any one. Before this, the schedules
lived in two files nobody reads from the console (`vercel.json` and the workflows' `on.schedule` lines), the GitHub
workflows' runs were visible only on Operations (the last 30 of the dispatchable ones, mixed together), and the Vercel
cron routes left no record at all beyond Vercel's own logs.

## The jobs
Two runners, one table (`lib/jobs/registry.ts` `JOBS`):

| Runner | Where | Schedule from | Runs from |
|---|---|---|---|
| **Vercel Cron** | a route under `app/api/cron/` | `vercel.json` `crons[]` | `job_runs` (below) |
| **GitHub Actions** | a workflow in `.github/workflows/` | the workflow's `on.schedule` crons | GitHub's REST API, as the console's App ([admin.md](admin.md#the-github-app-recommended-over-a-pat)) |

| Job | Runner | Schedule (UTC) | Note |
|---|---|---|---|
| Update digest | Vercel | every day 13:00 | nothing until email is configured |
| Visit alerts | Vercel | every day 13:00 | after the night's visit-events read |
| Interest confirmations | Vercel | every day 13:30 | |
| Weekly emails and texts | Vercel | Sundays 23:00 | |
| Day-before texts | Vercel | Monday to Saturday 23:00 | Sunday belongs to the weekly job |
| College-reported data | GitHub | Mondays 13:00 (Aug–Nov); the 1st 13:00 (Dec–Jul); every 30 min (collect) | the collect firing is housekeeping |
| Identity refresh | GitHub | every day 06:00 | does the refresh only when the last probe is 28+ days old |
| Visit events | GitHub | every day 07:00 | |
| Publish snapshot | GitHub | every day 08:00 | pipelines also start it (`repository_dispatch`) |
| Sync data | GitHub | Mondays 09:00 | on the schedule, the release-calendar check only |
| Sync history | GitHub | the 3rd 09:00 | |
| Common App, Coalition, Essay prompts, Reviewer eval, Campus-life pilot, High school profile pilot | GitHub | by hand only | listed so their history is one click away |

`verify.yml` is CI, not a batch job, and is left out. Each row names its spec and, when Operations can start it, the
row of `DISPATCHABLE_RUNS` that does.

**Held to the truth by tests**: `tests/jobs.test.mts` reads `vercel.json` and every workflow's `cron:` lines and
fails when the table and the files disagree in either direction (a cron added to a workflow with no job row; a job
row claiming a schedule the file doesn't have), when a job's spec path doesn't exist, or when its `dispatch` names no
row of the Operations table. A schedule changed in one place and not the other fails CI.

### Schedules
`lib/jobs/cron.ts` reads the five-field expressions both runners take, in UTC (both run in UTC): `*`, lists, ranges,
steps; weekday 7 is Sunday; when both day fields are restricted a time matches when either does (Vixie cron's rule,
which GitHub follows). `nextRun(schedule, from)` is the first firing strictly after `from`; `describeCron` puts the
site's schedules into words ("Every day at 13:00 UTC", "Monday to Saturday at 23:00 UTC", "The 3rd of every month at
09:00 UTC", "Every 30 minutes") and leaves anything it can't say as written.

A job's **next run** (`nextJobRun`) is the earliest next firing among its headline schedules that proceeds. Two kinds
of gate are modelled:
- **Months** (`schedule.months`): college-reported's Monday cron proceeds only August to November and its monthly cron
  only December to July (the workflow's "Check schedule window" step). The next run skips firings out of season.
- **Housekeeping** (`headline: false`): the half-hourly collect firing never counts as the job's next run, and the job
  page hides its runs by default.
A gate the console can't compute (identity refresh's "is a refresh due" check) is a sentence beside the schedule.

`scheduleOfRun(job, startedAt)` names which schedule fired a GitHub run from its start time (the schedule whose firing
fell in the twenty minutes before it; GitHub's schedules run minutes late), so a run's "Started by" can say
"Schedule: Mondays at 13:00 UTC" rather than just "Schedule".

## Run records
GitHub keeps every workflow run; Vercel keeps only logs. So the Vercel cron routes now record their own runs:
`lib/jobs/record.ts` `withJobRun(job, handler)` wraps each route's handler (`export const GET = recorded`), and writes
one row of `public.job_runs` per run with the secret key the routes already hold:

| Column | Meaning |
|---|---|
| `job` | the table's id (`digests`, `weekly`…) |
| `trigger` | `schedule` when Vercel Cron called (its `vercel-cron/` user agent), else `manual` |
| `status` | `running` while it goes; then `ok`, `failed` (a 4xx/5xx answer, or a throw), or `skipped` (the route answered `configured: false`: nothing it could do) |
| `started_at`, `finished_at`, `duration_ms`, `http_status` | timing and the answer's status |
| `summary` | the route's own JSON answer (counts: sent, errors, publishes…), so the console shows what a run did without a second place to keep it; capped at 100 KB |
| `error` | the answer's `error`, or the thrown message |

Rules, each proven in `tests/jobs.test.mts`: the bearer check comes first and an unauthorized call leaves no row; a
database that can't be reached is logged and the job runs anyway; a handler that throws is recorded failed and
answered with a 500; rows older than 180 days are deleted as a job records a new run (no purge job of its own).
Admins read the table through the console (the same "Admins read" policy as `admin_log`); nobody else reads; the
secret key is the only writer. Nothing personal goes in: the routes answer with counts and ids.

## The pages
All three call `requireAdmin()` first, then read; a non-admin is a 404 before anything is read.

### The list: `/admin/jobs`
Every job, soonest next run first, then the hand-run ones by name. Columns: the job (name; runner under it), its
headline schedules in words with the gate sentence, the next run (UTC, and "in 3 h"), and the last run (outcome chip,
when, how long). Without GitHub credentials the GitHub jobs show no runs and the page says why; the schedules still
show. The last runs come from one `job_runs` query (the newest 60 rows, first per job) and one GitHub call per
workflow (its newest run), in parallel.

### A job: `/admin/jobs/[job]`
What it does; where it runs (the route or the workflow); the next run; how to start it by hand (Operations' Start a
run when there is a row, else GitHub's Run workflow, else `POST` the route with the cron secret); its spec. Then each
schedule: words, the cron, its note, and its own next firing (the gated schedules show their next in-season firing).
Then **History**, the last 30 runs newest first:
- a Vercel job: outcome, trigger, started, duration, and the summary's counts in one line ("consents 12 · sent 3 ·
  errors 0"); a failed run's error under its chip. A table that can't be read (the migration not applied) says so.
- a GitHub job: outcome, what started it (the schedule by name, "Asked by a pipeline" for `repository_dispatch`, the
  console or a GitHub account for a dispatch), started, duration. Housekeeping firings are hidden with a count and a
  "Show them" link (`?all=1`); when hiding, the page reads 100 runs so the visible 30 aren't crowded out.

### A run: `/admin/jobs/[job]/runs/[run]`
- A Vercel run: its row in full: outcome, who started it, started, finished, duration, HTTP status; the error in a
  block; the summary as key and value (nested values as stored). Read under its job (`job = … and id = …`), so a run
  id of another job is a 404.
- A GitHub run: outcome, what started it, timing, branch, and "Open on GitHub"; then **Steps**: each job of the run
  with its outcome and duration, and every step with its number, outcome, and duration (`GET
  /actions/runs/{id}/jobs?filter=latest`); then **Change sets written**: the `data_change_sets` rows whose `run_ref`
  is this run id, each linking to `/admin/data/change-sets/[id]`. A run that isn't this job's workflow is a 404.

## Files
| File | What |
|---|---|
| `lib/jobs/cron.ts` | the parser, `nextRun`, `describeCron` (pure) |
| `lib/jobs/registry.ts` | `JOBS`, `jobById`, `nextJobRun`, `nextScheduleRun`, `scheduleOfRun` (pure) |
| `lib/jobs/record.ts` | `withJobRun`, `supabaseRecorder`, `outcomeOf`, `triggerOf` (plain module, recorder injectable) |
| `lib/jobs/runs.ts` | server reads: `job_runs` through `adminSupabase()`, GitHub through `lib/github-app.ts`, change sets by `run_ref` |
| `lib/jobs/view.ts` | `relativeLabel`, `summaryLine`, `storedOutcome`, `sortJobs`, URLs (pure) |
| `lib/github-app.ts` | adds `getRun(runId)` and `runJobs(runId)` (jobs and steps) |
| `app/api/cron/*/route.ts` | each handler wrapped: `const recorded = withJobRun("<id>", run); export const GET = recorded; export const POST = recorded;` |
| `app/admin/jobs/page.tsx`, `[job]/page.tsx`, `[job]/runs/[run]/page.tsx` | the three pages |
| `components/admin/jobs/JobsTable.tsx`, `JobRunsTable.tsx` | the list's table; the two history tables and `githubStartedBy` |
| `supabase/migrations/20261101120000_job_runs.sql` | the table, its index, the admin read policy |
| `lib/admin/console.ts` | the **Jobs** rail section (`/admin/jobs`) |

## Owner steps
1. Apply `supabase/migrations/20261101120000_job_runs.sql` to the dev project (and to prod at the release). Until it
   is applied, the Vercel jobs still run (the recorder logs "not recording" and moves on) and a job's page says the
   table can't be read.
2. Nothing else: the schedules come from the files already deployed, and the GitHub runs use the App Operations
   already has.

## Open questions
- A **Run now** button for the Vercel jobs (a Server Action that `POST`s the route with `CRON_SECRET`, logged like a
  dispatch) would round this out; left for the owner to ask for, since the request was visibility.
- The console landing page could carry a "Jobs" tile (the newest failed run, if any). Not built.
- Vercel's own cron logs (the function logs) aren't read here; a run that never reached the route (a Vercel outage)
  leaves no row and shows only as a gap in the history.
