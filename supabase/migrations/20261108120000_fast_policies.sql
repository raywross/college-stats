-- Fast read policies and the counselor bundles (specs/serving-architecture.md "Follow-up (2026-11-08): counselor
-- performance review"). Apply after 20261105120000_planner_today.sql (SQL Editor, dev first, then prod). Tested against
-- real Postgres (PGlite + the auth stub) in tests/fast-policies.test.mts: the database before this file and after it
-- return the same rows to every person for every table this file touches.
--
-- Why: the read policies called a security-definer function per row (can_read_student, can_read_list, can_read_item,
-- can_read_essay, can_read_review). Those can't be inlined, and each call cost 1–4 ms on dev, so a plan of 96 steps
-- spent 108 ms of a 113 ms read on the check. Now each policy asks for a set once per query:
-- * visible_student_ids(): the students the caller may read (exactly where can_read_student() is true), and
--   household_user_ids(): the users whose own lists the caller may read (where is_household_member(household_of(u))
--   is true). Both security definer, evaluated once and hashed.
-- * Tables hanging off another table ask that table's own policy: list_items `list_id in (select id from lists)`, and
--   so on down. A subquery on a table with row-level security applies that table's policies, so the readable set is
--   the one the old function computed. Every auth.uid() in a policy is (select auth.uid()), evaluated once.
-- * The "Admins read" policies stay as they are. Where a parent table's admin policy widens a subquery (an admin in the
--   console reads every list), the child table has its own "Admins read" too, so the result is unchanged.
-- * Write policies (can_edit_*, the essay checks) are untouched: they check one row. The can_read_* functions stay
--   defined; other functions call them.
--
-- Also: viewer_bundle() reads its students through visible_student_ids() (the grants, not a scan of every student
-- under row-level security) and no longer returns `student_profiles` (lib/student-profile-store.ts reads the table
-- when the key is absent); org_caseload_bundle() and org_student_bundle(p_student) give the counselor's two pages one
-- round trip each; and visit_event_count() becomes an index-only scan.

/* ------------------------------------------------------------------ */
/* The two sets                                                        */
/* ------------------------------------------------------------------ */

-- The students the caller may read: their own record or one they manage, a student of a live household where they
-- are an active guardian (is_guardian_of(_, false)), or a student with a live grant to a live organization they belong
-- to (is_counselor_of(_, false)). Never a deleted record. Exactly the set where can_read_student() is true.
create or replace function public.visible_student_ids() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.students s
  where s.deleted_at is null
    and (s.user_id = (select auth.uid()) or s.managed_by = (select auth.uid()))
  union
  select s.id
  from public.household_members g
  join public.households h on h.id = g.household_id and h.deleted_at is null
  join public.household_members m on m.household_id = g.household_id and m.role = 'student' and m.status = 'active'
  join public.students s on s.id = m.student_id and s.deleted_at is null
  where g.user_id = (select auth.uid()) and g.role = 'guardian' and g.status = 'active'
  union
  select s.id
  from public.org_members om
  join public.organizations o on o.id = om.org_id and o.deleted_at is null
  join public.org_students g on g.org_id = om.org_id and g.ended_at is null
  join public.students s on s.id = g.student_id and s.deleted_at is null
  where om.user_id = (select auth.uid())
$$;

-- The users whose own (user-keyed) lists the caller may read besides their own: every u whose household
-- (household_of(u): the earliest live household where u is an active guardian, or where u's own student record is an
-- active student member) is one the caller is an active member of (is_household_member). The rule in
-- can_read_list_owner() for a list with user_id set.
create or replace function public.household_user_ids() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select distinct m.household_id
    from public.household_members m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    left join public.students s on s.id = m.student_id
    where m.status = 'active'
      and (m.user_id = (select auth.uid()) or (s.user_id = (select auth.uid()) and s.deleted_at is null))
  ),
  candidates as (
    select m.user_id as u
    from public.household_members m
    where m.household_id in (select household_id from mine) and m.status = 'active' and m.role = 'guardian'
      and m.user_id is not null
    union
    select s.user_id
    from public.household_members m
    join public.students s on s.id = m.student_id and s.deleted_at is null
    where m.household_id in (select household_id from mine) and m.status = 'active' and m.role = 'student'
      and s.user_id is not null
  )
  -- A person in more than one household (accounts from before the one-household rule) counts only in the one
  -- household_of() picks, as before.
  select c.u from candidates c where public.household_of(c.u) in (select household_id from mine)
