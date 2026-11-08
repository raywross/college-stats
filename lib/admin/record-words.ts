/**
 * Plain fields for the People door's records (specs/product/admin-redesign.md "People": "Plain fields"): a student's
 * numbers, offers, snapshots, and notification preferences, read with the site's own labels instead of a raw
 * `KeyValues` dump. Each formatter returns the rows it knows, in order, plus whatever is left over under `details`
 * (shown on the page inside `<details>Details</details>`, still through `KeyValues`). Pure (no server or browser
 * APIs), so it's tested without a database.
 */
import { GIFT_LABELS, COA_LABELS, LOAN_LABELS, usd, awardYearLabel, type CoaPart } from "../planner/offers.ts";
import { GPA_SCALES, OUTSIDE_US } from "../student-profile.ts";
import { majorFamilyName } from "../majors.ts";
import { STANDING_LEVEL_LABELS } from "../chances/levels.ts";
import { fmtDate, fmtDateTime } from "./console.ts";

export interface FieldRow {
  label: string;
  value: string;
}

/** A formatter's result: the rows it knows how to label, plus the rest of the object for `<details>Details</details>`. */
export interface RecordFields {
  fields: FieldRow[];
  details: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

/** Drops keys that were read into `fields` (by their dotted path) from a shallow or nested object, for `details`. */
function rest(data: Record<string, unknown>, taken: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!taken.includes(k)) out[k] = v;
  return out;
}

const YES_NO = (v: unknown): string | null => (v === true ? "Yes" : v === false ? "No" : null);

/* ------------------------------------------------------------------ */
/* A student's numbers (student_profiles.data)                         */
/* ------------------------------------------------------------------ */

const SETTING_LABELS: Record<string, string> = { city: "City", suburb: "Suburb", town: "Town", rural: "Rural" };
const SCHOOL_TYPE_LABELS: Record<string, string> = { public: "Public", "private-nonprofit": "Private, nonprofit", "private-forprofit": "Private, for-profit" };
const SIZE_LABELS: Record<string, string> = { small: "Small (under 5K)", medium: "Medium (5–15K)", large: "Large (15–30K)", xl: "Very large (30K+)" };
const CLASS_STANDING_LABELS: Record<string, string> = { top1: "Top 1%", top5: "Top 5%", top10: "Top 10%", top25: "Top 25%", top50: "Top 50%", lower: "Below the top 50%" };
const RANK_EXPECTATION_LABELS: Record<string, string> = { valedictorian: "Expects valedictorian", salutatorian: "Expects salutatorian" };
const EARLY_ROUND_LABELS: Record<string, string> = { ed: "Early Decision", ea: "Early Action", none: "No early round" };
const TEST_FOCUS_LABELS: Record<string, string> = { sat: "SAT", act: "ACT", none: "Not testing" };

function gpaValue(gpa: number, scale: unknown): string {
  const scaleLabel = GPA_SCALES.find((s) => s.value === scale)?.label ?? String(scale ?? "4.0 scale");
  return `${gpa} (${scaleLabel})`;
}

/**
 * A student's profile (`student_profiles.data`, `lib/student-profile.ts` `StudentProfileData`), read with the labels
 * `/me` and the plan use for the same fields. Long lists (courses, activities, awards, connections, recommenders) are
 * shown as counts, not dumped; their rows stay under Details for the admin who wants them.
 */
