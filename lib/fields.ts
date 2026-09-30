/**
 * Field registry: every value the dataset stores or the site derives, with its
 * default source, which release year ("vintage") it describes, and how it's
 * calculated. The single source of truth for citations (see specs/data-lineage.md).
 *
 * Adding a field to data/schools.json? Register it here, or `npm run sync-data`
 * and `npm run check:lineage` fail. Pure module (no runtime imports) so Node
 * scripts and tests can load it directly.
 */
import type { SourceKey, Topic } from "./types";

/** Release years written by the sync to data/meta.json `vintages`. `null` = no single year (e.g. Scorecard outcomes). */
export type VintageKey =
  | "ipeds-adm"
  | "ipeds-sfa"
  | "ipeds-ic"
  | "scorecard-enrollment"
  /** Student age: IPEDS collects it in odd-numbered falls only, so it trails enrollment by a year every other year. */
  | "scorecard-age"
  | "scorecard-cost"
  | "scorecard-latest";

export interface FieldDef {
  label: string;
  topic: Topic;
  /** Source used unless a school's `lineage` says otherwise. */
  source: SourceKey;
  /** Which release year the default source's value describes; `cds` values carry their own edition. */
  vintage: VintageKey | null;
  /** Calculated from other fields. Inputs are field paths; citations expand to the inputs' sources. */
  derived?: { formula: string; inputs: readonly string[] };
  /** Computed at render time (lib/metrics.ts), never stored in data/schools.json. */
  computed?: true;
}

const scorecard = (label: string, topic: Topic, vintage: VintageKey = "scorecard-latest"): FieldDef => ({
  label,
  topic,
  source: "scorecard",
  vintage,
});
const adm = (label: string): FieldDef => ({ label, topic: "admissions", source: "ipeds-adm", vintage: "ipeds-adm" });
const sfa = (label: string): FieldDef => ({ label, topic: "aid", source: "ipeds-sfa", vintage: "ipeds-sfa" });
const ic = (label: string): FieldDef => ({ label, topic: "prices", source: "ipeds-ic", vintage: "ipeds-ic" });

