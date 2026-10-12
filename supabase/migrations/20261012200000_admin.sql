-- The admin console (specs/product/admin.md "Model"): who is an admin, the log of every admin action, a paused state
-- on profiles, read policies for the console, and the security-definer functions an admin changes things through.
-- Additive. Builds on every user-data migration before it; apply after 20261011150000_plan_task_kinds.sql (SQL Editor,
-- dev first, then prod). Tested against real Postgres (PGlite + the auth stub) in tests/admin-policies.test.mts, with
-- guard tests that break a rule on purpose and show the checks notice.
--
-- Rules this file encodes:
-- * An admin is a user with an unrevoked row in public.admins, signed in at aal2 (TOTP MFA). is_admin() checks both on
--   every policy and function; the app's requireAdmin() is a convenience, never the guard. is_admin_any_aal() answers
--   "admin, maybe not yet at aal2" for the MFA enrollment step only. A deleted or paused admin is not an admin.
-- * Admin reads go through the admin's own session and the "Admins read" policies below, never the secret key. Those
--   policies also require the console's request header (x-quad-console: 1, sent only by lib/admin/people.ts's client):
--   an admin at aal2 browsing the ordinary site runs queries that rely on row-level security to narrow them (every
--   student, every household), and without the header those queries keep their normal meaning. The header only
--   narrows; it grants nothing without is_admin().
-- * No admin write policy on any table: every change goes through an admin_*() function that checks is_admin() first,
--   makes the change, and writes one admin_log row in the same transaction. admin_log is written only by those
--   functions and the service role (admin_note_auth_action, for the admin-auth Edge Function's Auth calls).
-- * Invitations are read through invitations_admin (no token, no token_hash); a household's home through
--   household_homes_admin (the place line, never the street).
-- * profiles.suspended_at pauses an account: getAccount() (lib/auth.ts) treats the person as signed out. Only the
--   service role (admin-auth) and admin functions set it; a user can't clear their own (trigger).
-- * An admin's view of a student's data writes an access_log row with table_name 'admin'; my_access_log() shows it to
--   the student as "Quad support" and never the admin's name or id. log_access() can no longer write that label.
-- * delete_my_account() and restore_my_account() keep their behavior; their bodies move into internal
--   delete_account_for(user) and restore_account_for(user), which the admin versions share.

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  note       text check (char_length(note) <= 200)
);

-- Every admin action. Nothing here is a secret: no tokens, links, or passwords; emails only in auth.email rows.
-- admin_id survives the admin's own account going away (set null), so the record of what was done stays.
create table public.admin_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references auth.users (id) on delete set null,
  at          timestamptz not null default now(),
  action      text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_kind text check (target_kind in ('user', 'student', 'household', 'invitation', 'member')),
  target_id   text check (char_length(target_id) <= 80),
  details     jsonb not null default '{}'::jsonb,
  request_id  text check (char_length(request_id) <= 80)
);

alter table public.admins enable row level security;
alter table public.admin_log enable row level security;

create index admin_log_at_idx on public.admin_log (at desc, id desc);
create index admin_log_target_idx on public.admin_log (target_kind, target_id, at desc);
create index admin_log_household_idx on public.admin_log ((details ->> 'household_id'), at desc)
  where action in ('household.link', 'household.unlink');

alter table public.profiles
  add column suspended_at timestamptz,
  add column suspended_reason text check (char_length(suspended_reason) <= 500);

/* ------------------------------------------------------------------ */
/* Who is an admin                                                     */
/* ------------------------------------------------------------------ */

-- An unrevoked admin whose account is neither deleted nor paused, at any assurance level. For the MFA step only.
create function public.is_admin_any_aal() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.admins a
    left join public.profiles p on p.id = a.user_id
    where a.user_id = auth.uid() and a.revoked_at is null
      and p.deleted_at is null and p.suspended_at is null
  )
$$;

-- The guard: an admin (as above) whose session passed the second factor.
create function public.is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' and public.is_admin_any_aal()
$$;

-- is_admin() and the console's request header (see the top of this file). PostgREST puts the request's headers in
-- request.headers as JSON with lower-case names.
create function public.admin_reads() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-quad-console', '') = '1'
     and public.is_admin()
$$;

/* ------------------------------------------------------------------ */
/* Paused accounts                                                     */
/* ------------------------------------------------------------------ */

-- profiles is the user's own row to edit, but the pause is not theirs to lift (or set).
create function public.profiles_guard_suspension() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and (new.suspended_at is not null or new.suspended_reason is not null) then
      raise exception 'profiles_suspension_immutable' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.suspended_at is distinct from old.suspended_at
        or new.suspended_reason is distinct from old.suspended_reason) then
      raise exception 'profiles_suspension_immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_suspension
before insert or update on public.profiles
for each row execute function public.profiles_guard_suspension();

/* ------------------------------------------------------------------ */
/* Read policies (no write policies: writes go through the functions)  */
/* ------------------------------------------------------------------ */

