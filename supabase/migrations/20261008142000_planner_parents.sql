-- Parents (specs/planner/parents.md; U8). Additive to 20261008120000_planner.sql and 20261008131000_planner_timeline.sql,
-- neither of which this unit edits:
-- 1. notification_prefs.parent_summary: the weekly parent-summary email switch, off by default (null/false). One row
--    per guardian (their own user_id row, like your_week for a student).
-- 2. notification_prefs.nudge_emails: whether a student (or anyone nudged) gets a nudge by email, on by default; off
--    doesn't touch in-app nudges, which always show.
-- 3. unsubscribe_parent_summary_by_token(token): the parent summary's one-click unsubscribe, like
--    unsubscribe_your_week_by_token.
-- 4. student_nudge_emails_off(student): lets a guardian of the student learn whether the student turned nudge
--    emails off, without reading the student's notification_prefs row directly (which stays owner-only).

/* ------------------------------------------------------------------ */
/* 1–2. Switches                                                       */
/* ------------------------------------------------------------------ */

alter table public.notification_prefs
  add column parent_summary boolean,
  add column nudge_emails boolean not null default true;

grant update (parent_summary, nudge_emails) on public.notification_prefs to authenticated;

/* ------------------------------------------------------------------ */
/* 3. One-click unsubscribe from the parent summary                    */
/* ------------------------------------------------------------------ */

create function public.unsubscribe_parent_summary_by_token(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  update public.notification_prefs set parent_summary = false, updated = now() where unsubscribe_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.unsubscribe_parent_summary_by_token(text) from public;
grant execute on function public.unsubscribe_parent_summary_by_token(text) to anon, authenticated, service_role;

/* ------------------------------------------------------------------ */
/* 4. Whether a student reads nudges by email (for the nudge button's   */
/*    "Alex reads nudges in the plan" wording)                          */
/* ------------------------------------------------------------------ */

create function public.student_nudge_emails_off(p_student uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_off boolean;
begin
  if not public.is_guardian_of(p_student, false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select not coalesce(p.nudge_emails, true) into v_off
    from public.notification_prefs p
    join public.students s on s.user_id = p.user_id
    where s.id = p_student;
  return coalesce(v_off, false);
end;
$$;

revoke execute on function public.student_nudge_emails_off(uuid) from public;
grant execute on function public.student_nudge_emails_off(uuid) to authenticated;
