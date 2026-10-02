import type { School, SizeBucket } from "./types";
import type { TermKey } from "./glossary";
import { ratioLabel } from "./academics";
import { completion8, transferOut8 } from "./outcome-measures";
import { NATIONAL_MIN_FIRST_YEARS } from "./residence";
import type { FieldPath } from "./fields";
import { money, num, pct, pctSmart } from "./format";
import { admitRatesBySex, satMedian, simpsonIndex, yieldOf } from "./derive";
import { bedsPer100 } from "./housing";
import { pellGap } from "./graduation-groups";

/* ------------------------------------------------------------------ */
/* Derived values (null when the underlying data isn't reported)       */
/* ------------------------------------------------------------------ */

export function satComposite(s: School): [number, number] | null {
  const r = s.admissions.sat_reading_25_75;
  const m = s.admissions.sat_math_25_75;
  if (!r || !m) return null;
  return [r[0] + m[0], r[1] + m[1]];
}

export function satMid(s: School): number | null {
  const c = satComposite(s);
  return c ? Math.round((c[0] + c[1]) / 2) : null;
}

// Shared with the history build (lib/derive.ts), so a trend line ends on the profile's number.
export { admitRatesBySex, satMedian };

/** Both sexes need this many applicants before their admit rates are compared (a gap on a handful is noise). */
export const BY_SEX_MIN_APPLICANTS = 200;

/** Men's minus women's acceptance rate, in points; null unless both have BY_SEX_MIN_APPLICANTS applicants. */
export function admitRateGap(s: School): number | null {
  const b = s.admissions.by_sex;
  if (!b || (b.men.applicants ?? 0) < BY_SEX_MIN_APPLICANTS || (b.women.applicants ?? 0) < BY_SEX_MIN_APPLICANTS) return null;
  const { men, women } = admitRatesBySex(s);
  return men !== null && women !== null ? Math.round((men - women) * 10_000) / 10_000 : null;
}

export function actMid(s: School): number | null {
  const a = s.admissions.act_composite_25_75;
  return a ? (a[0] + a[1]) / 2 : null;
}

/** Share of admitted students who enroll. */
export function yieldRate(s: School): number | null {
  return yieldOf(s.admissions.admitted, s.admissions.enrolled);
}

/** "1 in N" applicants admitted. */
export function oneIn(s: School): number | null {
  const r = s.admissions.acceptance_rate;
  return r && r > 0 ? Math.max(1, Math.round(1 / r)) : null;
}

/** Human phrasing of an admit rate: "1 in 29" when selective, "8 in 10" when not. */
export function admitRatio(s: School): string | null {
  const r = s.admissions.acceptance_rate;
  if (r === null || r <= 0) return null;
  return r < 0.5 ? `1 in ${oneIn(s)}` : `${Math.round(r * 10)} in 10`;
}

/**
 * Simpson's diversity index: the chance two randomly chosen students
 * come from different racial/ethnic groups (0 = none, 1 = maximal).
 */
export function diversityIndex(s: School): number | null {
  const race = s.demographics.racial_diversity;
  return race ? simpsonIndex(Object.values(race)) : null;
}

/** Admissions counts are complete enough for the waffle, funnel and yield. */
export function hasAdmissionCounts(s: School): boolean {
  const { applicants, admitted, enrolled } = s.admissions;
  return !!applicants && applicants >= 10 && admitted !== null && enrolled !== null;
}

export function hasTestScores(s: School): boolean {
  return satComposite(s) !== null || s.admissions.act_composite_25_75 !== null;
}

/* ------------------------------------------------------------------ */
/* Tiers                                                               */
/* ------------------------------------------------------------------ */

export function selectivityTier(rate: number | null): { label: string; level: number } {
  if (rate === null) return { label: "Open or not reported", level: 0 };
  if (rate < 0.1) return { label: "Most selective", level: 4 };
  if (rate < 0.25) return { label: "Highly selective", level: 3 };
  if (rate < 0.5) return { label: "Selective", level: 2 };
  return { label: "Broadly accessible", level: 1 };
}

