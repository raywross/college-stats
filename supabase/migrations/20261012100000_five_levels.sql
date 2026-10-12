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
  check (estimate_label in ('elite', 'guaranteed', 'recruited'));

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
