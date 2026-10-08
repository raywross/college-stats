-- One household per account, six seats, and the household's home (specs/product/accounts.md "Built: one household,
-- six seats"; specs/product/home-and-distance.md). Builds on 20261005120000_accounts.sql,
-- 20261005125000_households.sql, and 20261005160000_invitation_links.sql (whose accept_invitation() and
-- merge_managed_student() this replaces); apply after all three (SQL Editor, dev first, then prod).
--
-- What this adds:
-- * Limits. An account is in at most one live household: as a guardian through its own membership, or as a student
--   through its own student record. A household has six seats, counting active members and invitations still
--   waiting for an answer. create_household(), add_managed_student(), create_invitation(), and accept_invitation()
--   are replaced with versions that refuse (already_in_household, household_full), and a trigger on household_members
--   is the backstop for every other path. Accepting an invitation while alone in a one-person household dissolves
--   that household (nobody else is in it) and carries its home over when the new household has none.
-- * The household's home: household_homes, one row per household, readable and settable by every active member and
--   by nobody else. Replaces the per-user home_locations table an earlier draft of this migration created (dropped
--   here in case it was applied).
--
-- Tested in tests/household-limits.test.mts and tests/home-policies.test.mts (PGlite + the auth stub, every
-- assertion as a signed-in user), with guard tests that break each rule and show what the checks would miss.

/* ------------------------------------------------------------------ */
/* Limits: helpers                                                     */
/* ------------------------------------------------------------------ */

-- The cap, in one place. lib/household-rules.ts HOUSEHOLD_MAX_MEMBERS mirrors it (a test checks).
create function public.household_max_members() returns integer
language sql
immutable
as $$ select 6 $$;

-- The live household p_user belongs to: through an active guardian membership, or their own student record's active
-- student membership. Null when none. (An account from before this migration may be in several; the earliest wins.)
create function public.household_of(p_user uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.household_members m
  join public.households h on h.id = m.household_id and h.deleted_at is null
  left join public.students s on s.id = m.student_id
  where m.status = 'active'
    and ((m.role = 'guardian' and m.user_id = p_user) or (m.role = 'student' and s.user_id = p_user and s.deleted_at is null))
  order by coalesce(m.accepted_at, m.created), m.id
  limit 1
$$;

-- The caller's household (the app asks before saving a home), or null.
create function public.my_household() returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select public.household_of(auth.uid()) $$;

-- Seats taken: active members plus invitations still waiting for an answer (unaccepted, unrevoked, unexpired). An
-- invitation that hands a managed student over to their own account takes no seat: the record already holds one.
create function public.household_seats_taken(p_household uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.household_members m where m.household_id = p_household and m.status = 'active')::integer
       + (select count(*) from public.invitations i
          where i.household_id = p_household and i.student_id is null
            and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())::integer
$$;

-- Whether p_user is the only active member of p_household, so joining another household may dissolve this one.
create function public.is_solo_household(p_household uuid, p_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.household_members m
      left join public.students s on s.id = m.student_id
      where m.household_id = p_household and m.status = 'active'
        and ((m.role = 'guardian' and m.user_id = p_user) or (m.role = 'student' and s.user_id = p_user))
    )
    and (select count(*) from public.household_members m where m.household_id = p_household and m.status = 'active') = 1
$$;

/* ------------------------------------------------------------------ */
/* Limits: the backstop trigger                                        */
/* ------------------------------------------------------------------ */

-- Every path that activates a membership passes here: the person must not be active in another live household, and
-- the household must have a seat free. The functions below check first (with clearer timing and the invitations
-- counted); this makes the rule hold for direct inserts too (a creator joining their own household, a guardian
-- adding a managed student) and for anything a later migration forgets.
create function public.household_members_check_limits() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
  v_active integer;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active' and old.household_id = new.household_id) then
    return new;
  end if;
  -- An insert that conflicts with this household's existing row for the same person (accept_invitation's
  -- `on conflict do update`, e.g. a hand-over of a managed student) activates nobody new: the update's own trigger
  -- run decides, and a plain duplicate still fails on the unique constraint.
  if tg_op = 'INSERT' and exists (
    select 1 from public.household_members m
    where m.household_id = new.household_id
      and ((new.role = 'guardian' and m.user_id = new.user_id) or (new.role = 'student' and m.student_id = new.student_id))
  ) then
    return new;
  end if;
  if new.role = 'guardian' then
    v_person := new.user_id;
  else
    select s.user_id into v_person from public.students s where s.id = new.student_id;
  end if;
  if v_person is not null and exists (
    select 1 from public.household_members m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    left join public.students s on s.id = m.student_id
    where m.status = 'active' and m.household_id <> new.household_id and m.id is distinct from new.id
      and ((m.role = 'guardian' and m.user_id = v_person) or (m.role = 'student' and s.user_id = v_person and s.deleted_at is null))
  ) then
    raise exception 'already_in_household' using errcode = '23505';
  end if;
  select count(*) into v_active
  from public.household_members m
  where m.household_id = new.household_id and m.status = 'active' and m.id is distinct from new.id;
  if v_active + 1 > public.household_max_members() then
    raise exception 'household_full' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger household_members_check_limits