export const SIZE_BUCKETS: { key: SizeBucket; label: string; hint: string; min: number; max: number }[] = [
  { key: "small", label: "Small", hint: "< 5K", min: 0, max: 4999 },
  { key: "medium", label: "Medium", hint: "5–15K", min: 5000, max: 14999 },
  { key: "large", label: "Large", hint: "15–30K", min: 15000, max: 29999 },
  { key: "xl", label: "Very large", hint: "30K+", min: 30000, max: Infinity },
];

export function sizeBucket(enrollment: number) {
  return SIZE_BUCKETS.find((b) => enrollment >= b.min && enrollment <= b.max) ?? SIZE_BUCKETS[3];
}

export const TEST_POLICY_LABELS: Record<string, string> = {
  required: "Test scores required",
  recommended: "Test scores recommended",
  considered: "Test-optional",
  "not-considered": "Test-blind",
};

/* ------------------------------------------------------------------ */
/* Metric registry: one place that knows how to read, format & explain */
/* ------------------------------------------------------------------ */

export type Domain = "admissions" | "size" | "scores" | "access" | "diversity" | "value";

export const DOMAINS: Record<Domain, { label: string; color: string }> = {
  admissions: { label: "Admissions", color: "var(--d-admissions)" },
  size: { label: "Size", color: "var(--d-size)" },
  scores: { label: "Test scores", color: "var(--d-scores)" },
  access: { label: "Access", color: "var(--d-access)" },
  diversity: { label: "Diversity", color: "var(--d-diversity)" },
  value: { label: "Cost & outcomes", color: "var(--d-value)" },
};

export type MetricKey =
  | "acceptance"
  | "applicants"
  | "yield"
  | "sat"
  | "act"
  | "enrollment"
  | "pell"
  | "firstGen"
  | "diversity"
  | "avgCost"
  | "aidGenerosity"
  | "netPrice"
  | "earnings"
  | "gradRate"
  | "debt"
  | "bedsPer100"
  | "loanRate"
  | "loanRateLarge"
  | "loanRateChange"
  | "admitGap"
  | "admitGapSize"
  | "menShare"
  | "partTime"
  | "studentFaculty"
  | "completion8"
  | "transferOut"
  | "pellGap"
  | "pellGapChange"
  | "facultyFullTime"
  | "facultySalary"
  | "outOfState"
  | "outOfStateLarge"
  | "financesInstruction"
  | "instructionGasb"
  | "instructionFasb"
  | "instructionForprofit"
  | "endowmentGasb"
  | "endowmentFasb"
  | "adults"
  | "applicantsChange"
  | "sizeChange"
  | "diversityChange"
  | "menShareChange"
  | "avgCostChange";

export interface MetricDef {
  key: MetricKey;
  /** Registered field this metric reads (lib/fields.ts), used for its citation. */
  field: FieldPath;
  label: string;
  short: string;
  term: TermKey;
  domain: Domain;
  get: (s: School) => number | null;
  format: (v: number) => string;
  /** Fixed scale for bars, when meaningful. */
  scale?: [number, number];
  /** Wording used in "higher than X%" sentences. */
  more: string;
  less: string;
}

