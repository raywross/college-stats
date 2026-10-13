-- College views (owner, 2026-10-13; specs/product/college-views.md): one row each time someone opens a college's
-- profile page, with who (when signed in) and when, so the console can show what a person is looking at and who is
-- looking at a college. Additive; apply after 20261013130000_admin_email_confirmed.sql (dev first, then prod).
--
-- Rules this file encodes:
-- * A view is recorded only through record_college_view(), which anyone may call (the profile pages are public). It
--   takes the signed-in user from the session (auth.uid()), never from the caller, so a view can't be filed under
--   someone else. Signed-out views are stored with no user: no cookie, address, or browser id is kept for them.
-- * The same signed-in person opening the same page of the same college within 10 minutes is one view (reloads and
--   back-and-forth aren't counted twice). The browser also skips repeats within a tab (components/profile/ViewBeacon).
-- * Nobody reads the table but an admin in the console ("Admins read", admin_reads()) and each person their own rows
--   ("Own views read"), which their account download includes (lib/account-export.ts). When an account is purged, its views stay as signed-out views
--   (user_id set null), so a college's counts don't change.
-- * The admin read functions aggregate (counts per college, per person, per day) and give the individual times on
--   drill-in. They don't log: the drill-in page for a student logs the view itself (admin_log_access), as the student
--   page does.

create table public.college_views (
  id        bigint generated always as identity primary key,
  unit_id   text not null check (unit_id ~ '^[0-9]{6}$'),
  user_id   uuid references auth.users (id) on delete set null,
  page      text not null default 'overview'
            check (page in ('overview', 'admissions', 'students', 'academics', 'cost', 'outcomes', 'history')),
  viewed_at timestamptz not null default now()
);

alter table public.college_views enable row level security;

create index college_views_unit_idx on public.college_views (unit_id, viewed_at desc);
create index college_views_user_idx on public.college_views (user_id, viewed_at desc) where user_id is not null;

create policy "Admins read" on public.college_views for select to authenticated using ((select public.admin_reads()));
-- A person reads their own views (their account download, lib/account-export.ts); never anyone else's.
create policy "Own views read" on public.college_views for select to authenticated using (user_id = (select auth.uid()));
grant select on public.college_views to authenticated;
revoke all on public.college_views from anon;
grant all on public.college_views to service_role;

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

-- One view of a college page by whoever is calling (signed in or not). Returns whether a row was written.
create function public.record_college_view(p_unit text, p_page text default 'overview') returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_page text := coalesce(nullif(btrim(p_page), ''), 'overview');
begin
  if p_unit is null or p_unit !~ '^[0-9]{6}$'
     or v_page not in ('overview', 'admissions', 'students', 'academics', 'cost', 'outcomes', 'history') then
    raise exception 'invalid_view' using errcode = '22023';
  end if;
  if v_user is not null and exists (
    select 1 from public.college_views v
    where v.user_id = v_user and v.unit_id = p_unit and v.page = v_page and v.viewed_at > now() - interval '10 minutes'
  ) then
    return false;
  end if;
  insert into public.college_views (unit_id, user_id, page) values (p_unit, v_user, v_page);
  return true;
end;
$$;

revoke execute on function public.record_college_view(text, text) from public;
grant execute on function public.record_college_view(text, text) to anon, authenticated, service_role;

/* ------------------------------------------------------------------ */
/* Reading, for the console                                            */
/* ------------------------------------------------------------------ */

-- The colleges one person has opened: views, first and last, newest first by last view (or most viewed). A read.
create function public.admin_user_college_views(p_user uuid)
returns table (unit_id text, views bigint, first_viewed timestamptz, last_viewed timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select v.unit_id, count(*), min(v.viewed_at), max(v.viewed_at)
  from public.college_views v
  where v.user_id = p_user
  group by v.unit_id
  order by count(*) desc, max(v.viewed_at) desc, v.unit_id;
end;
$$;

-- Who has opened one college: per signed-in person (name and email for the console), plus one row for signed-out views
-- (user_id null). Most views first. p_since narrows to a window (null = all time). A read.
create function public.admin_college_viewers(p_unit text, p_since timestamptz default null)
returns table (user_id uuid, name text, email text, views bigint, first_viewed timestamptz, last_viewed timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select v.user_id, p.display_name, u.email::text, count(*), min(v.viewed_at), max(v.viewed_at)
  from public.college_views v
  left join auth.users u on u.id = v.user_id
  left join public.profiles p on p.id = v.user_id
  where v.unit_id = p_unit and (p_since is null or v.viewed_at >= p_since)
  group by v.user_id, p.display_name, u.email
  order by (v.user_id is null), count(*) desc, max(v.viewed_at) desc;
end;
$$;

-- Views per day of one college, or of one person (whichever is given), over the last p_days days, every day present
-- (zeros included), split signed-in / signed-out. Days are in the site's zone (America/New_York). A read.
create function public.admin_college_views_daily(p_unit text default null, p_user uuid default null, p_days integer default 30)
returns table (day date, signed_in bigint, signed_out bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 366));
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if (p_unit is null) = (p_user is null) then raise exception 'invalid_view' using errcode = '22023'; end if;
  return query
  select d::date,
         count(v.id) filter (where v.user_id is not null),
         count(v.id) filter (where v.user_id is null)
  from generate_series(v_today - (v_days - 1), v_today, interval '1 day') d
  left join public.college_views v
    on (v.viewed_at at time zone 'America/New_York')::date = d::date
   and (p_unit is null or v.unit_id = p_unit)
   and (p_user is null or v.user_id = p_user)
  group by d
  order by d;
end;
$$;

-- The individual views behind a drill-in: one person's views of one college, or every view of a college by signed-out
-- visitors (p_user null with p_signed_out true). Newest first, capped at p_limit. A read.
create function public.admin_college_view_times(p_unit text, p_user uuid default null, p_signed_out boolean default false,
                                                p_limit integer default 500)
returns table (viewed_at timestamptz, page text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if (p_user is null) = (not coalesce(p_signed_out, false)) then raise exception 'invalid_view' using errcode = '22023'; end if;
  return query
  select v.viewed_at, v.page
  from public.college_views v
  where v.unit_id = p_unit and (case when p_signed_out then v.user_id is null else v.user_id = p_user end)
  order by v.viewed_at desc, v.id desc
  limit greatest(1, least(coalesce(p_limit, 500), 5000));
end;
$$;

revoke execute on function public.admin_user_college_views(uuid) from public, anon;
revoke execute on function public.admin_college_viewers(text, timestamptz) from public, anon;
revoke execute on function public.admin_college_views_daily(text, uuid, integer) from public, anon;
revoke execute on function public.admin_college_view_times(text, uuid, boolean, integer) from public, anon;
grant execute on function public.admin_user_college_views(uuid) to authenticated;
grant execute on function public.admin_college_viewers(text, timestamptz) to authenticated;
grant execute on function public.admin_college_views_daily(text, uuid, integer) to authenticated;
grant execute on function public.admin_college_view_times(text, uuid, boolean, integer) to authenticated;
