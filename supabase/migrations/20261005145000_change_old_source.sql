-- old_source on the change record (specs/product/follow-colleges.md, "Years and kinds"): when a figure's new value
-- comes from a different kind of source than the old one (a college's Common Data Set replaced by College Scorecard
-- for the same fall), the change is "updated" and the sentence names both sources. Separate from
-- 20261005140000_follows.sql so a project that already applied that one only needs this. Safe to run twice.

alter table public.dataset_changes add column if not exists old_source text;
alter table public.dataset_change_staging add column if not exists old_source text;

create or replace function public.stage_dataset_changes(p_changes json, p_reset boolean default false) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_changes) <> 'array' then
    raise exception 'stage_dataset_changes: p_changes must be an array';
  end if;
  if p_reset then
    delete from public.dataset_change_staging where true;
  end if;
  insert into public.dataset_change_staging (unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release)
  select e ->> 'unit_id', e ->> 'field', e ->> 'kind',
         case when json_typeof(e -> 'old_value') in ('null') or e -> 'old_value' is null then null else e -> 'old_value' end,
         case when json_typeof(e -> 'new_value') in ('null') or e -> 'new_value' is null then null else e -> 'new_value' end,
         e ->> 'old_year', e ->> 'new_year', e ->> 'source', e ->> 'old_source', e ->> 'release'
  from json_array_elements(p_changes) as t(e);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.publish_schools_staged_with_changes(
  p_meta json,
  p_release_calendar json,
  p_expected integer,
  p_expected_changes integer,
  p_git_commit text default null,
  p_published_by text default null
) returns json
language plpgsql
set search_path = ''
as $$
declare
  v_schools integer;
  v_publish bigint;
  v_staged integer;
  v_changes integer;
begin
  select count(*) into v_staged from public.dataset_change_staging;
  if v_staged <> p_expected_changes then
    raise exception 'publish_schools_staged_with_changes: % changes staged, expected %', v_staged, p_expected_changes;
  end if;

  v_schools := public.publish_schools_staged(p_meta, p_release_calendar, p_expected, p_git_commit, p_published_by);
  select max(id) into v_publish from public.dataset_publishes where published_at = now();

  insert into public.dataset_changes (publish_id, published_at, unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release)
  select v_publish, now(), unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release
  from public.dataset_change_staging;
  get diagnostics v_changes = row_count;

  delete from public.dataset_change_staging where true;
  return json_build_object('schools', v_schools, 'publish_id', v_publish, 'changes', v_changes);
end;
$$;

-- create or replace keeps existing grants; restated so this file also stands alone.
revoke execute on function public.stage_dataset_changes(json, boolean) from public, anon, authenticated;
revoke execute on function public.publish_schools_staged_with_changes(json, json, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.stage_dataset_changes(json, boolean) to service_role;
grant execute on function public.publish_schools_staged_with_changes(json, json, integer, integer, text, text) to service_role;
