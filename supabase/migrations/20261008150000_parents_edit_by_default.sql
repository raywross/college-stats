-- Parents edit by default (owner decision 2026-10-08; specs/product/household-hub.md "Parents can edit: the student's switch").
--
-- Students are minors: a parent should be able to make changes to their student's list, plan, and numbers without
-- the student first finding a switch. So editing is ON when a student is added, and the student's profile page gets
-- a switch to turn it OFF (set_member_can_edit, unchanged, still does the per-guardian work; the page flips every
-- guardian in the household at once).
--   1. the guardian who creates a household is an editor (create_household, last defined in 20261005170000);
--   2. an invited guardian joins as an editor unless the inviter unticks it, whoever invites (create_invitation,
--      both signatures, last defined in 20261006150000);
--   3. every active guardian row today becomes an editor.
-- Students' own accounts, text consent, and follows stay the student's alone (unchanged).

create or replace function public.create_household(p_name text, p_role text) returns uuid
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
  if public.household_of(v_uid) is not null then
    raise exception 'already_in_household' using errcode = '23505';
  end if;

  insert into public.households (name, created_by) values (v_name, v_uid) returning id into v_household;
  if p_role = 'guardian' then
    insert into public.household_members (household_id, user_id, role, status, accepted_at, can_edit)
    values (v_household, v_uid, 'guardian', 'active', now(), true);
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

create or replace function public.create_invitation(
  p_household uuid,
  p_email text,
  p_side text,
  p_student uuid,
  p_can_edit boolean,
  p_display_name text,
  p_phone text,
  p_grad_year integer
) returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_student uuid := p_student;
  v_is_guardian boolean;
  v_row public.invitations;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if p_side not in ('guardian', 'student') then
    raise exception 'invalid_side' using errcode = '22023';
  end if;
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_email = (select lower(u.email) from auth.users u where u.id = v_uid) then
    raise exception 'invite_self' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if p_grad_year is not null and p_grad_year not between 2000 and 2100 then
    raise exception 'invalid_grad_year' using errcode = '22023';
  end if;
  v_is_guardian := public.is_household_guardian(p_household);

  if p_side = 'student' then
    if not v_is_guardian then
      raise exception 'only_guardians_invite_students' using errcode = '42501';
    end if;
    if v_student is not null and not exists (
      select 1 from public.students s
      join public.household_members m on m.student_id = s.id and m.household_id = p_household and m.status = 'active'
      where s.id = v_student and s.managed_by = v_uid and s.user_id is null and s.deleted_at is null
    ) then
      raise exception 'invalid_student' using errcode = '42501';
    end if;
    -- A student with an email is a managed record plus a hand-over: one seat, and the list can start now.
    if v_student is null and v_name is not null then
      v_student := public.add_managed_student(p_household, v_name, p_grad_year);
      if v_phone is not null then
        update public.students set phone = v_phone where id = v_student;
      end if;
    end if;
  elsif v_student is not null then
    raise exception 'invalid_student' using errcode = '22023';
  end if;
  -- Handing over a managed student fills no new seat: the record is already a member.
  if v_student is null and public.household_seats_taken(p_household) >= public.household_max_members() then
    raise exception 'household_full' using errcode = '23514';
  end if;

  insert into public.invitations (household_id, token_hash, token, email, side, student_id, can_edit, invited_by, display_name, phone, grad_year)
  values (
    p_household,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    v_token,
    v_email,
    p_side,
    v_student,
    -- 2026-10-08: a guardian joins able to edit unless the inviter unticks it; the student can switch it off later.
    p_side = 'guardian' and coalesce(p_can_edit, true),
    v_uid,
    v_name,
    v_phone,
    case when p_side = 'student' then p_grad_year end
  )
  returning * into v_row;

  return json_build_object('id', v_row.id, 'token', v_token, 'expires_at', v_row.expires_at, 'student_id', v_row.student_id);
end;
$$;

create or replace function public.create_invitation(
  p_household uuid,
  p_email text,
  p_side text,
  p_student uuid default null,
  p_can_edit boolean default true
) returns json
language sql
security definer
set search_path = ''
as $$
  select public.create_invitation(p_household, p_email, p_side, p_student, p_can_edit, null::text, null::text, null::integer)
$$;

update public.household_members set can_edit = true where role = 'guardian' and status = 'active' and not can_edit;
