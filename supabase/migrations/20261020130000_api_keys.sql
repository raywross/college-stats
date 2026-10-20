-- The Data API's keys and usage (specs/product/data-api.md "Keys, usage, and the schema"): api_keys (a person's keys,
-- stored as SHA-256 hashes), api_usage (requests per key per day), row-level security on both, and api_key_use(), the
-- one function the API calls to check a key and count a request. Additive. Builds on the accounts and admin migrations
-- (profiles, profiles.suspended_at); apply after 20261020120000_selectivity_history_one_row.sql (SQL Editor, dev first,
-- then prod). Tested against real Postgres (PGlite + the auth stub, every migration in order) in
-- tests/api-keys-policies.test.mts, with guard tests that break a rule on purpose and show the checks notice.
--
-- Rules this file encodes:
-- * A key belongs to a person (user_id). The app makes the key (lib/api/keys.ts generateApiKey), shows it once, and
--   inserts only its SHA-256 hash (key_hash) and display prefix (key_prefix) through the person's own session: insert
--   policy user_id = auth.uid(). The tier is never the person's to choose (no insert grant on it; default 'account').
-- * Nobody reads key_hash through the API. Chosen mechanism: COLUMN PRIVILEGES. authenticated is granted select on
--   every api_keys column except key_hash, so `select key_hash` (or `select *`) is refused with "permission denied".
--   The app reads keys through the view api_keys_public (security_invoker, so api_keys' own policies apply), which
--   names only the granted columns and adds today's request count from api_usage in the same read.
-- * A person changes nothing on a key but revoked_at, and only once (null to a time): an update grant on revoked_at
--   alone, plus a trigger (api_keys_guard_update) that rejects any other column change and un-revoking. The trigger
--   applies to anon and authenticated only, so api_key_use() (security definer) can still stamp last_used_at.
-- * At most 5 active (unrevoked) keys per person (lib/api/keys.ts API_KEY_LIMITS.keysPerUser): a trigger
--   (api_keys_limit) counts under a per-person advisory lock, so two inserts at once can't both pass.
-- * api_usage is read by the key's owner (through the key) and written only by api_key_use(); no write grant at all.
-- * api_key_use(p_hash, p_endpoint) is security definer and callable by anon: Vercel holds only the publishable key,
--   and knowing a hash proves knowing the key (the same reasoning as invitation_preview). It returns zero rows for an
--   unknown or revoked key and for an owner who is paused (profiles.suspended_at) or deleted (profiles.deleted_at);
--   otherwise it counts the request in today's row and returns { key_id, user_id, tier, allowed, used_today,
--   limit_per_day } with allowed = used_today <= limit_per_day (5,000 a day for tier 'account', matching
--   API_KEY_LIMITS.perDay). It sets last_used_at at most once a minute and, on a key's first request of a day, deletes
--   that key's usage rows older than 90 days (no cron). p_endpoint (the route table's id, e.g. "schools.get") is
--   checked for shape and kept for per-endpoint counts later; today the count is per key per day.
-- * api_key_info(p_hash), also anon-callable, answers /api/v1/me (key name and prefix, owner's display name, never the
--   email) under the same rule; it counts nothing.

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  key_prefix   text not null check (key_prefix ~ '^quad_[a-z2-7]{8}$'),
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  tier         text not null default 'account' check (tier in ('account')),
  created      timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index api_keys_user_idx on public.api_keys (user_id, created desc);

create table public.api_usage (
  key_id   uuid not null references public.api_keys (id) on delete cascade,
  day      date not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (key_id, day)
);

alter table public.api_keys enable row level security;
alter table public.api_usage enable row level security;

/* ------------------------------------------------------------------ */
/* Policies                                                            */
/* ------------------------------------------------------------------ */

create policy "API keys: owner reads" on public.api_keys for select to authenticated
  using (user_id = (select auth.uid()));
create policy "API keys: owner inserts" on public.api_keys for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "API keys: owner revokes" on public.api_keys for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "API usage: key owner reads" on public.api_usage for select to authenticated
  using (exists (select 1 from public.api_keys k where k.id = api_usage.key_id and k.user_id = (select auth.uid())));

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

-- Revoke-only: through the API a key's one changeable column is revoked_at, set once. api_key_use() runs as the
-- function's owner, so its last_used_at stamp passes.
create function public.api_keys_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.name is distinct from old.name
       or new.key_prefix is distinct from old.key_prefix or new.key_hash is distinct from old.key_hash
       or new.tier is distinct from old.tier or new.created is distinct from old.created
       or new.last_used_at is distinct from old.last_used_at then
      raise exception 'api_key_revoke_only' using errcode = '42501';
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'api_key_already_revoked' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger api_keys_guard_update
before update on public.api_keys
for each row execute function public.api_keys_guard_update();

