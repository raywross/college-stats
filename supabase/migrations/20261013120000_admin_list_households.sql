-- The Households page (owner, 2026-10-13: separate views for people and households): every household, newest first,
-- a page at a time, with who is in it and what's pending, and an optional search. Additive; apply after
-- 20261012200000_admin.sql (dev first, then prod).
--
-- q matches, case-insensitively: the household's name, a member's name or account email, a pending invitation's email
-- or name, or the household's id exactly. Closed households are included (status 'deleting'). members is the active
-- members' names, guardians first. total is the row count before paging. A read: no log row.

create function public.admin_list_households(q text default null, p_page integer default 1, p_size integer default 50)
returns table (id uuid, name text, status text, guardians integer, students integer, invitations integer, members text,
               created timestamptz, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(coalesce(q, '')));
  v_like text;
  v_id uuid;
  v_size integer := greatest(1, least(coalesce(p_size, 50), 200));
  v_offset integer;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  v_offset := (greatest(coalesce(p_page, 1), 1) - 1) * v_size;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if v_q ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := v_q::uuid;
  end if;

  return query
  with member_rows as (
    select m.household_id, m.role,
           case when m.role = 'guardian' then coalesce(p.display_name, gu.email::text) else s.display_name end as who,
           lower(coalesce(p.display_name, '') || ' ' || coalesce(gu.email::text, '') || ' ' || coalesce(s.display_name, '')
                 || ' ' || coalesce(su.email::text, '')) as haystack,
           coalesce(m.accepted_at, m.created) as since, m.id as member_id
    from public.household_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users gu on gu.id = m.user_id
    left join public.students s on s.id = m.student_id
    left join auth.users su on su.id = s.user_id
    where m.status = 'active'
  ),
  pending as (
    select i.household_id, lower(i.email || ' ' || coalesce(i.display_name, '')) as haystack
    from public.invitations i
    where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  )
  select h.id, h.name,
         case when h.deleted_at is not null then 'deleting' else 'active' end,
         (select count(*)::integer from member_rows r where r.household_id = h.id and r.role = 'guardian'),
         (select count(*)::integer from member_rows r where r.household_id = h.id and r.role = 'student'),
         (select count(*)::integer from pending i where i.household_id = h.id),
         (select string_agg(r.who, ', ' order by r.role, r.since, r.member_id) from member_rows r where r.household_id = h.id),
         h.created,
         count(*) over ()
  from public.households h
  where v_q = ''
     or h.id = v_id
     or lower(h.name) like v_like
     or exists (select 1 from member_rows r where r.household_id = h.id and r.haystack like v_like)
     or exists (select 1 from pending i where i.household_id = h.id and i.haystack like v_like)
  order by h.created desc, h.id
  offset v_offset
  limit v_size;
end;
$$;

revoke execute on function public.admin_list_households(text, integer, integer) from public, anon;
grant execute on function public.admin_list_households(text, integer, integer) to authenticated;