export const FIELDS = {
  /* ---- Institution ---- */
  unit_id: scorecard("IPEDS unit ID", "institution"),
  name: scorecard("Name", "institution"),
  "location.city": scorecard("City", "institution"),
  "location.state": scorecard("State", "institution"),
  "location.zip": scorecard("ZIP code", "institution"),
  "location.region": {
    ...scorecard("Region", "institution"),
    derived: { formula: "Region assigned from the state", inputs: ["location.state"] },
  },
  type: scorecard("Type (public, private)", "institution"),
  "links.website": scorecard("Website", "institution"),
  "links.price_calculator": scorecard("Net price calculator", "institution"),

  /* ---- Admissions (IPEDS ADM) ---- */
  "admissions.year": adm("Admissions year"),
  "admissions.applicants": adm("Applicants"),
  "admissions.admitted": adm("Admitted"),
  "admissions.enrolled": adm("Enrolled"),
  "admissions.acceptance_rate": {
    ...adm("Acceptance rate"),
    derived: { formula: "Admitted ÷ applicants (not calculated under 10 applicants)", inputs: ["admissions.admitted", "admissions.applicants"] },
  },
  "admissions.sat_reading_25_75": adm("SAT Reading & Writing, middle 50%"),
  "admissions.sat_math_25_75": adm("SAT Math, middle 50%"),
  "admissions.act_composite_25_75": adm("ACT composite, middle 50%"),
  "admissions.test_submission_rate_sat": adm("Share submitting SAT"),
  "admissions.test_submission_rate_act": adm("Share submitting ACT"),
  "admissions.test_policy": adm("Test policy"),
  "admissions.by_sex": adm("Applicants, admits, and enrollees by sex"),
  "admissions.factors": adm("What's considered in admission (GPA, essay, legacy, and more)"),
  "admissions.sat_reading_median": adm("SAT Reading & Writing, median"),
  "admissions.sat_math_median": adm("SAT Math, median"),
  "admissions.act_composite_median": adm("ACT composite, median"),
  "admissions.act_english_25_75": adm("ACT English, middle 50%"),
  "admissions.act_math_25_75": adm("ACT Math, middle 50%"),

  /* ---- Students (Scorecard, from IPEDS fall enrollment) ---- */
  "demographics.undergrad_enrollment": scorecard("Undergraduates", "enrollment", "scorecard-enrollment"),
  "demographics.racial_diversity": scorecard("Race & ethnicity", "demographics", "scorecard-enrollment"),
  "demographics.pell_grant_percent": scorecard("Pell Grant recipients", "demographics"),
  "demographics.first_gen_percent": scorecard("First-generation students", "demographics"),
  "demographics.men_share": scorecard("Men (share of undergraduates)", "demographics", "scorecard-enrollment"),
  "demographics.women_share": scorecard("Women (share of undergraduates)", "demographics", "scorecard-enrollment"),
  "demographics.part_time_share": scorecard("Part-time students", "enrollment", "scorecard-enrollment"),
  "demographics.age_25_plus_share": scorecard("Students 25 and older", "demographics", "scorecard-age"),

  /* ---- Cost (Scorecard) ---- */
  "cost.avg_net_price": scorecard("Average net price (federal aid recipients)", "cost", "scorecard-cost"),
  "cost.net_price_by_income": scorecard("Net price by family income", "cost", "scorecard-cost"),
  "cost.cost_of_attendance": scorecard("Cost of attendance", "cost"),
  "cost.tuition_in_state": scorecard("Tuition, in-state", "cost"),
  "cost.tuition_out_of_state": scorecard("Tuition, out-of-state", "cost"),

  /* ---- Prices (IPEDS IC / COST1) and the all-student estimate ---- */
  "cost.year": ic("Price year"),
  "cost.tuition_fees": ic("Tuition & fees by residency"),
  "cost.components": ic("Books, room & board, other expenses"),
  "cost.sticker": {
    ...ic("Sticker price by residency"),
    derived: { formula: "Tuition & fees + books + on-campus room & board + other expenses", inputs: ["cost.tuition_fees", "cost.components"] },
  },
  "cost.residency": { ...sfa("First-years paying each residency rate"), topic: "prices" },
  "cost.aided_net_price": { ...sfa("Net price, students with grants"), topic: "cost" },
  "cost.breakdown": {
    ...ic("Average cost breakdown"),
    derived: {
      formula: "Residency-weighted tuition & fees + books + room & board + other, minus grant dollars ÷ first-years",
      inputs: ["cost.tuition_fees", "cost.residency", "cost.components", "aid.grant_total", "aid.cohort"],
    },
  },
  "cost.tuition_plans": ic("Tuition plans offered"),
  "cost.promise_program": ic("Promise program"),
  "admissions.application_fee": { ...ic("Application fee"), topic: "admissions" },
  "campus.housing": { ...ic("Campus housing and meal plans"), topic: "campus" },
  "cost.avg_paid_all": {
    ...ic("Average cost, all students"),
    topic: "cost",
    derived: { formula: "Full price − grant dollars per first-year (students without grants count at full price)", inputs: ["cost.breakdown"] },
  },

  /* ---- Outcomes (Scorecard; each measures a past entering cohort) ---- */
  "outcomes.median_earnings_10yr": scorecard("Median earnings, 10 years after entry", "outcomes"),
  "outcomes.median_earnings_6yr": scorecard("Median earnings, 6 years after entry", "outcomes"),
  "outcomes.graduation_rate": scorecard("Graduation rate", "outcomes"),
  "outcomes.retention_rate": scorecard("Retention rate", "outcomes"),
  "outcomes.median_debt": scorecard("Median debt at graduation", "outcomes"),
  "outcomes.monthly_loan_payment": scorecard("Monthly loan payment", "outcomes"),
  // Key N = the N-1–N academic year (matches IPEDS SFA UFLOANP; checked 2026-09-29), like net price.
  "outcomes.federal_loan_rate": scorecard("Undergraduates with a federal loan", "aid", "scorecard-cost"),
  "outcomes.median_debt_pell": scorecard("Median debt, Pell Grant recipients", "outcomes"),
  "outcomes.median_debt_no_pell": scorecard("Median debt, students without a Pell Grant", "outcomes"),
  "outcomes.median_debt_by_income": scorecard("Median debt by family income", "outcomes"),
  "outcomes.repayment_3yr": scorecard("Borrowers' repayment status 3 years after leaving", "outcomes"),

  /* ---- Aid (IPEDS SFA / COST2) ---- */
  "aid.cohort": sfa("First-years in the aid cohort"),
  "aid.any_aid_pct": sfa("Share receiving any aid"),
  "aid.grant_pct": {
    ...sfa("Share receiving grants"),
    derived: { formula: "Grant recipients ÷ first-years in the aid cohort", inputs: ["aid.grant_count", "aid.cohort"] },
  },
  "aid.grant_avg": sfa("Average grant"),
  "aid.grant_count": sfa("Grant recipients"),
  "aid.grant_total": sfa("Total grant dollars"),
  "aid.institutional_pct": sfa("Share receiving aid from the college"),
  "aid.institutional_avg": sfa("Average aid from the college"),
  "aid.pell_pct": sfa("Share receiving Pell Grants"),
  "aid.pell_avg": sfa("Average Pell Grant"),
  "aid.state_pct": sfa("Share receiving state grants"),
  "aid.loan_pct": sfa("Share taking student loans"),
  "aid.loan_avg": sfa("Average student loan"),
  "aid.by_income": sfa("Federal aid by family income"),
  "aid.cds": { label: "Need-based and merit aid (Common Data Set H2/H2A)", topic: "aid", source: "cds", vintage: null },

  /* ---- History summary (data/history/, `npm run sync-history`) ---- */
  trends: {
    label: "10-year changes",
    topic: "cost",
    source: "ipeds-ic",
    // Citations expand to the inputs' sources and years; this is only the fallback release.
    vintage: "ipeds-ic",
    derived: {
      formula: "Change over the last 10 years of each college's history; money after inflation (CPI-U), shares and the diversity index in points",
      inputs: ["cost.avg_paid_all", "cost.breakdown", "admissions.acceptance_rate", "admissions.applicants", "demographics.undergrad_enrollment", "demographics.racial_diversity", "demographics.men_share", "outcomes.federal_loan_rate", "aid.grant_pct"],
    },
  },

  /* ---- Computed at render time (lib/metrics.ts) ---- */
  "derived.sat_composite": {
    ...adm("SAT total, middle 50%"),
    computed: true,
    derived: { formula: "Reading & Writing + Math at each percentile (an approximation)", inputs: ["admissions.sat_reading_25_75", "admissions.sat_math_25_75"] },
  },
  "derived.sat_mid": {
    ...adm("SAT midpoint"),
    computed: true,
    derived: { formula: "Midpoint of the SAT total middle 50%", inputs: ["derived.sat_composite"] },
  },
  "derived.act_mid": {
    ...adm("ACT midpoint"),
    computed: true,
    derived: { formula: "Midpoint of the ACT middle 50%", inputs: ["admissions.act_composite_25_75"] },
  },
  "derived.admit_rate_men": {
    ...adm("Acceptance rate, men"),
    computed: true,
    derived: { formula: "Men admitted ÷ men who applied (not calculated under 10 applicants)", inputs: ["admissions.by_sex"] },
  },
  "derived.admit_rate_women": {
    ...adm("Acceptance rate, women"),
    computed: true,
    derived: { formula: "Women admitted ÷ women who applied (not calculated under 10 applicants)", inputs: ["admissions.by_sex"] },
  },
  "derived.sat_median": {
    ...adm("SAT total, median"),
    computed: true,
    derived: { formula: "Reading & Writing median + Math median (an approximation, like the SAT total range)", inputs: ["admissions.sat_reading_median", "admissions.sat_math_median"] },
  },
  "derived.yield": {
    ...adm("Yield rate"),
    computed: true,
    derived: { formula: "Enrolled ÷ admitted", inputs: ["admissions.enrolled", "admissions.admitted"] },
  },
  "derived.diversity_index": {
    ...scorecard("Diversity index", "demographics", "scorecard-enrollment"),
    computed: true,
    derived: { formula: "Chance two random students are from different racial/ethnic groups (Simpson's index)", inputs: ["demographics.racial_diversity"] },
  },
  "derived.aid_generosity": {
    ...ic("Aid generosity"),
    topic: "aid",
    computed: true,
    derived: { formula: "Grant dollars per first-year ÷ full price", inputs: ["cost.breakdown"] },
  },
  "derived.payback_years": {
    ...scorecard("Payback estimate", "outcomes"),
    computed: true,
    derived: { formula: "4 × average cost ÷ median earnings 10 years after entry", inputs: ["cost.avg_paid_all", "outcomes.median_earnings_10yr"] },
  },
} satisfies Record<string, FieldDef>;

export type FieldPath = keyof typeof FIELDS;

export function fieldDef(path: FieldPath): FieldDef {
  return FIELDS[path];
}

export function isFieldPath(path: string): path is FieldPath {
  return Object.prototype.hasOwnProperty.call(FIELDS, path);
}

/**
 * The registered path that covers a stored value's path: the path itself or its
 * nearest registered ancestor (e.g. "demographics.racial_diversity.asian" →
 * "demographics.racial_diversity"). Null when nothing covers it.
 */
export function registeredPathFor(path: string): FieldPath | null {
  let p = path;
  while (p) {
    if (isFieldPath(p)) return p;
    const dot = p.lastIndexOf(".");
    if (dot < 0) return null;
    p = p.slice(0, dot);
  }
  return null;
}

/** School keys that hold citation metadata rather than data values. */
export const METADATA_KEYS = new Set(["lineage", "cds"]);