-- At most 5 active keys per person (lib/api/keys.ts API_KEY_LIMITS.keysPerUser). Security definer so the count sees
-- every one of the person's keys whatever the caller's grants; the advisory lock serializes one person's inserts.
create function public.api_keys_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revoked_at is null then
    perform pg_advisory_xact_lock(hashtextextended('api_keys:' || new.user_id::text, 0));
    if (select count(*) from public.api_keys k where k.user_id = new.user_id and k.revoked_at is null) >= 5 then
      raise exception 'api_key_limit' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger api_keys_limit
before insert on public.api_keys
for each row execute function public.api_keys_limit();

/* ------------------------------------------------------------------ */
/* What the app reads: keys without their hash                         */
/* ------------------------------------------------------------------ */

-- security_invoker: the reader's own grants and api_keys' policies apply, so a person sees only their own keys.
create view public.api_keys_public with (security_invoker = true) as
  select k.id, k.user_id, k.name, k.key_prefix, k.tier, k.created, k.last_used_at, k.revoked_at,
         coalesce(u.requests, 0) as used_today
  from public.api_keys k
  left join public.api_usage u on u.key_id = k.id and u.day = current_date;

/* ------------------------------------------------------------------ */
/* Checking a key and counting a request                               */
/* ------------------------------------------------------------------ */

create function public.api_key_use(p_hash text, p_endpoint text)
returns table (key_id uuid, user_id uuid, tier text, allowed boolean, used_today integer, limit_per_day integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_key   public.api_keys;
  v_limit integer;
  v_used  integer;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_endpoint is null or p_endpoint !~ '^[a-z][a-z0-9_.]{0,79}$' then
    return;
  end if;

  select k.* into v_key
  from public.api_keys k
  left join public.profiles p on p.id = k.user_id
  where k.key_hash = p_hash and k.revoked_at is null and p.deleted_at is null and p.suspended_at is null;
  if not found then
    return;
  end if;

  -- Requests a day per tier (lib/api/keys.ts API_KEY_LIMITS.perDay; tests/api-keys-policies.test.mts compares them).
  v_limit := case v_key.tier when 'account' then 5000 else 0 end;

  insert into public.api_usage as u (key_id, day, requests) values (v_key.id, current_date, 1)
  on conflict on constraint api_usage_pkey do update set requests = u.requests + 1
  returning u.requests into v_used;

  -- A key's first request of the day keeps the table to 90 days.
  if v_used = 1 then
    delete from public.api_usage u where u.key_id = v_key.id and u.day < current_date - 90;
  end if;

  if v_key.last_used_at is null or v_key.last_used_at < now() - interval '1 minute' then
    update public.api_keys k set last_used_at = now() where k.id = v_key.id;
  end if;

  return query select v_key.id, v_key.user_id, v_key.tier, v_used <= v_limit, v_used, v_limit;
end;
$$;

-- What /api/v1/me shows beyond api_key_use(): the calling key's name, prefix, and dates, and its owner's display name
-- (never the email). Same rule as api_key_use(): only an unrevoked key of an owner who is neither paused nor deleted.
-- Reads only; the /me request itself was already counted by api_key_use().
create function public.api_key_info(p_hash text)
returns table (key_id uuid, key_name text, key_prefix text, tier text, created timestamptz, last_used_at timestamptz, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.name, k.key_prefix, k.tier, k.created, k.last_used_at, p.display_name
  from public.api_keys k
  left join public.profiles p on p.id = k.user_id
  where k.key_hash = p_hash and k.revoked_at is null and p.deleted_at is null and p.suspended_at is null
$$;

/* ------------------------------------------------------------------ */
/* Grants                                                              */
/* ------------------------------------------------------------------ */

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that. Signed-out
-- visitors (anon) get nothing but api_key_use().
revoke all on public.api_keys, public.api_usage, public.api_keys_public from anon, authenticated;
grant select (id, user_id, name, key_prefix, tier, created, last_used_at, revoked_at) on public.api_keys to authenticated;
grant insert (id, user_id, name, key_prefix, key_hash) on public.api_keys to authenticated;
grant update (revoked_at) on public.api_keys to authenticated;
grant select on public.api_usage to authenticated;
grant select on public.api_keys_public to authenticated;
grant all on public.api_keys, public.api_usage, public.api_keys_public to service_role;

revoke execute on function public.api_keys_guard_update() from public, anon, authenticated;
revoke execute on function public.api_keys_limit() from public, anon, authenticated;
revoke execute on function public.api_key_use(text, text) from public;
revoke execute on function public.api_key_info(text) from public;
grant execute on function public.api_key_use(text, text) to anon, authenticated, service_role;
grant execute on function public.api_key_info(text) to anon, authenticated, service_role;
