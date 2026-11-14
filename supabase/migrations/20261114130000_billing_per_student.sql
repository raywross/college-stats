-- Billing, redrawn on the owner's decisions of 2026-11-14 (specs/product/commercialization.md "As built"):
-- one price, $20 a year per student; the trial starts the moment a student record exists, with no card; a parent
-- keeps one card on file for the household and pays for each student they add; a counselor may invite a parent.
--
-- * `advisor_trials`: one row per student, written by a trigger on `students` so every door in (a student's own
--   sign-up, a parent's Add a student, a counselor's invitation) starts the same 14 days. The entitlement hook reads it
--   beside `subscriptions`: a running trial is whole; an ended one with no subscription is read-only.
-- * `billing_customers` learns the card on file (Stripe's payment method id, brand, last four), saved once through a
--   Checkout session in setup mode; the server charges each student's subscription against it.
-- * `advisor_access()` returns the trial with the subscriptions; `subscriptions_covering()` is the student rule alone.
-- * `org_invite_guardian()`: a counselor invites a parent for a student on their caseload. The student's household is
--   used, or made (named after the student, with the student in it); the parent's invitation is the ordinary one and
--   the counselor is never a member of the household.

create table public.advisor_trials (
  student_id       uuid primary key references public.students (id) on delete cascade,
  started_at       timestamptz not null default now(),
  ends_at          timestamptz not null,
  source           text not null default 'student' check (source in ('student', 'guardian', 'counselor', 'system')),
  reminder_sent_at timestamptz
);

alter table public.advisor_trials enable row level security;
-- can_read_student(), not visible_student_ids(): the set function arrives with 20261108120000_fast_policies.sql, and the
-- policy tests build worlds without it. One row per student, so the per-row check costs nothing here.
create policy advisor_trials_read on public.advisor_trials for select to authenticated
  using (public.can_read_student(student_id));
grant select on public.advisor_trials to authenticated;
grant all on public.advisor_trials to service_role;

-- Every new student record starts its trial now. Security definer: the table has no insert policy for people.
create function public.students_start_trial() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.advisor_trials (student_id, ends_at, source)
  values (new.id, now() + interval '14 days', case when new.managed_by is not null then 'guardian' else 'student' end)
  on conflict (student_id) do nothing;
  return new;
end;
$$;

create trigger students_start_trial
after insert on public.students
for each row execute function public.students_start_trial();

alter table public.billing_customers
  add column default_payment_method text,
  add column card_brand text,
  add column card_last4 text,
  add column card_updated_at timestamptz;

-- The subscriptions covering one student: the student plan naming them (the family plan is gone).
create or replace function public.subscriptions_covering(p_student uuid) returns setof public.subscriptions
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.subscriptions s where s.covers_student_id = p_student;
$$;

-- One read for the hook and the caseload chip: per student the caller may read (every student for the service role),
-- the accounts behind them, the trial, and the covering subscriptions.
create or replace function public.advisor_access(p_students uuid[]) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_student uuid;
  v_created jsonb;
  v_rows jsonb;
  v_trial jsonb;
begin
  foreach v_student in array coalesce(p_students, '{}'::uuid[]) loop
    if auth.role() <> 'service_role' and not public.can_read_student(v_student) then
      continue;
    end if;
    select coalesce(jsonb_agg(p.created), '[]'::jsonb) into v_created
    from public.students st
    join public.profiles p on p.id = st.user_id or p.id = st.managed_by
    where st.id = v_student;
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_rows from public.subscriptions_covering(v_student) s;
    select to_jsonb(t) into v_trial from public.advisor_trials t where t.student_id = v_student;
    v_out := v_out || jsonb_build_object('student_id', v_student, 'created', v_created, 'trial', v_trial, 'subscriptions', v_rows);
  end loop;
  return v_out;
end;
$$;

-- A counselor invites a parent for a student on their caseload (specs/product/counselor-portal.md "Inviting a
-- parent"). Returns the invitation's id, its one-time token, its expiry, and the household's id and name.
create function public.org_invite_guardian(p_student uuid, p_email text, p_display_name text default null) returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_household uuid;
  v_household_name text;
  v_first text;
  v_row public.invitations;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.org_students g
    join public.org_members m on m.org_id = g.org_id
    where g.student_id = p_student and g.ended_at is null and m.user_id = v_uid
  ) then
    raise exception 'not_on_caseload' using errcode = '42501';
  end if;
  if position('@' in v_email) < 2 or char_length(v_email) > 320 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where u.id = v_uid and lower(u.email) = v_email) then
    raise exception 'invite_self' using errcode = '22023';
  end if;

  -- The student's household, or a new one named after them with the student in it.
  select m.household_id into v_household
  from public.household_members m
  join public.households h on h.id = m.household_id and h.deleted_at is null
  where m.student_id = p_student and m.role = 'student' and m.status = 'active'
  order by m.created
  limit 1;
  if v_household is null then
    select coalesce(nullif(split_part(btrim(coalesce(s.display_name, '')), ' ', 1), ''), 'Student') into v_first
    from public.students s where s.id = p_student and s.deleted_at is null;
    if not found then
      raise exception 'student_not_found' using errcode = 'P0002';
    end if;
    insert into public.households (name, created_by) values (v_first || '''s household', v_uid) returning id into v_household;
    insert into public.household_members (household_id, student_id, role, status, accepted_at)
    values (v_household, p_student, 'student', 'active', now());
  end if;
  select h.name into v_household_name from public.households h where h.id = v_household;

  if exists (
    select 1 from public.household_members m join auth.users u on u.id = m.user_id
    where m.household_id = v_household and m.role = 'guardian' and m.status = 'active' and lower(u.email) = v_email
  ) then
    raise exception 'already_a_guardian' using errcode = '23505';
  end if;

  insert into public.invitations (household_id, token_hash, email, side, student_id, can_edit, invited_by)
  values (v_household, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_email, 'guardian', null, true, v_uid)
  returning * into v_row;

  return json_build_object('id', v_row.id, 'token', v_token, 'expires_at', v_row.expires_at, 'household_id', v_household, 'household_name', v_household_name);
end;
$$;

revoke execute on function public.org_invite_guardian(uuid, text, text) from public, anon;
grant execute on function public.org_invite_guardian(uuid, text, text) to authenticated, service_role;
