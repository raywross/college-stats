-- Visit events, second cut (specs/product/visit-events.md), from building the alert job:
-- * visit_events.moved_at: when the start or the venue last changed. changed_at also moves on an availability flip
--   (open → full), which must not send a "moved to" alert; the sync sets moved_at only for a date or place change.
-- * visit_alert_prefs.created: the first-night rule ("no backlog email the night you turn alerts on") needs the row's
--   creation, not its last update, or a radius change would also skip a night.
-- * Admins read the alert tables, like notification_prefs and digests (20261012200000_admin.sql), so the admin
--   console's export and a person's page show them.

alter table public.visit_events add column moved_at timestamptz;

alter table public.visit_alert_prefs add column created timestamptz not null default now();
-- Rows that already exist were created when alerts started; treat them as old so they aren't held back a night.
update public.visit_alert_prefs set created = now() - interval '2 days';

create policy "Admins read" on public.visit_alert_prefs for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.visit_alert_mutes for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.visit_alerts for select to authenticated using ((select public.admin_reads()));
