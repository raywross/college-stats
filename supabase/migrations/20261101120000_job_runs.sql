-- Run records for the Vercel cron jobs (specs/product/admin-jobs.md "Run records"): one row per run of a route under
-- app/api/cron/, written by lib/jobs/record.ts with the secret key (the routes already hold it) and read by the admin
-- console's Jobs pages. GitHub's workflow runs aren't here: the console reads those from GitHub.
--
-- * `summary` is the route's own JSON answer (counts: sent, errors, publishes…), so the console can show what a run
--   did without a second place to keep it. Nothing personal goes in: the routes answer with counts and ids only.
-- * Admins read through the console (the same "Admins read" policy as admin_log); nobody else reads, and the only
--   writer is the secret key. The recorder deletes rows older than 180 days as it goes.

create table public.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null check (job ~ '^[a-z][a-z0-9-]{0,40}$'),
  trigger     text not null check (trigger in ('schedule', 'manual')),
  status      text not null default 'running' check (status in ('running', 'ok', 'failed', 'skipped')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  http_status integer,
  summary     jsonb not null default '{}'::jsonb,
  error       text
);

create index job_runs_job_started on public.job_runs (job, started_at desc);
create index job_runs_started on public.job_runs (started_at);

alter table public.job_runs enable row level security;

create policy "Admins read" on public.job_runs for select to authenticated using ((select public.admin_reads()));

grant select on public.job_runs to authenticated;
revoke all on public.job_runs from anon;
grant all on public.job_runs to service_role;
