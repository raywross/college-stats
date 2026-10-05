-- Accounts and households (specs/product/accounts.md): profiles, households, household_members, students,
-- invitations, access_log, row-level security on every one, and the helper functions every later user-data policy
-- uses (is_own_student, can_read_student, can_edit_student).
--
-- Unlike the dataset tables, these are written row by row through PostgREST with the signed-in user's token, so
-- the policies below are the only thing standing between one family's data and another's. Tested against real
-- Postgres (PGlite with a stub of Supabase's auth schema) in tests/accounts-policies.test.mts.
--
-- Rules the policies encode:
-- * A user reads and edits only their own profile.
-- * A student record belongs to its user (user_id) or, for a "managed student" who hasn't signed up, to the
--   guardian who created it (managed_by). Guardians read a student only through an ACTIVE guardian membership in a
--   household where the student is an ACTIVE member; they edit only when that membership has can_edit.
-- * Nobody joins a household silently: memberships other than the creator's own come only from
--   accept_invitation(), which checks the token, its expiry, and the signed-in user's email.
-- * Ownership columns (students.user_id, managed_by) never change through the API, only through accept_invitation().
-- * Removing or deactivating a membership stops access at once: nothing is cached in grants.
--
-- Apply in the Supabase SQL Editor (dev first, then prod). Requires Supabase's auth schema (auth.users, auth.uid()).

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  birth_year   integer,                       -- 13+ only; checked by profiles_check_birth_year()
  role_hint    text check (role_hint in ('student', 'guardian', 'counselor')),
  created      timestamptz not null default now(),
  updated      timestamptz not null default now(),
  deleted_at   timestamptz                    -- soft delete: set by the delete flow, hard-deleted after 30 days
);

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created    timestamptz not null default now(),
  deleted_at timestamptz
);

-- The unit every tool attaches to (profile, lists, follows' owner is the user, not the student).
-- user_id: the student's own account (deleting it deletes the record). managed_by: a guardian's record for a child
-- who hasn't signed up; cleared when the child claims it through an invitation.
create table public.students (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid unique references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  grad_year    integer check (grad_year between 2000 and 2100),
  managed_by   uuid references auth.users (id) on delete set null,
  created      timestamptz not null default now(),
  deleted_at   timestamptz
);

-- A guardian membership names a user; a student membership names a student record. status = 'invited' is
-- reserved for a future "pending" row; today pending invitations live in public.invitations and only 'active'
-- rows grant anything. can_edit applies to guardian rows: it lets that guardian edit the household's students.
create table public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  student_id    uuid references public.students (id) on delete cascade,
  role          text not null check (role in ('guardian', 'student')),
  status        text not null default 'active' check (status in ('invited', 'active')),
  invited_email text,
  can_edit      boolean not null default false,
  created       timestamptz not null default now(),
  accepted_at   timestamptz,
  constraint household_members_shape check (
    (role = 'guardian' and student_id is null and (user_id is not null or status = 'invited'))
    or (role = 'student' and user_id is null and (student_id is not null or status = 'invited'))
  ),
  constraint household_members_user unique (household_id, user_id),
  constraint household_members_student unique (household_id, student_id)
);

create index household_members_user_idx on public.household_members (user_id);
create index household_members_student_idx on public.household_members (student_id);

-- Invitation links. Only a SHA-256 hash of the token is stored; the token itself is returned once by
-- create_invitation() and shown/emailed to the inviter. side = the role the invitee joins as.
create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token_hash   text not null unique,
  email        text not null check (position('@' in email) > 1),
  side         text not null check (side in ('guardian', 'student')),
  student_id   uuid references public.students (id) on delete cascade,  -- side 'student': the managed record to claim
  can_edit     boolean not null default false,                           -- side 'guardian': edit access once joined
  invited_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created      timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz
);

create index invitations_household_idx on public.invitations (household_id);

