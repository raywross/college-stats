-- The data platform's store (specs/data-platform/storage.md): every layer of the college dataset as versioned
-- documents, the change sets that write them, admin field edits, and the snapshots the publisher makes from them.
-- Additive; nothing reads these tables until the pipelines move (specs/data-platform/rollout.md). Apply after
-- 20261030150000_essay_prompt_overrides.sql, then 20261031130000_data_platform_admin.sql (the console's functions).
-- Tested in the PGlite harness: tests/data-platform-policies.test.mts and tests/data-platform-functions.test.mts.
--
-- Rules this file encodes:
-- * Everything here is public data or pipeline state about public data, never a person's data: anon and
--   authenticated may select every table (the app overlays field edits for every visitor; the console reads with the
--   admin's session). Nobody writes a table directly, the service role included: select is the only grant, and
--   writes go through the security-definer functions below (pipelines, the publisher) and the admin_data_*()
--   functions (the console). data_document_versions is append-only by construction.
-- * Document bodies are `json`, not `jsonb`: json keeps the text exactly as written (key order included), so a
--   document read back renders today's files byte for byte (the phase gate, specs/data-platform/rollout.md). Equality
--   checks cast to jsonb, so a difference in key order or whitespace alone is not a change.
-- * A document's version counts up from 1 and never repeats: a deleted document leaves the current table and its last
--   version row says deleted = true; writing it again continues from that version. A write whose body equals the
--   current body (jsonb equality) writes nothing, so re-running a pipeline over unchanged data is free.
-- * The data_*() functions are for the secret key only (execute granted to service_role, revoked from everyone else).
-- * The snapshots bucket is public-read; only the service role writes it. The storage statements are skipped where
--   the storage schema doesn't exist (the PGlite harness).

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

-- One per run, import, edit batch or revert. snapshot_id's foreign key is added once data_snapshots exists.
create table public.data_change_sets (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('pipeline', 'import', 'edit', 'revert', 'publish-fix')),
  source       text not null,
  run_ref      text,
  status       text not null default 'applied' check (status in ('open', 'applied', 'held', 'reverted')),
  held_reason  text,
  summary      jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  snapshot_id  bigint,
  reverted_by  bigint references public.data_change_sets (id)
);
create index data_change_sets_status on public.data_change_sets (status, created_at desc);

-- What was published. The pointer object in Storage names the live one; this table is its history.
create table public.data_snapshots (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null,
  status         text not null default 'building' check (status in ('building', 'published', 'failed', 'withdrawn')),
  manifest       jsonb not null default '{}'::jsonb,
  change_set_ids bigint[] not null default '{}',
  previous_id    bigint references public.data_snapshots (id),
  pointer_at     timestamptz,
  notes          text
);

alter table public.data_change_sets
  add constraint data_change_sets_snapshot_id_fkey foreign key (snapshot_id) references public.data_snapshots (id);

-- The current version of every document. A deleted document is not here; its last version row says deleted.
create table public.data_documents (
  collection    text not null check (collection ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  key           text not null check (length(key) between 1 and 200),
  version       integer not null check (version >= 1),
  body          json not null,
  change_set_id bigint not null references public.data_change_sets (id),
  updated_at    timestamptz not null default now(),
  primary key (collection, key)
);
create index data_documents_change_set on public.data_documents (change_set_id);

-- Every version, append-only (body null when deleted).
create table public.data_document_versions (
  id            bigint generated always as identity primary key,
  collection    text not null,
  key           text not null,
  version       integer not null,
  body          json,
  deleted       boolean not null default false,
  change_set_id bigint not null references public.data_change_sets (id),
  created_at    timestamptz not null default now(),
  unique (collection, key, version)
);
create index data_document_versions_doc on public.data_document_versions (collection, key, version desc);
create index data_document_versions_change_set on public.data_document_versions (change_set_id);

-- Admin edits, the last layer. The live edit for a path is the newest unreleased row; older rows are its history.
-- created_by is nullable (storage.md writes `not null … on delete set null`, which would make deleting an admin's
-- account fail); admin_data_edit() always fills it.
create table public.data_field_edits (
  id            bigint generated always as identity primary key,
  unit_id       text not null check (unit_id ~ '^[0-9]{1,12}$'),
  path          text not null,
  value         jsonb,
  note          text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  released_at   timestamptz,
  released_by   uuid references auth.users (id) on delete set null,
  change_set_id bigint not null references public.data_change_sets (id)
);
create index data_field_edits_live on public.data_field_edits (unit_id, path) where released_at is null;
create index data_field_edits_change_set on public.data_field_edits (change_set_id);

/* ------------------------------------------------------------------ */
/* Row-level security: select for everyone, no write policy           */
/* ------------------------------------------------------------------ */

alter table public.data_change_sets enable row level security;
alter table public.data_snapshots enable row level security;
alter table public.data_documents enable row level security;
alter table public.data_document_versions enable row level security;
alter table public.data_field_edits enable row level security;

create policy data_change_sets_read on public.data_change_sets for select to anon, authenticated using (true);
create policy data_snapshots_read on public.data_snapshots for select to anon, authenticated using (true);
create policy data_documents_read on public.data_documents for select to anon, authenticated using (true);
create policy data_document_versions_read on public.data_document_versions for select to anon, authenticated using (true);
create policy data_field_edits_read on public.data_field_edits for select to anon, authenticated using (true);

-- Supabase grants every role everything on new public tables by default; take it back so select is the only grant.
revoke all on public.data_change_sets, public.data_snapshots, public.data_documents, public.data_document_versions,
  public.data_field_edits from public, anon, authenticated, service_role;
grant select on public.data_change_sets, public.data_snapshots, public.data_documents, public.data_document_versions,
  public.data_field_edits to anon, authenticated, service_role;

/* ------------------------------------------------------------------ */
/* Pipelines: change sets and documents                                */
/* ------------------------------------------------------------------ */

-- Opens a change set ('open') and returns its id. created_by is the caller when there is one (null for pipelines).
create function public.data_open_change_set(p_kind text, p_source text, p_run_ref text, p_summary jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if coalesce(btrim(p_source), '') = '' then raise exception 'invalid_source' using errcode = '22023'; end if;
  if p_summary is not null and jsonb_typeof(p_summary) <> 'object' then
    raise exception 'invalid_summary' using errcode = '22023';
  end if;
  insert into public.data_change_sets (kind, source, run_ref, status, summary, created_by)
  values (p_kind, btrim(p_source), p_run_ref, 'open', coalesce(p_summary, '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Writes documents in one transaction. p_documents is an array of {collection, key, body, expect_version?} where body
-- is the document's JSON text as a string (an object or array, stored as written) or null to delete. For each, in
-- order:
-- * expect_version (when given and not null) must equal the current version, 0 meaning "no current document";
--   otherwise 'version conflict' (40001) and nothing in the call is written.
-- * A body equal to the current one (compared as jsonb: key order and whitespace don't count), or a delete of a
--   document that doesn't exist, writes nothing.
-- * Otherwise the next version (one past the newest version row, so a re-created document never reuses a number) goes
--   into data_document_versions and the current row is replaced, or removed for a delete.
-- Returns the number of versions written.
create function public.data_write_documents(p_change_set bigint, p_documents jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_doc jsonb;
  v_collection text;
  v_key text;
  v_text text;
  v_body jsonb;
  v_expect integer;
  v_current public.data_documents%rowtype;
  v_last integer;
  v_written integer := 0;
begin
  select c.status into v_status from public.data_change_sets c where c.id = p_change_set for update;
  if v_status is distinct from 'open' then
    raise exception 'change set is not open' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_documents) is distinct from 'array' then
    raise exception 'invalid_documents' using errcode = '22023';
  end if;

  for v_doc in select d from jsonb_array_elements(p_documents) d loop
    if jsonb_typeof(v_doc) <> 'object' or not (v_doc ? 'body')
       or jsonb_typeof(v_doc -> 'body') not in ('string', 'null')
       or jsonb_typeof(v_doc -> 'collection') is distinct from 'string'
       or jsonb_typeof(v_doc -> 'key') is distinct from 'string' then
      raise exception 'invalid_document' using errcode = '22023';
    end if;
    v_collection := v_doc ->> 'collection';
    v_key := v_doc ->> 'key';
    if v_collection !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' or length(v_key) not between 1 and 200 then
      raise exception 'invalid_document' using errcode = '22023';
    end if;
    v_text := v_doc ->> 'body';
    v_body := null;
    if v_text is not null then
      begin
        v_body := v_text::jsonb;
      exception when others then
        raise exception 'invalid_document' using errcode = '22023', detail = format('%s/%s: body is not JSON', v_collection, v_key);
      end;
      if jsonb_typeof(v_body) not in ('object', 'array') then
        raise exception 'invalid_document' using errcode = '22023', detail = format('%s/%s: body is not an object or array', v_collection, v_key);
      end if;
    end if;

    select * into v_current from public.data_documents d
      where d.collection = v_collection and d.key = v_key for update;

    if (v_doc ? 'expect_version') and jsonb_typeof(v_doc -> 'expect_version') <> 'null' then
      v_expect := (v_doc ->> 'expect_version')::integer;
      if v_expect is distinct from coalesce(v_current.version, 0) then
        raise exception 'version conflict' using errcode = '40001',
          detail = format('%s/%s: expected %s, current %s', v_collection, v_key, v_expect, coalesce(v_current.version, 0));
      end if;
    end if;

    if v_body is null and v_current.version is null then continue; end if;
    if v_body is not null and v_current.body::jsonb = v_body then continue; end if;

    select max(v.version) into v_last from public.data_document_versions v
      where v.collection = v_collection and v.key = v_key;
    v_last := greatest(coalesce(v_last, 0), coalesce(v_current.version, 0)) + 1;

    insert into public.data_document_versions (collection, key, version, body, deleted, change_set_id)
    values (v_collection, v_key, v_last, v_text::json, v_text is null, p_change_set);

    if v_body is null then
      delete from public.data_documents d where d.collection = v_collection and d.key = v_key;
    else
      insert into public.data_documents (collection, key, version, body, change_set_id, updated_at)
      values (v_collection, v_key, v_last, v_text::json, p_change_set, now())
      on conflict (collection, key) do update
        set version = excluded.version, body = excluded.body, change_set_id = excluded.change_set_id,
            updated_at = excluded.updated_at;
    end if;
    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

-- The counts a change set's summary carries, from its versions: documents (distinct documents touched), added (absent
-- before the set's first version, present after its last), changed (present before and after), removed (present
-- before, absent after), and collections (sorted). Internal; data_close_change_set and the revert use it.
create function public.data_change_set_counts(p_change_set bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with docs as (
    select v.collection, v.key, min(v.version) as first_v, max(v.version) as last_v
    from public.data_document_versions v
    where v.change_set_id = p_change_set
    group by v.collection, v.key
  ), states as (
    select d.collection,
      coalesce((
        select not p.deleted from public.data_document_versions p
        where p.collection = d.collection and p.key = d.key and p.version < d.first_v
        order by p.version desc limit 1
      ), false) as before,
      (
        select not l.deleted from public.data_document_versions l
        where l.collection = d.collection and l.key = d.key and l.version = d.last_v
      ) as after
    from docs d
  )
  select jsonb_build_object(
    'documents', (select count(*) from states),
    'added', (select count(*) from states where not before and after),
    'changed', (select count(*) from states where before and after),
    'removed', (select count(*) from states where before and not after),
    'collections', (select coalesce(jsonb_agg(c order by c), '[]'::jsonb) from (select distinct collection as c from docs) s)
  )
$$;

-- Closes an open set as 'applied', or 'held' with the reason (required). The summary keeps what the set opened with,
-- gains the counts above, and takes p_summary's keys last, so a caller may supply any of them.
create function public.data_close_change_set(p_change_set bigint, p_status text, p_held_reason text default null,
  p_summary jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.data_change_sets%rowtype;
begin
  if p_status is null or p_status not in ('applied', 'held') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'held' and coalesce(btrim(p_held_reason), '') = '' then
    raise exception 'held_reason_required' using errcode = '22023';
  end if;
  if p_summary is not null and jsonb_typeof(p_summary) <> 'object' then
    raise exception 'invalid_summary' using errcode = '22023';
  end if;
  select * into v_set from public.data_change_sets c where c.id = p_change_set for update;
  if v_set.status is distinct from 'open' then
    raise exception 'change set is not open' using errcode = 'P0001';
  end if;
  update public.data_change_sets set
    status = p_status,
    held_reason = case when p_status = 'held' then btrim(p_held_reason) end,
    summary = v_set.summary || public.data_change_set_counts(p_change_set) || coalesce(p_summary, '{}'::jsonb),
    closed_at = now()
  where id = p_change_set;
end;
$$;

-- The current documents of a collection, optionally only keys starting with p_key_prefix, in key order.
create function public.data_read_collection(p_collection text, p_key_prefix text default null)
returns setof public.data_documents
language sql
stable
security definer
set search_path = ''
as $$
  select d.* from public.data_documents d
  where d.collection = p_collection
    and (p_key_prefix is null or left(d.key, length(p_key_prefix)) = p_key_prefix)
  order by d.key
$$;

/* ------------------------------------------------------------------ */
/* The publisher: snapshots                                            */
/* ------------------------------------------------------------------ */

-- A 'building' row for the snapshot the publisher is about to render; returns its id (the snapshot's folder name).
create function public.data_begin_snapshot(p_change_set_ids bigint[], p_previous bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.data_snapshots (created_by, change_set_ids, previous_id)
  values (auth.uid(), coalesce(p_change_set_ids, '{}'), p_previous)
  returning id into v_id;
  return v_id;
end;
$$;

-- Finishes a building snapshot: 'published' (the pointer moved to it now; every carried change set without a snapshot
-- records this one as the first that carried it) or 'failed'.
create function public.data_finish_snapshot(p_snapshot bigint, p_status text, p_manifest jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snap public.data_snapshots%rowtype;
begin
  if p_status is null or p_status not in ('published', 'failed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_manifest is not null and jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'invalid_manifest' using errcode = '22023';
  end if;
  select * into v_snap from public.data_snapshots s where s.id = p_snapshot for update;
  if v_snap.status is distinct from 'building' then
    raise exception 'snapshot is not building' using errcode = 'P0001';
  end if;
  update public.data_snapshots set
    status = p_status,
    manifest = coalesce(p_manifest, manifest),
    notes = p_notes,
    pointer_at = case when p_status = 'published' then now() end
  where id = p_snapshot;
  if p_status = 'published' then
    update public.data_change_sets set snapshot_id = p_snapshot
    where id = any (v_snap.change_set_ids) and snapshot_id is null;
  end if;
end;
$$;

/* ------------------------------------------------------------------ */
/* Function privileges: the secret key only                            */
/* ------------------------------------------------------------------ */

revoke execute on function public.data_open_change_set(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.data_write_documents(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.data_change_set_counts(bigint) from public, anon, authenticated;
revoke execute on function public.data_close_change_set(bigint, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.data_read_collection(text, text) from public, anon, authenticated;
revoke execute on function public.data_begin_snapshot(bigint[], bigint) from public, anon, authenticated;
revoke execute on function public.data_finish_snapshot(bigint, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.data_open_change_set(text, text, text, jsonb) to service_role;
grant execute on function public.data_write_documents(bigint, jsonb) to service_role;
grant execute on function public.data_change_set_counts(bigint) to service_role;
grant execute on function public.data_close_change_set(bigint, text, text, jsonb) to service_role;
grant execute on function public.data_read_collection(text, text) to service_role;
grant execute on function public.data_begin_snapshot(bigint[], bigint) to service_role;
grant execute on function public.data_finish_snapshot(bigint, text, jsonb, text) to service_role;

/* ------------------------------------------------------------------ */
/* The snapshots bucket (Supabase Storage; skipped where it is absent) */
/* ------------------------------------------------------------------ */

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('snapshots', 'snapshots', true) on conflict do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'snapshots_read') then
      execute $p$create policy snapshots_read on storage.objects for select to anon, authenticated, service_role
        using (bucket_id = 'snapshots')$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'snapshots_write') then
      execute $p$create policy snapshots_write on storage.objects for all to service_role
        using (bucket_id = 'snapshots') with check (bucket_id = 'snapshots')$p$;
    end if;
  end if;
end;
$$;
