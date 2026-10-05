/**
 * The compare pages (specs/compare-redesign.md): the topics and their routes (from lib/compare-routes.ts), the
 * "All the numbers" rows grouped by topic, and the fields each page shows, for its source footnote.
 *
 * Pure module (relative `.ts` imports, no React or server-only code), so tests load it directly.
 */
import type { FieldPath } from "./fields";
import type { TermKey } from "./glossary";
import type { School } from "./types";
import { METRICS, TEST_POLICY_LABELS, admitRatesBySex, satTotal } from "./metrics.ts";
import { TEST_ROWS } from "./compare-tests.ts";
import { DESIGNATION_LABELS, RESEARCH_LABELS } from "./campus-profile.ts";
import { CALENDAR_LABELS, DIVISION_LABELS, ROTC_LABELS, divisionFilterOf } from "./campus-services.ts";
import { FORM_SHORT } from "./finances.ts";
import { money, num, pct, pctSmart } from "./format.ts";
import { MIN_GROUP_COHORT, gradRateCell } from "./graduation-groups.ts";
import { compareAidRows } from "./cds/financial-aid-compare.ts";
import { compareAdmitRates, compareYields } from "./cds/residency-display.ts";
import { ADMISSION_PROFILE_ROWS, c7FactorCell } from "./cds/compare-rows.ts";
import { compareClassesUnder20 } from "./cds/academics-display.ts";
import { compareTransferAdmitRate } from "./cds/transfer-display.ts";
import { compareFratPct, compareGreekCouncils, compareSorPct } from "./cds/greek-display.ts";
import { compareDeadlines, compareGapYear } from "./cds/application-logistics-display.ts";
import { compareTopicOf, type CompareTopicKey } from "./compare-routes.ts";

export * from "./compare-routes.ts";

/* ------------------------------------------------------------------ */
/* All the numbers: today's rows, grouped by topic                     */
/* ------------------------------------------------------------------ */

/**
 * One "All the numbers" row: label, glossary term, registered field (for its citation and each cell's year), and
 * formatter (null where the college doesn't report it; the table shows "–").
 */
export type CompareRow = readonly [label: string, term: TermKey, field: FieldPath, fmt: (s: School) => string | null];

export interface CompareTableGroup {
  topic: Exclude<CompareTopicKey, "table" | "history">;
  /** The heading row's text: the topic's pill label. */
  title: string;
  rows: readonly CompareRow[];
}

/** Compare rows from CDS C14–C18, hidden when no compared college has the data (cds-application-logistics.md). */
export const LOGISTICS_ROW_LABELS: ReadonlySet<string> = new Set(["Deadlines & deposit", "Gap year allowed"]);

function opt<T>(v: T | null, f: (v: T) => string): string | null {
  return v === null ? null : f(v);
}

/** One "All the numbers" row per admission factor (specs/data-expansion/admission-factors.md). */
const FACTOR_USE_LABELS = { required: "Required", considered: "Considered", not_considered: "Not considered" } as const;
const FACTOR_ROWS = (
  [
    ["gpa", "High school GPA"],
    ["hs_record", "High school record"],
    ["class_rank", "Class rank"],
    ["college_prep", "College-prep program"],
    ["recommendations", "Recommendations"],
    ["essay", "Essay"],
    ["legacy", "Legacy status"],
    ["work_experience", "Work experience"],
    ["competencies", "Demonstration of competencies"],
    ["english_test", "English proficiency test"],
    ["other_test", "Other tests"],
  ] as const
).map(
  ([k, label]) =>
    [
      `Admission: ${label}`,
      k === "legacy" ? "legacy-status" : "admission-factor",
      "admissions.factors",
      (s: School) => {
        // The college's own C7 level where its CDS has one (cds-admissions.md), else the federal use.
        const c7 = c7FactorCell(s, k);
        if (c7) return c7;
        const use = s.admissions.factors?.[k];
        return use ? FACTOR_USE_LABELS[use] : null;
      },
    ] as const
) satisfies readonly CompareRow[];

