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
  /**
   * Report changes to this field to followers and on the profile's "What changed" panel (specs/product/follow-colleges.md;
   * lib/changes.ts). Only headline figures a family recognizes carry it: see NOTIFY_FIELDS below.
   */
  notify?: NotifyDef;
}

/** How a reported field's value is compared and written: a share (0–1), whole dollars, a count, a ratio, or words. */
export type NotifyUnit = "percent" | "dollars" | "count" | "ratio" | "text";

export interface NotifyDef {
  unit: NotifyUnit;
  /** Smallest difference that counts as a change (default NOTIFY_TOLERANCE[unit]); smaller ones are float noise. */
  tolerance?: number;
  /** Any change counts, whatever the tolerance or the derived-input rule (a rename). */
  always?: true;
  /** How the value reads in a sentence, with "{value}" for the formatted value ("{value} admitted"). */
  phrase?: string;
  /** For an object value: the keys compared and shown, with their words ("in-state"); other keys are ignored. */
  keys?: Record<string, string>;
}

/** Default thresholds per unit (specs/product/follow-colleges.md#detecting-changes): 0.1 points, $50, 1, 0.01, any. */
export const NOTIFY_TOLERANCE: Record<NotifyUnit, number> = { percent: 0.001, dollars: 50, count: 1, ratio: 0.01, text: 0 };

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
/** A link the college reports to NCES in the IPEDS directory (specs/school-identity/links.md). */
const hdLink = (label: string): FieldDef => ({ label, topic: "institution", source: "ipeds-hd", vintage: "ipeds-hd" });
/** A link or mark found on the college's own site; each value's lineage record names the page and the retrieval date. */
const siteFound = (label: string): FieldDef => ({ label, topic: "institution", source: "college-site", vintage: null });
/** Community-edited references have no release year (UNDATED_SOURCES); the source's edition gives the retrieval date. */
const wikidata = (label: string): FieldDef => ({ label, topic: "institution", source: "wikidata", vintage: null });
const wikipedia = (label: string): FieldDef => ({ label, topic: "institution", source: "wikipedia", vintage: null });
/** Derived at sync time from the college's colors (lib/brand-colors.ts), so the app does no color math. */
const brandDerived = (label: string, formula: string): FieldDef => ({ ...wikipedia(label), derived: { formula, inputs: ["brand.colors"] } });