export function studentNumbers(data: Record<string, unknown>): RecordFields {
  const fields: FieldRow[] = [];
  const basics = isObj(data.basics) ? data.basics : {};
  const academics = isObj(data.academics) ? data.academics : {};
  const tests = isObj(data.tests) ? data.tests : {};
  const plans = isObj(data.plans) ? data.plans : {};
  const preferences = isObj(data.preferences) ? data.preferences : {};
  const story = isObj(data.story) ? data.story : null;

  if (isNum(basics.gradYear)) fields.push({ label: "Graduation year", value: String(basics.gradYear) });
  if (isStr(basics.stateOfResidence)) fields.push({ label: "State of residence", value: basics.stateOfResidence === OUTSIDE_US ? "Outside the U.S." : basics.stateOfResidence });
  if (isStr(basics.highSchool)) fields.push({ label: "High school", value: basics.highSchool });
  const feeWaiver = YES_NO(basics.feeWaiverEligible);
  if (feeWaiver) fields.push({ label: "Fee-waiver eligible", value: feeWaiver });

  if (isNum(academics.gpa)) fields.push({ label: "GPA", value: gpaValue(academics.gpa, academics.gpaScale) });
  if (isNum(academics.weightedGpa)) fields.push({ label: "Weighted GPA", value: String(academics.weightedGpa) });
  if (isStr(academics.classStanding)) fields.push({ label: "Class standing", value: CLASS_STANDING_LABELS[academics.classStanding] ?? academics.classStanding });
  else if (isNum(academics.classRankPercentile)) fields.push({ label: "Class rank", value: `Top ${academics.classRankPercentile}%` });
  if (isStr(academics.rankExpectation)) fields.push({ label: "Rank expectation", value: RANK_EXPECTATION_LABELS[academics.rankExpectation] ?? academics.rankExpectation });
  if (isNum(academics.courseRigorCount)) fields.push({ label: "AP, IB, or dual-enrollment courses", value: String(academics.courseRigorCount) });
  if (isArr(academics.courses) && academics.courses.length > 0) fields.push({ label: "Courses listed", value: String(academics.courses.length) });
  if (isArr(academics.activities) && academics.activities.length > 0) fields.push({ label: "Activities", value: String(academics.activities.length) });
  if (isArr(academics.awards) && academics.awards.length > 0) fields.push({ label: "Awards", value: String(academics.awards.length) });
  if (isArr(academics.connections) && academics.connections.length > 0) fields.push({ label: "College connections", value: String(academics.connections.length) });
  const firstGen = YES_NO(academics.firstGeneration);
  if (firstGen) fields.push({ label: "First generation", value: firstGen });

  if (isNum(tests.satTotal)) fields.push({ label: "SAT total", value: String(tests.satTotal) });
  if (isNum(tests.satReading)) fields.push({ label: "SAT reading and writing", value: String(tests.satReading) });
  if (isNum(tests.satMath)) fields.push({ label: "SAT math", value: String(tests.satMath) });
  if (isNum(tests.actComposite)) fields.push({ label: "ACT composite", value: String(tests.actComposite) });
  if (isStr(tests.focus)) fields.push({ label: "Test focus", value: TEST_FOCUS_LABELS[tests.focus] ?? tests.focus });
  if (isNum(tests.target)) fields.push({ label: "Target score", value: String(tests.target) });
  const testOptional = YES_NO(tests.plansTestOptional);
  if (testOptional === "Yes") fields.push({ label: "Plans to apply test-optional", value: "Yes" });
  const superscore = YES_NO(tests.superscore);
  if (superscore === "Yes") fields.push({ label: "Reports a superscore", value: "Yes" });

  if (isArr(plans.intendedMajors) && plans.intendedMajors.length > 0) {
    const names = plans.intendedMajors.map((m) => (typeof m === "string" ? majorFamilyName(m) ?? m : String(m)));
    fields.push({ label: "Intended majors", value: names.join(", ") });
  }
  if (isStr(plans.earlyRoundInterest) && plans.earlyRoundInterest !== "none") {
    fields.push({ label: "Early round interest", value: EARLY_ROUND_LABELS[plans.earlyRoundInterest] ?? plans.earlyRoundInterest });
  }

  if (isArr(preferences.sizes) && preferences.sizes.length > 0) fields.push({ label: "Preferred sizes", value: preferences.sizes.map((s) => SIZE_LABELS[String(s)] ?? String(s)).join(", ") });
  if (isArr(preferences.settings) && preferences.settings.length > 0) fields.push({ label: "Preferred settings", value: preferences.settings.map((s) => SETTING_LABELS[String(s)] ?? String(s)).join(", ") });
  if (isArr(preferences.types) && preferences.types.length > 0) fields.push({ label: "Preferred school types", value: preferences.types.map((s) => SCHOOL_TYPE_LABELS[String(s)] ?? String(s)).join(", ") });
  if (isArr(preferences.statesOrRegions) && preferences.statesOrRegions.length > 0) fields.push({ label: "Preferred states or regions", value: preferences.statesOrRegions.join(", ") });
  if (isNum(preferences.maxAverageCost)) fields.push({ label: "Most they'll pay a year", value: usd(preferences.maxAverageCost) });

  if (story) {
    const written = story.written === true || (isStr(story.narrative) && story.narrative.length > 0);
    fields.push({ label: "Your story", value: written ? "Written" : "Not written yet" });
  }
  if (isArr(data.recommenders) && data.recommenders.length > 0) fields.push({ label: "Recommenders", value: String(data.recommenders.length) });

  const detailsBasics = rest(basics, ["gradYear", "stateOfResidence", "highSchool", "feeWaiverEligible"]);
  const detailsAcademics = rest(academics, [
    "gpa", "gpaScale", "weightedGpa", "classStanding", "classRankPercentile", "rankExpectation", "courseRigorCount", "courses", "activities", "awards", "connections", "firstGeneration",
  ]);
  const detailsTests = rest(tests, ["satTotal", "satReading", "satMath", "actComposite", "focus", "target", "plansTestOptional", "superscore"]);
  const detailsPlans = rest(plans, ["intendedMajors", "earlyRoundInterest"]);
  const detailsPreferences = rest(preferences, ["sizes", "settings", "types", "statesOrRegions", "maxAverageCost"]);
  const details: Record<string, unknown> = { ...rest(data, ["basics", "academics", "tests", "plans", "preferences", "story", "recommenders"]) };
  if (Object.keys(detailsBasics).length) details.basics = detailsBasics;
  if (Object.keys(detailsAcademics).length) details.academics = detailsAcademics;
  if (Object.keys(detailsTests).length) details.tests = detailsTests;
  if (Object.keys(detailsPlans).length) details.plans = detailsPlans;
  if (Object.keys(detailsPreferences).length) details.preferences = detailsPreferences;

  return { fields, details };
}

