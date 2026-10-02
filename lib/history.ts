/**
 * Year-by-year history (specs/trends-data.md, specs/trends-design.md): the shapes of the files
 * `npm run sync-history` writes to data/history/, and pure helpers over them (inflation, windows, changes, the
 * "notable" rule, citations). No I/O and no runtime imports beyond other pure modules, so Node scripts, tests,
 * and client components can all use it.
 */
import { conferenceName } from "./conferences.ts";
import type { FieldPath } from "./fields";
import type { FormatKind } from "./format";
import type { TermKey } from "./glossary";
import type { DatasetMeta, SchoolTrends, SourceKey } from "./types";
import { simpsonIndex } from "./derive.ts";
import { MAX_PLAUSIBLE_GAP } from "./graduation-groups.ts";

/* ------------------------------------------------------------------ */
/* Series                                                              */
/* ------------------------------------------------------------------ */

/**
 * How a series' `year` reads. `year` is always a fall term: fall 2024 admissions and 2024–25 prices are both 2024,
 * and a graduation rate is stored at the fall its students entered ("cohort": the class that entered fall 2018).
 */
export type YearKind = "fall" | "academic" | "cohort";

/**
 * "score": SAT or ACT points. "code": a category stored as a number (test policy; see TEST_POLICY_CODES).
 * "conference": an IPEDS athletic conference code (lib/conferences.ts).
 */
export type SeriesUnit = "usd" | "count" | "share" | "score" | "code" | "conference";

/** Categories stored as numbers: no change, percentiles, or national stats (events read them instead). */
export const isCategorical = (unit: SeriesUnit): boolean => unit === "code" || unit === "conference";

/** A definition change: never draw a line or measure a change across it. */
export interface SeriesBreak {
  year: number;
  label: string;
  reason: string;
}

export interface SeriesDef {
  label: string;
  /** Short name for tooltips and legends. */
  short: string;
  /** The snapshot field this series extends back in time (label, glossary, and "last point = today" check). */
  field: FieldPath;
  term?: TermKey;
  unit: SeriesUnit;
  kind: YearKind;
  format: FormatKind;
  /** Where each year comes from; see HISTORY_FAMILIES. Derived series list every input's family. */
  families: readonly HistoryFamily[];
  /** Can be negative: net price goes below zero when grants exceed the cost of attendance. */
  signed?: true;
  breaks?: readonly SeriesBreak[];
}

/**
 * The IPEDS file families history reads. Each maps to the source it's cited as (data/meta.json `sources`).
 * Admissions lived in the Institutional Characteristics survey (`IC{year}`) until fall 2013, then moved to `ADM{year}`.
 */
export const HISTORY_FAMILIES = {
  "ic-admissions": { source: "ipeds-ic", kind: "fall", files: "IC{year} (admissions section)" },
  adm: { source: "ipeds-adm", kind: "fall", files: "ADM{year}" },
  prices: { source: "ipeds-ic", kind: "academic", files: "IC{year}_AY, then COST1_{year+1}" },
  sfa: { source: "ipeds-sfa", kind: "academic", files: "SFA{yy}{yy+1}, plus COST2_{year+1} since NCES moved residency and net price there" },
  characteristics: { source: "ipeds-ic", kind: "academic", files: "IC{year} (housing and application fee), then COST1_{year+1}" },
  services: { source: "ipeds-ic-char", kind: "academic", files: "IC{year} (athletics and ROTC)" },
  "ef-d": { source: "ipeds-ef", kind: "fall", files: "EF{year}D (student-to-faculty ratio)" },
  om: { source: "ipeds-om", kind: "cohort", files: "OM{year+8} (Outcome Measures, 8 years after entry)" },
  "gr-pell": { source: "ipeds-gr", kind: "cohort", files: "GR{year+6}_PELL_SSL (graduation by Pell Grant and subsidized loan status)" },
  // Faculty salary (specs/data-expansion/faculty.md): SAL{year}_IS, all-ranks row (ARANK 7). Starts 2016, the first
  // year with the equated 9-month figure (SAEQ9AT); earlier files used different, non-equated columns.
  "ipeds-sal": { source: "ipeds-sal", kind: "fall", files: "SAL{year}_IS (instructional staff salaries, all ranks)" },
  // Residence is required in even-numbered falls only (odd years cover about half the colleges): every other year.
  "ef-c": { source: "ipeds-ef-c", kind: "fall", files: "EF{year}C (residence of first-time students), even-numbered falls", step: 2 },
  // College Scorecard API, year-prefixed fields (not files): years can have gaps, so they aren't checked as consecutive.
  "scorecard-enrollment": { source: "scorecard", kind: "fall", files: "API fields {year}.student.size, {year}.student.demographics.race_ethnicity.*, .men, and {year}.student.part_time_share", api: true, citeAs: "enrollment" },
  "scorecard-completion": { source: "scorecard", kind: "cohort", files: "API field {year+6}.completion.completion_rate_4yr_150nt", api: true, citeAs: "graduation by entering class" },
  "scorecard-debt": { source: "scorecard", kind: "academic", files: "API field {year}.aid.median_debt.completers.overall", api: true, citeAs: "median debt" },
  "scorecard-loans": { source: "scorecard", kind: "academic", files: "API field {year+1}.aid.federal_loan_rate", api: true, citeAs: "federal loan rate" },
  "scorecard-completion-race": { source: "scorecard", kind: "cohort", files: "API fields {year+6}.completion.completion_rate_4yr_150_* and completion_cohort_4yr_150_* (by race and ethnicity)", api: true, citeAs: "graduation by race and ethnicity" },
  // Faculty (specs/data-expansion/faculty.md): full-time share, from IPEDS HR via Scorecard.
  "scorecard-faculty": { source: "scorecard", kind: "fall", files: "API field {year}.school.ft_faculty_rate", api: true, citeAs: "full-time faculty share" },
} as const satisfies Record<string, { source: SourceKey; kind: YearKind; files: string; api?: true; citeAs?: string; step?: number }>;

export type HistoryFamily = keyof typeof HISTORY_FAMILIES;

