-- The nightly visit-events run's weekly retries of unreachable hosts, counted apart (specs/product/visit-events.md,
-- "Keeping it running", point 1, note of 2026-11-01). The run-level guard that withholds miss-marking when more than
-- 20% of the hosts tried failed now leaves those retries out: a host already known to be down says nothing about the
-- markup. The two counts let the admin card explain a night's failed total ("637 failed, 630 of them weekly retries").

alter table public.visit_event_sync
  add column hosts_retried integer not null default 0,
  add column retries_failed integer not null default 0;