before insert or update of status, household_id on public.household_members
for each row execute function public.household_members_check_limits();

/* ------------------------------------------------------------------ */
/* The household's home                                                */
/* ------------------------------------------------------------------ */

-- An earlier draft of this feature kept one home per user; nothing was ever written to it.
drop table if exists public.home_locations;

create table public.household_homes (
  household_id uuid primary key references public.households (id) on delete cascade,
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  -- The matched address, tidied ("1600 Pennsylvania Ave NW, Washington, DC 20500"); shown to members only.
  label        text not null check (char_length(label) between 1 and 200),
  -- "Washington, DC" (or "ZIP 20500"): what distance lines name.
  place        text not null check (char_length(place) between 1 and 80),
  -- Explore's filter measures from this ZIP code's center, so shared Explore links carry a ZIP, never an address.
  zip          text check (zip ~ '^[0-9]{5}$'),
  -- Who set it ("Set by Mom"): the member's id, and their name at the time (profiles is own-row only).
  set_by       uuid references auth.users (id) on delete set null,
  set_by_name  text check (char_length(set_by_name) <= 80),
  updated_at   timestamptz not null default now()
);

alter table public.household_homes enable row level security;

-- Active members of a live household read, set, change, and remove its home; nobody else sees it exists.
create policy "Home: members read" on public.household_homes for select to authenticated
  using (public.is_household_member(household_id));
create policy "Home: members set" on public.household_homes for insert to authenticated
  with check (public.is_household_member(household_id) and (set_by is null or set_by = auth.uid()));
create policy "Home: members change" on public.household_homes for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id) and (set_by is null or set_by = auth.uid()));
create policy "Home: members remove" on public.household_homes for delete to authenticated
  using (public.is_household_member(household_id));

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that.
revoke all on public.household_homes from anon, authenticated;
grant select, insert, update, delete on public.household_homes to authenticated;
grant all on public.household_homes to service_role;

/* ------------------------------------------------------------------ */
/* Replaced functions                                                  */
/* ------------------------------------------------------------------ */

-- As in 20261005125000_households.sql, plus: refused (already_in_household) for a caller who is already in a live
-- household. The app creates a one-person household on its own when someone with none saves a home.
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

-- As before, plus: refused (household_full) when the household's six seats are taken, counting invitations still
-- waiting for an answer.
create or replace function public.add_managed_student(p_household uuid, p_name text, p_grad_year integer default null) returns uuid
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
  if public.household_seats_taken(p_household) >= public.household_max_members() then
    raise exception 'household_full' using errcode = '23514';
  end if;
  insert into public.students (managed_by, display_name, grad_year) values (v_uid, v_name, p_grad_year)
  returning id into v_student;
  insert into public.household_members (household_id, student_id, role, status, accepted_at)
  values (p_household, v_student, 'student', 'active', now());
  return v_student;
end;
$$;

