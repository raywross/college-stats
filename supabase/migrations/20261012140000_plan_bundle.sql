-- Batched reads and the profile write for the plan (U20 "real speed"; specs/serving-architecture.md "Timing a
-- request"). Each Supabase call from Vercel is a network round trip (about 20 ms from iad1 to ca-central-1, about
-- 40 ms from a laptop), and the plan page and the intake's save made them in long chains: the account, then the
-- student record, then the students and memberships, then each household's roster, then the lists, the profile and
-- the home, then the list, then its items and tasks, then their visits, offers and nudges. These three functions
-- return what one path needs in one call:
--   viewer_bundle()                 who is signed in and what they can see: the account, the students and memberships,
--                                   the households with their rosters, the students' profiles, the household home
--   plan_bundle(p_student, p_list)  one student's plan: the student row, the list (their default unless one is
--                                   named), its items, tasks, visits, offers, and nudges
--   save_student_profile(p_student, p_data)
--                                   the profile upsert plus the grad-year sync saveProfile() makes afterwards, in one
--                                   transaction (the sync stays best-effort: it never fails the save)
--
-- All three are SECURITY INVOKER: every row comes through the same row-level security as the per-table reads they
-- replace, so a caller sees and writes exactly what they could before (tests/plan-bundle-policies.test.mts compares
-- them with the per-table reads for a student, an editing guardian, a view-only guardian, and an outsider). They
-- return the same columns, in the same order, as lib/auth.ts, lib/households.ts, lib/student-profile-store.ts,
-- lib/home-store.ts, and lib/planner/read-plan.ts select. The app falls back to the per-table reads while these
-- don't exist (lib/bundles.ts), so the code deploys before this is applied. Additive; apply to dev, then prod.

/* ------------------------------------------------------------------ */
/* viewer_bundle()                                                      */
/* ------------------------------------------------------------------ */

create function public.viewer_bundle() returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (
      select to_jsonb(p) from (
        select id, display_name, birth_year, role_hint, created, updated, deleted_at
        from public.profiles where id = auth.uid()
      ) p
    ),
    'students', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created, s.id) from (
        select id, user_id, display_name, grad_year, managed_by, created, deleted_at
        from public.students where deleted_at is null
      ) s
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created, m.id) from (
        select id, household_id, user_id, student_id, role, status, invited_email, can_edit, created, accepted_at
        from public.household_members
      ) m
    ), '[]'::jsonb),
    'households', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'name', h.name,
          'created', h.created,
          'members', coalesce((
            select jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality)
            from public.household_roster(h.id) with ordinality r
          ), '[]'::jsonb)
        )
        order by h.created
      )
      from public.households h where h.deleted_at is null
    ), '[]'::jsonb),
    'student_profiles', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', sp.student_id, 'data', sp.data) order by sp.student_id)
      from public.student_profiles sp
    ), '[]'::jsonb),
    'home', (
      select to_jsonb(hh) from (
        select household_id, lat, lng, label, place, zip, set_by, set_by_name, updated_at
        from public.household_homes where household_id = public.my_household()
      ) hh
    )
  )
$$;

/* ------------------------------------------------------------------ */
/* plan_bundle(p_student, p_list)                                       */
/* ------------------------------------------------------------------ */

-- p_list named: that list, and its student. Else p_student's default list (is_default first, then the oldest, as
-- lib/planner/load.ts picks it), p_student null meaning the caller's own student record. A list the caller can't read
-- comes back as null, like readPlan().
create function public.plan_bundle(p_student uuid default null, p_list uuid default null) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_student uuid := p_student;
  v_list uuid := p_list;
begin
  if v_list is not null then
    select l.student_id into v_student from public.lists l where l.id = v_list;
  elsif v_student is null then
    select s.id into v_student from public.students s where s.user_id = auth.uid() and s.deleted_at is null limit 1;
  end if;
  if v_list is null and v_student is not null then
    select l.id into v_list from public.lists l where l.student_id = v_student order by l.is_default desc, l.created limit 1;
  end if;
  return jsonb_build_object(
    'student', (
      select to_jsonb(s) from (
        select id, user_id, display_name, grad_year, managed_by, created, deleted_at
        from public.students where id = v_student and deleted_at is null
      ) s
    ),
    'list', (
      select to_jsonb(l) from (
        select id, student_id, user_id, name, is_default, share_enabled, created_by, created, sort, rounds_plan_accepted_at
        from public.lists where id = v_list
      ) l
    ),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.position) from (
        select id, list_id, unit_id, category, status, outcome, round, position, added_by, added_at, decision_date,
          deadline_text, deadline_date, enrolling, updates, visited_on, follows_social, dream, priority, followed_networks,
          info_requested_on, application_platform, applied_on, complete_on, portal_url, committed_on, withdrawn_on,
          recommendations_count, supplements_count, transcript_shared, category_source, round_source, legacy, recruited, legacy_sibling
        from public.list_items where list_id = v_list
      ) i
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.due_on asc nulls last, t.position) from (
        select id, list_id, item_id, key, kind, title, detail, due_on, window_start, window_end, assignee, source,
          source_field, source_edition, date_note, done_at, done_by, snoozed_until, dismissed, orphaned, position,
          created_by, created_at
        from public.plan_tasks where list_id = v_list
      ) t
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.on_date) from (
        select id, item_id, kind, on_date, at_time, registered, registration_url, who, rating, notes, created_by,
          created_at, updated_at
        from public.plan_visits where item_id in (select id from public.list_items where list_id = v_list)
      ) v
    ), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.created_at) from (
        select id, item_id, award_year, letter_date, source, coa, gift, work_study, loans, quotes, pros, cons,
          confirmed_at, created_by, created_at
        from public.plan_offers where item_id in (select id from public.list_items where list_id = v_list)
      ) o
    ), '[]'::jsonb),
    'nudges', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.sent_at desc) from (
        select id, task_id, from_user, to_student, note, sent_at, channel, reply, replied_at
        from public.plan_nudges where task_id in (select id from public.plan_tasks where list_id = v_list)
      ) n
    ), '[]'::jsonb)
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* save_student_profile(p_student, p_data)                              */
/* ------------------------------------------------------------------ */

-- The write lib/student-profile-store.ts saveProfile() makes, in one call: the upsert (the "Student profile:
-- insert/update" policies decide, as they do for the table write), stamped with the caller, then the student's
-- grad year brought in step with basics.gradYear. The sync is best-effort, as in the app: a denied or failed update
-- never undoes the profile write. p_data is the sanitized profile (lib/student-profile.ts sanitizeProfile).
create function public.save_student_profile(p_student uuid, p_data jsonb) returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_year integer;
begin
  insert into public.student_profiles (student_id, data, updated_by, updated_at)
  values (p_student, p_data, auth.uid(), now())
  on conflict (student_id) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  begin
    v_year := (p_data #>> '{basics,gradYear}')::integer;
    if v_year is not null then
      update public.students set grad_year = v_year where id = p_student and grad_year is distinct from v_year;
    end if;
  exception when others then
    null;
  end;
end;
$$;

revoke execute on function public.viewer_bundle() from public, anon;
revoke execute on function public.plan_bundle(uuid, uuid) from public, anon;
revoke execute on function public.save_student_profile(uuid, jsonb) from public, anon;
grant execute on function public.viewer_bundle() to authenticated;
grant execute on function public.plan_bundle(uuid, uuid) to authenticated;
grant execute on function public.save_student_profile(uuid, jsonb) to authenticated;