/** Finished within 4 and 5 years by aid group (`reported.outcomes.graduation`): "Not published" where the college's CDS doesn't say. */
const ON_TIME_ROWS = (
  [4, 5].flatMap((years) =>
    (
      [
        ["Pell recipients", "pell"],
        ["neither Pell nor subsidized loan", "no_pell_no_loan"],
        ["all first-time full-time", "total"],
      ] as const
    ).map(
      ([who, group]) =>
        [
          `Finished within ${years} years: ${who}`,
          "on-time-graduation",
          "reported.outcomes.graduation",
          (s: School) => {
            const g = s.reported?.outcomes?.graduation;
            if (!g) return "Not published";
            const v = (years === 4 ? g.within_4 : g.within_5)[group];
            return v === null ? `Not shown: under ${MIN_GROUP_COHORT} students` : pct(v);
          },
        ] as const
    )
  )
) satisfies readonly CompareRow[];

const ADMISSIONS_ROWS = (
  [
    // Sources differ by school (federal survey vs. a college's own CDS), so show which class each row describes.
    ["Admissions data", "cds", "admissions.year", (s: School) => (s.admissions.year ? `Fall ${s.admissions.year}` : null)],
    ["Acceptance rate", "acceptance-rate", "admissions.acceptance_rate", (s: School) => s.admissions.acceptance_rate === null ? null : pctSmart(s.admissions.acceptance_rate)],
    ["Acceptance rate, men / women", "admit-rate-by-sex", "admissions.by_sex", (s: School) => {
      const r = admitRatesBySex(s);
      return r.men === null || r.women === null ? null : `${pctSmart(r.men)} / ${pctSmart(r.women)}`;
    }],
    // CDS C1 by residency (specs/data-expansion/cds-residency-admissions.md): "Not published" without a grid.
    ["Acceptance rate, in-state / other states / international", "admit-rate-by-residency", "derived.admit_rate_in_state", compareAdmitRates],
    ["Yield, in-state / other states / international", "yield-by-residency", "derived.yield_in_state", compareYields],
    ["Applicants", "applicants", "admissions.applicants", (s: School) => opt(s.admissions.applicants, num)],
    ["Admitted", "admitted", "admissions.admitted", (s: School) => opt(s.admissions.admitted, num)],
    ["Enrolled", "enrolled", "admissions.enrolled", (s: School) => opt(s.admissions.enrolled, num)],
    ["Yield", "yield", "derived.yield", (s: School) => opt(METRICS.yield.get(s), (v) => pct(v))],
    ["SAT middle 50%", "middle-50", "derived.sat_total", (s: School) => satTotal(s)?.join("–") ?? null],
    ["ACT middle 50%", "act", "admissions.act_composite_25_75", (s: School) => s.admissions.act_composite_25_75?.join("–") ?? null],
    // CDS C9 (cds-test-scores-and-policy.md): counts and top bands, "–" where not reported; never ranked or in Key differences.
    ...TEST_ROWS,
    ...FACTOR_ROWS,
    ...ADMISSION_PROFILE_ROWS,
    ["Test policy", "test-policy", "admissions.test_policy", (s: School) => (s.admissions.test_policy ? TEST_POLICY_LABELS[s.admissions.test_policy] : null)],
    ["Application fee", "application-fee", "admissions.application_fee", (s: School) =>
      s.admissions.application_fee == null ? null : s.admissions.application_fee === 0 ? "None" : money(s.admissions.application_fee)],
    // CDS C14–C18 (specs/data-expansion/cds-application-logistics.md): shown only when a compared college has the data.
    ["Deadlines & deposit", "reply-by-date", "derived.application_deadlines", compareDeadlines],
    ["Gap year allowed", "deferred-admission", "derived.gap_year_allowed", compareGapYear],
    ["Credit for AP exams", "ap-credit", "admissions.accepts_ap_credit", (s: School) =>
      s.admissions.accepts_ap_credit == null ? null : s.admissions.accepts_ap_credit ? "Yes" : "Not listed"],
    // CDS D2 (specs/data-expansion/cds-transfer.md): blank, never 0, without a transfer funnel.
    ["Transfer acceptance rate", "transfer-admission", "reported.transfer.admit_rate", compareTransferAdmitRate],
  ] as const
) satisfies readonly CompareRow[];