/** Years between a family's files: 1, or 2 for a survey part collected every other year (residence). */
export function familyStep(f: HistoryFamily): number {
  const fam = HISTORY_FAMILIES[f];
  return "step" in fam ? fam.step : 1;
}

/** Years between a series' points: its families' step (residence: every other fall). */
export function seriesStep(k: SeriesKey): number {
  return Math.max(...SERIES[k].families.map(familyStep));
}

const ADMISSIONS: readonly HistoryFamily[] = ["ic-admissions", "adm"];
const ENROLLMENT: readonly HistoryFamily[] = ["scorecard-enrollment"];

/**
 * The redesigned SAT (first given March 2016) is on a different scale; colleges switched with the class entering fall
 * 2017 (the same colleges' midpoints jumped a median of 65 points that year and were flat in every other year).
 */
export const SAT_BREAK: readonly SeriesBreak[] = [
  { year: 2017, label: "New SAT", reason: "The SAT was redesigned in 2016; earlier scores are on the old scale and aren't comparable." },
];

/** Test policy (IPEDS ADMCON7) as stored: "required" means the same in every era; the others shifted (see trends-data.md). */
export const TEST_POLICY_CODES = { required: 1, recommended: 2, "not-considered": 3, considered: 5 } as const;
/**
 * Code 3 meant "neither required nor recommended" until fall 2021; from fall 2022 (when "recommended" was dropped) it
 * means test scores aren't considered at all.
 */
export const TEST_BLIND_FROM = 2022;