create policy "Admins read" on public.admins for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.admin_log for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.profiles for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.households for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.household_members for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.students for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.access_log for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.student_profiles for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.lists for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.list_items for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.list_notes for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.follows for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.notification_prefs for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.digests for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.sms_consents for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.sms_sends for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.plan_tasks for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.plan_offers for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.plan_visits for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.plan_letters for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.plan_nudges for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.application_snapshots for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.school_course_counts for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.college_data_failures for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.dataset_publishes for select to authenticated using ((select public.admin_reads()));

-- These four had no grant to authenticated at all (secret key only, or nobody); the policy above is the only one on
-- each, so everyone but an admin in the console still reads nothing.
grant select on public.admins, public.admin_log, public.school_course_counts, public.college_data_failures,
  public.dataset_publishes to authenticated;
revoke all on public.admins, public.admin_log from anon;
grant all on public.admins, public.admin_log to service_role;

-- A student sees who viewed their data through my_access_log(), which names an admin's view "Quad support". Reading
-- access_log directly would show the admin's user id, so those rows are left out of the student's direct read.
drop policy "Access log: student and viewer read" on public.access_log;
create policy "Access log: student and viewer read" on public.access_log for select to authenticated
  using ((public.is_own_student(student_id) and table_name <> 'admin') or viewer_id = auth.uid());

/* ------------------------------------------------------------------ */
/* Views: invitations without their tokens, homes without the street   */
/* ------------------------------------------------------------------ */

-- Owner's rights (not security_invoker): the console must see every household's invitations, which the invitations
-- policies don't allow, and must never see the token columns, which a policy can't hide. The where clause is the guard.
create view public.invitations_admin as
  select i.id, i.household_id, i.email, i.side, i.student_id, i.can_edit, i.invited_by, i.created, i.expires_at,
         i.accepted_at, i.accepted_by, i.revoked_at, i.display_name, i.phone, i.grad_year
  from public.invitations i
  where public.is_admin();

create view public.household_homes_admin as
  select h.household_id, h.place, h.set_by, h.set_by_name, h.updated_at
  from public.household_homes h
  where public.is_admin();

revoke all on public.invitations_admin, public.household_homes_admin from public, anon, authenticated;
grant select on public.invitations_admin, public.household_homes_admin to authenticated, service_role;

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

