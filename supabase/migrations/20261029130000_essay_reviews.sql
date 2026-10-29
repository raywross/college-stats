-- Essays, the reader's notes (specs/product/essays/reviewer.md "When it runs and what it keeps", "The guard"): one row
-- per review of a version of a draft (the method, the model, the token usage, never the prompt or the draft), and the
-- notes that passed the guard, each with the student's own state (open, done, ignored).
--
-- Rules the policies and functions encode:
-- * Only the student asks for a review, and only through record_essay_review (called by POST /api/essays/review after
--   the model call, with the student's own session): there is no insert policy, so the Data API can't write a review
--   or a note directly. The function checks the draft is the caller's own, the version is the draft's, the caps, and
--   the notes' shape, all in one transaction under a per-student lock.
-- * The caps (reviewer.md: "at most five reviews per draft per day and fifty per student per day"; the build brief:
--   "sixty per draft per cycle"): essay_review_allowance answers before the model call; record_essay_review checks
--   again. A day is the last 24 hours; a cycle runs from 1 August (lib/planner/cycle.ts currentCycle).
-- * A guardian in the student's household reads every review and note (can_read_essay, 20261029120000_essays.sql) and
--   changes nothing; only the student marks a note done or ignored (a column grant on `state` alone).
-- * Old notes stay with their version: no delete policy (deleting the draft or the version removes them).
-- * Never served to anon; the public Data API (/api/v1, lib/api/**) reads none of these tables.
--
-- Tested against real Postgres (PGlite + the auth stub) in tests/essays-review-policies.test.mts.
-- Apply in the Supabase SQL Editor (dev first, then prod), after 20261029120000_essays.sql.

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

create table public.essay_reviews (
  id         uuid primary key default gen_random_uuid(),
  essay_id   uuid not null references public.essays (id) on delete cascade,
  version_id uuid not null references public.essay_versions (id) on delete cascade,
  -- REVIEW_METHOD (lib/essays/rubric.ts): the rubric and guidance edition the notes were read with.
  method     text not null check (char_length(method) between 1 and 40),
  model      text not null check (char_length(model) between 1 and 80),
  -- notes: at least one note passed; none: nothing to note (or the guard dropped every note); refusal, max_tokens,
  -- malformed: the reader gave no usable answer. Every outcome is a model call and counts toward the caps.
  outcome    text not null default 'notes' check (outcome in ('notes', 'none', 'refusal', 'max_tokens', 'malformed')),
  -- Token counts only ({input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}).
  usage      jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  -- What the guard dropped, by category and reason ([{category, reason}]); never a note's text.
  dropped    jsonb not null default '[]'::jsonb check (jsonb_typeof(dropped) = 'array'),
  created    timestamptz not null default now()
);

create index essay_reviews_essay_idx on public.essay_reviews (essay_id, created desc);
create index essay_reviews_version_idx on public.essay_reviews (version_id);

create table public.essay_notes (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.essay_reviews (id) on delete cascade,
  -- The order the notes list shows them (mechanics first, then draft order).
  position    integer not null default 0 check (position between 0 and 11),
  category    text not null check (category in ('mechanics', 'prompt', 'specific', 'structure', 'voice', 'care', 'showcase', 'interest')),
  -- {paragraph, start, end} (0-based paragraph, character offsets in it); null for the whole draft.
  span        jsonb check (span is null or jsonb_typeof(span) = 'object'),
  observation text not null check (char_length(observation) between 1 and 600),
  why         text not null check (char_length(why) between 1 and 600),
  source      text check (source is null or char_length(source) <= 400),
  ask         text not null check (char_length(ask) between 1 and 600),
  -- Only a mechanics note carries a fix (the guard's first rule, kept here too).
  fix         text check (fix is null or (category = 'mechanics' and char_length(fix) between 1 and 120)),
  state       text not null default 'open' check (state in ('open', 'done', 'ignored')),
  created     timestamptz not null default now()
);

create index essay_notes_review_idx on public.essay_notes (review_id, position);

/* ------------------------------------------------------------------ */
/* Helpers (security definer: narrow, only ever about auth.uid())      */
/* ------------------------------------------------------------------ */

-- The start of the application cycle `at` falls in: 1 August (UTC) of this year, or of last year before August.
create function public.essay_cycle_start(at timestamptz) returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select make_timestamptz(
    (extract(year from at at time zone 'UTC'))::int - case when extract(month from at at time zone 'UTC') < 8 then 1 else 0 end,
    8, 1, 0, 0, 0, 'UTC')
$$;

-- The review's draft is one the signed-in user may read (its student's own account, or a guardian in the household).
create function public.can_read_review(p_review uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.essay_reviews r where r.id = p_review and public.can_read_essay(r.essay_id))
$$;

-- The review's draft is the signed-in user's own.
create function public.is_own_review(p_review uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.essay_reviews r where r.id = p_review and public.is_own_essay(r.essay_id))
$$;

-- The caps as counts and the first one reached. Not the caller's draft: {ok: false, reason: 'not_yours'}.
create function public.essay_review_allowance(p_essay uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_draft_day int;
  v_student_day int;
  v_draft_cycle int;
begin
  if not public.is_own_essay(p_essay) then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;
  select e.student_id into v_student from public.essays e where e.id = p_essay;
  select count(*) into v_draft_day from public.essay_reviews r where r.essay_id = p_essay and r.created > now() - interval '24 hours';
  select count(*) into v_student_day from public.essay_reviews r join public.essays e on e.id = r.essay_id
    where e.student_id = v_student and r.created > now() - interval '24 hours';
  select count(*) into v_draft_cycle from public.essay_reviews r where r.essay_id = p_essay and r.created >= public.essay_cycle_start(now());
  return jsonb_build_object(
    'ok', v_draft_day < 5 and v_student_day < 50 and v_draft_cycle < 60,
    'reason', case when v_draft_cycle >= 60 then 'draft_cycle' when v_draft_day >= 5 then 'draft_day' when v_student_day >= 50 then 'student_day' else null end,
    'draft_day', v_draft_day,
    'student_day', v_student_day,
    'draft_cycle', v_draft_cycle
  );
end;
$$;

-- A finished review and its notes, in one transaction. Raises essay_review_owner (not the caller's draft),
-- essay_review_version (the version isn't the draft's), essay_review_cap (a cap reached), essay_review_notes (more
-- than twelve notes, or a note that fails the table's checks).
create function public.record_essay_review(
  p_essay uuid,
  p_version uuid,
  p_method text,
  p_model text,
  p_outcome text,
  p_usage jsonb,
  p_dropped jsonb,
  p_notes jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_review uuid;
  v_allow jsonb;
  v_note jsonb;
  v_position int := 0;
begin
  if not public.is_own_essay(p_essay) then
    raise exception 'essay_review_owner' using errcode = '42501';
  end if;
  if not exists (select 1 from public.essay_versions v where v.id = p_version and v.essay_id = p_essay) then
    raise exception 'essay_review_version' using errcode = '23514';
  end if;
  if p_notes is null or jsonb_typeof(p_notes) <> 'array' or jsonb_array_length(p_notes) > 12 then
    raise exception 'essay_review_notes' using errcode = '23514';
  end if;
  select e.student_id into v_student from public.essays e where e.id = p_essay;
  perform pg_advisory_xact_lock(hashtext('essay_review:' || v_student::text));
  v_allow := public.essay_review_allowance(p_essay);
  if not (v_allow ->> 'ok')::boolean then
    raise exception 'essay_review_cap' using errcode = '23514', detail = coalesce(v_allow ->> 'reason', '');
  end if;

  insert into public.essay_reviews (essay_id, version_id, method, model, outcome, usage, dropped)
  values (p_essay, p_version, p_method, p_model, p_outcome, coalesce(p_usage, '{}'::jsonb), coalesce(p_dropped, '[]'::jsonb))
  returning id into v_review;

  for v_note in select value from jsonb_array_elements(p_notes) loop
    insert into public.essay_notes (review_id, position, category, span, observation, why, source, ask, fix)
    values (
      v_review,
      v_position,
      v_note ->> 'category',
      case when jsonb_typeof(v_note -> 'span') = 'object' then v_note -> 'span' else null end,
      v_note ->> 'observation',
      v_note ->> 'why',
      nullif(v_note ->> 'source', ''),
      v_note ->> 'ask',
      nullif(v_note ->> 'fix', '')
    );
    v_position := v_position + 1;
  end loop;
  return v_review;
end;
$$;

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.essay_reviews enable row level security;
alter table public.essay_notes enable row level security;

create policy "Essay reviews: read" on public.essay_reviews for select to authenticated
  using (public.can_read_essay(essay_id));
-- No insert, update, or delete policy: reviews are written by record_essay_review only, and never changed.

create policy "Essay notes: read" on public.essay_notes for select to authenticated
  using (public.can_read_review(review_id));
-- Only the student marks a note (the column grant below limits the update to `state`).
create policy "Essay notes: student marks" on public.essay_notes for update to authenticated
  using (public.is_own_review(review_id))
  with check (public.is_own_review(review_id));

/* ------------------------------------------------------------------ */
/* Privileges                                                          */
/* ------------------------------------------------------------------ */

revoke all on public.essay_reviews, public.essay_notes from public, anon, authenticated;
grant select on public.essay_reviews to authenticated;
grant select on public.essay_notes to authenticated;
grant update (state) on public.essay_notes to authenticated;
grant all on public.essay_reviews, public.essay_notes to service_role;

revoke execute on function public.can_read_review(uuid) from public, anon;
revoke execute on function public.is_own_review(uuid) from public, anon;
revoke execute on function public.essay_review_allowance(uuid) from public, anon;
revoke execute on function public.record_essay_review(uuid, uuid, text, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.can_read_review(uuid) to authenticated, service_role;
grant execute on function public.is_own_review(uuid) to authenticated, service_role;
grant execute on function public.essay_review_allowance(uuid) to authenticated, service_role;
grant execute on function public.record_essay_review(uuid, uuid, text, text, text, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.essay_cycle_start(timestamptz) to authenticated, service_role;
