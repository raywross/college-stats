-- Stage 1, the list (specs/planner/list-building.md "Finding colleges to add"; U2 on feature/planner-list, after
-- 20261008120000_planner.sql). One addition the foundation didn't need: a view-only guardian's "Suggest" button.
--
-- `list_items`'s own insert policy requires can_edit_list (20261006150000_household_hub.sql), which a view-only
-- guardian never passes, so their suggestion needs a function of its own rather than a plain insert — the same
-- shape as set_list_share() and send_nudge() in the earlier migrations: security definer, checks its own
-- permission (can_read_list, not can_edit_list: anyone who can see the list may suggest for it), then writes.

create function public.suggest_college(p_list uuid, p_unit_id text) returns public.list_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_position int;
  v_row public.list_items;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.can_read_list(p_list) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select display_name into v_name from public.profiles where id = v_uid;
  select coalesce(max(position) + 1, 0) into v_position from public.list_items where list_id = p_list;
  insert into public.list_items (list_id, unit_id, category, position, added_by)
  values (p_list, p_unit_id, 'unsorted', v_position, v_uid)
  on conflict (list_id, unit_id) do nothing
  returning * into v_row;
  if v_row.id is null then
    raise exception 'already_on_list' using errcode = '23505';
  end if;
  insert into public.list_notes (item_id, author_id, body, private)
  values (v_row.id, v_uid, 'Suggested by ' || coalesce(nullif(btrim(v_name), ''), 'a guardian'), false);
  return v_row;
end;
$$;

revoke execute on function public.suggest_college(uuid, text) from public, anon;
grant execute on function public.suggest_college(uuid, text) to authenticated;
