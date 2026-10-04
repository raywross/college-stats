-- Short names and nicknames (lib/aliases.ts; specs/school-identity/aliases.md): the same content as
-- data/aliases.json. Unlike every other table so far, the app queries this one by a value (the search key) rather
-- than by college (see database-architecture.md), so it's a flat lookup table with an index on `key`, not a
-- document collection. Small (a few thousand short rows, a few hundred KB): replaced in one transaction, unlike
-- schools and history, which grew too big for one statement and had to be staged in batches.

create table public.school_aliases (
  unit_id text not null,                                           -- IPEDS unit ID
  alias   text not null,                                            -- as people write it, "UGA"
  key     text not null,                                            -- search key: lower case, no accents/punctuation/spaces, "uga"
  source  text not null check (source in ('curated', 'ipeds', 'wikidata', 'domain')),
  weight  integer not null,
  primary key (unit_id, key)
);

create index school_aliases_key_idx on public.school_aliases (key);

-- Anyone may read the table (it's public data); nobody writes through the API. Publishing uses the secret key,
-- which bypasses row-level security, and only through publish_aliases() below.
alter table public.school_aliases enable row level security;

create policy "Aliases are public" on public.school_aliases for select to anon, authenticated using (true);

grant select on public.school_aliases to anon, authenticated;
grant all on public.school_aliases to service_role;

-- Replace every alias in one transaction: small enough (a few thousand short rows) that, unlike schools and
-- history, it needs no staging table. Returns the number of rows written.
create function public.publish_aliases(p_aliases json) returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if json_typeof(p_aliases) <> 'array' or json_array_length(p_aliases) = 0 then
    raise exception 'publish_aliases: p_aliases must be a non-empty array';
  end if;

  delete from public.school_aliases where true;
  insert into public.school_aliases (unit_id, alias, key, source, weight)
  select e ->> 'unit_id', e ->> 'alias', e ->> 'key', e ->> 'source', (e ->> 'weight')::integer
  from json_array_elements(p_aliases) as t(e);
  get diagnostics n = row_count;

  return n;
end;
$$;

revoke execute on function public.publish_aliases(json) from public, anon, authenticated;
grant execute on function public.publish_aliases(json) to service_role;
