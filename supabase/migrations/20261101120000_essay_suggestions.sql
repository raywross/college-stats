-- Essays, part 7: editors (specs/product/essays/editors.md "The model"): a reader of a draft who isn't the student (a
-- guardian in the household today, a counselor with a grant once the portal exists) proposes a whole new text for the
-- draft; the student sees it as changes and accepts or rejects each one. Nothing here writes the draft: the student's
-- own `update` on `essays` does, in the Server Action that applies the accepted changes (lib/essays/store.ts
-- decideSuggestion).
--
-- Rules the policies and the triggers encode:
-- * Suggesting needs only read access (owner assumption 1): a reader of the draft who isn't the student inserts
--   (can_read_essay and not is_own_essay); no `can_edit` on the membership, because a suggestion changes nothing
--   until the student accepts it. The student never suggests on their own draft (the insert trigger refuses it too).
-- * The author is always the caller (the insert trigger sets author_id and author_role, whatever the row claims), and
--   a new suggestion is always open with no decisions.
-- * One open suggestion per author per draft (a partial unique index).
-- * The author changes their own suggestion's proposed_body and note, or withdraws it, only while it is open and the
--   student hasn't decided anything; the student changes only decisions, status (to decided) and decided_at; nobody
--   changes anything else (the update trigger raises).
-- * base_body holds the text the editor started from, so the changes never shift as the student writes; base_version_id
--   names the newest version when its text was that one (else null). The spec's "As {first} read it" version is not
--   made: the editor can't insert a version, and base_body serves.
-- * No delete: a withdrawn suggestion is kept (the spec's thirty-day purge has no purge function to join yet); deleting
--   the draft deletes its suggestions.
-- * essay_versions.source gains 'suggested' (a version made by accepting changes, or the reader's fix).
-- * Never served to anon; the public Data API (/api/v1, lib/api/**) reads none of these tables.
--
-- Tested against real Postgres (PGlite + the auth stub) in tests/essays-policies.test.mts.
-- Apply in the Supabase SQL Editor (dev first, then prod), after 20261029120000_essays.sql.

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

create table public.essay_suggestions (
  id              uuid primary key default gen_random_uuid(),
  essay_id        uuid not null references public.essays (id) on delete cascade,
  base_version_id uuid references public.essay_versions (id) on delete set null,
  base_body       text not null default '' check (char_length(base_body) <= 100000),
  author_id       uuid references auth.users (id) on delete set null,
  author_role     text not null default 'guardian' check (author_role in ('guardian', 'counselor')),
  proposed_body   text not null check (char_length(proposed_body) <= 100000),
  note            text check (note is null or char_length(note) <= 2000),
  status          text not null default 'open' check (status in ('open', 'decided', 'withdrawn')),
  -- {change_key: 'accepted' | 'rejected'}; a key absent is undecided (lib/essays/suggestions.ts changesBetween).
  decisions       jsonb not null default '{}'::jsonb check (jsonb_typeof(decisions) = 'object'),
  created         timestamptz not null default now(),
  updated         timestamptz not null default now(),
  decided_at      timestamptz
);

create index essay_suggestions_essay_idx on public.essay_suggestions (essay_id, status);
create unique index essay_suggestions_one_open on public.essay_suggestions (essay_id, author_id) where status = 'open';

alter table public.essay_versions drop constraint essay_versions_source_check;
alter table public.essay_versions add constraint essay_versions_source_check
  check (source in ('typed', 'pasted', 'uploaded', 'docs', 'restored', 'suggested'));

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

-- The author is the caller; the role is guardian (the counselor portal's grant will set counselor); a new suggestion
-- is open and undecided; the base version, when named, is the same draft's. The student never suggests on their own.
create function public.essay_suggestions_set_author() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_own_essay(new.essay_id) then
    raise exception 'essay_suggestion_own' using errcode = '42501', detail = 'the student doesn''t suggest on their own draft';
  end if;
  new.author_id := auth.uid();
  new.author_role := 'guardian';
  new.status := 'open';
  new.decisions := '{}'::jsonb;
  new.decided_at := null;
  new.created := now();
  new.updated := now();
  if new.base_version_id is not null and not exists (select 1 from public.essay_versions v where v.id = new.base_version_id and v.essay_id = new.essay_id) then
    raise exception 'essay_version' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger essay_suggestions_set_author before insert on public.essay_suggestions
  for each row execute function public.essay_suggestions_set_author();

-- Who may change what (the policy only says the caller reads the draft):
-- * the student: decisions, status (to decided) and decided_at, while the suggestion is open;
-- * the author: proposed_body, note, and status to withdrawn, while it is open and nothing is decided;
-- * nobody: the draft, the base, the author, or the creation time.
create function public.essay_suggestions_guard_update() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated := now();
  -- The service role (maintenance, no signed-in user) is not held to the readers' rules.
  if auth.uid() is null then
    return new;
  end if;
  if new.essay_id is distinct from old.essay_id or new.base_version_id is distinct from old.base_version_id
     or new.base_body is distinct from old.base_body or new.author_id is distinct from old.author_id
     or new.author_role is distinct from old.author_role or new.created is distinct from old.created then
    raise exception 'essay_suggestion_fixed' using errcode = '42501';
  end if;

  if public.is_own_essay(old.essay_id) then
    if new.proposed_body is distinct from old.proposed_body or new.note is distinct from old.note then
      raise exception 'essay_suggestion_student' using errcode = '42501', detail = 'the student decides; the proposal is the author''s';
    end if;
    if old.status <> 'open' or new.status not in ('open', 'decided') then
      raise exception 'essay_suggestion_status' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.author_id is not distinct from auth.uid() then
    if old.status <> 'open' or old.decisions <> '{}'::jsonb then
      raise exception 'essay_suggestion_decided' using errcode = '42501', detail = 'the student has started deciding';
    end if;
    if new.decisions is distinct from old.decisions or new.decided_at is distinct from old.decided_at or new.status not in ('open', 'withdrawn') then
      raise exception 'essay_suggestion_author' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'essay_suggestion_not_yours' using errcode = '42501';
end;
$$;

create trigger essay_suggestions_guard_update before update on public.essay_suggestions
  for each row execute function public.essay_suggestions_guard_update();

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.essay_suggestions enable row level security;

create policy "Essay suggestions: read" on public.essay_suggestions for select to authenticated
  using (public.can_read_essay(essay_id));
create policy "Essay suggestions: readers suggest" on public.essay_suggestions for insert to authenticated
  with check (public.can_read_essay(essay_id) and not public.is_own_essay(essay_id));
-- The trigger above decides which columns the author and the student may change.
create policy "Essay suggestions: author and student update" on public.essay_suggestions for update to authenticated
  using (public.can_read_essay(essay_id))
  with check (public.can_read_essay(essay_id));
-- No delete policy: a withdrawn suggestion is kept; deleting the draft removes its suggestions.

/* ------------------------------------------------------------------ */
/* Privileges                                                          */
/* ------------------------------------------------------------------ */

revoke all on public.essay_suggestions from public, anon, authenticated;
grant select, insert, update on public.essay_suggestions to authenticated;
grant all on public.essay_suggestions to service_role;

revoke execute on function public.essay_suggestions_set_author() from public, anon, authenticated;
revoke execute on function public.essay_suggestions_guard_update() from public, anon, authenticated;
