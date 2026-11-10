-- A snapshot's total object size, computed in Postgres (specs/product/admin-speed.md "As built: U2").
--
-- The console's snapshot reads (lib/admin/data-reads.ts SNAPSHOT_COLUMNS) select the manifest's small parts by JSON
-- path and never its `objects` map (one entry per object; 446 KB a row since lineage shards). The Size the Data
-- overview and the Published versions list show is the sum of those entries' `bytes`, which this function computes
-- next to the data. It is a PostgREST computed field: `select=…,bytes:snapshot_bytes`. Not named data_*: that prefix
-- is the pipelines' service-role-only functions (tests/data-platform-policies.test.mts); this one answers every reader.
--
-- Additive and idempotent; safe before or after the code deploys (the code falls back to reading `objects` for the
-- rows it shows when the function is missing). Never raises on a malformed manifest: a non-object `objects`, or an
-- entry whose `bytes` isn't a number, counts as zero.
create or replace function public.snapshot_bytes(s public.data_snapshots)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when jsonb_typeof(o.value -> 'bytes') = 'number' then (o.value ->> 'bytes')::numeric else 0 end), 0)::bigint
  from jsonb_each(case when jsonb_typeof(s.manifest -> 'objects') = 'object' then s.manifest -> 'objects' else '{}'::jsonb end) as o
$$;

revoke all on function public.snapshot_bytes(public.data_snapshots) from public;
grant execute on function public.snapshot_bytes(public.data_snapshots) to anon, authenticated, service_role;