/** "+12%", "−3%": a signed relative change with a true minus sign. */
const SIGNED_PCT = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)}%`;

export const METRICS: Record<MetricKey, MetricDef> = {
  acceptance: {
    key: "acceptance",
    field: "admissions.acceptance_rate",
    label: "Acceptance rate",
    short: "Admit rate",
    term: "acceptance-rate",
    domain: "admissions",
    get: (s) => s.admissions.acceptance_rate,
    format: pctSmart,
    scale: [0, 1],
    more: "less selective",
    less: "more selective",
  },
  applicants: {
    key: "applicants",
    field: "admissions.applicants",
    label: "Applicants",
    short: "Applicants",
    term: "applicants",
    domain: "admissions",
    get: (s) => s.admissions.applicants,
    format: num,
    more: "more applicants",
    less: "fewer applicants",
  },
  yield: {
    key: "yield",
    field: "derived.yield",
    label: "Yield rate",
    short: "Yield",
    term: "yield",
    domain: "admissions",
    get: yieldRate,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "higher yield",
    less: "lower yield",
  },
  sat: {
    key: "sat",
    field: "derived.sat_mid",
    label: "SAT midpoint",
    short: "SAT mid",
    term: "sat",
    domain: "scores",
    get: satMid,
    format: (v) => String(Math.round(v)),
    scale: [400, 1600],
    more: "higher scores",
    less: "lower scores",
  },
  act: {
    key: "act",
    field: "derived.act_mid",
    label: "ACT midpoint",
    short: "ACT mid",
    term: "act",
    domain: "scores",
    get: actMid,
    format: (v) => String(Math.round(v)),
    scale: [1, 36],
    more: "higher scores",
    less: "lower scores",
  },
  enrollment: {
    key: "enrollment",
    field: "demographics.undergrad_enrollment",
    label: "Undergrads",
    short: "Undergrads",
    term: "undergrad-enrollment",
    domain: "size",
    get: (s) => s.demographics.undergrad_enrollment,
    format: num,
    more: "larger",
    less: "smaller",
  },
  pell: {
    key: "pell",
    field: "demographics.pell_grant_percent",
    label: "Pell Grant recipients",
    short: "Pell %",
    term: "pell-grant",
    domain: "access",
    get: (s) => s.demographics.pell_grant_percent,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more Pell recipients",
    less: "fewer Pell recipients",
  },
  firstGen: {
    key: "firstGen",
    field: "demographics.first_gen_percent",
    label: "First-generation students",
    short: "First-gen %",
    term: "first-gen",
    domain: "access",
    get: (s) => s.demographics.first_gen_percent,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more first-gen students",
    less: "fewer first-gen students",
  },
  diversity: {
    key: "diversity",
    field: "derived.diversity_index",
    label: "Diversity index",
    short: "Diversity",
    term: "diversity-index",
    domain: "diversity",
    get: diversityIndex,
    format: (v) => v.toFixed(2),
    scale: [0, 1],
    more: "more diverse",
    less: "less diverse",
  },
  avgCost: {
    key: "avgCost",
    field: "cost.avg_paid_all",
    label: "Average cost, all students",
    short: "Avg cost",
    term: "average-cost",
    domain: "value",
    get: (s) => s.cost?.avg_paid_all ?? null,
    format: money,
    more: "more expensive",
    less: "less expensive",
  },
  aidGenerosity: {
    key: "aidGenerosity",
    field: "derived.aid_generosity",
    label: "Aid generosity",
    short: "Aid generosity",
    term: "aid-generosity",
    domain: "value",
    get: aidGenerosity,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more generous aid",
    less: "less generous aid",
  },
  netPrice: {
    key: "netPrice",
    field: "cost.aided_net_price",
    label: "Net price, students with grants",
    short: "Net price (grants)",
    term: "net-price",
    domain: "value",
    get: (s) => s.cost?.aided_net_price ?? null,
    format: money,
    more: "more expensive",
    less: "less expensive",
  },
  earnings: {
    key: "earnings",
    field: "outcomes.median_earnings_10yr",
    label: "Median earnings, 10 yrs",
    short: "Earnings",
    term: "median-earnings",
    domain: "value",
    get: (s) => s.outcomes?.median_earnings_10yr ?? null,
    format: money,
    more: "higher earnings",
    less: "lower earnings",
  },
  gradRate: {
    key: "gradRate",
    field: "outcomes.graduation_rate",
    label: "Graduation rate",
    short: "Grad rate",
    term: "graduation-rate",
    domain: "value",
    get: (s) => s.outcomes?.graduation_rate ?? null,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "higher graduation rate",
    less: "lower graduation rate",
  },
  debt: {
    key: "debt",
    field: "outcomes.median_debt",
    label: "Median debt at graduation",
    short: "Median debt",
    term: "median-debt",
    domain: "value",
    get: (s) => s.outcomes?.median_debt ?? null,
    format: money,
    more: "more debt",
    less: "less debt",
  },
  bedsPer100: {
    key: "bedsPer100",
    field: "campus.housing",
    label: "Beds per 100 undergrads",
    short: "Beds/100",
    term: "housing-capacity",
    domain: "size",
    get: bedsPer100,
    format: (v) => String(Math.round(v)),
    more: "more housing",
    less: "less housing",
  },
  loanRate: {
    key: "loanRate",
    field: "outcomes.federal_loan_rate",
    label: "Undergrads with a federal loan",
    short: "Borrow %",
    term: "federal-loan-rate",
    domain: "value",
    get: (s) => s.outcomes?.federal_loan_rate ?? null,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more students borrowing",
    less: "fewer students borrowing",
  },
  // Only colleges with 1,000+ undergrads, for the "Few students borrow" chip (a tiny college's rate says little).
  loanRateLarge: {
    key: "loanRateLarge",
    field: "outcomes.federal_loan_rate",
    label: "Undergrads with a federal loan (1,000+ undergrads)",
    short: "Borrow %",
    term: "federal-loan-rate",
    domain: "value",
    get: (s) => (s.demographics.undergrad_enrollment >= 1000 ? (s.outcomes?.federal_loan_rate ?? null) : null),
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more students borrowing",
    less: "fewer students borrowing",
  },
  loanRateChange: {
    key: "loanRateChange",
    field: "trends",
    label: "Undergrads with a federal loan, 10-year change",
    short: "Borrowing change",
    term: "federal-loan-rate",
    domain: "value",
    // Points; same small-college floor as the size change.
    get: (s) => (s.trends?.federal_loan_rate && s.trends.undergrads && Math.min(s.trends.undergrads.from, s.trends.undergrads.to) >= 300 ? s.trends.federal_loan_rate.change : null),
    format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)} pts`,
    more: "more students borrowing",
    less: "fewer students borrowing",
  },
  admitGap: {
    key: "admitGap",
    field: "derived.admit_rate_men",
    label: "Acceptance rate, men minus women",
    short: "Admit gap (M − W)",
    term: "admit-rate-by-sex",
    domain: "admissions",
    get: admitRateGap,
    format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)} pts`,
    more: "admits men at a higher rate",
    less: "admits women at a higher rate",
  },
  // The gap's size, only on large pools (1,000+ applicants of each sex), for the "Known for" chip.
  admitGapSize: {
    key: "admitGapSize",
    field: "derived.admit_rate_men",
    label: "Gap between men's and women's acceptance rates",
    short: "Admit gap",
    term: "admit-rate-by-sex",
    domain: "admissions",
    get: (s) => {
      const b = s.admissions.by_sex;
      const gap = admitRateGap(s);
      return gap !== null && b && Math.min(b.men.applicants ?? 0, b.women.applicants ?? 0) >= 1000 ? Math.abs(gap) : null;
    },
    format: (v) => `${Math.round(v * 100)} pts`,
    more: "a wider gap",
    less: "a narrower gap",
  },
  menShare: {
    key: "menShare",
    field: "demographics.men_share",
    label: "Men",
    short: "Men %",
    term: "gender-balance",
    domain: "access",
    get: (s) => s.demographics.men_share ?? null,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more men",
    less: "fewer men",
  },
  // Lower is the sought-after end; "more"/"less" wording follows the number (specs/data-expansion/student-faculty-ratio.md).
  studentFaculty: {
    key: "studentFaculty",
    field: "academics.student_faculty_ratio",
    label: "Student-to-faculty ratio",
    short: "Students/faculty",
    term: "student-faculty-ratio",
    domain: "size",
    get: (s) => s.academics?.student_faculty_ratio ?? null,
    format: ratioLabel,
    more: "more students per faculty member",
    less: "fewer students per faculty member",
  },
  // 8-year outcomes, all entering students (specs/data-expansion/outcome-measures.md).
  completion8: {
    key: "completion8",
    field: "outcomes.eight_year",
    label: "Earned a credential within 8 years (all students)",
    short: "8-yr completion",
    term: "outcome-measures",
    domain: "value",
    get: completion8,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more students finishing",
    less: "fewer students finishing",
  },
  transferOut: {
    key: "transferOut",
    field: "outcomes.eight_year",
    label: "Enrolled at another college within 8 years",
    short: "Transferred out",
    term: "transfer-out",
    domain: "value",
    get: transferOut8,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more students transferring out",
    less: "fewer students transferring out",
  },
  // Graduation by group (specs/data-expansion/graduation-by-group.md): points, positive = Pell recipients finish less often.
  pellGap: {
    key: "pellGap",
    field: "derived.pell_grad_gap",
    label: "Pell graduation gap",
    short: "Pell gap",
    term: "pell-graduation-gap",
    domain: "access",
    get: pellGap,
    format: (v) => (Math.round(v * 100) === 0 ? "No gap" : `${Math.round(Math.abs(v) * 100)} pts ${v > 0 ? "lower" : "higher"}`),
    more: "a bigger gap for Pell recipients",
    less: "a smaller gap for Pell recipients",
  },
  pellGapChange: {
    key: "pellGapChange",
    field: "trends",
    label: "Pell graduation gap, 10-year change",
    short: "Pell gap change",
    term: "pell-graduation-gap",
    domain: "access",
    // Points over the cohort window; only with 100+ Pell recipients at both ends (lib/history.ts pellGapChange).
    get: (s) => s.trends?.pell_gap?.change ?? null,
    format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)} pts`,
    more: "a widening gap",
    less: "a narrowing gap",
  },
  // Faculty (specs/data-expansion/faculty.md).
  facultyFullTime: {
    key: "facultyFullTime",
    field: "academics.faculty.full_time_share",
    label: "Full-time faculty share",
    short: "Full-time faculty",
    term: "full-time-faculty",
    domain: "size",
    get: (s) => s.academics?.faculty?.full_time_share ?? null,
    format: (v) => pct(v),
    more: "more full-time faculty",
    less: "less full-time faculty",
  },
  facultySalary: {
    key: "facultySalary",
    field: "academics.faculty",
    label: "Average faculty salary",
    short: "Faculty salary",
    term: "nine-month-equated-salary",
    domain: "size",
    get: (s) => s.academics?.faculty?.avg_salary_9mo ?? null,
    format: money,
    more: "higher-paid faculty",
    less: "lower-paid faculty",
  },
  // Where first-years come from (specs/data-expansion/residence.md): share of every first-year from other states.
  outOfState: {
    key: "outOfState",
    field: "demographics.residence",
    label: "First-years from other states",
    short: "Out of state",
    term: "in-state-student",
    domain: "diversity",
    get: (s) => s.demographics.residence?.out_of_state ?? null,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more first-years from other states",
    less: "fewer first-years from other states",
  },
  // Only classes of 500+ first-years, for the "Draws students nationally" chip (a few students swing a small class).
  outOfStateLarge: {
    key: "outOfStateLarge",
    field: "demographics.residence",
    label: "First-years from other states (500+ first-years)",
    short: "Out of state",
    term: "in-state-student",
    domain: "diversity",
    get: (s) => {
      const r = s.demographics.residence;
      return r && r.first_years >= NATIONAL_MIN_FIRST_YEARS ? r.out_of_state : null;
    },
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more first-years from other states",
    less: "fewer first-years from other states",
  },
  // Finances (specs/data-expansion/finances.md). Instruction spending per student, global (for Explore's sort, which
  // isn't sector-restricted) and one key per accounting form (for the profile's within-sector benchmark; a public
  // college is never ranked against private nonprofits, and vice versa).
  financesInstruction: {
    key: "financesInstruction",
    field: "finances",
    label: "Instruction spending per student",
    short: "Instruction spending",
    term: "instruction-expenses",
    domain: "value",
    get: (s) => s.finances?.instruction_per_student ?? null,
    format: money,
    more: "more on instruction per student",
    less: "less on instruction per student",
  },
  instructionGasb: {
    key: "instructionGasb",
    field: "finances",
    label: "Instruction spending per student",
    short: "Instruction spending",
    term: "instruction-expenses",
    domain: "value",
    get: (s) => (s.finances?.form === "gasb" ? s.finances.instruction_per_student : null),
    format: money,
    more: "more on instruction per student",
    less: "less on instruction per student",
  },
  instructionFasb: {
    key: "instructionFasb",
    field: "finances",
    label: "Instruction spending per student",
    short: "Instruction spending",
    term: "instruction-expenses",
    domain: "value",
    get: (s) => (s.finances?.form === "fasb" ? s.finances.instruction_per_student : null),
    format: money,
    more: "more on instruction per student",
    less: "less on instruction per student",
  },
  instructionForprofit: {
    key: "instructionForprofit",
    field: "finances",
    label: "Instruction spending per student",
    short: "Instruction spending",
    term: "instruction-expenses",
    domain: "value",
    get: (s) => (s.finances?.form === "forprofit" ? s.finances.instruction_per_student : null),
    format: money,
    more: "more on instruction per student",
    less: "less on instruction per student",
  },
  // Endowment per student: only GASB (public) and FASB (private nonprofit) report one; never compare the two.
  // endowmentFasb doubles as Explore's endowment sort, which defaults to private nonprofits only (specs/data-expansion/finances.md).
  endowmentGasb: {
    key: "endowmentGasb",
    field: "finances",
    label: "Endowment per student",
    short: "Endowment/student",
    term: "endowment",
    domain: "value",
    get: (s) => (s.finances?.form === "gasb" ? s.finances.endowment_per_student : null),
    format: money,
    more: "more endowment per student",
    less: "less endowment per student",
  },
  endowmentFasb: {
    key: "endowmentFasb",
    field: "finances",
    label: "Endowment per student",
    short: "Endowment/student",
    term: "endowment",
    domain: "value",
    get: (s) => (s.finances?.form === "fasb" ? s.finances.endowment_per_student : null),
    format: money,
    more: "more endowment per student",
    less: "less endowment per student",
  },
  partTime: {
    key: "partTime",
    field: "demographics.part_time_share",
    label: "Part-time students",
    short: "Part-time %",
    term: "part-time-student",
    domain: "access",
    get: (s) => s.demographics.part_time_share ?? null,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more part-time students",
    less: "fewer part-time students",
  },
  adults: {
    key: "adults",
    field: "demographics.age_25_plus_share",
    label: "Students 25 and older",
    short: "25+ %",
    term: "adult-students",
    domain: "access",
    get: (s) => s.demographics.age_25_plus_share ?? null,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more adult students",
    less: "fewer adult students",
  },
  // 10-year changes (school.trends, from data/history/). Tiny bases are left out: a percent change on a handful of
  // applicants or students says nothing.
  applicantsChange: {
    key: "applicantsChange",
    field: "trends",
    label: "Applications, 10-year change",
    short: "Applications change",
    term: "applicants",
    domain: "admissions",
    get: (s) => (s.trends?.applicants && Math.min(s.trends.applicants.from, s.trends.applicants.to) >= 200 ? s.trends.applicants.change : null),
    format: SIGNED_PCT,
    more: "faster-growing applications",
    less: "slower-growing applications",
  },
  sizeChange: {
    key: "sizeChange",
    field: "trends",
    label: "Undergrads, 10-year change",
    short: "Size change",
    term: "undergrad-enrollment",
    domain: "size",
    get: (s) => (s.trends?.undergrads && Math.min(s.trends.undergrads.from, s.trends.undergrads.to) >= 300 ? s.trends.undergrads.change : null),
    format: SIGNED_PCT,
    more: "faster growth",
    less: "slower growth",
  },
  diversityChange: {
    key: "diversityChange",
    field: "trends",
    label: "Diversity index, 10-year change",
    short: "Diversity change",
    term: "diversity-index",
    domain: "diversity",
    get: (s) => s.trends?.diversity?.change ?? null,
    format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`,
    more: "faster-diversifying",
    less: "slower-diversifying",
  },
  menShareChange: {
    key: "menShareChange",
    field: "trends",
    label: "Men's share, 10-year change",
    short: "Men % change",
    term: "gender-balance",
    domain: "access",
    // Points; same small-college floor as the size change, since a few students swing a small college's shares.
    get: (s) => (s.trends?.men_share && s.trends.undergrads && Math.min(s.trends.undergrads.from, s.trends.undergrads.to) >= 300 ? s.trends.men_share.change : null),
    format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)} pts`,
    more: "shifting toward men",
    less: "shifting toward women",
  },
  avgCostChange: {
    key: "avgCostChange",
    field: "trends",
    label: "Average cost, 10-year change (after inflation)",
    short: "Cost change",
    term: "average-cost",
    domain: "value",
    get: (s) => s.trends?.avg_paid_all?.change ?? null,
    format: SIGNED_PCT,
    more: "bigger cost increases",
    less: "smaller cost increases",
  },
};

