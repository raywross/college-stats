-- Admin console speed: the review queue's read model (specs/product/admin-speed.md "Wave 2", as built in wave 1;
-- specs/data-platform/change-sets.md "The review queue's read model"). Apply after
-- 20261109120000_high_school_bundle.sql (SQL Editor, dev first, then prod). Tested against real Postgres (PGlite + the
-- auth stub) in tests/review-items.test.mts.
--
-- Why: the console read `reported.review_queue` (21,977 documents, 11 MB) whole in 22 sequential pages to answer small
-- questions (how many are open, which are unreachable, one college's rows), and its cache check ("the newest write to
-- the collection") was a sequential scan of data_documents (230 ms idle, 2 s under load).
--
-- * data_documents_collection_updated: the newest-write check becomes an index lookup.
-- * public.review_items: one row per queue document, kept current by a trigger on data_documents. The documents stay
--   the write path and the version history (data_write_documents, the pipeline, the Steward, admin_data_resolve_review
--   all write documents, unchanged); this table only reads. The trigger never raises: a document it can't read (a body
--   that isn't an object, `failures` that isn't an array) is left out with a warning and the document write commits.
-- * review_items_light(p_status): the whole queue (or one status) as one JSON array without the C1 `extraction`, in
--   one round trip instead of 22. review_items_counts(): the counts and the newest write, the console's cache key.
--
-- Additive and idempotent: safe to apply before or after the code deploys (lib/admin/review-queue.ts falls back to
-- the documents when the table or a function is missing), and safe to apply twice. A `truncate` of data_documents
-- fires no row trigger; nothing truncates it (the store deletes documents through data_write_documents).

/* ------------------------------------------------------------------ */
/* The newest-write index                                              */
/* ------------------------------------------------------------------ */

create index if not exists data_documents_collection_updated on public.data_documents (collection, updated_at desc);

/* ------------------------------------------------------------------ */
/* review_items                                                        */
/* ------------------------------------------------------------------ */

create table if not exists public.review_items (
  key        text primary key,                       -- unit|edition|code (lib/reported.ts reviewKey)
  unit_id    text not null,
  edition    text,                                   -- null when the key's middle part is empty
  code       text,                                   -- null when the key's last part is empty
  sha256     text,
  status     text not null check (status in ('open', 'accepted', 'rejected')),  -- from body.resolved, 'open' when absent
  checks     text[] not null default '{}',           -- distinct body.failures[].check, in order
  queued     date,                                   -- body.queued, null when it doesn't parse
  body       jsonb not null,                         -- the whole document
  version    integer not null,                       -- data_documents.version
  updated_at timestamptz not null                    -- data_documents.updated_at
);
create index if not exists review_items_status_queued on public.review_items (status, queued desc);
create index if not exists review_items_unit on public.review_items (unit_id);
create index if not exists review_items_updated on public.review_items (updated_at desc);
create index if not exists review_items_checks on public.review_items using gin (checks);

-- Select for everyone, as data_documents_read (the queue's documents select for everyone today; nothing in it is
-- personal). No write policy: only the security-definer sync below writes.
alter table public.review_items enable row level security;
drop policy if exists review_items_read on public.review_items;
create policy review_items_read on public.review_items for select to anon, authenticated using (true);
revoke all on public.review_items from public, anon, authenticated, service_role;
grant select on public.review_items to anon, authenticated, service_role;

