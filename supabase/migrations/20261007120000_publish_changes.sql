-- The change log without the dataset (specs/serving-architecture.md section 2; specs/product/follow-colleges.md).
-- The deploy carries the dataset now, so a publish no longer uploads colleges: `npm run publish-changes`
-- (scripts/publish-changes.mts) diffs data/schools.json between the last recorded commit and the deployed one (both
-- read from git), stages the changes with stage_dataset_changes() (20261005145000_change_old_source.sql, unchanged),
-- and calls publish_changes() below, which records the publish and moves the staged changes into dataset_changes in
-- one transaction.
--
-- Safe to re-run: when a publish with the same git commit is already recorded (a retried Action, a redeploy of the
-- same commit), it returns that publish with "reused": true, clears the staging table, and writes nothing else.
--
-- Requires 20260928000000_dataset.sql (dataset_publishes), 20261005140000_follows.sql and
-- 20261005145000_change_old_source.sql. Apply in the Supabase SQL Editor before the first run of the
-- "Publish changes" Action. Tested in tests/follows-policies.test.mts.

create function public.publish_changes(
  p_school_count integer,
  p_retrieved date,
  p_git_commit text,
  p_published_by text,
  p_expected_changes integer
) returns json
language plpgsql
set search_path = ''
as $$
declare
  v_publish bigint;
  v_published_at timestamptz;
  v_staged integer;
  v_changes integer;
begin
  if p_git_commit is null or p_git_commit = '' then
    raise exception 'publish_changes: p_git_commit is required (a re-run is recognized by its commit)';
  end if;

  -- One publish at a time, so two runs for the same commit can't both miss the check below. Released at commit.
  lock table public.dataset_publishes in share row exclusive mode;

  select id into v_publish from public.dataset_publishes where git_commit = p_git_commit order by id limit 1;
  if v_publish is not null then
    delete from public.dataset_change_staging where true;
    select count(*) into v_changes from public.dataset_changes where publish_id = v_publish;
    return json_build_object('publish_id', v_publish, 'changes', v_changes, 'reused', true);
  end if;

  select count(*) into v_staged from public.dataset_change_staging;
  if v_staged <> p_expected_changes then
    raise exception 'publish_changes: % changes staged, expected %', v_staged, p_expected_changes;
  end if;

  insert into public.dataset_publishes (school_count, retrieved, git_commit, published_by)
  values (p_school_count, p_retrieved, p_git_commit, p_published_by)
  returning id, published_at into v_publish, v_published_at;

  insert into public.dataset_changes (publish_id, published_at, unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release)
  select v_publish, v_published_at, unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release
  from public.dataset_change_staging;
  get diagnostics v_changes = row_count;

  delete from public.dataset_change_staging where true;
  return json_build_object('publish_id', v_publish, 'changes', v_changes, 'reused', false);
end;
$$;

revoke execute on function public.publish_changes(integer, date, text, text, integer) from public, anon, authenticated;
grant execute on function public.publish_changes(integer, date, text, text, integer) to service_role;