const STUDENTS_ROWS = (
  [
    ["Setting", "locale", "campus.setting", (s: School) => s.campus?.setting?.label ?? null],
    ["Carnegie class", "carnegie-classification", "campus.carnegie", (s: School) => s.campus?.carnegie?.ic ?? null],
    ["Research activity", "r1", "campus.carnegie", (s: School) =>
      !s.campus?.carnegie ? null : s.campus.carnegie.research ? RESEARCH_LABELS[s.campus.carnegie.research] : "Not a research tier"],
    ["Student access & earnings", "student-access-and-earnings", "campus.carnegie", (s: School) => s.campus?.carnegie?.access_earnings ?? null],
    ["HBCU, tribal, land-grant", "hbcu", "campus.designations", (s: School) =>
      !s.campus?.designations ? null : s.campus.designations.map((d) => DESIGNATION_LABELS[d]).join(", ") || "None"],
    ["Minority-serving, single-sex", "hsi", "campus.msi", (s: School) =>
      !s.campus?.msi ? null : s.campus.msi.map((d) => DESIGNATION_LABELS[d]).join(", ") || "None"],
    // IPEDS affiliation for every college ("None" = not applicable); the exact NCES label, not the Explore family.
    ["Religious affiliation", "religious-affiliation", "religion.affiliation", (s: School) => (!s.religion ? null : s.religion.affiliation?.label ?? "None")],
    ["Athletics", "ncaa-division", "campus.athletics", (s: School) => {
      const d = divisionFilterOf(s);
      return !s.campus?.athletics ? null : d ? DIVISION_LABELS[d] : "No NCAA or NAIA division";
    }],
    ["Conference", "athletic-conference", "campus.athletics", (s: School) => {
      const a = s.campus?.athletics;
      if (!a) return null;
      if (!a.conference) return "None";
      return a.football_conference ? `${a.conference.name}; football: ${a.football_conference.name}` : a.conference.name;
    }],
    ["ROTC", "rotc", "campus.programs", (s: School) =>
      !s.campus?.programs ? null : s.campus.programs.rotc.map((b) => ROTC_LABELS[b]).join(", ") || "Not listed"],
    ["Study abroad", "study-abroad", "campus.programs", (s: School) => (!s.campus?.programs ? null : s.campus.programs.study_abroad ? "Offered" : "Not listed")],
    ["Undergraduate research program", "undergrad-research", "campus.programs", (s: School) =>
      s.campus?.programs?.undergrad_research == null ? null : s.campus.programs.undergrad_research ? "Yes" : "Not listed"],
    ["Calendar", "academic-calendar", "campus.calendar", (s: School) => (s.campus?.calendar ? CALENDAR_LABELS[s.campus.calendar] : null)],
    ["Undergrads", "undergrad-enrollment", "demographics.undergrad_enrollment", (s: School) => num(s.demographics.undergrad_enrollment)],
    ["Beds in college housing", "housing-capacity", "campus.housing", (s: School) => {
      const h = s.campus?.housing;
      return !h ? null : !h.offered ? "No housing" : h.capacity == null ? null : num(h.capacity);
    }],
    ["First-years must live on campus", "live-on-requirement", "campus.housing", (s: School) => {
      const r = s.campus?.housing?.first_years_required;
      return r == null ? null : r ? "Yes" : "No";
    }],
    // CDS F1/F4 (specs/greek-life.md phase 1): undergrad percentages, each gender on its own; blank, never 0, without a CDS answer.
    ["Men in a fraternity", "greek-life", "reported.greek.frat_pct_undergrad", compareFratPct],
    ["Women in a sorority", "greek-life", "reported.greek.sor_pct_undergrad", compareSorPct],
    ["Fraternity/sorority housing", "greek-life", "reported.greek.housing", (s: School) => {
      const h = s.reported?.greek?.housing;
      return h == null ? null : "Offered";
    }],
    // National chapter directories, phase 4 (specs/campus-directories.md): councils with a listed chapter, credited.
    ["Greek councils present", "national-directory", "directories", compareGreekCouncils],
    ["Pell Grant", "pell-grant", "demographics.pell_grant_percent", (s: School) => opt(s.demographics.pell_grant_percent, (v) => pct(v))],
    ["First-gen", "first-gen", "demographics.first_gen_percent", (s: School) => opt(s.demographics.first_gen_percent, (v) => pct(v))],
    ["Men / women", "gender-balance", "demographics.men_share", (s: School) =>
      s.demographics.men_share == null || s.demographics.women_share == null ? null : `${pct(s.demographics.men_share)} / ${pct(s.demographics.women_share)}`],
    ["Part-time students", "part-time-student", "demographics.part_time_share", (s: School) => opt(s.demographics.part_time_share ?? null, (v) => pct(v))],
    ["Students 25 and older", "adult-students", "demographics.age_25_plus_share", (s: School) => opt(s.demographics.age_25_plus_share ?? null, (v) => pct(v))],
    ["First-years from in state", "in-state-student", "demographics.residence", (s: School) => opt(s.demographics.residence?.in_state ?? null, (v) => pct(v))],
    ["First-years from other states", "in-state-student", "demographics.residence", (s: School) => opt(s.demographics.residence?.out_of_state ?? null, (v) => pct(v))],
    ["First-years from abroad", "in-state-student", "demographics.residence", (s: School) => opt(s.demographics.residence?.international ?? null, (v) => pct(v))],
    ["New transfer students this fall", "transfer-in", "demographics.transfer_in", (s: School) => opt(s.demographics.transfer_in?.count ?? null, (v) => v.toLocaleString("en-US"))],
    ["Transfers, share of new undergraduates", "transfer-in", "demographics.transfer_in", (s: School) => opt(s.demographics.transfer_in?.share_of_new ?? null, (v) => pct(v))],
    ["Diversity index", "diversity-index", "derived.diversity_index", (s: School) => opt(METRICS.diversity.get(s), (v) => v.toFixed(2))],
  ] as const
) satisfies readonly CompareRow[];

