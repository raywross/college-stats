/**
 * The college profile's topic pages (specs/profile-redesign.md): their routes, labels, colors, the fields each
 * shows (for its source footnote and the coverage test), and where the old in-page anchors went.
 *
 * Pure module (type-only imports), so tests load it directly.
 */
import type { Domain } from "./metrics";
import type { FieldPath } from "./fields";

export type TopicKey = "admissions" | "students" | "academics" | "cost" | "outcomes" | "history";

export interface ProfileTopic {
  key: TopicKey;
  /** Pill and card text. */
  label: string;
  /** Eyebrow above the page title. */
  eyebrow: string;
  /** Color domain of the pill dot and eyebrow; null uses the site primary (history). */
  domain: Domain | null;
  /** One line for the overview's topic links. */
  description: string;
}

export const PROFILE_TOPICS: readonly ProfileTopic[] = [
  { key: "admissions", label: "Getting in", eyebrow: "Admissions", domain: "admissions", description: "Applicants, admits, yield, test scores, and what the college weighs." },
  { key: "students", label: "Students & campus", eyebrow: "Students", domain: "access", description: "Who's on campus, where they come from, housing, sports, and services." },
  { key: "academics", label: "Academics", eyebrow: "Academics", domain: "size", description: "Popular and top-earning majors, faculty, and spending per student." },
  { key: "cost", label: "Cost & aid", eyebrow: "Cost & aid", domain: "value", description: "What students pay, price by family income, debt, and who gets grants." },
  { key: "outcomes", label: "Outcomes", eyebrow: "Outcomes", domain: "value", description: "Earnings, staying and finishing, 8-year outcomes, and graduation by group." },
  { key: "history", label: "Over time", eyebrow: "Over time", domain: null, description: "Ten-plus years of cost, aid, admissions, scores, students, and outcomes." },
];

export const TOPIC_KEYS: readonly TopicKey[] = PROFILE_TOPICS.map((t) => t.key);

export function isTopicKey(key: string): key is TopicKey {
  return (TOPIC_KEYS as readonly string[]).includes(key);
}

export function topicOf(key: TopicKey): ProfileTopic {
  return PROFILE_TOPICS.find((t) => t.key === key)!;
}

/** `/schools/{id}`: the overview. */
export function overviewHref(unitId: string): string {
  return `/schools/${unitId}`;
}

/** `/schools/{id}/{topic}`, with an optional in-page anchor (`#scores`). */
export function topicHref(unitId: string, key: TopicKey, hash?: string): string {
  return `${overviewHref(unitId)}/${key}${hash ? `#${hash}` : ""}`;
}

/** The topics before and after `key` among those the college has (`available`, in PROFILE_TOPICS order). */
export function adjacentTopics(key: TopicKey, available: readonly TopicKey[]): { prev: ProfileTopic | null; next: ProfileTopic | null } {
  const order = PROFILE_TOPICS.filter((t) => available.includes(t.key));
  const i = order.findIndex((t) => t.key === key);
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null };
}

/**
 * Where the single-page profile's section anchors live now. The overview's AnchorRedirect sends `#scores` to
 * `/schools/{id}/admissions#scores`; anchors not listed here (overview, ranks, similar) stay on the overview.
 */
export const ANCHOR_TOPICS: Readonly<Record<string, { topic: TopicKey; hash?: string }>> = {
  admissions: { topic: "admissions" },
  scores: { topic: "admissions", hash: "scores" },
  students: { topic: "students" },
  campus: { topic: "students", hash: "campus" },
  academics: { topic: "academics" },
  cost: { topic: "cost" },
  history: { topic: "history" },
};

/**
 * The values each page shows. Drives its source footnote and the notice when some values come from a different
 * source. Showing a new value? Add its field to the page that shows it. tests/profile-topics.test.mts checks that the
 * union still covers everything the single-page profile showed.
 */
export const OVERVIEW_FIELDS: readonly FieldPath[] = [
  // Hero: the glossary terms under the name.
  "campus.carnegie",
  "campus.designations",
  "campus.msi",
  // Getting in card.
  "admissions.acceptance_rate",
  "admissions.applicants",
  "admissions.admitted",
  "derived.yield",
  "derived.sat_composite",
  "admissions.act_composite_25_75",
  // Newer admit rate the college published itself (ReportedRateLine; specs/college-reported-data.md).
  "reported.admissions.acceptance_rate",
  // First-years' average GPA from the college's CDS (specs/data-expansion/cds-admissions.md).
  "reported.admission_profile.gpa.average",
  // The card's SAT bar and the hero's test policy (cds-test-scores-and-policy.md).
  "derived.sat_total",
  "admissions.test_policy",
  // Students & campus card.
  "demographics.undergrad_enrollment",
  "derived.diversity_index",
  "demographics.racial_diversity",
  "demographics.pell_grant_percent",
  "demographics.first_gen_percent",
  "campus.setting",
  "campus.housing",
  "campus.athletics",
  "campus.programs",
  // Academics card.
  "academics.student_faculty_ratio",
  "academics.majors_top",
  "detail.programs",
  "academics.faculty.full_time_share",
  "finances",
  // Cost & aid card.
  "cost.avg_paid_all",
  "derived.aid_generosity",
  "cost.sticker",
  "cost.aided_net_price",
  "cost.net_price_by_income",
  "outcomes.federal_loan_rate",
  // Outcomes card.
  "outcomes.graduation_rate",
  "outcomes.median_earnings_10yr",
  "outcomes.median_debt",
  "outcomes.monthly_loan_payment",
  "outcomes.retention_rate",
  // The ten-year lines and the Over time card's direction words.
  "trends",
];