$$;

revoke execute on function public.visible_student_ids() from public, anon;
revoke execute on function public.household_user_ids() from public, anon;
grant execute on function public.visible_student_ids() to authenticated, service_role;
grant execute on function public.household_user_ids() to authenticated, service_role;

/* ------------------------------------------------------------------ */
/* Read policies                                                       */
/* ------------------------------------------------------------------ */

-- students: the owner (or managing guardian) still reads a soft-deleted record, which lets them set deleted_at and
-- restore it (20261005120000_accounts.sql), and the direct column checks keep insert ... returning working (a set
-- function runs on the statement's snapshot, which doesn't hold the new row yet).
drop policy if exists "Students: read" on public.students;
create policy "Students: read" on public.students for select to authenticated
  using (user_id = (select auth.uid()) or managed_by = (select auth.uid()) or id in (select public.visible_student_ids()));

drop policy if exists "Student profile: read" on public.student_profiles;
create policy "Student profile: read" on public.student_profiles for select to authenticated
  using (student_id in (select public.visible_student_ids()));

drop policy if exists "Essays: read" on public.essays;
create policy "Essays: read" on public.essays for select to authenticated
  using (student_id in (select public.visible_student_ids()));

-- A user's list: its owner and the active members of the owner's household; a student's list: whoever reads the student.
drop policy if exists "Lists: read" on public.lists;
create policy "Lists: read" on public.lists for select to authenticated
  using (
    (user_id is not null and (user_id = (select auth.uid()) or user_id in (select public.household_user_ids())))
    or (user_id is null and student_id in (select public.visible_student_ids()))
  );

drop policy if exists "Items: read" on public.list_items;
create policy "Items: read" on public.list_items for select to authenticated
  using (list_id in (select id from public.lists));

drop policy if exists "Tasks: read" on public.plan_tasks;
create policy "Tasks: read" on public.plan_tasks for select to authenticated
  using (list_id in (select id from public.lists));

drop policy if exists "Snapshots: read" on public.application_snapshots;
create policy "Snapshots: read" on public.application_snapshots for select to authenticated
  using (list_id in (select id from public.lists));

drop policy if exists "Visits: read" on public.plan_visits;
create policy "Visits: read" on public.plan_visits for select to authenticated
  using (item_id in (select id from public.list_items));

drop policy if exists "Offers: read" on public.plan_offers;
create policy "Offers: read" on public.plan_offers for select to authenticated
  using (item_id in (select id from public.list_items));

drop policy if exists "Letters: read" on public.plan_letters;
create policy "Letters: read" on public.plan_letters for select to authenticated
  using (item_id in (select id from public.list_items));

drop policy if exists "Interest acts: read" on public.plan_interest_acts;
create policy "Interest acts: read" on public.plan_interest_acts for select to authenticated
  using (user_id = (select auth.uid()) or (item_id is not null and item_id in (select id from public.list_items)));

drop policy if exists "Essay versions: read" on public.essay_versions;
create policy "Essay versions: read" on public.essay_versions for select to authenticated
  using (essay_id in (select id from public.essays));

drop policy if exists "Essay links: read" on public.essay_links;
create policy "Essay links: read" on public.essay_links for select to authenticated
  using (essay_id in (select id from public.essays));

drop policy if exists "Essay comments: read" on public.essay_comments;
create policy "Essay comments: read" on public.essay_comments for select to authenticated
  using (essay_id in (select id from public.essays));

drop policy if exists "Essay reviews: read" on public.essay_reviews;
create policy "Essay reviews: read" on public.essay_reviews for select to authenticated
  using (essay_id in (select id from public.essays));

drop policy if exists "Essay suggestions: read" on public.essay_suggestions;
create policy "Essay suggestions: read" on public.essay_suggestions for select to authenticated
  using (essay_id in (select id from public.essays));

drop policy if exists "Essay notes: read" on public.essay_notes;
create policy "Essay notes: read" on public.essay_notes for select to authenticated
  using (review_id in (select id from public.essay_reviews));

