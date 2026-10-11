-- The season accuracy summary (specs/chances/calibration.md "The accuracy summary"): aggregates only, written by
-- scripts/chances-calibration.mts with the secret key and read by the Data page ("How well Quad's estimate did").
-- No row-level data: counts, shares' intervals, and the sharers' mix. Additive. Apply after
-- 20261011100000_application_snapshots.sql (SQL Editor, dev first, then prod). Tested in
-- tests/chances-snapshot-policies.test.mts and tests/chances-calibration.test.mts.
--
-- Rows of one run (season × model version):
--   scope 'all'      one row, group and band null: every shared outcome that season, with the sharers' mix.
--   scope 'estimate' group × admit-rate band, by the estimate's group.
--   scope 'student'  group × admit-rate band, by the student's own group, for outcomes where the student changed it.
-- admitted and the interval are null when a cell has too few outcomes to report ("not enough outcomes yet").

create table public.chances_summary (
  id               bigint generated always as identity primary key,
  season           integer not null check (season between 2020 and 2100),
  model_version    text not null check (model_version ~ '^[A-Za-z0-9._:-]{1,40}$'),
  scope            text not null check (scope in ('all', 'estimate', 'student')),
  estimate_group   text check (estimate_group in ('reach', 'target', 'likely')),
  rate_band        text check (rate_band in ('lt20', '20-35', '35-50', '50-70', '70+')),
  n                integer not null check (n >= 0),
  admitted         integer check (admitted between 0 and n),
  interval_low     numeric(4, 3) check (interval_low between 0 and 1),
  interval_high    numeric(4, 3) check (interval_high between 0 and 1),
  sharers_mix      jsonb check (sharers_mix is null or jsonb_typeof(sharers_mix) = 'object'),
  next_summary_on  date,
  created_at       timestamptz not null default now(),
  constraint chances_summary_cell_shape check (
    (scope = 'all' and estimate_group is null and rate_band is null)
    or (scope <> 'all' and estimate_group is not null and rate_band is not null and sharers_mix is null)
  ),
  constraint chances_summary_interval_shape check (
    (admitted is null and interval_low is null and interval_high is null)
    or (admitted is not null and interval_low is not null and interval_high is not null and interval_low <= interval_high)
  ),
  constraint chances_summary_one_cell unique nulls not distinct (season, model_version, scope, estimate_group, rate_band)
);

create index chances_summary_season_idx on public.chances_summary (season desc);

alter table public.chances_summary enable row level security;

-- Public: anyone reads it (the Data page reads with the publishable key). Only the service role writes.
create policy "Chances summary is public" on public.chances_summary for select to anon, authenticated using (true);

revoke all on public.chances_summary from public, anon, authenticated;
grant select on public.chances_summary to anon, authenticated;
grant all on public.chances_summary to service_role;
