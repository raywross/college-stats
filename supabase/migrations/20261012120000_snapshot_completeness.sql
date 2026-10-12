-- Snapshot completeness (specs/chances/method/standing.md "Revision 2"; the "Admission chances, next" build, U14):
-- each application snapshot records how complete the student's record was for that college, as the share of the
-- weight of the inputs the college weighs that the student had entered (GPA, courses, class standing, a test where
-- one is expected, activities), binned to 0.05. Measurement only: written by record_application_snapshot(), exported
-- with the student's own snapshots, never shown on a page or returned by the estimate's API. Additive (specs/supabase.md
-- "Migrations"): a new nullable column; snapshots taken before it read null. Apply to dev first, then prod.

alter table public.application_snapshots add column completeness numeric(3, 2)
  check (completeness between 0 and 1 and mod(completeness * 100, 5) = 0);

/* ------------------------------------------------------------------ */
/* record_application_snapshot(): write the new column                 */
/* ------------------------------------------------------------------ */

-- The write lists its columns one by one, so the column above would be dropped silently without this. The body of
-- 20261012100000_five_levels.sql, plus completeness in the insert list, the values, and the on-conflict update.
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
    completeness,
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
    r.completeness,
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
    completeness = excluded.completeness,
    student_group = excluded.student_group, group_changed = excluded.group_changed, consented = excluded.consented,
    created_at = excluded.created_at
  returning s.id into v_id;
  return v_id;
end;
$$;
