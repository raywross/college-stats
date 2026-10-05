-- Saved lists (specs/product/saved-lists.md): lists, list_items, list_notes, row-level security using
-- can_read_student/can_edit_student (20261005120000_accounts.sql), a share link via a security-definer anon
-- function, and a trigger that keeps a student's follows (20261005140000_follows.sql) in step with their lists.
--
-- Ownership: a list belongs to a student (student_id), not a user, so a guardian with can_edit can manage it the
-- same way they manage the rest of the student's record. One list per student is the default (is_default) and
-- can't be deleted; extra lists are allowed (no tier gating yet).
--
-- Requires 20261005120000_accounts.sql and 20261005140000_follows.sql. Apply in the Supabase SQL Editor (dev first,
-- then prod). Tested in tests/lists-policies.test.mts.

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

create table public.lists (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  is_default       boolean not null default false,
  share_enabled    boolean not null default false,
  share_token_hash text unique,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created          timestamptz not null default now()
);

-- Only one default list per student (a partial unique index, since is_default = false repeats).
create unique index lists_one_default_idx on public.lists (student_id) where is_default;
create index lists_student_idx on public.lists (student_id);

create table public.list_items (
  id              uuid primary key default gen_random_uuid(),
  list_id         uuid not null references public.lists (id) on delete cascade,
  unit_id         text not null check (unit_id ~ '^[0-9]{1,10}$'),
  category        text not null default 'unsorted' check (category in ('reach', 'target', 'likely', 'unsorted')),
  status          text not null default 'considering' check (status in ('considering', 'applying', 'applied', 'decided')),
  outcome         text check (outcome in ('admitted', 'denied', 'waitlisted', 'deferred')),
  round           text check (round in ('ed', 'ed2', 'ea', 'rea', 'rd', 'rolling')),
  position        integer not null default 0,
  added_by        uuid default auth.uid() references auth.users (id) on delete set null,
  added_at        timestamptz not null default now(),
  decision_date   date,
  -- The student's own deadline, when the college's reported dates don't cover their round (a display override, not
  -- a new source of truth: lib/list-rules.ts prefers the college's data when it has it).
  deadline_text   text check (char_length(deadline_text) <= 200),
  deadline_date   date,
  enrolling       boolean not null default false,
  constraint list_items_unique unique (list_id, unit_id),
  constraint list_items_outcome_shape check (outcome is null or status = 'decided')
);

create index list_items_list_idx on public.list_items (list_id, position);

create table public.list_notes (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.list_items (id) on delete cascade,
  author_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  -- Hidden from everyone but the author (spec: "the student's private notes are student-only" — a guardian's own
  -- private note is likewise hidden from the student and other guardians).
  private    boolean not null default false,
  created    timestamptz not null default now()
);

create index list_notes_item_idx on public.list_notes (item_id, created);

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.list_notes enable row level security;

create policy "Lists: read" on public.lists for select to authenticated
  using (public.can_read_student(student_id));
create policy "Lists: create" on public.lists for insert to authenticated
  with check (public.can_edit_student(student_id));
create policy "Lists: update" on public.lists for update to authenticated
  using (public.can_edit_student(student_id)) with check (public.can_edit_student(student_id));
-- The default list can't be deleted (there's always one list to add to); extra lists can.
create policy "Lists: delete extra lists" on public.lists for delete to authenticated
  using (public.can_edit_student(student_id) and not is_default);

create policy "Items: read" on public.list_items for select to authenticated
  using (exists (select 1 from public.lists l where l.id = list_id and public.can_read_student(l.student_id)));
create policy "Items: create" on public.list_items for insert to authenticated
  with check (exists (select 1 from public.lists l where l.id = list_id and public.can_edit_student(l.student_id)));
create policy "Items: update" on public.list_items for update to authenticated
  using (exists (select 1 from public.lists l where l.id = list_id and public.can_edit_student(l.student_id)))
  with check (exists (select 1 from public.lists l where l.id = list_id and public.can_edit_student(l.student_id)));
create policy "Items: delete" on public.list_items for delete to authenticated
  using (exists (select 1 from public.lists l where l.id = list_id and public.can_edit_student(l.student_id)));