/**
 * Aid generosity: the share of the full price that grants cover, averaged
 * over every first-year (students without grants count as 0%). Same idea as a
 * "discount rate", but against the full cost of attendance, not just tuition.
 */
export function aidGenerosity(s: School): number | null {
  const b = s.cost?.breakdown;
  return b && b.full_price > 0 ? b.grant_per_student / b.full_price : null;
}

export function generosityTier(v: number | null): { label: string; level: number } {
  if (v === null) return { label: "Not reported", level: 0 };
  if (v >= 0.55) return { label: "Very generous", level: 4 };
  if (v >= 0.4) return { label: "Generous", level: 3 };
  if (v >= 0.25) return { label: "Moderate", level: 2 };
  return { label: "Limited", level: 1 };
}

/** Family-income bands used by net price by income, low to high. */
export const INCOME_BANDS = ["$0–30K", "$30–48K", "$48–75K", "$75–110K", "$110K+"];

/**
 * Rough "payback": years of a typical graduate's salary that four years of
 * the all-student average cost would take. A conversation starter, not a financial model.
 */
export function paybackYears(s: School): number | null {
  const price = s.cost?.avg_paid_all ?? null;
  const earn = s.outcomes?.median_earnings_10yr ?? null;
  return price !== null && earn ? (price * 4) / earn : null;
}