-- Guardian reads of a student's data, shown to the student in /account. Written only by log_access().
create table public.access_log (
  id         bigint generated always as identity primary key,
  viewer_id  uuid not null references auth.users (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  table_name text not null check (char_length(table_name) <= 64),
  at         timestamptz not null default now()
);

create index access_log_student_idx on public.access_log (student_id, at desc);

/* ------------------------------------------------------------------ */
/* Helper functions (security definer: they read past RLS, so they     */
/* must stay narrow and only ever answer about auth.uid())             */
/* ------------------------------------------------------------------ */

-- The 13+ rule from a birth year alone (lib/accounts.ts birthYearAllowed mirrors it): someone born in year Y is
-- certainly 13 only from the start of year Y + 14, so a birth year 13 years back is refused.
create function public.birth_year_allowed(p_year integer, p_today date default current_date) returns boolean
language sql
stable
set search_path = ''
as $$
  select p_year is not null
     and p_year >= extract(year from p_today)::integer - 120
     and extract(year from p_today)::integer - p_year >= 14
$$;

-- The signed-in user's own (not deleted) student record.
create function public.is_own_student(p_student uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student and s.user_id = auth.uid() and s.deleted_at is null
  )
$$;

-- An active guardian membership of the signed-in user in a live household where p_student is an active member.
-- p_need_edit also requires can_edit on that membership.
create function public.is_guardian_of(p_student uuid, p_need_edit boolean) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members g
    join public.household_members m on m.household_id = g.household_id
    join public.households h on h.id = g.household_id
    where g.user_id = auth.uid()
      and g.role = 'guardian' and g.status = 'active'
      and (g.can_edit or not p_need_edit)
      and m.student_id = p_student and m.role = 'student' and m.status = 'active'
      and h.deleted_at is null
  )
$$;

-- Own record, a managed record I created, or an active guardian in a shared household.
create function public.can_read_student(p_student uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.students s
    where s.id = p_student and s.deleted_at is null
      and (s.user_id = auth.uid() or s.managed_by = auth.uid() or public.is_guardian_of(s.id, false))
  )
$$;

-- Own record, a managed record I created, or an active guardian with can_edit in a shared household.
create function public.can_edit_student(p_student uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.students s
    where s.id = p_student and s.deleted_at is null
      and (s.user_id = auth.uid() or s.managed_by = auth.uid() or public.is_guardian_of(s.id, true))
  )
$$;