drop policy if exists "Texts: read" on public.sms_consents;
create policy "Texts: read" on public.sms_consents for select to authenticated
  using (user_id = (select auth.uid()) or (student_id is not null and student_id in (select public.visible_student_ids())));

/* ------------------------------------------------------------------ */
/* viewer_bundle(): grant-driven students, no profiles                 */
/* ------------------------------------------------------------------ */

-- As in 20261102120000_organizations.sql, with two changes: `students` comes from visible_student_ids() (an admin in
-- the console gets their own students, not every student the "Admins read" policy would open), and `student_profiles`
-- is gone (every visible student's whole profile, on every request, used for a display name; readers that need a
-- profile read the table). Security invoker as before.
create or replace function public.viewer_bundle() returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (
      select to_jsonb(p) from (
        select id, display_name, birth_year, role_hint, created, updated, deleted_at, suspended_at
        from public.profiles where id = (select auth.uid())
      ) p
    ),
    'students', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created, s.id) from (
        select id, user_id, display_name, grad_year, managed_by, created, deleted_at
        from public.students where deleted_at is null and id in (select public.visible_student_ids())
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
    'home', (
      select to_jsonb(hh) from (
        select household_id, lat, lng, label, place, zip, set_by, set_by_name, updated_at
        from public.household_homes where household_id = public.my_household()
      ) hh
    ),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object('org_id', g.org_id, 'student_id', g.student_id, 'can_edit', g.can_edit)
        order by g.granted_at, g.id)
      from public.org_students g
      join public.org_members m on m.org_id = g.org_id and m.user_id = (select auth.uid())
      join public.organizations o on o.id = g.org_id and o.deleted_at is null
      where g.ended_at is null
    ), '[]'::jsonb)
  )
$$;

revoke execute on function public.viewer_bundle() from public, anon;
grant execute on function public.viewer_bundle() to authenticated;

/* ------------------------------------------------------------------ */
/* The counselor's bundles                                             */
/* ------------------------------------------------------------------ */

-- One student's default list in the caseload's shape (lib/org-caseload.ts ITEM_COLUMNS, VISIT_COLUMNS, TASK_COLUMNS,
-- CASELOAD_LIST_SELECT): items by position with their visits by date, steps by due date (undated last) then position.
-- Security invoker: row-level security decides each embedded read, as PostgREST's embeds did.
create or replace function public.org_list_json(p_list public.lists) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_list.id,
    'student_id', p_list.student_id,
    'list_items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id, 'unit_id', i.unit_id, 'category', i.category, 'status', i.status, 'outcome', i.outcome,
          'round', i.round, 'position', i.position, 'enrolling', i.enrolling, 'visited_on', i.visited_on,
          'dream', i.dream, 'added_at', i.added_at, 'committed_on', i.committed_on, 'withdrawn_on', i.withdrawn_on,
          'deadline_date', i.deadline_date, 'deadline_text', i.deadline_text,
          'plan_visits', coalesce((
            select jsonb_agg(jsonb_build_object('item_id', v.item_id, 'on_date', v.on_date, 'created_at', v.created_at,
              'updated_at', v.updated_at) order by v.on_date, v.id)
            from public.plan_visits v where v.item_id = i.id
          ), '[]'::jsonb)
        )
        order by i.position, i.id
      )
      from public.list_items i where i.list_id = p_list.id
    ), '[]'::jsonb),
    'plan_tasks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id, 'item_id', t.item_id, 'kind', t.kind, 'title', t.title, 'due_on', t.due_on,
          'window_start', t.window_start, 'window_end', t.window_end, 'done_at', t.done_at, 'dismissed', t.dismissed,
          'snoozed_until', t.snoozed_until, 'orphaned', t.orphaned, 'source', t.source, 'created_at', t.created_at,
          'position', t.position
        )
        order by t.due_on asc nulls last, t.position, t.id
      )
      from public.plan_tasks t where t.list_id = p_list.id
    ), '[]'::jsonb)
  )
$$;