/* ------------------------------------------------------------------ */
/* An offer (plan_offers)                                              */
/* ------------------------------------------------------------------ */

const COA_KEYS: readonly CoaPart[] = ["tuition_fees", "housing_food", "books", "transport", "personal", "other"];

/**
 * One financial-aid offer (`plan_offers`, `lib/planner/types.ts` `PlanOffer`), using the labels and the `usd()`
 * formatter the offers tool itself shows a family (`lib/planner/offers.ts`).
 */
export function offers(data: Record<string, unknown>): RecordFields {
  const fields: FieldRow[] = [];

  if (isNum(data.award_year)) fields.push({ label: "Award year", value: awardYearLabel(data.award_year) });
  if (isStr(data.letter_date)) fields.push({ label: "Letter date", value: fmtDate(data.letter_date) });
  if (isStr(data.source)) fields.push({ label: "Source", value: data.source === "upload" ? "Uploaded letter" : "Typed from the letter" });

  const coa = isObj(data.coa) ? data.coa : {};
  for (const key of COA_KEYS) if (isNum(coa[key])) fields.push({ label: COA_LABELS[key], value: usd(coa[key] as number) });
  if (isNum(coa.total)) fields.push({ label: "Total cost of attendance", value: usd(coa.total) });

  if (isArr(data.gift)) {
    data.gift.forEach((g, i) => {
      if (!isObj(g) || !isNum(g.amount)) return;
      const kind = isStr(g.kind) ? GIFT_LABELS[g.kind as keyof typeof GIFT_LABELS] ?? g.kind : "Gift aid";
      const name = isStr(g.name) ? g.name : kind;
      const renew = g.renewable === true ? ", renews" : g.renewable === false ? ", doesn't renew" : "";
      fields.push({ label: `Gift ${i + 1}: ${name}`, value: `${usd(g.amount)} (${kind})${renew}` });
    });
  }

  if (isNum(data.work_study)) fields.push({ label: "Work-study", value: usd(data.work_study) });

  if (isArr(data.loans)) {
    data.loans.forEach((l, i) => {
      if (!isObj(l) || !isNum(l.amount)) return;
      const kind = isStr(l.kind) ? LOAN_LABELS[l.kind as keyof typeof LOAN_LABELS] ?? l.kind : "Loan";
      fields.push({ label: `Loan ${i + 1}`, value: `${usd(l.amount)} (${kind})` });
    });
  }

  if (isStr(data.pros)) fields.push({ label: "Pros", value: data.pros });
  if (isStr(data.cons)) fields.push({ label: "Cons", value: data.cons });
  fields.push({ label: "Confirmed", value: isStr(data.confirmed_at) ? fmtDateTime(data.confirmed_at) : "Not confirmed (notes only)" });
  if (isStr(data.created_at)) fields.push({ label: "Added", value: fmtDateTime(data.created_at) });

  const details = rest(data, ["award_year", "letter_date", "source", "coa", "gift", "work_study", "loans", "pros", "cons", "confirmed_at", "created_at"]);
  return { fields, details };
}