export const FIELDS = {
  /* ---- Institution ---- */
  unit_id: scorecard("IPEDS unit ID", "institution"),
  name: { ...scorecard("Name", "institution"), notify: { unit: "text", always: true } },
  "location.city": scorecard("City", "institution"),
  "location.state": scorecard("State", "institution"),
  "location.zip": scorecard("ZIP code", "institution"),
  "location.region": {
    ...scorecard("Region", "institution"),
    derived: { formula: "Region assigned from the state", inputs: ["location.state"] },
  },
  type: scorecard("Type (public, private)", "institution"),
  // Website: the IPEDS directory's WEBADDR is the default (one year newer than Scorecard's own field); a school
  // without one keeps Scorecard's value, cited with a `{ source: "scorecard" }` lineage record (lib/links.ts).
  "links.website": hdLink("Website"),
  "links.price_calculator": scorecard("Net price calculator", "institution"),
  // Official links (specs/school-identity/links.md; lib/links.ts): what each college reports to NCES in the IPEDS
  // directory; the visit pages are found on its own admissions page (lib/site-probe.ts).
  "links.admissions": hdLink("Admissions office"),
  "links.apply": hdLink("Online application"),
  "links.financial_aid": hdLink("Financial aid office"),
  "links.veterans": hdLink("Veterans' tuition benefits"),
  "links.disability_services": hdLink("Disability services office"),
  "links.visit": siteFound("Campus visit page"),
  "links.virtual_tour": siteFound("Virtual tour"),
  // Social accounts (specs/school-identity/social-accounts.md; lib/social.ts): Wikidata, else the homepage footer
  // (lineage source college-site). Handles only; the profile URL is built at render time.
  "social.instagram": wikidata("Instagram account"),
  "social.youtube": wikidata("YouTube channel"),
  "social.tiktok": wikidata("TikTok account"),
  "social.x": wikidata("X account"),
  "social.facebook": wikidata("Facebook page"),
  "social.linkedin": wikidata("LinkedIn page"),
  // Colors and mark (specs/school-identity/brand.md; lib/brand-colors.ts): decoration, never data.
  "brand.colors": wikipedia("School colors"),
  "brand.names": wikipedia("School color names"),
  "brand.accent": brandDerived("Accent color", "The first school color that is neither white, black, nor gray (else the first color)"),
  "brand.on_accent": brandDerived("Text color on the accent", "White or black, whichever has at least 4.5:1 contrast on the accent"),
  "brand.crest_to": brandDerived(
    "Crest gradient end",
    "The next school color after the accent (white skipped), or the accent darkened or lightened when that color is black, gray, or white; at least 4.5:1 against the text color",
  ),
  "brand.tint_light": brandDerived("Hero tint, light theme", "The accent re-lit to OKLCH lightness 0.72, chroma at most 0.16"),
  "brand.tint_dark": brandDerived("Hero tint, dark theme", "The accent re-lit to OKLCH lightness 0.62, chroma at most 0.16"),
  "brand.logo": siteFound("Mark (the college's own site icon)"),
  // Short names and nicknames (specs/school-identity/aliases.md; lib/aliases.ts): a table beside the schools
  // (data/aliases.json), never stored on a school; each row names its own source.
  aliases: hdLink("Short names and nicknames (search)"),

  /* ---- Admissions (IPEDS ADM) ---- */
  "admissions.year": adm("Admissions year"),
  "admissions.applicants": { ...adm("Applicants"), notify: { unit: "count", phrase: "{value} applied" } },
  "admissions.admitted": { ...adm("Admitted"), notify: { unit: "count", phrase: "{value} admits" } },
  "admissions.enrolled": adm("Enrolled"),
  "admissions.acceptance_rate": {
    ...adm("Acceptance rate"),
    derived: { formula: "Admitted ÷ applicants (not calculated under 10 applicants)", inputs: ["admissions.admitted", "admissions.applicants"] },
    notify: { unit: "percent", phrase: "{value} admitted" },
  },
  // The funnel a newer college-reported class replaced (specs/college-reported-round-2.md, Decision 1): stored only
  // then, shown in the tooltip as "Federal data, fall 2024: …", and used by yield when the shown pair mixes classes.
  "admissions.federal": adm("Federal admissions figures replaced by a newer college-reported class"),
  "admissions.sat_reading_25_75": { ...adm("SAT Reading & Writing, middle 50%"), notify: { unit: "count", phrase: "middle 50% SAT Reading & Writing {value}" } },
  "admissions.sat_math_25_75": { ...adm("SAT Math, middle 50%"), notify: { unit: "count", phrase: "middle 50% SAT Math {value}" } },
  "admissions.act_composite_25_75": { ...adm("ACT composite, middle 50%"), notify: { unit: "count", phrase: "middle 50% ACT composite {value}" } },
  "admissions.test_submission_rate_sat": adm("Share submitting SAT"),
  "admissions.test_submission_rate_act": adm("Share submitting ACT"),
  "admissions.test_policy": { ...adm("Test policy"), notify: { unit: "text", phrase: "{value}" } },
  "admissions.by_sex": adm("Applicants, admits, and enrollees by sex"),
  "admissions.factors": adm("What's considered in admission (GPA, essay, legacy, and more)"),
  "admissions.sat_reading_median": adm("SAT Reading & Writing, median"),
  "admissions.sat_math_median": adm("SAT Math, median"),
  "admissions.act_composite_median": adm("ACT composite, median"),
  "admissions.act_english_25_75": adm("ACT English, middle 50%"),
  "admissions.act_math_25_75": adm("ACT Math, middle 50%"),

  /* ---- Students (Scorecard, from IPEDS fall enrollment) ---- */
  "demographics.undergrad_enrollment": { ...scorecard("Undergraduates", "enrollment", "scorecard-enrollment"), notify: { unit: "count", phrase: "{value} undergraduates" } },
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
    notify: { unit: "dollars", phrase: "sticker price {value}", keys: { in_state: "in-state", out_of_state: "out-of-state" } },
  },
  "cost.residency": { ...sfa("First-years paying each residency rate"), topic: "prices" },
  "cost.aided_net_price": { ...sfa("Net price, students with grants"), topic: "cost", notify: { unit: "dollars", phrase: "net price after grants {value}" } },
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
  "academics.student_faculty_ratio": { label: "Students per faculty member", topic: "academics", source: "ipeds-ef", vintage: "ipeds-ef", notify: { unit: "ratio", phrase: "student-to-faculty ratio {value}" } },
  // Faculty (specs/data-expansion/faculty.md): salary and headcount default to ipeds-sal; full-time share is
  // Scorecard, registered separately since it overrides this ancestor for that one leaf.
  "academics.faculty": { label: "Faculty salary (9-month equated, all ranks)", topic: "academics", source: "ipeds-sal", vintage: "ipeds-sal" },
  "academics.faculty.full_time_share": scorecard("Full-time faculty share", "academics", "scorecard-enrollment"),
  "demographics.residence": { label: "Where first-years come from: in-state, other states, abroad", topic: "demographics", source: "ipeds-ef-c", vintage: "ipeds-ef-c" },
  // Stored in the per-college detail file (lib/detail.ts), not data/schools.json.
  // Transfers in (specs/data-expansion/transfers.md).
  "demographics.transfer_in": { label: "New transfer-in undergraduates this fall", topic: "demographics", source: "ipeds-ef-a", vintage: "ipeds-ef-a" },
  "detail.home_states": { label: "First-years by home state", topic: "demographics", source: "ipeds-ef-c", vintage: "ipeds-ef-c" },
  // LGBTQ+ life, phase 1 (specs/lgbtq-life.md; lib/lgbtq.ts). Another gender was last collected for fall 2024; when the
  // newest file lacks it, each value's lineage record names the older file and its fall (scripts/lib/lgbtq-sync.mts).
  "lgbtq.gender": { label: "Undergraduates of another gender and of unknown gender", topic: "demographics", source: "ipeds-ef-a", vintage: "ipeds-ef-a" },
  "lgbtq.admissions": { label: "First-time applicants, admits, and enrollees of another gender", topic: "admissions", source: "ipeds-adm", vintage: "ipeds-adm" },
  // Hand-kept table (data/state-laws.json); each value's lineage record carries the statute link and effective date.
  "lgbtq.state_law": { label: "State law on public colleges' identity-based offices and programs", topic: "campus", source: "state-law", vintage: null },
  // Phase 4 (pilot, built 2026-10-04 integration pass): tier A policy facts from the college's own pages, copied
  // from the `campus_pages` detail table by scripts/lib/campus-pilot/merge.mts applyLgbtqPolicies so the policy
  // checklist, Explore filters, and Compare can read school.lgbtq.policies directly; each item itself carries the
  // page URL and date checked (lib/directories.ts PolicyCheck), and this field's own lineage record names the
  // newest check date.
  "lgbtq.policies": { label: "Policies checked on the college's own pages (housing, records, nondiscrimination, …)", topic: "campus", source: "policy-page", vintage: null },
  // National directories (specs/campus-directories.md): each listing is credited to its organization in the detail
  // table; the summary here says which traditions, councils, and LGBTQ+ kinds appear, for filters and section checks.
  directories: { label: "Groups listed by national directories", topic: "campus", source: "directory", vintage: null },
  "detail.directories": { label: "Campus chapters and groups listed by national organizations", topic: "campus", source: "directory", vintage: null },
  // Campus-life pilot (lib/campus-pages.ts): facts from the college's own policy, office, and report pages, each quoted.
  "detail.campus_pages": { label: "Campus life facts from the college's own pages (policies, offices, reports)", topic: "campus", source: "policy-page", vintage: null },
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
  // Religious life, phase 1 (specs/religious-life.md): IPEDS IC{Y} RELAFFIL, code and NCES's dictionary label; null =
  // no affiliation. Families for the Explore filter are derived from the code at render time (lib/religion.ts).
  "religion.affiliation": icChar("Religious affiliation"),
  // Phase 3 (specs/religious-life.md#measures item 2): the CCCU's own list of its voting (GOVM) member colleges,
  // read by the "cccu" directory adapter. A membership fact, not a chapter: feeds "Known for: Faith-centered"
  // alongside C7, never the "Faith communities" list.
  "religion.cccu_member": { label: "CCCU (Christian college consortium) membership", topic: "campus", source: "directory", vintage: null },
  "location.lat": { ...hd("Latitude"), topic: "institution" },
  "location.lng": { ...hd("Longitude"), topic: "institution" },
  "cost.avg_paid_all": {
    ...ic("Average cost, all students"),
    topic: "cost",
    derived: { formula: "Full price − grant dollars per first-year (students without grants count at full price)", inputs: ["cost.breakdown"] },
    notify: { unit: "dollars", phrase: "average cost {value}" },
  },

  /* ---- Outcomes (Scorecard; each measures a past entering cohort) ---- */
  "outcomes.median_earnings_10yr": { ...scorecard("Median earnings, 10 years after entry", "outcomes"), notify: { unit: "dollars", phrase: "median earnings 10 years after entry {value}" } },
  "outcomes.median_earnings_6yr": scorecard("Median earnings, 6 years after entry", "outcomes"),
  "outcomes.graduation_rate": { ...scorecard("Graduation rate", "outcomes"), notify: { unit: "percent", phrase: "graduation rate {value}" } },
  "outcomes.retention_rate": { ...scorecard("Retention rate", "outcomes", "scorecard-retention"), notify: { unit: "percent", phrase: "{value} returned for a second year" } },
  "outcomes.median_debt": { ...scorecard("Median debt at graduation", "outcomes"), notify: { unit: "dollars", phrase: "median debt at graduation {value}" } },
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
  "reported.admission_profile.factors.interest": reported("How much it counts: demonstrated interest (level of applicant's interest)"),
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
  // How this college reads a record (specs/chances/how-colleges-read.md; lib/chances/reading.ts gpaTopShare): never ranked.
  "derived.gpa_top_share": {
    ...reported("Share of first-years with a 3.75 or higher GPA"),
    computed: true,
    derived: {
      formula:
        "First-years in the top two GPA bands (4.0 and 3.75–3.99), added up from the college's reported bands: the \"all\" column, else the column for students who sent test scores, else the column for those who didn't",
      inputs: ["reported.admission_profile.gpa.bands.all", "reported.admission_profile.gpa.bands.with_test", "reported.admission_profile.gpa.bands.without_test"],
    },
  },
  // The plan's GPA (specs/planner/redesign/gpa.md; lib/planner/gpa-model.ts): never ranked, shown only in the plan.
  "derived.gpa_band_mean": {
    ...reported("Average first-year GPA, figured from the GPA bands"),
    computed: true,
    derived: {
      formula: "Each GPA band's share of first-years times the band's midpoint (4.0 for the top band), added up and divided by the shares' total; the \"all\" column, else the column for students who sent test scores",
      inputs: ["reported.admission_profile.gpa.bands.all", "reported.admission_profile.gpa.bands.with_test"],
    },
  },
  "derived.gpa_estimate": {
    ...adm("Estimated unweighted first-year GPA"),
    computed: true,
    derived: {
      formula:
        "Estimated from colleges with similar test scores, admit rates, and shares sending scores: a least-squares fit of first-year GPA on the SAT midpoint (ACT through the 2018 concordance), the admit rate, and the share of first-years who sent a score, over colleges that publish an unweighted GPA; a college that publishes only a weighted average is kept between that average minus 1 and 4.0. Never the college's own figure",
      inputs: [
        "derived.sat_total",
        "admissions.act_composite_25_75",
        "admissions.acceptance_rate",
        "admissions.test_submission_rate_sat",
        "admissions.test_submission_rate_act",
        "reported.admission_profile.gpa.average",
      ],
    },
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
  // CDS financial aid (specs/data-expansion/cds-financial-aid.md; lib/cds/financial-aid.ts): section H from each
  // college's CDS record. Partial coverage: never in ranks, sorts, medians, key differences, the radar, or "Known for".
  "reported.aid.edition": reported("Common Data Set the aid process facts came from", "aid"),
  "reported.aid.aid_year": reported("Academic year of the aid figures (CDS H.101)", "aid"),
  "reported.aid.methodology": reported("How the college figures need: federal or its own formula (CDS H.102–H.104)", "aid"),
  "reported.aid.forms": reported("Forms aid applicants file (CDS H8)", "aid"),
  "reported.aid.dates": reported("Aid application dates (CDS H9–H11)", "aid"),
  "reported.aid.international": reported("College aid for international students (CDS H6)", "aid"),
  "reported.aid.first_years": reported("Need and aid, first-years (CDS H2, H2A)", "aid"),
  "reported.aid.institutional_grants": reported("College grant dollars, need-based and not (CDS H1)", "aid"),
  "detail.cds_aid": { label: "Financial aid, all of CDS section H with quotes", topic: "aid", source: "college-site", vintage: null },
  "aid.cds_previous": { label: "Need-based and merit aid a newer Common Data Set replaced (CDS H2/H2A)", topic: "aid", source: "cds", vintage: null },
  // The college's published aid promises and rules (specs/product/cost-by-income.md "Published promises"). They live in
  // data/aid-policies.json, not on the school record, so no lineage record carries them: lib/lineage.ts resolves the
  // citation from the entry's own page (`source`), award year (`as_of`) and check date (`checked`).
  "aid_policy.free_tuition_under": reported("Family income under which the college covers tuition (published promise)", "aid"),
  "aid_policy.no_contribution_under": reported("Family income under which the college asks no family contribution (published promise)", "aid"),
  "aid_policy.meets_full_need": reported("Whether the college says it meets full demonstrated need", "aid"),
  "aid_policy.no_loans": reported("Whether the college's aid packages include loans", "aid"),
  "aid_policy.need_only": reported("Whether the college gives no merit aid (all grants are need-based)", "aid"),
  "aid_policy.home_equity": reported("How the college treats home equity in its need analysis", "aid"),
  "aid_policy.siblings": reported("How the college adjusts for siblings in college", "aid"),
  // Published automatic-admission programs (specs/chances/base-rates.md "Automatic admission"). They live in
  // data/guaranteed-admission.json, not on the school record: lib/lineage.ts resolves the citation from the program's
  // own source (its page or notice, the entering fall, and the date read), like aid_policy.*.
  "reference.guaranteed_admission.rule": reported("Automatic admission rule (published program)"),
  "reference.guaranteed_admission.scope": reported("Whether the program admits to the campus or only to the system"),
  "reference.guaranteed_admission.major_guaranteed": reported("Whether automatic admission includes the major"),
  // How the college admits by school or major (specs/chances/base-rates.md "Major", major-and-grades.md "Data"), from
  // data/major-admission.json: each value quoted from the unit's own page; lib/lineage.ts resolves the citation to it.
  "reported.major_admission.direct_admit": reported("Whether first-years are admitted directly to the school or major"),
  "reported.major_admission.admit_rate": reported("Admit rate for the school or major (college-reported)"),
  "reported.major_admission.review.major_considered": reported("Whether the intended major affects admission (college's statement)"),
  "reported.major_admission.review.emphasis": reported("Subjects the school or major looks at more closely (college's statement)"),
  "reported.major_admission.review.required_courses": reported("High school courses the school or major requires (college's statement)"),
  "reported.major_admission.review.gate": reported("Score requirement for the school or major (college's statement)"),
  "derived.merit_dollar_share": {
    ...reported("College grant dollars given without regard to need", "aid"),
    computed: true,
    derived: { formula: "Non-need institutional grant dollars ÷ (need-based + non-need institutional grant dollars), CDS H1", inputs: ["reported.aid.institutional_grants"] },
  },
  "derived.aid_methodology": {
    ...reported("Need methodology, stated or inferred", "aid"),
    computed: true,
    derived: { formula: "The stated methodology; else the college's own (institutional) formula when it requires the CSS Profile or its own form", inputs: ["reported.aid.methodology", "reported.aid.forms"] },
  },
  // CDS academics (specs/data-expansion/cds-academics.md; lib/cds/academics.ts): one lineage record per block, from the
  // newest document whose items passed. Alongside the federal figures, never replacing them.
  "reported.academics.class_sections": reported("Undergraduate class sections by size (Common Data Set I-3)", "academics"),
  "reported.academics.student_faculty_ratio": reported("Student-to-faculty ratio, the college's own (Common Data Set I-2)", "academics"),
  "reported.academics.programs": reported("Special study options offered (Common Data Set E1)", "academics"),
  "reported.academics.core_curriculum": reported("Required coursework areas (Common Data Set E3)", "academics"),
  // CDS section D, transfer admission (specs/data-expansion/cds-transfer.md; lib/cds/transfer.ts): one lineage record
  // per stored field; the sex breakdown inside applicants/admitted/enrolled and each material are covered by their parent.
  // Partial coverage: never in METRICS, ranks, medians, sorts, or percentiles (tests/cds-transfer.test.mts).
  // CDS H14 and F2 religion facts (specs/religious-life.md; lib/cds/religion.ts), stored only when marked. Partial
  // coverage: never in ranks, sorts, medians, Explore filters, or "Known for".
  "reported.religion.aid_by_affiliation": reported("Scholarships that consider religious affiliation (college-reported)", "campus"),
  "reported.religion.campus_ministries": reported("Campus ministries (college-reported)", "campus"),
  "reported.transfer.enrolls_transfers": reported("Enrolls transfer students (college-reported)"),
  "reported.transfer.advanced_standing": reported("Grants advanced standing to transfers (college-reported)"),
  "reported.transfer.applicants": reported("Transfer applicants (college-reported)"),
  "reported.transfer.admitted": reported("Transfer applicants admitted (college-reported)"),
  "reported.transfer.enrolled": reported("Transfer students enrolled (college-reported)"),
  "reported.transfer.admit_rate": reported("Transfer acceptance rate (college-reported)"),
  "reported.transfer.terms": reported("Terms transfers may enter (college-reported)"),
  "reported.transfer.min_credits": reported("Minimum credits to apply as a transfer (college-reported)"),
  "reported.transfer.min_credits_unit": reported("Unit of the minimum credits (college-reported)"),
  "reported.transfer.required_materials": reported("What a transfer application needs (college-reported)"),
  "reported.transfer.min_hs_gpa": reported("Minimum high school GPA for transfers (college-reported)"),
  "reported.transfer.min_college_gpa": reported("Minimum college GPA for transfers (college-reported)"),
  "reported.transfer.dates": reported("Transfer application dates (college-reported)"),
  // CDS Greek life, phase 1 (specs/greek-life.md; lib/cds/greek.ts): one lineage record per field, from F1 (fall) and
  // F4 (edition). Partial coverage: never in METRICS, ranks, medians, sorts, or "Known for" (tests/cds-greek.test.mts).
  "reported.greek.frat_pct_first_year": reported("First-year men who join fraternities (Common Data Set F1)", "campus"),
  "reported.greek.frat_pct_undergrad": reported("Undergraduate men who join fraternities (Common Data Set F1)", "campus"),
  "reported.greek.sor_pct_first_year": reported("First-year women who join sororities (Common Data Set F1)", "campus"),
  "reported.greek.sor_pct_undergrad": reported("Undergraduate women who join sororities (Common Data Set F1)", "campus"),
  "reported.greek.housing": reported("Fraternity/sorority housing (Common Data Set F4)", "campus"),
  // CDS application logistics and high school preparation (specs/data-expansion/cds-application-logistics.md;
  // lib/cds/application-logistics.ts): one lineage record per block from the newest CDS. Logistics years are the
  // cycle ("Fall 2026 cycle"); high school preparation's is the edition ("2025–26").
  "reported.admissions_logistics.cycle": reported("Admissions cycle of the application dates (college-reported)"),
  "reported.admissions_logistics.edition": reported("CDS edition of the application dates (college-reported)"),
  "reported.admissions_logistics.fee": reported("Application fee waivers (college-reported)"),
  "reported.admissions_logistics.regular_closing": reported("Regular application deadline (college-reported)"),
  "reported.admissions_logistics.priority_date": reported("Priority application date (college-reported)"),
  "reported.admissions_logistics.other_terms": reported("First-years admitted for terms other than fall (college-reported)"),
  "reported.admissions_logistics.notification": reported("When decisions are sent (college-reported)"),
  "reported.admissions_logistics.reply": reported("Reply-by date for admitted students (college-reported)"),
  "reported.admissions_logistics.housing_deposit": reported("Housing deposit (college-reported)"),
  "reported.admissions_logistics.deferred_admission": reported("Deferred admission, a gap year (college-reported)"),
  "reported.admissions_hs_prep.completion": reported("High school completion requirement (college-reported)"),
  "reported.admissions_hs_prep.college_prep": reported("College-preparatory program (college-reported)"),
  "reported.admissions_hs_prep.units_required": reported("High school units required, by subject (college-reported)"),
  "reported.admissions_hs_prep.units_recommended": reported("High school units recommended, by subject (college-reported)"),

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
  // Class sizes (specs/data-expansion/cds-academics.md; lib/cds/academics-display.ts). Partial coverage: never in
  // METRICS, ranks, medians, sorts, Key differences, or "Known for" (tests/cds-academics.test.mts).
  "derived.class_share_under_20": {
    ...reported("Classes under 20 students", "academics"),
    computed: true,
    derived: { formula: "Class sections of 2–19 students ÷ all class sections, from the college's Common Data Set I-3 (sections, not students)", inputs: ["reported.academics.class_sections"] },
  },
  "derived.class_share_50_plus": {
    ...reported("Classes of 50 or more students", "academics"),
    computed: true,
    derived: { formula: "Class sections of 50 or more students ÷ all class sections, from the college's Common Data Set I-3 (sections, not students)", inputs: ["reported.academics.class_sections"] },
  },
  // Compare's application-logistics rows (specs/data-expansion/cds-application-logistics.md;
  // lib/cds/application-logistics-display.ts). Partial coverage: never in METRICS, ranks, sorts, or Key differences.
  "derived.application_deadlines": {
    ...reported("Regular deadline, reply-by rule, and housing deposit"),
    computed: true,
    derived: { formula: "The regular closing date, reply-by rule, and housing deposit amount from the college's newest Common Data Set (C14, C17)", inputs: ["reported.admissions_logistics.regular_closing", "reported.admissions_logistics.reply", "reported.admissions_logistics.housing_deposit"] },
  },
  "derived.gap_year_allowed": {
    ...reported("Gap year allowed (deferred admission)"),
    computed: true,
    derived: { formula: "Whether admitted students may postpone enrollment, and for how long, from the college's newest Common Data Set (C18)", inputs: ["reported.admissions_logistics.deferred_admission"] },
  },
  "derived.payback_years": {
    ...scorecard("Payback estimate", "outcomes"),
    computed: true,
    derived: { formula: "4 × average cost ÷ median earnings 10 years after entry", inputs: ["cost.avg_paid_all", "outcomes.median_earnings_10yr"] },
  },
  // Cost by income (specs/product/cost-by-income.md; lib/cost-curve.ts, lib/merit.ts): computed at load, never stored.
  // The default source is the federal net price by income, the curve's published part and the calibration target.
  "derived.need_aid_break_income": {
    ...scorecard("Where need-based aid ends (estimate)", "cost", "scorecard-cost"),
    computed: true,
    derived: {
      formula:
        "The income where the estimated price reaches the full price (in-state at publics), rounded to $10K. With a published free-tuition line L: L + tuition ÷ r, where the price rises to the full price minus tuition at L and then by r = 0.30 of each extra dollar (a sector default; range 0.22–0.40). Otherwise P + full price ÷ r, with r (0.15–0.60) calibrated so the model's average price over the Census reference incomes above $110K equals the college's published $110K+ net price, and P the college's no-contribution line, else about $90K (the federal need analysis's protected income); the range varies the $110K+ figure by ±$1K and P by ±$10K, and an r at a bound gives no estimate",
      inputs: ["cost.net_price_by_income", "cost.breakdown", "cost.sticker", "cost.cost_of_attendance", "cost.tuition_fees", "aid_policy.no_contribution_under", "aid_policy.free_tuition_under"],
    },
  },
  "derived.need_aid_status": {
    ...scorecard("Need-based aid above $110K", "cost", "scorecard-cost"),
    computed: true,
    derived: {
      formula:
        "Break point when the model fits; little need-based aid above $110K when the college's average share of need met (Common Data Set H2 line i) is under 90%, or, without it, when the published $110K+ net price is at least 85% of the full price; otherwise the federal data end at $110K",
      inputs: ["derived.need_aid_break_income", "cost.net_price_by_income", "reported.aid.first_years", "aid.cds"],
    },
  },
  "derived.cost_estimate": {
    ...scorecard("Price at a family income (estimate above $110K)", "cost", "scorecard-cost"),
    computed: true,
    derived: {
      formula:
        "Up to $110K, the published net price for the family's income band; above it, the smaller of the full price and the larger of the $75–110K price and the rising estimate (from a published free-tuition promise, or calibrated to the $110K+ figure), shown as the range r takes within its uncertainty (see where need-based aid ends)",
      inputs: ["cost.net_price_by_income", "derived.need_aid_break_income"],
    },
  },
  "derived.merit_class": {
    ...sfa("Merit aid for students without need"),
    computed: true,
    derived: {
      formula:
        "From the strongest source: the college's Common Data Set (H2A line n, students without need who got merit aid: none is need-only, any is merit), else its published need-only policy, else the federal proxy (grants without federal aid to at least 2% of first-years is merit, under 2% need-only), which isn't used at colleges that say they meet full need or use their own need formula (many aided families there file no FAFSA)",
      inputs: ["reported.aid.first_years", "aid.cds", "aid_policy.need_only", "aid_policy.meets_full_need", "derived.aid_methodology", "derived.merit_proxy"],
    },
  },
  "derived.merit_proxy": {
    ...sfa("First-years with a grant but no federal aid"),
    computed: true,
    derived: {
      formula:
        "(Grant recipients − federal-aid recipients with grants) ÷ first-years in the aid cohort; average (grant dollars − federal-aid recipients' grant dollars) ÷ those students. At most colleges that's merit aid",
      inputs: ["aid.grant_count", "aid.grant_total", "aid.by_income", "aid.cohort"],
    },
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
export const PER_DOCUMENT_SOURCES: ReadonlySet<SourceKey> = new Set<SourceKey>(["cds", "college-site", "state-law", "directory", "org-estimate", "policy-page"]);

/**
 * Community-edited references with no release year (specs/school-identity/): their fields have no vintage, and the
 * source's edition in meta.json gives the date they were read. Never listed among the federal releases on /data.
 */
export const UNDATED_SOURCES: ReadonlySet<SourceKey> = new Set<SourceKey>(["wikidata", "wikipedia"]);

/** Every registered `reported.*` path: each stored one must have an `extracted` lineage record (lib/lineage.ts). */
export const REPORTED_PATHS = (Object.keys(FIELDS) as FieldPath[]).filter((p) => p.startsWith("reported."));

/**
 * Fields whose changes are reported (specs/product/follow-colleges.md#detecting-changes): stored (never `computed`)
 * and marked `notify`. Kept to the headline figures a family recognizes on the overview cards: name, the admissions
 * funnel and middle-50% scores, test policy, undergraduates, sticker price, average cost, net price after grants,
 * graduation and retention, earnings, debt, and the student-to-faculty ratio.
 */
export const NOTIFY_FIELDS: readonly FieldPath[] = (Object.keys(FIELDS) as FieldPath[]).filter((p) => {
  const def: FieldDef = FIELDS[p];
  return !!def.notify && !def.computed;
});
