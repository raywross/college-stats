-- Publish the dataset in batches (specs/supabase.md#publishing). With wave 2, data/schools.json grew past 11 MB and one
-- publish_dataset() call, which parses the whole file as one argument, exceeded the API's statement timeout (2026-10-02).
-- Like history and detail files: stage_schools() takes the colleges in batches, then publish_schools_staged() swaps them
-- in with the meta and release calendar in one transaction, so readers never see half a publish. publish_dataset()
-- stays for older checkouts of publish-data.

create table public.school_staging (
  unit_id    text primary key,
  position   integer not null,                 -- order in data/schools.json, kept so reads come back in file order
  name       text not null,
  state      text,
  data       json not null
);

-- Written only by the publish script (secret key); nobody reads it through the API.
alter table public.school_staging enable row level security;
grant all on public.school_staging to service_role;

-- Add a batch of colleges, starting at p_offset in data/schools.json. p_reset clears the staging table first.
create function public.stage_schools(p_schools json, p_offset integer, p_reset boolean default false) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_schools) <> 'array' then
    raise exception 'stage_schools: p_schools must be an array';
  end if;
  if p_reset then
    delete from public.school_staging where true;
  end if;
  insert into public.school_staging (unit_id, position, name, state, data)
  select e ->> 'unit_id', p_offset + (ord - 1)::integer, e ->> 'name', e -> 'location' ->> 'state', e
  from json_array_elements(p_schools) with ordinality as t(e, ord)
  on conflict (unit_id) do update set position = excluded.position, name = excluded.name, state = excluded.state, data = excluded.data;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Replace every college with what's staged, plus meta and the release calendar, in one transaction, after checking
-- every expected college arrived. Records the publish like publish_dataset() does.
create function public.publish_schools_staged(
  p_meta json,
  p_release_calendar json,
  p_expected integer,
  p_git_commit text default null,
  p_published_by text default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  staged integer;
begin
  select count(*) into staged from public.school_staging;
  if staged <> p_expected or staged = 0 then
    raise exception 'publish_schools_staged: % colleges staged, expected %', staged, p_expected;
  end if;

  delete from public.schools where true;
  insert into public.schools (unit_id, position, name, state, data)
  select unit_id, position, name, state, data from public.school_staging;

  insert into public.dataset_files (name, data)
  values ('meta', p_meta), ('release_calendar', p_release_calendar)
  on conflict (name) do update set data = excluded.data, published_at = now();

  insert into public.dataset_publishes (school_count, retrieved, git_commit, published_by)
  values (staged, (p_meta ->> 'retrieved')::date, p_git_commit, p_published_by);

  delete from public.school_staging where true;
  return staged;
end;
$$;

revoke execute on function public.stage_schools(json, integer, boolean) from public, anon, authenticated;
revoke execute on function public.publish_schools_staged(json, json, integer, text, text) from public, anon, authenticated;
grant execute on function public.stage_schools(json, integer, boolean) to service_role;
grant execute on function public.publish_schools_staged(json, json, integer, text, text) to service_role;
