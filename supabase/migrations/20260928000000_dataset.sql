-- The published dataset: the same content as data/schools.json, data/meta.json and
-- data/release-calendar.json, uploaded by `npm run publish-data` (scripts/publish-data.mts).
-- The app reads it with the publishable key when DATA_SOURCE=supabase. See specs/supabase.md.
--
-- Documents are stored as `json`, not `jsonb`: jsonb reorders object keys, and the app iterates some
-- objects in key order (e.g. race/ethnicity shares), so each row must read back exactly as written.

create table public.schools (
  unit_id    text primary key,                 -- IPEDS unit ID
  position   integer not null unique,          -- index in data/schools.json, so both stores list colleges in the same order
  name       text not null,
  state      text not null,
  data       json not null,                    -- one School (lib/types.ts), verbatim
  published_at timestamptz not null default now()
);

-- data/meta.json ('meta') and data/release-calendar.json ('release_calendar').
create table public.dataset_files (
  name       text primary key check (name in ('meta', 'release_calendar')),
  data       json not null,
  published_at timestamptz not null default now()
);

-- One row per publish: what went out, from which commit, by whom.
create table public.dataset_publishes (
  id           bigint generated always as identity primary key,
  published_at timestamptz not null default now(),
  school_count integer not null,
  retrieved    date,                           -- meta.retrieved of the published dataset
  git_commit   text,
  published_by text
);

-- Anyone may read the dataset (it's public data); nobody writes through the API. Publishing uses the
-- secret key, which bypasses row-level security, and only through publish_dataset() below.
alter table public.schools enable row level security;
alter table public.dataset_files enable row level security;
alter table public.dataset_publishes enable row level security;

create policy "Dataset is public" on public.schools for select to anon, authenticated using (true);
create policy "Dataset is public" on public.dataset_files for select to anon, authenticated using (true);

grant select on public.schools, public.dataset_files to anon, authenticated;
grant all on public.schools, public.dataset_files, public.dataset_publishes to service_role;

-- Replace the whole dataset in one transaction, so readers see either the old publish or the new one,
-- never a mix, and colleges dropped from the sync disappear. Returns the number of colleges written.
create function public.publish_dataset(
  p_schools json,
  p_meta json,
  p_release_calendar json,
  p_git_commit text default null,
  p_published_by text default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_schools) <> 'array' or json_array_length(p_schools) = 0 then
    raise exception 'publish_dataset: p_schools must be a non-empty array';
  end if;

  delete from public.schools where true;
  insert into public.schools (unit_id, position, name, state, data)
  select e ->> 'unit_id', (ord - 1)::integer, e ->> 'name', e -> 'location' ->> 'state', e
  from json_array_elements(p_schools) with ordinality as t(e, ord);
  get diagnostics n = row_count;

  insert into public.dataset_files (name, data)
  values ('meta', p_meta), ('release_calendar', p_release_calendar)
  on conflict (name) do update set data = excluded.data, published_at = now();

  insert into public.dataset_publishes (school_count, retrieved, git_commit, published_by)
  values (n, (p_meta ->> 'retrieved')::date, p_git_commit, p_published_by);

  return n;
end;
$$;

revoke execute on function public.publish_dataset(json, json, json, text, text) from public, anon, authenticated;
grant execute on function public.publish_dataset(json, json, json, text, text) to service_role;
