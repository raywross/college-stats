-- Pretend today (specs/planner/v3/pretend-today.md): a second site setting, `planner.today`, a YYYY-MM-DD the planner
-- treats as today outside production, or null to turn it off. admin_set_setting() learns the key and checks the value.
create or replace function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_day text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_key not in ('planner.all_moves', 'planner.today') then
    raise exception 'unknown_setting' using errcode = '22023';
  end if;
  if p_key = 'planner.all_moves' and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if p_key = 'planner.today' and jsonb_typeof(p_value) <> 'null' then
    if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid_value' using errcode = '22023'; end if;
    v_day := p_value #>> '{}';
    if v_day !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_value' using errcode = '22023'; end if;
    begin
      if to_char(v_day::date, 'YYYY-MM-DD') <> v_day then raise exception 'invalid_value' using errcode = '22023'; end if;
    exception when others then
      raise exception 'invalid_value' using errcode = '22023';
    end;
  end if;
  select s.value into v_old from public.app_settings s where s.key = p_key;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.admin_log_write('setting.set', null, p_key, jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;
