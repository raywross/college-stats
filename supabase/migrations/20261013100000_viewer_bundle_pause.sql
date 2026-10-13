-- The viewer bundle carries the account's pause (specs/product/admin.md "What deactivate means").
--
-- 20261012140000_plan_bundle.sql's viewer_bundle() lists the profile's columns one by one, so it never returned
-- profiles.suspended_at (added by 20261012200000_admin.sql), and lib/auth.ts getAccount(), which reads the profile from
-- the bundle when it's installed, couldn't tell a paused account from an active one. This re-creates the function
-- unchanged except for that one column. Apply after 20261012200000_admin.sql (it needs the column).

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

revoke execute on function public.viewer_bundle() from public, anon;
grant execute on function public.viewer_bundle() to authenticated;
