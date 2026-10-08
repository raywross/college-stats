-- The planner's timeline unit (specs/planner/timeline.md "Reminders", "Texts"; U5). Additive to
-- 20261008120000_planner.sql, which this unit doesn't edit:
-- 1. notification_prefs.your_week: the "Your week" switch. Null means the default by grade (off for juniors before
--    spring, on for seniors in season; lib/emails/your-week.ts yourWeekDefault), true/false an explicit choice.
-- 2. unsubscribe_your_week_by_token(token): the Your week email's one-click unsubscribe, like unsubscribe_by_token.
-- 3. sms_sends: every text sent (or the confirmation), written only by the server jobs with the secret key. The unique
--    (consent_id, sent_on) index is the "at most one text a day per person" rule; sent_on is the day in the
--    household's time zone. The person and their household's guardians can read when texts went (no bodies stored).

/* ------------------------------------------------------------------ */
/* 1. Your week switch                                                 */
/* ------------------------------------------------------------------ */

alter table public.notification_prefs add column your_week boolean;
grant update (your_week) on public.notification_prefs to authenticated;

/* ------------------------------------------------------------------ */
/* 2. One-click unsubscribe from Your week                             */
/* ------------------------------------------------------------------ */

create function public.unsubscribe_your_week_by_token(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  update public.notification_prefs set your_week = false, updated = now() where unsubscribe_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.unsubscribe_your_week_by_token(text) from public;
grant execute on function public.unsubscribe_your_week_by_token(text) to anon, authenticated, service_role;

/* ------------------------------------------------------------------ */
/* 3. Texts sent                                                       */
/* ------------------------------------------------------------------ */

create table public.sms_sends (
  id           bigint generated always as identity primary key,
  consent_id   uuid not null references public.sms_consents (id) on delete cascade,
  kind         text not null check (kind in ('confirm', 'week', 'day_before', 'nudge', 'parent')),
  -- The household's local day the text went out on (lib/sms.ts localDay).
  sent_on      date not null,
  task_id      uuid references public.plan_tasks (id) on delete set null,
  provider_sid text check (char_length(provider_sid) <= 64),
  created_at   timestamptz not null default now()
);

create unique index sms_sends_one_a_day_idx on public.sms_sends (consent_id, sent_on);

alter table public.sms_sends enable row level security;

create policy "Texts sent: the person reads" on public.sms_sends for select to authenticated
  using (exists (
    select 1 from public.sms_consents c
    where c.id = consent_id
      and (c.user_id = auth.uid() or (c.student_id is not null and public.can_read_student(c.student_id)))
  ));

revoke all on public.sms_sends from anon, authenticated;
grant select on public.sms_sends to authenticated;
grant all on public.sms_sends to service_role;