-- The caseload page in one call (lib/orgs.ts caseloadStudents and the reads before it): the caller's organization,
-- its roster (every status, in org_roster's order), the planner's pretend today, and for the roster's live students
-- their profiles, default lists, and essays. Null when the caller has no organization. Security invoker: the profile,
-- list, and essay reads go through row-level security exactly as the page's table reads did.
create or replace function public.org_caseload_bundle() returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org jsonb := public.my_organization();
  v_roster jsonb;
  v_ids uuid[];
begin
  if v_org is null then
    return null;
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb),
         coalesce(array_agg(r.student_id) filter (where r.status = 'active' and r.student_id is not null), '{}')
    into v_roster, v_ids
  from public.org_roster((v_org ->> 'id')::uuid) with ordinality r;
  return jsonb_build_object(
    'org', v_org,
    'roster', v_roster,
    'today', (select s.value from public.app_settings s where s.key = 'planner.today'),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', sp.student_id, 'data', sp.data) order by sp.student_id)
      from public.student_profiles sp where sp.student_id = any(v_ids)
    ), '[]'::jsonb),
    'lists', coalesce((
      select jsonb_agg(public.org_list_json(l) order by l.id)
      from public.lists l where l.student_id = any(v_ids) and l.is_default
    ), '[]'::jsonb),
    'essays', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'student_id', e.student_id, 'updated', e.updated) order by e.id)
      from public.essays e where e.student_id = any(v_ids)
    ), '[]'::jsonb)
  );
end;
$$;

-- One student's page in one call (app/org/students/[id]): the organization, today, the student's live roster row, and
-- when there is one, their profile, default list, essays, the office's notes and asks (newest first). Null when the
-- caller has no organization; `entry` null (and the rest empty) when the student isn't on the caseload.
create or replace function public.org_student_bundle(p_student uuid) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org jsonb := public.my_organization();
  v_org_id uuid;
  v_entry jsonb;
  v_today jsonb;
begin
  if v_org is null then
    return null;
  end if;
  v_org_id := (v_org ->> 'id')::uuid;
  v_today := (select s.value from public.app_settings s where s.key = 'planner.today');
  select to_jsonb(r) into v_entry
  from public.org_roster(v_org_id) r
  where r.status = 'active' and r.student_id = p_student
  limit 1;
  if v_entry is null then
    return jsonb_build_object('org', v_org, 'today', v_today, 'entry', null, 'profile', null, 'list', null,
      'essays', '[]'::jsonb, 'notes', '[]'::jsonb, 'asks', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'org', v_org,
    'today', v_today,
    'entry', v_entry,
    'profile', (
      select jsonb_build_object('student_id', sp.student_id, 'data', sp.data)
      from public.student_profiles sp where sp.student_id = p_student
    ),
    'list', (
      select public.org_list_json(l)
      from public.lists l where l.student_id = p_student and l.is_default
      order by l.id limit 1
    ),
    'essays', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'student_id', e.student_id, 'updated', e.updated) order by e.id)
      from public.essays e where e.student_id = p_student
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'org_id', n.org_id, 'student_id', n.student_id,
        'author_id', n.author_id, 'body', n.body, 'created', n.created, 'updated', n.updated) order by n.created desc, n.id)
      from public.org_notes n where n.org_id = v_org_id and n.student_id = p_student
    ), '[]'::jsonb),
    'asks', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'org_id', a.org_id, 'student_id', a.student_id, 'kind', a.kind,
        'section', a.section, 'note', a.note, 'created_by', a.created_by, 'created', a.created, 'done_at', a.done_at,
        'seen_at', a.seen_at) order by a.created desc, a.id)
      from public.org_requests a where a.org_id = v_org_id and a.student_id = p_student
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.org_list_json(public.lists) from public, anon;
revoke execute on function public.org_caseload_bundle() from public, anon;
revoke execute on function public.org_student_bundle(uuid) from public, anon;
grant execute on function public.org_list_json(public.lists) to authenticated;
grant execute on function public.org_caseload_bundle() to authenticated;
grant execute on function public.org_student_bundle(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* Visit events                                                        */
/* ------------------------------------------------------------------ */

-- visit_event_count() (20261013180000_visit_events.sql) filters on unit_id, removed_at, kind, and starts_at: with
-- this index it reads the index alone instead of the heap (28 ms and 32 heap buffers over 264k rows on dev).
create index if not exists visit_events_count_idx on public.visit_events (unit_id, starts_at) include (kind)
  where removed_at is null;