const ACADEMICS_ROWS = (
  [
    ["Students per faculty member", "student-faculty-ratio", "academics.student_faculty_ratio", (s: School) =>
      s.academics?.student_faculty_ratio == null ? null : `${s.academics.student_faculty_ratio} to 1`],
    // CDS I-3 (specs/data-expansion/cds-academics.md): class sections, not students; "–" without a record.
    ["Classes under 20 students", "class-section", "derived.class_share_under_20", compareClassesUnder20],
    ["Full-time faculty share", "full-time-faculty", "academics.faculty.full_time_share", (s: School) =>
      s.academics?.faculty?.full_time_share == null ? null : pct(s.academics.faculty.full_time_share)],
    ["Average faculty salary", "nine-month-equated-salary", "academics.faculty", (s: School) =>
      s.academics?.faculty?.avg_salary_9mo == null ? null : money(s.academics.faculty.avg_salary_9mo)],
    // Majors (specs/data-expansion/majors.md): first-major bachelor's, and the 3 largest programs by share of them.
    ["Bachelor's degrees awarded", "first-major", "academics.bachelors_awarded", (s: School) => opt(s.academics?.bachelors_awarded ?? null, num)],
    ["Most popular majors", "cip-code", "academics.majors_top", (s: School) =>
      s.academics?.majors_top?.length ? s.academics.majors_top.slice(0, 3).map((m) => `${m.title} ${pct(m.share)}`).join(" · ") : null],
    // Compared only within the same accounting form; the form is shown since figures otherwise look directly comparable.
    ["Instruction spending per student", "instruction-expenses", "finances", (s: School) =>
      s.finances?.instruction_per_student == null ? null : `${money(s.finances.instruction_per_student)} (${FORM_SHORT[s.finances.form]})`],
    ["Endowment per student", "endowment", "finances", (s: School) =>
      s.finances?.endowment_per_student == null ? null : `${money(s.finances.endowment_per_student)} (${FORM_SHORT[s.finances.form]})`],
    ["Tuition share of core revenue", "gasb-fasb", "finances", (s: School) =>
      s.finances?.tuition_share_of_revenue == null ? null : pct(s.finances.tuition_share_of_revenue)],
  ] as const
) satisfies readonly CompareRow[];

