-- Per-college detail files (lib/detail.ts; specs/data-expansion/majors.md#store-and-the-detail-file): tables too big
-- for the snapshot (home states now; majors and earnings by major later), the same content as
-- data/detail/schools/{unit_id}.json. Uploaded by `npm run publish-data` like history: staged in batches, then swapped in
-- with one transaction, so readers never see half a publish. `json`, not `jsonb`, so rows read back exactly as written.

create table public.school_details (
  unit_id    text primary key,                 -- IPEDS unit ID
  data       json not null,                    -- one SchoolDetail (lib/detail.ts), verbatim
  published_at timestamptz not null default now()
);

-- Written only by the publish script (secret key); nobody reads it through the API.
create table public.detail_staging (
  unit_id    text primary key,
  data       json not null
);

alter table public.school_details enable row level security;
alter table public.detail_staging enable row level security;

create policy "Details are public" on public.school_details for select to anon, authenticated using (true);

grant select on public.school_details to anon, authenticated;
grant all on public.school_details, public.detail_staging to service_role;

-- Add a batch of detail files to the staging table. p_reset clears it first (the first batch of a publish).
create function public.stage_details(p_details json, p_reset boolean default false) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_details) <> 'array' then
    raise exception 'stage_details: p_details must be an array';
  end if;
  if p_reset then
    delete from public.detail_staging where true;
  end if;
  insert into public.detail_staging (unit_id, data)
  select e ->> 'unit_id', e from json_array_elements(p_details) as t(e)
  on conflict (unit_id) do update set data = excluded.data;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Replace every detail file with what's staged, in one transaction, after checking every expected file arrived.
create function public.publish_details_staged(p_expected integer) returns integer
language plpgsql
set search_path = ''
as $$
declare
  staged integer;
begin
  select count(*) into staged from public.detail_staging;
  if staged <> p_expected then
    raise exception 'publish_details_staged: % files staged, expected %', staged, p_expected;
  end if;
  delete from public.school_details where true;
  insert into public.school_details (unit_id, data) select unit_id, data from public.detail_staging;
  delete from public.detail_staging where true;
  return staged;
end;
$$;

revoke execute on function public.stage_details(json, boolean) from public, anon, authenticated;
revoke execute on function public.publish_details_staged(integer) from public, anon, authenticated;
grant execute on function public.stage_details(json, boolean) to service_role;
grant execute on function public.publish_details_staged(integer) to service_role;