/* ------------------------------------------------------------------ */
/* An application snapshot (application_snapshots)                     */
/* ------------------------------------------------------------------ */

const ROUND_LABELS: Record<string, string> = { ed: "Early Decision", ed2: "Early Decision II", ea: "Early Action", rea: "Restrictive Early Action", rd: "Regular Decision", rolling: "Rolling" };
const HS_AP_BAND_LABELS: Record<string, string> = { none: "No AP courses offered", "1-5": "1–5 AP courses offered", "6-10": "6–10 AP courses offered", "11-15": "11–15 AP courses offered", "16+": "16 or more AP courses offered" };
const RIGOR_READING_LABELS: Record<string, string> = { most: "Took the most demanding courses offered", much: "Took much of what was offered", some: "Took some of what was offered", few_offered: "The school offered few advanced courses", cant_place: "Can't tell how demanding their courses were" };
const BASE_RATE_KIND_LABELS: Record<string, string> = { guaranteed: "A guaranteed-admission rate", major: "This major's own admit rate", residency: "This residency's admit rate", overall: "The college's overall admit rate" };

function groupValue(v: unknown): string | null {
  return isStr(v) && v in STANDING_LEVEL_LABELS ? STANDING_LEVEL_LABELS[v as keyof typeof STANDING_LEVEL_LABELS] : null;
}

/**
 * One application snapshot (`application_snapshots`): the binned inputs the estimate read and the estimate it showed,
 * as they were measured, with the admission-chances words (`lib/chances/levels.ts`) and the site's own GPA scale
 * labels. Never the note-catalog keys or the model version, which stay under Details.
 */
