-- The planner (specs/planner/model.md "Tables"; specs/planner/README.md): columns on lists and list_items, and the
-- tables that hang off a list (tasks, visits, offers, letters, nudges, calendar tokens, text consents). Additive; no
-- table or column from an earlier migration is renamed or dropped. Apply after 20261007130000_retire_dataset_tables.sql
-- (SQL Editor, dev first, then prod). Tested in tests/planner-policies.test.mts (PGlite + the auth stub, every
-- assertion as a signed-in user), with guard tests that break a rule on purpose and show the check notices.
--
-- Access is the list's access (can_read_list / can_edit_list, 20261006150000_household_hub.sql): whoever reads a
-- list reads its plan; whoever edits it edits the plan. Tables hanging off an item (visits, offers, letters) go
-- through can_read_item / can_edit_item, which resolve the item's list. Exceptions, each with its reason below:
-- nudges (the sender and the student only), calendar tokens (their creator only), and text consents (the person and
-- the guardians who can read the student).
--
-- Rules the database keeps (model.md "Rules"):
-- 1. One Dream per list: setting dream on one item clears it on the others (trigger), backed by a partial unique index.
-- 2. applied_on and status move together: setting applied_on moves considering/applying to applied; setting the
--    status back to considering/applying clears applied_on (and complete_on).
-- 3. committed_on requires enrolling: turning enrolling off clears committed_on (trigger), backed by a check.
-- 4. One enrolling college per list: setting enrolling on one item clears it on the others (trigger), backed by a
--    partial unique index. Lists that already have two are cleaned up first (the earliest position keeps it).
-- 5. A task's item belongs to the task's list; tasks for an item cascade with it; a guardian's own list never gets
--    `cycle` tasks or offers (the planner is the student's).
-- 6. done_by and created_by are the signed-in user, set by triggers (never trusted from the request).
-- 7. send_nudge() rate limits: one nudge per task per three days, three a week per student from one guardian.

/* ------------------------------------------------------------------ */
/* 1. Columns on lists and list_items                                  */
/* ------------------------------------------------------------------ */

alter table public.lists
  add column sort text check (sort in ('mine', 'category', 'dream_priority', 'next_date', 'admit_rate', 'avg_cost', 'distance', 'standing')),
  add column rounds_plan_accepted_at timestamptz;

alter table public.list_items
  add column dream boolean not null default false,
  add column priority integer check (priority between 1 and 100),
  add column followed_networks text[] not null default '{}'
    check (followed_networks <@ array['instagram', 'youtube', 'tiktok', 'x', 'facebook', 'linkedin']::text[]),
  add column info_requested_on date,
  add column application_platform text check (application_platform in ('common_app', 'coalition', 'own', 'uc', 'apply_texas', 'other')),
  add column applied_on date,
  add column complete_on date,
  -- A URL only, never credentials.
  add column portal_url text check (portal_url ~ '^https?://' and char_length(portal_url) <= 500),
  add column committed_on date,
  add column withdrawn_on date,
  add column recommendations_count integer check (recommendations_count between 0 and 10),
  add column supplements_count integer check (supplements_count between 0 and 30),
  add column transcript_shared boolean not null default true,
  add constraint list_items_committed_needs_enrolling check (committed_on is null or enrolling);

-- Rule 4's cleanup: a list with more than one enrolling college keeps the one highest on the list.
update public.list_items li set enrolling = false
where li.enrolling
  and exists (
    select 1 from public.list_items o
    where o.list_id = li.list_id and o.enrolling and (o.position, o.id::text) < (li.position, li.id::text)
  );

create unique index list_items_one_dream_idx on public.list_items (list_id) where dream;
create unique index list_items_one_enrolling_idx on public.list_items (list_id) where enrolling;

-- Rules 1–4 in one trigger, before the row is written. Runs as the caller (no security definer): clearing the
-- Dream or enrolling on a sibling is an update the caller's own policy must allow, and it does (same list).
create function public.list_items_plan_rules() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 2. applied_on <-> status. A status set back clears the dates; a new applied_on moves the status forward.
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('considering', 'applying') then
    new.applied_on := null;
    new.complete_on := null;
  elsif new.applied_on is not null and new.status in ('considering', 'applying') then
    new.status := 'applied';
  end if;

  -- 3. committed_on requires enrolling.
  if not new.enrolling then
    new.committed_on := null;
  end if;

  -- 1. One Dream per list.
  if new.dream and (tg_op = 'INSERT' or not old.dream) then
    update public.list_items set dream = false where list_id = new.list_id and id <> new.id and dream;
  end if;

  -- 4. One enrolling college per list.
  if new.enrolling and (tg_op = 'INSERT' or not old.enrolling) then
    update public.list_items set enrolling = false where list_id = new.list_id and id <> new.id and enrolling;
  end if;
  return new;
end;
$$;

create trigger list_items_plan_rules
before insert or update on public.list_items
for each row execute function public.list_items_plan_rules();

/* ------------------------------------------------------------------ */
/* 2. Access helpers by item                                           */
/* ------------------------------------------------------------------ */

create function public.can_read_item(p_item uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.list_items li where li.id = p_item and public.can_read_list(li.list_id))
$$;

create function public.can_edit_item(p_item uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.list_items li where li.id = p_item and public.can_edit_list(li.list_id))
$$;

-- Whether an item sits on a student's list (offers are the student's; a guardian's own list has none).
create function public.item_on_student_list(p_item uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.list_items li join public.lists l on l.id = li.list_id
    where li.id = p_item and l.student_id is not null
  )
$$;

-- created_by / uploaded_by / consented_by are whoever is signed in when a row is created through the API; the
-- service role (scripts, the webhook) may set them.
create function public.planner_stamp_creator() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    case tg_table_name
      when 'plan_letters' then new.uploaded_by := auth.uid();
      when 'sms_consents' then new.consented_by := auth.uid();
      else new.created_by := auth.uid();
    end case;
  end if;
  return new;
end;
$$;

/* ------------------------------------------------------------------ */
/* 3. Tasks                                                            */
/* ------------------------------------------------------------------ */

create table public.plan_tasks (
  id             uuid primary key default gen_random_uuid(),
  list_id        uuid not null references public.lists (id) on delete cascade,
  item_id        uuid references public.list_items (id) on delete cascade,
  -- `{item}:{kind}:{suffix}` or `{list}:{kind}:{suffix}` (lib/planner/tasks.ts taskKey); null for a family's own task.
  key            text check (char_length(key) <= 200),
  kind           text not null check (kind in (
    'apply', 'decision_expected', 'aid_forms', 'reply_by', 'housing_deposit', 'ed2_conditional',
    'cycle', 'decide_rounds', 'follow', 'request_info', 'write_visit_notes',
    'fee', 'send_scores', 'transcript', 'recommendation', 'supplement', 'submit', 'portal_setup', 'portal_check',
    'continued_interest', 'waitlist_accept', 'waitlist_deposit_elsewhere',
    'add_offer', 'deposit', 'withdraw', 'waitlist_decide', 'summer', 'own'
  )),
  title          text not null check (char_length(title) between 1 and 200),
  detail         text check (char_length(detail) <= 1000),
  due_on         date,
  window_start   date,
  window_end     date,
  assignee       text not null default 'student' check (assignee in ('student', 'guardian', 'either')),
  source         text not null check (source in ('college', 'cycle', 'stage', 'own')),
  -- The registered field path (lib/fields.ts) and CDS edition a college date came from.
  source_field   text check (char_length(source_field) <= 200),
  source_edition text check (char_length(source_edition) <= 20),
  -- 'last_cycle': the date came from the previous cycle's edition; 'own': a date the family typed.
  date_note      text check (date_note in ('last_cycle', 'own')),
  done_at        timestamptz,
  done_by        uuid references auth.users (id) on delete set null,
  snoozed_until  date,
  dismissed      boolean not null default false,
  -- A generated task whose source disappeared: shown once, then hidden; never deleted by a regeneration.
  orphaned       boolean not null default false,
  position       integer not null default 0,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- NULL keys are distinct, so any number of own tasks; one generated task per key per list.
  constraint plan_tasks_key_unique unique (list_id, key),
  constraint plan_tasks_own_has_no_key check ((source = 'own') = (key is null) and (source = 'own') = (kind = 'own')),
  constraint plan_tasks_window_shape check ((window_start is null) = (window_end is null) and (window_start is null or window_start <= window_end))
);

create index plan_tasks_list_idx on public.plan_tasks (list_id, due_on);
create index plan_tasks_item_idx on public.plan_tasks (item_id) where item_id is not null;

-- Rule 5 and 6 for tasks: the item is on the task's list; no cycle tasks on a guardian's own list; the list never
-- changes; done_by follows done_at (the signed-in user who ticked it). Runs as the caller (not security definer, so
-- current_user still tells the API apart from the service role); a caller who may edit the list may read it.
create function public.plan_tasks_rules() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.list_id is distinct from old.list_id then
    raise exception 'plan_task_list_immutable' using errcode = '42501';
  end if;
  if new.item_id is not null and not exists (select 1 from public.list_items li where li.id = new.item_id and li.list_id = new.list_id) then
    raise exception 'plan_task_item_not_on_list' using errcode = '23514';
  end if;
  if new.source = 'cycle' and exists (select 1 from public.lists l where l.id = new.list_id and l.user_id is not null) then
    raise exception 'plan_cycle_tasks_students_only' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.created_by := auth.uid();
    end if;
    new.done_by := case when new.done_at is null then null else coalesce(auth.uid(), new.done_by) end;
  elsif new.done_at is distinct from old.done_at then
    new.done_by := case when new.done_at is null then null else coalesce(auth.uid(), new.done_by) end;
  elsif current_user in ('authenticated', 'anon') then
    new.done_by := old.done_by;
  end if;
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger plan_tasks_rules
before insert or update on public.plan_tasks
for each row execute function public.plan_tasks_rules();

/* ------------------------------------------------------------------ */
/* 4. Visits                                                           */
/* ------------------------------------------------------------------ */

-- Never private: a visit is a family event (private thoughts go in a private list note).
create table public.plan_visits (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.list_items (id) on delete cascade,
  kind             text not null check (kind in ('campus_tour', 'info_session', 'open_house', 'virtual', 'interview', 'fair', 'overnight', 'other')),
  on_date          date not null,
  at_time          time,
  registered       boolean not null default false,
  registration_url text check (registration_url ~ '^https?://' and char_length(registration_url) <= 500),
  who              text[] not null default '{}' check (cardinality(who) <= 8),
  rating           smallint check (rating between 1 and 5),
  notes            jsonb not null default '{}' check (jsonb_typeof(notes) = 'object' and char_length(notes::text) <= 20000),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index plan_visits_item_idx on public.plan_visits (item_id, on_date);

create function public.plan_visits_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if current_user in ('authenticated', 'anon') then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger plan_visits_stamp before insert on public.plan_visits for each row execute function public.planner_stamp_creator();
create trigger plan_visits_touch before update on public.plan_visits for each row execute function public.plan_visits_touch();

/* ------------------------------------------------------------------ */
/* 5. Offers and letters                                               */
/* ------------------------------------------------------------------ */

-- The College Financing Plan layout (specs/planner/offers.md). Line items are jsonb, read whole.
create table public.plan_offers (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.list_items (id) on delete cascade,
  award_year   integer not null check (award_year between 2000 and 2100),
  letter_date  date,
  source       text not null default 'form' check (source in ('form', 'upload')),
  coa          jsonb not null default '{}' check (jsonb_typeof(coa) = 'object'),
  gift         jsonb not null default '[]' check (jsonb_typeof(gift) = 'array'),
  work_study   integer check (work_study >= 0),
  loans        jsonb not null default '[]' check (jsonb_typeof(loans) = 'array'),
  quotes       jsonb check (quotes is null or jsonb_typeof(quotes) = 'object'),
  pros         text check (char_length(pros) <= 2000),
  cons         text check (char_length(cons) <= 2000),
  confirmed_at timestamptz,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index plan_offers_item_idx on public.plan_offers (item_id);
create trigger plan_offers_stamp before insert on public.plan_offers for each row execute function public.planner_stamp_creator();

-- A shared letter: the file lives in the private Storage bucket "plan-letters" (supabase/storage/planner-letters.sql,
-- run by the owner); this row is the only way to its path, and it is readable only by whoever can read the item.
-- Deleted with the uploader's account.
create table public.plan_letters (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.list_items (id) on delete cascade,
  kind         text not null check (kind in ('admission', 'aid', 'other')),
  storage_path text not null unique check (char_length(storage_path) between 1 and 300),
  uploaded_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  extracted    jsonb,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index plan_letters_item_idx on public.plan_letters (item_id);
create trigger plan_letters_stamp before insert on public.plan_letters for each row execute function public.planner_stamp_creator();

/* ------------------------------------------------------------------ */
/* 6. Nudges                                                           */
/* ------------------------------------------------------------------ */

-- A guardian's one-line nudge on one task (specs/planner/parents.md "Nudges"). Written only by send_nudge(); read by
-- its sender and the student it went to (another guardian sees that a nudge was sent through U8's summary, not this
-- table); the student answers with a one-line reply.
create table public.plan_nudges (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.plan_tasks (id) on delete cascade,
  from_user  uuid not null references auth.users (id) on delete cascade,
  to_student uuid not null references public.students (id) on delete cascade,
  note       text check (char_length(note) <= 200),
  sent_at    timestamptz not null default now(),
  channel    text not null check (channel in ('email', 'sms', 'app')),
  reply      text check (char_length(reply) <= 200),
  replied_at timestamptz
);

create index plan_nudges_task_idx on public.plan_nudges (task_id, sent_at desc);
create index plan_nudges_student_idx on public.plan_nudges (to_student, from_user, sent_at desc);

-- A reply is the student's alone, once; replied_at is the server's clock.
create function public.plan_nudges_reply() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if old.replied_at is not null then
      raise exception 'nudge_already_answered' using errcode = '22023';
    end if;
    new.replied_at := case when new.reply is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger plan_nudges_reply before update on public.plan_nudges for each row execute function public.plan_nudges_reply();

-- Sends a nudge as the signed-in guardian: they must be an active guardian of the task's student (an account
-- holder: a managed student can't be nudged), the task open, the channel known. One nudge per task per three days
-- (from anyone: the student hears about a task once), three a week per student from one guardian. Raises
-- 'nudge_limit' past either limit. Returns the new row.
create function public.send_nudge(p_task uuid, p_note text, p_channel text) returns public.plan_nudges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.plan_tasks;
  v_student uuid;
  v_student_user uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.plan_nudges;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_channel is null or p_channel not in ('email', 'sms', 'app') then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  select t.* into v_task from public.plan_tasks t where t.id = p_task;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  select l.student_id, s.user_id into v_student, v_student_user
    from public.lists l join public.students s on s.id = l.student_id
    where l.id = v_task.list_id and s.deleted_at is null
    for update of s;
  if v_student is null or not public.is_guardian_of(v_student, false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_student_user is null then
    raise exception 'nudge_no_account' using errcode = '22023';
  end if;
  if v_task.done_at is not null or v_task.dismissed then
    raise exception 'task_closed' using errcode = '22023';
  end if;
  if exists (select 1 from public.plan_nudges n where n.task_id = p_task and n.sent_at > now() - interval '3 days') then
    raise exception 'nudge_limit' using errcode = '23514', detail = 'task';
  end if;
  if (select count(*) from public.plan_nudges n
      where n.to_student = v_student and n.from_user = v_uid and n.sent_at > now() - interval '7 days') >= 3 then
    raise exception 'nudge_limit' using errcode = '23514', detail = 'week';
  end if;
  insert into public.plan_nudges (task_id, from_user, to_student, note, channel)
  values (p_task, v_uid, v_student, v_note, p_channel)
  returning * into v_row;
  return v_row;
end;
$$;

/* ------------------------------------------------------------------ */
/* 7. Calendar tokens                                                  */
/* ------------------------------------------------------------------ */

-- A per-list calendar feed (specs/planner/timeline.md "Display"). The clear token is shown once; only its sha256
-- hex is stored. Readable by its creator only; anyone who can read the list may make one.
create table public.plan_calendar_tokens (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.lists (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index plan_calendar_tokens_list_idx on public.plan_calendar_tokens (list_id);
create trigger plan_calendar_tokens_stamp before insert on public.plan_calendar_tokens for each row execute function public.planner_stamp_creator();

-- The feed's lookup (app/api/plan/[token]/route.ts hashes the token and calls this): the list id for a live token,
-- else null. The token is the only secret, so this is callable without a session.
create function public.plan_for_calendar_token(p_token_hash text) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.list_id from public.plan_calendar_tokens t
  where t.token_hash = p_token_hash and t.revoked_at is null
  limit 1
$$;

/* ------------------------------------------------------------------ */
/* 8. Text consents                                                    */
/* ------------------------------------------------------------------ */

-- Explicit opt-in to texts (specs/planner/timeline.md "Texts"): a person's own (user_id) or, for a student, by the
-- student or a guardian (student_id). One active row per person. A provider STOP sets provider_opt_out_at through
-- the webhook (service role); no text goes to a row with revoked_at or provider_opt_out_at set.
create table public.sms_consents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users (id) on delete cascade,
  student_id          uuid references public.students (id) on delete cascade,
  phone               text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  consented_by        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consented_at        timestamptz not null default now(),
  revoked_at          timestamptz,
  provider_opt_out_at timestamptz,
  constraint sms_consents_one_person check ((user_id is null) <> (student_id is null))
);

create unique index sms_consents_active_user_idx on public.sms_consents (user_id)
  where user_id is not null and revoked_at is null and provider_opt_out_at is null;
create unique index sms_consents_active_student_idx on public.sms_consents (student_id)
  where student_id is not null and revoked_at is null and provider_opt_out_at is null;
create trigger sms_consents_stamp before insert on public.sms_consents for each row execute function public.planner_stamp_creator();

/* ------------------------------------------------------------------ */
/* 9. Row-level security                                               */
/* ------------------------------------------------------------------ */

alter table public.plan_tasks enable row level security;
alter table public.plan_visits enable row level security;
alter table public.plan_offers enable row level security;
alter table public.plan_letters enable row level security;
alter table public.plan_nudges enable row level security;
alter table public.plan_calendar_tokens enable row level security;
alter table public.sms_consents enable row level security;

create policy "Tasks: read" on public.plan_tasks for select to authenticated using (public.can_read_list(list_id));
create policy "Tasks: create" on public.plan_tasks for insert to authenticated with check (public.can_edit_list(list_id));
create policy "Tasks: update" on public.plan_tasks for update to authenticated
  using (public.can_edit_list(list_id)) with check (public.can_edit_list(list_id));
create policy "Tasks: delete" on public.plan_tasks for delete to authenticated using (public.can_edit_list(list_id));

create policy "Visits: read" on public.plan_visits for select to authenticated using (public.can_read_item(item_id));
create policy "Visits: create" on public.plan_visits for insert to authenticated with check (public.can_edit_item(item_id));
create policy "Visits: update" on public.plan_visits for update to authenticated
  using (public.can_edit_item(item_id)) with check (public.can_edit_item(item_id));
create policy "Visits: delete" on public.plan_visits for delete to authenticated using (public.can_edit_item(item_id));

create policy "Offers: read" on public.plan_offers for select to authenticated using (public.can_read_item(item_id));
create policy "Offers: create" on public.plan_offers for insert to authenticated
  with check (public.can_edit_item(item_id) and public.item_on_student_list(item_id));
create policy "Offers: update" on public.plan_offers for update to authenticated
  using (public.can_edit_item(item_id)) with check (public.can_edit_item(item_id) and public.item_on_student_list(item_id));
create policy "Offers: delete" on public.plan_offers for delete to authenticated using (public.can_edit_item(item_id));

-- Letters: the path is readable only through the owning item; the uploader may always remove their own.
create policy "Letters: read" on public.plan_letters for select to authenticated using (public.can_read_item(item_id));
create policy "Letters: create" on public.plan_letters for insert to authenticated
  with check (public.can_edit_item(item_id) and public.item_on_student_list(item_id));
create policy "Letters: delete" on public.plan_letters for delete to authenticated
  using (uploaded_by = auth.uid() or public.can_edit_item(item_id));

create policy "Nudges: sender and student read" on public.plan_nudges for select to authenticated
  using (from_user = auth.uid() or public.is_own_student(to_student));
create policy "Nudges: student replies" on public.plan_nudges for update to authenticated
  using (public.is_own_student(to_student)) with check (public.is_own_student(to_student));

create policy "Calendar tokens: creator reads" on public.plan_calendar_tokens for select to authenticated
  using (created_by = auth.uid());
create policy "Calendar tokens: create" on public.plan_calendar_tokens for insert to authenticated
  with check (created_by = auth.uid() and public.can_read_list(list_id));
create policy "Calendar tokens: creator revokes" on public.plan_calendar_tokens for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "Calendar tokens: creator deletes" on public.plan_calendar_tokens for delete to authenticated
  using (created_by = auth.uid());

-- Consents: the person (or, for a student, anyone who can read the student: the student and their guardians) reads;
-- an adult consents for themselves, a student or their guardian for the student (the under-18 rule is the app's,
-- U5); the same people revoke.
create policy "Texts: read" on public.sms_consents for select to authenticated
  using (user_id = auth.uid() or (student_id is not null and public.can_read_student(student_id)));
create policy "Texts: consent" on public.sms_consents for insert to authenticated
  with check (user_id = auth.uid() or (student_id is not null and (public.is_own_student(student_id) or public.is_guardian_of(student_id, false))));
create policy "Texts: revoke" on public.sms_consents for update to authenticated
  using (user_id = auth.uid() or (student_id is not null and (public.is_own_student(student_id) or public.is_guardian_of(student_id, false))))
  with check (user_id = auth.uid() or (student_id is not null and (public.is_own_student(student_id) or public.is_guardian_of(student_id, false))));

-- Supabase grants everything on new public tables to anon and authenticated by default; narrow that.
revoke all on public.plan_tasks, public.plan_visits, public.plan_offers, public.plan_letters, public.plan_nudges,
  public.plan_calendar_tokens, public.sms_consents from anon, authenticated;
grant select, insert, update, delete on public.plan_tasks, public.plan_visits, public.plan_offers to authenticated;
grant select, insert, delete on public.plan_letters to authenticated;
grant select on public.plan_nudges to authenticated;
grant update (reply) on public.plan_nudges to authenticated;
grant select, insert, delete on public.plan_calendar_tokens to authenticated;
grant update (revoked_at) on public.plan_calendar_tokens to authenticated;
grant select on public.sms_consents to authenticated;
grant insert (user_id, student_id, phone) on public.sms_consents to authenticated;
grant update (revoked_at) on public.sms_consents to authenticated;
grant all on public.plan_tasks, public.plan_visits, public.plan_offers, public.plan_letters, public.plan_nudges,
  public.plan_calendar_tokens, public.sms_consents to service_role;

/* ------------------------------------------------------------------ */
/* 10. Function privileges                                             */
/* ------------------------------------------------------------------ */

revoke execute on function public.can_read_item(uuid) from public, anon;
revoke execute on function public.can_edit_item(uuid) from public, anon;
revoke execute on function public.item_on_student_list(uuid) from public, anon;
grant execute on function public.can_read_item(uuid) to authenticated, service_role;
grant execute on function public.can_edit_item(uuid) to authenticated, service_role;
grant execute on function public.item_on_student_list(uuid) to authenticated, service_role;

revoke execute on function public.send_nudge(uuid, text, text) from public, anon;
grant execute on function public.send_nudge(uuid, text, text) to authenticated;

revoke execute on function public.plan_for_calendar_token(text) from public;
grant execute on function public.plan_for_calendar_token(text) to anon, authenticated, service_role;

-- Internal: triggers only.
revoke execute on function public.list_items_plan_rules() from public, anon, authenticated;
revoke execute on function public.planner_stamp_creator() from public, anon, authenticated;
revoke execute on function public.plan_tasks_rules() from public, anon, authenticated;
revoke execute on function public.plan_visits_touch() from public, anon, authenticated;
revoke execute on function public.plan_nudges_reply() from public, anon, authenticated;
