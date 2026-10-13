-- Quad's selectivity history (specs/chances/selectivity-history.md): after each production deploy, the score, rank,
-- tier, and inputs of every college and pool whose selectivity meaningfully changed, for the admin console. Never on
-- the public site: the score is a hidden value. Additive; apply after 20261013140000_college_views.sql (dev first,
-- then prod), then run `npm run backfill-selectivity-history` once.
--
-- Rules this file encodes:
-- * Only the service role writes, through record_selectivity_run(), which records one publish and its rows in one
--   transaction and writes nothing for a commit already recorded (re-running a publish is safe).
-- * Admins read in the console ("Admins read", admin_reads(): is_admin() at aal2 and the console's header) and through
--   the admin_selectivity_*() functions; nobody else reads anything.

create table public.selectivity_publishes (
  id              bigint generated always as identity primary key,
  publish_id      bigint references public.dataset_publishes (id) on delete set null, -- null for backfill runs
  git_commit      text not null unique check (git_commit ~ '^[0-9a-f]{7,64}$'),
  published_at    timestamptz not null,
  method          text not null check (char_length(method) <= 40),
  elite_index     numeric(5,2) not null,
  counts          jsonb not null,           -- colleges by tier for all applicants
  elite_any_pool  integer not null,         -- colleges Ultra selective for at least one pool
  rated           integer not null,
  rows_recorded   integer not null,
  cause           text not null check (cause in ('data', 'method', 'backfill')),
  recorded_at     timestamptz not null default now()
);

create table public.selectivity_history (
  id            bigint generated always as identity primary key,
  run_id        bigint not null references public.selectivity_publishes (id) on delete cascade,
  published_at  timestamptz not null,
  unit_id       text not null check (unit_id ~ '^[0-9]{6}$'),
  pool          text not null check (pool in ('all', 'in_state', 'out_of_state')),
  score         numeric(5,2),               -- null: the college stopped being rated for this pool
  rank          integer,                    -- the all-applicants rank, for context
  tier          text check (tier in ('elite', 'highly_selective', 'very_selective', 'selective', 'accessible', 'open')),
  tier_year     text,
  band          text,
  held          boolean not null default false,  -- hysteresis kept the tier although the score crossed a cutoff
  cause         text not null check (cause in ('data', 'method', 'backfill', 'new_pool', 'unrated')),
  inputs        jsonb not null default '{}'::jsonb,
  unique (run_id, unit_id, pool)
);

create index selectivity_history_college_idx on public.selectivity_history (unit_id, pool, published_at desc, id desc);
create index selectivity_history_recent_idx on public.selectivity_history (published_at desc) where cause <> 'backfill';

alter table public.selectivity_publishes enable row level security;
alter table public.selectivity_history enable row level security;

create policy "Admins read" on public.selectivity_publishes for select to authenticated using ((select public.admin_reads()));
create policy "Admins read" on public.selectivity_history for select to authenticated using ((select public.admin_reads()));
grant select on public.selectivity_publishes, public.selectivity_history to authenticated;
revoke all on public.selectivity_publishes, public.selectivity_history from anon;
grant all on public.selectivity_publishes, public.selectivity_history to service_role;

/* ------------------------------------------------------------------ */
/* Writing (service role)                                              */
/* ------------------------------------------------------------------ */

-- The last recorded row for every college and pool: what the next publish is compared against.
create function public.selectivity_latest_rows()
returns table (unit_id text, pool text, score numeric, tier text, tier_year text, band text, published_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (h.unit_id, h.pool) h.unit_id, h.pool, h.score, h.tier, h.tier_year, h.band, h.published_at
  from public.selectivity_history h
  order by h.unit_id, h.pool, h.published_at desc, h.id desc
$$;

-- One publish and its rows. p_run: {git_commit, published_at, method, elite_index, counts, elite_any_pool, rated,
-- cause, publish_id?}; p_rows: [{unit_id, pool, score, rank, tier, tier_year, band, held, cause, inputs}]. Returns
-- the new run's id, or null when the commit is already recorded.
create function public.record_selectivity_run(p_run jsonb, p_rows jsonb) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_at timestamptz := (p_run ->> 'published_at')::timestamptz;
begin
  if exists (select 1 from public.selectivity_publishes where git_commit = p_run ->> 'git_commit') then
    return null;
  end if;
  insert into public.selectivity_publishes (publish_id, git_commit, published_at, method, elite_index, counts, elite_any_pool,
                                            rated, rows_recorded, cause)
  values ((p_run ->> 'publish_id')::bigint, p_run ->> 'git_commit', v_at, p_run ->> 'method', (p_run ->> 'elite_index')::numeric,
          p_run -> 'counts', (p_run ->> 'elite_any_pool')::integer, (p_run ->> 'rated')::integer,
          jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), p_run ->> 'cause')
  returning id into v_id;
  insert into public.selectivity_history (run_id, published_at, unit_id, pool, score, rank, tier, tier_year, band, held, cause, inputs)
  select v_id, v_at, r ->> 'unit_id', r ->> 'pool', (r ->> 'score')::numeric, (r ->> 'rank')::integer, r ->> 'tier',
         r ->> 'tier_year', r ->> 'band', coalesce((r ->> 'held')::boolean, false), r ->> 'cause', coalesce(r -> 'inputs', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;
  return v_id;
end;
$$;

revoke execute on function public.selectivity_latest_rows() from public, anon, authenticated;
revoke execute on function public.record_selectivity_run(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.selectivity_latest_rows() to service_role;
grant execute on function public.record_selectivity_run(jsonb, jsonb) to service_role;

/* ------------------------------------------------------------------ */
/* Reading (the console)                                               */
/* ------------------------------------------------------------------ */

-- How many colleges each tier held after every publish, for one pool: the last row per college at or before each run.
create function public.admin_selectivity_tier_counts(p_pool text default 'all')
returns table (run_id bigint, published_at timestamptz, method text, cause text, counts jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select p.id, p.published_at, p.method, p.cause,
         coalesce((
           select jsonb_object_agg(t.tier, t.n)
           from (
             select l.tier, count(*) as n
             from (
               select distinct on (h.unit_id) h.tier
               from public.selectivity_history h
               join public.selectivity_publishes hp on hp.id = h.run_id
               where h.pool = p_pool and (hp.published_at, hp.id) <= (p.published_at, p.id)
               order by h.unit_id, hp.published_at desc, hp.id desc
             ) l
             where l.tier is not null
             group by l.tier
           ) t
         ), '{}'::jsonb)
  from public.selectivity_publishes p
  order by p.published_at, p.id;
end;
$$;

-- The biggest score moves over the last p_days days: each college and pool's newest row against its last row from
-- before the window. Method-change rows are left out unless p_include_method (a method change isn't the college moving).
create function public.admin_selectivity_movers(p_days integer default 30, p_pool text default null,
                                                p_include_method boolean default false, p_limit integer default 50)
returns table (unit_id text, pool text, score_from numeric, score_to numeric, delta numeric, tier_from text, tier_to text,
               moved_at timestamptz, cause text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  with latest as (
    select distinct on (h.unit_id, h.pool) h.unit_id, h.pool, h.score, h.tier, h.published_at, h.cause
    from public.selectivity_history h
    where h.published_at >= v_since and (p_pool is null or h.pool = p_pool)
      and (coalesce(p_include_method, false) or h.cause not in ('method', 'backfill'))
    order by h.unit_id, h.pool, h.published_at desc, h.id desc
  ),
  before as (
    select distinct on (h.unit_id, h.pool) h.unit_id, h.pool, h.score, h.tier
    from public.selectivity_history h
    where h.published_at < v_since and (p_pool is null or h.pool = p_pool)
    order by h.unit_id, h.pool, h.published_at desc, h.id desc
  )
  select l.unit_id, l.pool, b.score, l.score, l.score - b.score, b.tier, l.tier, l.published_at, l.cause
  from latest l
  left join before b on b.unit_id = l.unit_id and b.pool = l.pool
  where b.score is distinct from l.score or b.tier is distinct from l.tier
  order by abs(coalesce(l.score - b.score, 0)) desc, (b.tier is distinct from l.tier) desc, l.unit_id, l.pool
  limit greatest(1, least(coalesce(p_limit, 50), 500));
end;
$$;

-- One run's rows, each with the row it replaced for that college and pool (null for a new pool): the "latest publish"
-- view. A read.
create function public.admin_selectivity_run_changes(p_run bigint)
returns table (unit_id text, pool text, score numeric, tier text, cause text, held boolean, prev_score numeric, prev_tier text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select h.unit_id, h.pool, h.score, h.tier, h.cause, h.held, prev.score, prev.tier
  from public.selectivity_history h
  join public.selectivity_publishes p on p.id = h.run_id
  left join lateral (
    select h2.score, h2.tier
    from public.selectivity_history h2
    join public.selectivity_publishes p2 on p2.id = h2.run_id
    where h2.unit_id = h.unit_id and h2.pool = h.pool and (p2.published_at, p2.id) < (p.published_at, p.id)
    order by p2.published_at desc, p2.id desc
    limit 1
  ) prev on true
  where h.run_id = p_run
  order by h.unit_id, h.pool;
end;
$$;

revoke execute on function public.admin_selectivity_tier_counts(text) from public, anon;
revoke execute on function public.admin_selectivity_movers(integer, text, boolean, integer) from public, anon;
revoke execute on function public.admin_selectivity_run_changes(bigint) from public, anon;
grant execute on function public.admin_selectivity_tier_counts(text) to authenticated;
grant execute on function public.admin_selectivity_movers(integer, text, boolean, integer) to authenticated;
grant execute on function public.admin_selectivity_run_changes(bigint) to authenticated;