export const SERIES = {
  applicants: { label: "Applicants", short: "Applied", field: "admissions.applicants", term: "applicants", unit: "count", kind: "fall", format: "compact", families: ADMISSIONS },
  admitted: { label: "Admitted", short: "Admitted", field: "admissions.admitted", term: "admitted", unit: "count", kind: "fall", format: "compact", families: ADMISSIONS },
  enrolled: { label: "Enrolled first-years", short: "Enrolled", field: "admissions.enrolled", term: "enrolled", unit: "count", kind: "fall", format: "compact", families: ADMISSIONS },
  acceptance_rate: { label: "Acceptance rate", short: "Acceptance rate", field: "admissions.acceptance_rate", term: "acceptance-rate", unit: "share", kind: "fall", format: "pctSmart", families: ADMISSIONS },
  yield: { label: "Yield", short: "Yield", field: "derived.yield", term: "yield", unit: "share", kind: "fall", format: "pct", families: ADMISSIONS },
  admit_rate_men: { label: "Acceptance rate, men", short: "Men", field: "derived.admit_rate_men", term: "admit-rate-by-sex", unit: "share", kind: "fall", format: "pctSmart", families: ADMISSIONS },
  admit_rate_women: { label: "Acceptance rate, women", short: "Women", field: "derived.admit_rate_women", term: "admit-rate-by-sex", unit: "share", kind: "fall", format: "pctSmart", families: ADMISSIONS },
  tuition_in_state: { label: "Tuition & fees, in-state", short: "Tuition, in-state", field: "cost.tuition_fees", term: "in-state-tuition", unit: "usd", kind: "academic", format: "money", families: ["prices"] },
  tuition_out_of_state: { label: "Tuition & fees, out-of-state", short: "Tuition, out-of-state", field: "cost.tuition_fees", term: "in-state-tuition", unit: "usd", kind: "academic", format: "money", families: ["prices"] },
  sticker_in_state: { label: "Full price, in-state", short: "Full price, in-state", field: "cost.sticker", term: "cost-of-attendance", unit: "usd", kind: "academic", format: "money", families: ["prices"] },
  sticker_out_of_state: { label: "Full price, out-of-state", short: "Full price, out-of-state", field: "cost.sticker", term: "cost-of-attendance", unit: "usd", kind: "academic", format: "money", families: ["prices"] },
  full_price: { label: "Full price", short: "Full price", field: "cost.breakdown", term: "cost-of-attendance", unit: "usd", kind: "academic", format: "money", families: ["prices", "sfa"] },
  avg_paid_all: { label: "Average total cost", short: "Average cost", field: "cost.avg_paid_all", term: "average-cost", unit: "usd", kind: "academic", format: "money", families: ["prices", "sfa"] },
  aided_net_price: { label: "Net price, students with grants", short: "Net price with grants", field: "cost.aided_net_price", term: "net-price", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  grant_pct: { label: "Share receiving grants", short: "Get grants", field: "aid.grant_pct", term: "grant-aid", unit: "share", kind: "academic", format: "pct", families: ["sfa"] },
  grant_avg: { label: "Average grant", short: "Average grant", field: "aid.grant_avg", term: "grant-aid", unit: "usd", kind: "academic", format: "money", families: ["sfa"] },
  housing_capacity: { label: "Housing capacity (beds)", short: "Beds", field: "campus.housing", term: "housing-capacity", unit: "count", kind: "academic", format: "compact", families: ["characteristics"] },
  application_fee: { label: "Application fee", short: "Application fee", field: "admissions.application_fee", term: "application-fee", unit: "usd", kind: "academic", format: "money", families: ["characteristics"] },
  // Housing policies as codes (1 yes, 2 no), for events (lib/events.ts).
  live_on: { label: "First-years must live on campus", short: "Live-on rule", field: "campus.housing", term: "live-on-requirement", unit: "code", kind: "academic", format: "int", families: ["characteristics"] },
  tuition_guarantee: { label: "Tuition guarantee", short: "Tuition guarantee", field: "cost.tuition_plans", term: "tuition-guarantee", unit: "code", kind: "academic", format: "int", families: ["characteristics"] },
  student_faculty_ratio: { label: "Students per faculty member", short: "Students/faculty", field: "academics.student_faculty_ratio", term: "student-faculty-ratio", unit: "count", kind: "fall", format: "int", families: ["ef-d"] },
  // Faculty (specs/data-expansion/faculty.md).
  faculty_full_time_share: { label: "Full-time faculty share", short: "Full-time faculty", field: "academics.faculty.full_time_share", term: "full-time-faculty", unit: "share", kind: "fall", format: "pct", families: ["scorecard-faculty"] },
  faculty_salary: { label: "Average faculty salary (9-month equated)", short: "Faculty salary", field: "academics.faculty", term: "nine-month-equated-salary", unit: "usd", kind: "fall", format: "money", families: ["ipeds-sal"] },
  // Where first-years come from (specs/data-expansion/residence.md): even-numbered falls only, shares of all first-years.
  out_of_state_share: { label: "First-years from other states", short: "Other states", field: "demographics.residence", term: "in-state-student", unit: "share", kind: "fall", format: "pct", families: ["ef-c"] },
  international_share: { label: "First-years from abroad", short: "From abroad", field: "demographics.residence", term: "in-state-student", unit: "share", kind: "fall", format: "pct", families: ["ef-c"] },
  // Athletics and ROTC as codes, for events (lib/events.ts; lib/campus-services.ts reads them).
  conference: { label: "Athletic conference", short: "Conference", field: "campus.athletics", term: "athletic-conference", unit: "conference", kind: "academic", format: "int", families: ["services"] },
  football_conference: { label: "Football conference", short: "Football conference", field: "campus.athletics", term: "athletic-conference", unit: "conference", kind: "academic", format: "int", families: ["services"] },
  athletic_association: { label: "Athletic association", short: "Association", field: "campus.athletics", term: "ncaa-division", unit: "code", kind: "academic", format: "int", families: ["services"] },
  rotc: { label: "ROTC", short: "ROTC", field: "campus.programs", term: "rotc", unit: "code", kind: "academic", format: "int", families: ["services"] },
  promise: { label: "Promise program", short: "Promise program", field: "cost.promise_program", term: "promise-program", unit: "code", kind: "academic", format: "int", families: ["characteristics"] },
  aid_generosity: { label: "Aid generosity", short: "Aid generosity", field: "derived.aid_generosity", term: "aid-generosity", unit: "share", kind: "academic", format: "pct", families: ["prices", "sfa"] },
  net_price_income_1: { label: "Net price, family income $0–30K", short: "$0–30K", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  net_price_income_2: { label: "Net price, family income $30–48K", short: "$30–48K", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  net_price_income_3: { label: "Net price, family income $48–75K", short: "$48–75K", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  net_price_income_4: { label: "Net price, family income $75–110K", short: "$75–110K", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  net_price_income_5: { label: "Net price, family income $110K+", short: "$110K+", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  sat_25: { label: "SAT total, 25th percentile", short: "SAT 25th", field: "derived.sat_composite", term: "sat", unit: "score", kind: "fall", format: "int", families: ADMISSIONS, breaks: SAT_BREAK },
  sat_75: { label: "SAT total, 75th percentile", short: "SAT 75th", field: "derived.sat_composite", term: "sat", unit: "score", kind: "fall", format: "int", families: ADMISSIONS, breaks: SAT_BREAK },
  act_25: { label: "ACT composite, 25th percentile", short: "ACT 25th", field: "admissions.act_composite_25_75", term: "act", unit: "score", kind: "fall", format: "int", families: ADMISSIONS },
  act_75: { label: "ACT composite, 75th percentile", short: "ACT 75th", field: "admissions.act_composite_25_75", term: "act", unit: "score", kind: "fall", format: "int", families: ADMISSIONS },
  // True medians exist from fall 2022 only: kept, but not charted until about 5 years exist (admissions-detail.md).
  sat_50: { label: "SAT total, median", short: "SAT median", field: "derived.sat_median", term: "median-vs-midpoint", unit: "score", kind: "fall", format: "int", families: ADMISSIONS, breaks: SAT_BREAK },
  act_50: { label: "ACT composite, median", short: "ACT median", field: "admissions.act_composite_median", term: "median-vs-midpoint", unit: "score", kind: "fall", format: "int", families: ADMISSIONS },
  sat_submit: { label: "Share submitting SAT", short: "Submitted SAT", field: "admissions.test_submission_rate_sat", term: "test-submission", unit: "share", kind: "fall", format: "pct", families: ADMISSIONS },
  act_submit: { label: "Share submitting ACT", short: "Submitted ACT", field: "admissions.test_submission_rate_act", term: "test-submission", unit: "share", kind: "fall", format: "pct", families: ADMISSIONS },
  test_policy: { label: "Test policy", short: "Test policy", field: "admissions.test_policy", term: "test-policy", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  // Admission factors as raw codes (lib/derive.ts factorCode); events are derived from them (lib/events.ts).
  factor_gpa: { label: "High school GPA", short: "GPA", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_class_rank: { label: "Class rank", short: "Class rank", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_hs_record: { label: "High school record", short: "School record", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_college_prep: { label: "College-prep program", short: "College prep", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_recommendations: { label: "Recommendations", short: "Recommendations", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_competencies: { label: "Demonstration of competencies", short: "Competencies", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_english_test: { label: "English proficiency test", short: "English test", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_other_test: { label: "Other tests", short: "Other tests", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_work_experience: { label: "Work experience", short: "Work experience", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_essay: { label: "Essay", short: "Essay", field: "admissions.factors", term: "admission-factor", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  factor_legacy: { label: "Legacy status", short: "Legacy", field: "admissions.factors", term: "legacy-status", unit: "code", kind: "fall", format: "int", families: ADMISSIONS },
  undergrads: { label: "Undergraduates", short: "Undergrads", field: "demographics.undergrad_enrollment", term: "undergrad-enrollment", unit: "count", kind: "fall", format: "compact", families: ENROLLMENT },
  race_white: { label: "White", short: "White", field: "demographics.racial_diversity", term: "race-ethnicity", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  race_asian: { label: "Asian", short: "Asian", field: "demographics.racial_diversity", term: "race-ethnicity", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  race_hispanic: { label: "Hispanic/Latino", short: "Hispanic/Latino", field: "demographics.racial_diversity", term: "race-ethnicity", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  race_black: { label: "Black", short: "Black", field: "demographics.racial_diversity", term: "race-ethnicity", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  race_two_or_more: { label: "Two or more", short: "Two or more", field: "demographics.racial_diversity", term: "race-ethnicity", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  race_international: { label: "International", short: "International", field: "demographics.racial_diversity", term: "race-ethnicity", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  race_other: { label: "Other/unknown", short: "Other/unknown", field: "demographics.racial_diversity", term: "race-ethnicity", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  men_share: { label: "Men (share of undergraduates)", short: "Men", field: "demographics.men_share", term: "gender-balance", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  part_time_share: { label: "Part-time students", short: "Part-time", field: "demographics.part_time_share", term: "part-time-student", unit: "share", kind: "fall", format: "pct", families: ENROLLMENT },
  grad_rate: { label: "Graduated within 6 years", short: "Graduated in 6 years", field: "outcomes.graduation_rate", term: "graduation-rate", unit: "share", kind: "cohort", format: "pct", families: ["scorecard-completion"] },
  median_debt: { label: "Median debt at graduation", short: "Median debt", field: "outcomes.median_debt", term: "median-debt", unit: "usd", kind: "academic", format: "money", families: ["scorecard-debt"] },
  federal_loan_rate: { label: "Undergraduates with a federal loan", short: "Federal loan", field: "outcomes.federal_loan_rate", term: "federal-loan-rate", unit: "share", kind: "academic", format: "pct", families: ["scorecard-loans"] },
  // 8-year outcomes for every entering student (specs/data-expansion/outcome-measures.md), by entering class.
  om_award: { label: "Earned a credential within 8 years, all entering students", short: "Credential in 8 years", field: "outcomes.eight_year", term: "outcome-measures", unit: "share", kind: "cohort", format: "pct", families: ["om"] },
  om_transfer: { label: "Enrolled at another college 8 years on, all entering students", short: "Enrolled elsewhere", field: "outcomes.eight_year", term: "transfer-out", unit: "share", kind: "cohort", format: "pct", families: ["om"] },
  om_award_pell: { label: "Earned a credential within 8 years, Pell Grant recipients", short: "Pell recipients", field: "outcomes.eight_year", term: "outcome-measures", unit: "share", kind: "cohort", format: "pct", families: ["om"] },
  om_award_non_pell: { label: "Earned a credential within 8 years, students without a Pell Grant", short: "No Pell Grant", field: "outcomes.eight_year", term: "outcome-measures", unit: "share", kind: "cohort", format: "pct", families: ["om"] },
  // Graduation by group (specs/data-expansion/graduation-by-group.md): rates null under 30 students; cohorts always kept.
  grad_rate_pell: { label: "Graduated within 6 years, Pell Grant recipients", short: "Pell recipients", field: "outcomes.grad_rate_pell", term: "pell-graduation-gap", unit: "share", kind: "cohort", format: "pct", families: ["gr-pell"] },
  grad_rate_no_pell_no_loan: { label: "Graduated within 6 years, neither Pell nor subsidized loan", short: "No Pell or subsidized loan", field: "outcomes.grad_rate_no_pell_no_loan", term: "pell-graduation-gap", unit: "share", kind: "cohort", format: "pct", families: ["gr-pell"] },
  grad_cohort_pell: { label: "Pell Grant recipients in the entering class", short: "Pell students", field: "outcomes.grad_cohorts", term: "adjusted-cohort", unit: "count", kind: "cohort", format: "num", families: ["gr-pell"] },
  grad_cohort_no_pell_no_loan: { label: "Students with neither in the entering class", short: "Students with neither", field: "outcomes.grad_cohorts", term: "adjusted-cohort", unit: "count", kind: "cohort", format: "num", families: ["gr-pell"] },
  grad_rate_white: { label: "Graduated within 6 years, White students", short: "White", field: "outcomes.grad_rate_by_race", term: "graduation-rate", unit: "share", kind: "cohort", format: "pct", families: ["scorecard-completion-race"] },
  grad_rate_asian: { label: "Graduated within 6 years, Asian students", short: "Asian", field: "outcomes.grad_rate_by_race", term: "graduation-rate", unit: "share", kind: "cohort", format: "pct", families: ["scorecard-completion-race"] },
  grad_rate_hispanic: { label: "Graduated within 6 years, Hispanic/Latino students", short: "Hispanic/Latino", field: "outcomes.grad_rate_by_race", term: "graduation-rate", unit: "share", kind: "cohort", format: "pct", families: ["scorecard-completion-race"] },
  grad_rate_black: { label: "Graduated within 6 years, Black students", short: "Black", field: "outcomes.grad_rate_by_race", term: "graduation-rate", unit: "share", kind: "cohort", format: "pct", families: ["scorecard-completion-race"] },
  grad_rate_two_or_more: { label: "Graduated within 6 years, students of two or more races", short: "Two or more", field: "outcomes.grad_rate_by_race", term: "graduation-rate", unit: "share", kind: "cohort", format: "pct", families: ["scorecard-completion-race"] },
  grad_rate_international: { label: "Graduated within 6 years, international students", short: "International", field: "outcomes.grad_rate_by_race", term: "graduation-rate", unit: "share", kind: "cohort", format: "pct", families: ["scorecard-completion-race"] },
  grad_cohort_white: { label: "White students in the entering class", short: "White students", field: "outcomes.grad_cohorts_by_race", term: "adjusted-cohort", unit: "count", kind: "cohort", format: "num", families: ["scorecard-completion-race"] },
  grad_cohort_asian: { label: "Asian students in the entering class", short: "Asian students", field: "outcomes.grad_cohorts_by_race", term: "adjusted-cohort", unit: "count", kind: "cohort", format: "num", families: ["scorecard-completion-race"] },
  grad_cohort_hispanic: { label: "Hispanic/Latino students in the entering class", short: "Hispanic/Latino students", field: "outcomes.grad_cohorts_by_race", term: "adjusted-cohort", unit: "count", kind: "cohort", format: "num", families: ["scorecard-completion-race"] },
  grad_cohort_black: { label: "Black students in the entering class", short: "Black students", field: "outcomes.grad_cohorts_by_race", term: "adjusted-cohort", unit: "count", kind: "cohort", format: "num", families: ["scorecard-completion-race"] },
  grad_cohort_two_or_more: { label: "Students of two or more races in the entering class", short: "Two-or-more students", field: "outcomes.grad_cohorts_by_race", term: "adjusted-cohort", unit: "count", kind: "cohort", format: "num", families: ["scorecard-completion-race"] },
  grad_cohort_international: { label: "International students in the entering class", short: "International students", field: "outcomes.grad_cohorts_by_race", term: "adjusted-cohort", unit: "count", kind: "cohort", format: "num", families: ["scorecard-completion-race"] },
} as const satisfies Record<string, SeriesDef>;

export type SeriesKey = keyof typeof SERIES;
export const SERIES_KEYS = Object.keys(SERIES) as SeriesKey[];
export const NET_PRICE_BANDS = ["net_price_income_1", "net_price_income_2", "net_price_income_3", "net_price_income_4", "net_price_income_5"] as const;
/** Race/ethnicity series in the site's fixed category order (lib/metrics.ts DEMOGRAPHIC_CATEGORIES). */
export const RACE_SERIES = {
  white: "race_white",
  asian: "race_asian",
  hispanic: "race_hispanic",
  black: "race_black",
  two_or_more: "race_two_or_more",
  international: "race_international",
  other: "race_other",
} as const satisfies Record<string, SeriesKey>;
/**
 * Graduation by race/ethnicity series (rate, cohort) per group, in the site's category order. American Indian/Alaska
 * Native and Pacific Islander groups are in the snapshot only: they rarely reach 30 students in an entering class.
 */
export const GRAD_RACE_SERIES = {
  white: ["grad_rate_white", "grad_cohort_white"],
  asian: ["grad_rate_asian", "grad_cohort_asian"],
  hispanic: ["grad_rate_hispanic", "grad_cohort_hispanic"],
  black: ["grad_rate_black", "grad_cohort_black"],
  two_or_more: ["grad_rate_two_or_more", "grad_cohort_two_or_more"],
  international: ["grad_rate_international", "grad_cohort_international"],
} as const satisfies Record<string, readonly [SeriesKey, SeriesKey]>;
/** Race/ethnicity history starts with fall 2010, when the new federal categories became required. */
export const RACE_FROM = 2010;
/** Federal loan rate: Scorecard year-prefixed values from key 2009 (the 2008–09 school year; checked 2026-09-29). */
export const LOAN_RATE_FROM = 2009;
/** Full-time faculty share: Scorecard year-prefixed `ft_faculty_rate` verified back to key 2005 (2026-10-02). */
export const FULL_TIME_FACULTY_FROM = 2005;
/**
 * Faculty salary: SAL{year}_IS from 2016, the first year with the equated 9-month column (`SAEQ9AT`); 2012–2015
 * files exist but use different, non-equated columns (checked 2026-10-02), so they're left out rather than mixed in.
 */
export const SALARY_FROM = 2016;
export function isSeriesKey(k: string): k is SeriesKey {
  return Object.prototype.hasOwnProperty.call(SERIES, k);
}

/* ------------------------------------------------------------------ */
/* Files in data/history/                                              */
/* ------------------------------------------------------------------ */

/** One series for one college: `values[i]` is year `start + i`. Gaps are null, never interpolated. */
export interface Series {
  start: number;
  values: (number | null)[];
  /** Years computed with a fallback formula (2007–08 average cost: share with grants × average grant). */
  approx?: number[];
}

/** data/history/schools/{unit_id}.json */
export interface SchoolHistory {
  unit_id: string;
  series: Partial<Record<SeriesKey, Series>>;
  /**
   * Fall terms left out of the admissions series because applicants, admits, and enrollees were identical to the
   * year before (a carried-forward report, not a new count).
   */
  repeated?: number[];
}

/** Distribution across colleges for one year: [25th percentile, median, 75th percentile, colleges reporting]. */
export type YearStats = [number, number, number, number];

/** A college's change over the default window, as it's distributed nationally (for the "notable" rule). */
export interface ChangeStats {
  from: number;
  to: number;
  /** "ratio" = relative change (money after inflation, counts); "points" = difference in shares. */
  measure: "ratio" | "points";
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  n: number;
}

/** data/history/national.json: every college in the dataset, whether or not its shard is written. */
export interface NationalHistory {
  series: Partial<Record<SeriesKey, { start: number; stats: (YearStats | null)[] }>>;
  changes: Partial<Record<SeriesKey, ChangeStats>>;
}

/** One file NCES published, as used for one year. */
export interface HistoryFile {
  year: number;
  file: string;
  url: string;
  /** NCES's revised release (the `_rv` CSV inside the zip). */
  revised: boolean;
}

/** data/history/meta.json: what the build read and when. */
export interface HistoryMeta {
  built: string;
  /** Default window: the last 10 years ending with the latest, per year kind. */
  latest: Record<YearKind, number>;
  files: Record<HistoryFamily, HistoryFile[]>;
  /** The newest year of a family whose earlier years were revised but this one hasn't been yet. */
  provisional: Partial<Record<HistoryFamily, number>>;
  /** Colleges with a shard in data/history/schools/ (every college unless the build was limited with --ids). */
  schools: number;
  /** Colleges in the dataset, which national.json and facts.json cover. */
  universe: number;
}

/** data/history/cpi.json: CPI-U school-year averages (July–June), as NCES's Digest uses. */
export interface CpiTable {
  series: string;
  label: string;
  url: string;
  retrieved: string;
  basis: string;
  start: number;
  values: number[];
  /** Months missing from BLS (e.g. October 2025, not collected during the funding lapse), averaged without them. */
  missing: string[];
}

/** data/history/facts.json: the Home page's national trend facts (fixed panels; see specs/trends-design.md). */
export interface TrendFacts {
  priceGap: {
    from: number;
    to: number;
    /** Colleges reporting both measures in both years. */
    n: number;
    /** Change in the panel's median after inflation, e.g. 0.12 = +12%. */
    fullPriceChange: number;
    avgPaidChange: number;
    /** Panel medians per year, indexed to 100 at `from` (after inflation). */
    fullPriceIndex: (number | null)[];
    avgPaidIndex: (number | null)[];
  } | null;
  harderToGetIn: {
    from: number;
    to: number;
    n: number;
    applicantsChange: number;
    enrolledChange: number;
    /** Applications per enrolled first-year, per year, summed over the panel. */
    perSeat: (number | null)[];
  } | null;
  /** Share of colleges requiring the SAT or ACT, the last fall before the pandemic vs the latest (fixed panel). */
  testRequired: {
    from: number;
    to: number;
    n: number;
    requiredFrom: number;
    requiredTo: number;
    /** Per fall from `from` to `to`. */
    byYear: (number | null)[];
  } | null;
  /**
   * Colleges considering legacy status, fall 2022 (when IPEDS began asking) to the newest fall, on a fixed panel
   * (specs/data-expansion/admission-factors.md). Optional: histories built before it have none.
   */
  legacy?: {
    from: number;
    to: number;
    n: number;
    consideredFrom: number;
    consideredTo: number;
    /** Colleges that considered it at `from` and not at `to`, and the reverse. */
    stopped: number;
    started: number;
    /** Share considering it, per fall from `from` to `to`. */
    byYear: (number | null)[];
  } | null;
}

/* ------------------------------------------------------------------ */
/* Years                                                               */
/* ------------------------------------------------------------------ */

/** "Fall 2024", "2023–24", or "Entered fall 2018". */
export function historyYearLabel(year: number, kind: YearKind): string {
  if (kind === "cohort") return `Entered fall ${year}`;
  return kind === "fall" ? `Fall ${year}` : `${year}–${String(year + 1).slice(2)}`;
}

/** Compact axis label: "2024" or "’23–24". */
export function axisYearLabel(year: number, kind: YearKind): string {
  return kind === "academic" ? `’${String(year).slice(2)}–${String(year + 1).slice(2)}` : String(year);
}

export function valueAt(s: Series | undefined, year: number): number | null {
  if (!s) return null;
  const i = year - s.start;
  return i >= 0 && i < s.values.length ? s.values[i] : null;
}

export function lastYear(s: Series): number {
  return s.start + s.values.length - 1;
}

/** The latest reported year and value. */
export function latestPoint(s: Series | undefined): { year: number; value: number } | null {
  if (!s) return null;
  for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return { year: s.start + i, value: s.values[i]! };
  return null;
}

/** The earliest reported year at or after `from`. */
export function firstPointFrom(s: Series | undefined, from: number): { year: number; value: number } | null {
  if (!s) return null;
  for (let i = Math.max(0, from - s.start); i < s.values.length; i++) if (s.values[i] !== null) return { year: s.start + i, value: s.values[i]! };
  return null;
}

export const WINDOW_YEARS = 10;

/** The default window: 10 years ending with the latest year of that kind (e.g. 2013–14 → 2023–24). */
export function defaultWindow(meta: Pick<HistoryMeta, "latest">, kind: YearKind): [number, number] {
  const to = meta.latest[kind];
  return [to - WINDOW_YEARS, to];
}

/* ------------------------------------------------------------------ */
/* Inflation                                                           */
/* ------------------------------------------------------------------ */

export function cpiFor(cpi: CpiTable, year: number): number | null {
  const i = year - cpi.start;
  return i >= 0 && i < cpi.values.length ? cpi.values[i] : null;
}

/** `value` from `year` in `base`-year dollars. Null when either year's CPI is missing. */
export function real(value: number, year: number, cpi: CpiTable, base: number): number | null {
  const from = cpiFor(cpi, year);
  const to = cpiFor(cpi, base);
  return from && to ? (value * to) / from : null;
}

/** A money series converted to `base`-year dollars (others unchanged). */
export function inDollarsOf(s: Series, unit: SeriesUnit, cpi: CpiTable, base: number): Series {
  if (unit !== "usd") return s;
  return { ...s, values: s.values.map((v, i) => (v === null ? null : real(v, s.start + i, cpi, base))) };
}

/* ------------------------------------------------------------------ */
/* Change over a window                                                */
/* ------------------------------------------------------------------ */

export interface Change {
  key: SeriesKey;
  from: { year: number; value: number };
  to: { year: number; value: number };
  /** Relative change for money (after inflation) and counts; difference for shares. */
  measure: "ratio" | "points";
  change: number;
}

/** Below these bases a percent change misleads; show "from → to" instead (specs/trends-design.md). */
const TINY_BASE: Partial<Record<SeriesKey, number>> = {
  applicants: 200,
  admitted: 100,
  enrolled: 50,
  // A ratio like 9 to 1 is always small: "9 → 8" reads right where "−11%" overstates it.
  student_faculty_ratio: Infinity,
};

/**
 * Change from the window's start (or the first year after it the college reports) to its end. Money compares in
 * `to`-year dollars. Null without both endpoints, or when the start is more than 2 years late (a different window).
 */
export function changeOver(key: SeriesKey, s: Series | undefined, window: [number, number], cpi: CpiTable): Change | null {
  const def = SERIES[key];
  const end = valueAt(s, window[1]);
  const start = firstPointFrom(s, window[0]);
  if (end === null || !start || start.year > window[0] + 2 || start.year >= window[1]) return null;
  // Never measure across a definition change (e.g. the SAT redesign).
  if (((def as SeriesDef).breaks ?? []).some((b) => b.year > start.year && b.year <= window[1])) return null;
  if (isCategorical(def.unit)) return null;
  const measure = def.unit === "share" ? "points" : "ratio";
  let from = start.value;
  if (def.unit === "usd") {
    const r = real(from, start.year, cpi, window[1]);
    if (r === null) return null;
    from = r;
  }
  if (measure === "ratio" && from <= 0) return null;
  const change = measure === "points" ? end - from : end / from - 1;
  return { key, from: { year: start.year, value: from }, to: { year: window[1], value: end }, measure, change };
}

export function isTinyBase(c: Change): boolean {
  const min = TINY_BASE[c.key];
  return min !== undefined && Math.min(c.from.value, c.to.value) < min;
}

/**
 * Floors a change must clear to count as notable, on top of being outside the national middle half
 * (specs/trends-design.md): cost ±5% after inflation, admit rate ±3 points, applicants ±25%, grant share ±5 points.
 */
export const NOTABLE_FLOORS: Partial<Record<SeriesKey, number>> = {
  avg_paid_all: 0.05,
  full_price: 0.05,
  acceptance_rate: 0.03,
  applicants: 0.25,
  grant_pct: 0.05,
  undergrads: 0.1,
};

/** Beyond the national 25th/75th percentile of the same change, and past the floor. */
export function isNotable(c: Change, national: NationalHistory): boolean {
  const floor = NOTABLE_FLOORS[c.key];
  const stats = national.changes[c.key];
  if (floor === undefined || !stats || isTinyBase(c)) return false;
  if (Math.abs(c.change) < floor) return false;
  return c.change < stats.p25 || c.change > stats.p75;
}

/** Changes the Overview "10 years" tile may add after average cost, in priority order (specs/trends-design.md). */
export const TILE_CANDIDATES: readonly SeriesKey[] = ["full_price", "acceptance_rate", "applicants", "undergrads", "grant_pct"];

/**
 * The profile's "10 years" tile: average total cost over the default window (always shown when available), then up
 * to two notable changes.
 */
export function tenYearSummary(
  h: SchoolHistory,
  national: NationalHistory,
  cpi: CpiTable,
  meta: Pick<HistoryMeta, "latest">
): { avgCost: Change | null; notable: Change[] } {
  const change = (k: SeriesKey) => changeOver(k, h.series[k], defaultWindow(meta, SERIES[k].kind), cpi);
  const notable = TILE_CANDIDATES.map(change)
    .filter((c): c is Change => c !== null && isNotable(c, national))
    .slice(0, 2);
  return { avgCost: change("avg_paid_all"), notable };
}

/** The measures summarized into school.trends (data/schools.json). */
export const TREND_KEYS = ["avg_paid_all", "full_price", "acceptance_rate", "applicants", "undergrads", "grant_pct", "men_share", "federal_loan_rate"] as const satisfies readonly SeriesKey[];

/** Diversity index (Simpson's, as lib/metrics.ts `diversityIndex`) from the race/ethnicity shares in one fall. */
export function diversityIndexAt(h: SchoolHistory, year: number): number | null {
  const shares = Object.values(RACE_SERIES).map((k) => valueAt(h.series[k], year));
  return shares.some((v) => v === null) ? null : simpsonIndex(shares as number[]);
}

/** Below this many undergrads at either end, a few students swing the shares (same floor as the size change). */
export const DIVERSITY_MIN_UNDERGRADS = 300;
/**
 * "Other" folds unknown race in with American Indian/Alaska Native and Pacific Islander students. When it moves more
 * than this, the change mostly reflects reporting (students whose race wasn't recorded), not who enrolls.
 */
export const DIVERSITY_MAX_OTHER_SHIFT = 0.1;

/**
 * Change in the diversity index over the default fall window, in index points. Same endpoint rule as changeOver: the
 * window's last fall, and its first fall or up to 2 years later. Null for small colleges and when the other/unknown
 * share shifts a lot (see the constants above; specs/trend-indicators.md).
 */
export function diversityChange(h: SchoolHistory, meta: Pick<HistoryMeta, "latest">): { since: number; from: number; to: number; change: number } | null {
  const [start, end] = defaultWindow(meta, "fall");
  const to = diversityIndexAt(h, end);
  if (to === null) return null;
  for (let y = Math.max(start, RACE_FROM); y <= start + 2; y++) {
    const from = diversityIndexAt(h, y);
    if (from === null) continue;
    const size = [y, end].map((yr) => valueAt(h.series.undergrads, yr));
    if (size.some((n) => n === null || n < DIVERSITY_MIN_UNDERGRADS)) return null;
    const other = [y, end].map((yr) => valueAt(h.series[RACE_SERIES.other], yr)!);
    if (Math.abs(other[1] - other[0]) > DIVERSITY_MAX_OTHER_SHIFT) return null;
    return { since: y, from, to, change: to - from };
  }
  return null;
}

/**
 * Pell graduation gap (neither minus Pell, points) for an entering class; null unless both rates are reported (each
 * already needs 30+ students).
 */
export function pellGapAt(h: SchoolHistory, year: number): number | null {
  const pell = valueAt(h.series.grad_rate_pell, year);
  const neither = valueAt(h.series.grad_rate_no_pell_no_loan, year);
  if (pell === null || neither === null) return null;
  // Implausibly far apart: groups sorted inconsistently (lib/graduation-groups.ts MAX_PLAUSIBLE_GAP).
  return Math.abs(neither - pell) > MAX_PLAUSIBLE_GAP ? null : neither - pell;
}

/** Below this many Pell recipients in either entering class, the gap swings too much to compare over time. */
export const PELL_GAP_MIN_COHORT = 100;

/**
 * Change in the Pell graduation gap over the default cohort window, in points (specs/data-expansion/graduation-by-group.md).
 * Same endpoint rule as changeOver: the window's last entering class, and its first or up to 2 classes later (GR2016,
 * the first file, follows the class of 2010). Null when either class had under PELL_GAP_MIN_COHORT Pell recipients.
 */
export function pellGapChange(h: SchoolHistory, meta: Pick<HistoryMeta, "latest">): { since: number; from: number; to: number; change: number } | null {
  const [start, end] = defaultWindow(meta, "cohort");
  const big = (y: number) => (valueAt(h.series.grad_cohort_pell, y) ?? 0) >= PELL_GAP_MIN_COHORT;
  const to = pellGapAt(h, end);
  if (to === null || !big(end)) return null;
  for (let y = start; y <= start + 2; y++) {
    const from = pellGapAt(h, y);
    if (from === null) continue;
    return big(y) ? { since: y, from, to, change: to - from } : null;
  }
  return null;
}

/** A college's 10-year changes for school.trends; empty when none can be measured. */
export function trendSummary(h: SchoolHistory, cpi: CpiTable, meta: Pick<HistoryMeta, "latest">): SchoolTrends {
  const out: SchoolTrends = {};
  // `|| 0` turns -0 into 0, which is how JSON stores it.
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;
  for (const k of TREND_KEYS) {
    const c = changeOver(k, h.series[k], defaultWindow(meta, SERIES[k].kind), cpi);
    if (!c) continue;
    const r = (v: number) => (SERIES[k].unit === "share" ? r4(v) : Math.round(v) || 0);
    out[k] = { since: c.from.year, from: r(c.from.value), to: r(c.to.value), change: r4(c.change) };
  }
  const d = diversityChange(h, meta);
  if (d) out.diversity = { since: d.since, from: r4(d.from), to: r4(d.to), change: r4(d.to - d.from) };
  const g = pellGapChange(h, meta);
  if (g) out.pell_gap = { since: g.since, from: r4(g.from), to: r4(g.to), change: r4(g.to - g.from) };
  return out;
}

/** "+12%", "−3 pts": signed, with a true minus sign. */
export function formatChange(c: Pick<Change, "measure" | "change">): string {
  const sign = c.change > 0 ? "+" : c.change < 0 ? "−" : "";
  const abs = Math.abs(c.change);
  return c.measure === "points" ? `${sign}${Math.round(abs * 100)} pts` : `${sign}${Math.round(abs * 100).toLocaleString("en-US")}%`;
}

/* ------------------------------------------------------------------ */
/* Citations                                                           */
/* ------------------------------------------------------------------ */

/** One family's contribution to a set of series: e.g. IPEDS Admissions, fall 2014 to fall 2024. */
export interface HistorySource {
  key: SourceKey;
  label: string;
  publisher: string;
  /** "Fall 2014 to Fall 2024" */
  years: string;
  url: string;
  files: string;
}

/** NCES's index of every IPEDS data file by year, where each cited file can be downloaded. */
export const IPEDS_DATA_FILES_URL = "https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx";

/**
 * The distinct sources behind a set of series, with the years each covered. Reads only data/history/meta.json.
 * `range` limits it to the years a view uses (e.g. a 10-year fact cites only the files in those years).
 */
/** Years to cite: one range for all, or one per year kind (a view mixing fall and academic windows). */
export type HistoryRange = [number, number] | Partial<Record<YearKind, [number, number]>>;

export function historySources(keys: readonly SeriesKey[], hmeta: HistoryMeta, meta: DatasetMeta, range?: HistoryRange): HistorySource[] {
  const families = [...new Set(keys.flatMap((k) => SERIES[k].families))];
  const out: HistorySource[] = [];
  for (const f of families) {
    const r = !range ? null : Array.isArray(range) ? range : range[HISTORY_FAMILIES[f].kind] ?? null;
    const files = hmeta.files[f]?.filter((x) => !r || (x.year >= r[0] && x.year <= r[1]));
    if (!files?.length) continue;
    const fam = HISTORY_FAMILIES[f];
    const info = meta.sources[fam.source];
    // Not published yet (code deployed ahead of its data): leave it out until the publish lands.
    if (!info) continue;
    const first = files[0].year;
    const last = files[files.length - 1].year;
    const qualifier = f === "ic-admissions" ? "admissions section" : "citeAs" in fam ? fam.citeAs : null;
    out.push({
      key: fam.source,
      label: qualifier ? `${info.label} (${qualifier})` : info.label,
      publisher: info.publisher,
      years:
        fam.kind === "cohort"
          ? `classes entering fall ${first} to fall ${last}`
          : `${historyYearLabel(first, fam.kind)} to ${historyYearLabel(last, fam.kind)}`,
      url: IPEDS_DATA_FILES_URL,
      files: fam.files,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Validation (sync-history before writing; check:lineage on the files) */
/* ------------------------------------------------------------------ */

/** Problems with one shard: unknown series, malformed arrays, or values that can't be right. */
export function validateShard(h: SchoolHistory, knownIds?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const where = `history ${h.unit_id}`;
  if (knownIds && !knownIds.has(h.unit_id)) errors.push(`${where}: not a college in data/schools.json`);
  for (const [k, s] of Object.entries(h.series)) {
    if (!isSeriesKey(k)) {
      errors.push(`${where}: unknown series "${k}" (register it in SERIES, lib/history.ts)`);
      continue;
    }
    if (!s || !Number.isInteger(s.start) || !Array.isArray(s.values) || !s.values.length) {
      errors.push(`${where}: ${k} is malformed`);
      continue;
    }
    if (s.values[0] === null || s.values[s.values.length - 1] === null) errors.push(`${where}: ${k} isn't trimmed to reported years`);
    const def: SeriesDef = SERIES[k];
    const codes: readonly number[] = Object.values(TEST_POLICY_CODES);
    for (const v of s.values) {
      if (v === null) continue;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        (v < 0 && !def.signed) ||
        (def.unit === "share" && v > 1) ||
        (def.unit === "code" && !codes.includes(v)) ||
        (def.unit === "conference" && conferenceName(v) === null) ||
        (def.unit === "score" && v > 1600)
      ) {
        errors.push(`${where}: ${k} has an impossible value ${v}`);
        break;
      }
    }
  }
  return errors;
}

/** Problems with the history metadata's fit with the dataset (every family cites a known source). */
export function validateHistoryMeta(hmeta: HistoryMeta, meta: DatasetMeta): string[] {
  const errors: string[] = [];
  for (const f of Object.keys(HISTORY_FAMILIES) as HistoryFamily[]) {
    if (!(HISTORY_FAMILIES[f].source in meta.sources)) errors.push(`history: family ${f} cites unknown source ${HISTORY_FAMILIES[f].source}`);
    const files = hmeta.files[f];
    const api = "api" in HISTORY_FAMILIES[f];
    if (!files?.length) errors.push(`history meta: no files recorded for ${f}`);
    else if (!api && files.some((x, i) => i > 0 && x.year !== files[i - 1].year + familyStep(f))) errors.push(`history meta: ${f} years aren't consecutive`);
  }
  return errors;
}