const COST_ROWS = (
  [
    ["Average cost, all students (est.)", "average-cost", "cost.avg_paid_all", (s: School) => opt(s.cost?.avg_paid_all ?? null, money)],
    ["Aid generosity (grants ÷ full price)", "aid-generosity", "derived.aid_generosity", (s: School) => opt(METRICS.aidGenerosity.get(s), (v) => pct(v))],
    ["Net price, students with grants", "net-price", "cost.aided_net_price", (s: School) => opt(s.cost?.aided_net_price ?? null, money)],
    ["Sticker price, in-state", "in-state-tuition", "cost.sticker", (s: School) => opt(s.cost?.sticker?.in_state ?? null, money)],
    ["Sticker price, out-of-state", "in-state-tuition", "cost.sticker", (s: School) => opt(s.cost?.sticker?.out_of_state ?? null, money)],
    ["Tuition guarantee", "tuition-guarantee", "cost.tuition_plans", (s: School) =>
      s.cost?.tuition_plans == null ? null : s.cost.tuition_plans.includes("guarantee") ? "Yes" : "No"],
    ["Promise program", "promise-program", "cost.promise_program", (s: School) =>
      s.cost?.promise_program == null ? null : s.cost.promise_program ? "Yes" : "No"],
    ["Tuition & fees, in-state", "in-state-tuition", "cost.tuition_fees", (s: School) => opt(s.cost?.tuition_fees?.in_state ?? null, money)],
    ["Tuition & fees, out-of-state", "in-state-tuition", "cost.tuition_fees", (s: School) => opt(s.cost?.tuition_fees?.out_of_state ?? null, money)],
    ["First-years paying out-of-state rates", "in-state-tuition", "cost.residency", (s: School) => (s.type === "public" ? opt(s.cost?.residency?.out_of_state ?? null, (v) => pct(v)) : null)],
    ["First-years with grants", "grant-aid", "aid.grant_pct", (s: School) => opt(s.aid?.grant_pct ?? null, (v) => pct(v))],
    ["Average grant", "grant-aid", "aid.grant_avg", (s: School) => opt(s.aid?.grant_avg ?? null, money)],
    ["Aid from the college", "institutional-aid", "aid.institutional_pct", (s: School) => opt(s.aid?.institutional_pct ?? null, (v) => pct(v))],
  ] as const
) satisfies readonly CompareRow[];