-- One admin_log row, as the signed-in admin.
create function public.admin_log_write(p_action text, p_kind text, p_target text, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_log (admin_id, action, target_kind, target_id, details)
  values (auth.uid(), p_action, p_kind, p_target, coalesce(p_details, '{}'::jsonb))
$$;

-- Fails unless an auth user exists.
create function public.admin_require_user(p_user uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- The live household a student record is an active member of (the earliest), or null.
create function public.household_of_student(p_student uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.household_members m
  join public.households h on h.id = m.household_id and h.deleted_at is null
  where m.student_id = p_student and m.status = 'active'
  order by coalesce(m.accepted_at, m.created), m.id
  limit 1
$$;

/* ------------------------------------------------------------------ */
/* Delete and restore, shared by the person and the console            */
/* ------------------------------------------------------------------ */

-- delete_my_account()'s body (20261005125000_households.sql), for any user. Internal: callers check who may.
create function public.delete_account_for(p_user uuid) returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := now();
  v_households uuid[];
  v_household uuid;
  v_heir uuid;
  v_kept integer := 0;
  v_deleted integer := 0;
  r record;
begin
  if p_user is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user and p.deleted_at is not null) then
    raise exception 'account_deleted' using errcode = '22023';
  end if;

  v_households := array(
    select distinct m.household_id from public.household_members m
    left join public.students s on s.id = m.student_id
    where m.user_id = p_user or s.user_id = p_user or (s.managed_by = p_user and s.user_id is null)
  );

  for r in select s.id from public.students s where s.managed_by = p_user and s.user_id is null and s.deleted_at is null loop
    v_heir := public.managed_student_heir(r.id, p_user);
    if v_heir is not null then
      update public.students set managed_by = v_heir where id = r.id;
      v_kept := v_kept + 1;
    else
      update public.students set deleted_at = v_at where id = r.id;
      delete from public.household_members where student_id = r.id;
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  update public.students set deleted_at = v_at where user_id = p_user and deleted_at is null;
  delete from public.household_members m
  where m.user_id = p_user or m.student_id in (select s.id from public.students s where s.user_id = p_user);
  update public.invitations set revoked_at = v_at where invited_by = p_user and accepted_at is null and revoked_at is null;

  foreach v_household in array v_households loop
    perform public.close_household_if_empty(v_household, v_at);
  end loop;

  insert into public.profiles (id, deleted_at) values (p_user, v_at)
  on conflict (id) do update set deleted_at = v_at;

  return json_build_object('deleted_at', v_at, 'managed_kept', v_kept, 'managed_deleted', v_deleted);
end;
$$;

create or replace function public.delete_my_account() returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  return public.delete_account_for(auth.uid());
end;
$$;

-- restore_my_account()'s body, for any user. Returns the deleted_at it undid, or null when the account wasn't deleted.
create function public.restore_account_for(p_user uuid) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  select p.deleted_at into v_at from public.profiles p where p.id = p_user;
  if v_at is null then
    return null;
  end if;
  update public.students set deleted_at = null
    where deleted_at = v_at and (user_id = p_user or (managed_by = p_user and user_id is null));
  update public.profiles set deleted_at = null where id = p_user;
  return v_at;
end;
$$;

create or replace function public.restore_my_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  perform public.restore_account_for(auth.uid());
end;
$$;

/* ------------------------------------------------------------------ */
/* Who viewed your information: "Quad support" for an admin's view     */
/* ------------------------------------------------------------------ */

-- As in 20261005125000_households.sql, except a row an admin wrote (table_name 'admin') reads as "Quad support"
-- with no viewer id: families never see which person at Quad looked (admin.md, the name rule). The label matches
-- SUPPORT_VIEWER_NAME in lib/admin/constants.ts (a test keeps them equal).
create or replace function public.my_access_log(p_limit integer default 200)
returns table (at timestamptz, table_name text, viewer_id uuid, viewer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.at,
         a.table_name,
         case when a.table_name = 'admin' then null else a.viewer_id end,
         case when a.table_name = 'admin' then 'Quad support' when p.deleted_at is null then p.display_name end
  from public.access_log a
  join public.students s on s.id = a.student_id and s.user_id = auth.uid()
  left join public.profiles p on p.id = a.viewer_id
  where auth.uid() is not null
  order by a.at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- As in 20261005120000_accounts.sql, except the label 'admin' is reserved for admin_log_access(): a guardian's view
-- logged under it would read "Quad support". It is recorded as a view of the student's information instead.
create or replace function public.log_access(p_student uuid, p_table text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_own_student(p_student) or not public.can_read_student(p_student) then
    return;
  end if;
  insert into public.access_log (viewer_id, student_id, table_name)
  values (auth.uid(), p_student, left(case when lower(btrim(coalesce(p_table, ''))) = 'admin' then 'information' else p_table end, 64));
end;
$$;

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

-- People, student records, households, and pending invitations matching q: case-insensitive substring or trigram
-- match on emails and names, or an exact id. Deleted, paused, and managed rows included and marked by status:
-- 'active' | 'paused' | 'deleting' | 'invited' | 'managed'. A read: no log row.
create function public.admin_search_people(q text, max_rows integer default 50)
returns table (kind text, id text, name text, email text, household text, household_id uuid, role text, status text,
               created timestamptz, last_sign_in timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(coalesce(q, '')));
  v_like text;
  v_id uuid;
  v_trgm boolean;
  v_max integer := greatest(1, least(coalesce(max_rows, 50), 200));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if v_q = '' then
    return;
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if v_q ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := v_q::uuid;
  end if;
  v_trgm := char_length(v_q) >= 3;

  return query
  select * from (
    select 'user'::text, u.id::text, p.display_name, u.email::text, hh.name, hh.id, p.role_hint,
           case when p.deleted_at is not null then 'deleting' when p.suspended_at is not null then 'paused' else 'active' end,
           u.created_at, u.last_sign_in_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.households hh on hh.id = public.household_of(u.id)
    where u.id = v_id
       or lower(u.email) like v_like or lower(p.display_name) like v_like
       or (v_trgm and (v_q operator(extensions.<%) lower(coalesce(u.email, '')) or v_q operator(extensions.<%) lower(coalesce(p.display_name, ''))))
    union all
    select 'student'::text, s.id::text, s.display_name, su.email::text, hh.name, hh.id, 'student'::text,
           case when s.deleted_at is not null then 'deleting' when s.user_id is null then 'managed'
                when sp.suspended_at is not null then 'paused' else 'active' end,
           s.created, su.last_sign_in_at
    from public.students s
    left join auth.users su on su.id = s.user_id
    left join public.profiles sp on sp.id = s.user_id
    left join public.households hh on hh.id = public.household_of_student(s.id)
    where s.id = v_id or lower(s.display_name) like v_like
       or (v_trgm and v_q operator(extensions.<%) lower(coalesce(s.display_name, '')))
    union all
    select 'household'::text, h.id::text, h.name, null::text, h.name, h.id, null::text,
           case when h.deleted_at is not null then 'deleting' else 'active' end,
           h.created, null::timestamptz
    from public.households h
    where h.id = v_id or lower(h.name) like v_like or (v_trgm and v_q operator(extensions.<%) lower(h.name))
    union all
    select 'invitation'::text, i.id::text, i.display_name, i.email, h.name, h.id, i.side, 'invited'::text,
           i.created, null::timestamptz
    from public.invitations i
    join public.households h on h.id = i.household_id
    where i.accepted_at is null and i.revoked_at is null
      and (i.id = v_id or lower(i.email) like v_like or lower(i.display_name) like v_like
           or (v_trgm and (v_q operator(extensions.<%) lower(i.email) or v_q operator(extensions.<%) lower(coalesce(i.display_name, '')))))
  ) r (kind, id, name, email, household, household_id, role, status, created, last_sign_in)
  order by array_position(array['user', 'student', 'household', 'invitation'], r.kind), lower(coalesce(r.name, r.email, '')), r.id
  limit v_max;
end;
$$;

-- The Auth side of one person for the console's Account panel: what auth.users and auth.mfa_factors hold. A read.
create function public.admin_user_auth(p_user uuid)
returns table (email text, email_confirmed_at timestamptz, providers text[], created_at timestamptz,
               last_sign_in_at timestamptz, banned_until timestamptz, mfa_enrolled boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select u.email::text, u.email_confirmed_at,
         coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(u.raw_app_meta_data -> 'providers') = 'array'
                                                              then u.raw_app_meta_data -> 'providers' else '[]'::jsonb end)), '{}'::text[]),
         u.created_at, u.last_sign_in_at, u.banned_until,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status::text = 'verified')
  from auth.users u
  where u.id = p_user;
end;
$$;

/* ------------------------------------------------------------------ */
/* Details                                                             */
/* ------------------------------------------------------------------ */

-- Edit a profile: keys display_name, birth_year, role_hint, phone (any subset; null clears). Logs before and after.
create function public.admin_update_profile(p_user uuid, p_patch jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_keys text[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('display_name', 'birth_year', 'role_hint', 'phone')) then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  v_keys := array(select jsonb_object_keys(p_patch));
  select jsonb_build_object('display_name', p.display_name, 'birth_year', p.birth_year, 'role_hint', p.role_hint, 'phone', p.phone)
    into v_before from public.profiles p where p.id = p_user for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  update public.profiles set
    display_name = case when p_patch ? 'display_name' then nullif(left(btrim(p_patch ->> 'display_name'), 80), '') else display_name end,
    birth_year   = case when p_patch ? 'birth_year' then (p_patch ->> 'birth_year')::integer else birth_year end,
    role_hint    = case when p_patch ? 'role_hint' then p_patch ->> 'role_hint' else role_hint end,
    phone        = case when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '') else phone end
  where id = p_user
  returning jsonb_build_object('display_name', display_name, 'birth_year', birth_year, 'role_hint', role_hint, 'phone', phone)
  into v_after;

  perform public.admin_log_write('profile.update', 'user', p_user::text, jsonb_build_object(
    'before', (select jsonb_object_agg(k, v_before -> k) from unnest(v_keys) k),
    'after', (select jsonb_object_agg(k, v_after -> k) from unnest(v_keys) k)));
end;
$$;

-- Edit a student record: keys display_name, grad_year, phone. Logs before and after.
create function public.admin_update_student(p_student uuid, p_patch jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_keys text[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('display_name', 'grad_year', 'phone')) then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  v_keys := array(select jsonb_object_keys(p_patch));
  select jsonb_build_object('display_name', s.display_name, 'grad_year', s.grad_year, 'phone', s.phone)
    into v_before from public.students s where s.id = p_student for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  update public.students set
    display_name = case when p_patch ? 'display_name' then nullif(left(btrim(p_patch ->> 'display_name'), 80), '') else display_name end,
    grad_year    = case when p_patch ? 'grad_year' then (p_patch ->> 'grad_year')::integer else grad_year end,
    phone        = case when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '') else phone end
  where id = p_student
  returning jsonb_build_object('display_name', display_name, 'grad_year', grad_year, 'phone', phone)
  into v_after;

  perform public.admin_log_write('student.update', 'student', p_student::text, jsonb_build_object(
    'before', (select jsonb_object_agg(k, v_before -> k) from unnest(v_keys) k),
    'after', (select jsonb_object_agg(k, v_after -> k) from unnest(v_keys) k)));
end;
$$;

-- Rename a household: key name.
create function public.admin_update_household(p_household uuid, p_patch jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
  v_name text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k where k <> 'name') then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  select h.name into v_before from public.households h where h.id = p_household for update;
  if not found then
    raise exception 'household_not_found' using errcode = 'P0002';
  end if;
  if not p_patch ? 'name' then
    return;
  end if;
  v_name := btrim(coalesce(p_patch ->> 'name', ''));
  if char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  update public.households set name = v_name where id = p_household;
  perform public.admin_log_write('household.update', 'household', p_household::text,
    jsonb_build_object('before', jsonb_build_object('name', v_before), 'after', jsonb_build_object('name', v_name)));
end;
$$;

/* ------------------------------------------------------------------ */
/* Linking                                                             */
/* ------------------------------------------------------------------ */

-- Add a student record (p_student) or a user as a guardian (p_user) to a household; the one path besides
-- accept_invitation() that creates a membership. The household rules hold: six seats, counting pending invitations;
-- one household per person, so someone already in another household is moved (their memberships there removed, and
-- that household closed if nobody who can act is left), never duplicated. The student's data is untouched. Returns
-- the new membership's id. The household's members are told on /household (admin_household_notice()).
create function public.admin_link(p_household uuid, p_student uuid default null, p_user uuid default null,
                                  p_can_edit boolean default true) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_name text;
  v_person uuid;        -- the account behind the membership: the guardian, or the student's own account
  v_own_student uuid;   -- a guardian's own student record, if they have one
  v_from uuid[];
  v_member uuid;
  h uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if (p_student is null) = (p_user is null) then
    raise exception 'invalid_link' using errcode = '22023';
  end if;
  if not exists (select 1 from public.households x where x.id = p_household and x.deleted_at is null) then
    raise exception 'household_not_found' using errcode = 'P0002';
  end if;

  if p_student is not null then
    v_role := 'student';
    select s.display_name, s.user_id into v_name, v_person from public.students s where s.id = p_student and s.deleted_at is null;
    if not found then
      raise exception 'student_not_found' using errcode = 'P0002';
    end if;
  else
    v_role := 'guardian';
    perform public.admin_require_user(p_user);
    v_person := p_user;
    select p.display_name into v_name from public.profiles p where p.id = p_user;
    select s.id into v_own_student from public.students s where s.user_id = p_user and s.deleted_at is null;
  end if;
  if v_person is not null and exists (select 1 from public.profiles p where p.id = v_person and p.deleted_at is not null) then
    raise exception 'account_deleted' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.household_members m
    where m.household_id = p_household
      and ((p_student is not null and m.student_id = p_student)
        or (v_person is not null and m.user_id = v_person)
        or (v_own_student is not null and m.student_id = v_own_student))
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  if public.household_seats_taken(p_household) >= public.household_max_members() then
    raise exception 'household_full' using errcode = '23514';
  end if;

  -- Move: leave every other household first.
  v_from := array(
    select distinct m.household_id from public.household_members m
    where m.household_id <> p_household
      and ((p_student is not null and m.student_id = p_student)
        or (v_person is not null and m.user_id = v_person)
        or (v_own_student is not null and m.student_id = v_own_student)
        or (v_person is not null and m.student_id in (select s.id from public.students s where s.user_id = v_person)))
  );
  delete from public.household_members m
  where m.household_id = any(v_from)
    and ((p_student is not null and m.student_id = p_student)
      or (v_person is not null and m.user_id = v_person)
      or (v_own_student is not null and m.student_id = v_own_student)
      or (v_person is not null and m.student_id in (select s.id from public.students s where s.user_id = v_person)));
  foreach h in array v_from loop
    perform public.close_household_if_empty(h, now());
  end loop;

  if v_role = 'student' then
    insert into public.household_members (household_id, student_id, role, status, accepted_at)
    values (p_household, p_student, 'student', 'active', now())
    returning id into v_member;
  else
    insert into public.household_members (household_id, user_id, role, status, can_edit, accepted_at)
    values (p_household, p_user, 'guardian', 'active', coalesce(p_can_edit, true), now())
    returning id into v_member;
  end if;

  perform public.admin_log_write('household.link', 'member', v_member::text, jsonb_build_object(
    'household_id', p_household, 'role', v_role, 'student_id', p_student, 'user_id', p_user, 'member_name', v_name,
    'can_edit', case when v_role = 'guardian' then coalesce(p_can_edit, true) end,
    'moved_from', to_jsonb(v_from)));
  return v_member;
end;
$$;

-- Remove a membership. Refused (last_guardian_of_managed) for a guardian who is the household's only guardian while
-- it has a managed student: link another guardian first, or delete the record. Managed records the removed guardian
-- managed pass to the household's longest-standing other guardian (as on delete), so the removed guardian keeps no
-- access through managed_by. A student record is never deleted by an unlink. A household left with nobody who can
-- act is closed.
create function public.admin_unlink(p_member uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.household_members;
  v_name text;
  v_heir uuid;
  v_passed jsonb := '[]'::jsonb;
  r record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select m.* into v_m from public.household_members m where m.id = p_member for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if v_m.role = 'guardian' then
    if exists (
      select 1 from public.household_members m
      join public.students s on s.id = m.student_id and s.user_id is null and s.deleted_at is null
      where m.household_id = v_m.household_id and m.role = 'student' and m.status = 'active'
    ) and not exists (
      select 1 from public.household_members g
      where g.household_id = v_m.household_id and g.role = 'guardian' and g.status = 'active' and g.id <> v_m.id
    ) then
      raise exception 'last_guardian_of_managed' using errcode = '23514';
    end if;
    select p.display_name into v_name from public.profiles p where p.id = v_m.user_id;
  else
    select s.display_name into v_name from public.students s where s.id = v_m.student_id;
  end if;

  delete from public.household_members where id = p_member;

  if v_m.role = 'guardian' and v_m.user_id is not null then
    for r in
      select s.id from public.students s
      join public.household_members m on m.student_id = s.id and m.household_id = v_m.household_id and m.status = 'active'
      where s.managed_by = v_m.user_id and s.user_id is null and s.deleted_at is null
    loop
      v_heir := public.managed_student_heir(r.id, v_m.user_id);
      if v_heir is not null then
        update public.students set managed_by = v_heir where id = r.id;
        v_passed := v_passed || jsonb_build_object('student_id', r.id, 'to', v_heir);
      end if;
    end loop;
  end if;
  perform public.close_household_if_empty(v_m.household_id, now());

  perform public.admin_log_write('household.unlink', 'member', p_member::text, jsonb_build_object(
    'household_id', v_m.household_id, 'role', v_m.role, 'student_id', v_m.student_id, 'user_id', v_m.user_id,
    'member_name', v_name, 'managed_passed', v_passed));
end;
$$;

-- Cancel a pending invitation, as the family's Cancel does (the token is cleared by invitations_clear_token).
create function public.admin_revoke_invitation(p_invitation uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select i.* into v_inv from public.invitations i where i.id = p_invitation for update;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = '22023';
  end if;
  update public.invitations set revoked_at = now() where id = p_invitation;
  perform public.admin_log_write('invitation.revoke', 'invitation', p_invitation::text, jsonb_build_object(
    'household_id', v_inv.household_id, 'side', v_inv.side, 'display_name', v_inv.display_name));
end;
$$;

-- Attach a managed student record to a user's account (accept_invitation()'s claim: user_id set, managed_by cleared;
-- the guardians keep access through the household). Refused when the user already has a student record
-- (user_has_student: the merge belongs to the family's own invitation flow), when the user is in a household already
-- (already_in_household: one household per account), or when the record isn't a live managed one. Pending hand-over
-- invitations for the record are cancelled.
create function public.admin_claim_student(p_student uuid, p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.students;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select s.* into v_s from public.students s where s.id = p_student for update;
  if not found or v_s.deleted_at is not null then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  if v_s.user_id is not null then
    raise exception 'student_has_account' using errcode = '22023';
  end if;
  perform public.admin_require_user(p_user);
  if exists (select 1 from public.profiles p where p.id = p_user and p.deleted_at is not null) then
    raise exception 'account_deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.students s where s.user_id = p_user) then
    raise exception 'user_has_student' using errcode = '23505';
  end if;
  if public.household_of(p_user) is not null then
    raise exception 'already_in_household' using errcode = '23505';
  end if;

  update public.students set user_id = p_user, managed_by = null where id = p_student;
  update public.invitations set revoked_at = now()
    where student_id = p_student and accepted_at is null and revoked_at is null;
  perform public.admin_log_write('student.claim', 'student', p_student::text, jsonb_build_object(
    'user_id', p_user, 'managed_by_was', v_s.managed_by, 'household_id', public.household_of_student(p_student)));
end;
$$;

/* ------------------------------------------------------------------ */
/* Deleting                                                            */
/* ------------------------------------------------------------------ */

-- delete_my_account() for p_user: the 30-day soft delete with the built rules for managed students, households, and
-- memberships. Refused for an account that is an admin (revoke_admin_first), so the last-admin rule can't be skipped.
-- Signing them out is the admin-auth function's sign_out, which the console calls next.
create function public.admin_delete_account(p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result json;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  perform public.admin_require_user(p_user);
  if exists (select 1 from public.admins a where a.user_id = p_user and a.revoked_at is null) then
    raise exception 'revoke_admin_first' using errcode = '42501';
  end if;
  v_result := public.delete_account_for(p_user);
  perform public.admin_log_write('account.delete', 'user', p_user::text, v_result::jsonb);
end;
$$;

-- restore_my_account() for p_user (within the 30 days, before the purge). Refused when the account isn't deleted.
create function public.admin_restore_account(p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  perform public.admin_require_user(p_user);
  v_at := public.restore_account_for(p_user);
  if v_at is null then
    raise exception 'not_deleted' using errcode = '22023';
  end if;
  perform public.admin_log_write('account.restore', 'user', p_user::text, jsonb_build_object('deleted_at', v_at));
end;
$$;

-- Soft-delete a managed student record (a child added by mistake): memberships removed, hand-over invitations
-- cancelled, households left with nobody who can act closed; the purge removes it after 30 days. A record with its
-- own account is refused (student_has_account): that is the account's delete.
create function public.admin_delete_student(p_student uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.students;
  v_households uuid[];
  h uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select s.* into v_s from public.students s where s.id = p_student for update;
  if not found or v_s.deleted_at is not null then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  if v_s.user_id is not null then
    raise exception 'student_has_account' using errcode = '22023';
  end if;
  v_households := array(select m.household_id from public.household_members m where m.student_id = p_student);
  update public.students set deleted_at = now() where id = p_student;
  delete from public.household_members where student_id = p_student;
  update public.invitations set revoked_at = now()
    where student_id = p_student and accepted_at is null and revoked_at is null;
  foreach h in array v_households loop
    perform public.close_household_if_empty(h, now());
  end loop;
  perform public.admin_log_write('student.delete', 'student', p_student::text, jsonb_build_object(
    'name', v_s.display_name, 'managed_by', v_s.managed_by, 'households', to_jsonb(v_households)));
end;
$$;

-- Close (soft-delete) a household with no active members; its pending invitations are revoked.
create function public.admin_close_household(p_household uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.households;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select x.* into v_h from public.households x where x.id = p_household for update;
  if not found or v_h.deleted_at is not null then
    raise exception 'household_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.household_members m where m.household_id = p_household and m.status = 'active') then
    raise exception 'household_not_empty' using errcode = '23514';
  end if;
  update public.households set deleted_at = now() where id = p_household;
  update public.invitations set revoked_at = now()
    where household_id = p_household and accepted_at is null and revoked_at is null;
  perform public.admin_log_write('household.close', 'household', p_household::text, jsonb_build_object('name', v_h.name));
end;
$$;

/* ------------------------------------------------------------------ */
/* Export, page views                                                  */
/* ------------------------------------------------------------------ */

-- The record half of "Export their data". The file itself is built in TypeScript by the same exporters the person's
-- own download uses (lib/account-export.ts, run through the admin policies by lib/admin/people.ts exportFor()), so
-- the two can't drift. This logs account.export and writes an access_log row ('admin', shown as "Quad support") for
-- each student record the export includes: the user's own and the managed records they created, as in the person's
-- own export. Returns {user_id, own_student_id, student_ids} for the exporter.
create function public.admin_export(p_user uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_own uuid;
  v_ids uuid[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  perform public.admin_require_user(p_user);
  select s.id into v_own from public.students s where s.user_id = p_user and s.deleted_at is null;
  v_ids := array(
    select s.id from public.students s
    where s.deleted_at is null and (s.user_id = p_user or (s.managed_by = p_user and s.user_id is null))
    order by s.user_id is null, s.created, s.id
  );
  insert into public.access_log (viewer_id, student_id, table_name)
    select auth.uid(), x, 'admin' from unnest(v_ids) x;
  perform public.admin_log_write('account.export', 'user', p_user::text, jsonb_build_object('student_ids', to_jsonb(v_ids)));
  return jsonb_build_object('user_id', p_user, 'own_student_id', v_own, 'student_ids', to_jsonb(v_ids));
end;
$$;

-- An admin opened a student's data (the student page): an access_log row the student sees as "Quad support viewed
-- your information", and an access.view log row naming what was opened.
create function public.admin_log_access(p_student uuid, p_what text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from public.students s where s.id = p_student) then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  insert into public.access_log (viewer_id, student_id, table_name) values (auth.uid(), p_student, 'admin');
  perform public.admin_log_write('access.view', 'student', p_student::text,
    jsonb_build_object('what', left(coalesce(p_what, ''), 80)));
end;
$$;

/* ------------------------------------------------------------------ */
/* Admins                                                              */
/* ------------------------------------------------------------------ */

-- Make a user an admin (or re-grant a revoked one).
create function public.admin_grant(p_user uuid, p_note text default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  perform public.admin_require_user(p_user);
  if exists (select 1 from public.admins a where a.user_id = p_user and a.revoked_at is null) then
    raise exception 'already_admin' using errcode = '23505';
  end if;
  insert into public.admins (user_id, granted_by, granted_at, revoked_at, note)
  values (p_user, auth.uid(), now(), null, nullif(left(btrim(coalesce(p_note, '')), 200), ''))
  on conflict (user_id) do update
    set granted_by = excluded.granted_by, granted_at = excluded.granted_at, revoked_at = null, note = excluded.note;
  perform public.admin_log_write('admin.grant', 'user', p_user::text, jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

-- Revoke an admin. Not yourself (cannot_revoke_self) and never the last one (last_admin).
create function public.admin_revoke(p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_user = auth.uid() then
    raise exception 'cannot_revoke_self' using errcode = '42501';
  end if;
  perform 1 from public.admins a where a.revoked_at is null for update;
  if not exists (select 1 from public.admins a where a.user_id = p_user and a.revoked_at is null) then
    raise exception 'not_admin' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.admins a where a.revoked_at is null and a.user_id <> p_user) then
    raise exception 'last_admin' using errcode = '23514';
  end if;
  update public.admins set revoked_at = now() where user_id = p_user;
  perform public.admin_log_write('admin.revoke', 'user', p_user::text, '{}'::jsonb);
end;
$$;

/* ------------------------------------------------------------------ */
/* Log rows written from outside the database                          */
/* ------------------------------------------------------------------ */

-- The admin-auth Edge Function's record of an Auth call that succeeded (service role only; the function has already
-- checked is_admin() with the caller's token). account.suspend / account.unsuspend also set / clear the profile's
-- pause here, in the same transaction as the log row; details may carry the suspend reason (admin.md).
create function public.admin_note_auth_action(p_admin uuid, p_action text, p_target uuid, p_details jsonb,
                                              p_request_id text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('auth.email', 'auth.recovery', 'auth.sign_out', 'account.suspend', 'account.unsuspend', 'account.purge') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admins a where a.user_id = p_admin and a.revoked_at is null) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_action = 'account.suspend' then
    update public.profiles
      set suspended_at = coalesce(suspended_at, now()), suspended_reason = left(nullif(btrim(p_details ->> 'reason'), ''), 500)
      where id = p_target;
  elsif p_action = 'account.unsuspend' then
    update public.profiles set suspended_at = null, suspended_reason = null where id = p_target;
  end if;
  insert into public.admin_log (admin_id, action, target_kind, target_id, details, request_id)
  values (p_admin, p_action, 'user', p_target::text, coalesce(p_details, '{}'::jsonb), left(p_request_id, 80));
end;
$$;

-- The console's own record of an Operations action (ops.dispatch before a workflow is sent, ops.merge, ops.hold,
-- ops.close, review.accept, review.reject), from a Server Action with the admin's session. Only ops.* and review.*
-- actions: the people actions are logged by their own functions.
create function public.admin_note_ops(p_action text, p_details jsonb, p_request_id text default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_action !~ '^(ops|review)\.[a-z_]+$' then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  insert into public.admin_log (admin_id, action, target_kind, target_id, details, request_id)
  values (auth.uid(), p_action, null, null, coalesce(p_details, '{}'::jsonb), left(p_request_id, 80));
end;
$$;

/* ------------------------------------------------------------------ */
/* What the household is told                                          */
/* ------------------------------------------------------------------ */

-- "Quad support added Jordan to this household on Oct 12": admin links and unlinks of the last 30 days, for the
-- household's active members only (empty for anyone else). Never the admin's name.
create function public.admin_household_notice(p_household uuid)
returns table (at timestamptz, action text, member_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.at, l.action, l.details ->> 'member_name'
  from public.admin_log l
  where public.is_household_member(p_household)
    and l.action in ('household.link', 'household.unlink')
    and l.details ->> 'household_id' = p_household::text
    and l.at > now() - interval '30 days'
  order by l.at desc, l.id desc
$$;

/* ------------------------------------------------------------------ */
/* Function privileges                                                 */
/* ------------------------------------------------------------------ */

-- Internal: nobody calls these through the API.
revoke execute on function public.admin_log_write(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_require_user(uuid) from public, anon, authenticated;
revoke execute on function public.household_of_student(uuid) from public, anon, authenticated;
revoke execute on function public.delete_account_for(uuid) from public, anon, authenticated;
revoke execute on function public.restore_account_for(uuid) from public, anon, authenticated;
revoke execute on function public.profiles_guard_suspension() from public, anon, authenticated;
grant execute on function public.delete_account_for(uuid) to service_role;
grant execute on function public.restore_account_for(uuid) to service_role;
grant execute on function public.household_of_student(uuid) to service_role;

-- Policies call these as the signed-in user.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_admin_any_aal() from public, anon;
revoke execute on function public.admin_reads() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_admin_any_aal() to authenticated, service_role;
grant execute on function public.admin_reads() to authenticated, service_role;

-- The console's functions: signed-in users may call them; each refuses anyone but an admin at aal2.
revoke execute on function public.admin_search_people(text, integer) from public, anon;
revoke execute on function public.admin_user_auth(uuid) from public, anon;
revoke execute on function public.admin_update_profile(uuid, jsonb) from public, anon;
revoke execute on function public.admin_update_student(uuid, jsonb) from public, anon;
revoke execute on function public.admin_update_household(uuid, jsonb) from public, anon;
revoke execute on function public.admin_link(uuid, uuid, uuid, boolean) from public, anon;
revoke execute on function public.admin_unlink(uuid) from public, anon;
revoke execute on function public.admin_revoke_invitation(uuid) from public, anon;
revoke execute on function public.admin_claim_student(uuid, uuid) from public, anon;
revoke execute on function public.admin_delete_account(uuid) from public, anon;
revoke execute on function public.admin_restore_account(uuid) from public, anon;
revoke execute on function public.admin_delete_student(uuid) from public, anon;
revoke execute on function public.admin_close_household(uuid) from public, anon;
revoke execute on function public.admin_export(uuid) from public, anon;
revoke execute on function public.admin_log_access(uuid, text) from public, anon;
revoke execute on function public.admin_grant(uuid, text) from public, anon;
revoke execute on function public.admin_revoke(uuid) from public, anon;
revoke execute on function public.admin_note_ops(text, jsonb, text) from public, anon;
revoke execute on function public.admin_household_notice(uuid) from public, anon;
grant execute on function public.admin_search_people(text, integer) to authenticated;
grant execute on function public.admin_user_auth(uuid) to authenticated;
grant execute on function public.admin_update_profile(uuid, jsonb) to authenticated;
grant execute on function public.admin_update_student(uuid, jsonb) to authenticated;
grant execute on function public.admin_update_household(uuid, jsonb) to authenticated;
grant execute on function public.admin_link(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_unlink(uuid) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_claim_student(uuid, uuid) to authenticated;
grant execute on function public.admin_delete_account(uuid) to authenticated;
grant execute on function public.admin_restore_account(uuid) to authenticated;
grant execute on function public.admin_delete_student(uuid) to authenticated;
grant execute on function public.admin_close_household(uuid) to authenticated;
grant execute on function public.admin_export(uuid) to authenticated;
grant execute on function public.admin_log_access(uuid, text) to authenticated;
grant execute on function public.admin_grant(uuid, text) to authenticated;
grant execute on function public.admin_revoke(uuid) to authenticated;
grant execute on function public.admin_note_ops(text, jsonb, text) to authenticated;
grant execute on function public.admin_household_notice(uuid) to authenticated;

-- The admin-auth Edge Function only (secret key).
revoke execute on function public.admin_note_auth_action(uuid, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_note_auth_action(uuid, text, uuid, jsonb, text) to service_role;