export function snapshot(data: Record<string, unknown>): RecordFields {
  const fields: FieldRow[] = [];

  if (isStr(data.applied_on)) fields.push({ label: "Applied", value: fmtDate(data.applied_on) });
  if (isStr(data.round)) fields.push({ label: "Round", value: ROUND_LABELS[data.round] ?? data.round });
  if (isNum(data.season)) fields.push({ label: "Season", value: `${data.season}–${String((data.season + 1) % 100).padStart(2, "0")}` });

  if (isNum(data.gpa)) fields.push({ label: "GPA", value: gpaValue(data.gpa, data.gpa_scale ?? "4.0") });
  else if (isNum(data.gpa_low) && isNum(data.gpa_high)) fields.push({ label: "GPA range", value: `${data.gpa_low}–${data.gpa_high}` });
  if (isStr(data.test_kind) && isNum(data.test_score)) fields.push({ label: data.test_kind === "act" ? "ACT" : "SAT", value: String(data.test_score) });
  if (isNum(data.class_rank_pct)) fields.push({ label: "Class rank", value: `Top ${data.class_rank_pct}%` });
  if (isStr(data.state)) fields.push({ label: "State", value: data.state === OUTSIDE_US ? "Outside the U.S." : data.state });
  if (isArr(data.majors) && data.majors.length > 0) fields.push({ label: "Majors", value: data.majors.map((m) => (typeof m === "string" ? majorFamilyName(m) ?? m : String(m))).join(", ") });
  if (isNum(data.advanced_courses)) fields.push({ label: "AP, IB, or dual courses taken", value: String(data.advanced_courses) });
  if (isNum(data.honors_courses)) fields.push({ label: "Honors courses taken", value: String(data.honors_courses) });
  if (isStr(data.hs_ap_band)) fields.push({ label: "What the high school offers", value: HS_AP_BAND_LABELS[data.hs_ap_band] ?? data.hs_ap_band });
  if (isStr(data.rigor_reading)) fields.push({ label: "Course rigor reading", value: RIGOR_READING_LABELS[data.rigor_reading] ?? data.rigor_reading });

  if (isNum(data.admit_rate)) fields.push({ label: "College's admit rate that day", value: `${Math.round(data.admit_rate * 100)}%` });
  const group = groupValue(data.estimate_group);
  if (group) fields.push({ label: "Estimate shown", value: group });
  if (isStr(data.estimate_label)) fields.push({ label: "Estimate label", value: data.estimate_label === "reach-for-everyone" ? "A reach for everyone" : "Guaranteed admission" });
  if (isStr(data.base_rate_kind)) fields.push({ label: "Base rate used", value: BASE_RATE_KIND_LABELS[data.base_rate_kind] ?? data.base_rate_kind });
  if (isNum(data.base_rate)) fields.push({ label: "Base rate", value: `${Math.round(data.base_rate * 100)}%` });
  const studentGroup = groupValue(data.student_group);
  if (studentGroup) fields.push({ label: "Group the student picked", value: studentGroup });
  const changed = YES_NO(data.group_changed);
  if (changed === "Yes") fields.push({ label: "Differs from the estimate", value: "Yes" });

  const consented = YES_NO(data.consented);
  if (consented) fields.push({ label: "Consented to research use", value: consented });
  if (isStr(data.created_at)) fields.push({ label: "Recorded", value: fmtDateTime(data.created_at) });

  const details = rest(data, [
    "applied_on", "round", "season", "gpa", "gpa_low", "gpa_high", "gpa_scale", "test_kind", "test_score", "class_rank_pct", "state", "majors", "advanced_courses", "honors_courses",
    "hs_ap_band", "rigor_reading", "admit_rate", "estimate_group", "estimate_label", "base_rate_kind", "base_rate", "student_group", "group_changed", "consented", "created_at",
  ]);
  return { fields, details };
}

/* ------------------------------------------------------------------ */
/* Notification preferences (notification_prefs)                       */
/* ------------------------------------------------------------------ */

/**
 * One row of `notification_prefs`, with the names each switch has where a person sets it: "Update emails" (/account),
 * "Your week" (the weekly reminder), "Weekly summary" (a parent's weekly email), "Nudge emails" (sent when a parent
 * nudges them).
 */
export function notificationPrefs(data: Record<string, unknown>): RecordFields {
  const fields: FieldRow[] = [];
  const on = (v: unknown, def: boolean): string => (typeof v === "boolean" ? v : def) ? "On" : "Off";

  if ("email_updates" in data) fields.push({ label: "Update emails", value: on(data.email_updates, true) });
  if ("your_week" in data) fields.push({ label: "Your week", value: on(data.your_week, true) });
  if ("parent_summary" in data) fields.push({ label: "Weekly summary (parent)", value: on(data.parent_summary, false) });
  if ("nudge_emails" in data) fields.push({ label: "Nudge emails", value: on(data.nudge_emails, true) });
  if (isStr(data.updated)) fields.push({ label: "Last changed", value: fmtDateTime(data.updated) });

  const details = rest(data, ["email_updates", "your_week", "parent_summary", "nudge_emails", "updated"]);
  return { fields, details };
}
