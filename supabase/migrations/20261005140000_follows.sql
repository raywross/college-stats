-- Following colleges and the change record (specs/product/follow-colleges.md): follows, notification_prefs,
-- dataset_changes (+ its staging table), digests, row-level security on every one, and the publish function that
-- writes changes in the same transaction as the dataset they describe.
--
-- Two kinds of data live here:
-- * User data (follows, notification_prefs, digests): one owner each, read and written through PostgREST with the
--   signed-in user's token, so the policies below decide. A guardian follows colleges in their own right and can
--   never read a student's follows (they would reveal the student's list); there is no household path at all.
-- * Public, derived data (dataset_changes): what changed between two publishes of the dataset. Anyone may read it
--   (the profile's "What changed" panel reads it with the publishable key); only the publish step writes it.
--
-- The publish id is dataset_publishes.id, the row publish_schools_staged() records for every publish
-- (20260928000000_dataset.sql). Each dataset_changes row also carries that publish's time, which is the same
-- transaction time stamped on dataset_files.published_at: the "version" the app already reads (lib/supabase.ts).
--
-- Requires 20260928000000_dataset.sql, 20261002140000_school_staging.sql and 20261005120000_accounts.sql (auth
-- schema). Apply in the Supabase SQL Editor (dev first, then prod). Tested in tests/follows-policies.test.mts.

/* ------------------------------------------------------------------ */
/* User data                                                           */
/* ------------------------------------------------------------------ */

-- One row per user × college. source 'list' rows are kept in step with saved lists by a trigger in the lists
-- migration (20261005150000_lists.sql); the Follow button turns a 'list' row into 'manual' so leaving the list
-- never silently unfollows. No foreign key to schools: publishing replaces that table's rows wholesale.
create table public.follows (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  unit_id  text not null check (unit_id ~ '^[0-9]{1,10}$'),
  source   text not null default 'manual' check (source in ('manual', 'list')),
  created  timestamptz not null default now(),
  primary key (user_id, unit_id)
);

create index follows_unit_idx on public.follows (unit_id);

-- Email preferences, one row per user, created with their first follow (follows_ensure_prefs below). The
-- unsubscribe token is a bearer secret for one action only (turning update emails off, without signing in), so it is
-- stored as is: the digest job has to put it in every email.
create table public.notification_prefs (
  user_id           uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email_updates     boolean not null default true,
  unsubscribe_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated           timestamptz not null default now()
);

-- One digest per user per publish (the unique key is what keeps the daily job from sending twice). Written only by
-- the digest job with the secret key; the user reads their own for /me/updates.
create table public.digests (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  publish_id          bigint not null references public.dataset_publishes (id) on delete cascade,
  published_at        timestamptz not null,           -- the publish's time, so /me/updates needs no join
  sent_at             timestamptz,                    -- null: recorded but not sent (email not configured)
  provider_message_id text,
  unit_ids            text[] not null default '{}',   -- the followed colleges the digest covered
  college_count       integer not null default 0,
  change_count        integer not null default 0,
  created             timestamptz not null default now(),
  constraint digests_once unique (user_id, publish_id)
);

create index digests_user_idx on public.digests (user_id, published_at desc);

/* ------------------------------------------------------------------ */
/* Public change record                                                */
/* ------------------------------------------------------------------ */

-- One row per college × field × publish (lib/changes.ts DatasetChange). Values are json, like the dataset tables, so
-- they read back exactly as written.
create table public.dataset_changes (
  id           bigint generated always as identity primary key,
  publish_id   bigint not null references public.dataset_publishes (id) on delete cascade,
  published_at timestamptz not null,
  unit_id      text not null,
  field        text not null,
  kind         text not null check (kind in ('new_year', 'revised', 'updated', 'appeared', 'disappeared')),
  old_value    json,
  new_value    json,
  old_year     text,
  new_year     text,
  source       text,
  old_source   text,                            -- only when the old value came from a different kind of source
  release      text,
  constraint dataset_changes_once unique (publish_id, unit_id, field)
);

create index dataset_changes_unit_idx on public.dataset_changes (unit_id, published_at desc);
create index dataset_changes_publish_idx on public.dataset_changes (publish_id);

-- Changes staged by publish-data before the swap, like school_staging; moved into dataset_changes by
-- publish_schools_staged_with_changes() in the same transaction as the colleges they describe.
create table public.dataset_change_staging (
  unit_id   text not null,
  field     text not null,
  kind      text not null,
  old_value json,
  new_value json,
  old_year  text,
  new_year  text,
  source    text,
  old_source text,
  release   text,
  primary key (unit_id, field)
);

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.follows enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.digests enable row level security;
alter table public.dataset_changes enable row level security;
alter table public.dataset_change_staging enable row level security;

create policy "Follows: read own" on public.follows for select to authenticated using (user_id = auth.uid());
create policy "Follows: add own" on public.follows for insert to authenticated with check (user_id = auth.uid());
create policy "Follows: change own" on public.follows for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Follows: remove own" on public.follows for delete to authenticated using (user_id = auth.uid());

create policy "Prefs: read own" on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy "Prefs: create own" on public.notification_prefs for insert to authenticated with check (user_id = auth.uid());
create policy "Prefs: update own" on public.notification_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Digests: read own" on public.digests for select to authenticated using (user_id = auth.uid());

create policy "Changes are public" on public.dataset_changes for select to anon, authenticated using (true);

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that.
revoke all on public.follows, public.notification_prefs, public.digests, public.dataset_changes, public.dataset_change_staging
  from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;
grant update (source) on public.follows to authenticated;
grant select, insert on public.notification_prefs to authenticated;
grant update (email_updates, updated) on public.notification_prefs to authenticated;
grant select on public.digests to authenticated;
grant select on public.dataset_changes to anon, authenticated;
grant all on public.follows, public.notification_prefs, public.digests, public.dataset_changes, public.dataset_change_staging
  to service_role;

/* ------------------------------------------------------------------ */
/* Functions                                                           */
/* ------------------------------------------------------------------ */

-- Every follower has a prefs row (and so an unsubscribe token) from their first follow, however it was created (the
-- Follow button, or the lists trigger).
create function public.follows_ensure_prefs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_prefs (user_id) values (new.user_id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger follows_ensure_prefs after insert on public.follows
  for each row execute function public.follows_ensure_prefs();

-- One-click unsubscribe (RFC 8058) by token, without signing in: turns update emails off. Returns whether the token
-- matched. Callable by anon; it reveals nothing and changes only that one switch.
create function public.unsubscribe_by_token(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  update public.notification_prefs set email_updates = false, updated = now() where unsubscribe_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Add a batch of changes to the staging table; p_reset clears it first (publish-data always resets on its first call,
-- even with no changes, so a failed earlier publish never leaks its rows into this one).
create function public.stage_dataset_changes(p_changes json, p_reset boolean default false) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_changes) <> 'array' then
    raise exception 'stage_dataset_changes: p_changes must be an array';
  end if;
  if p_reset then
    delete from public.dataset_change_staging where true;
  end if;
  insert into public.dataset_change_staging (unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release)
  select e ->> 'unit_id', e ->> 'field', e ->> 'kind',
         case when json_typeof(e -> 'old_value') in ('null') or e -> 'old_value' is null then null else e -> 'old_value' end,
         case when json_typeof(e -> 'new_value') in ('null') or e -> 'new_value' is null then null else e -> 'new_value' end,
         e ->> 'old_year', e ->> 'new_year', e ->> 'source', e ->> 'old_source', e ->> 'release'
  from json_array_elements(p_changes) as t(e);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- publish_schools_staged() plus the staged changes, in one transaction: a change record exists if and only if the
-- data it describes was published. Checks the expected number of changes arrived. Returns
-- {"schools": n, "publish_id": id, "changes": m}. publish_schools_staged() stays for checkouts of publish-data that
-- predate this migration, and for projects where it isn't applied yet.
create function public.publish_schools_staged_with_changes(
  p_meta json,
  p_release_calendar json,
  p_expected integer,
  p_expected_changes integer,
  p_git_commit text default null,
  p_published_by text default null
) returns json
language plpgsql
set search_path = ''
as $$
declare
  v_schools integer;
  v_publish bigint;
  v_staged integer;
  v_changes integer;
begin
  select count(*) into v_staged from public.dataset_change_staging;
  if v_staged <> p_expected_changes then
    raise exception 'publish_schools_staged_with_changes: % changes staged, expected %', v_staged, p_expected_changes;
  end if;

  v_schools := public.publish_schools_staged(p_meta, p_release_calendar, p_expected, p_git_commit, p_published_by);
  select max(id) into v_publish from public.dataset_publishes where published_at = now();

  insert into public.dataset_changes (publish_id, published_at, unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release)
  select v_publish, now(), unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release
  from public.dataset_change_staging;
  get diagnostics v_changes = row_count;

  delete from public.dataset_change_staging where true;
  return json_build_object('schools', v_schools, 'publish_id', v_publish, 'changes', v_changes);
end;
$$;

revoke execute on function public.follows_ensure_prefs() from public, anon, authenticated;
revoke execute on function public.unsubscribe_by_token(text) from public;
revoke execute on function public.stage_dataset_changes(json, boolean) from public, anon, authenticated;
revoke execute on function public.publish_schools_staged_with_changes(json, json, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.unsubscribe_by_token(text) to anon, authenticated, service_role;
grant execute on function public.stage_dataset_changes(json, boolean) to service_role;
grant execute on function public.publish_schools_staged_with_changes(json, json, integer, integer, text, text) to service_role;
