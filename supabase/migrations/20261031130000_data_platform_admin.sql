-- The console's functions for the data platform (specs/data-platform/storage.md "For the console",
-- specs/data-platform/change-sets.md "Holds and review", "Revert", "Admin edits"). Apply after
-- 20261031120000_data_platform.sql. Tested in tests/data-platform-policies.test.mts (refusals) and
-- tests/data-platform-functions.test.mts (what each does and logs).
--
-- Every function has the admin shape (20261012200000_admin.sql): is_admin() first ('admin only'), named exceptions
-- with error codes, the change, and one admin_log_write() in the same transaction with before and after in details.
-- Every change is a change set (kind 'edit' or 'revert', source 'console'), written through the data_*() functions so
-- the console and the pipelines share one set of rules. Execute: authenticated (each refuses all but an admin at aal2).

-- admin_log's targets gain the data platform's kinds.
alter table public.admin_log drop constraint admin_log_target_kind_check;
alter table public.admin_log add constraint admin_log_target_kind_check check (target_kind in
  ('user', 'student', 'household', 'invitation', 'member', 'college', 'change_set', 'snapshot', 'document'));

/* ------------------------------------------------------------------ */
/* Field edits                                                         */
/* ------------------------------------------------------------------ */

-- Save one value for one college: a new edit row (the live one for the path until released) in its own 'edit' change
-- set. Returns the edit's id. The path is checked for shape only: the registry of paths lives in TypeScript
-- (lib/fields.ts), so the console validates the path (registered, not computed or hidden) and the value's type
-- against it before calling. The shape allows digits after the first letter, as registered paths have them
-- ("admissions.sat_math_25_75"). A null value clears the field until released.
create function public.admin_data_edit(p_unit text, p_path text, p_value jsonb, p_note text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_before public.data_field_edits%rowtype;
  v_set bigint;
  v_edit bigint;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_unit is null or p_unit !~ '^[0-9]{1,12}$' then raise exception 'invalid_unit' using errcode = '22023'; end if;
  if p_path is null or p_path !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' or length(p_path) > 120 then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then raise exception 'invalid_note' using errcode = '22023'; end if;
  if jsonb_typeof(p_value) = 'null' then p_value := null; end if;

  select * into v_before from public.data_field_edits e
    where e.unit_id = p_unit and e.path = p_path and e.released_at is null
    order by e.id desc limit 1;

  v_set := public.data_open_change_set('edit', 'console', null, jsonb_build_object('unit', p_unit, 'path', p_path));
  insert into public.data_field_edits (unit_id, path, value, note, created_by, change_set_id)
  values (p_unit, p_path, p_value, v_note, auth.uid(), v_set)
  returning id into v_edit;
  perform public.data_close_change_set(v_set, 'applied', null, jsonb_build_object('edits', 1));

  perform public.admin_log_write('data.edit', 'college', p_unit, jsonb_build_object(
    'path', p_path, 'edit', v_edit, 'change_set', v_set, 'note', v_note,
    'before', case when v_before.id is null then null else jsonb_build_object('edit', v_before.id, 'value', v_before.value) end,
    'after', jsonb_build_object('edit', v_edit, 'value', p_value)));
  return v_edit;
end;
$$;

-- Let the pipelines' value through again: releases this edit and every other unreleased edit for the same college
-- and path ("Release clears all edits for the path"), in an 'edit' change set of its own.
create function public.admin_data_release_edit(p_edit bigint) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edit public.data_field_edits%rowtype;
  v_live public.data_field_edits%rowtype;
  v_set bigint;
  v_released bigint[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into v_edit from public.data_field_edits e where e.id = p_edit;
  if v_edit.id is null then raise exception 'edit_not_found' using errcode = 'P0002'; end if;
  if v_edit.released_at is not null then raise exception 'edit_released' using errcode = '22023'; end if;
  select * into v_live from public.data_field_edits e
    where e.unit_id = v_edit.unit_id and e.path = v_edit.path and e.released_at is null
    order by e.id desc limit 1;

  v_set := public.data_open_change_set('edit', 'console', null, jsonb_build_object('unit', v_edit.unit_id, 'path', v_edit.path));
  with released as (
    update public.data_field_edits e set released_at = now(), released_by = auth.uid()
    where e.unit_id = v_edit.unit_id and e.path = v_edit.path and e.released_at is null
    returning e.id
  )
  select array_agg(id order by id) into v_released from released;
  perform public.data_close_change_set(v_set, 'applied', null, jsonb_build_object('released', to_jsonb(v_released)));

  perform public.admin_log_write('data.release', 'college', v_edit.unit_id, jsonb_build_object(
    'path', v_edit.path, 'edit', p_edit, 'change_set', v_set, 'released', to_jsonb(v_released),
    'before', jsonb_build_object('edit', v_live.id, 'value', v_live.value),
    'after', null));
end;
$$;

/* ------------------------------------------------------------------ */
/* Holds                                                               */
/* ------------------------------------------------------------------ */

-- Hold an applied change set that no snapshot has carried yet: the automatic publish stops at it.
create function public.admin_data_hold(p_change_set bigint, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_set public.data_change_sets%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if v_reason is null or char_length(v_reason) > 500 then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into v_set from public.data_change_sets c where c.id = p_change_set for update;
  if v_set.id is null then raise exception 'change_set_not_found' using errcode = 'P0002'; end if;
  if v_set.status <> 'applied' then raise exception 'change_set_not_applied' using errcode = '22023'; end if;
  if v_set.snapshot_id is not null then raise exception 'change_set_published' using errcode = '22023'; end if;
  update public.data_change_sets set status = 'held', held_reason = v_reason where id = p_change_set;
  perform public.admin_log_write('data.hold', 'change_set', p_change_set::text, jsonb_build_object(
    'before', jsonb_build_object('status', v_set.status, 'held_reason', v_set.held_reason),
    'after', jsonb_build_object('status', 'held', 'held_reason', v_reason)));
end;
$$;

-- "Publish anyway": a held change set becomes applied, so the next publish carries it.
create function public.admin_data_unhold(p_change_set bigint) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.data_change_sets%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into v_set from public.data_change_sets c where c.id = p_change_set for update;
  if v_set.id is null then raise exception 'change_set_not_found' using errcode = 'P0002'; end if;
  if v_set.status <> 'held' then raise exception 'change_set_not_held' using errcode = '22023'; end if;
  update public.data_change_sets set status = 'applied', held_reason = null where id = p_change_set;
  perform public.admin_log_write('data.unhold', 'change_set', p_change_set::text, jsonb_build_object(
    'before', jsonb_build_object('status', 'held', 'held_reason', v_set.held_reason),
    'after', jsonb_build_object('status', 'applied', 'held_reason', null)));
end;
$$;

/* ------------------------------------------------------------------ */
/* Revert                                                              */
/* ------------------------------------------------------------------ */

-- Undo a closed change set (applied or held): a new 'revert' set writes, for every document the original touched, the
-- version just before the original's first version of it (a deletion when the original created it), and releases
-- the original's field edits. Refuses when any other change set wrote one of those documents after the original did,
-- so history stays a straight line (revert that one first, newest first); a later set already reverted, and its revert,
-- don't count. The original becomes 'reverted' with
-- reverted_by set. Returns the revert set's id.
create function public.admin_data_revert(p_change_set bigint, p_note text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_set public.data_change_sets%rowtype;
  v_later record;
  v_docs jsonb;
  v_revert bigint;
  v_written integer := 0;
  v_released bigint[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_note) > 500 then raise exception 'invalid_note' using errcode = '22023'; end if;
  select * into v_set from public.data_change_sets c where c.id = p_change_set for update;
  if v_set.id is null then raise exception 'change_set_not_found' using errcode = 'P0002'; end if;
  if v_set.status not in ('applied', 'held') then raise exception 'change_set_not_revertible' using errcode = '22023'; end if;

  -- A later write by another set to any document this one touched.
  select v.collection, v.key, v.change_set_id into v_later
  from public.data_document_versions v
  join (
    select o.collection, o.key, min(o.version) as first_v
    from public.data_document_versions o where o.change_set_id = p_change_set
    group by o.collection, o.key
  ) t on t.collection = v.collection and t.key = v.key and v.version > t.first_v
  join public.data_change_sets l on l.id = v.change_set_id
  where v.change_set_id <> p_change_set
    -- A later set that was itself reverted, and the revert that undid it, cancel out: they don't block.
    and l.status <> 'reverted'
    and not exists (select 1 from public.data_change_sets r where r.reverted_by = l.id)
  order by v.change_set_id desc
  limit 1;
  if v_later.change_set_id is not null then
    raise exception 'later change set touched %/% (change set %)', v_later.collection, v_later.key, v_later.change_set_id
      using errcode = 'P0001';
  end if;

  -- For each touched document, the body before the set's first version of it (null: absent or deleted), as the stored
  -- text exactly (json::text keeps key order), which is what data_write_documents takes.
  select coalesce(jsonb_agg(jsonb_build_object('collection', t.collection, 'key', t.key, 'body', (
      select case when p.deleted then null else to_jsonb(p.body::text) end from public.data_document_versions p
      where p.collection = t.collection and p.key = t.key and p.version < t.first_v
      order by p.version desc limit 1
    )) order by t.collection, t.key), '[]'::jsonb)
  into v_docs
  from (
    select o.collection, o.key, min(o.version) as first_v
    from public.data_document_versions o where o.change_set_id = p_change_set
    group by o.collection, o.key
  ) t;

  v_revert := public.data_open_change_set('revert', 'console', null, jsonb_build_object('reverts', p_change_set, 'note', v_note));
  v_written := public.data_write_documents(v_revert, v_docs);
  with released as (
    update public.data_field_edits e set released_at = now(), released_by = auth.uid()
    where e.change_set_id = p_change_set and e.released_at is null
    returning e.id
  )
  select array_agg(id order by id) into v_released from released;
  perform public.data_close_change_set(v_revert, 'applied', null,
    jsonb_build_object('released', coalesce(to_jsonb(v_released), '[]'::jsonb)));
  update public.data_change_sets set status = 'reverted', reverted_by = v_revert where id = p_change_set;

  perform public.admin_log_write('data.revert', 'change_set', p_change_set::text, jsonb_build_object(
    'revert', v_revert, 'documents', v_written, 'released', coalesce(to_jsonb(v_released), '[]'::jsonb), 'note', v_note,
    'before', jsonb_build_object('status', v_set.status),
    'after', jsonb_build_object('status', 'reverted', 'reverted_by', v_revert)));
  return v_revert;
end;
$$;

/* ------------------------------------------------------------------ */
/* Review items                                                        */
/* ------------------------------------------------------------------ */

-- Resolve one review-queue item (reported.review_queue, key "unit|edition|code"): the item's document gains
-- resolved ('rejected' | 'accepted'), resolved_on (the ISO date, as the console's Reject writes it today) and, with a
-- note, resolved_note. Accepting the value itself is a field edit (admin_data_edit), made by the console alongside.
create function public.admin_data_resolve_review(p_key text, p_resolution text, p_note text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_doc public.data_documents%rowtype;
  v_body jsonb;
  v_set bigint;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_resolution is null or p_resolution not in ('rejected', 'accepted') then
    raise exception 'invalid_resolution' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then raise exception 'invalid_note' using errcode = '22023'; end if;
  select * into v_doc from public.data_documents d where d.collection = 'reported.review_queue' and d.key = p_key;
  if v_doc.key is null then raise exception 'review_item_not_found' using errcode = 'P0002'; end if;

  -- Rebuilt as jsonb (the review queue isn't rendered byte for byte), written back as its text.
  v_body := (v_doc.body::jsonb - 'resolved_note')
    || jsonb_build_object('resolved', p_resolution, 'resolved_on', to_char(current_date, 'YYYY-MM-DD'))
    || case when v_note is null then '{}'::jsonb else jsonb_build_object('resolved_note', v_note) end;
  v_set := public.data_open_change_set('edit', 'console', null, jsonb_build_object('review', p_key));
  perform public.data_write_documents(v_set, jsonb_build_array(jsonb_build_object(
    'collection', 'reported.review_queue', 'key', p_key, 'body', v_body::text, 'expect_version', v_doc.version)));
  perform public.data_close_change_set(v_set, 'applied', null, null);

  perform public.admin_log_write('data.review', 'document', left(p_key, 80), jsonb_build_object(
    'collection', 'reported.review_queue', 'key', p_key, 'change_set', v_set, 'note', v_note,
    'before', jsonb_build_object('resolved', v_doc.body::jsonb -> 'resolved', 'resolved_on', v_doc.body::jsonb -> 'resolved_on'),
    'after', jsonb_build_object('resolved', p_resolution, 'resolved_on', v_body -> 'resolved_on')));
end;
$$;

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

-- "Point back here": records that a published snapshot is current again (pointer_at = now). The Storage pointer is
-- moved by the publisher's 'point' job, which the console dispatches after this call.
create function public.admin_data_point_snapshot(p_snapshot bigint) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snap public.data_snapshots%rowtype;
  v_current bigint;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into v_snap from public.data_snapshots s where s.id = p_snapshot for update;
  if v_snap.id is null then raise exception 'snapshot_not_found' using errcode = 'P0002'; end if;
  if v_snap.status <> 'published' then raise exception 'snapshot_not_published' using errcode = '22023'; end if;
  select s.id into v_current from public.data_snapshots s
    where s.status = 'published' and s.pointer_at is not null
    order by s.pointer_at desc, s.id desc limit 1;
  update public.data_snapshots set pointer_at = now() where id = p_snapshot;
  perform public.admin_log_write('data.point', 'snapshot', p_snapshot::text, jsonb_build_object(
    'before', jsonb_build_object('snapshot', v_current),
    'after', jsonb_build_object('snapshot', p_snapshot)));
end;
$$;

/* ------------------------------------------------------------------ */
/* Reference documents                                                 */
/* ------------------------------------------------------------------ */

-- Replace a reference document whole (the release calendar, aid policies, state laws, …), in an 'edit' change set.
-- p_name is the document's key. The document must already exist (the import writes them) in a `reference` collection
-- (`reference` or `reference.*`) or `base.release_calendar`, and the key must name exactly one of them, so the
-- console needn't know how the import named each collection. p_body is the document's JSON text, stored as written
-- (key order kept); the console validates it with the document's own validator, here only that it is an object or
-- array. Returns the change set's id (0 written when the
-- body is unchanged). The log carries the versions, not the bodies (the versions table has them).
create function public.admin_data_set_reference(p_name text, p_body text, p_note text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_doc public.data_documents%rowtype;
  v_matches integer;
  v_type text;
  v_set bigint;
  v_written integer;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  begin
    v_type := jsonb_typeof(p_body::jsonb);
  exception when others then
    raise exception 'invalid_body' using errcode = '22023';
  end;
  if v_type is null or v_type not in ('object', 'array') then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then raise exception 'invalid_note' using errcode = '22023'; end if;
  select count(*) into v_matches from public.data_documents d
    where d.key = p_name and (d.collection = 'reference' or d.collection like 'reference.%' or d.collection = 'base.release_calendar');
  if v_matches = 0 then raise exception 'reference_not_found' using errcode = 'P0002'; end if;
  if v_matches > 1 then raise exception 'reference_ambiguous' using errcode = '22023'; end if;
  select * into v_doc from public.data_documents d
    where d.key = p_name and (d.collection = 'reference' or d.collection like 'reference.%' or d.collection = 'base.release_calendar');

  v_set := public.data_open_change_set('edit', 'console', null, jsonb_build_object('reference', p_name, 'note', v_note));
  v_written := public.data_write_documents(v_set, jsonb_build_array(jsonb_build_object(
    'collection', v_doc.collection, 'key', v_doc.key, 'body', p_body, 'expect_version', v_doc.version)));
  perform public.data_close_change_set(v_set, 'applied', null, null);

  perform public.admin_log_write('data.reference', 'document', left(p_name, 80), jsonb_build_object(
    'collection', v_doc.collection, 'key', v_doc.key, 'change_set', v_set, 'note', v_note,
    'before', jsonb_build_object('version', v_doc.version),
    'after', jsonb_build_object('version', v_doc.version + v_written)));
  return v_set;
end;
$$;

/* ------------------------------------------------------------------ */
/* Function privileges                                                 */
/* ------------------------------------------------------------------ */

revoke execute on function public.admin_data_edit(text, text, jsonb, text) from public, anon;
revoke execute on function public.admin_data_release_edit(bigint) from public, anon;
revoke execute on function public.admin_data_hold(bigint, text) from public, anon;
revoke execute on function public.admin_data_unhold(bigint) from public, anon;
revoke execute on function public.admin_data_revert(bigint, text) from public, anon;
revoke execute on function public.admin_data_resolve_review(text, text, text) from public, anon;
revoke execute on function public.admin_data_point_snapshot(bigint) from public, anon;
revoke execute on function public.admin_data_set_reference(text, text, text) from public, anon;
grant execute on function public.admin_data_edit(text, text, jsonb, text) to authenticated;
grant execute on function public.admin_data_release_edit(bigint) to authenticated;
grant execute on function public.admin_data_hold(bigint, text) to authenticated;
grant execute on function public.admin_data_unhold(bigint) to authenticated;
grant execute on function public.admin_data_revert(bigint, text) to authenticated;
grant execute on function public.admin_data_resolve_review(text, text, text) to authenticated;
grant execute on function public.admin_data_point_snapshot(bigint) to authenticated;
grant execute on function public.admin_data_set_reference(text, text, text) to authenticated;
