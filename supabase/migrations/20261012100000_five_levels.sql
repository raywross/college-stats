-- Five levels (specs/chances/levels.md "Database"; part of the "Admission chances, next" build, U7 levels-planner):
-- the three stored groups (reach/target/likely) widen to five (high_reach/reach/target/likely/safe), and the
-- per-college legacy and recruited-athlete inputs land on list_items (specs/chances/inputs-beyond-academics.md
-- "Legacy", "Recruited athlete"). Additive and backward-compatible (specs/supabase.md "Migrations"): nothing is
-- renamed, so the running app keeps working until it deploys the code that reads the new values. Apply to dev
-- first, then prod, pasted into the SQL Editor.
--
-- No data rewrite: a list item or snapshot already stored as 'reach', 'target', or 'likely' stays exactly that
-- value — it's still a valid value under the five-level check. A row whose group the model now reads differently
-- (a C student's Elite college moving from "reach for everyone" to High reach, say) is rewritten the next time the
-- student's plan opens, the same as every group change has been since groups became Quad's only (2026-10-11).
-- `likely` keeps its stored value; only its meaning moves up a step (levels.md "The levels").

/* ------------------------------------------------------------------ */
/* list_items.category: three groups + unsorted -> five + unsorted     */
/* ------------------------------------------------------------------ */

alter table public.list_items drop constraint list_items_category_check;
alter table public.list_items add constraint list_items_category_check
  check (category in ('high_reach', 'reach', 'target', 'likely', 'safe', 'unsorted'));

/* ------------------------------------------------------------------ */
/* list_items: the per-college Legacy toggle and Recruited pick         */
/* (inputs-beyond-academics.md "Legacy", "Recruited athlete")           */
/* ------------------------------------------------------------------ */

alter table public.list_items add column legacy boolean not null default false;
alter table public.list_items add column recruited text not null default 'none'
  check (recruited in ('none', 'contact', 'pre_read', 'likely_letter'));

/* ------------------------------------------------------------------ */
/* application_snapshots: five-level columns, the new ablations, the   */
/* hidden odds (binned) and the selectivity tier (method/outcomes.md)  */
/* ------------------------------------------------------------------ */

alter table public.application_snapshots drop constraint application_snapshots_estimate_group_check;
alter table public.application_snapshots add constraint application_snapshots_estimate_group_check
  check (estimate_group in ('high_reach', 'reach', 'target', 'likely', 'safe'));

alter table public.application_snapshots drop constraint application_snapshots_estimate_label_check;
alter table public.application_snapshots add constraint application_snapshots_estimate_label_check
  check (estimate_label in ('elite', 'guaranteed', 'recruited', 'reach-for-everyone'));
-- 'reach-for-everyone' stays valid for snapshots taken before this migration (what the student saw then); new
-- snapshots never write it (lib/chances/snapshot.ts).

alter table public.application_snapshots drop constraint application_snapshots_without_residency_check;
alter table public.application_snapshots add constraint application_snapshots_without_residency_check
  check (without_residency in ('high_reach', 'reach', 'target', 'likely', 'safe'));

alter table public.application_snapshots drop constraint application_snapshots_without_crowding_check;
alter table public.application_snapshots add constraint application_snapshots_without_crowding_check
  check (without_crowding in ('high_reach', 'reach', 'target', 'likely', 'safe'));

alter table public.application_snapshots drop constraint application_snapshots_without_rigor_check;
alter table public.application_snapshots add constraint application_snapshots_without_rigor_check
  check (without_rigor in ('high_reach', 'reach', 'target', 'likely', 'safe'));

alter table public.application_snapshots drop constraint application_snapshots_without_rank_check;
alter table public.application_snapshots add constraint application_snapshots_without_rank_check
  check (without_rank in ('high_reach', 'reach', 'target', 'likely', 'safe'));

alter table public.application_snapshots drop constraint application_snapshots_student_group_check;
alter table public.application_snapshots add constraint application_snapshots_student_group_check
  check (student_group in ('high_reach', 'reach', 'target', 'likely', 'safe'));

-- InputKind gained six values (levels.md "The estimate's contract"): activities, awards, work, legacy, recruited,
-- interest, class_standing.
alter table public.application_snapshots drop constraint application_snapshots_inputs_used_check;
alter table public.application_snapshots add constraint application_snapshots_inputs_used_check
  check (inputs_used <@ array[
    'gpa', 'test', 'sections', 'class_rank', 'courses', 'subject_grades', 'state', 'major', 'round', 'high_school',
    'activities', 'awards', 'work', 'legacy', 'recruited', 'interest', 'class_standing'
  ]::text[]);

-- Measurement-only columns (levels.md "Database"): readable through RLS like the rest of the snapshot, never
-- exported, displayed, or returned by the estimate's API (specs/chances/README.md "Quad's estimate is proprietary").
alter table public.application_snapshots add column hidden_odds numeric(4, 3) check (hidden_odds between 0 and 1);
alter table public.application_snapshots add column selectivity_tier text
  check (selectivity_tier in ('elite', 'highly_selective', 'selective', 'accessible', 'open'));
alter table public.application_snapshots add column without_depth text
  check (without_depth in ('high_reach', 'reach', 'target', 'likely', 'safe'));
alter table public.application_snapshots add column without_hooks text
  check (without_hooks in ('high_reach', 'reach', 'target', 'likely', 'safe'));
alter table public.application_snapshots add column without_interest text
  check (without_interest in ('high_reach', 'reach', 'target', 'likely', 'safe'));

/* ------------------------------------------------------------------ */
/* chances_summary.estimate_group: five values; the band cells unchanged */
/* ------------------------------------------------------------------ */

alter table public.chances_summary drop constraint chances_summary_estimate_group_check;
alter table public.chances_summary add constraint chances_summary_estimate_group_check
  check (estimate_group in ('high_reach', 'reach', 'target', 'likely', 'safe'));

/* ------------------------------------------------------------------ */
/* record_application_snapshot(): write the new columns                */
/* ------------------------------------------------------------------ */

-- The write lists its columns one by one (20261011100000_application_snapshots.sql), so the five new columns above
-- would be dropped silently without this. Same body and grants, plus hidden_odds, selectivity_tier, without_depth,
-- without_hooks, without_interest.
create or replace function public.record_application_snapshot(p_item uuid, p_snapshot jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.list_items;
  v_list public.lists;
  r public.application_snapshots;
  v_id uuid;
begin
  select * into v_item from public.list_items where id = p_item;
  if v_item.id is null or not public.can_edit_list(v_item.list_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_list from public.lists where id = v_item.list_id;
  if v_list.student_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_item.applied_on is null or v_item.status not in ('applied', 'decided') then
    raise exception 'not_applied' using errcode = '22023';
  end if;
  r := jsonb_populate_record(null::public.application_snapshots, coalesce(p_snapshot, '{}'::jsonb));

  insert into public.application_snapshots as s (
    item_id, list_id, student_id, unit_id, season, applied_on, round,
    gpa, gpa_low, gpa_high, gpa_scale, test_kind, test_score, sat_math, act_math, class_rank_pct, state, majors, practice,
    advanced_courses, advanced_planned, honors_courses, advanced_gpa, math_gpa, science_gpa, hs_ap_band, hs_ib, hs_dual,
    admit_rate, estimate_group, estimate_label, inputs_used, note_keys, model_version,
    position, base_rate_kind, base_rate, crowded, rigor_reading,
    without_residency, without_crowding, without_rigor, without_rank,
    hidden_odds, selectivity_tier, without_depth, without_hooks, without_interest,
    student_group, group_changed, consented, created_at
  ) values (
    v_item.id, v_item.list_id, v_list.student_id, v_item.unit_id, public.application_season(v_item.applied_on), v_item.applied_on,
    coalesce(r.round, v_item.round),
    r.gpa, r.gpa_low, r.gpa_high, r.gpa_scale, r.test_kind, r.test_score, r.sat_math, r.act_math, r.class_rank_pct, r.state,
    coalesce(r.majors, '{}'), coalesce(r.practice, false),
    coalesce(r.advanced_courses, 0), coalesce(r.advanced_planned, 0), coalesce(r.honors_courses, 0), r.advanced_gpa, r.math_gpa,
    r.science_gpa, r.hs_ap_band, r.hs_ib, r.hs_dual,
    r.admit_rate, r.estimate_group, r.estimate_label, coalesce(r.inputs_used, '{}'), coalesce(r.note_keys, '{}'), r.model_version,
    r.position, r.base_rate_kind, r.base_rate, r.crowded, r.rigor_reading,
    r.without_residency, r.without_crowding, r.without_rigor, r.without_rank,
    r.hidden_odds, r.selectivity_tier, r.without_depth, r.without_hooks, r.without_interest,
    r.student_group, coalesce(r.group_changed, false), v_list.outcome_share_consented_at is not null, now()
  )
  on conflict (item_id) do update set
    list_id = excluded.list_id, student_id = excluded.student_id, unit_id = excluded.unit_id, season = excluded.season,
    applied_on = excluded.applied_on, round = excluded.round,
    gpa = excluded.gpa, gpa_low = excluded.gpa_low, gpa_high = excluded.gpa_high, gpa_scale = excluded.gpa_scale,
    test_kind = excluded.test_kind, test_score = excluded.test_score, sat_math = excluded.sat_math, act_math = excluded.act_math,
    class_rank_pct = excluded.class_rank_pct, state = excluded.state, majors = excluded.majors, practice = excluded.practice,
    advanced_courses = excluded.advanced_courses, advanced_planned = excluded.advanced_planned,
    honors_courses = excluded.honors_courses, advanced_gpa = excluded.advanced_gpa, math_gpa = excluded.math_gpa,
    science_gpa = excluded.science_gpa, hs_ap_band = excluded.hs_ap_band, hs_ib = excluded.hs_ib, hs_dual = excluded.hs_dual,
    admit_rate = excluded.admit_rate, estimate_group = excluded.estimate_group, estimate_label = excluded.estimate_label,
    inputs_used = excluded.inputs_used, note_keys = excluded.note_keys, model_version = excluded.model_version,
    position = excluded.position, base_rate_kind = excluded.base_rate_kind, base_rate = excluded.base_rate,
    crowded = excluded.crowded, rigor_reading = excluded.rigor_reading,
    without_residency = excluded.without_residency, without_crowding = excluded.without_crowding,
    without_rigor = excluded.without_rigor, without_rank = excluded.without_rank,
    hidden_odds = excluded.hidden_odds, selectivity_tier = excluded.selectivity_tier,
    without_depth = excluded.without_depth, without_hooks = excluded.without_hooks,
    without_interest = excluded.without_interest,
    student_group = excluded.student_group, group_changed = excluded.group_changed, consented = excluded.consented,
    created_at = excluded.created_at
  returning s.id into v_id;
  return v_id;
end;
$$;
