-- Visit events, third cut (specs/product/visit-events.md, "What is stored, read in detail, and shown"; owner 2026-10-14):
-- every listing row is stored, but only five kinds are ever shown: tour, info_session, open_house, travel, online.
-- The rest (`other`: appointment slots, interviews, counselor and coach meetings, meals, bare first names that are
-- individual counselors' calendars; `staff`: shipping, pickups, filled group slots) are what a Slate database exposes
-- without meaning to, like UNC's 734 "Admissions Drop-In" slots. They stay in the table for later, read from the
-- listing alone, and no signed-in reader, count, or alert sees them.

drop policy visit_events_read on public.visit_events;
create policy visit_events_read on public.visit_events for select to authenticated
  using (
    removed_at is null
    and kind in ('tour', 'info_session', 'open_house', 'travel', 'online')
    and starts_at >= now() - interval '1 day'
  );

create or replace function public.visit_event_count(p_unit_id text) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.visit_events
  where unit_id = p_unit_id
    and removed_at is null
    and kind in ('tour', 'info_session', 'open_house', 'travel', 'online')
    and starts_at >= now() - interval '1 day';
$$;
