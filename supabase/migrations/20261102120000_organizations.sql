-- The counselor portal's model (specs/product/counselor-portal.md "Model", "How a student joins", "Rules"): counselor
-- organizations, their members, invitations (to counselors and to students), the grant a student or their guardian
-- gives an organization (org_students), the office's notes, and asks. Builds on every user-data migration before it
-- (accounts, households, lists, the household hub, the planner, the plan bundle, admin, essays, essay suggestions);
-- apply after 20261101130000_visit_events_retries.sql (SQL Editor, dev first, then prod). Tested against real Postgres
-- (PGlite + the auth stub, every migration in order) in tests/orgs-policies.test.mts, with guard tests that break a
-- rule on purpose and show the checks notice.
--
-- Rules this file encodes:
-- * A counselor sees a student only through a live grant (org_students.ended_at is null, the organization not deleted)
--   to an organization they are a member of. can_read_student() and can_edit_student() gain that clause
--   (is_counselor_of), so every policy built on them (students, student_profiles, lists, list_items, list_notes, the
--   plan's tables, application snapshots, essays and their comments, reviews and suggestions) opens to the counselor
--   with no change to the policies themselves; can_edit on the grant is what can_edit_student() asks for.
-- * What stays closed, because those policies never go through the two functions: households, their members, rosters
--   and homes (is_household_member); a guardian's own lists (lists.user_id: the owner and their household only);
--   private list notes (their author only); the text of a nudge (its sender and the student only); nudge sending and
--   text consents' writes (is_guardian_of, which a grant never satisfies); another organization's anything.
-- * The grant is the family's: created only by accept_org_invitation() or join_organization() for the caller's own
--   student record or a student they reach as a guardian (or manage), never by the organization. The student or a
--   guardian ends it, or turns editing off, at any time (end_org_access, set_org_student_can_edit); a member may end it
--   too (dropping a student from the caseload), but never turns editing on.
-- * A person is in at most one live organization (a trigger, like the one-household rule). One live grant per
--   (organization, student). Invitations last 30 days; the clear token of a pending invitation is kept so "Copy link"
--   works, readable only through org_roster() (members), and cleared once it is accepted, cancelled, or expired.
--   Counselor invitations are accepted only by the invited email (they open every student's data); student invitations
--   by whoever holds the link, for their own record or a child's (the family decides what it shares).
-- * Notes are the office's (members read and write, the author edits and deletes); the family never sees them. Asks are
--   the office's too; the family reads them while the grant is live. One open ask per (organization, student, kind,
--   section) except custom asks, and at most three a week per student from one organization.
-- * A counselor with edit access changes a student's record like an editing guardian, except the record's soft delete
--   and phone (students_guard_counselor).
-- * Admins read every new table through the "Admins read" pattern (20261012200000_admin.sql). Invitation tokens and
--   their hashes are column-revoked from every API role: nobody reads them from the table, an admin included.
-- * viewer_bundle() keeps every key and gains `grants` (the caller's live grants as a member); log_access() records a
--   counselor's read as it records a guardian's; my_access_log() says which kind of viewer each row was.

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  kind       text not null check (kind in ('iec', 'school')),
  -- The school's high school (public.high_schools.id: a 12-digit NCES ncessch or an 8-character PSS ppin).
  ncessch    text check (ncessch is null or char_length(ncessch) between 1 and 20),
  website    text check (website is null or char_length(website) between 1 and 200),
  -- Stored without the "QUAD-" shown on the page (lib/org-rules.ts JOIN_CODE_RE, formatJoinCode).
  join_code  text not null unique check (join_code ~ '^[A-Z]{4,6}$'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created    timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.org_members (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role    text not null check (role in ('owner', 'counselor')),
  created timestamptz not null default now(),
  constraint org_members_one_row unique (org_id, user_id)
);

create index org_members_user_idx on public.org_members (user_id);

create table public.org_invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  side         text not null check (side in ('counselor', 'student')),
  email        text not null check (position('@' in email) > 1 and char_length(email) <= 320),
  display_name text check (char_length(display_name) <= 80),
  grad_year    integer check (grad_year between 2000 and 2100),
  token_hash   text not null unique,
  -- The clear token while the invitation is pending (Copy link); cleared by org_invitations_clear_token().
  token        text,
  invited_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created      timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz
);

create index org_invitations_org_idx on public.org_invitations (org_id, created);

-- The grant. Written only by the functions below.
create table public.org_students (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  can_edit   boolean not null default true,
  source     text not null check (source in ('invite', 'code')),
  granted_by uuid default auth.uid() references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  ended_at   timestamptz,
  ended_by   uuid references auth.users (id) on delete set null
);

create unique index org_students_one_live_idx on public.org_students (org_id, student_id) where ended_at is null;
create index org_students_student_idx on public.org_students (student_id) where ended_at is null;

create table public.org_notes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  author_id  uuid default auth.uid() references auth.users (id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created    timestamptz not null default now(),
  updated    timestamptz not null default now()
);

create index org_notes_student_idx on public.org_notes (org_id, student_id, created desc);

create table public.org_requests (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  kind       text not null check (kind in ('record_section', 'list', 'custom')),
  section    text check (section is null or section ~ '^[a-z][a-z0-9_]{0,63}$'),
  note       text check (note is null or char_length(note) between 1 and 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created    timestamptz not null default now(),
  done_at    timestamptz,
  seen_at    timestamptz,
  constraint org_requests_shape check (
    (kind = 'record_section' and section is not null)
    or (kind = 'list' and section is null)
    or (kind = 'custom' and section is null and note is not null)
  )
);

create index org_requests_student_idx on public.org_requests (student_id, created desc);
create index org_requests_org_student_idx on public.org_requests (org_id, student_id, created desc);

/* ------------------------------------------------------------------ */
/* Helpers (security definer: narrow, only ever about auth.uid())      */
/* ------------------------------------------------------------------ */

-- A member of a live organization.
create function public.is_org_member(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.org_members m
    join public.organizations o on o.id = m.org_id and o.deleted_at is null
    where m.org_id = p_org and m.user_id = auth.uid()
  )
$$;

create function public.is_org_owner(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.org_members m
    join public.organizations o on o.id = m.org_id and o.deleted_at is null
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'owner'
  )
$$;

-- The caller is a member of a live organization holding a live grant to the student (with can_edit when asked).
create function public.is_counselor_of(p_student uuid, p_need_edit boolean) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.org_students g
    join public.org_members m on m.org_id = g.org_id and m.user_id = auth.uid()
    join public.organizations o on o.id = g.org_id and o.deleted_at is null
    where g.student_id = p_student and g.ended_at is null and (g.can_edit or not p_need_edit)
  )
$$;

-- The student's family: their own account, the guardian who manages the record, or a guardian of the student's
-- household (view-only or editing). Never a counselor: this is who gives, changes, and ends a grant, and who reads asks.
create function public.is_family_of(p_student uuid) returns boolean
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

-- A live grant from the student to the organization.
create function public.org_has_student(p_org uuid, p_student uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_students g
    join public.organizations o on o.id = g.org_id and o.deleted_at is null
    where g.org_id = p_org and g.student_id = p_student and g.ended_at is null
  )
$$;

-- The caller's live organization, or null.
create function public.my_org_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.org_members m
  join public.organizations o on o.id = m.org_id and o.deleted_at is null
  where m.user_id = auth.uid()
  order by m.created
  limit 1
$$;

-- Six letters, consonant then vowel ("BAKOMI"), from a v4 uuid's random bytes. Never starts with "QUAD" (the U would
-- have to be a consonant), so a code never reads as the "QUAD-" prefix.
create function public.org_random_code() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_consonants constant text := 'BCDFGHJKLMNPRSTVWZ';
  v_vowels constant text := 'AEIOU';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_code text := '';
begin
  for i in 0..5 loop
    if i % 2 = 0 then
      v_code := v_code || substr(v_consonants, get_byte(v_bytes, i) % char_length(v_consonants) + 1, 1);
    else
      v_code := v_code || substr(v_vowels, get_byte(v_bytes, i) % char_length(v_vowels) + 1, 1);
    end if;
  end loop;
  return v_code;
end;
$$;

-- An unused code (codes of deleted organizations stay taken, so an old handout never reaches a new office).
create function public.org_new_join_code() returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  for i in 1..50 loop
    v_code := public.org_random_code();
    if not exists (select 1 from public.organizations o where o.join_code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'join_code_exhausted' using errcode = '23505';
end;
$$;

-- What a person typed: "quad-rivera", "QUAD RIVERA", " Rivera " all read as RIVERA. lib/org-rules.ts parseJoinCode
-- mirrors it (a test checks both on the same inputs).
create function public.org_normalize_code(p_code text) returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(regexp_replace(upper(btrim(coalesce(p_code, ''))), '^QUAD[-[:space:]]+', ''), '[^A-Z]', '', 'g'), '')
$$;

create function public.org_token_hash(p_token text) returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- The student a join is for: the caller's own live record when p_student is null, else a student of the caller's
-- family (their own, one they manage, or one they reach as a guardian). Raises not_a_student otherwise.
create function public.org_join_student(p_student uuid) returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student uuid;
begin
  if p_student is null then
    select s.id into v_student from public.students s where s.user_id = auth.uid() and s.deleted_at is null;
  elsif public.is_family_of(p_student) then
    v_student := p_student;
  end if;
  if v_student is null then
    raise exception 'not_a_student' using errcode = '42501';
  end if;
  return v_student;
end;
$$;

-- The live grant (org, student), made when there is none. Returns its id.
create function public.org_grant(p_org uuid, p_student uuid, p_source text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant uuid;
begin
  insert into public.org_students (org_id, student_id, source, granted_by)
  values (p_org, p_student, p_source, auth.uid())
  on conflict (org_id, student_id) where ended_at is null do nothing
  returning id into v_grant;
  if v_grant is null then
    select g.id into v_grant from public.org_students g
    where g.org_id = p_org and g.student_id = p_student and g.ended_at is null;
  end if;
  return v_grant;
end;
$$;

/* ------------------------------------------------------------------ */
/* The two access functions, and the access log                       */
/* ------------------------------------------------------------------ */

-- As in 20261005120000_accounts.sql, plus a counselor with a live grant (any grant: reading needs no can_edit).
create or replace function public.can_read_student(p_student uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.students s
    where s.id = p_student and s.deleted_at is null
      and (s.user_id = auth.uid() or s.managed_by = auth.uid() or public.is_guardian_of(s.id, false)
        or public.is_counselor_of(s.id, false))
  )
$$;

-- As in 20261005120000_accounts.sql, plus a counselor whose organization's grant has can_edit.
create or replace function public.can_edit_student(p_student uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.students s
    where s.id = p_student and s.deleted_at is null
      and (s.user_id = auth.uid() or s.managed_by = auth.uid() or public.is_guardian_of(s.id, true)
        or public.is_counselor_of(s.id, true))
  )
$$;

-- As in 20261012200000_admin.sql: anyone reading another person's student data through can_read_student() (now a
-- guardian or a counselor) is logged; the student's own reads and reads without access aren't; the 'admin' label
-- stays reserved for admin_log_access().
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

-- As in 20261012200000_admin.sql, plus viewer_role: 'support' (an admin's view, "Quad support"), 'counselor' (the
-- viewer was a member of an organization holding a grant to the student when they looked), or 'guardian'. The return
-- type changes, so the function is dropped and created again (grants restated below).
drop function public.my_access_log(integer);

create function public.my_access_log(p_limit integer default 200)
returns table (at timestamptz, table_name text, viewer_id uuid, viewer_name text, viewer_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.at,
         a.table_name,
         case when a.table_name = 'admin' then null else a.viewer_id end,
         case when a.table_name = 'admin' then 'Quad support' when p.deleted_at is null then p.display_name end,
         case
           when a.table_name = 'admin' then 'support'
           when exists (
             select 1 from public.org_students g
             join public.org_members m on m.org_id = g.org_id and m.user_id = a.viewer_id
             where g.student_id = a.student_id and g.granted_at <= a.at and (g.ended_at is null or g.ended_at >= a.at)
           ) and not exists (
             select 1 from public.household_members gm
             join public.household_members sm on sm.household_id = gm.household_id
               and sm.student_id = a.student_id and sm.role = 'student' and sm.status = 'active'
             where gm.user_id = a.viewer_id and gm.role = 'guardian' and gm.status = 'active'
           ) then 'counselor'
           else 'guardian'
         end
  from public.access_log a
  join public.students s on s.id = a.student_id and s.user_id = auth.uid()
  left join public.profiles p on p.id = a.viewer_id
  where auth.uid() is not null
  order by a.at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

-- One live organization per person (the one-household rule's twin). Every path that adds a membership passes here.
create function public.org_members_one_org() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.org_members m
    join public.organizations o on o.id = m.org_id and o.deleted_at is null
    where m.user_id = new.user_id and m.org_id <> new.org_id and m.id is distinct from new.id
  ) then
    raise exception 'already_in_organization' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger org_members_one_org
before insert or update of org_id, user_id on public.org_members
for each row execute function public.org_members_one_org();

-- The clear token is a credential only while the invitation is pending.
create function public.org_invitations_clear_token() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepted_at is not null or new.revoked_at is not null or new.expires_at <= now() then
    new.token := null;
  end if;
  return new;
end;
$$;

create trigger org_invitations_clear_token
before insert or update on public.org_invitations
for each row execute function public.org_invitations_clear_token();

-- A note's author is the caller, and its organization, student, author, and creation never change.
create function public.org_notes_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.author_id := auth.uid();
    end if;
    new.created := now();
  else
    new.org_id := old.org_id;
    new.student_id := old.student_id;
    new.author_id := old.author_id;
    new.created := old.created;
  end if;
  new.updated := now();
  return new;
end;
$$;

create trigger org_notes_stamp
before insert or update on public.org_notes
for each row execute function public.org_notes_stamp();

-- A counselor with edit access may rename a record or set its class year, as an editing guardian may, but never
-- delete it or change its phone. "Through a grant only" means none of the family's rules let the caller edit. Not
-- security definer, so current_user is the API role (as in students_guard_owner); the database's own functions pass.
create function public.students_guard_counselor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.deleted_at is distinct from old.deleted_at or new.phone is distinct from old.phone)
     and not (old.user_id is not distinct from auth.uid() or old.managed_by is not distinct from auth.uid()
       or public.is_guardian_of(old.id, true))
     and public.is_counselor_of(old.id, true) then
    raise exception 'counselor_cannot_change' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger students_guard_counselor
before update on public.students
for each row execute function public.students_guard_counselor();

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.org_invitations enable row level security;
alter table public.org_students enable row level security;
alter table public.org_notes enable row level security;
alter table public.org_requests enable row level security;

-- Members read their organization; a family learns the names of the organizations it granted through
-- my_counselor_grants(), never this table.
create policy "Organizations: members read" on public.organizations for select to authenticated
  using (deleted_at is null and public.is_org_member(id));
create policy "Org members: members read" on public.org_members for select to authenticated
  using (public.is_org_member(org_id) or user_id = auth.uid());
create policy "Org invitations: members read" on public.org_invitations for select to authenticated
  using (public.is_org_member(org_id));
-- The grant: the organization's members, and the student's family.
create policy "Org students: members and family read" on public.org_students for select to authenticated
  using (public.is_org_member(org_id) or public.is_family_of(student_id));

-- Notes: the office's. Every member reads and writes notes on a student with a live grant; the author edits and
-- deletes their own. Notes outlive the grant (the office wrote them).
create policy "Org notes: members read" on public.org_notes for select to authenticated
  using (public.is_org_member(org_id));
create policy "Org notes: members write" on public.org_notes for insert to authenticated
  with check (public.is_org_member(org_id) and author_id = auth.uid() and public.org_has_student(org_id, student_id));
create policy "Org notes: author edits" on public.org_notes for update to authenticated
  using (author_id = auth.uid() and public.is_org_member(org_id))
  with check (author_id = auth.uid() and public.is_org_member(org_id));
create policy "Org notes: author deletes" on public.org_notes for delete to authenticated
  using (author_id = auth.uid() and public.is_org_member(org_id));

-- Asks: the organization's members, and the student's family while the grant is live (ending it removes the office's
-- asks from the student's pages).
create policy "Org requests: members and family read" on public.org_requests for select to authenticated
  using (public.is_org_member(org_id) or (public.is_family_of(student_id) and public.org_has_student(org_id, student_id)));

create policy "Admins read" on public.organizations for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.org_members for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.org_invitations for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.org_students for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.org_notes for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.org_requests for select to authenticated using ((select public.admin_reads()));

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that. Signed-out
-- visitors get nothing; signed-in users read (policies decide) and write notes; the token columns are nobody's.
revoke all on public.organizations, public.org_members, public.org_invitations, public.org_students, public.org_notes,
  public.org_requests from anon, authenticated;
grant select on public.organizations, public.org_members, public.org_students, public.org_requests to authenticated;
grant select (id, org_id, side, email, display_name, grad_year, invited_by, created, expires_at, accepted_at,
  accepted_by, revoked_at) on public.org_invitations to authenticated;
grant select, insert, delete on public.org_notes to authenticated;
grant update (body) on public.org_notes to authenticated;
grant all on public.organizations, public.org_members, public.org_invitations, public.org_students, public.org_notes,
  public.org_requests to service_role;

/* ------------------------------------------------------------------ */
/* Starting and running an organization                                */
/* ------------------------------------------------------------------ */

-- A new organization with the caller as its owner and a fresh join code. Returns its id.
create function public.create_organization(p_name text, p_kind text, p_ncessch text default null, p_website text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_site text := nullif(btrim(coalesce(p_website, '')), '');
  v_school text := nullif(btrim(coalesce(p_ncessch, '')), '');
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('iec', 'school') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if v_site is not null and char_length(v_site) > 200 then
    raise exception 'invalid_website' using errcode = '22023';
  end if;
  if v_school is not null and char_length(v_school) > 20 then
    raise exception 'invalid_school' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.deleted_at is not null) then
    raise exception 'account_deleted' using errcode = '42501';
  end if;
  if public.my_org_id() is not null then
    raise exception 'already_in_organization' using errcode = '23505';
  end if;

  insert into public.organizations (name, kind, ncessch, website, join_code, created_by)
  values (v_name, p_kind, case when p_kind = 'school' then v_school end, v_site, public.org_new_join_code(), v_uid)
  returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_uid, 'owner');
  return v_org;
end;
$$;

-- The owner changes the name, high school, and website (the kind stays what it was started as).
create function public.update_organization(p_org uuid, p_name text, p_ncessch text default null, p_website text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_site text := nullif(btrim(coalesce(p_website, '')), '');
  v_school text := nullif(btrim(coalesce(p_ncessch, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if not public.is_org_owner(p_org) then
    raise exception 'owners_only' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_site is not null and char_length(v_site) > 200 then
    raise exception 'invalid_website' using errcode = '22023';
  end if;
  if v_school is not null and char_length(v_school) > 20 then
    raise exception 'invalid_school' using errcode = '22023';
  end if;
  update public.organizations o
    set name = v_name, website = v_site, ncessch = case when o.kind = 'school' then v_school end
    where o.id = p_org;
end;
$$;

-- A new join code (owner); the old one stops working at once.
create function public.regenerate_join_code(p_org uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if not public.is_org_owner(p_org) then
    raise exception 'owners_only' using errcode = '42501';
  end if;
  v_code := public.org_new_join_code();
  update public.organizations set join_code = v_code where id = p_org;
  return v_code;
end;
$$;

-- The caller's organization with its members' names and roles, or null.
create function public.my_organization() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'kind', o.kind,
    'ncessch', o.ncessch,
    'website', o.website,
    'join_code', o.join_code,
    'created', o.created,
    'my_role', me.role,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', m.id,
        'user_id', m.user_id,
        'display_name', case when p.deleted_at is null then p.display_name end,
        'role', m.role,
        'is_me', m.user_id = auth.uid(),
        'joined', m.created
      ) order by (m.role = 'owner') desc, m.created, m.id)
      from public.org_members m
      left join public.profiles p on p.id = m.user_id
      where m.org_id = o.id
    ), '[]'::jsonb)
  )
  from public.org_members me
  join public.organizations o on o.id = me.org_id and o.deleted_at is null
  where me.user_id = auth.uid()
  order by me.created
  limit 1
$$;

-- Make a member an owner or a counselor (owner). The last owner can't step down.
create function public.set_org_member_role(p_member uuid, p_role text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.org_members;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select m.* into v_m from public.org_members m where m.id = p_member for update;
  if not found or not public.is_org_member(v_m.org_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if not public.is_org_owner(v_m.org_id) then
    raise exception 'owners_only' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'counselor') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_m.role = 'owner' and p_role = 'counselor'
     and not exists (select 1 from public.org_members m where m.org_id = v_m.org_id and m.role = 'owner' and m.id <> v_m.id) then
    raise exception 'last_owner' using errcode = '22023';
  end if;
  update public.org_members set role = p_role where id = p_member;
end;
$$;

-- Remove a member (owner). The last owner can't be removed; leaving is leave_organization().
create function public.remove_org_member(p_member uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.org_members;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select m.* into v_m from public.org_members m where m.id = p_member for update;
  if not found or not public.is_org_member(v_m.org_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if not public.is_org_owner(v_m.org_id) then
    raise exception 'owners_only' using errcode = '42501';
  end if;
  if v_m.role = 'owner'
     and not exists (select 1 from public.org_members m where m.org_id = v_m.org_id and m.role = 'owner' and m.id <> v_m.id) then
    raise exception 'last_owner' using errcode = '22023';
  end if;
  delete from public.org_members where id = p_member;
end;
$$;

-- Leave the caller's organization. The last owner names another owner first (or deletes the organization).
create function public.leave_organization() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.org_members;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select m.* into v_m from public.org_members m where m.org_id = public.my_org_id() and m.user_id = auth.uid() for update;
  if not found then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if v_m.role = 'owner'
     and not exists (select 1 from public.org_members m where m.org_id = v_m.org_id and m.role = 'owner' and m.id <> v_m.id) then
    raise exception 'last_owner' using errcode = '22023';
  end if;
  delete from public.org_members where id = v_m.id;
end;
$$;

-- Delete the organization (owner): soft-deleted, every grant ended, its notes and asks deleted, pending invitations
-- cancelled. The students' own data is untouched: none of it was ever the organization's. Memberships stay as the
-- record of who was in it (a deleted organization counts for nothing).
create function public.delete_organization(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if not public.is_org_owner(p_org) then
    raise exception 'owners_only' using errcode = '42501';
  end if;
  update public.org_students set ended_at = v_at, ended_by = auth.uid() where org_id = p_org and ended_at is null;
  delete from public.org_notes where org_id = p_org;
  delete from public.org_requests where org_id = p_org;
  update public.org_invitations set revoked_at = v_at where org_id = p_org and accepted_at is null and revoked_at is null;
  update public.organizations set deleted_at = v_at where id = p_org;
end;
$$;

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

-- Invite a student (any member) or a counselor (owners). Returns {id, token, expires_at}. Inviting an email that
-- already has a pending invitation of the same side returns that one (pasting a class list twice sends nothing
-- twice); a student already on the caseload is refused (already_on_caseload), as is a counselor already a member.
create function public.org_invite(p_org uuid, p_side text, p_email text, p_display_name text default null,
  p_grad_year integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_row public.org_invitations;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if p_side is null or p_side not in ('counselor', 'student') then
    raise exception 'invalid_side' using errcode = '22023';
  end if;
  if p_side = 'counselor' and not public.is_org_owner(p_org) then
    raise exception 'owners_only' using errcode = '42501';
  end if;
  if position('@' in v_email) < 2 or char_length(v_email) > 320 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_grad_year is not null and p_grad_year not between 2000 and 2100 then
    raise exception 'invalid_grad_year' using errcode = '22023';
  end if;

  if p_side = 'student' and exists (
    select 1 from auth.users u
    join public.students s on s.user_id = u.id and s.deleted_at is null
    join public.org_students g on g.student_id = s.id and g.org_id = p_org and g.ended_at is null
    where lower(u.email) = v_email
  ) then
    raise exception 'already_on_caseload' using errcode = '23505';
  end if;
  if p_side = 'counselor' and exists (
    select 1 from auth.users u join public.org_members m on m.user_id = u.id and m.org_id = p_org where lower(u.email) = v_email
  ) then
    raise exception 'already_a_member' using errcode = '23505';
  end if;

  -- Expired links stop being credentials here too (the trigger clears them on any later write).
  update public.org_invitations set token = null
    where org_id = p_org and token is not null and expires_at <= now();

  select i.* into v_row from public.org_invitations i
  where i.org_id = p_org and i.side = p_side and i.email = v_email
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and i.token is not null
  order by i.created desc
  limit 1;
  if found then
    return jsonb_build_object('id', v_row.id, 'token', v_row.token, 'expires_at', v_row.expires_at);
  end if;

  insert into public.org_invitations (org_id, side, email, display_name, grad_year, token_hash, token, invited_by)
  values (p_org, p_side, v_email, v_name, case when p_side = 'student' then p_grad_year end,
    public.org_token_hash(v_token), v_token, v_uid)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'token', v_token, 'expires_at', v_row.expires_at);
end;
$$;

-- Cancel a pending invitation (any member for a student's; owners for a counselor's).
create function public.cancel_org_invitation(p_invitation uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.org_invitations;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select i.* into v_inv from public.org_invitations i where i.id = p_invitation for update;
  if not found or not public.is_org_member(v_inv.org_id) then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.side = 'counselor' and not public.is_org_owner(v_inv.org_id) then
    raise exception 'owners_only' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  update public.org_invitations set revoked_at = coalesce(revoked_at, now()) where id = p_invitation;
end;
$$;

-- What an invitation link shows before it's accepted (the token is the credential, so signed-out visitors may ask).
-- Never the email. Null when the token is unknown or the organization is gone.
create function public.org_invitation_preview(p_token text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_name', o.name,
    'org_kind', o.kind,
    'inviter_name', case when p.deleted_at is null then p.display_name end,
    'side', i.side,
    'display_name', i.display_name,
    'expires_at', i.expires_at,
    'state', case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'pending' end
  )
  from public.org_invitations i
  join public.organizations o on o.id = i.org_id and o.deleted_at is null
  left join public.profiles p on p.id = i.invited_by
  where i.token_hash = public.org_token_hash(p_token)
$$;

-- What a join code shows (signed-out visitors may ask): the organization's name and kind and its counselors' names,
-- owners first. Null when no live organization has the code.
create function public.org_code_preview(p_code text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_name', o.name,
    'org_kind', o.kind,
    'join_code', o.join_code,
    'counselor_names', coalesce((
      select jsonb_agg(p.display_name order by (m.role = 'owner') desc, m.created, m.id)
      from public.org_members m
      join public.profiles p on p.id = m.user_id and p.deleted_at is null and p.display_name is not null
      where m.org_id = o.id
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.deleted_at is null and o.join_code = public.org_normalize_code(p_code)
$$;

-- Accept an invitation as the signed-in user.
--   side 'counselor': the caller (signed in with the invited email) becomes a counselor of the organization; returns
--     the membership id. A person already in another live organization is refused (already_in_organization).
--   side 'student': grants the organization access to the caller's own student record (p_student null; the app makes
--     the record first, as /me does), or to p_student, a student of the caller's family; returns the grant id. A
--     student already on the caseload keeps their grant and the invitation is marked used.
-- Refuses an unknown token or a deleted organization (invitation_not_found), a cancelled (invitation_revoked), used
-- (invitation_used), or expired (invitation_expired) one.
create function public.accept_org_invitation(p_token text, p_student uuid default null) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.org_invitations;
  v_email text;
  v_student uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select i.* into v_inv
  from public.org_invitations i
  join public.organizations o on o.id = i.org_id and o.deleted_at is null
  where i.token_hash = public.org_token_hash(p_token)
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

  if v_inv.side = 'counselor' then
    select lower(u.email) into v_email from auth.users u where u.id = v_uid;
    if v_email is distinct from lower(v_inv.email) then
      raise exception 'invitation_wrong_email' using errcode = '42501';
    end if;
    insert into public.org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, 'counselor')
    on conflict (org_id, user_id) do nothing
    returning id into v_id;
    if v_id is null then
      select m.id into v_id from public.org_members m where m.org_id = v_inv.org_id and m.user_id = v_uid;
    end if;
  else
    v_student := public.org_join_student(p_student);
    v_id := public.org_grant(v_inv.org_id, v_student, 'invite');
  end if;

  update public.org_invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_id;
end;
$$;

-- Join an organization by its code, for the caller's own student record or a student of their family (as above;
-- source 'code'). Returns the grant id (the existing one when the student is already on the caseload).
create function public.join_organization(p_code text, p_student uuid default null) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select o.id into v_org from public.organizations o
  where o.deleted_at is null and o.join_code = public.org_normalize_code(p_code);
  if v_org is null then
    raise exception 'no_such_code' using errcode = 'P0002';
  end if;
  return public.org_grant(v_org, public.org_join_student(p_student), 'code');
end;
$$;

/* ------------------------------------------------------------------ */
/* The grant, from the family's side and the office's                  */
/* ------------------------------------------------------------------ */

-- End a grant: the student, a guardian of the student (or the guardian managing the record), or a member of the
-- organization. Access stops at once.
create function public.end_org_access(p_grant uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.org_students;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select g.* into v_g from public.org_students g where g.id = p_grant for update;
  if not found or not (public.is_family_of(v_g.student_id) or public.is_org_member(v_g.org_id)) then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  if v_g.ended_at is not null then
    raise exception 'grant_ended' using errcode = '22023';
  end if;
  update public.org_students set ended_at = now(), ended_by = auth.uid() where id = p_grant;
end;
$$;

-- Edit or view only: the student or their family decides; the organization never does.
create function public.set_org_student_can_edit(p_grant uuid, p_can_edit boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.org_students;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select g.* into v_g from public.org_students g where g.id = p_grant for update;
  if not found or not public.is_family_of(v_g.student_id) then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  if v_g.ended_at is not null then
    raise exception 'grant_ended' using errcode = '22023';
  end if;
  update public.org_students set can_edit = coalesce(p_can_edit, false) where id = p_grant;
end;
$$;

-- The live grants of the caller's own student record and of every student of their family: the organization's name
-- and its counselors' names (owners first), for /account's "Your counselors" and a child's page in the household.
create function public.my_counselor_grants()
returns table (grant_id uuid, org_id uuid, org_name text, counselor_names text[], can_edit boolean, granted_at timestamptz,
  student_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id,
         o.id,
         o.name,
         array(
           select p.display_name from public.org_members m
           join public.profiles p on p.id = m.user_id and p.deleted_at is null and p.display_name is not null
           where m.org_id = o.id
           order by (m.role = 'owner') desc, m.created, m.id
         ),
         g.can_edit,
         g.granted_at,
         g.student_id
  from public.org_students g
  join public.organizations o on o.id = g.org_id and o.deleted_at is null
  where auth.uid() is not null and g.ended_at is null and public.is_family_of(g.student_id)
  order by g.granted_at, g.id
$$;

-- The caseload's people: every student with a live grant, then pending and expired student invitations (status
-- 'invited' with the clear token for Copy link, or 'expired' without it). Empty for anyone but a member.
create function public.org_roster(p_org uuid)
returns table (
  status text,
  grant_id uuid,
  student_id uuid,
  display_name text,
  grad_year integer,
  can_edit boolean,
  granted_at timestamptz,
  source text,
  has_account boolean,
  invitation_id uuid,
  email text,
  expires_at timestamptz,
  token text
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.status, u.grant_id, u.student_id, u.display_name, u.grad_year, u.can_edit, u.granted_at, u.source,
         u.has_account, u.invitation_id, u.email, u.expires_at, u.token
  from (
    select 'active'::text as status, g.id as grant_id, s.id as student_id,
           coalesce(s.display_name, sp.display_name) as display_name, s.grad_year, g.can_edit, g.granted_at, g.source,
           s.user_id is not null as has_account, null::uuid as invitation_id, null::text as email,
           null::timestamptz as expires_at, null::text as token, null::timestamptz as invited_at
    from public.org_students g
    join public.students s on s.id = g.student_id and s.deleted_at is null
    left join public.profiles sp on sp.id = s.user_id
    where g.org_id = p_org and g.ended_at is null
    union all
    select case when i.expires_at > now() then 'invited' else 'expired' end, null, null, i.display_name, i.grad_year,
           null, null, null, null, i.id, i.email, i.expires_at, case when i.expires_at > now() then i.token end, i.created
    from public.org_invitations i
    where i.org_id = p_org and i.side = 'student' and i.accepted_at is null and i.revoked_at is null
  ) u
  where public.is_org_member(p_org)
  order by u.status <> 'active', lower(coalesce(u.display_name, u.email, '')), u.invited_at, u.student_id, u.invitation_id
$$;

/* ------------------------------------------------------------------ */
/* Asks                                                                */
/* ------------------------------------------------------------------ */

-- A member asks a student on the caseload for something: a record section, a first list, or one custom line. One open
-- ask per (organization, student, kind, section) for record sections and lists (ask_open); at most three a week per
-- student from one organization (ask_limit), as nudges are limited.
create function public.org_ask(p_org uuid, p_student uuid, p_kind text, p_section text default null, p_note text default null)
returns public.org_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section text := nullif(btrim(coalesce(p_section, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.org_requests;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if not public.org_has_student(p_org, p_student) then
    raise exception 'grant_ended' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('record_section', 'list', 'custom')
     or (p_kind = 'record_section' and (v_section is null or v_section !~ '^[a-z][a-z0-9_]{0,63}$'))
     or (p_kind <> 'record_section' and v_section is not null)
     or (p_kind = 'custom' and v_note is null)
     or (v_note is not null and char_length(v_note) > 200) then
    raise exception 'invalid_ask' using errcode = '22023';
  end if;
  -- One at a time per organization and student, so two counselors clicking at once can't both get past the checks.
  perform 1 from public.org_students g where g.org_id = p_org and g.student_id = p_student and g.ended_at is null for update;
  if p_kind <> 'custom' and exists (
    select 1 from public.org_requests r
    where r.org_id = p_org and r.student_id = p_student and r.kind = p_kind
      and r.section is not distinct from v_section and r.done_at is null
  ) then
    raise exception 'ask_open' using errcode = '23505';
  end if;
  if (select count(*) from public.org_requests r
      where r.org_id = p_org and r.student_id = p_student and r.created > now() - interval '7 days') >= 3 then
    raise exception 'ask_limit' using errcode = '23514';
  end if;
  insert into public.org_requests (org_id, student_id, kind, section, note, created_by)
  values (p_org, p_student, p_kind, v_section, v_note, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- Mark an ask done: the student, their family, or a member of the organization.
create function public.org_ask_done(p_request uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.org_requests;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select r.* into v_r from public.org_requests r where r.id = p_request for update;
  if not found or not (public.is_org_member(v_r.org_id)
      or (public.is_family_of(v_r.student_id) and public.org_has_student(v_r.org_id, v_r.student_id))) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  update public.org_requests set done_at = coalesce(done_at, now()) where id = p_request;
end;
$$;

-- The family saw an ask (the notice rendered). Only the family's view counts.
create function public.org_ask_seen(p_request uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.org_requests;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select r.* into v_r from public.org_requests r where r.id = p_request for update;
  if not found or not (public.is_family_of(v_r.student_id) and public.org_has_student(v_r.org_id, v_r.student_id)) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  update public.org_requests set seen_at = coalesce(seen_at, now()) where id = p_request;
end;
$$;

-- A student's open asks with who asked, for the notice at the top of Next steps: to the family, every live grant's
-- asks; to a member viewing the student, their own organization's. Names come through here because profiles is
-- own-row only.
create function public.org_open_asks(p_student uuid)
returns table (id uuid, org_id uuid, org_name text, kind text, section text, note text, created timestamptz,
  asked_by_name text, seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.org_id, o.name, r.kind, r.section, r.note, r.created,
         case when p.deleted_at is null then p.display_name end, r.seen_at
  from public.org_requests r
  join public.organizations o on o.id = r.org_id and o.deleted_at is null
  join public.org_students g on g.org_id = r.org_id and g.student_id = r.student_id and g.ended_at is null
  left join public.profiles p on p.id = r.created_by
  where r.student_id = p_student and r.done_at is null
    and (public.is_family_of(p_student) or public.is_org_member(r.org_id))
  order by r.created, r.id
$$;

/* ------------------------------------------------------------------ */
/* Essays: a counselor's comment and suggestion say so                 */
/* ------------------------------------------------------------------ */

-- As in 20261029120000_essays.sql, plus 'counselor' when the caller is neither the student nor a guardian of the
-- student (nor the guardian managing the record) but reads the draft through a grant. A guardian who is also a
-- counselor comments as the guardian: the family's relation wins.
create or replace function public.essay_comments_set_author() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
begin
  select e.student_id into v_student from public.essays e where e.id = new.essay_id;
  new.author_id := auth.uid();
  new.author_role := case
    when public.is_own_essay(new.essay_id) then 'student'
    when public.is_guardian_of(v_student, false)
      or exists (select 1 from public.students s where s.id = v_student and s.managed_by = auth.uid()) then 'guardian'
    when public.is_counselor_of(v_student, false) then 'counselor'
    else 'guardian'
  end;
  new.resolved_at := null;
  new.created := now();
  if new.version_id is not null and not exists (select 1 from public.essay_versions v where v.id = new.version_id and v.essay_id = new.essay_id) then
    raise exception 'essay_version' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- As in 20261101120000_essay_suggestions.sql, with the same rule for the author's role.
create or replace function public.essay_suggestions_set_author() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
begin
  if public.is_own_essay(new.essay_id) then
    raise exception 'essay_suggestion_own' using errcode = '42501', detail = 'the student doesn''t suggest on their own draft';
  end if;
  select e.student_id into v_student from public.essays e where e.id = new.essay_id;
  new.author_id := auth.uid();
  new.author_role := case
    when public.is_guardian_of(v_student, false)
      or exists (select 1 from public.students s where s.id = v_student and s.managed_by = auth.uid()) then 'guardian'
    when public.is_counselor_of(v_student, false) then 'counselor'
    else 'guardian'
  end;
  new.status := 'open';
  new.decisions := '{}'::jsonb;
  new.decided_at := null;
  new.created := now();
  new.updated := now();
  if new.base_version_id is not null and not exists (select 1 from public.essay_versions v where v.id = new.base_version_id and v.essay_id = new.essay_id) then
    raise exception 'essay_version' using errcode = '23514';
  end if;
  return new;
end;
$$;

/* ------------------------------------------------------------------ */
/* A managed record merged into the student's own keeps its counselors */
/* ------------------------------------------------------------------ */

-- merge_managed_student() as in 20261006150000_household_hub.sql, plus: the managed record's live grants, notes, and
-- asks move to the student's own record (a grant the own record already has with the same organization wins, and the
-- managed one is ended).
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

  -- Counselors: live grants follow the student; one the own record already has wins.
  update public.org_students g set ended_at = now()
    where g.student_id = p_managed and g.ended_at is null
      and exists (select 1 from public.org_students o where o.student_id = p_own and o.org_id = g.org_id and o.ended_at is null);
  update public.org_students set student_id = p_own where student_id = p_managed and ended_at is null;
  update public.org_notes set student_id = p_own where student_id = p_managed;
  update public.org_requests set student_id = p_own where student_id = p_managed;

  update public.access_log set student_id = p_own where student_id = p_managed;
  update public.students set deleted_at = now() where id = p_managed and user_id is null;
end;
$$;

/* ------------------------------------------------------------------ */
/* viewer_bundle(): plus the caller's grants as a member               */
/* ------------------------------------------------------------------ */

-- As in 20261013100000_viewer_bundle_pause.sql, plus `grants`: the caller's live grants as a member of a live
-- organization ({org_id, student_id, can_edit}), so lib/auth.ts studentsICanSee() tells a counselor's students from a
-- guardian's in the same round trip. Security invoker as before: `students` and `student_profiles` now include the
-- caseload's students, because row-level security lets the counselor read them.
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
    ),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object('org_id', g.org_id, 'student_id', g.student_id, 'can_edit', g.can_edit)
        order by g.granted_at, g.id)
      from public.org_students g
      join public.org_members m on m.org_id = g.org_id and m.user_id = auth.uid()
      join public.organizations o on o.id = g.org_id and o.deleted_at is null
      where g.ended_at is null
    ), '[]'::jsonb)
  )
$$;

/* ------------------------------------------------------------------ */
/* Function privileges                                                 */
/* ------------------------------------------------------------------ */

-- Policy helpers: callable by signed-in users (policies run as them), like can_read_student.
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.is_org_owner(uuid) from public, anon;
revoke execute on function public.is_counselor_of(uuid, boolean) from public, anon;
revoke execute on function public.is_family_of(uuid) from public, anon;
revoke execute on function public.org_has_student(uuid, uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;
grant execute on function public.is_counselor_of(uuid, boolean) to authenticated, service_role;
grant execute on function public.is_family_of(uuid) to authenticated, service_role;
grant execute on function public.org_has_student(uuid, uuid) to authenticated, service_role;

-- Internal: nobody but the service role.
revoke execute on function public.my_org_id() from public, anon, authenticated;
revoke execute on function public.org_random_code() from public, anon, authenticated;
revoke execute on function public.org_new_join_code() from public, anon, authenticated;
revoke execute on function public.org_join_student(uuid) from public, anon, authenticated;
revoke execute on function public.org_grant(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.org_members_one_org() from public, anon, authenticated;
revoke execute on function public.org_invitations_clear_token() from public, anon, authenticated;
revoke execute on function public.org_notes_stamp() from public, anon, authenticated;
revoke execute on function public.students_guard_counselor() from public, anon, authenticated;
grant execute on function public.my_org_id() to service_role;
grant execute on function public.org_random_code() to service_role;
grant execute on function public.org_new_join_code() to service_role;
grant execute on function public.org_join_student(uuid) to service_role;
grant execute on function public.org_grant(uuid, uuid, text) to service_role;

-- Pure helpers (no data): anyone.
grant execute on function public.org_normalize_code(text) to anon, authenticated, service_role;
grant execute on function public.org_token_hash(text) to anon, authenticated, service_role;

-- The API.
revoke execute on function public.create_organization(text, text, text, text) from public, anon;
revoke execute on function public.update_organization(uuid, text, text, text) from public, anon;
revoke execute on function public.regenerate_join_code(uuid) from public, anon;
revoke execute on function public.my_organization() from public, anon;
revoke execute on function public.set_org_member_role(uuid, text) from public, anon;
revoke execute on function public.remove_org_member(uuid) from public, anon;
revoke execute on function public.leave_organization() from public, anon;
revoke execute on function public.delete_organization(uuid) from public, anon;
revoke execute on function public.org_invite(uuid, text, text, text, integer) from public, anon;
revoke execute on function public.cancel_org_invitation(uuid) from public, anon;
revoke execute on function public.org_invitation_preview(text) from public;
revoke execute on function public.org_code_preview(text) from public;
revoke execute on function public.accept_org_invitation(text, uuid) from public, anon;
revoke execute on function public.join_organization(text, uuid) from public, anon;
revoke execute on function public.end_org_access(uuid) from public, anon;
revoke execute on function public.set_org_student_can_edit(uuid, boolean) from public, anon;
revoke execute on function public.my_counselor_grants() from public, anon;
revoke execute on function public.org_roster(uuid) from public, anon;
revoke execute on function public.org_ask(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.org_ask_done(uuid) from public, anon;
revoke execute on function public.org_ask_seen(uuid) from public, anon;
revoke execute on function public.org_open_asks(uuid) from public, anon;
revoke execute on function public.my_access_log(integer) from public, anon;

grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.update_organization(uuid, text, text, text) to authenticated;
grant execute on function public.regenerate_join_code(uuid) to authenticated;
grant execute on function public.my_organization() to authenticated;
grant execute on function public.set_org_member_role(uuid, text) to authenticated;
grant execute on function public.remove_org_member(uuid) to authenticated;
grant execute on function public.leave_organization() to authenticated;
grant execute on function public.delete_organization(uuid) to authenticated;
grant execute on function public.org_invite(uuid, text, text, text, integer) to authenticated;
grant execute on function public.cancel_org_invitation(uuid) to authenticated;
grant execute on function public.org_invitation_preview(text) to anon, authenticated;
grant execute on function public.org_code_preview(text) to anon, authenticated;
grant execute on function public.accept_org_invitation(text, uuid) to authenticated;
grant execute on function public.join_organization(text, uuid) to authenticated;
grant execute on function public.end_org_access(uuid) to authenticated;
grant execute on function public.set_org_student_can_edit(uuid, boolean) to authenticated;
grant execute on function public.my_counselor_grants() to authenticated;
grant execute on function public.org_roster(uuid) to authenticated;
grant execute on function public.org_ask(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.org_ask_done(uuid) to authenticated;
grant execute on function public.org_ask_seen(uuid) to authenticated;
grant execute on function public.org_open_asks(uuid) to authenticated;
grant execute on function public.my_access_log(integer) to authenticated;
