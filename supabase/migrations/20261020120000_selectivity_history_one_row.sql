-- Quad's selectivity history, one row per college per publish (specs/chances/selectivity-history.md, "As changed
-- 2026-10-20"). Owner, 2026-10-20: store the three pools "all in one row with 3 columns instead of 3 rows", and don't
-- store a row when the data didn't change. Apply after 20261016120000_plan_v3.sql (dev first, then prod), then run
-- `npm run rebuild-selectivity-history` once: it replays every recorded publish from git into the new table.
--
-- Why the rebuild: from 2026-10-13 every publish re-recorded about 660 college-pools that hadn't changed. The writer
-- read the last recorded rows in one request, PostgREST answers at most 1,000 rows, and there were about 2,300, so
-- every college past the 1,000th looked new each time. The writer now reads every page; the table it wrote is
-- replaced rather than cleaned, since git holds every commit it was built from.
--
-- Rules this file encodes:
-- * One row per publish and college: score, tier, and hysteresis hold for all applicants, in-state, and out-of-state
--   side by side (null for a pool the college isn't rated in), the all-applicants rank, the tier year, the band, the
--   inputs, and why the row was written.
-- * record_selectivity_run() writes nothing for a commit already recorded, and nothing at all for a publish with no
--   rows: a publish that changed no college leaves no trace.
-- * Only the service role writes; admins read in the console, as before.

drop function if exists public.admin_selectivity_run_changes(bigint);
drop function if exists public.admin_selectivity_movers(integer, text, boolean, integer, numeric, text, text);
drop function if exists public.admin_selectivity_tier_counts(text);
drop function if exists public.record_selectivity_run(jsonb, jsonb);
drop function if exists public.selectivity_latest_rows();
drop table if exists public.selectivity_history;

create table public.selectivity_history (
  id                  bigint generated always as identity primary key,
  run_id              bigint not null references public.selectivity_publishes (id) on delete cascade,
  published_at        timestamptz not null,
  unit_id             text not null check (unit_id ~ '^[0-9]{6}$'),
  rank                integer,              -- the all-applicants rank, for context
  tier_year           text,
  band                text,
  score_all           numeric(5,2),         -- null: not rated for all applicants
  tier_all            text check (tier_all in ('elite', 'highly_selective', 'very_selective', 'selective', 'accessible', 'open')),
  held_all            boolean not null default false,
  score_in_state      numeric(5,2),         -- null: no in-state pool
  tier_in_state       text check (tier_in_state in ('elite', 'highly_selective', 'very_selective', 'selective', 'accessible', 'open')),
  held_in_state       boolean not null default false,
  score_out_of_state  numeric(5,2),
  tier_out_of_state   text check (tier_out_of_state in ('elite', 'highly_selective', 'very_selective', 'selective', 'accessible', 'open')),
  held_out_of_state   boolean not null default false,
  -- data: something changed; method: a method change (every rated college); backfill: replayed from git; new: the
  -- college's first row; unrated: no longer rated in any pool (every score and tier null).
  cause               text not null check (cause in ('data', 'method', 'backfill', 'new', 'unrated')),
  inputs              jsonb not null default '{}'::jsonb,
  unique (run_id, unit_id),
  check ((score_all is null) = (tier_all is null)),
  check ((score_in_state is null) = (tier_in_state is null)),
  check ((score_out_of_state is null) = (tier_out_of_state is null))
);

create index selectivity_history_college_idx on public.selectivity_history (unit_id, published_at desc, id desc);
create index selectivity_history_recent_idx on public.selectivity_history (published_at desc) where cause <> 'backfill';

alter table public.selectivity_history enable row level security;
create policy "Admins read" on public.selectivity_history for select to authenticated using ((select public.admin_reads()));
grant select on public.selectivity_history to authenticated;
revoke all on public.selectivity_history from anon;
grant all on public.selectivity_history to service_role;

/* ------------------------------------------------------------------ */
/* Writing (service role)                                              */
/* ------------------------------------------------------------------ */

-- The last recorded row for every college: what the next publish is compared against. Read in pages of 1,000
-- (scripts/lib/selectivity-history.mts readAllPages), ordered by unit so the pages don't overlap.
create function public.selectivity_latest_rows()
returns table (unit_id text, rank integer, tier_year text, band text,
               score_all numeric, tier_all text, held_all boolean,
               score_in_state numeric, tier_in_state text, held_in_state boolean,
               score_out_of_state numeric, tier_out_of_state text, held_out_of_state boolean,
               inputs jsonb, published_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (h.unit_id) h.unit_id, h.rank, h.tier_year, h.band,
         h.score_all, h.tier_all, h.held_all, h.score_in_state, h.tier_in_state, h.held_in_state,
         h.score_out_of_state, h.tier_out_of_state, h.held_out_of_state, h.inputs, h.published_at
  from public.selectivity_history h
  order by h.unit_id, h.published_at desc, h.id desc
$$;

-- One publish and its rows. p_run: {git_commit, published_at, method, elite_index, counts, elite_any_pool, rated,
-- cause, publish_id?}; p_rows: [{unit_id, rank, tier_year, band, score_all, tier_all, held_all, score_in_state, …,
-- cause, inputs}]. Returns the new run's id; null when the commit is already recorded or there are no rows.
create function public.record_selectivity_run(p_run jsonb, p_rows jsonb) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_at timestamptz := (p_run ->> 'published_at')::timestamptz;
begin
  if coalesce(jsonb_array_length(p_rows), 0) = 0 then
    return null;
  end if;
  if exists (select 1 from public.selectivity_publishes where git_commit = p_run ->> 'git_commit') then
    return null;
  end if;
  insert into public.selectivity_publishes (publish_id, git_commit, published_at, method, elite_index, counts, elite_any_pool,
                                            rated, rows_recorded, cause)
  values ((p_run ->> 'publish_id')::bigint, p_run ->> 'git_commit', v_at, p_run ->> 'method', (p_run ->> 'elite_index')::numeric,
          p_run -> 'counts', (p_run ->> 'elite_any_pool')::integer, (p_run ->> 'rated')::integer,
          jsonb_array_length(p_rows), p_run ->> 'cause')
  returning id into v_id;
  insert into public.selectivity_history (run_id, published_at, unit_id, rank, tier_year, band,
                                          score_all, tier_all, held_all, score_in_state, tier_in_state, held_in_state,
                                          score_out_of_state, tier_out_of_state, held_out_of_state, cause, inputs)
  select v_id, v_at, r ->> 'unit_id', (r ->> 'rank')::integer, r ->> 'tier_year', r ->> 'band',
         (r ->> 'score_all')::numeric, r ->> 'tier_all', coalesce((r ->> 'held_all')::boolean, false),
         (r ->> 'score_in_state')::numeric, r ->> 'tier_in_state', coalesce((r ->> 'held_in_state')::boolean, false),
         (r ->> 'score_out_of_state')::numeric, r ->> 'tier_out_of_state', coalesce((r ->> 'held_out_of_state')::boolean, false),
         r ->> 'cause', coalesce(r -> 'inputs', '{}'::jsonb)
  from jsonb_array_elements(p_rows) r;
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

-- Each row's three pools as rows (pool, score, tier), for the reads that work per pool. Not exposed: a view would
-- bypass the table's policy for whoever may select from it, so the functions below use it inside security definer.
create function public.selectivity_pools(h public.selectivity_history)
returns table (pool text, score numeric, tier text, held boolean)
language sql
immutable
set search_path = ''
as $$
  values ('all', h.score_all, h.tier_all, h.held_all),
         ('in_state', h.score_in_state, h.tier_in_state, h.held_in_state),
         ('out_of_state', h.score_out_of_state, h.tier_out_of_state, h.held_out_of_state)
$$;
revoke execute on function public.selectivity_pools(public.selectivity_history) from public, anon, authenticated;

-- How many colleges each tier held after every publish, for one pool: the last row per college at or before each run
-- (every row carries all three pools, so the last row is the college's state).
create function public.admin_selectivity_tier_counts(p_pool text default 'all')
returns table (run_id bigint, published_at timestamptz, method text, cause text, counts jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_pool not in ('all', 'in_state', 'out_of_state') then raise exception 'unknown pool' using errcode = '22023'; end if;
  return query
  select p.id, p.published_at, p.method, p.cause,
         coalesce((
           select jsonb_object_agg(t.tier, t.n)
           from (
             select l.tier, count(*) as n
             from (
               select distinct on (h.unit_id)
                      case p_pool when 'all' then h.tier_all when 'in_state' then h.tier_in_state else h.tier_out_of_state end as tier
               from public.selectivity_history h
               join public.selectivity_publishes hp on hp.id = h.run_id
               where (hp.published_at, hp.id) <= (p.published_at, p.id)
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

-- The biggest score moves over the last p_days days, per pool: each college's newest row in the window against its
-- last row from before it. By default the console hides method changes and moves under 0.25 points ("show every
-- change" passes p_include_method and p_min 0): display filters only. p_tier narrows to moves into or out of a tier;
-- p_cause to one cause. A pool unchanged in the window isn't a move.
create function public.admin_selectivity_movers(p_days integer default 30, p_pool text default null,
                                                p_include_method boolean default false, p_limit integer default 50,
                                                p_min numeric default 0, p_tier text default null, p_cause text default null)
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
    select distinct on (h.unit_id) h.*
    from public.selectivity_history h
    where h.published_at >= v_since
      and (coalesce(p_include_method, false) or h.cause not in ('method', 'backfill'))
    order by h.unit_id, h.published_at desc, h.id desc
  ),
  before as (
    select distinct on (h.unit_id) h.*
    from public.selectivity_history h
    where h.published_at < v_since
    order by h.unit_id, h.published_at desc, h.id desc
  ),
  moves as (
    select l.unit_id, lp.pool, bp.score as score_from, lp.score as score_to, lp.score - bp.score as delta,
           bp.tier as tier_from, lp.tier as tier_to, l.published_at as moved_at, l.cause
    from latest l
    cross join lateral public.selectivity_pools(l) lp
    left join before b on b.unit_id = l.unit_id
    left join lateral public.selectivity_pools(b) bp on bp.pool = lp.pool
    where (p_pool is null or lp.pool = p_pool)
  )
  select m.unit_id, m.pool, m.score_from, m.score_to, m.delta, m.tier_from, m.tier_to, m.moved_at, m.cause
  from moves m
  where (m.score_from is distinct from m.score_to or m.tier_from is distinct from m.tier_to)
    and (m.tier_from is distinct from m.tier_to or m.score_from is null or m.score_to is null
         or abs(m.score_to - m.score_from) >= coalesce(p_min, 0))
    and (p_tier is null or m.tier_to = p_tier or m.tier_from = p_tier)
    and (p_cause is null or m.cause = p_cause)
  order by abs(coalesce(m.delta, 0)) desc, (m.tier_from is distinct from m.tier_to) desc, m.unit_id, m.pool
  limit greatest(1, least(coalesce(p_limit, 50), 500));
end;
$$;

-- One run's rows, each with the college's previous row (null for its first): the "latest publish" view and the method
-- log. A read, paged by the caller (a method change records every rated college, past 1,000).
create function public.admin_selectivity_run_changes(p_run bigint)
returns table (unit_id text, cause text,
               score_all numeric, tier_all text, held_all boolean,
               score_in_state numeric, tier_in_state text, held_in_state boolean,
               score_out_of_state numeric, tier_out_of_state text, held_out_of_state boolean,
               prev_score_all numeric, prev_tier_all text,
               prev_score_in_state numeric, prev_tier_in_state text,
               prev_score_out_of_state numeric, prev_tier_out_of_state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select h.unit_id, h.cause,
         h.score_all, h.tier_all, h.held_all, h.score_in_state, h.tier_in_state, h.held_in_state,
         h.score_out_of_state, h.tier_out_of_state, h.held_out_of_state,
         prev.score_all, prev.tier_all, prev.score_in_state, prev.tier_in_state, prev.score_out_of_state, prev.tier_out_of_state
  from public.selectivity_history h
  join public.selectivity_publishes p on p.id = h.run_id
  left join lateral (
    select h2.score_all, h2.tier_all, h2.score_in_state, h2.tier_in_state, h2.score_out_of_state, h2.tier_out_of_state
    from public.selectivity_history h2
    join public.selectivity_publishes p2 on p2.id = h2.run_id
    where h2.unit_id = h.unit_id and (p2.published_at, p2.id) < (p.published_at, p.id)
    order by p2.published_at desc, p2.id desc
    limit 1
  ) prev on true
  where h.run_id = p_run
  order by h.unit_id;
end;
$$;

revoke execute on function public.admin_selectivity_tier_counts(text) from public, anon;
revoke execute on function public.admin_selectivity_movers(integer, text, boolean, integer, numeric, text, text) from public, anon;
revoke execute on function public.admin_selectivity_run_changes(bigint) from public, anon;
grant execute on function public.admin_selectivity_tier_counts(text) to authenticated;
grant execute on function public.admin_selectivity_movers(integer, text, boolean, integer, numeric, text, text) to authenticated;
grant execute on function public.admin_selectivity_run_changes(bigint) to authenticated;
