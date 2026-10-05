-- Home address (specs/product/home-and-distance.md): one row per user with the geocoded location of their home,
-- for "how far is it" on saved lists and Explore's "Distance from home" filter.
--
-- Own-row only. A home is never visible to anyone else, including the other members of a household: a guardian
-- and a student each save their own home and see distances from it (two parents in two homes each get the
-- distances that matter to them), so there is no can_read_student here, and nothing in the access log. The app
-- stores the geocoder's matched address and coordinates rounded to three decimals (about 100 m), never the raw
-- text the user typed.
--
-- Requires Supabase's auth schema. Apply in the Supabase SQL Editor (dev first, then prod), after
-- 20261005120000_accounts.sql. Tested against real Postgres (PGlite) in tests/home-policies.test.mts.

create table public.home_locations (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  -- The matched address, tidied ("1600 Pennsylvania Ave NW, Washington, DC 20500"); shown back to its owner only.
  label      text not null check (char_length(label) between 1 and 200),
  -- "Washington, DC" (or "ZIP 20500"): what distance lines name.
  place      text not null check (char_length(place) between 1 and 80),
  -- Explore's filter measures from this ZIP code's center, so shared Explore links carry a ZIP, never an address.
  zip        text check (zip ~ '^[0-9]{5}$'),
  updated_at timestamptz not null default now()
);

alter table public.home_locations enable row level security;

create policy "Home: read own" on public.home_locations for select to authenticated
  using (user_id = auth.uid());
create policy "Home: create own" on public.home_locations for insert to authenticated
  with check (user_id = auth.uid());
create policy "Home: update own" on public.home_locations for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Home: delete own" on public.home_locations for delete to authenticated
  using (user_id = auth.uid());

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that.
revoke all on public.home_locations from anon, authenticated;
grant select, insert, update, delete on public.home_locations to authenticated;
grant all on public.home_locations to service_role;
