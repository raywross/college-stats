-- The People page with no search (specs/product/admin.md "Search"): every account and every managed student record,
-- newest first, a page at a time. Additive; apply after 20261012200000_admin.sql (dev first, then prod).
--
-- Rows have admin_search_people()'s shape plus total (the row count before paging), so the page renders both with one
-- list. Accounts are kind 'user'; a student record with its own account is that account's row, so only managed records
-- (no account yet) are listed as kind 'student'. Households and invitations stay search-only. A read: no log row.

create function public.admin_list_people(p_page integer default 1, p_size integer default 50)
returns table (kind text, id text, name text, email text, household text, household_id uuid, role text, status text,
               created timestamptz, last_sign_in timestamptz, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size integer := greatest(1, least(coalesce(p_size, 50), 200));
  v_offset integer := (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_size, 50), 200));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;

  return query
  select r.*, count(*) over () as total
  from (
    select 'user'::text, u.id::text, p.display_name, u.email::text, hh.name, hh.id, p.role_hint,
           case when p.deleted_at is not null then 'deleting' when p.suspended_at is not null then 'paused' else 'active' end,
           u.created_at, u.last_sign_in_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.households hh on hh.id = public.household_of(u.id)
    union all
    select 'student'::text, s.id::text, s.display_name, null::text, hh.name, hh.id, 'student'::text,
           case when s.deleted_at is not null then 'deleting' else 'managed' end,
           s.created, null::timestamptz
    from public.students s
    left join public.households hh on hh.id = public.household_of_student(s.id)
    where s.user_id is null
  ) r (kind, id, name, email, household, household_id, role, status, created, last_sign_in)
  order by r.created desc, r.id
  offset v_offset
  limit v_size;
end;
$$;

revoke execute on function public.admin_list_people(integer, integer) from public, anon;
grant execute on function public.admin_list_people(integer, integer) to authenticated;
