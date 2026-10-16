-- Plan v3 (specs/planner/v3/README.md; build plan specs/planner/v3/build-plan.md "Database"): the one migration for the
-- whole section, so no later unit needs SQL.
--   1. plan_tasks.dismissed_at, plan_tasks.dismissed_by: the skip record (now.md "Skip, recorded"). The built `dismissed`
--      flag stays the flag; `dismiss` (lib/planner/store.ts) stamps when and who, `undismiss` clears all three, so a
--      parent can see "Skipped Oct 12" and by whom. dismissed_by is set null when that account is deleted.
--   2. plan_interest_acts: act tracking for every guide (guides/show-interest.md "Tracking"; review note 11). One row
--      per click on a guide's act button (a tour's Register, an information request, a follow, a test registration),
--      pending until the student answers the return prompt or the next-morning email, then confirmed, declined, or
--      expired. item_id is null for a test registration (no college). confirm_token is the email's Yes/No link; the
--      route resolves it with the secret key, so it is unique and unguessable (two random UUIDs, the repo's token
--      pattern, no pgcrypto). Readable by the actor and by anyone who can read the item's list (the plan_visits
--      policy), so a parent sees a confirmed act on the plan; written only by the actor.
--   3. plan_bundle() recreated with the same body plus dismissed_at, dismissed_by in the tasks select: a function that
--      lists columns one by one never returns a column added later (tests/bundles.test.mts guards both selects against
--      lib/planner/read-plan.ts).
--
-- Additive and backward-compatible (specs/supabase.md "Migrations"): two nullable columns, a new table, and a function
-- replaced in place. Until it's applied the app reads tasks without the skip record and retries a skip with the flag
-- alone (lib/planner/read-plan.ts readTaskRows, updateTaskSkip; review note 3); the generators never write either
-- column. Apply to dev, then prod, pasted into the SQL Editor.

/* ------------------------------------------------------------------ */
/* plan_tasks: the skip record                                         */
/* ------------------------------------------------------------------ */

-- plan_tasks' existing row-level security covers both: whoever may dismiss a task may stamp it.
alter table public.plan_tasks add column dismissed_at timestamptz;
alter table public.plan_tasks add column dismissed_by uuid references auth.users on delete set null;

/* ------------------------------------------------------------------ */
/* plan_interest_acts                                                  */
/* ------------------------------------------------------------------ */

create table public.plan_interest_acts (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid references public.list_items on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  act             text not null check (act in ('tour','info_session','open_house','fair','event','info_request','mailing_list','follow','test_register')),
  network         text,
  url             text not null,
  event_id        text,
  event_starts_at timestamptz,
  event_place     text,
  event_title     text,
  clicked_at      timestamptz not null default now(),
  prompted_at     timestamptz,
  emailed_at      timestamptz,
  status          text not null default 'pending' check (status in ('pending','confirmed','declined','expired')),
  resolved_at     timestamptz,
  resolved_via    text check (resolved_via in ('prompt','email','manual')),
  visit_id        uuid references public.plan_visits on delete set null,
  confirm_token   text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);

-- The return prompt and the guide read a person's pending acts; the morning email reads every pending, unemailed one.
create index plan_interest_acts_user_status_idx on public.plan_interest_acts (user_id, status);
create index plan_interest_acts_status_emailed_idx on public.plan_interest_acts (status, emailed_at);

alter table public.plan_interest_acts enable row level security;

-- Read: the actor, and anyone who can read the item's list (the "Visits: read" policy's public.can_read_item); an
-- item-less row (a test registration) only by the actor.
create policy "Interest acts: read" on public.plan_interest_acts for select to authenticated
  using (user_id = auth.uid() or (item_id is not null and public.can_read_item(item_id)));
create policy "Interest acts: add own" on public.plan_interest_acts for insert to authenticated
  with check (user_id = auth.uid());
create policy "Interest acts: change own" on public.plan_interest_acts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- The admin console reads every planner table through its own session (20261012200000_admin.sql).
create policy "Admins read" on public.plan_interest_acts for select to authenticated using ((select public.admin_reads()));

revoke all on public.plan_interest_acts from anon, authenticated;
grant select, insert, update on public.plan_interest_acts to authenticated;
grant all on public.plan_interest_acts to service_role;

/* ------------------------------------------------------------------ */
/* plan_bundle(p_student, p_list)                                       */
/* ------------------------------------------------------------------ */

-- Same body as 20261014120000_next_steps.sql, with dismissed_at, dismissed_by in the tasks select. Same signature, so
-- the grants stay.
create or replace function public.plan_bundle(p_student uuid default null, p_list uuid default null) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_student uuid := p_student;
  v_list uuid := p_list;
begin
  if v_list is not null then
    select l.student_id into v_student from public.lists l where l.id = v_list;
  elsif v_student is null then
    select s.id into v_student from public.students s where s.user_id = auth.uid() and s.deleted_at is null limit 1;
  end if;
  if v_list is null and v_student is not null then
    select l.id into v_list from public.lists l where l.student_id = v_student order by l.is_default desc, l.created limit 1;
  end if;
  return jsonb_build_object(
    'student', (
      select to_jsonb(s) from (
        select id, user_id, display_name, grad_year, managed_by, created, deleted_at
        from public.students where id = v_student and deleted_at is null
      ) s
    ),
    'list', (
      select to_jsonb(l) from (
        select id, student_id, user_id, name, is_default, share_enabled, created_by, created, sort, rounds_plan_accepted_at
        from public.lists where id = v_list
      ) l
    ),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.position) from (
        select id, list_id, unit_id, category, status, outcome, round, position, added_by, added_at, decision_date,
          deadline_text, deadline_date, enrolling, updates, visited_on, follows_social, dream, priority, followed_networks,
          info_requested_on, application_platform, applied_on, complete_on, portal_url, committed_on, withdrawn_on,
          recommendations_count, supplements_count, transcript_shared, category_source, round_source, legacy, recruited, legacy_sibling,
          ed_dismissed_at, ed_checks
        from public.list_items where list_id = v_list
      ) i
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.due_on asc nulls last, t.position) from (
        select id, list_id, item_id, key, kind, title, detail, due_on, window_start, window_end, assignee, source,
          source_field, source_edition, date_note, done_at, done_by, snoozed_until, dismissed, orphaned, position,
          created_by, created_at, season, action, dismissed_at, dismissed_by
        from public.plan_tasks where list_id = v_list
      ) t
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.on_date) from (
        select id, item_id, kind, on_date, at_time, registered, registration_url, who, rating, notes, created_by,
          created_at, updated_at
        from public.plan_visits where item_id in (select id from public.list_items where list_id = v_list)
      ) v
    ), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.created_at) from (
        select id, item_id, award_year, letter_date, source, coa, gift, work_study, loans, quotes, pros, cons,
          confirmed_at, created_by, created_at
        from public.plan_offers where item_id in (select id from public.list_items where list_id = v_list)
      ) o
    ), '[]'::jsonb),
    'nudges', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.sent_at desc) from (
        select id, task_id, from_user, to_student, note, sent_at, channel, reply, replied_at
        from public.plan_nudges where task_id in (select id from public.plan_tasks where list_id = v_list)
      ) n
    ), '[]'::jsonb)
  );
end;
$$;
