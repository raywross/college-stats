-- One high school's rows in one call (specs/serving-architecture.md round 4; specs/product/high-school-data.md
-- "Supabase"): the estimate's context read the school's row, its profile detail, and then, when the
-- detail has no AP list, the pooled course list, in up to two waves (`high_schools 51 ‖ high_school_details 95 …
-- rpc school_course_list 58` on /advisor). Additive. Apply after 20261011120000_school_course_counts.sql (SQL Editor,
-- dev first, then prod). Until it is applied, lib/high-schools.ts reads the three as before (lib/bundle-read.ts
-- isMissingFunction). Tested against real Postgres (PGlite + the auth stub) in tests/high-school-bundle.test.mts:
-- the same answer as the three reads, for anon and a signed-in user.
--
-- Security invoker: the tables' public read policies decide the two rows exactly as the table reads did, and the
-- course list goes through school_course_list() (security definer, the three-student threshold), which anon and
-- authenticated may already call. The function only shapes.
--
--   { school:  high_schools.data, or null,
--     detail:  high_school_details.data, or null,
--     courses: school_course_list(p_id) as an array (possibly empty), or null when the detail has an AP list }
--
-- `json`, not `jsonb`: the documents are stored as `json` so they read back exactly as written, key order included
-- (20261005180000_high_schools.sql), and json_build_object() keeps them verbatim where jsonb would reorder them.
create or replace function public.high_school_bundle(p_id text) returns json
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (select h.data from public.high_schools h where h.id = p_id),
       d as (select x.data from public.high_school_details x where x.id = p_id)
  select json_build_object(
    'school', (select s.data from s),
    'detail', (select d.data from d),
    'courses', case
      when coalesce((select json_typeof(d.data -> 'ap_courses') = 'array' and json_array_length(d.data -> 'ap_courses') > 0 from d), false)
        then null
      else coalesce((select json_agg(k.key order by k.key) from public.school_course_list(p_id) as k(key)), '[]'::json)
    end
  );
$$;

revoke all on function public.high_school_bundle(text) from public;
grant execute on function public.high_school_bundle(text) to anon, authenticated, service_role;
