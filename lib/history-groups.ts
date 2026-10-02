/**
 * The profile's "Over time" groups (components/history/OverTime.tsx): one group shows at a time, picked with a
 * segmented control and kept in the URL as `?group=`. Pure, so the server page, the client component, and tests share
 * the same keys and the same "which groups have data" rule.
 */
import { NET_PRICE_BANDS, type SchoolHistory, type SeriesKey } from "./history.ts";

/** Every group, in display order. */
export const HISTORY_GROUP_KEYS = ["cost", "aid", "admissions", "scores", "students", "academics", "outcomes", "changes"] as const;
export type HistoryGroupKey = (typeof HISTORY_GROUP_KEYS)[number];

/** The group shown when the URL names none (or one this college has no data for). */
export const DEFAULT_HISTORY_GROUP: HistoryGroupKey = "cost";

export const HISTORY_GROUP_LABELS: Record<HistoryGroupKey, string> = {
  cost: "Cost",
  aid: "Aid",
  admissions: "Admissions",
  scores: "Test scores",
  students: "Students",
  academics: "Academics",
  outcomes: "Outcomes",
  changes: "Policy changes",
};

export function isHistoryGroup(value: unknown): value is HistoryGroupKey {
  return typeof value === "string" && (HISTORY_GROUP_KEYS as readonly string[]).includes(value);
}

/** A `?group=` value as Next passes it (string, repeated string, or absent) → a group key, or null. */
export function parseHistoryGroup(value: string | string[] | null | undefined): HistoryGroupKey | null {
  const v = Array.isArray(value) ? value[0] : value;
  return isHistoryGroup(v) ? v : null;
}

/**
 * The series each group draws. A group is offered when any of them exists; for Admissions' men/women chart both are
 * needed, but either alone never draws, and the group has other series, so "any" is the same rule in practice.
 */
const GROUP_SERIES: Record<Exclude<HistoryGroupKey, "changes">, readonly SeriesKey[]> = {
  cost: ["avg_paid_all", "full_price", "sticker_in_state", "sticker_out_of_state", "aided_net_price", ...NET_PRICE_BANDS],
  aid: ["grant_pct", "aid_generosity", "grant_avg", "federal_loan_rate"],
  admissions: ["applicants", "admitted", "enrolled", "acceptance_rate", "yield", "application_fee", "admit_rate_men", "admit_rate_women"],
  // The score charts are ranges: they need the 25th percentile (and its 75th) to draw anything.
  scores: ["sat_25", "act_25"],
  students: ["undergrads", "race_white", "men_share", "part_time_share", "housing_capacity", "out_of_state_share", "transfer_in_share"],
  academics: ["student_faculty_ratio", "faculty_full_time_share", "faculty_salary", "instruction_per_student"],
  outcomes: ["grad_rate", "median_debt", "om_award", "grad_rate_pell", "grad_rate_white"],
};

/** Groups with something to show, in display order. Policy changes need at least one change in the window. */
export function availableHistoryGroups(series: SchoolHistory["series"], changeCount: number): HistoryGroupKey[] {
  const out = HISTORY_GROUP_KEYS.filter((g) => (g === "changes" ? changeCount > 0 : GROUP_SERIES[g].some((k) => series[k])));
  // The caller renders Over time only when some history exists; if none of it charts, fall back to Cost (as before).
  return out.length ? out : [DEFAULT_HISTORY_GROUP];
}

/** The group to show: the requested one when this college has it, else the first available. */
export function pickHistoryGroup(requested: HistoryGroupKey | null | undefined, available: readonly HistoryGroupKey[]): HistoryGroupKey {
  if (requested && available.includes(requested)) return requested;
  return available[0] ?? DEFAULT_HISTORY_GROUP;
}
