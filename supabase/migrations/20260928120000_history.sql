-- Year-by-year history (specs/trends-data.md): the same content as data/history/, uploaded by
-- `npm run publish-data` alongside the snapshot. One row per college shard, plus the shared files.
-- `json`, not `jsonb`, for the same reason as the dataset: rows must read back exactly as written.

-- data/history/schools/{unit_id}.json
create table public.school_histories (
  unit_id    text primary key,                 -- IPEDS unit ID (matches public.schools, but a shard may exist alone)
  data       json not null,                    -- one SchoolHistory (lib/history.ts), verbatim
  published_at timestamptz not null default now()
);

-- data/history/{meta,national,facts,cpi}.json
create table public.history_files (
  name       text primary key check (name in ('meta', 'national', 'facts', 'cpi')),
  data       json not null,
  published_at timestamptz not null default now()
);

alter table public.school_histories enable row level security;
alter table public.history_files enable row level security;

create policy "History is public" on public.school_histories for select to anon, authenticated using (true);
create policy "History is public" on public.history_files for select to anon, authenticated using (true);

grant select on public.school_histories, public.history_files to anon, authenticated;
grant all on public.school_histories, public.history_files to service_role;

-- Replace all history in one transaction, so readers never see shards from one build with national figures from
-- another, and shards removed from git disappear. Returns the number of shards written.
create function public.publish_history(
  p_schools json,
  p_files json
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_schools) <> 'array' then
    raise exception 'publish_history: p_schools must be an array';
  end if;
  if json_typeof(p_files) <> 'object' or p_files -> 'meta' is null or p_files -> 'national' is null
     or p_files -> 'facts' is null or p_files -> 'cpi' is null then
    raise exception 'publish_history: p_files needs meta, national, facts and cpi';
  end if;

  delete from public.school_histories where true;
  insert into public.school_histories (unit_id, data)
  select e ->> 'unit_id', e from json_array_elements(p_schools) as t(e);
  get diagnostics n = row_count;

  delete from public.history_files where true;
  insert into public.history_files (name, data)
  select key, value from json_each(p_files);

  return n;
end;
$$;

revoke execute on function public.publish_history(json, json) from public, anon, authenticated;
grant execute on function public.publish_history(json, json) to service_role;
