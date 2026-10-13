-- Email confirmation in the console (owner, 2026-10-13): People shows whether each account's email is confirmed, and an
-- admin can confirm or unconfirm it. Apply after 20261013120000_admin_list_households.sql (dev first, then prod).
--
-- admin_search_people() and admin_list_people() gain one column, email_confirmed (null for rows that aren't an
-- account: households, invitations, managed student records). A function's result columns can't change in place, so
-- both are dropped and re-created with their bodies unchanged apart from that column, and their grants re-applied.
--
-- admin_set_email_confirmed(user, confirmed) sets or clears auth.users.email_confirmed_at, the column Supabase Auth
-- reads to let an email-and-password account sign in. Unconfirming also ends the person's sessions (as
-- auth_end_sessions() does), so it takes effect now: their next sign-in asks them to confirm, and the sign-in page
-- offers to send the email again. Refused for your own account (cannot_change_self: you would lock yourself out) and
-- for an account with no email (no_email). Logged as auth.confirm / auth.unconfirm.

drop function public.admin_search_people(text, integer);

create function public.admin_search_people(q text, max_rows integer default 50)
returns table (kind text, id text, name text, email text, household text, household_id uuid, role text, status text,
               created timestamptz, last_sign_in timestamptz, email_confirmed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(coalesce(q, '')));
  v_like text;
  v_id uuid;
  v_trgm boolean;
  v_max integer := greatest(1, least(coalesce(max_rows, 50), 200));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if v_q = '' then
    return;
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if v_q ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := v_q::uuid;
  end if;
  v_trgm := char_length(v_q) >= 3;

  return query
  select * from (
    select 'user'::text, u.id::text, p.display_name, u.email::text, hh.name, hh.id, p.role_hint,
           case when p.deleted_at is not null then 'deleting' when p.suspended_at is not null then 'paused' else 'active' end,
           u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.households hh on hh.id = public.household_of(u.id)
    where u.id = v_id
       or lower(u.email) like v_like or lower(p.display_name) like v_like
       or (v_trgm and (v_q operator(extensions.<%) lower(coalesce(u.email, '')) or v_q operator(extensions.<%) lower(coalesce(p.display_name, ''))))
    union all
    select 'student'::text, s.id::text, s.display_name, su.email::text, hh.name, hh.id, 'student'::text,
           case when s.deleted_at is not null then 'deleting' when s.user_id is null then 'managed'
                when sp.suspended_at is not null then 'paused' else 'active' end,
           s.created, su.last_sign_in_at, case when su.id is not null then su.email_confirmed_at is not null end
    from public.students s
    left join auth.users su on su.id = s.user_id
    left join public.profiles sp on sp.id = s.user_id
    left join public.households hh on hh.id = public.household_of_student(s.id)
    where s.id = v_id or lower(s.display_name) like v_like
       or (v_trgm and v_q operator(extensions.<%) lower(coalesce(s.display_name, '')))
    union all
    select 'household'::text, h.id::text, h.name, null::text, h.name, h.id, null::text,
           case when h.deleted_at is not null then 'deleting' else 'active' end,
           h.created, null::timestamptz, null::boolean
    from public.households h
    where h.id = v_id or lower(h.name) like v_like or (v_trgm and v_q operator(extensions.<%) lower(h.name))
    union all
    select 'invitation'::text, i.id::text, i.display_name, i.email, h.name, h.id, i.side, 'invited'::text,
           i.created, null::timestamptz, null::boolean
    from public.invitations i
    join public.households h on h.id = i.household_id
    where i.accepted_at is null and i.revoked_at is null
      and (i.id = v_id or lower(i.email) like v_like or lower(i.display_name) like v_like
           or (v_trgm and (v_q operator(extensions.<%) lower(i.email) or v_q operator(extensions.<%) lower(coalesce(i.display_name, '')))))
  ) r (kind, id, name, email, household, household_id, role, status, created, last_sign_in, email_confirmed)
  order by array_position(array['user', 'student', 'household', 'invitation'], r.kind), lower(coalesce(r.name, r.email, '')), r.id
  limit v_max;
end;
$$;

revoke execute on function public.admin_search_people(text, integer) from public, anon;
grant execute on function public.admin_search_people(text, integer) to authenticated;

drop function public.admin_list_people(integer, integer);

create function public.admin_list_people(p_page integer default 1, p_size integer default 50)
returns table (kind text, id text, name text, email text, household text, household_id uuid, role text, status text,
               created timestamptz, last_sign_in timestamptz, email_confirmed boolean, total bigint)
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
           u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.households hh on hh.id = public.household_of(u.id)
    union all
    select 'student'::text, s.id::text, s.display_name, null::text, hh.name, hh.id, 'student'::text,
           case when s.deleted_at is not null then 'deleting' else 'managed' end,
           s.created, null::timestamptz, null::boolean
    from public.students s
    left join public.households hh on hh.id = public.household_of_student(s.id)
    where s.user_id is null
  ) r (kind, id, name, email, household, household_id, role, status, created, last_sign_in, email_confirmed)
  order by r.created desc, r.id
  offset v_offset
  limit v_size;
end;
$$;

revoke execute on function public.admin_list_people(integer, integer) from public, anon;
grant execute on function public.admin_list_people(integer, integer) to authenticated;

create function public.admin_set_email_confirmed(p_user uuid, p_confirmed boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_was timestamptz;
  v_sessions integer := 0;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_confirmed is null then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  select u.email::text, u.email_confirmed_at into v_email, v_was from auth.users u where u.id = p_user for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'no_email' using errcode = '22023';
  end if;
  if not p_confirmed and p_user = auth.uid() then
    raise exception 'cannot_change_self' using errcode = '42501';
  end if;
  if p_confirmed = (v_was is not null) then
    return;
  end if;

  update auth.users set email_confirmed_at = case when p_confirmed then now() end where id = p_user;
  if not p_confirmed then
    delete from auth.sessions where user_id = p_user;
    get diagnostics v_sessions = row_count;
  end if;
  perform public.admin_log_write(case when p_confirmed then 'auth.confirm' else 'auth.unconfirm' end, 'user', p_user::text,
    case when p_confirmed then '{}'::jsonb else jsonb_build_object('was_confirmed_at', v_was, 'sessions_ended', v_sessions) end);
end;
$$;

revoke execute on function public.admin_set_email_confirmed(uuid, boolean) from public, anon;
grant execute on function public.admin_set_email_confirmed(uuid, boolean) to authenticated;
