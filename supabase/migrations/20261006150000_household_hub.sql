-- The household hub (specs/product/household-hub.md): people by name, one list each, "follow" as a switch on each
-- college on a list. Builds on every user-data migration before it (accounts, households, follows, lists,
-- invitation links, household limits); apply after 20261006120000_high_school_search.sql (SQL Editor, dev first, then
-- prod). Tested in tests/household-hub-policies.test.mts (PGlite + the auth stub, every assertion as a signed-in user),
-- with guard tests that break a rule on purpose and show the checks notice.
--
-- What changes, and why:
-- 1. Phones. profiles.phone and students.phone (E.164, checked by a regex): the add-person form asks for one and the
--    roster shows it to the household. Nothing sends to it yet (owner decision 4). The sign-up trigger copies a valid
--    phone from the user's metadata, as it copies the name, so an invited person's profile has it from the start.
-- 2. Invitations carry the person: display_name, phone, grad_year, so a pending invitation shows in the roster by
--    name. And token: the clear token of a PENDING invitation, so "Copy link" works from the roster (owner decision
--    2). It is readable by the household's members only (the existing select policy), never returned by
--    invitation_preview(), and cleared by a trigger the moment the invitation is accepted or revoked. The hash stays
--    for the lookup.
-- 3. One list per person, parents included. A list's owner is a student record (student_id, as before) OR a user
--    (user_id: a guardian, who has no student record); a check makes it exactly one. A guardian's list is readable by
--    every active member of their household and writable by the guardian only (owner decision 3); a student's list
--    keeps its rules. list_items and list_notes policies now go through can_read_list()/can_edit_list(), which handle
--    both owner kinds, so later tables (plan steps) can reuse them. A trigger stops the API from moving a list to a
--    different owner (a guardian with edit access could otherwise turn a student's list into their own).
-- 4. Tracking columns on list items: updates (the per-college "tell me when this changes" switch, on by default),
--    visited_on, follows_social.
-- 5. Follows become a table the database maintains from list_items.updates. Every 'manual' follow is moved into the
--    user's default list (their own student record's, created if missing; or, for a user without one, a list they
--    own) as an 'unsorted' item, so nobody loses an update; then follows.source is always 'list' and the API can no
--    longer write follows directly.
-- 6. The follows trigger is rewritten. The user to notify for a list is lists.user_id, else the student's own
--    account, else the guardian who manages the record (a managed student has no account). It fires on insert,
--    delete, and changes of updates (or of an item's list/college): a follow exists exactly while some item on a
--    list resolving to that user, for that college, has updates on. When a list or a student record changes hands
--    (a managed student claimed by their own account, a merge, a guardian taking over a managed record), both the
--    old and the new user are re-synced, which replaces merge_managed_student()'s own follow insert. A one-time
--    re-sync at the end of this file brings existing follows in line (guardians of managed students start following
--    those lists' colleges).
-- 7. household_roster() returns everyone in one list: active members (status 'active', or 'managed' for a student
--    without an account), plus pending invitations as rows (member_id null, status 'invited' or 'expired'). A
--    hand-over invitation for a managed student doesn't add a row: that student's row carries it. New columns:
--    status, invitation_id, expires_at, grad_year, phone, and email, which is filled only on invitations the viewer
--    sent. Students first, then guardians, then by when they joined (or were invited).
-- 8. create_invitation() gains name, phone, and grad year (a new overload; the old signature delegates). Inviting a
--    student by name creates the managed record first and links the invitation to it, so the parent can start the
--    list now and a student with an email takes one seat, not two. Inviting your own email is refused.
--    reissue_invitation() also stores the new clear token.
-- 9. accept_invitation() writes the invitation's name and phone to the profile when it has none, and clears the
--    token. Its body moves into an internal accept_invitation_row() shared with:
-- 10. accept_invitation_by_id(), for the "choose a password" step after the invite Edge Function created the user:
--    only the user the function recorded in invitations.accepted_by may call it.
-- 11. A select policy lets that user read their own invitation row (the welcome page shows the household's name).
-- 12. invitation_preview() is unchanged. New functions: execute revoked from public and anon, granted to
--    authenticated; internal helpers granted to nobody but the service role.

/* ------------------------------------------------------------------ */
/* 1. Phones                                                           */
/* ------------------------------------------------------------------ */

alter table public.profiles add column phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');
alter table public.students add column phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');

-- The sync below looks up a guardian's managed records by managed_by.
create index students_managed_by_idx on public.students (managed_by) where user_id is null;

-- handle_new_user() as in 20261005120000_accounts.sql, plus a phone from the metadata when it is valid E.164 (the
-- invite Edge Function passes the invitation's). Anything else is dropped, never fatal.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_year integer;
  v_role text := v_meta ->> 'role_hint';
  v_phone text := v_meta ->> 'phone';
begin
  if (v_meta ->> 'birth_year') ~ '^\d{4}$' then
    v_year := (v_meta ->> 'birth_year')::integer;
  end if;
  if v_role is not null and v_role not in ('student', 'guardian', 'counselor') then
    v_role := null;
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    v_phone := null;
  end if;
  insert into public.profiles (id, display_name, birth_year, role_hint, phone)
  values (new.id, nullif(left(btrim(v_meta ->> 'display_name'), 80), ''), v_year, v_role, v_phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

/* ------------------------------------------------------------------ */
/* 2. Invitations carry the person and, while pending, the token       */
/* ------------------------------------------------------------------ */

alter table public.invitations
  add column display_name text check (char_length(display_name) <= 80),
  add column phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column grad_year integer check (grad_year between 2000 and 2100),
  add column token text;

-- 11. The token is a credential only while the invitation is pending: gone the moment it's accepted or revoked.
create function public.invitations_clear_token() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepted_at is not null or new.revoked_at is not null then
    new.token := null;
  end if;
  return new;
end;
$$;

create trigger invitations_clear_token
before insert or update on public.invitations
for each row execute function public.invitations_clear_token();

-- The person an invitation was redeemed for (invitations.accepted_by, set by the invite Edge Function when it creates
-- their account) reads that one row: the password page shows whose household it is. They are not a member yet, so
-- "Invitations: members read" doesn't cover them.
create policy "Invitations: invited user reads own" on public.invitations for select to authenticated
  using (accepted_by = auth.uid());

/* ------------------------------------------------------------------ */
/* 3. Lists: a student's or a user's                                   */
/* ------------------------------------------------------------------ */

alter table public.lists alter column student_id drop not null;
alter table public.lists add column user_id uuid references auth.users (id) on delete cascade;
alter table public.lists add constraint lists_one_owner check ((student_id is null) <> (user_id is null));

create unique index lists_one_default_user_idx on public.lists (user_id) where is_default;
create index lists_user_idx on public.lists (user_id);

-- Who may read a list with this owner: a user's list, its owner and every active member of the owner's household; a
-- student's list, whoever can read the student. Takes the owner columns (not a list id) so the lists policies can
-- check a row that isn't in the table yet (insert ... returning).
create function public.can_read_list_owner(p_student uuid, p_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and case
    when p_user is not null then p_user = auth.uid() or public.is_household_member(public.household_of(p_user))
    else coalesce(public.can_read_student(p_student), false)
  end
$$;

-- Who may change a list with this owner: a user's list, its owner only; a student's list, whoever can edit the student.
create function public.can_edit_list_owner(p_student uuid, p_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and case
    when p_user is not null then p_user = auth.uid()
    else coalesce(public.can_edit_student(p_student), false)
  end
$$;

-- The same two questions by list id, for tables hanging off a list (items, notes, and later plan steps).
create function public.can_read_list(p_list uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lists l where l.id = p_list and public.can_read_list_owner(l.student_id, l.user_id))
$$;

create function public.can_edit_list(p_list uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lists l where l.id = p_list and public.can_edit_list_owner(l.student_id, l.user_id))
$$;

drop policy "Lists: read" on public.lists;
drop policy "Lists: create" on public.lists;
drop policy "Lists: update" on public.lists;
drop policy "Lists: delete extra lists" on public.lists;

create policy "Lists: read" on public.lists for select to authenticated
  using (public.can_read_list_owner(student_id, user_id));
create policy "Lists: create" on public.lists for insert to authenticated
  with check (public.can_edit_list_owner(student_id, user_id));
create policy "Lists: update" on public.lists for update to authenticated
  using (public.can_edit_list_owner(student_id, user_id)) with check (public.can_edit_list_owner(student_id, user_id));
-- The default list can't be deleted (there's always one list to add to); extra lists can.
create policy "Lists: delete extra lists" on public.lists for delete to authenticated
  using (public.can_edit_list_owner(student_id, user_id) and not is_default);

drop policy "Items: read" on public.list_items;
drop policy "Items: create" on public.list_items;
drop policy "Items: update" on public.list_items;
drop policy "Items: delete" on public.list_items;

create policy "Items: read" on public.list_items for select to authenticated using (public.can_read_list(list_id));
create policy "Items: create" on public.list_items for insert to authenticated with check (public.can_edit_list(list_id));
create policy "Items: update" on public.list_items for update to authenticated
  using (public.can_edit_list(list_id)) with check (public.can_edit_list(list_id));
create policy "Items: delete" on public.list_items for delete to authenticated using (public.can_edit_list(list_id));

drop policy "Notes: read" on public.list_notes;
drop policy "Notes: create" on public.list_notes;

-- Notes: anyone who can read the list reads a non-private note; a private note only its author reads.
create policy "Notes: read" on public.list_notes for select to authenticated
  using (
    author_id = auth.uid()
    or (not private and exists (select 1 from public.list_items li where li.id = item_id and public.can_read_list(li.list_id)))
  );
create policy "Notes: create" on public.list_notes for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.list_items li where li.id = item_id and public.can_edit_list(li.list_id))
  );

-- A list's owner changes only inside the database's own functions (merge_managed_student moves a managed record's
-- lists to the student's own record). Through the API, a guardian with edit access could otherwise point a
-- student's list at themselves.
create function public.lists_guard_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.student_id is distinct from old.student_id or new.user_id is distinct from old.user_id) then
    raise exception 'lists_owner_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger lists_guard_owner
before update on public.lists
for each row execute function public.lists_guard_owner();

-- set_list_share() as in 20261005150000_lists.sql, for either owner kind.
create or replace function public.set_list_share(p_list uuid, p_enabled boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.can_edit_list(p_list) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_enabled then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update public.lists set share_enabled = true, share_token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
      where id = p_list;
    return v_token;
  else
    update public.lists set share_enabled = false, share_token_hash = null where id = p_list;
    return null;
  end if;
end;
$$;

/* ------------------------------------------------------------------ */
/* 4. Tracking columns                                                 */
/* ------------------------------------------------------------------ */

alter table public.list_items
  add column updates boolean not null default true,
  add column visited_on date,
  add column follows_social boolean not null default false;

/* ------------------------------------------------------------------ */
/* 6. Follows, maintained from list_items.updates                      */
/* ------------------------------------------------------------------ */

-- The user notified about a list owned this way: a user's own list, else the student's account, else the guardian
-- managing a record that has no account. Null for a list nobody can be notified about.
create function public.list_owner_user(p_student uuid, p_user uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_user, (select coalesce(s.user_id, s.managed_by) from public.students s where s.id = p_student))
$$;

create function public.list_notify_user(p_list uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.list_owner_user(l.student_id, l.user_id) from public.lists l where l.id = p_list
$$;

-- Whether some item for p_unit, on a list resolving to p_user, has updates on.
create function public.wants_updates(p_user uuid, p_unit text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lists l
    join public.list_items li on li.list_id = l.id and li.unit_id = p_unit
    where li.updates
      and (l.user_id = p_user
        or l.student_id in (select s.id from public.students s where s.user_id = p_user or (s.user_id is null and s.managed_by = p_user)))
  )
$$;

-- Makes one follow match the lists: present while wants_updates(), absent otherwise.
create function public.sync_follow(p_user uuid, p_unit text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or p_unit is null then
    return;
  end if;
  if public.wants_updates(p_user, p_unit) then
    insert into public.follows (user_id, unit_id, source) values (p_user, p_unit, 'list')
    on conflict (user_id, unit_id) do nothing;
  else
    delete from public.follows where user_id = p_user and unit_id = p_unit;
  end if;
end;
$$;

-- Makes all of a user's follows match the lists (after a list or a student record changes hands).
create function public.sync_user_follows(p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then
    return;
  end if;
  delete from public.follows f where f.user_id = p_user and not public.wants_updates(p_user, f.unit_id);
  insert into public.follows (user_id, unit_id, source)
    select distinct p_user, li.unit_id, 'list'
    from public.lists l
    join public.list_items li on li.list_id = l.id
    where li.updates
      and (l.user_id = p_user
        or l.student_id in (select s.id from public.students s where s.user_id = p_user or (s.user_id is null and s.managed_by = p_user)))
  on conflict (user_id, unit_id) do nothing;
end;
$$;

-- Replaces 20261005150000_lists.sql's version: every owner kind, and the updates switch. On delete (the row is gone
-- by now) or updates turned off, the follow goes unless another item for the same user and college still has
-- updates on; on insert or updates turned on, it's added.
create or replace function public.list_items_sync_follows() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sync_follow(public.list_notify_user(old.list_id), old.unit_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_follow(public.list_notify_user(new.list_id), new.unit_id);
    return new;
  end if;
  return old;
end;
$$;

drop trigger list_items_sync_follows_insert on public.list_items;
drop trigger list_items_sync_follows_delete on public.list_items;

create trigger list_items_sync_follows
after insert or delete or update of updates, list_id, unit_id on public.list_items
for each row execute function public.list_items_sync_follows();

-- A list changing owner (merge_managed_student) re-syncs the old and the new owner's user.
create function public.lists_sync_follows() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid := public.list_owner_user(old.student_id, old.user_id);
  v_new uuid := public.list_owner_user(new.student_id, new.user_id);
begin
  if v_old is distinct from v_new then
    perform public.sync_user_follows(v_old);
    perform public.sync_user_follows(v_new);
  end if;
  return new;
end;
$$;

create trigger lists_sync_follows
after update of student_id, user_id on public.lists
for each row execute function public.lists_sync_follows();

-- A student record changing hands (claimed by the student's own account, or handed to another guardian when its
-- manager deletes their account) re-syncs the old and the new user.
create function public.students_sync_follows() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(old.user_id, old.managed_by) is distinct from coalesce(new.user_id, new.managed_by) then
    perform public.sync_user_follows(coalesce(old.user_id, old.managed_by));
    perform public.sync_user_follows(coalesce(new.user_id, new.managed_by));
  end if;
  return new;
end;
$$;

create trigger students_sync_follows
after update of user_id, managed_by on public.students
for each row execute function public.students_sync_follows();

-- merge_managed_student() as in 20261005170000_household_limits_and_home.sql, without its own follow insert: moving
-- the lists fires lists_sync_follows, which follows exactly the colleges with updates on.
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

/* ------------------------------------------------------------------ */
/* 5. Manual follows move into default lists; source is always 'list'  */
/* ------------------------------------------------------------------ */

-- One-time: each 'manual' follow becomes an 'unsorted' item, updates on, on the user's default list: their own
-- student record's (created as "My list" if missing), or, for a user without one (a guardian), a default list they
-- own. A college already on one of their lists with updates on is left where it is. The trigger above keeps the
-- follow itself (it already exists).
do $$
declare
  r record;
  v_student uuid;
  v_list uuid;
begin
  for r in select f.user_id, f.unit_id from public.follows f where f.source = 'manual' order by f.user_id, f.created, f.unit_id loop
    continue when public.wants_updates(r.user_id, r.unit_id);
    v_list := null;
    select s.id into v_student from public.students s where s.user_id = r.user_id and s.deleted_at is null;
    if v_student is not null then
      select l.id into v_list from public.lists l where l.student_id = v_student and l.is_default;
      if v_list is null then
        insert into public.lists (student_id, name, is_default, created_by) values (v_student, 'My list', true, r.user_id)
        returning id into v_list;
      end if;
    else
      select l.id into v_list from public.lists l where l.user_id = r.user_id and l.is_default;
      if v_list is null then
        insert into public.lists (user_id, name, is_default, created_by) values (r.user_id, 'My list', true, r.user_id)
        returning id into v_list;
      end if;
    end if;
    insert into public.list_items (list_id, unit_id, category, updates, added_by, position)
    values (
      v_list, r.unit_id, 'unsorted', true, r.user_id,
      coalesce((select max(li.position) + 1 from public.list_items li where li.list_id = v_list), 0)
    )
    on conflict (list_id, unit_id) do update set updates = true;
  end loop;
end;
$$;

update public.follows set source = 'list' where source <> 'list';
alter table public.follows drop constraint follows_source_check;
alter table public.follows add constraint follows_source_check check (source = 'list');
alter table public.follows alter column source set default 'list';

-- One-time: bring every follow in line with the new rule (guardians managing a student now follow that student's
-- colleges; follows a deleted list left behind go).
do $$
declare
  v_user uuid;
begin
  for v_user in
    select f.user_id from public.follows f
    union
    select public.list_owner_user(l.student_id, l.user_id) from public.lists l
  loop
    perform public.sync_user_follows(v_user);
  end loop;
end;
$$;

-- Follows are written only by the triggers above now (the Follow button is gone); the user still reads their own.
revoke insert, update, delete on public.follows from authenticated;

/* ------------------------------------------------------------------ */
/* 7. The roster: everyone, by name, with their status                 */
/* ------------------------------------------------------------------ */

-- The return type changes, so the function is dropped and created again (grants restated below).
drop function public.household_roster(uuid);

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
  joined timestamptz,
  status text,
  invitation_id uuid,
  expires_at timestamptz,
  grad_year integer,
  phone text,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select
      m.id as member_id,
      m.role,
      m.user_id,
      m.student_id,
      case when m.role = 'guardian' then gp.display_name else coalesce(s.display_name, sp.display_name) end as display_name,
      m.can_edit,
      m.role = 'student' and s.user_id is null as managed,
      m.role = 'student' and s.user_id is null and s.managed_by = auth.uid() as managed_by_me,
      m.user_id = auth.uid() or (s.user_id is not null and s.user_id = auth.uid()) as is_me,
      coalesce(m.accepted_at, m.created) as joined,
      case
        when m.role = 'guardian' or s.user_id is not null then 'active'
        when hand.id is null then 'managed'
        when hand.expires_at > now() then 'invited'
        else 'expired'
      end as status,
      hand.id as invitation_id,
      hand.expires_at,
      case when m.role = 'student' then s.grad_year end as grad_year,
      case when m.role = 'guardian' then gp.phone else coalesce(s.phone, sp.phone) end as phone,
      case when hand.invited_by = auth.uid() then hand.email end as email,
      m.id as tiebreak
    from public.household_members m
    left join public.profiles gp on gp.id = m.user_id
    left join public.students s on s.id = m.student_id
    left join public.profiles sp on sp.id = s.user_id
    -- A managed student's hand-over invitation, if one is pending (the newest).
    left join lateral (
      select i.id, i.expires_at, i.email, i.invited_by
      from public.invitations i
      where m.role = 'student' and s.user_id is null
        and i.household_id = m.household_id and i.student_id = m.student_id
        and i.accepted_at is null and i.revoked_at is null
      order by i.created desc, i.id
      limit 1
    ) hand on true
    where m.household_id = p_household
      and m.status = 'active'
      and ((m.role = 'guardian' and gp.deleted_at is null) or (m.role = 'student' and s.deleted_at is null))
  ),
  pending as (
    select
      null::uuid as member_id,
      i.side as role,
      null::uuid as user_id,
      null::uuid as student_id,
      i.display_name,
      i.can_edit,
      false as managed,
      false as managed_by_me,
      false as is_me,
      i.created as joined,
      case when i.expires_at > now() then 'invited' else 'expired' end as status,
      i.id as invitation_id,
      i.expires_at,
      i.grad_year,
      i.phone,
      case when i.invited_by = auth.uid() then i.email end as email,
      i.id as tiebreak
    from public.invitations i
    where i.household_id = p_household and i.student_id is null
      and i.accepted_at is null and i.revoked_at is null
  )
  select r.member_id, r.role, r.user_id, r.student_id, r.display_name, r.can_edit, r.managed, r.managed_by_me, r.is_me,
         r.joined, r.status, r.invitation_id, r.expires_at, r.grad_year, r.phone, r.email
  from (select * from members union all select * from pending) r
  where public.is_household_member(p_household)
  order by r.role = 'guardian', r.joined, r.tiebreak
$$;

/* ------------------------------------------------------------------ */
/* 8. create_invitation(): the person's name, phone, and grad year     */
/* ------------------------------------------------------------------ */

-- The new overload. As in 20261005170000_household_limits_and_home.sql, plus:
-- * p_display_name, p_phone (E.164 or null), p_grad_year are stored on the invitation (the roster shows them).
-- * Side 'student' with a name and no p_student: the managed record is created first (add_managed_student(), which
--   checks the seat) with the name, grad year, and phone, and the invitation hands it over, so the student takes one
--   seat. Without a name it stays a plain student invitation, as before.
-- * The clear token is stored (invitations.token) until the invitation is accepted or revoked.
-- * Inviting your own email is refused (invite_self).
-- Returns {id, token, expires_at, student_id}.
create function public.create_invitation(
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
    p_side = 'guardian' and not v_is_guardian and coalesce(p_can_edit, false),
    v_uid,
    v_name,
    v_phone,
    case when p_side = 'student' then p_grad_year end
  )
  returning * into v_row;

  return json_build_object('id', v_row.id, 'token', v_token, 'expires_at', v_row.expires_at, 'student_id', v_row.student_id);
end;
$$;

-- The old signature, kept for callers that don't send a name: delegates with nulls (so it now stores the token too).
create or replace function public.create_invitation(
  p_household uuid,
  p_email text,
  p_side text,
  p_student uuid default null,
  p_can_edit boolean default false
) returns json
language sql
security definer
set search_path = ''
as $$
  select public.create_invitation(p_household, p_email, p_side, p_student, p_can_edit, null::text, null::text, null::integer)
$$;

-- reissue_invitation() as in 20261005160000_invitation_links.sql, plus the new clear token stored for Copy link.
create or replace function public.reissue_invitation(p_invitation uuid) returns json
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
    set token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), token = v_token, expires_at = v_expires
    where id = p_invitation;
  return json_build_object('id', p_invitation, 'token', v_token, 'expires_at', v_expires, 'email', v_inv.email, 'side', v_inv.side);
end;
$$;

/* ------------------------------------------------------------------ */
/* 9, 10. Accepting                                                    */
/* ------------------------------------------------------------------ */

-- The body of accept_invitation() from 20261005170000_household_limits_and_home.sql, for an invitation row already
-- found and locked, plus: the invitation's name and phone go on the caller's profile when it has none (a claimed
-- student record keeps its own name), and the token is cleared. Internal: called by accept_invitation() and
-- accept_invitation_by_id().
create function public.accept_invitation_row(v_inv public.invitations) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_student uuid;
  v_claimed integer;
  v_current uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
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

  -- The name and phone the inviter typed, when the person hasn't set their own.
  update public.profiles p
    set display_name = case when nullif(btrim(coalesce(p.display_name, '')), '') is null then coalesce(v_inv.display_name, p.display_name) else p.display_name end,
        phone = coalesce(p.phone, v_inv.phone)
    where p.id = v_uid;

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
      insert into public.students (user_id, display_name, grad_year, phone)
      values (v_uid, (select p.display_name from public.profiles p where p.id = v_uid), v_inv.grad_year, v_inv.phone)
      returning id into v_student;
    end if;
    insert into public.household_members (household_id, student_id, role, status, accepted_at)
    values (v_inv.household_id, v_student, 'student', 'active', now())
    on conflict (household_id, student_id)
      do update set status = 'active', accepted_at = now();
  end if;

  update public.invitations set accepted_at = now(), accepted_by = v_uid, token = null where id = v_inv.id;
  return v_inv.household_id;
end;
$$;

-- Accept by token (the /invite/[token] page). Same refusals as before.
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  if auth.uid() is null then
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
  return public.accept_invitation_row(v_inv);
end;
$$;

-- Accept by id, for the "choose a password" step: the invite Edge Function created this user's account and wrote
-- their id to invitations.accepted_by, so only that user may accept it this way (anyone else, or an invitation the
-- function never touched, gets invitation_not_found). The rest is accept_invitation_row(): pending, unexpired, same
-- email. Returns the household id.
create function public.accept_invitation_by_id(p_invitation uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select i.* into v_inv
  from public.invitations i
  join public.households h on h.id = i.household_id and h.deleted_at is null
  where i.id = p_invitation
  for update of i;
  if not found or v_inv.accepted_by is distinct from auth.uid() then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  return public.accept_invitation_row(v_inv);
end;
$$;

/* ------------------------------------------------------------------ */
/* 12. Function privileges                                             */
/* ------------------------------------------------------------------ */

-- Replaced functions (create or replace) keep their grants; household_roster was dropped, so its grants are restated.
revoke execute on function public.household_roster(uuid) from public, anon;
grant execute on function public.household_roster(uuid) to authenticated;

revoke execute on function public.create_invitation(uuid, text, text, uuid, boolean, text, text, integer) from public, anon;
grant execute on function public.create_invitation(uuid, text, text, uuid, boolean, text, text, integer) to authenticated;
revoke execute on function public.accept_invitation_by_id(uuid) from public, anon;
grant execute on function public.accept_invitation_by_id(uuid) to authenticated;

-- Policy helpers: callable by signed-in users (policies run as them), like can_read_student.
revoke execute on function public.can_read_list_owner(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_list_owner(uuid, uuid) from public, anon;
revoke execute on function public.can_read_list(uuid) from public, anon;
revoke execute on function public.can_edit_list(uuid) from public, anon;
grant execute on function public.can_read_list_owner(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_edit_list_owner(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_read_list(uuid) to authenticated, service_role;
grant execute on function public.can_edit_list(uuid) to authenticated, service_role;

-- Internal: triggers and the functions above only.
revoke execute on function public.invitations_clear_token() from public, anon, authenticated;
revoke execute on function public.lists_guard_owner() from public, anon, authenticated;
revoke execute on function public.list_owner_user(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.list_notify_user(uuid) from public, anon, authenticated;
revoke execute on function public.wants_updates(uuid, text) from public, anon, authenticated;
revoke execute on function public.sync_follow(uuid, text) from public, anon, authenticated;
revoke execute on function public.sync_user_follows(uuid) from public, anon, authenticated;
revoke execute on function public.lists_sync_follows() from public, anon, authenticated;
revoke execute on function public.students_sync_follows() from public, anon, authenticated;
revoke execute on function public.accept_invitation_row(public.invitations) from public, anon, authenticated;
grant execute on function public.list_owner_user(uuid, uuid) to service_role;
grant execute on function public.list_notify_user(uuid) to service_role;
grant execute on function public.wants_updates(uuid, text) to service_role;
grant execute on function public.sync_follow(uuid, text) to service_role;
grant execute on function public.sync_user_follows(uuid) to service_role;
