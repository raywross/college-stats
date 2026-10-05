-- Households, invitations, export, and delete (specs/product/accounts.md, "Built: households"). Builds on
-- 20261005120000_accounts.sql; apply it after that one (SQL Editor, dev first, then prod).
--
-- What this adds:
-- * household_roster(household): co-members' display names and roles. profiles is own-row only, so this is the one
--   way to see another member's name, and it returns nothing else about them (never an email or a birth year).
-- * create_household(), add_managed_student(): the two-step inserts the app makes, done atomically.
-- * A delete policy letting a household's active guardians remove a member; leave_household() for leaving (and
--   closing a household nobody who can act is left in).
-- * set_member_can_edit(): change a guardian's edit access after joining. Only a student of the household grants it,
--   or a guardian when every student there is a managed record that guardian created (the same rule as
--   create_invitation); revoking is also open to the guardian themselves.
-- * my_access_log(): the student's view of who looked at their data, with viewer names.
-- * account_deletion_preview(), delete_my_account(), restore_my_account(): the 30-day soft delete. A student's own
--   data survives a guardian's delete; a managed student goes with its guardian unless another guardian has access,
--   who then takes over managing it.
--
-- Tested in tests/households.test.mts (PGlite + the auth stub, every assertion as a signed-in user).

/* ------------------------------------------------------------------ */
/* Internal helpers (not callable through the API)                     */
/* ------------------------------------------------------------------ */

-- Whether anyone who can act is still in a household: an active guardian, or an active student with their own
-- account. Managed students alone can't do anything.
create function public.household_has_actors(p_household uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    left join public.students s on s.id = m.student_id
    where m.household_id = p_household and m.status = 'active'
      and (m.role = 'guardian' or (s.user_id is not null and s.deleted_at is null))
  )
$$;

-- Soft-deletes a household nobody who can act is left in, and revokes its pending invitations.
create function public.close_household_if_empty(p_household uuid, p_at timestamptz) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.household_has_actors(p_household) then
    return;
  end if;
  update public.households set deleted_at = p_at where id = p_household and deleted_at is null;
  update public.invitations set revoked_at = p_at
    where household_id = p_household and accepted_at is null and revoked_at is null;
end;
$$;

