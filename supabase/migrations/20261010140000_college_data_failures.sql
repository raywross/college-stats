-- Colleges where the college-reported pipeline failed, one row per college and reason code, kept for research
-- (specs/college-data-failures.md). The rows are generated from the pipeline's committed state by
-- `npm run college-failures` (data/college-failures.json, committed with each data PR) and loaded after each
-- production deploy by `npm run publish-college-failures` (.github/workflows/publish-changes.yml) with the secret key:
-- rows in the file are upserted (resolved_at cleared), rows no longer in the file get resolved_at set. Nothing is
-- deleted, so a resolved failure stays queryable.
--
-- Service role only: row-level security is on with no policies, and anon/authenticated hold no privileges.
-- Apply in the Supabase SQL Editor (dev first). Tested in tests/college-failures.test.mts.

create table public.college_data_failures (
  unit_id text not null,
  name text not null,
  reason_code text not null check (reason_code in (
    'no_document_found', 'class_profile_only', 'class_profile_no_figures', 'robots_disallowed', 'host_blocked',
    'unreachable', 'edition_too_old', 'not_newer', 'edition_unknown', 'never_read', 'failed_checks',
    'read_no_values', 'malformed_url', 'discovery_error'
  )),
  stage text not null check (stage in ('discovery', 'fetch', 'read', 'checks')),
  detail text not null,
  url text,
  edition text,
  -- failed_checks: the check ids that held values, most frequent first.
  checks text[] not null default '{}',
  -- Newest pipeline evidence for the row (attempt, fetch, archive or review-queue date), and its run id when known.
  last_run date not null,
  run text,
  -- First and newest generation of data/college-failures.json that listed the row.
  first_seen date not null,
  last_seen date not null,
  -- Set by the load when the row is no longer in the file; cleared if it comes back.
  resolved_at timestamptz,
  loaded_at timestamptz not null default now(),
  primary key (unit_id, reason_code)
);

create index college_data_failures_reason_code_idx on public.college_data_failures (reason_code);
create index college_data_failures_open_idx on public.college_data_failures (reason_code) where resolved_at is null;

alter table public.college_data_failures enable row level security;

revoke all on table public.college_data_failures from public, anon, authenticated;
grant select, insert, update, delete on table public.college_data_failures to service_role;
