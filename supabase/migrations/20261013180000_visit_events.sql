-- Visit events (specs/product/visit-events.md): every event a Slate college publishes, read nightly by
-- scripts/sync-visit-events.mts, shown to signed-in people, and the per-person alert settings the nightly email reads.
--
-- Public data (slate_hosts, visit_events, visit_event_sync): written only by the secret key; `authenticated` reads the
-- upcoming non-staff rows; `anon` reads nothing (owner decision 2026-10-13: signed-in only). A signed-out college page
-- learns only a count through visit_event_count().
-- People's data (visit_alert_prefs, visit_alert_mutes, visit_alerts): own-row RLS, like notification_prefs and digests.

-- ---------------------------------------------------------------------------------------------------------------------
-- Public data
-- ---------------------------------------------------------------------------------------------------------------------

create table public.slate_hosts (
  unit_id      text primary key check (unit_id ~ '^[0-9]{1,10}$'),
  host         text not null check (host ~ '^[a-z0-9.-]+$'),
  -- The page the host was found on (the college's visit page, or its apply link).
  found_on     text,
  -- Portal pages and their event widgets: [{"page": "/portal/visits", "service": "/portal/widget/event?portal_id=…&part=…"}].
  portal_parts jsonb not null default '[]'::jsonb check (jsonb_typeof(portal_parts) = 'array'),
  status       text not null default 'active' check (status in ('active', 'unreachable', 'no_events', 'off')),
  failures     integer not null default 0,
  first_seen   timestamptz not null default now(),
  last_read    timestamptz,
  last_error   text
);

create table public.visit_events (
  -- host || ':' || slate_id: the same event found through the standard search and a portal widget is one row.
  id             text primary key,
  unit_id        text not null check (unit_id ~ '^[0-9]{1,10}$'),
  host           text not null,
  slate_id       uuid not null,
  title          text not null check (char_length(title) <= 300),
  kind           text not null check (kind in ('tour', 'info_session', 'open_house', 'travel', 'online', 'staff', 'other')),
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  -- IANA zone from the event page ("Eastern Daylight Time" → America/New_York); null until the page is read.
  timezone       text,
  all_day        boolean not null default false,
  online         boolean not null default false,
  venue          text,
  address        text,
  city           text,
  state          text check (state ~ '^[A-Z]{2}$'),
  zip            text check (zip ~ '^[0-9]{5}$'),
  lat            double precision check (lat between -90 and 90),
  lng            double precision check (lng between -180 and 180),
  availability   text check (availability in ('open', 'full', 'closed')),
  book_url       text not null check (book_url ~ '^https://'),
  source_url     text not null check (source_url ~ '^https://'),
  description    text check (char_length(description) <= 4000),
  -- False while the start comes from the standard search (no year): the event page confirms year and zone.
  date_confirmed boolean not null default false,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  changed_at     timestamptz not null default now(),
  removed_at     timestamptz,
  misses         integer not null default 0
);

create index visit_events_unit_idx on public.visit_events (unit_id, starts_at);
create index visit_events_starts_idx on public.visit_events (starts_at) where removed_at is null;
create index visit_events_first_seen_idx on public.visit_events (first_seen) where removed_at is null;

create table public.visit_event_sync (
  id             bigint generated always as identity primary key,
  ran_at         timestamptz not null default now(),
  finished_at    timestamptz,
  hosts_read     integer not null default 0,
  events_new     integer not null default 0,
  events_changed integer not null default 0,
  events_removed integer not null default 0,
  pages_fetched  integer not null default 0,
  errors         jsonb not null default '[]'::jsonb
);

alter table public.slate_hosts enable row level security;
alter table public.visit_events enable row level security;
alter table public.visit_event_sync enable row level security;

create policy slate_hosts_read on public.slate_hosts for select to authenticated using (true);

-- Upcoming (from yesterday, so an event earlier today still shows), live, and never staff rows.
create policy visit_events_read on public.visit_events for select to authenticated
  using (removed_at is null and kind <> 'staff' and starts_at >= now() - interval '1 day');

create policy visit_event_sync_read on public.visit_event_sync for select to authenticated using (true);

-- How many upcoming events a college lists: the one figure a signed-out page may show.
create function public.visit_event_count(p_unit_id text) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.visit_events
  where unit_id = p_unit_id and removed_at is null and kind <> 'staff' and starts_at >= now() - interval '1 day';
$$;
grant execute on function public.visit_event_count(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- People's data
-- ---------------------------------------------------------------------------------------------------------------------

create table public.visit_alert_prefs (
  user_id            uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email_visit_alerts boolean not null default true,
  radius_miles       integer not null default 30 check (radius_miles in (10, 25, 30, 50, 100, 250)),
  measure_from       text not null default 'auto' check (measure_from in ('auto', 'home', 'high_school')),
  include_online     boolean not null default false,
  updated            timestamptz not null default now()
);

create table public.visit_alert_mutes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  unit_id text not null check (unit_id ~ '^[0-9]{1,10}$'),
  created timestamptz not null default now(),
  primary key (user_id, unit_id)
);

create table public.visit_alerts (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  sent_at             timestamptz not null default now(),
  event_ids           text[] not null default '{}',
  college_count       integer not null default 0,
  provider_message_id text,
  created             timestamptz not null default now()
);
create index visit_alerts_user_idx on public.visit_alerts (user_id, sent_at desc);

alter table public.visit_alert_prefs enable row level security;
alter table public.visit_alert_mutes enable row level security;
alter table public.visit_alerts enable row level security;

create policy visit_alert_prefs_own on public.visit_alert_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy visit_alert_mutes_own on public.visit_alert_mutes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy visit_alerts_own_read on public.visit_alerts for select to authenticated using (user_id = auth.uid());

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that (as the follows
-- migration does). anon gets nothing on any of these tables: signed-in only.
revoke all on public.slate_hosts, public.visit_events, public.visit_event_sync,
  public.visit_alert_prefs, public.visit_alert_mutes, public.visit_alerts from anon, authenticated;
grant select on public.slate_hosts, public.visit_events, public.visit_event_sync to authenticated;
grant select, insert on public.visit_alert_prefs to authenticated;
grant update (email_visit_alerts, radius_miles, measure_from, include_online, updated) on public.visit_alert_prefs to authenticated;
grant select, insert, delete on public.visit_alert_mutes to authenticated;
grant select on public.visit_alerts to authenticated;
grant all on public.slate_hosts, public.visit_events, public.visit_event_sync,
  public.visit_alert_prefs, public.visit_alert_mutes, public.visit_alerts to service_role;

create function public.visit_alert_prefs_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated := now();
  return new;
end;
$$;
create trigger visit_alert_prefs_touch before update on public.visit_alert_prefs
  for each row execute function public.visit_alert_prefs_touch();

-- A first follow creates the prefs row, like follows_ensure_prefs does for notification_prefs; the unsubscribe token
-- stays the one in notification_prefs (one token covers every email the site sends a person).
create function public.visit_alert_prefs_ensure() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.visit_alert_prefs (user_id) values (new.user_id) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger follows_ensure_visit_prefs after insert on public.follows
  for each row execute function public.visit_alert_prefs_ensure();

-- One-click links in the alert email, by the notification_prefs token, no sign-in. Both return false for an unknown token.
create function public.visit_alerts_unsubscribe_by_token(p_token text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.notification_prefs where unsubscribe_token = p_token;
  if v_user is null then return false; end if;
  insert into public.visit_alert_prefs (user_id, email_visit_alerts) values (v_user, false)
    on conflict (user_id) do update set email_visit_alerts = false;
  return true;
end;
$$;
grant execute on function public.visit_alerts_unsubscribe_by_token(text) to anon, authenticated;

create function public.visit_alerts_mute_by_token(p_token text, p_unit_id text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_unit_id !~ '^[0-9]{1,10}$' then return false; end if;
  select user_id into v_user from public.notification_prefs where unsubscribe_token = p_token;
  if v_user is null then return false; end if;
  insert into public.visit_alert_mutes (user_id, unit_id) values (v_user, p_unit_id) on conflict do nothing;
  return true;
end;
$$;
grant execute on function public.visit_alerts_mute_by_token(text, text) to anon, authenticated;
