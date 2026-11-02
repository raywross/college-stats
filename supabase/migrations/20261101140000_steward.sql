-- The Data Steward's console write (specs/product/data-steward.md "The console: where it all shows"): one function for
-- every console change to the Steward's own documents (a decision, a To do status, an answer, a row's decision, an
-- issue left with a reason), restricted to the `steward.*` collections, so the Steward's documents and the admin's
-- decisions share one history. Apply after 20261031130000_data_platform_admin.sql. Tested in
-- tests/steward-policies.test.mts (PGlite).
--
-- The shape of admin_data_set_reference: is_admin() first ('admin only'), named exceptions with error codes, the
-- document written as its text through data_write_documents in its own change set (kind 'edit', source 'console'),
-- and one admin_log_write('steward.write') in the same transaction with the key and the top-level fields that changed,
-- before and after. The callers (the Server Actions, lib/admin/steward-actions.ts) read the document, change the fields
-- they own, and write it back whole. Execute: authenticated (refused for all but an admin at aal2).

create function public.admin_steward_write(p_collection text, p_key text, p_body text, p_note text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_body jsonb;
  v_doc public.data_documents%rowtype;
  v_before jsonb;
  v_changed text[];
  v_set bigint;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_collection is null or p_collection !~ '^steward\.[a-z][a-z0-9_]*$' then
    raise exception 'not_steward_collection' using errcode = '22023';
  end if;
  if p_key is null or length(p_key) not between 1 and 200 then raise exception 'invalid_key' using errcode = '22023'; end if;
  begin
    v_body := p_body::jsonb;
  exception when others then
    raise exception 'invalid_body' using errcode = '22023';
  end;
  if v_body is null or jsonb_typeof(v_body) <> 'object' then raise exception 'invalid_body' using errcode = '22023'; end if;
  if char_length(v_note) > 500 then raise exception 'invalid_note' using errcode = '22023'; end if;

  select * into v_doc from public.data_documents d where d.collection = p_collection and d.key = p_key;
  v_before := case when v_doc.key is null then null else v_doc.body::jsonb end;
  select coalesce(array_agg(k order by k), '{}') into v_changed from (
    select k from jsonb_object_keys(v_body) k
    where v_before is null or (v_before -> k) is distinct from (v_body -> k)
    union
    select k from jsonb_object_keys(coalesce(v_before, '{}'::jsonb)) k
    where not (v_body ? k)
  ) changed;

  v_set := public.data_open_change_set('edit', 'console', null, jsonb_build_object('collection', p_collection, 'key', p_key, 'note', v_note));
  perform public.data_write_documents(v_set, jsonb_build_array(jsonb_build_object(
    'collection', p_collection, 'key', p_key, 'body', p_body, 'expect_version', coalesce(v_doc.version, 0))));
  perform public.data_close_change_set(v_set, 'applied', null, null);

  perform public.admin_log_write('steward.write', 'document', left(p_key, 80), jsonb_build_object(
    'collection', p_collection, 'key', p_key, 'change_set', v_set, 'note', v_note,
    'changed', to_jsonb(v_changed),
    'before', case when v_before is null then null
      else (select coalesce(jsonb_object_agg(k, v_before -> k), '{}'::jsonb) from unnest(v_changed) k where v_before ? k) end,
    'after', (select coalesce(jsonb_object_agg(k, v_body -> k), '{}'::jsonb) from unnest(v_changed) k where v_body ? k)));
  return v_set;
end;
$$;

revoke execute on function public.admin_steward_write(text, text, text, text) from public, anon;
grant execute on function public.admin_steward_write(text, text, text, text) to authenticated;
