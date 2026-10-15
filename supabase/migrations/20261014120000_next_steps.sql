-- Next steps (specs/planner/next-steps/README.md; build plan specs/planner/next-steps/build-plan.md "Database"): the
-- one migration for the whole section, so no later unit needs SQL.
--   1. plan_tasks.season, plan_tasks.action: a move's season (set by the season generator, lib/planner/generators/
--      season.ts) and what its one button does (jsonb, lib/planner/types.ts MoveAction).
--   2. plan_tasks_kind_check widened to every new TaskKind of every part (playbook; ed_decide, ed2_decide; visit_ed,
--      show_interest; shape_gap, shape_cost; confirm_complete, compare_offers, decide_by, outcome_share; story), and
--      the source check gains 'season' (the playbook's own entries). tests/planner-task-kinds.test.mts keeps the
--      kind list equal to TaskKind.
--   3. list_items.ed_dismissed_at ("Not for me" on a row's ED pill) and list_items.ed_checks (the ED sheet's ticks).
--   4. notification_prefs.season_brief: the season brief's switch; null means the default (on where email is on).
--   5. plan_opens: when a viewer last opened a student's Next steps tab (the "new move" dot), own rows only.
--   6. plan_bundle() recreated with the same body plus the new item and task columns: a function that lists columns
--      one by one never returns a column added later (the chances-build lesson; tests/bundles.test.mts guards both
--      selects against lib/planner/read-plan.ts).
--
-- Additive and backward-compatible (specs/supabase.md "Migrations"): new nullable or defaulted columns, a widened
-- check, a new table, and a function replaced in place. Until it's applied the app reads tasks without season/action
-- and items without the ED columns, and retries a generated-task write without season/action
-- (lib/planner/read-plan.ts; build-plan.md review note 5). Apply to dev, then prod, pasted into the SQL Editor.

/* ------------------------------------------------------------------ */
/* plan_tasks                                                          */
/* ------------------------------------------------------------------ */

alter table public.plan_tasks add column season text check (season in ('freshman','sophomore','junior_fall','junior_winter','junior_spring','summer_before_senior','senior_fall','senior_winter','senior_spring','summer_after','graduated','unknown'));
alter table public.plan_tasks add column action jsonb check (action is null or jsonb_typeof(action) = 'object');

alter table public.plan_tasks drop constraint if exists plan_tasks_kind_check;

alter table public.plan_tasks add constraint plan_tasks_kind_check check (kind in (
  'apply', 'decision_expected', 'aid_forms', 'reply_by', 'housing_deposit', 'ed2_conditional',
  'cycle', 'decide_rounds', 'follow', 'request_info', 'write_visit_notes',
  'fee', 'send_scores', 'transcript', 'recommendation', 'supplement', 'submit', 'portal_setup', 'portal_check',
  'continued_interest', 'waitlist_accept', 'waitlist_deposit_elsewhere',
  'add_offer', 'deposit', 'withdraw', 'waitlist_decide', 'summer', 'own',
  'cost_check', 'test_register', 'test_day',
  'playbook', 'ed_decide', 'ed2_decide', 'visit_ed', 'show_interest', 'shape_gap', 'shape_cost',
  'confirm_complete', 'compare_offers', 'decide_by', 'outcome_share', 'story'
));

-- The table's inline source check (20261008120000_planner.sql) is Postgres-named plan_tasks_source_check.
alter table public.plan_tasks drop constraint if exists plan_tasks_source_check;
alter table public.plan_tasks add constraint plan_tasks_source_check check (source in ('college', 'cycle', 'stage', 'own', 'season'));

/* ------------------------------------------------------------------ */
/* list_items                                                          */
/* ------------------------------------------------------------------ */

-- list_items' existing row-level security covers both: the student and an edit-access guardian set them.
alter table public.list_items add column ed_dismissed_at timestamptz;
alter table public.list_items add column ed_checks jsonb not null default '{}' check (jsonb_typeof(ed_checks) = 'object');

/* ------------------------------------------------------------------ */
/* notification_prefs                                                  */
/* ------------------------------------------------------------------ */

alter table public.notification_prefs add column season_brief boolean;
-- notification_prefs grants updates column by column (20261005140000_follows.sql).
grant update (season_brief) on public.notification_prefs to authenticated;

/* ------------------------------------------------------------------ */
/* plan_opens                                                          */
/* ------------------------------------------------------------------ */

-- One row per viewer and student: when the viewer last opened that student's Next steps tab
-- (lib/planner/store-opens.ts recordPlanOpen; the dot is a move added since).
create table public.plan_opens (
  user_id    uuid references auth.users on delete cascade,
  student_id uuid references public.students on delete cascade,
  last_at    timestamptz not null default now(),
  primary key (user_id, student_id)
);

alter table public.plan_opens enable row level security;

create policy "Plan opens: read own" on public.plan_opens for select to authenticated using (user_id = auth.uid());
create policy "Plan opens: add own" on public.plan_opens for insert to authenticated with check (user_id = auth.uid());
create policy "Plan opens: change own" on public.plan_opens for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Plan opens: remove own" on public.plan_opens for delete to authenticated using (user_id = auth.uid());

revoke all on public.plan_opens from anon, authenticated;
grant select, insert, update, delete on public.plan_opens to authenticated;
grant all on public.plan_opens to service_role;

/* ------------------------------------------------------------------ */
/* plan_bundle(p_student, p_list)                                       */
/* ------------------------------------------------------------------ */

-- Same body as 20261012140000_plan_bundle.sql, with ed_dismissed_at, ed_checks in the items select and season,
-- action in the tasks select. Same signature, so the grants stay.
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
          created_by, created_at, season, action
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