-- As in 20261005120000_accounts.sql, plus: refused (household_full) when the six seats are taken, so an invitation
-- is never sent that couldn't be accepted.
create or replace function public.create_invitation(
  p_household uuid,
  p_email text,
  p_side text,
  p_student uuid default null,
  p_can_edit boolean default false
) returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
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
  v_is_guardian := public.is_household_guardian(p_household);

  if p_side = 'student' then
    if not v_is_guardian then
      raise exception 'only_guardians_invite_students' using errcode = '42501';
    end if;
    if p_student is not null and not exists (
      select 1 from public.students s
      join public.household_members m on m.student_id = s.id and m.household_id = p_household and m.status = 'active'
      where s.id = p_student and s.managed_by = v_uid and s.user_id is null and s.deleted_at is null
    ) then
      raise exception 'invalid_student' using errcode = '42501';
    end if;
  elsif p_student is not null then
    raise exception 'invalid_student' using errcode = '22023';
  end if;
  -- Handing over a managed student fills no new seat: the record is already a member.
  if p_student is null and public.household_seats_taken(p_household) >= public.household_max_members() then
    raise exception 'household_full' using errcode = '23514';
  end if;

  insert into public.invitations (household_id, token_hash, email, side, student_id, can_edit, invited_by)
  values (
    p_household,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    v_email,
    p_side,
    p_student,
    p_side = 'guardian' and not v_is_guardian and coalesce(p_can_edit, false),
    v_uid
  )
  returning * into v_row;

  return json_build_object('id', v_row.id, 'token', v_token, 'expires_at', v_row.expires_at);
end;
$$;

-- merge_managed_student() as in 20261005160000_invitation_links.sql, except the managed record leaves each household
-- before the student's own record takes its place, so the seat cap sees a swap, not a seventh member.
create or replace function public.merge_managed_student(p_managed uuid, p_own uuid, p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_households uuid[];
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

  -- Households: the own record takes the managed record's place in each, the managed one leaving first.
  v_households := array(select m.household_id from public.household_members m where m.student_id = p_managed and m.status = 'active');
  delete from public.household_members where student_id = p_managed;
  insert into public.household_members (household_id, student_id, role, status, accepted_at)
    select h, p_own, 'student', 'active', now() from unnest(v_households) as h
  on conflict (household_id, student_id) do update set status = 'active';

  update public.access_log set student_id = p_own where student_id = p_managed;
  update public.students set deleted_at = now() where id = p_managed and user_id is null;
end;
$$;

-- accept_invitation() as in 20261005160000_invitation_links.sql (claiming or merging a managed record), plus the
-- one-household rule: a caller already in a different live household is refused (already_in_household), unless they
-- are its only member, in which case that household is dissolved (its home carried over when the new one has none)
-- and they join. The trigger above also enforces the seat cap.
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
  v_current uuid;
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

  v_current := public.household_of(v_uid);
  if v_current is not null and v_current <> v_inv.household_id then
    if not public.is_solo_household(v_current, v_uid) then
      raise exception 'already_in_household' using errcode = '23505';
    end if;
    -- Alone in the old household: bring its home along if the new household has none, then close it.
    insert into public.household_homes (household_id, lat, lng, label, place, zip, set_by, set_by_name, updated_at)
      select v_inv.household_id, hh.lat, hh.lng, hh.label, hh.place, hh.zip, hh.set_by, hh.set_by_name, hh.updated_at
      from public.household_homes hh where hh.household_id = v_current
      on conflict (household_id) do nothing;
    delete from public.household_homes where household_id = v_current;
    delete from public.household_members m
      where m.household_id = v_current
        and (m.user_id = v_uid or m.student_id in (select s.id from public.students s where s.user_id = v_uid));
    perform public.close_household_if_empty(v_current, now());
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

/* ------------------------------------------------------------------ */
/* Function privileges                                                 */
/* ------------------------------------------------------------------ */

-- The replaced functions keep their existing grants. The helpers: the cap and the caller's own household for the app;
-- the rest internal.
revoke execute on function public.household_max_members() from public, anon;
revoke execute on function public.household_of(uuid) from public, anon, authenticated;
revoke execute on function public.my_household() from public, anon;
revoke execute on function public.household_seats_taken(uuid) from public, anon, authenticated;
revoke execute on function public.is_solo_household(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.household_members_check_limits() from public, anon, authenticated;

grant execute on function public.household_max_members() to authenticated, service_role;
grant execute on function public.my_household() to authenticated, service_role;
grant execute on function public.household_of(uuid) to service_role;
grant execute on function public.household_seats_taken(uuid) to service_role;
grant execute on function public.is_solo_household(uuid, uuid) to service_role;
