-- Site settings an admin can switch from the console (specs/product/admin.md "Settings"; first one: the planner's
-- all-moves preview, specs/planner/v3/all-moves-preview.md).
--
-- * One row per setting key, a jsonb value. Nothing here is a secret: every signed-in or signed-out request may read
--   it (the plan reads `planner.all_moves` on every open, with the viewer's own session).
-- * No write policy: the only write is admin_set_setting(), which checks is_admin() and logs `setting.set` with the
--   old and new value. A key the console doesn't know is refused (unknown_setting), so typos never land.

create table public.app_settings (
  key        text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.app_settings enable row level security;

create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);
grant select on public.app_settings to anon, authenticated, service_role;

-- Set one setting. Known keys only; the value's type is checked per key.
create function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_key not in ('planner.all_moves') then
    raise exception 'unknown_setting' using errcode = '22023';
  end if;
  if p_key = 'planner.all_moves' and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select s.value into v_old from public.app_settings s where s.key = p_key;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.admin_log_write('setting.set', null, p_key, jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;

revoke execute on function public.admin_set_setting(text, jsonb) from public, anon;
grant execute on function public.admin_set_setting(text, jsonb) to authenticated, service_role;
