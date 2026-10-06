-- Faster high school search (replaces search_high_schools from 20261005180000_high_schools.sql; same signature, same
-- results). The SQL version was planned once, generically: its search text came through a CTE and "q is empty OR …"
-- conditions, so Postgres couldn't use the trigram index and read the whole table (9,369 pages, 73 MB) on every call.
-- Warm that took ~30 ms, but cold it took over 4 s and hit the anon role's 3 s statement timeout, so the site showed
-- no results. This version builds each query with EXECUTE, planned with the actual values: a name search uses the
-- trigram index (a few dozen pages); an empty search with a state lists that state by name through the state index.

create or replace function public.search_high_schools(p_q text, p_state text default null, p_limit integer default 20)
returns table (id text, name text, city text, state text, kind text, district text, grades text, score real)
language plpgsql
stable
set search_path = ''
as $$
declare
  q text := lower(btrim(coalesce(p_q, '')));
  st text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  q_like text;
  cols constant text := $c$
    h.id, h.name, h.city, h.state, h.kind,
    h.data -> 'district' ->> 'name',
    case when h.data -> 'grades' ->> 'low' = h.data -> 'grades' ->> 'high' then h.data -> 'grades' ->> 'low'
         else (h.data -> 'grades' ->> 'low') || '–' || (h.data -> 'grades' ->> 'high') end$c$;
begin
  if q = '' then
    if st is null then
      return;
    end if;
    return query execute
      'select ' || cols || ', 0::real from public.high_schools h where h.state = $1 order by h.name, h.id limit $2'
      using st, lim;
    return;
  end if;

  q_like := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query execute
    'select ' || cols || ',
       ((case when h.search like $2 || ''%'' then 2
              when h.search like ''% '' || $2 || ''%'' then 1
              else 0 end) + extensions.word_similarity($1, h.search))::real as score
     from public.high_schools h
     where (h.search like ''%'' || $2 || ''%'' or $1 operator(extensions.<%) h.search)'
     || case when st is null then '' else ' and h.state = $3' end ||
    ' order by score desc, h.name, h.id
     limit $4'
    using q, q_like, st, lim;
end;
$$;

grant execute on function public.search_high_schools(text, text, integer) to anon, authenticated, service_role;
