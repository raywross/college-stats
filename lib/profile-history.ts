/**
 * What the profile's "Over time" page draws (specs/trends-design.md): the series in each chart group (they drive
 * the group's source footnote) and the national series sent down as bands. Pure module.
 */
import type { SeriesKey } from "./history";

/** Series each "Over time" group shows; they drive the group's source footnote. */
export const HISTORY_GROUPS = {
  cost: ["avg_paid_all", "full_price", "sticker_in_state", "sticker_out_of_state", "aided_net_price", "net_price_income_1"],
  aid: ["grant_pct", "grant_avg", "aid_generosity", "federal_loan_rate"],
  admissions: ["applicants", "admitted", "enrolled", "acceptance_rate", "yield", "admit_rate_men", "admit_rate_women", "application_fee"],
  scores: ["sat_25", "sat_75", "act_25", "act_75", "sat_submit", "test_policy"],
  students: ["undergrads", "race_white", "men_share", "part_time_share", "housing_capacity", "out_of_state_share", "international_share", "transfer_in_share", "transfer_in_count"],
  outcomes: ["grad_rate", "median_debt", "om_award", "om_transfer", "om_award_pell", "om_award_non_pell", "om_award_4", "om_award_6", "grad_rate_pell", "grad_rate_white"],
  academics: ["student_faculty_ratio", "faculty_full_time_share", "faculty_salary", "instruction_per_student"],
} as const satisfies Record<string, readonly SeriesKey[]>;

export type HistoryGroupKey = keyof typeof HISTORY_GROUPS;

/** Every series any group shows, for the page's closing source line. */
export const HISTORY_SERIES: readonly SeriesKey[] = [...new Set(Object.values(HISTORY_GROUPS).flat())];

/** National series the charts draw as a band (keeps the page payload small). */
export const BANDED: readonly SeriesKey[] = [
  "avg_paid_all",
  "grant_pct",
  "grant_avg",
  "acceptance_rate",
  "sat_25",
  "sat_75",
  "act_25",
  "act_75",
  "grad_rate",
  "median_debt",
  "men_share",
  "part_time_share",
  "federal_loan_rate",
  "student_faculty_ratio",
  "om_award",
  "om_transfer",
  "faculty_full_time_share",
  "faculty_salary",
  "out_of_state_share",
  "transfer_in_share",
];
