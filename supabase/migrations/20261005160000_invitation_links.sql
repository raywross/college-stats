-- Invitation links that can be sent again, and claiming a managed student into an account that already has its own
-- student record (specs/product/accounts.md, "Invitations"). Apply after 20261005150000_lists.sql (it moves lists and
-- student_profiles). Tested in tests/invitation-links.test.mts.
--
-- * reissue_invitation(): a pending invitation's link can't be shown again (only its hash is stored), so "send it
--   again" makes a new link for the same invitation: a new token, a fresh 7-day expiry, and the old link stops
--   working. Any active member of the household may, like revoking.
-- * accept_invitation() now merges: when a student accepting an invitation for a managed record already has their
--   own record (created the first time they opened /me), the managed record's lists, profile, household
--   memberships, and access log move to their own record instead of being left behind. Their own values win where
--   both have one; the managed record is then soft-deleted.

create function public.reissue_invitation(p_invitation uuid) returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select i.* into v_inv from public.invitations i where i.id = p_invitation for update;
  if not found or not public.is_household_member(v_inv.household_id) then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = '22023';
  end if;
  update public.invitations
    set token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), expires_at = v_expires
    where id = p_invitation;
  return json_build_object('id', p_invitation, 'token', v_token, 'expires_at', v_expires, 'email', v_inv.email, 'side', v_inv.side);
end;
$$;

revoke execute on function public.reissue_invitation(uuid) from public, anon;
grant execute on function public.reissue_invitation(uuid) to authenticated;

-- Moves a managed student record into the student's own record. Internal: called only by accept_invitation().
create function public.merge_managed_student(p_managed uuid, p_own uuid, p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lists: the own record keeps its default list; the managed record's lists come over as extra lists.
  if exists (select 1 from public.lists where student_id = p_own and is_default) then
    update public.lists set is_default = false where student_id = p_managed and is_default;
  end if;
  update public.lists set student_id = p_own where student_id = p_managed;
  -- Moved lists' colleges are now on the student's lists, so the student follows them (the list_items trigger only
  -- runs on insert); a manual follow is left as it is.
  insert into public.follows (user_id, unit_id, source)
    select distinct p_user, li.unit_id, 'list'
    from public.list_items li join public.lists l on l.id = li.list_id
    where l.student_id = p_own
  on conflict (user_id, unit_id) do nothing;

  -- Profile: keys from both, the student's own values winning.
  if exists (select 1 from public.student_profiles where student_id = p_managed) then
    if exists (select 1 from public.student_profiles where student_id = p_own) then
      update public.student_profiles o
        set data = m.data || o.data, updated_at = now()
        from public.student_profiles m
        where o.student_id = p_own and m.student_id = p_managed;
      delete from public.student_profiles where student_id = p_managed;
    else
      update public.student_profiles set student_id = p_own, updated_at = now() where student_id = p_managed;
    end if;
  end if;

  -- Households: the own record takes the managed record's place in each.
  insert into public.household_members (household_id, student_id, role, status, accepted_at)
    select m.household_id, p_own, 'student', 'active', now()
    from public.household_members m
    where m.student_id = p_managed and m.status = 'active'
  on conflict (household_id, student_id) do update set status = 'active';
  delete from public.household_members where student_id = p_managed;

  update public.access_log set student_id = p_own where student_id = p_managed;
  update public.students set deleted_at = now() where id = p_managed and user_id is null;
end;
$$;

revoke execute on function public.merge_managed_student(uuid, uuid, uuid) from public, anon, authenticated;

-- accept_invitation() as in 20261005120000_accounts.sql, except a student who already has their own record merges
-- the invitation's managed record into it (above) instead of leaving it behind.
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations;
  v_email text;
  v_student uuid;
  v_claimed integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;

  select i.* into v_inv
  from public.invitations i
  join public.households h on h.id = i.household_id and h.deleted_at is null
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  for update of i;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = '22023';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = '22023';
  end if;
  if v_inv.invited_by = v_uid then
    raise exception 'invitation_own' using errcode = '22023';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'invitation_wrong_email' using errcode = '42501';
  end if;

  if v_inv.side = 'guardian' then
    insert into public.household_members (household_id, user_id, role, status, can_edit, accepted_at)
    values (v_inv.household_id, v_uid, 'guardian', 'active', v_inv.can_edit, now())
    on conflict (household_id, user_id)
      do update set status = 'active', can_edit = excluded.can_edit, accepted_at = now();
  else
    select s.id into v_student from public.students s where s.user_id = v_uid;
    if v_student is null and v_inv.student_id is not null then
      update public.students
        set user_id = v_uid, managed_by = null
        where id = v_inv.student_id and user_id is null and deleted_at is null;
      get diagnostics v_claimed = row_count;
      if v_claimed = 1 then
        v_student := v_inv.student_id;
      end if;
    elsif v_student is not null and v_inv.student_id is not null and v_inv.student_id <> v_student
      and exists (select 1 from public.students s where s.id = v_inv.student_id and s.user_id is null and s.deleted_at is null) then
      perform public.merge_managed_student(v_inv.student_id, v_student, v_uid);
    end if;
    if v_student is null then
      insert into public.students (user_id, display_name)
      values (v_uid, (select p.display_name from public.profiles p where p.id = v_uid))
      returning id into v_student;
    end if;
    insert into public.household_members (household_id, student_id, role, status, accepted_at)
    values (v_inv.household_id, v_student, 'student', 'active', now())
    on conflict (household_id, student_id)
      do update set status = 'active', accepted_at = now();
  end if;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.household_id;
end;
$$;

revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
