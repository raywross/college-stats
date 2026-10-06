-- High schools (specs/product/high-school-data.md; lib/high-school-types.ts): ~24,000 public and private high schools,
-- too many for the in-memory dataset pattern, so the app reads one row by id and searches through
-- search_high_schools() below. The same content as data/high-schools/ in git, uploaded by `npm run publish-data`
-- (scripts/lib/publish-high-schools.mts):
--   high_schools         one row per school: data/high-schools/schools/{XX}.json rows with their state report merged in
--   high_school_details  one row per school profile: data/high-schools/detail/{id}.json
--   high_school_files    meta.json and medians.json
-- Documents are `json`, not `jsonb`, so rows read back exactly as written (key order included).
-- Publishing writes the live tables in batches (like history and school_details); the staging tables and their
-- functions follow the school_details pattern for a one-transaction swap when a publish is small enough.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table public.high_schools (
  id           text primary key,                -- 12-digit NCES ncessch, or the 8-character PSS ppin
  state        text not null,                   -- USPS
  kind         text not null check (kind in ('public', 'private')),
  name         text not null,
  city         text,
  search       text not null,                   -- hsSearchKey(name, city): lower case, no accents or punctuation
  data         json not null,                   -- one PublishedHighSchool, verbatim
  published_at timestamptz not null default now()
);

create index high_schools_state_idx on public.high_schools (state);
create index high_schools_search_trgm_idx on public.high_schools using gin (search extensions.gin_trgm_ops);

create table public.hs_staging (
  id     text primary key,
  state  text not null,
  kind   text not null,
  name   text not null,
  city   text,
  search text not null,
  data   json not null
);

create table public.high_school_details (
  id           text primary key,
  data         json not null,                   -- one HighSchoolDetail, verbatim
  published_at timestamptz not null default now()
);

create table public.hs_detail_staging (
  id   text primary key,
  data json not null
);

create table public.high_school_files (
  name         text primary key check (name in ('meta', 'medians')),
  data         json not null,
  published_at timestamptz not null default now()
);

alter table public.high_schools enable row level security;
alter table public.hs_staging enable row level security;
alter table public.high_school_details enable row level security;
alter table public.hs_detail_staging enable row level security;
alter table public.high_school_files enable row level security;

-- Public data: anyone may read. Nobody writes through the API except the publish script (secret key).
create policy "High schools are public" on public.high_schools for select to anon, authenticated using (true);
create policy "High school details are public" on public.high_school_details for select to anon, authenticated using (true);
create policy "High school files are public" on public.high_school_files for select to anon, authenticated using (true);

grant select on public.high_schools, public.high_school_details, public.high_school_files to anon, authenticated;
grant all on public.high_schools, public.hs_staging, public.high_school_details, public.hs_detail_staging, public.high_school_files to service_role;

-- Name/city search for the /high-schools page and the student profile picker. p_q should already be a search key
-- (hsSearchKey); it's lower-cased again here. A row matches when its key contains p_q or is word-similar to it
-- (pg_trgm); prefix matches rank first, then similarity, then name. Empty p_q with a state lists that state by name.
create function public.search_high_schools(p_q text, p_state text default null, p_limit integer default 20)
returns table (id text, name text, city text, state text, kind text, district text, grades text, score real)
language sql
stable
set search_path = ''
as $$
  with params as (
    select lower(btrim(coalesce(p_q, ''))) as q,
           nullif(upper(btrim(coalesce(p_state, ''))), '') as st,
           least(greatest(coalesce(p_limit, 20), 1), 50) as lim
  ), esc as (
    select q, st, lim, replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') as q_like from params
  )
  select h.id, h.name, h.city, h.state, h.kind,
         h.data -> 'district' ->> 'name' as district,
         case when h.data -> 'grades' ->> 'low' = h.data -> 'grades' ->> 'high' then h.data -> 'grades' ->> 'low'
              else (h.data -> 'grades' ->> 'low') || '–' || (h.data -> 'grades' ->> 'high') end as grades,
         (case when e.q = '' then 0
               when h.search like e.q_like || '%' then 2
               when h.search like '% ' || e.q_like || '%' then 1
               else 0 end
          + case when e.q = '' then 0 else extensions.word_similarity(e.q, h.search) end)::real as score
  from public.high_schools h, esc e
  where (e.st is null or h.state = e.st)
    and (e.q <> '' or e.st is not null)
    and (e.q = '' or h.search like '%' || e.q_like || '%' or e.q operator(extensions.<%) h.search)
  order by score desc, h.name, h.id
  limit (select lim from esc)
$$;

grant execute on function public.search_high_schools(text, text, integer) to anon, authenticated, service_role;

-- Add a batch of rows to the staging table. p_reset clears it first (the first batch of a publish).
create function public.stage_high_schools(p_rows json, p_reset boolean default false) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_rows) <> 'array' then
    raise exception 'stage_high_schools: p_rows must be an array';
  end if;
  if p_reset then
    delete from public.hs_staging where true;
  end if;
  insert into public.hs_staging (id, state, kind, name, city, search, data)
  select e ->> 'id', e ->> 'state', e ->> 'kind', e ->> 'name', e ->> 'city', e ->> 'search', e -> 'data'
  from json_array_elements(p_rows) as t(e)
  on conflict (id) do update set state = excluded.state, kind = excluded.kind, name = excluded.name,
    city = excluded.city, search = excluded.search, data = excluded.data;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Replace every row with what's staged, in one transaction, after checking every expected row arrived.
create function public.publish_high_schools_staged(p_expected integer) returns integer
language plpgsql
set search_path = ''
as $$
declare
  staged integer;
begin
  select count(*) into staged from public.hs_staging;
  if staged <> p_expected then
    raise exception 'publish_high_schools_staged: % rows staged, expected %', staged, p_expected;
  end if;
  delete from public.high_schools where true;
  insert into public.high_schools (id, state, kind, name, city, search, data)
  select id, state, kind, name, city, search, data from public.hs_staging;
  delete from public.hs_staging where true;
  return staged;
end;
$$;

create function public.stage_high_school_details(p_details json, p_reset boolean default false) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_details) <> 'array' then
    raise exception 'stage_high_school_details: p_details must be an array';
  end if;
  if p_reset then
    delete from public.hs_detail_staging where true;
  end if;
  insert into public.hs_detail_staging (id, data)
  select e ->> 'id', e from json_array_elements(p_details) as t(e)
  on conflict (id) do update set data = excluded.data;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function public.publish_high_school_details_staged(p_expected integer) returns integer
language plpgsql
set search_path = ''
as $$
declare
  staged integer;
begin
  select count(*) into staged from public.hs_detail_staging;
  if staged <> p_expected then
    raise exception 'publish_high_school_details_staged: % files staged, expected %', staged, p_expected;
  end if;
  delete from public.high_school_details where true;
  insert into public.high_school_details (id, data) select id, data from public.hs_detail_staging;
  delete from public.hs_detail_staging where true;
  return staged;
end;
$$;

revoke execute on function public.stage_high_schools(json, boolean) from public, anon, authenticated;
revoke execute on function public.publish_high_schools_staged(integer) from public, anon, authenticated;
revoke execute on function public.stage_high_school_details(json, boolean) from public, anon, authenticated;
revoke execute on function public.publish_high_school_details_staged(integer) from public, anon, authenticated;
grant execute on function public.stage_high_schools(json, boolean) to service_role;
grant execute on function public.publish_high_schools_staged(integer) to service_role;
grant execute on function public.stage_high_school_details(json, boolean) to service_role;
grant execute on function public.publish_high_school_details_staged(integer) to service_role;