-- Another guardian (not p_user, not deleted) with active access to a managed student: the one who takes over
-- managing it when p_user deletes their account. The longest-standing membership wins. Null when there's none.
create function public.managed_student_heir(p_student uuid, p_user uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.user_id
  from public.household_members g
  join public.household_members m
    on m.household_id = g.household_id and m.student_id = p_student and m.role = 'student' and m.status = 'active'
  join public.households h on h.id = g.household_id and h.deleted_at is null
  left join public.profiles p on p.id = g.user_id
  where g.role = 'guardian' and g.status = 'active' and g.user_id <> p_user and p.deleted_at is null
  order by coalesce(g.accepted_at, g.created), g.id
  limit 1
$$;

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

-- The active members of a household the caller belongs to, with display names and roles only. Empty for anyone
-- else (including a guardian whose membership isn't active, and signed-out visitors, who can't call it at all).
create function public.household_roster(p_household uuid)
returns table (
  member_id uuid,
  role text,
  user_id uuid,
  student_id uuid,
  display_name text,
  can_edit boolean,
  managed boolean,
  managed_by_me boolean,
  is_me boolean,
  joined timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.role,
    m.user_id,
    m.student_id,
    case when m.role = 'guardian' then gp.display_name else coalesce(s.display_name, sp.display_name) end,
    m.can_edit,
    m.role = 'student' and s.user_id is null,
    m.role = 'student' and s.user_id is null and s.managed_by = auth.uid(),
    m.user_id = auth.uid() or (s.user_id is not null and s.user_id = auth.uid()),
    coalesce(m.accepted_at, m.created)
  from public.household_members m
  left join public.profiles gp on gp.id = m.user_id
  left join public.students s on s.id = m.student_id
  left join public.profiles sp on sp.id = s.user_id
  where m.household_id = p_household
    and m.status = 'active'
    and public.is_household_member(p_household)
    and ((m.role = 'guardian' and gp.deleted_at is null) or (m.role = 'student' and s.deleted_at is null))
  order by m.role, coalesce(m.accepted_at, m.created), m.id
$$;

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

-- A new household with the caller as its first member: as a guardian, or as a student (with their own student
-- record, created if they have none). Returns the household id.
create function public.create_household(p_name text, p_role text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_household uuid;
  v_student uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_role not in ('guardian', 'student') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.deleted_at is not null) then
    raise exception 'account_deleted' using errcode = '42501';
  end if;

  insert into public.households (name, created_by) values (v_name, v_uid) returning id into v_household;
  if p_role = 'guardian' then
    insert into public.household_members (household_id, user_id, role, status, accepted_at)
    values (v_household, v_uid, 'guardian', 'active', now());
  else
    select s.id into v_student from public.students s where s.user_id = v_uid and s.deleted_at is null;
    if v_student is null then
      insert into public.students (user_id, display_name)
      values (v_uid, (select p.display_name from public.profiles p where p.id = v_uid))
      returning id into v_student;
    end if;
    insert into public.household_members (household_id, student_id, role, status, accepted_at)
    values (v_household, v_student, 'student', 'active', now());
  end if;
  return v_household;
end;
$$;

-- A managed student (a child without an account yet) created by an active guardian of the household and added to
-- it. Returns the student id.
create function public.add_managed_student(p_household uuid, p_name text, p_grad_year integer default null) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_student uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_household_guardian(p_household) then
    raise exception 'only_guardians_add_students' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_grad_year is not null and p_grad_year not between 2000 and 2100 then
    raise exception 'invalid_grad_year' using errcode = '22023';
  end if;
  insert into public.students (managed_by, display_name, grad_year) values (v_uid, v_name, p_grad_year)
  returning id into v_student;
  insert into public.household_members (household_id, student_id, role, status, accepted_at)
  values (p_household, v_student, 'student', 'active', now());
  return v_student;
end;
$$;

/* ------------------------------------------------------------------ */
/* Leaving, removing, edit access                                      */
/* ------------------------------------------------------------------ */

-- An active guardian of a household may remove any member of it (the student side leaves on its own; see
-- leave_household). Access stops at once: nothing is cached.
create policy "Members: guardians remove" on public.household_members for delete to authenticated
  using (public.is_household_guardian(household_id));

-- Leave a household: the caller's guardian membership and their own student record's membership. A household left
-- with nobody who can act is closed (soft-deleted, pending invitations revoked).
create function public.leave_household(p_household uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_left integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  delete from public.household_members m
  where m.household_id = p_household
    and (m.user_id = v_uid or m.student_id in (select s.id from public.students s where s.user_id = v_uid));
  get diagnostics v_left = row_count;
  if v_left = 0 then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  perform public.close_household_if_empty(p_household, now());
end;
$$;

-- Change a guardian's edit access after they joined. Granting: a student of the household, or a guardian when every
-- student in it is a managed record that guardian created (and there's at least one); never your own. Revoking: the
-- same people, or the guardian themselves.
create function public.set_member_can_edit(p_member uuid, p_can_edit boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_m public.household_members;
  v_is_student boolean;
  v_manages_all boolean;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select m.* into v_m from public.household_members m where m.id = p_member for update;
  if not found or v_m.role <> 'guardian' or v_m.status <> 'active' or not public.is_household_member(v_m.household_id) then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  v_is_student := exists (
    select 1 from public.household_members m
    join public.students s on s.id = m.student_id
    where m.household_id = v_m.household_id and m.role = 'student' and m.status = 'active'
      and s.user_id = v_uid and s.deleted_at is null
  );
  v_manages_all := public.is_household_guardian(v_m.household_id)
    and exists (
      select 1 from public.household_members m
      join public.students s on s.id = m.student_id and s.deleted_at is null
      where m.household_id = v_m.household_id and m.role = 'student' and m.status = 'active'
    )
    and not exists (
      select 1 from public.household_members m
      join public.students s on s.id = m.student_id and s.deleted_at is null
      where m.household_id = v_m.household_id and m.role = 'student' and m.status = 'active'
        and not (s.user_id is null and s.managed_by = v_uid)
    );

  if coalesce(p_can_edit, false) then
    if v_m.user_id = v_uid then
      raise exception 'cannot_grant_self' using errcode = '42501';
    end if;
    if not (v_is_student or v_manages_all) then
      raise exception 'only_student_grants_edit' using errcode = '42501';
    end if;
  elsif not (v_is_student or v_manages_all or v_m.user_id = v_uid) then
    raise exception 'only_student_grants_edit' using errcode = '42501';
  end if;

  update public.household_members set can_edit = coalesce(p_can_edit, false) where id = p_member;
end;
$$;

/* ------------------------------------------------------------------ */
/* Access log                                                          */
/* ------------------------------------------------------------------ */

-- Who looked at the caller's own student data, newest first, with the viewer's display name (null once they've
-- deleted their account or never set one).
create function public.my_access_log(p_limit integer default 200)
returns table (at timestamptz, table_name text, viewer_id uuid, viewer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.at, a.table_name, a.viewer_id, case when p.deleted_at is null then p.display_name end
  from public.access_log a
  join public.students s on s.id = a.student_id and s.user_id = auth.uid()
  left join public.profiles p on p.id = a.viewer_id
  where auth.uid() is not null
  order by a.at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

/* ------------------------------------------------------------------ */
/* Delete and restore                                                  */
/* ------------------------------------------------------------------ */

-- What deleting the caller's account would do to the managed students they created: each one either goes with them
-- or stays with another guardian (named) who takes over managing it.
create function public.account_deletion_preview() returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'own_student', exists (select 1 from public.students s where s.user_id = auth.uid() and s.deleted_at is null),
    'managed', coalesce((
      select json_agg(json_build_object(
        'id', s.id,
        'name', s.display_name,
        'kept_by', (select p.display_name from public.profiles p where p.id = public.managed_student_heir(s.id, auth.uid())),
        'kept', public.managed_student_heir(s.id, auth.uid()) is not null
      ) order by s.display_name, s.id)
      from public.students s
      where s.managed_by = auth.uid() and s.user_id is null and s.deleted_at is null
    ), '[]'::json)
  )
  where auth.uid() is not null
$$;

-- Soft-delete the caller's account (accounts.md "Data handling"). Everything gets the same deleted_at, which is how
-- restore_my_account() finds it again and how the purge script (after 30 days) finds what to hard-delete.
-- * profile: deleted_at set.
-- * own student record: deleted_at set (guardians lose it at once).
-- * managed students: handed to another guardian with access (managed_by changes), else deleted with the account.
-- * memberships: the caller's and their own student's are removed (access stops now; restoring doesn't rejoin).
-- * households left with nobody who can act are closed; invitations the caller sent and nobody used are revoked.
-- Returns {deleted_at, managed_kept, managed_deleted}.
create function public.delete_my_account() returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := now();
  v_households uuid[];
  v_household uuid;
  v_heir uuid;
  v_kept integer := 0;
  v_deleted integer := 0;
  r record;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.deleted_at is not null) then
    raise exception 'account_deleted' using errcode = '22023';
  end if;

  v_households := array(
    select distinct m.household_id from public.household_members m
    left join public.students s on s.id = m.student_id
    where m.user_id = v_uid or s.user_id = v_uid or (s.managed_by = v_uid and s.user_id is null)
  );

  for r in select s.id from public.students s where s.managed_by = v_uid and s.user_id is null and s.deleted_at is null loop
    v_heir := public.managed_student_heir(r.id, v_uid);
    if v_heir is not null then
      update public.students set managed_by = v_heir where id = r.id;
      v_kept := v_kept + 1;
    else
      update public.students set deleted_at = v_at where id = r.id;
      delete from public.household_members where student_id = r.id;
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  update public.students set deleted_at = v_at where user_id = v_uid and deleted_at is null;
  delete from public.household_members m
  where m.user_id = v_uid or m.student_id in (select s.id from public.students s where s.user_id = v_uid);
  update public.invitations set revoked_at = v_at where invited_by = v_uid and accepted_at is null and revoked_at is null;

  foreach v_household in array v_households loop
    perform public.close_household_if_empty(v_household, v_at);
  end loop;

  insert into public.profiles (id, deleted_at) values (v_uid, v_at)
  on conflict (id) do update set deleted_at = v_at;

  return json_build_object('deleted_at', v_at, 'managed_kept', v_kept, 'managed_deleted', v_deleted);
end;
$$;

-- Undo delete_my_account() within the 30 days: the profile, the own student record, and managed students deleted
-- with it. Households and memberships aren't restored (rejoin through a new invitation).
create function public.restore_my_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select p.deleted_at into v_at from public.profiles p where p.id = v_uid;
  if v_at is null then
    return;
  end if;
  update public.students set deleted_at = null
    where deleted_at = v_at and (user_id = v_uid or (managed_by = v_uid and user_id is null));
  update public.profiles set deleted_at = null where id = v_uid;
end;
$$;

/* ------------------------------------------------------------------ */
/* Function privileges                                                 */
/* ------------------------------------------------------------------ */

revoke execute on function public.household_has_actors(uuid) from public, anon, authenticated;
revoke execute on function public.close_household_if_empty(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.managed_student_heir(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.household_roster(uuid) from public, anon;
revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.add_managed_student(uuid, text, integer) from public, anon;
revoke execute on function public.leave_household(uuid) from public, anon;
revoke execute on function public.set_member_can_edit(uuid, boolean) from public, anon;
revoke execute on function public.my_access_log(integer) from public, anon;
revoke execute on function public.account_deletion_preview() from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.restore_my_account() from public, anon;

grant execute on function public.household_has_actors(uuid) to service_role;
grant execute on function public.close_household_if_empty(uuid, timestamptz) to service_role;
grant execute on function public.managed_student_heir(uuid, uuid) to service_role;
grant execute on function public.household_roster(uuid) to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.add_managed_student(uuid, text, integer) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.set_member_can_edit(uuid, boolean) to authenticated;
grant execute on function public.my_access_log(integer) to authenticated;
grant execute on function public.account_deletion_preview() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.restore_my_account() to authenticated;
