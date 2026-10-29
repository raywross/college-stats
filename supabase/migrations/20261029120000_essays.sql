-- Essays, the workspace (specs/product/essays/workspace.md "The model", "Rules"): a student's drafts, their versions,
-- the prompts one draft serves, and the comment thread a guardian or the student leaves on a draft.
--
-- Rules the policies encode (owner, 2026-10-28: "student drafts only," and parents and advisors review and comment):
-- * Only the student writes: `essays`, `essay_versions`, and `essay_links` are written by the signed-in user whose own
--   student record the draft belongs to (is_own_student). A managed student without an account has no drafts.
-- * A guardian in the student's household reads every draft, every version, every link, and every comment
--   (can_read_student: the same rule the plan's tables and the viewer bundle read through), and writes only
--   `essay_comments`. A counselor with a grant joins this rule once the portal exists; `author_role` is ready for it.
-- * Nobody else sees anything. Versions are insert-only (no update, no delete: a restore is a new version).
-- * At most 200 drafts per student (a trigger; error `essay_limit`).
-- * Comments: the author is always the caller (a trigger sets author_id and author_role); only the student resolves
--   one (an update of resolved_at alone); the author deletes their own.
-- * Never served to anon; the public Data API (/api/v1, lib/api/**) reads none of these tables.
--
-- Tested against real Postgres (PGlite + the auth stub) in tests/essays-policies.test.mts.
-- Apply in the Supabase SQL Editor (dev first, then prod), after 20261005120000_accounts.sql.

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

create table public.essays (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  prompt_ref text not null default 'free' check (char_length(prompt_ref) between 1 and 200),
  title      text not null default '' check (char_length(title) <= 200),
  body       text not null default '' check (char_length(body) <= 100000),
  count_kind text not null default 'words' check (count_kind in ('words', 'characters')),
  count      integer not null default 0 check (count >= 0),
  limit_max  integer check (limit_max is null or limit_max > 0),
  limit_min  integer check (limit_min is null or limit_min >= 0),
  status     text not null default 'draft' check (status in ('draft', 'ready', 'submitted')),
  kind       text not null default 'free' check (kind in ('personal', 'essay', 'short_answer', 'why_us', 'program', 'activity', 'optional', 'other', 'free')),
  base_id    uuid references public.essays (id) on delete set null,
  created    timestamptz not null default now(),
  updated    timestamptz not null default now(),
  constraint essays_base_not_self check (base_id is null or base_id <> id)
);

create index essays_student_idx on public.essays (student_id, updated desc);
create index essays_base_idx on public.essays (base_id) where base_id is not null;

create table public.essay_versions (
  id       uuid primary key default gen_random_uuid(),
  essay_id uuid not null references public.essays (id) on delete cascade,
  body     text not null check (char_length(body) <= 100000),
  count    integer not null default 0 check (count >= 0),
  source   text not null check (source in ('typed', 'pasted', 'uploaded', 'docs', 'restored')),
  label    text check (label is null or char_length(label) <= 80),
  created  timestamptz not null default now()
);

create index essay_versions_essay_idx on public.essay_versions (essay_id, created desc);

-- One draft serving several prompts (the same main essay for every Common App college; one "why us" for two).
create table public.essay_links (
  essay_id   uuid not null references public.essays (id) on delete cascade,
  prompt_ref text not null check (char_length(prompt_ref) between 1 and 200),
  created    timestamptz not null default now(),
  primary key (essay_id, prompt_ref)
);

create index essay_links_ref_idx on public.essay_links (prompt_ref);

create table public.essay_comments (
  id          uuid primary key default gen_random_uuid(),
  essay_id    uuid not null references public.essays (id) on delete cascade,
  version_id  uuid references public.essay_versions (id) on delete set null,
  author_id   uuid references auth.users (id) on delete set null,
  -- Who wrote it, as the rule saw it at the time: the student, a guardian, or (once the portal exists) a counselor.
  author_role text not null default 'guardian' check (author_role in ('student', 'guardian', 'counselor')),
  -- A span in the draft: {paragraph, start, end} (0-based paragraph, character offsets in it); null for the whole draft.
  anchor      jsonb check (anchor is null or jsonb_typeof(anchor) = 'object'),
  body        text not null check (char_length(body) between 1 and 4000),
  created     timestamptz not null default now(),
  resolved_at timestamptz
);

create index essay_comments_essay_idx on public.essay_comments (essay_id, created);

/* ------------------------------------------------------------------ */
/* Helpers (security definer: narrow, only ever about auth.uid())      */
/* ------------------------------------------------------------------ */

-- The draft is the signed-in user's own (their own student record's).
create function public.is_own_essay(p_essay uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.essays e where e.id = p_essay and public.is_own_student(e.student_id))
$$;

-- The signed-in user may read the draft: its student's own account, or a guardian of that student's household.
create function public.can_read_essay(p_essay uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.essays e where e.id = p_essay and public.can_read_student(e.student_id))
$$;

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

-- 200 drafts per student (workspace.md "Files": the per-student limit), and a base draft from the same student.
create function public.essays_guard_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.essays e where e.student_id = new.student_id) >= 200 then
    raise exception 'essay_limit' using errcode = '23514';
  end if;
  if new.base_id is not null and not exists (select 1 from public.essays b where b.id = new.base_id and b.student_id = new.student_id) then
    raise exception 'essay_base' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger essays_guard_insert before insert on public.essays
  for each row execute function public.essays_guard_insert();