-- An active member of a live household: as a guardian, or through my own student record. Used by the household
-- policies (a policy on household_members can't query household_members itself without recursing).
create function public.is_household_member(p_household uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    join public.households h on h.id = m.household_id
    left join public.students s on s.id = m.student_id
    where m.household_id = p_household and m.status = 'active' and h.deleted_at is null
      and (m.user_id = auth.uid() or (s.user_id = auth.uid() and s.deleted_at is null))
  )
$$;

-- Whether anyone (active) belongs to a household: a creator who has left stops seeing it once others remain.
create function public.household_has_members(p_household uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.household_members m where m.household_id = p_household and m.status = 'active')
$$;

-- An active guardian of a live household.
create function public.is_household_guardian(p_household uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members g
    join public.households h on h.id = g.household_id
    where g.household_id = p_household and g.user_id = auth.uid() and g.role = 'guardian' and g.status = 'active'
      and h.deleted_at is null
  )
$$;

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

-- 13+ only (accounts.md "Minors"). The login form refuses first; this makes the database refuse too, including a
-- later change in /account. Null is allowed (accounts created before this migration, or from the dashboard) and the
-- app asks for it.
create function public.profiles_check_birth_year() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.birth_year is not null and not public.birth_year_allowed(new.birth_year) then
    raise exception 'birth_year_not_allowed' using errcode = '23514';
  end if;
  new.updated := now();
  return new;
end;
$$;

create trigger profiles_check_birth_year
before insert or update on public.profiles
for each row execute function public.profiles_check_birth_year();

-- A profile for every new auth user, from the metadata the login form sends with signInWithOtp
-- (options.data: birth_year, role_hint, display_name). Unknown or malformed values are dropped, never fatal,
-- except a birth year under the 13+ rule, which makes the sign-up fail.
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_year integer;
  v_role text := v_meta ->> 'role_hint';
begin
  if (v_meta ->> 'birth_year') ~ '^\d{4}$' then
    v_year := (v_meta ->> 'birth_year')::integer;
  end if;
  if v_role is not null and v_role not in ('student', 'guardian', 'counselor') then
    v_role := null;
  end if;
  insert into public.profiles (id, display_name, birth_year, role_hint)
  values (new.id, nullif(left(btrim(v_meta ->> 'display_name'), 80), ''), v_year, v_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Who owns a student record changes only inside accept_invitation() (security definer, so current_user is the
-- function's owner there). A guardian with can_edit can rename a record but can't take it over.
create function public.students_guard_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.user_id is distinct from old.user_id or new.managed_by is distinct from old.managed_by) then
    raise exception 'students_owner_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger students_guard_owner
before update on public.students
for each row execute function public.students_guard_owner();

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.students enable row level security;
alter table public.household_members enable row level security;
alter table public.invitations enable row level security;
alter table public.access_log enable row level security;

-- profiles: own row only. (Names of other household members come through B's functions, never this table, so a
-- guardian never reads a student's birth year and vice versa.)
create policy "Profiles: read own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "Profiles: create own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Profiles: update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- households: members, and the creator while it has no members yet (so insert ... returning works before the
-- creator's own membership exists; a creator who leaves a household others still belong to stops seeing it).
create policy "Households: members read" on public.households for select to authenticated
  using (deleted_at is null
    and (public.is_household_member(id) or (created_by = auth.uid() and not public.household_has_members(id))));
create policy "Households: create" on public.households for insert to authenticated
  with check (created_by = auth.uid());
create policy "Households: members update" on public.households for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

-- students. The direct column checks come first so insert ... returning works (the helper functions run on the
-- statement's snapshot, which doesn't contain the new row yet). The owner (or managing guardian) still sees a
-- soft-deleted record, which is what lets them set deleted_at (Postgres checks an updated row against the select
-- policy too) and restore it within the 30 days; guardians lose it at once (can_read_student skips deleted rows).
-- App reads filter deleted_at is null.
create policy "Students: read" on public.students for select to authenticated
  using (user_id = auth.uid() or managed_by = auth.uid() or public.can_read_student(id));
create policy "Students: create own or managed" on public.students for insert to authenticated
  with check ((user_id = auth.uid() and managed_by is null) or (user_id is null and managed_by = auth.uid()));
create policy "Students: edit" on public.students for update to authenticated
  using (user_id = auth.uid() or managed_by = auth.uid() or public.can_edit_student(id))
  with check (user_id = auth.uid() or managed_by = auth.uid() or public.can_edit_student(id));

-- household_members: co-members see each other; I see my own rows.
create policy "Members: read" on public.household_members for select to authenticated
  using (public.is_household_member(household_id) or user_id = auth.uid() or public.is_own_student(student_id));
-- Direct inserts only for the household's creator adding themselves (as guardian, or with their own student
-- record), or a guardian adding a managed student they created to a household they belong to. Everyone else joins
-- through accept_invitation().
create policy "Members: creator joins, guardian adds managed student" on public.household_members
  for insert to authenticated
  with check (
    status = 'active'
    and (
      (exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid())
        and ((role = 'guardian' and user_id = auth.uid()) or (role = 'student' and public.is_own_student(student_id))))
      or (role = 'student'
        and exists (select 1 from public.students s where s.id = student_id and s.managed_by = auth.uid() and s.user_id is null)
        and public.is_household_guardian(household_id))
    )
  );
-- Either side can leave at any time.
create policy "Members: leave" on public.household_members for delete to authenticated
  using (user_id = auth.uid() or public.is_own_student(student_id));

-- invitations: the household's active members see them (an inviter who has left doesn't); revoking is an update
-- of revoked_at, the only column the API may change.
create policy "Invitations: members read" on public.invitations for select to authenticated
  using (public.is_household_member(household_id));
create policy "Invitations: members revoke" on public.invitations for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- access_log: the student sees who viewed their data; a viewer sees their own entries.
create policy "Access log: student and viewer read" on public.access_log for select to authenticated
  using (public.is_own_student(student_id) or viewer_id = auth.uid());

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that. Signed-out
-- visitors (anon) get nothing at all.
revoke all on public.profiles, public.households, public.students, public.household_members, public.invitations,
  public.access_log from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.households to authenticated;
grant select, insert, update on public.students to authenticated;
grant select, insert, delete on public.household_members to authenticated;
grant select on public.invitations to authenticated;
grant update (revoked_at) on public.invitations to authenticated;
grant select on public.access_log to authenticated;
grant all on public.profiles, public.households, public.students, public.household_members, public.invitations,
  public.access_log to service_role;

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

-- Create an invitation to a household the caller is an active member of. Returns {id, token, expires_at}; the
-- token is shown once (only its hash is stored). Who may invite whom:
--   side 'guardian': any active member. can_edit is honored only when a student invites (the student decides
--     whether a guardian may edit); a guardian inviting another guardian always gives view-only access.
--   side 'student': active guardians only. p_student, if given, must be a managed record the caller created and
--     a member of the household; the invitee claims it on accepting.
create function public.create_invitation(
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

-- Accept an invitation as the signed-in user. Refuses (with these messages) a token that doesn't exist or whose
-- household was deleted (invitation_not_found), was revoked (invitation_revoked), was already used
-- (invitation_used), has expired (invitation_expired), was sent to a different email (invitation_wrong_email), or
-- was created by the caller (invitation_own). Returns the household id.
--   side 'guardian': the caller becomes an active guardian (with the invitation's can_edit).
--   side 'student': the caller's student record joins the household: the managed record named by the invitation,
--     claimed (user_id set, managed_by cleared) when the caller has no record yet; otherwise the caller's own
--     record, created if needed. A caller who already has a record keeps it and the managed one stays as it was.
create function public.accept_invitation(p_token text) returns uuid
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

-- What an invitation link shows before it's accepted (the token is the credential, so signed-out visitors may ask):
-- the household's name, who sent it, which side, its expiry, and its state. Never the invited email. Null when the
-- token is unknown.
create function public.invitation_preview(p_token text) returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'household_name', h.name,
    'inviter_name', p.display_name,
    'side', i.side,
    'expires_at', i.expires_at,
    'state', case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'used'
      when i.expires_at <= now() then 'expired'
      else 'pending' end
  )
  from public.invitations i
  join public.households h on h.id = i.household_id and h.deleted_at is null
  left join public.profiles p on p.id = i.invited_by
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- Record that the signed-in user (as a guardian) read one of a student's tables. A student reading their own data,
-- or anyone without read access, records nothing.
create function public.log_access(p_student uuid, p_table text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_own_student(p_student) or not public.can_read_student(p_student) then
    return;
  end if;
  insert into public.access_log (viewer_id, student_id, table_name) values (auth.uid(), p_student, left(p_table, 64));
end;
$$;

/* ------------------------------------------------------------------ */
/* Function privileges                                                 */
/* ------------------------------------------------------------------ */

revoke execute on function public.birth_year_allowed(integer, date) from public, anon;
revoke execute on function public.is_own_student(uuid) from public, anon;
revoke execute on function public.is_guardian_of(uuid, boolean) from public, anon;
revoke execute on function public.can_read_student(uuid) from public, anon;
revoke execute on function public.can_edit_student(uuid) from public, anon;
revoke execute on function public.is_household_member(uuid) from public, anon;
revoke execute on function public.is_household_guardian(uuid) from public, anon;
revoke execute on function public.household_has_members(uuid) from public, anon;
revoke execute on function public.create_invitation(uuid, text, text, uuid, boolean) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
revoke execute on function public.invitation_preview(text) from public;
revoke execute on function public.log_access(uuid, text) from public, anon;
revoke execute on function public.profiles_check_birth_year() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.students_guard_owner() from public, anon, authenticated;

grant execute on function public.birth_year_allowed(integer, date) to authenticated, service_role;
grant execute on function public.is_own_student(uuid) to authenticated, service_role;
grant execute on function public.is_guardian_of(uuid, boolean) to authenticated, service_role;
grant execute on function public.can_read_student(uuid) to authenticated, service_role;
grant execute on function public.can_edit_student(uuid) to authenticated, service_role;
grant execute on function public.is_household_member(uuid) to authenticated, service_role;
grant execute on function public.is_household_guardian(uuid) to authenticated, service_role;
grant execute on function public.household_has_members(uuid) to authenticated, service_role;
grant execute on function public.create_invitation(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;
grant execute on function public.log_access(uuid, text) to authenticated;
