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
  /** The IPEDS directory (HD): setting, Carnegie classes, designations, coordinates. Its own year, ahead of admissions. */
  | "ipeds-hd"
  /** IPEDS Institutional Characteristics (IC{Y}, not the price files): athletics, programs, services. Its own year. */
  | "ipeds-ic-char"
  /** IPEDS Fall Enrollment part D (EF{Y}D): the student-to-faculty ratio. Fall, like admissions. */
  | "ipeds-ef"
  /** IPEDS Outcome Measures (OM{Y}): students who entered in fall Y − 8, followed for 8 years. */
  | "ipeds-om"
  /** IPEDS Graduation Rates, Pell/subsidized-loan file (GR{Y}_PELL_SSL): the class that entered fall Y − 6. */
  | "ipeds-gr"
  /** IPEDS Salaries survey (SAL{Y}_IS, all-ranks row): average faculty salary, 9-month equated. */
  | "ipeds-sal"
  /** IPEDS Fall Enrollment part C (EF{Y}C): where first-years come from. Required in even-numbered falls only. */
  | "ipeds-ef-c"
  /** IPEDS Fall Enrollment part A (EF{Y}A): enrollment by level, incl. new transfer-ins. Fall Y. */
  | "ipeds-ef-a"
  /** IPEDS Completions (C{Y}_A): degrees awarded by field, July Y−1 to June Y ("2024–25 graduates"). */
  | "ipeds-c"
  /** IPEDS Finance survey, derived per-student figures (DRVF{Y}): endowment and spending per student. Fiscal year. */
  | "ipeds-f"
  | "scorecard-enrollment"
  /** Student age: IPEDS collects it in odd-numbered falls only, so it trails enrollment by a year every other year. */
  | "scorecard-age"
  | "scorecard-cost"
  /** Retention: the class that entered the fall before the enrollment fall ("Entered fall 2023"); probed like scorecard-age. */
  | "scorecard-retention"
  | "scorecard-latest"
  /** College Scorecard Field of Study bulk CSV: each metric pools a different, independently-refreshed cohort, so like scorecard-latest this has no single year. */
  | "scorecard-fos";

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
const hd = (label: string): FieldDef => ({ label, topic: "campus", source: "ipeds-hd", vintage: "ipeds-hd" });
const gr = (label: string): FieldDef => ({
  label,
  topic: "outcomes",
  source: "ipeds-gr",
  vintage: "ipeds-gr",
  derived: { formula: "Finished any degree or certificate within 150% of normal time ÷ adjusted cohort (not shown under 30 students)", inputs: ["outcomes.grad_cohorts"] },
});
const icChar = (label: string, topic: Topic = "campus"): FieldDef => ({ label, topic, source: "ipeds-ic-char", vintage: "ipeds-ic-char" });
/** A value the college published itself; the year lives in each value's lineage record, like `cds`. */
const reported = (label: string, topic: Topic = "admissions"): FieldDef => ({ label, topic, source: "college-site", vintage: null });

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
  // The funnel a newer college-reported class replaced (specs/college-reported-round-2.md, Decision 1): stored only
  // then, shown in the tooltip as "Federal data, fall 2024: …", and used by yield when the shown pair mixes classes.
  "admissions.federal": adm("Federal admissions figures replaced by a newer college-reported class"),
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
  "academics.student_faculty_ratio": { label: "Students per faculty member", topic: "academics", source: "ipeds-ef", vintage: "ipeds-ef" },
  // Faculty (specs/data-expansion/faculty.md): salary and headcount default to ipeds-sal; full-time share is
  // Scorecard, registered separately since it overrides this ancestor for that one leaf.
  "academics.faculty": { label: "Faculty salary (9-month equated, all ranks)", topic: "academics", source: "ipeds-sal", vintage: "ipeds-sal" },
  "academics.faculty.full_time_share": scorecard("Full-time faculty share", "academics", "scorecard-enrollment"),
  "demographics.residence": { label: "Where first-years come from: in-state, other states, abroad", topic: "demographics", source: "ipeds-ef-c", vintage: "ipeds-ef-c" },
  // Stored in the per-college detail file (lib/detail.ts), not data/schools.json.
  // Transfers in (specs/data-expansion/transfers.md).
  "demographics.transfer_in": { label: "New transfer-in undergraduates this fall", topic: "demographics", source: "ipeds-ef-a", vintage: "ipeds-ef-a" },
  "detail.home_states": { label: "First-years by home state", topic: "demographics", source: "ipeds-ef-c", vintage: "ipeds-ef-c" },
  // Majors (specs/data-expansion/majors.md): IPEDS Completions, bachelor's degrees by field (lib/majors.ts).
  "academics.bachelors_awarded": { label: "Bachelor's degrees awarded (first majors)", topic: "academics", source: "ipeds-c", vintage: "ipeds-c" },
  "academics.majors_top": {
    label: "Most popular majors",
    topic: "academics",
    source: "ipeds-c",
    vintage: "ipeds-c",
    derived: { formula: "First-major bachelor's in each program (6-digit CIP) ÷ all first-major bachelor's; the top 5", inputs: ["academics.bachelors_awarded"] },
  },
  "academics.bachelors_by_family": { label: "Bachelor's degrees by field (2-digit CIP family, first majors)", topic: "academics", source: "ipeds-c", vintage: "ipeds-c" },
  // Stored in the per-college detail file (lib/detail.ts): every program's first- and second-major bachelor's.
  "detail.majors": { label: "Bachelor's degrees by program (first and second majors)", topic: "academics", source: "ipeds-c", vintage: "ipeds-c" },
  // Field of study earnings and debt (specs/data-expansion/field-of-study.md): per-college detail table only, plus
  // a snapshot count for Explore/cards.
  "detail.programs": { label: "Earnings and debt by major, bachelor's programs (College Scorecard Field of Study)", topic: "academics", source: "scorecard-fos", vintage: "scorecard-fos" },
  "academics.programs_with_earnings": { label: "Bachelor's programs with 4-year earnings reported", topic: "academics", source: "scorecard-fos", vintage: "scorecard-fos" },
  finances: { label: "Endowment, spending, and revenue (IPEDS Finance survey)", topic: "academics", source: "ipeds-f", vintage: "ipeds-f" },
  "campus.athletics": icChar("Athletics: association, division, conference, sports"),
  "campus.programs": icChar("ROTC, study abroad, undergraduate research, and other programs"),
  "campus.services": icChar("Student services"),
  "campus.calendar": icChar("Academic calendar"),
  "admissions.accepts_ap_credit": icChar("Credit for AP exams", "admissions"),
  "demographics.disability_services": icChar("Undergrads registered with disability services", "demographics"),
  "campus.setting": hd("Setting (city, suburb, town, or rural)"),
  "campus.carnegie": hd("Carnegie Classification"),
  "campus.designations": hd("HBCU, tribal college, and land-grant designations"),
  "campus.msi": scorecard("Minority-serving and single-sex designations", "campus"),
  "location.lat": { ...hd("Latitude"), topic: "institution" },
  "location.lng": { ...hd("Longitude"), topic: "institution" },
  "cost.avg_paid_all": {
    ...ic("Average cost, all students"),
    topic: "cost",
    derived: { formula: "Full price − grant dollars per first-year (students without grants count at full price)", inputs: ["cost.breakdown"] },
  },

  /* ---- Outcomes (Scorecard; each measures a past entering cohort) ---- */
  "outcomes.median_earnings_10yr": scorecard("Median earnings, 10 years after entry", "outcomes"),
  "outcomes.median_earnings_6yr": scorecard("Median earnings, 6 years after entry", "outcomes"),
  "outcomes.graduation_rate": scorecard("Graduation rate", "outcomes"),
  "outcomes.retention_rate": scorecard("Retention rate", "outcomes", "scorecard-retention"),
  "outcomes.median_debt": scorecard("Median debt at graduation", "outcomes"),
  "outcomes.monthly_loan_payment": scorecard("Monthly loan payment", "outcomes"),
  // Key N = the N-1–N academic year (matches IPEDS SFA UFLOANP; checked 2026-09-29), like net price.
  "outcomes.federal_loan_rate": scorecard("Undergraduates with a federal loan", "aid", "scorecard-cost"),
  "outcomes.median_debt_pell": scorecard("Median debt, Pell Grant recipients", "outcomes"),
  "outcomes.median_debt_no_pell": scorecard("Median debt, students without a Pell Grant", "outcomes"),
  "outcomes.median_debt_by_income": scorecard("Median debt by family income", "outcomes"),
  "outcomes.repayment_3yr": scorecard("Borrowers' repayment status 3 years after leaving", "outcomes"),
  // IPEDS Outcome Measures (specs/data-expansion/outcome-measures.md).
  "outcomes.eight_year": { label: "8-year outcomes, all entering students", topic: "outcomes", source: "ipeds-om", vintage: "ipeds-om" },
  // Graduation by group (specs/data-expansion/graduation-by-group.md): IPEDS GR{Y}_PELL_SSL and Scorecard by race.
  "outcomes.grad_cohorts": { label: "Students in the graduation cohort, by Pell and loan status", topic: "outcomes", source: "ipeds-gr", vintage: "ipeds-gr" },
  "outcomes.grad_rate_pell": gr("Graduated within 6 years, Pell Grant recipients"),
  "outcomes.grad_rate_loan_no_pell": gr("Graduated within 6 years, subsidized loan without a Pell Grant"),
  "outcomes.grad_rate_no_pell_no_loan": gr("Graduated within 6 years, neither Pell Grant nor subsidized loan"),
  "outcomes.grad_rate_ftft": gr("Graduated within 6 years, all first-time full-time students"),
  "outcomes.grad_cohorts_by_race": scorecard("Students in the graduation cohort, by race and ethnicity", "outcomes"),
  "outcomes.grad_rate_by_race": scorecard("Graduated within 6 years, by race and ethnicity", "outcomes"),

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

  /* ---- College-reported figures (data/college-reported.json → school.reported; specs/college-reported-data.md) ---- */
  // Default source is the college's site; every stored value carries an `extracted` lineage record with the document,
  // quote, year, and retrieval date (validateSchool requires it), so the year never comes from a vintage.
  "reported.admissions.entering_term": reported("Entering term (college-reported)"),
  "reported.admissions.year": reported("Admissions year (college-reported)"),
  "reported.admissions.applicants": reported("Applicants (college-reported)"),
  "reported.admissions.admitted": reported("Admitted (college-reported)"),
  "reported.admissions.enrolled": reported("Enrolled (college-reported)"),
  "reported.admissions.acceptance_rate": reported("Acceptance rate (college-reported)"),
  "reported.admissions.source_kind": reported("Kind of document (college-reported)"),
  // CDS C1 by residency (specs/data-expansion/cds-residency-admissions.md; lib/cds/residency.ts): one lineage record
  // per stored leaf, from the newest passed grid.
  "reported.admissions_by_residency.entering_term": reported("Entering class of the residency grid (college-reported)"),
  "reported.admissions_by_residency.year": reported("Residency grid year (college-reported)"),
  "reported.admissions_by_residency.edition": reported("Residency grid CDS edition (college-reported)"),
  "reported.admissions_by_residency.in_state.applicants": reported("Applied, from the college's state (college-reported)"),
  "reported.admissions_by_residency.in_state.admitted": reported("Admitted, from the college's state (college-reported)"),
  "reported.admissions_by_residency.in_state.enrolled": reported("Enrolled, from the college's state (college-reported)"),
  "reported.admissions_by_residency.out_of_state.applicants": reported("Applied, from other states (college-reported)"),
  "reported.admissions_by_residency.out_of_state.admitted": reported("Admitted, from other states (college-reported)"),
  "reported.admissions_by_residency.out_of_state.enrolled": reported("Enrolled, from other states (college-reported)"),
  "reported.admissions_by_residency.international.applicants": reported("Applied, from abroad (college-reported)"),
  "reported.admissions_by_residency.international.admitted": reported("Admitted, from abroad (college-reported)"),
  "reported.admissions_by_residency.international.enrolled": reported("Enrolled, from abroad (college-reported)"),
  "reported.admissions_by_residency.unknown.applicants": reported("Applied, residency unknown (college-reported)"),
  "reported.admissions_by_residency.unknown.admitted": reported("Admitted, residency unknown (college-reported)"),
  "reported.admissions_by_residency.unknown.enrolled": reported("Enrolled, residency unknown (college-reported)"),
  "reported.admissions_by_residency.total.applicants": reported("Applied, all residencies (college-reported)"),
  "reported.admissions_by_residency.total.admitted": reported("Admitted, all residencies (college-reported)"),
  "reported.admissions_by_residency.total.enrolled": reported("Enrolled, all residencies (college-reported)"),
  // CDS cost and debt (specs/data-expansion/cds-cost-and-debt.md, lib/cds/cost-and-debt.ts). Next year's price sits
  // beside the federal price and never replaces it; none of these reach ranks, sorts, percentiles, or history.
  "reported.cost.next_year": reported("Next year's tuition (college-reported)", "cost"),
  "reported.cost.next_year.first_year.fees": reported("Next year's required fees (college-reported)", "cost"),
  "reported.cost.next_year.first_year.food_and_housing": reported("Next year's food and housing (college-reported)", "cost"),
  "reported.cost.next_year_detail": reported("Next year's tuition policy and other expenses (college-reported)", "cost"),
  "reported.cost.next_year_detail.pct_paying_more": reported("Undergraduates paying more than the published tuition (college-reported)", "cost"),
  "reported.outcomes.graduating_class": reported("Graduating class size (college-reported)", "outcomes"),
  "reported.outcomes.graduate_debt": reported("Graduates who borrowed, by loan source (college-reported)", "outcomes"),
  "reported.outcomes.graduate_debt.rows.any.share": reported("Graduates who borrowed from any source (college-reported)", "outcomes"),
  "reported.outcomes.graduate_debt.rows.any.avg_principal": reported("Average total borrowed, all loan types (college-reported)", "outcomes"),
  // CDS student body and outcomes (specs/data-expansion/cds-student-body-and-outcomes.md): the federal values a newer
  // CDS fall or cohort replaced (lib/newest-groups.ts), and the one new field, 4- and 5-year graduation by aid group.
  "demographics.federal": scorecard("Federal enrollment figures replaced by a newer college-reported fall", "enrollment", "scorecard-enrollment"),
  "outcomes.federal.retention": scorecard("Federal retention rate replaced by a newer college-reported class", "outcomes", "scorecard-retention"),
  "outcomes.federal.graduation": { label: "Federal graduation by Pell and loan status replaced by a newer college-reported class", topic: "outcomes", source: "ipeds-gr", vintage: "ipeds-gr" },
  "reported.outcomes.graduation": reported("Graduated within 4 and 5 years, by Pell and loan status (college-reported)", "outcomes"),

  // CDS admissions profile (specs/data-expansion/cds-admissions.md; lib/cds/admissions.ts): one cited path per stored
  // leaf, so each value's ⓘ carries its own cell and quote.
  "reported.admission_profile.gpa.average": reported("Average high school GPA of first-years"),
  "reported.admission_profile.gpa.scale": reported("GPA scale (derived: weighted when above 4.0 or stated)"),
  "reported.admission_profile.gpa.submitted_share": reported("Share of first-years who reported a GPA"),
  "reported.admission_profile.gpa.bands.all": reported("First-years by GPA band (all)"),
  "reported.admission_profile.gpa.bands.with_test": reported("First-years by GPA band (sent test scores)"),
  "reported.admission_profile.gpa.bands.without_test": reported("First-years by GPA band (didn't send scores)"),
  "reported.admission_profile.class_rank.top_tenth": reported("First-years in the top tenth of their high school class"),
  "reported.admission_profile.class_rank.top_quarter": reported("First-years in the top quarter of their high school class"),
  "reported.admission_profile.class_rank.top_half": reported("First-years in the top half of their high school class"),
  "reported.admission_profile.class_rank.bottom_half": reported("First-years in the bottom half of their high school class"),
  "reported.admission_profile.class_rank.bottom_quarter": reported("First-years in the bottom quarter of their high school class"),
  "reported.admission_profile.class_rank.submitted_share": reported("Share of first-years whose high school reported a rank"),
  "reported.admission_profile.factors.rigor": reported("How much it counts: rigor of high school record"),
  "reported.admission_profile.factors.class_rank": reported("How much it counts: class rank"),
  "reported.admission_profile.factors.gpa": reported("How much it counts: academic GPA"),
  "reported.admission_profile.factors.test_scores": reported("How much it counts: test scores"),
  "reported.admission_profile.factors.essay": reported("How much it counts: essay"),
  "reported.admission_profile.factors.recommendations": reported("How much it counts: recommendations"),
  "reported.admission_profile.factors.interview": reported("How much it counts: interview"),
  "reported.admission_profile.factors.extracurriculars": reported("How much it counts: extracurricular activities"),
  "reported.admission_profile.factors.talent": reported("How much it counts: talent or ability"),
  "reported.admission_profile.factors.character": reported("How much it counts: character and personal qualities"),
  "reported.admission_profile.factors.first_generation": reported("How much it counts: first generation"),
  "reported.admission_profile.factors.alumni_relation": reported("How much it counts: alumni relation (legacy)"),
  "reported.admission_profile.factors.geographic_residence": reported("How much it counts: geographic residence"),
  "reported.admission_profile.factors.state_residency": reported("How much it counts: state residency"),
  "reported.admission_profile.factors.religious": reported("How much it counts: religious affiliation"),
  "reported.admission_profile.factors.volunteer_work": reported("How much it counts: volunteer work"),
  "reported.admission_profile.factors.work_experience": reported("How much it counts: work experience"),
  "reported.admission_profile.factors.interest": reported("How much it counts: level of applicant's interest"),
  "reported.admission_profile.wait_list.policy": reported("Wait list: uses one"),
  "reported.admission_profile.wait_list.offered": reported("Wait list: offered a place"),
  "reported.admission_profile.wait_list.accepted": reported("Wait list: accepted a place"),
  "reported.admission_profile.wait_list.admitted": reported("Wait list: admitted"),
  "reported.admission_profile.early_decision.offered": reported("Early decision: offered"),
  "reported.admission_profile.early_decision.first.closing": reported("Early decision: apply-by date"),
  "reported.admission_profile.early_decision.first.notification": reported("Early decision: decision date"),
  "reported.admission_profile.early_decision.other.closing": reported("Early decision II: apply-by date"),
  "reported.admission_profile.early_decision.other.notification": reported("Early decision II: decision date"),
  "reported.admission_profile.early_decision.applicants": reported("Early decision: applications"),
  "reported.admission_profile.early_decision.admitted": reported("Early decision: admitted"),
  "reported.admission_profile.early_action.offered": reported("Early action: offered"),
  "reported.admission_profile.early_action.closing": reported("Early action: apply-by date"),
  "reported.admission_profile.early_action.notification": reported("Early action: decision date"),
  "reported.admission_profile.early_action.restrictive": reported("Early action: restrictive"),
  // The six C7 factors IPEDS also asks about: a newer C7 flips the federal considered / not considered answer
  // (lib/cds/admissions.ts applyNewestFactors), cited to the CDS; the federal answer is kept in federal_factors.
  "admissions.factors.gpa": adm("Whether GPA is considered in admission"),
  "admissions.factors.class_rank": adm("Whether class rank is considered in admission"),
  "admissions.factors.recommendations": adm("Whether recommendations are considered in admission"),
  "admissions.factors.essay": adm("Whether an essay is considered in admission"),
  "admissions.factors.legacy": adm("Whether legacy status is considered in admission"),
  "admissions.factors.work_experience": adm("Whether work experience is considered in admission"),
  "admissions.federal_factors": adm("Federal admission-factor answers replaced by a newer Common Data Set"),
  "derived.ed_admit_rate": {
    ...reported("Early decision admit rate"),
    computed: true,
    derived: { formula: "Early decision admitted ÷ early decision applications", inputs: ["reported.admission_profile.early_decision.admitted", "reported.admission_profile.early_decision.applicants"] },
  },
  "derived.wait_list_admit_rate": {
    ...reported("Wait-list admit rate"),
    computed: true,
    derived: { formula: "Admitted from the wait list ÷ accepted a place on it", inputs: ["reported.admission_profile.wait_list.admitted", "reported.admission_profile.wait_list.accepted"] },
  },
  "derived.gpa_middle_half": {
    ...reported("Middle half of first-years' GPAs"),
    computed: true,
    derived: { formula: "The GPA bands holding the 25th and 75th percentiles of the \"all\" column", inputs: ["reported.admission_profile.gpa.bands.all"] },
  },
  // CDS C8/C9 (specs/data-expansion/cds-test-scores-and-policy.md): records → school.reported (lib/cds/test-scores.ts).
  "reported.test_policy": reported("Test policy for the coming application cycle (CDS C8)"),
  "reported.test_policy_note": reported("Test policy note (CDS C8F)"),
  "reported.test_policy_events": reported("Test policy changes (CDS C8)"),
  "reported.tests.year": reported("Entering class the test scores describe (CDS C9)"),
  "reported.tests.sat_share": reported("Share who sent an SAT (CDS C9)"),
  "reported.tests.act_share": reported("Share who sent an ACT (CDS C9)"),
  "reported.tests.sat_submitters": reported("Number who sent an SAT (CDS C9)"),
  "reported.tests.act_submitters": reported("Number who sent an ACT (CDS C9)"),
  "reported.tests.sat_composite": reported("SAT total, 25th/50th/75th percentile (CDS C9)"),
  "reported.tests.sat_ebrw": reported("SAT Reading & Writing, 25th/50th/75th percentile (CDS C9)"),
  "reported.tests.sat_math": reported("SAT Math, 25th/50th/75th percentile (CDS C9)"),
  "reported.tests.act_composite": reported("ACT composite, 25th/50th/75th percentile (CDS C9)"),
  "reported.tests.act_math": reported("ACT Math, 25th/50th/75th percentile (CDS C9)"),
  "reported.tests.act_english": reported("ACT English, 25th/50th/75th percentile (CDS C9)"),
  "reported.tests.act_science": reported("ACT Science, 25th/50th/75th percentile (CDS C9)"),
  "reported.tests.act_reading": reported("ACT Reading, 25th/50th/75th percentile (CDS C9)"),
  "reported.tests.bands.sat_ebrw": reported("SAT Reading & Writing score bands (CDS C9)"),
  "reported.tests.bands.sat_math": reported("SAT Math score bands (CDS C9)"),
  "reported.tests.bands.sat_composite": reported("SAT total score bands (CDS C9)"),
  "reported.tests.bands.act_composite": reported("ACT composite score bands (CDS C9)"),
  "reported.tests.bands.act_english": reported("ACT English score bands (CDS C9)"),
  "reported.tests.bands.act_math": reported("ACT Math score bands (CDS C9)"),
  // The test-policy, SAT, and ACT blocks a newer C8/C9 replaced (Decisions 1–2), like admissions.federal for the funnel.
  "admissions.federal_tests": adm("Federal test policy and scores replaced by a newer Common Data Set"),
  // The SAT total a college shows (Decision 3): never ranked; ranks keep derived.sat_composite for every college.
  "derived.sat_total": {
    ...adm("SAT total, middle 50% (as shown)"),
    computed: true,
    derived: {
      formula: "The college's own SAT total when its scores come from its Common Data Set and it reports one; else Reading & Writing + Math",
      inputs: ["reported.tests.sat_composite", "derived.sat_composite"],
    },
  },

  /* ---- History summary (data/history/, `npm run sync-history`) ---- */
  trends: {
    label: "10-year changes",
    topic: "cost",
    source: "ipeds-ic",
    // Citations expand to the inputs' sources and years; this is only the fallback release.
    vintage: "ipeds-ic",
    derived: {
      formula: "Change over the last 10 years of each college's history; money after inflation (CPI-U), shares and the diversity index in points",
      inputs: ["cost.avg_paid_all", "cost.breakdown", "admissions.acceptance_rate", "admissions.applicants", "demographics.undergrad_enrollment", "demographics.racial_diversity", "demographics.men_share", "outcomes.federal_loan_rate", "aid.grant_pct", "outcomes.grad_rate_pell", "outcomes.grad_rate_no_pell_no_loan"],
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
    derived: {
      formula: "Enrolled ÷ admitted, from the same class; when the newest enrolled and admitted describe different classes, from the previous class's figures",
      inputs: ["admissions.enrolled", "admissions.admitted", "admissions.federal"],
    },
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
  "derived.pell_grad_gap": {
    ...gr("Pell graduation gap"),
    computed: true,
    derived: { formula: "Graduation rate of students with neither a Pell Grant nor a subsidized loan − Pell Grant recipients' rate (points)", inputs: ["outcomes.grad_rate_no_pell_no_loan", "outcomes.grad_rate_pell"] },
  },
  // Residency rates (specs/data-expansion/cds-residency-admissions.md; lib/cds/residency-display.ts). Partial coverage:
  // never in METRICS, ranks, medians, sorts, the radar, Key differences, or "Known for" (tests/residency-admissions.test.mts).
  "derived.admit_rate_in_state": {
    ...reported("Acceptance rate, in-state"),
    computed: true,
    derived: { formula: "Admitted ÷ applied from the college's state, from the college's Common Data Set C1 grid (not calculated under 10 applicants)", inputs: ["reported.admissions_by_residency.in_state.applicants", "reported.admissions_by_residency.in_state.admitted"] },
  },
  "derived.admit_rate_out_of_state": {
    ...reported("Acceptance rate, other states"),
    computed: true,
    derived: { formula: "Admitted ÷ applied from other states, from the college's Common Data Set C1 grid (not calculated under 10 applicants)", inputs: ["reported.admissions_by_residency.out_of_state.applicants", "reported.admissions_by_residency.out_of_state.admitted"] },
  },
  "derived.admit_rate_international": {
    ...reported("Acceptance rate, international"),
    computed: true,
    derived: { formula: "Admitted ÷ applied from abroad, from the college's Common Data Set C1 grid (not calculated under 10 applicants)", inputs: ["reported.admissions_by_residency.international.applicants", "reported.admissions_by_residency.international.admitted"] },
  },
  "derived.yield_in_state": {
    ...reported("Yield, in-state"),
    computed: true,
    derived: { formula: "Enrolled ÷ admitted from the college's state, from the same grid (not calculated under 10 admits)", inputs: ["reported.admissions_by_residency.in_state.admitted", "reported.admissions_by_residency.in_state.enrolled"] },
  },
  "derived.yield_out_of_state": {
    ...reported("Yield, other states"),
    computed: true,
    derived: { formula: "Enrolled ÷ admitted from other states, from the same grid (not calculated under 10 admits)", inputs: ["reported.admissions_by_residency.out_of_state.admitted", "reported.admissions_by_residency.out_of_state.enrolled"] },
  },
  "derived.yield_international": {
    ...reported("Yield, international"),
    computed: true,
    derived: { formula: "Enrolled ÷ admitted from abroad, from the same grid (not calculated under 10 admits)", inputs: ["reported.admissions_by_residency.international.admitted", "reported.admissions_by_residency.international.enrolled"] },
  },
  "derived.admit_rate_for_student": {
    ...reported("Acceptance rate for you"),
    computed: true,
    derived: {
      formula: "The in-state rate when the student lives in the college's state, the other-states rate otherwise, the international rate for a student outside the U.S.",
      inputs: ["derived.admit_rate_in_state", "derived.admit_rate_out_of_state", "derived.admit_rate_international", "location.state"],
    },
  },
  "derived.admit_rate_same_class": {
    ...reported("Acceptance rate, all applicants in the same class"),
    computed: true,
    derived: { formula: "C1 total admitted ÷ total applied, from the same Common Data Set as the residency grid (not calculated under 10 applicants)", inputs: ["reported.admissions_by_residency.total.applicants", "reported.admissions_by_residency.total.admitted"] },
  },
  "derived.payback_years": {
    ...scorecard("Payback estimate", "outcomes"),
    computed: true,
    derived: { formula: "4 × average cost ÷ median earnings 10 years after entry", inputs: ["cost.avg_paid_all", "outcomes.median_earnings_10yr"] },
  },
  // CDS cost and debt (specs/data-expansion/cds-cost-and-debt.md): computed on the cost page only, never ranked.
  "derived.next_year_price": {
    ...reported("Next year's price before aid (college-reported)", "cost"),
    computed: true,
    derived: {
      formula: "Next year's tuition + required fees + on-campus food and housing, first-year column",
      inputs: ["reported.cost.next_year", "reported.cost.next_year.first_year.fees", "reported.cost.next_year.first_year.food_and_housing"],
    },
  },
  "derived.next_year_change": {
    // Two sources (the college's document and the federal release); the fallback is the federal one it compares to.
    ...ic("Change from the federal price"),
    topic: "cost",
    computed: true,
    derived: {
      formula: "Next year's price ÷ the federal year's tuition & fees + on-campus room & board − 1",
      inputs: ["derived.next_year_price", "cost.tuition_fees", "cost.components"],
    },
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

/** Sources whose values each carry their own document and year in lineage, so their fields have no vintage. */
export const PER_DOCUMENT_SOURCES: ReadonlySet<SourceKey> = new Set<SourceKey>(["cds", "college-site"]);

/** Every registered `reported.*` path: each stored one must have an `extracted` lineage record (lib/lineage.ts). */
export const REPORTED_PATHS = (Object.keys(FIELDS) as FieldPath[]).filter((p) => p.startsWith("reported."));
