-- The season brief (specs/planner/next-steps/notifications.md "The season brief"; build-plan.md U6). Additive to
-- 20261014120000_next_steps.sql, which added notification_prefs.season_brief:
-- 1. unsubscribe_season_brief_by_token(token): the brief's one-click unsubscribe, like unsubscribe_your_week_by_token
--    (20261008131000_planner_timeline.sql). Sets season_brief = false on the token's row.
-- 2. season_briefs_sent: one row per person, student, and brief turn (a season, or freshman_feb / sophomore_feb, in
--    the school year starting cycle_start), written by the weekly job (app/api/cron/weekly/route.ts) only after a real
--    send, so the same turn is never mailed twice and nothing is lost while email is dormant. Service role only: no
--    one reads it from the browser.
--
-- Additive and backward-compatible (specs/supabase.md "Migrations"): a new function and a new table. Until it's
-- applied the weekly job skips the brief step (reading the table fails). Apply to dev, then prod, in the SQL Editor.

/* ------------------------------------------------------------------ */
/* 1. One-click unsubscribe from the season brief                      */
/* ------------------------------------------------------------------ */

create function public.unsubscribe_season_brief_by_token(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  update public.notification_prefs set season_brief = false, updated = now() where unsubscribe_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.unsubscribe_season_brief_by_token(text) from public;
grant execute on function public.unsubscribe_season_brief_by_token(text) to anon, authenticated, service_role;

/* ------------------------------------------------------------------ */
/* 2. Briefs sent                                                      */
/* ------------------------------------------------------------------ */

create table public.season_briefs_sent (
  user_id     uuid not null references auth.users (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  season      text not null check (season in ('freshman', 'freshman_feb', 'sophomore', 'sophomore_feb', 'junior_fall', 'junior_winter', 'junior_spring', 'summer_before_senior', 'senior_fall', 'senior_winter', 'senior_spring', 'summer_after')),
  cycle_start int not null,
  sent_at     timestamptz not null default now(),
  primary key (user_id, student_id, season, cycle_start)
);

alter table public.season_briefs_sent enable row level security;
-- No policies: only the secret-key server jobs read and write it.
revoke all on public.season_briefs_sent from anon, authenticated;
grant all on public.season_briefs_sent to service_role;
