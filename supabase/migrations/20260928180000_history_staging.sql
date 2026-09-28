-- Publish history in batches (specs/supabase.md). One publish_history() call with every shard (~13 MB once scores,
-- students, and outcomes were added) exceeds the API's statement timeout. Instead, `npm run publish-data` stages the
-- shards a batch at a time, then publish_history_staged() swaps them in with one short transaction, so readers still
-- never see a half-published history.

-- Written only by the publish script (secret key); nobody reads it through the API.
create table public.history_staging (
  unit_id    text primary key,
  data       json not null
);
alter table public.history_staging enable row level security;
grant all on public.history_staging to service_role;

-- Add a batch of shards to the staging table. p_reset clears it first (the first batch of a publish).
create function public.stage_history(p_schools json, p_reset boolean default false) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_schools) <> 'array' then
    raise exception 'stage_history: p_schools must be an array';
  end if;
  if p_reset then
    delete from public.history_staging where true;
  end if;
  insert into public.history_staging (unit_id, data)
  select e ->> 'unit_id', e from json_array_elements(p_schools) as t(e)
  on conflict (unit_id) do update set data = excluded.data;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Replace all history with what's staged, in one transaction, after checking every expected shard arrived.
-- Returns the number of shards published.
create function public.publish_history_staged(p_files json, p_expected integer) returns integer
language plpgsql
set search_path = ''
as $$
declare
  staged integer;
begin
  select count(*) into staged from public.history_staging;
  if staged <> p_expected then
    raise exception 'publish_history_staged: % shards staged, expected %', staged, p_expected;
  end if;
  if json_typeof(p_files) <> 'object' or p_files -> 'meta' is null or p_files -> 'national' is null
     or p_files -> 'facts' is null or p_files -> 'cpi' is null then
    raise exception 'publish_history_staged: p_files needs meta, national, facts and cpi';
  end if;

  delete from public.school_histories where true;
  insert into public.school_histories (unit_id, data) select unit_id, data from public.history_staging;

  delete from public.history_files where true;
  insert into public.history_files (name, data) select key, value from json_each(p_files);

  delete from public.history_staging where true;
  return staged;
end;
$$;

revoke execute on function public.stage_history(json, boolean) from public, anon, authenticated;
revoke execute on function public.publish_history_staged(json, integer) from public, anon, authenticated;
grant execute on function public.stage_history(json, boolean) to service_role;
grant execute on function public.publish_history_staged(json, integer) to service_role;