export const TOPIC_FIELDS: Readonly<Record<TopicKey, readonly FieldPath[]>> = {
  admissions: [
    "admissions.applicants",
    "admissions.admitted",
    "admissions.enrolled",
    "admissions.acceptance_rate",
    "derived.yield",
    "admissions.by_sex",
    "derived.admit_rate_men",
    "derived.admit_rate_women",
    "admissions.application_fee",
    "admissions.accepts_ap_credit",
    "admissions.factors",
    // The admissions map (acceptance rate vs. SAT) and the SAT-midpoint strip, from the old "How it ranks".
    "derived.sat_mid",
    // Test scores.
    "admissions.sat_reading_25_75",
    "admissions.sat_math_25_75",
    "admissions.act_composite_25_75",
    "admissions.test_submission_rate_sat",
    "admissions.test_submission_rate_act",
    "admissions.test_policy",
    "admissions.sat_reading_median",
    "admissions.sat_math_median",
    "admissions.act_composite_median",
    "admissions.act_english_25_75",
    "admissions.act_math_25_75",
    "derived.sat_median",
    // Newer figures the college published itself (specs/college-reported-data.md), shown next to the baseline.
    "reported.admissions.applicants",
    "reported.admissions.admitted",
    "reported.admissions.enrolled",
    "reported.admissions.acceptance_rate",
    // Where applicants live: CDS C1 by residency (specs/data-expansion/cds-residency-admissions.md).
    "derived.admit_rate_in_state",
    "derived.admit_rate_out_of_state",
    "derived.admit_rate_international",
    "derived.yield_in_state",
    "derived.yield_out_of_state",
    "derived.yield_international",
    "derived.admit_rate_same_class",
    // CDS admissions profile (specs/data-expansion/cds-admissions.md): wait list, early rounds, factor weights, GPA.
    "reported.admission_profile.wait_list.admitted",
    "reported.admission_profile.early_decision.applicants",
    "reported.admission_profile.early_decision.admitted",
    "derived.ed_admit_rate",
    "reported.admission_profile.early_action.offered",
    "reported.admission_profile.factors.rigor",
    "admissions.factors.legacy",
    "reported.admission_profile.gpa.average",
    "reported.admission_profile.gpa.bands.all",
    "reported.admission_profile.class_rank.submitted_share",
    // CDS C8/C9 (specs/data-expansion/cds-test-scores-and-policy.md): the Test policy block, the SAT total, bands, counts.
    "derived.sat_total",
    "reported.test_policy",
    "reported.test_policy_note",
    "reported.test_policy_events",
    "reported.tests.sat_composite",
    "reported.tests.sat_submitters",
    "reported.tests.act_submitters",
    "reported.tests.act_science",
    "reported.tests.act_reading",
    "reported.tests.bands.sat_composite",
    "reported.tests.bands.act_composite",
    "reported.tests.bands.sat_ebrw",
    "reported.tests.bands.sat_math",
    "reported.tests.bands.act_english",
    "reported.tests.bands.act_math",
    // Transferring in: CDS section D (specs/data-expansion/cds-transfer.md).
    "reported.transfer.enrolls_transfers",
    "reported.transfer.advanced_standing",
    "reported.transfer.applicants",
    "reported.transfer.admitted",
    "reported.transfer.enrolled",
    "reported.transfer.admit_rate",
    "reported.transfer.terms",
    "reported.transfer.min_credits",
    "reported.transfer.required_materials",
    "reported.transfer.min_hs_gpa",
    "reported.transfer.min_college_gpa",
    "reported.transfer.dates",
    // Applying and What you'll need in high school: CDS C3–C5, C13–C18 (specs/data-expansion/cds-application-logistics.md).
    "reported.admissions_logistics.fee",
    "reported.admissions_logistics.regular_closing",
    "reported.admissions_logistics.priority_date",
    "reported.admissions_logistics.notification",
    "reported.admissions_logistics.reply",
    "reported.admissions_logistics.housing_deposit",
    "reported.admissions_logistics.deferred_admission",
    "reported.admissions_hs_prep.completion",
    "reported.admissions_hs_prep.college_prep",
    "reported.admissions_hs_prep.units_required",
    "reported.admissions_hs_prep.units_recommended",
  ],
  students: [
    "demographics.racial_diversity",
    "derived.diversity_index",
    "demographics.pell_grant_percent",
    "demographics.first_gen_percent",
    "demographics.undergrad_enrollment",
    "demographics.men_share",
    "demographics.women_share",
    "demographics.part_time_share",
    "demographics.age_25_plus_share",
    "demographics.residence",
    "demographics.transfer_in",
    "detail.home_states",
    // Campus life.
    "campus.housing",
    "campus.athletics",
    "campus.programs",
    "campus.services",
    "campus.calendar",
    "demographics.disability_services",
    // LGBTQ+ life (specs/lgbtq-life.md): another-gender counts (also beside men and women) and the state-law line.
    "lgbtq.gender",
    "lgbtq.admissions",
    "lgbtq.state_law",
  ],
  academics: [
    "academics.bachelors_awarded",
    "academics.majors_top",
    "detail.majors",
    "detail.programs",
    "academics.programs_with_earnings",
    "academics.student_faculty_ratio",
    "academics.faculty",
    "academics.faculty.full_time_share",
    "finances",
    // CDS academics (specs/data-expansion/cds-academics.md): class sizes, the college's own ratio, programs, core.
    "reported.academics.class_sections",
    "derived.class_share_under_20",
    "derived.class_share_50_plus",
    "reported.academics.student_faculty_ratio",
    "reported.academics.programs",
    "reported.academics.core_curriculum",
    "campus.programs",
  ],
  cost: [
    "cost.avg_paid_all",
    "cost.sticker",
    "cost.tuition_fees",
    "cost.residency",
    "cost.aided_net_price",
    "cost.net_price_by_income",
    "derived.aid_generosity",
    "aid.grant_pct",
    "aid.grant_avg",
    "aid.institutional_pct",
    "aid.pell_pct",
    "aid.loan_pct",
    "aid.by_income",
    "outcomes.median_debt",
    "outcomes.monthly_loan_payment",
    "outcomes.federal_loan_rate",
    "outcomes.median_debt_pell",
    "outcomes.median_debt_no_pell",
    "outcomes.median_debt_by_income",
    "outcomes.repayment_3yr",
    "cost.tuition_plans",
    "cost.promise_program",
    "derived.payback_years",
    // The payback estimate divides net price by median earnings.
    "outcomes.median_earnings_10yr",
    // Next year's price beside the federal one (specs/data-expansion/cds-cost-and-debt.md).
    "derived.next_year_price",
    "derived.next_year_change",
    "reported.cost.next_year",
    "reported.cost.next_year.first_year.fees",
    "reported.cost.next_year.first_year.food_and_housing",
    "reported.cost.next_year_detail.pct_paying_more",
    // CDS financial aid (specs/data-expansion/cds-financial-aid.md): the CDS panel, Applying for aid, International.
    "reported.aid.first_years",
    "reported.aid.institutional_grants",
    "derived.merit_dollar_share",
    "reported.aid.forms",
    "reported.aid.methodology",
    "reported.aid.dates",
    "reported.aid.international",
  ],
  outcomes: [
    "outcomes.median_earnings_10yr",
    "outcomes.median_earnings_6yr",
    "outcomes.retention_rate",
    "outcomes.graduation_rate",
    "outcomes.eight_year",
    // Graduation by group (specs/data-expansion/graduation-by-group.md).
    "outcomes.grad_rate_pell",
    "outcomes.grad_rate_loan_no_pell",
    "outcomes.grad_rate_no_pell_no_loan",
    "outcomes.grad_rate_ftft",
    "outcomes.grad_cohorts",
    "outcomes.grad_rate_by_race",
    "outcomes.grad_cohorts_by_race",
    // The cost vs. earnings map.
    "cost.avg_paid_all",
    // What graduates owe: the federal median beside the college's own all-loans line (specs/data-expansion/cds-cost-and-debt.md).
    "outcomes.median_debt",
    "reported.outcomes.graduating_class",
    "reported.outcomes.graduate_debt.rows.any.share",
    "reported.outcomes.graduate_debt.rows.any.avg_principal",
    // The race plot's overall line when a newer CDS class replaced the Pell plot (specs/data-expansion/cds-student-body-and-outcomes.md).
    "outcomes.federal.graduation",
  ],
  // Every "Over time" chart cites its history editions in its group (HistorySourceNote), not the snapshot registry.
  history: [],
};

/** Every field the profile shows anywhere, for the overview's numbered source list. */
export const PROFILE_FIELDS: readonly FieldPath[] = [...new Set([...OVERVIEW_FIELDS, ...Object.values(TOPIC_FIELDS).flat(), "aid.cds" as const, "location.city" as const])];
