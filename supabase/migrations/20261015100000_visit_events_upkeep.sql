-- Visit events, keeping it running (specs/product/visit-events.md, "Keeping it running"; owner 2026-10-15: not a one-time
-- pull). The bookkeeping the guards, the weekly discovery, and the admin card read:
-- * slate_hosts.last_attempt: when the host was last tried (last_read says when it last answered), so an unreachable
--   host is retried on a schedule rather than "on Sundays"; search_total: the search's own "returned N" the last time it
--   answered; zero_since: when its search first came back empty (a month of that makes the host `no_events`).
-- * visit_event_sync: how many hosts failed or collapsed (a search that parsed to nothing it had rows for), whether the
--   run's miss-marking was withheld by the run-level guard, and the data check's summary written by check:visit-events.

alter table public.slate_hosts
  add column last_attempt timestamptz,
  add column search_total integer,
  add column zero_since timestamptz;

alter table public.visit_event_sync
  add column hosts_failed integer not null default 0,
  add column hosts_collapsed integer not null default 0,
  add column misses_withheld boolean not null default false,
  add column check_failures integer,
  add column check_warnings integer,
  add column check_summary jsonb;

create index slate_hosts_status_idx on public.slate_hosts (status, last_attempt);