-- A date from text, or null when it doesn't parse ("2026-10-03", "2026-10-03T12:00:00Z"; "soon" and "" are null).
create or replace function public.review_items_date(p_text text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or p_text !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return substr(p_text, 1, 10)::date;
exception when others then
  return null;
end;
$$;

-- Writes one queue document's row: delete when the body is null, else upsert. The trigger and the backfill both call
-- it, so they give the same row. Never raises: a body it can't read is left out (its old row removed) with a warning.
create or replace function public.review_items_put(p_key text, p_body jsonb, p_version integer, p_updated_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failures jsonb;
  v_checks text[];
  v_resolved text;
begin
  begin
    if p_body is null then
      delete from public.review_items r where r.key = p_key;
      return;
    end if;
    if jsonb_typeof(p_body) <> 'object' then
      raise exception 'body is not an object';
    end if;
    v_failures := p_body -> 'failures';
    if v_failures is null or jsonb_typeof(v_failures) = 'null' then
      v_checks := '{}';
    elsif jsonb_typeof(v_failures) <> 'array' then
      raise exception 'failures is not an array';
    else
      select coalesce(array_agg(x.c order by x.o), '{}') into v_checks
      from (
        select f.value ->> 'check' as c, min(f.ordinality) as o
        from jsonb_array_elements(v_failures) with ordinality as f(value, ordinality)
        where f.value ->> 'check' is not null
        group by 1
      ) x;
    end if;
    v_resolved := p_body ->> 'resolved';

    insert into public.review_items as r (key, unit_id, edition, code, sha256, status, checks, queued, body, version, updated_at)
    values (
      p_key,
      coalesce(nullif(p_body ->> 'unit_id', ''), split_part(p_key, '|', 1)),
      nullif(split_part(p_key, '|', 2), ''),
      nullif(split_part(p_key, '|', 3), ''),
      p_body ->> 'sha256',
      case when v_resolved in ('accepted', 'rejected') then v_resolved else 'open' end,
      v_checks,
      public.review_items_date(p_body ->> 'queued'),
      p_body,
      p_version,
      p_updated_at
    )
    on conflict (key) do update
      set unit_id = excluded.unit_id, edition = excluded.edition, code = excluded.code, sha256 = excluded.sha256,
          status = excluded.status, checks = excluded.checks, queued = excluded.queued, body = excluded.body,
          version = excluded.version, updated_at = excluded.updated_at;
  exception when others then
    raise warning 'review_items_sync: % % (%)', sqlstate, sqlerrm, p_key;
    begin
      delete from public.review_items r where r.key = p_key;
    exception when others then
      null;
    end;
  end;
end;
$$;

-- The trigger: every write to a `reported.review_queue` document. Two triggers, because an insert trigger's WHEN can't
-- read OLD and a delete trigger's can't read NEW.
create or replace function public.review_items_sync_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'DELETE' then
      perform public.review_items_put(old.key, null, null, null);
    else
      perform public.review_items_put(new.key, new.body::jsonb, new.version, new.updated_at);
    end if;
  exception when others then
    raise warning 'review_items_sync: % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists review_items_sync on public.data_documents;
create trigger review_items_sync
  after insert or update on public.data_documents
  for each row when (new.collection = 'reported.review_queue')
  execute function public.review_items_sync_row();

drop trigger if exists review_items_sync_delete on public.data_documents;
create trigger review_items_sync_delete
  after delete on public.data_documents
  for each row when (old.collection = 'reported.review_queue')
  execute function public.review_items_sync_row();

-- Nobody calls these directly: the trigger runs them as their owner.
revoke all on function public.review_items_put(text, jsonb, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.review_items_sync_row() from public, anon, authenticated, service_role;
revoke all on function public.review_items_date(text) from public, anon, authenticated, service_role;

-- The backfill: every current queue document, through the same function as the trigger (rows already there are
-- replaced, so applying this file twice is harmless). Rows whose document is gone are removed.
select public.review_items_put(d.key, d.body::jsonb, d.version, d.updated_at)
from public.data_documents d
where d.collection = 'reported.review_queue';

delete from public.review_items r
where not exists (select 1 from public.data_documents d where d.collection = 'reported.review_queue' and d.key = r.key);

/* ------------------------------------------------------------------ */
/* The console's reads                                                 */
/* ------------------------------------------------------------------ */

-- The items of a status (null: every status) as one JSON array in key order: each element the document minus the
-- fields no whole-queue reader uses (lib/admin/review-queue.ts `LIGHT_DROPPED`; what stays is `LIGHT_FIELDS`: the
-- clusters, the kinds, and Colleges to review read `unit_id`, `name`, `failures`, `code`, `edition`, `sha256`,
-- `resolved`), plus `key`. Accept reads its items whole, by key through the documents. A field the document doesn't
-- have stays absent. The subtraction is one jsonb operation per row: measured on dev 2026-11-10, a per-row
-- `jsonb_each` filter took 3.8–6.6 s for 12.5 MB; this form 0.32 s in Postgres for 8.3 MB.
create or replace function public.review_items_light(p_status text default 'open')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      (r.body - array['extraction', 'urls', 'entering_term', 'queued', 'run', 'value', 'resolved_on', 'resolved_note'])
        || jsonb_build_object('key', r.key)
      order by r.key
    ),
    '[]'::jsonb
  )
  from public.review_items r
  where p_status is null or r.status = p_status;
$$;

-- {"open", "accepted", "rejected", "new_week" (open items queued in the last seven days), "newest" (the newest write,
-- as an ISO timestamp; null when empty)}: the Inbox's tile and the console's cache key in one call.
create or replace function public.review_items_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'open', count(*) filter (where r.status = 'open'),
    'accepted', count(*) filter (where r.status = 'accepted'),
    'rejected', count(*) filter (where r.status = 'rejected'),
    'new_week', count(*) filter (where r.status = 'open' and r.queued >= current_date - 7),
    'newest', max(r.updated_at)
  )
  from public.review_items r;
$$;

revoke all on function public.review_items_light(text) from public;
revoke all on function public.review_items_counts() from public;
grant execute on function public.review_items_light(text) to anon, authenticated, service_role;
grant execute on function public.review_items_counts() to anon, authenticated, service_role;
