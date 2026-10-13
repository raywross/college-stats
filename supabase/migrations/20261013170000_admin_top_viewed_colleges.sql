-- The admin Colleges page's "Most viewed" list (owner, 2026-10-13: "a top 10 list of colleges based on number of
-- views"): colleges by views over the last p_days days (null = all time), with how many signed-in people and how many
-- signed-out views make up each count. Reads college_views (20261013140000_college_views.sql). Additive. A read.

create function public.admin_top_viewed_colleges(p_days integer default 30, p_limit integer default 10)
returns table (unit_id text, views bigint, people bigint, signed_out bigint, last_viewed timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select v.unit_id, count(*), count(distinct v.user_id), count(*) filter (where v.user_id is null), max(v.viewed_at)
  from public.college_views v
  where p_days is null or v.viewed_at >= now() - make_interval(days => greatest(1, least(p_days, 3650)))
  group by v.unit_id
  order by count(*) desc, max(v.viewed_at) desc, v.unit_id
  limit greatest(1, least(coalesce(p_limit, 10), 100));
end;
$$;

revoke execute on function public.admin_top_viewed_colleges(integer, integer) from public, anon;
grant execute on function public.admin_top_viewed_colleges(integer, integer) to authenticated;