-- A draft never changes owner or creation time; `updated` follows every write; a base stays the same student's.
create function public.essays_guard_update() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.student_id := old.student_id;
  new.created := old.created;
  new.updated := now();
  if new.base_id is not null and new.base_id is distinct from old.base_id
     and not exists (select 1 from public.essays b where b.id = new.base_id and b.student_id = new.student_id) then
    raise exception 'essay_base' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger essays_guard_update before update on public.essays
  for each row execute function public.essays_guard_update();

-- The comment's author is the caller, and the role is what the rule saw: the student's own account or a guardian.
-- A version named on the comment must belong to the same draft.
create function public.essay_comments_set_author() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.author_id := auth.uid();
  new.author_role := case when public.is_own_essay(new.essay_id) then 'student' else 'guardian' end;
  new.resolved_at := null;
  new.created := now();
  if new.version_id is not null and not exists (select 1 from public.essay_versions v where v.id = new.version_id and v.essay_id = new.essay_id) then
    raise exception 'essay_version' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger essay_comments_set_author before insert on public.essay_comments
  for each row execute function public.essay_comments_set_author();

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.essays enable row level security;
alter table public.essay_versions enable row level security;
alter table public.essay_links enable row level security;
alter table public.essay_comments enable row level security;

create policy "Essays: read" on public.essays for select to authenticated
  using (public.can_read_student(student_id));
create policy "Essays: student creates" on public.essays for insert to authenticated
  with check (public.is_own_student(student_id));
create policy "Essays: student edits" on public.essays for update to authenticated
  using (public.is_own_student(student_id))
  with check (public.is_own_student(student_id));
create policy "Essays: student deletes" on public.essays for delete to authenticated
  using (public.is_own_student(student_id));

create policy "Essay versions: read" on public.essay_versions for select to authenticated
  using (public.can_read_essay(essay_id));
create policy "Essay versions: student adds" on public.essay_versions for insert to authenticated
  with check (public.is_own_essay(essay_id));
-- No update or delete policy: a version is never changed or removed (deleting the draft removes its versions).

create policy "Essay links: read" on public.essay_links for select to authenticated
  using (public.can_read_essay(essay_id));
create policy "Essay links: student adds" on public.essay_links for insert to authenticated
  with check (public.is_own_essay(essay_id));
create policy "Essay links: student removes" on public.essay_links for delete to authenticated
  using (public.is_own_essay(essay_id));

create policy "Essay comments: read" on public.essay_comments for select to authenticated
  using (public.can_read_essay(essay_id));
create policy "Essay comments: readers comment" on public.essay_comments for insert to authenticated
  with check (public.can_read_essay(essay_id));
-- Only the student resolves (the column grant below limits the update to resolved_at).
create policy "Essay comments: student resolves" on public.essay_comments for update to authenticated
  using (public.is_own_essay(essay_id))
  with check (public.is_own_essay(essay_id));
create policy "Essay comments: author deletes" on public.essay_comments for delete to authenticated
  using (author_id = auth.uid() and public.can_read_essay(essay_id));

/* ------------------------------------------------------------------ */
/* Privileges                                                          */
/* ------------------------------------------------------------------ */

revoke all on public.essays, public.essay_versions, public.essay_links, public.essay_comments from public, anon, authenticated;
grant select, insert, update, delete on public.essays to authenticated;
grant select, insert on public.essay_versions to authenticated;
grant select, insert, delete on public.essay_links to authenticated;
grant select, insert, delete on public.essay_comments to authenticated;
grant update (resolved_at) on public.essay_comments to authenticated;
grant all on public.essays, public.essay_versions, public.essay_links, public.essay_comments to service_role;

revoke execute on function public.is_own_essay(uuid) from public, anon;
revoke execute on function public.can_read_essay(uuid) from public, anon;
grant execute on function public.is_own_essay(uuid) to authenticated, service_role;
grant execute on function public.can_read_essay(uuid) to authenticated, service_role;
revoke execute on function public.essays_guard_insert() from public, anon, authenticated;
revoke execute on function public.essays_guard_update() from public, anon, authenticated;
revoke execute on function public.essay_comments_set_author() from public, anon, authenticated;