/** Format a possibly-missing value; missing shows as an en dash. */
export function fmt(key: MetricKey, v: number | null): string {
  return v === null ? "–" : METRICS[key].format(v);
}

/* ------------------------------------------------------------------ */
/* Demographics categories (fixed stack order = fixed color)           */
/* ------------------------------------------------------------------ */

export const DEMOGRAPHIC_CATEGORIES = [
  { key: "white", label: "White", color: "var(--demo-1)" },
  { key: "asian", label: "Asian", color: "var(--demo-2)" },
  { key: "hispanic", label: "Hispanic/Latino", color: "var(--demo-3)" },
  { key: "black", label: "Black", color: "var(--demo-4)" },
  { key: "two_or_more", label: "Two or more", color: "var(--demo-5)" },
  { key: "international", label: "International", color: "var(--demo-6)" },
  { key: "other", label: "Other/unknown", color: "var(--demo-7)" },
] as const;

/* ------------------------------------------------------------------ */
/* Statistics helpers                                                  */
/* ------------------------------------------------------------------ */

export function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** First index in a sorted array whose value is >= target. */
function lowerBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in a sorted array whose value is > target. */
function upperBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Share of the *other* values strictly below `value` (0..1), counting ties
 * as half. `sorted` must be ascending and include `value` itself.
 */
export function percentileRankSorted(value: number, sorted: number[]): number {
  const others = sorted.length - 1;
  if (others <= 0) return 0.5;
  const below = lowerBound(sorted, value);
  const equal = upperBound(sorted, value) - below;
  return Math.min(1, Math.max(0, (below + (equal - 1) / 2) / others));
}
