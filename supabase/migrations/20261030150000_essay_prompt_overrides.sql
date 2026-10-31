-- Essay prompts read from the application form by a person, through the admin console (specs/product/essays/
-- sources.md "The hand read"; owner, 2026-10-30: "if I'm making changes in the admin page, I'd want them to take
-- effect right away, not be committed and pushed to the site through git").
--
-- * One row per college and cycle: the ConfirmedRecord the console built (scripts/lib/essay-prompts/store.mts), who
--   read it, and when. The advisor overlays it on the dataset at request time (lib/essays/overrides.ts), so a save
--   shows on the Essays tab, the picker, the package, and the essays move on the next page load. A nightly export
--   (scripts/export-essay-confirmed.mts) writes the rows into data/essay-prompts/confirmed/ and opens the usual data
--   PR, so the public college pages, the lineage checks, and the citation trail catch up on their own.
-- * Nothing here is a secret: the prompts are the college's public questions. Every request may read the table.
-- * No write policy: the only writes are admin_set_essay_prompts() and admin_delete_essay_prompts(), which check
--   is_admin() and log `essays.set` / `essays.delete` with the college and cycle.

create table public.essay_prompt_overrides (
  unit_id    text not null check (unit_id ~ '^[0-9]{1,12}$'),
  cycle      text not null check (cycle ~ '^[0-9]{4}-[0-9]{2}$'),
  -- The ConfirmedRecord as JSON (status, form, read_on, reader, prompts, choose, note); the console validates it
  -- before the call and the export validates it again.
  record     jsonb not null check (jsonb_typeof(record) = 'object'),
  status     text not null check (status in ('published', 'none')),
  read_on    date not null,
  reader     text not null check (reader ~ '^[A-Za-z]{1,4}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (unit_id, cycle)
);

alter table public.essay_prompt_overrides enable row level security;

create policy essay_prompt_overrides_read on public.essay_prompt_overrides for select to anon, authenticated using (true);
grant select on public.essay_prompt_overrides to anon, authenticated, service_role;

-- Save one college's prompts for one cycle (replace whole). The record's own unit_id, cycle, status, read_on, and
-- reader must agree with the arguments, so the row and its JSON never drift apart.
create function public.admin_set_essay_prompts(p_unit text, p_cycle text, p_record jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := p_record ->> 'status';
  v_read_on date;
  v_reader text := p_record ->> 'reader';
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if jsonb_typeof(p_record) <> 'object' then raise exception 'invalid_record' using errcode = '22023'; end if;
  if (p_record ->> 'unit_id') is distinct from p_unit or (p_record ->> 'cycle') is distinct from p_cycle then
    raise exception 'record_mismatch' using errcode = '22023';
  end if;
  if v_status not in ('published', 'none') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if (p_record ->> 'source') is distinct from 'form-by-hand' or (p_record ->> 'confidence') is distinct from 'confirmed' then
    raise exception 'invalid_record' using errcode = '22023';
  end if;
  begin
    v_read_on := (p_record ->> 'read_on')::date;
  exception when others then
    raise exception 'invalid_read_on' using errcode = '22023';
  end;
  if v_read_on > current_date then raise exception 'invalid_read_on' using errcode = '22023'; end if;
  if v_status = 'published' and jsonb_array_length(coalesce(p_record -> 'prompts', '[]'::jsonb)) = 0 then
    raise exception 'no_prompts' using errcode = '22023';
  end if;
  insert into public.essay_prompt_overrides (unit_id, cycle, record, status, read_on, reader, updated_at, updated_by)
  values (p_unit, p_cycle, p_record, v_status, v_read_on, v_reader, now(), auth.uid())
  on conflict (unit_id, cycle) do update
    set record = excluded.record, status = excluded.status, read_on = excluded.read_on, reader = excluded.reader,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.admin_log_write('essays.set', null, p_unit, jsonb_build_object('cycle', p_cycle, 'status', v_status, 'prompts', jsonb_array_length(coalesce(p_record -> 'prompts', '[]'::jsonb))));
end;
$$;

revoke execute on function public.admin_set_essay_prompts(text, text, jsonb) from public, anon;
grant execute on function public.admin_set_essay_prompts(text, text, jsonb) to authenticated, service_role;

-- Remove one college's hand-read prompts for one cycle (the reader's own page takes over again, if it has one).
create function public.admin_delete_essay_prompts(p_unit text, p_cycle text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  delete from public.essay_prompt_overrides where unit_id = p_unit and cycle = p_cycle;
  perform public.admin_log_write('essays.delete', null, p_unit, jsonb_build_object('cycle', p_cycle));
end;
$$;

revoke execute on function public.admin_delete_essay_prompts(text, text) from public, anon;
grant execute on function public.admin_delete_essay_prompts(text, text) to authenticated, service_role;