const OUTCOMES_ROWS = (
  [
    ["Median earnings (10 yrs)", "median-earnings", "outcomes.median_earnings_10yr", (s: School) => opt(s.outcomes?.median_earnings_10yr ?? null, money)],
    ["Graduation rate", "graduation-rate", "outcomes.graduation_rate", (s: School) => opt(s.outcomes?.graduation_rate ?? null, (v) => pct(v))],
    // Graduation by group (specs/data-expansion/graduation-by-group.md): blank under 30 students, with the class size.
    ["Graduated in 6 years, Pell Grant recipients", "pell-graduation-gap", "outcomes.grad_rate_pell", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_pell, s.outcomes?.grad_cohorts?.pell)],
    ["Graduated in 6 years, neither Pell nor subsidized loan", "pell-graduation-gap", "outcomes.grad_rate_no_pell_no_loan", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_no_pell_no_loan, s.outcomes?.grad_cohorts?.no_pell_no_loan)],
    ["Pell graduation gap", "pell-graduation-gap", "derived.pell_grad_gap", (s: School) => opt(METRICS.pellGap.get(s), METRICS.pellGap.format)],
    // From the college's CDS, same class as the 6-year rates above (specs/data-expansion/cds-student-body-and-outcomes.md); no "Highest" flags.
    ...ON_TIME_ROWS,
    ["Graduated in 6 years, White students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.white, s.outcomes?.grad_cohorts_by_race?.white)],
    ["Graduated in 6 years, Asian students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.asian, s.outcomes?.grad_cohorts_by_race?.asian)],
    ["Graduated in 6 years, Hispanic/Latino students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.hispanic, s.outcomes?.grad_cohorts_by_race?.hispanic)],
    ["Graduated in 6 years, Black students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.black, s.outcomes?.grad_cohorts_by_race?.black)],
    ["Graduated in 6 years, students of two or more races", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.two_or_more, s.outcomes?.grad_cohorts_by_race?.two_or_more)],
    ["Graduated in 6 years, international students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.international, s.outcomes?.grad_cohorts_by_race?.international)],
    ["Retention rate", "retention-rate", "outcomes.retention_rate", (s: School) => opt(s.outcomes?.retention_rate ?? null, (v) => pct(v))],
    ["Credential within 4 years, all students", "time-to-degree", "outcomes.eight_year", (s: School) => opt(METRICS.completion4.get(s), (v) => pct(v))],
    ["Credential within 8 years, all students", "outcome-measures", "outcomes.eight_year", (s: School) => opt(METRICS.completion8.get(s), (v) => pct(v))],
    ["Enrolled at another college, 8 years on", "transfer-out", "outcomes.eight_year", (s: School) => opt(METRICS.transferOut.get(s), (v) => pct(v))],
    ["Median debt", "median-debt", "outcomes.median_debt", (s: School) => opt(s.outcomes?.median_debt ?? null, money)],
    ["Undergrads with a federal loan", "federal-loan-rate", "outcomes.federal_loan_rate", (s: School) => opt(s.outcomes?.federal_loan_rate ?? null, (v) => pct(v))],
    ["Median debt, Pell Grant recipients", "median-debt", "outcomes.median_debt_pell", (s: School) => opt(s.outcomes?.median_debt_pell ?? null, money)],
  ] as const
) satisfies readonly CompareRow[];

/**
 * The single page's "All the numbers" rows (TABLE_ROWS with FACTOR_ROWS, ON_TIME_ROWS, TEST_ROWS, and
 * ADMISSION_PROFILE_ROWS), moved verbatim and grouped under the topic pills; labels and order within a group unchanged.
 * The CDS financial aid rows (`compareAidRows(year)`) take the federal aid year, so the table page appends them to
 * Cost & aid at render time. tests/compare-topics.test.mts holds the labels to the single page's.
 */
export const TABLE_GROUPS: readonly CompareTableGroup[] = [
  { topic: "admissions", title: compareTopicOf("admissions").label, rows: ADMISSIONS_ROWS },
  { topic: "students", title: compareTopicOf("students").label, rows: STUDENTS_ROWS },
  { topic: "academics", title: compareTopicOf("academics").label, rows: ACADEMICS_ROWS },
  { topic: "cost", title: compareTopicOf("cost").label, rows: COST_ROWS },
  { topic: "outcomes", title: compareTopicOf("outcomes").label, rows: OUTCOMES_ROWS },
];

/** The distinct fields a group's rows cite, in row order. */
export function tableGroupFields(group: CompareTableGroup): FieldPath[] {
  return [...new Set(group.rows.map((r) => r[2]))];
}

/* ------------------------------------------------------------------ */
/* Fields each page shows (its source footnote)                        */
/* ------------------------------------------------------------------ */

/** Everything "All the numbers" shows. */
const TABLE_FIELDS: readonly FieldPath[] = [
  ...new Set([
    ...TABLE_GROUPS.flatMap(tableGroupFields),
    // The CDS financial aid rows the table page appends to Cost & aid; their fields don't depend on the year passed.
    ...compareAidRows(null).map((r) => r[2]),
    // "Website" closes the table as its own row (an actual link, not text), so its field isn't in a group.
    "links.website" as const,
  ]),
];

/**
 * Every field a page shows (its text rows' fields and its charts' fields), so its MultiSourceNote cites it. Showing a
 * new value? Add its field under the page that shows it. One block per page: each topic page edits only its own key.
 */
export const COMPARE_TOPIC_FIELDS: Record<CompareTopicKey, readonly FieldPath[]> = {
  // Getting in: app/compare/admissions/page.tsx.
  admissions: [
    "admissions.acceptance_rate",
    "admissions.applicants",
    "admissions.admitted",
    "derived.yield",
    "derived.admit_rate_women",
    "derived.admit_rate_men",
    "derived.sat_total",
    "admissions.act_composite_25_75",
    "admissions.test_submission_rate_sat",
    "admissions.test_submission_rate_act",
    "admissions.test_policy",
    "admissions.factors",
  ],

  // Students & campus: app/compare/students/page.tsx.
  students: [
    "demographics.undergrad_enrollment",
    "demographics.pell_grant_percent",
    "demographics.first_gen_percent",
    "derived.diversity_index",
    "demographics.men_share",
    "demographics.part_time_share",
    "demographics.age_25_plus_share",
    "demographics.racial_diversity",
    "demographics.residence",
    "demographics.transfer_in",
    "campus.setting",
    "campus.housing",
    "campus.athletics",
    "campus.programs",
  ],

  // Academics: app/compare/academics/page.tsx.
  academics: [
    "academics.student_faculty_ratio",
    "academics.faculty.full_time_share",
    "academics.faculty",
    "finances",
    "academics.bachelors_awarded",
    "academics.majors_top",
    "academics.bachelors_by_family",
    "detail.majors",
    "detail.programs",
  ],

  // Cost & aid: app/compare/cost/page.tsx.
  cost: [
    "cost.avg_paid_all",
    "derived.aid_generosity",
    "cost.aided_net_price",
    "aid.grant_pct",
    "aid.grant_avg",
    "aid.institutional_pct",
    "cost.sticker",
    "cost.tuition_fees",
    "cost.residency",
    "cost.net_price_by_income",
    "cost.tuition_plans",
    "cost.promise_program",
    "reported.aid.forms",
    "reported.aid.dates",
    "reported.aid.first_years",
    "derived.merit_dollar_share",
    "reported.aid.international",
  ],

  // Outcomes: app/compare/outcomes/page.tsx.
  outcomes: [
    "outcomes.median_earnings_10yr",
    "outcomes.graduation_rate",
    "outcomes.retention_rate",
    "outcomes.median_debt",
    "outcomes.federal_loan_rate",
    "outcomes.median_debt_pell",
    "outcomes.eight_year",
    "outcomes.grad_rate_pell",
    "outcomes.grad_rate_no_pell_no_loan",
    "outcomes.grad_cohorts",
    "derived.pell_grad_gap",
    "outcomes.grad_rate_by_race",
    "outcomes.grad_cohorts_by_race",
    "reported.outcomes.graduation",
  ],

  // Over time: app/compare/history/page.tsx.
  // Every chart cites its history editions in its own HistorySourceNote, not the snapshot registry (as the
  // profile's TOPIC_FIELDS.history does).
  history: [],

  // All the numbers: app/compare/table/page.tsx.
  table: TABLE_FIELDS,
};

/**
 * The overview's fields: Key differences (lib/insights.ts#keyDifferences, the TOPIC_DIFF_METRICS metrics) and the
 * radar's percentile axes (RADAR_AXES), then whatever the topic cards add.
 */
export const COMPARE_OVERVIEW_FIELDS: readonly FieldPath[] = [
  "admissions.acceptance_rate",
  "derived.yield",
  "derived.sat_mid",
  "demographics.undergrad_enrollment",
  "demographics.pell_grant_percent",
  "demographics.first_gen_percent",
  "derived.diversity_index",
  "cost.avg_paid_all",
  "derived.aid_generosity",
  "outcomes.median_earnings_10yr",
  "outcomes.graduation_rate",
  // The topic cards (lib/compare-cards.ts#cardFields; tests/compare-cards.test.mts keeps this list covering them).
  "derived.sat_total",
  "admissions.act_composite_25_75",
  "admissions.test_policy",
  "academics.student_faculty_ratio",
  "academics.majors_top",
  "trends",
];