-- Notes: anyone who can read the student's data reads a non-private note; a private note only its author reads.
create policy "Notes: read" on public.list_notes for select to authenticated
  using (
    author_id = auth.uid()
    or (
      not private
      and exists (
        select 1 from public.list_items li join public.lists l on l.id = li.list_id
        where li.id = item_id and public.can_read_student(l.student_id)
      )
    )
  );
create policy "Notes: create" on public.list_notes for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.list_items li join public.lists l on l.id = li.list_id
      where li.id = item_id and public.can_edit_student(l.student_id)
    )
  );
create policy "Notes: update own" on public.list_notes for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "Notes: delete own" on public.list_notes for delete to authenticated
  using (author_id = auth.uid());

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that.
revoke all on public.lists, public.list_items, public.list_notes from anon, authenticated;
grant select, insert, update, delete on public.lists to authenticated;
grant select, insert, update, delete on public.list_items to authenticated;
grant select, insert, update, delete on public.list_notes to authenticated;
grant all on public.lists, public.list_items, public.list_notes to service_role;

/* ------------------------------------------------------------------ */
/* Follows trigger (specs/product/follow-colleges.md "List follows")   */
/* ------------------------------------------------------------------ */

-- Adding a college to any of a student's lists follows it for the student's own user (never the guardian who added
-- it, and never for a managed student who has no user yet); `on conflict do nothing` never downgrades a manual
-- follow. Removing it from a list unfollows it only when it's on none of that student's lists, and only the 'list'
-- row (a manual follow survives).
create function public.list_items_sync_follows() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_student uuid;
begin
  if tg_op = 'INSERT' then
    select l.student_id, s.user_id into v_student, v_user
    from public.lists l join public.students s on s.id = l.student_id
    where l.id = new.list_id;
    if v_user is not null then
      insert into public.follows (user_id, unit_id, source) values (v_user, new.unit_id, 'list')
      on conflict (user_id, unit_id) do nothing;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    select l.student_id, s.user_id into v_student, v_user
    from public.lists l join public.students s on s.id = l.student_id
    where l.id = old.list_id;
    if v_user is not null and not exists (
      select 1 from public.list_items li join public.lists l2 on l2.id = li.list_id
      where l2.student_id = v_student and li.unit_id = old.unit_id
    ) then
      delete from public.follows where user_id = v_user and unit_id = old.unit_id and source = 'list';
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger list_items_sync_follows_insert
after insert on public.list_items
for each row execute function public.list_items_sync_follows();

create trigger list_items_sync_follows_delete
after delete on public.list_items
for each row execute function public.list_items_sync_follows();

revoke execute on function public.list_items_sync_follows() from public, anon, authenticated;

/* ------------------------------------------------------------------ */
/* Share links (/l/[token]): hashed like invitations                   */
/* ------------------------------------------------------------------ */

-- Turns sharing on (returns a new token, shown once) or off for a list the caller can edit. Replaces any
-- previous token, so an old link stops working the moment a new one is made.
create function public.set_list_share(p_list uuid, p_enabled boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_token text;
begin
  select student_id into v_student from public.lists where id = p_list;
  if v_student is null or not public.can_edit_student(v_student) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_enabled then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update public.lists set share_enabled = true, share_token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
      where id = p_list;
    return v_token;
  else
    update public.lists set share_enabled = false, share_token_hash = null where id = p_list;
    return null;
  end if;
end;
$$;

-- What /l/[token] shows: the list's name and its colleges with category, round, and position only — never notes,
-- status, or outcomes (specs/product/saved-lists.md "Share"). Null when the token is unknown or sharing is off.
create function public.list_share_preview(p_token text) returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'list_id', l.id,
    'list_name', l.name,
    'items', coalesce((
      select json_agg(json_build_object('unit_id', li.unit_id, 'category', li.category, 'round', li.round) order by li.position)
      from public.list_items li where li.list_id = l.id
    ), '[]'::json)
  )
  from public.lists l
  where l.share_enabled and l.share_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

revoke execute on function public.set_list_share(uuid, boolean) from public, anon;
revoke execute on function public.list_share_preview(text) from public;
grant execute on function public.set_list_share(uuid, boolean) to authenticated;
grant execute on function public.list_share_preview(text) to anon, authenticated;
