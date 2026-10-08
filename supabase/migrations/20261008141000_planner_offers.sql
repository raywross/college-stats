-- The offers stage (specs/planner/offers.md "After the choice", "Where they went"): the student's opt-in to share
-- where they went with the pooled self-reported outcomes (scattergrams.md), stored as a flag on their list. Only the
-- flag is stored here; the pooled outcomes table is a later spec. Additive. Apply after
-- 20261008133000_planner_rounds.sql (SQL Editor, dev first, then prod). Tested in tests/planner-offers-policies.test.mts.
--
-- Rules:
-- 1. Only the student's own account changes the consent; when the student has no account (a record a guardian
--    manages), a guardian who can edit the student may. A view-only guardian, another household member, or a
--    guardian of a student who has their own account can't, even though they may edit the list itself.
-- 2. consented_by is whoever is signed in when the consent is given (never trusted from the request); clearing the
--    consent clears both columns.
-- 3. A guardian's own list (lists.user_id) has no consent: the planner is the student's.

alter table public.lists
  add column outcome_share_consented_at timestamptz,
  -- No check pairing the two: deleting the consenting account sets _by to null and keeps the date (a guardian who
  -- consented for a managed student and later left); the trigger pairs them on every write through the API.
  add column outcome_share_consented_by uuid references auth.users (id) on delete set null;

-- Who may give or withdraw the consent on a list (security definer: reads the student record past its policies).
create function public.can_consent_outcome_share(p_student uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and p_student is not null and exists (
    select 1 from public.students s
    where s.id = p_student
      and (s.user_id = auth.uid() or (s.user_id is null and coalesce(public.can_edit_student(s.id), false)))
  )
$$;

revoke execute on function public.can_consent_outcome_share(uuid) from public, anon;
grant execute on function public.can_consent_outcome_share(uuid) to authenticated, service_role;

create function public.lists_outcome_share_rules() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.outcome_share_consented_at is not distinct from old.outcome_share_consented_at
     and new.outcome_share_consented_by is not distinct from old.outcome_share_consented_by then
    return new;
  end if;
  if tg_op = 'INSERT' and new.outcome_share_consented_at is null and new.outcome_share_consented_by is null then
    return new;
  end if;
  -- The service role (scripts, account deletion) may set or clear it as it is.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.student_id is null or not public.can_consent_outcome_share(new.student_id) then
    raise exception 'outcome_share_not_allowed' using errcode = '42501';
  end if;
  if new.outcome_share_consented_at is null then
    new.outcome_share_consented_by := null;
  else
    new.outcome_share_consented_at := now();
    new.outcome_share_consented_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger lists_outcome_share_rules
before insert or update of outcome_share_consented_at, outcome_share_consented_by on public.lists
for each row execute function public.lists_outcome_share_rules();
