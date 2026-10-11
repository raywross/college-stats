-- Pooled school course lists (specs/chances/course-plan.md "The school's course list" 2, "Data"): for each high school,
-- how many distinct students have listed each AP or IB course, so the course plan can suggest only courses the
-- student's school offers when the school has no profile of its own. A student's list lives in
-- student_profiles.data.academics.courses (one JSON document per student); a trigger keeps the counts in step with
-- every write to it. Additive. Apply in the SQL Editor (dev first, then prod), after 20261005130000_student_profiles.sql.
-- Tested against real Postgres (PGlite) in tests/chances-course-counts-policies.test.mts.
--
-- What is kept and what is shown:
--   * The table holds a high school id, a course key, and a count. No student id, no name, no grade, no date.
--   * Nobody reads the table: no policy, no grant. The only way out is school_course_list(), a security-definer
--     function that returns course keys for one school and only those at least three distinct students have listed.
--     It never returns a count, so a count below three is never observable, and it names no student.
--   * Only courses with a catalog key count (ap_..., ib_...): a typed name (dual enrollment, honors) is a student's own
--     words and is never pooled. A planned course counts like a taken one; the pool answers "what do students here
--     list", and a course planned by three students is one the school offers or is about to.
--   * A student counts once per course however many rows they list, and moves with them when they change school.

create table public.school_course_counts (
  high_school_id text not null check (high_school_id ~ '^[A-Za-z0-9_-]{1,20}$'),
  course_key     text not null check (course_key ~ '^(ap|ib)_[a-z0-9_]{1,60}$'),
  students       integer not null check (students >= 0),
  primary key (high_school_id, course_key)
);

alter table public.school_course_counts enable row level security;
-- No policies: row-level security denies every role but the table owner and the service role.
revoke all on public.school_course_counts from public, anon, authenticated;
grant all on public.school_course_counts to service_role;

-- The (high school, course key) pairs one profile document contributes: its linked school and each distinct catalog
-- key among its AP and IB course rows. Anything malformed contributes nothing.
create or replace function public.profile_course_keys(p_data jsonb)
returns table (high_school_id text, course_key text)
language sql
immutable
set search_path = ''
as $$
  select distinct school.id, course.key
  from (select p_data -> 'basics' ->> 'highSchoolId' as id) school,
       lateral (
         select c ->> 'key' as key
         from jsonb_array_elements(
           case when jsonb_typeof(p_data -> 'academics' -> 'courses') = 'array' then p_data -> 'academics' -> 'courses' else '[]'::jsonb end
         ) as c
         where jsonb_typeof(c) = 'object'
           and c ->> 'kind' in ('ap', 'ib_hl', 'ib_sl')
       ) course
  where school.id ~ '^[A-Za-z0-9_-]{1,20}$'
    and course.key ~ '^(ap|ib)_[a-z0-9_]{1,60}$';
$$;

-- Keeps the counts in step with student_profiles: on a write, subtract what the old document contributed that the new
-- one doesn't, and add what the new one contributes that the old one didn't.
create or replace function public.school_course_counts_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_data jsonb := '{}'::jsonb;
  new_data jsonb := '{}'::jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then old_data := old.data; end if;
  if tg_op in ('INSERT', 'UPDATE') then new_data := new.data; end if;

  update public.school_course_counts c
     set students = c.students - 1
    from public.profile_course_keys(old_data) o
   where c.high_school_id = o.high_school_id
     and c.course_key = o.course_key
     and not exists (
       select 1 from public.profile_course_keys(new_data) n
        where n.high_school_id = o.high_school_id and n.course_key = o.course_key
     );

  insert into public.school_course_counts as c (high_school_id, course_key, students)
  select n.high_school_id, n.course_key, 1
    from public.profile_course_keys(new_data) n
   where not exists (
     select 1 from public.profile_course_keys(old_data) o
      where o.high_school_id = n.high_school_id and o.course_key = n.course_key
   )
  on conflict (high_school_id, course_key) do update set students = c.students + 1;

  delete from public.school_course_counts where students <= 0;
  return null;
end;
$$;

revoke all on function public.school_course_counts_apply() from public, anon, authenticated;

create trigger student_profiles_course_counts
  after insert or update of data or delete on public.student_profiles
  for each row execute function public.school_course_counts_apply();

-- Backfill from the profiles that already exist.
insert into public.school_course_counts (high_school_id, course_key, students)
select k.high_school_id, k.course_key, count(*)
  from public.student_profiles p, lateral public.profile_course_keys(p.data) k
 group by k.high_school_id, k.course_key
on conflict (high_school_id, course_key) do update set students = excluded.students;

-- The only way to read the pool: course keys at least three distinct students at the school have listed.
-- The threshold lives here and nowhere else; the function returns keys only, never a count.
create or replace function public.school_course_list(p_high_school_id text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.course_key
    from public.school_course_counts c
   where c.high_school_id = p_high_school_id
     and c.students >= 3
   order by c.course_key;
$$;

revoke all on function public.school_course_list(text) from public;
grant execute on function public.school_course_list(text) to anon, authenticated, service_role;
