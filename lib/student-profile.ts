/**
 * A student's own numbers and preferences (specs/product/student-profile.md): the groups on `/me`, GPA
 * normalization, completeness per tool, and the "fits me" predicates Explore and the profile pages read. Pure
 * module (no server or browser APIs), so it's safe in tests, Server Actions, and client components alike.
 *
 * One JSON document per student (`student_profiles.data`, see the migration); `lib/student-profile-store.ts` reads
 * and writes it for the signed-in user. Signed out, the same shape is kept in `localStorage` under the key
 * `student-profile` (components/me/useLocalProfile.ts).
 */
import type { School, SchoolType, SettingGroup, SizeBucket } from "./types.ts";
import { satTotal } from "./score-bands.ts";
import { isMajorFamily, type MajorFamily } from "./majors.ts";
import { isHighSchoolId } from "./high-school-core.ts";
import type { StandingStudent } from "./planner/standing.ts";

/**
 * Same boundaries as lib/metrics.ts SIZE_BUCKETS, duplicated here rather than imported: that module pulls in
 * several server-oriented helpers transitively, and this one stays dependency-light so it's safe from a Server
 * Action, a client component, and a plain Node test alike.
 */
function sizeBucketKey(enrollment: number): SizeBucket {
  if (enrollment < 5000) return "small";
  if (enrollment < 15000) return "medium";
  if (enrollment < 30000) return "large";
  return "xl";
}

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

/** Grad year window a form may offer; outside this range the value is dropped, not clamped. */
export const GRAD_YEAR_MIN = 2000;
export const GRAD_YEAR_MAX = 2035;

/** "Outside the U.S." sentinel for `basics.stateOfResidence` (student-profile.md "Basics"). */
export const OUTSIDE_US = "OUTSIDE_US";

export interface StudentProfileBasics {
  gradYear: number | null;
  /** USPS postal code (e.g. "TN"), or OUTSIDE_US. Null = not set. */
  stateOfResidence: string | null;
  /** Display name: filled in from the picker's pick, or typed free text when the student's school isn't listed. */
  highSchool: string | null;
  /** The picked high school's id (ncessch or PSS ppin), from the /me combobox (lib/high-schools.ts); null for free text. */
  highSchoolId: string | null;
  /**
   * The Common App/NACAC fee-waiver criteria (Pell-likely, first-generation, etc.): asked once, its own yes/no,
   * null until answered (specs/planner/applications.md "Rules"). Read by `lib/planner/requirements.ts` and the
   * `apply` generator's fee/waiver sub-task.
   */
  feeWaiverEligible: boolean | null;
}

/** The scale a GPA is reported on; chances and every other tool read the 4.0 unweighted conversion. */
export type GpaScale = "4.0" | "5.0" | "100";
export const GPA_SCALES: { value: GpaScale; label: string }[] = [
  { value: "4.0", label: "4.0 scale" },
  // Stored as "5.0" (unchanged); a weighted GPA, read as a range by the plan (planGpaRange; planner/redesign/gpa.md).
  { value: "5.0", label: "Weighted (honors/AP count extra)" },
  { value: "100", label: "100-point scale" },
];

export interface StudentProfileAcademics {
  /** On `gpaScale`; never pre-converted, so the original number is always shown back to the student. */
  gpa: number | null;
  gpaScale: GpaScale;
  /**
   * Weighted GPA, informational only (glossary "weighted-gpa"): never converted or compared across schools. 0–120,
   * not 0–4.0/5.0: many high schools weight a 100-point scale above 100 for honors/AP courses (e.g. 108/100), so the
   * cap has to clear that, not just the unweighted scale's own max.
   */
  weightedGpa: number | null;
  /** 0–100; "top 10%" is stored as 10. */
  classRankPercentile: number | null;
  /** Count of AP/IB/dual-enrollment courses taken. */
  courseRigorCount: number | null;
}

export interface StudentProfileTests {
  satTotal: number | null;
  satReading: number | null;
  satMath: number | null;
  actComposite: number | null;
  actEnglish: number | null;
  actMath: number | null;
  actReading: number | null;
  actScience: number | null;
  /** The student reports a superscore (glossary "superscore"): the best section scores across sittings. */
  superscore: boolean;
  /** "I plan to apply test-optional" even where scores are on file. */
  plansTestOptional: boolean;
  /**
   * The one test the plan uses (specs/planner/redesign/standing.md "The numbers"): SAT, ACT, "none" (not testing:
   * the plan uses GPA alone), or null (not asked yet). Switching keeps both stored scores.
   */
  focus: TestFocus | null;
  /** The score in the focus test is a practice score (a PSAT or practice test); shown once, in the plan's header card. */
  practice: boolean;
  /**
   * Test dates the student picked with "I'll take it" (scores.md "Test dates"): cycle-file entry keys such as
   * `sat_2026_10` (data/application-cycle.json); the cycle generator makes register and test-day tasks only for these.
   */
  plannedDates: string[];
}

export type TestFocus = "sat" | "act" | "none";
const TEST_FOCUS_VALUES: TestFocus[] = ["sat", "act", "none"];
/** Most test dates a student can pick at once. */
export const PLANNED_DATES_MAX = 6;
/** A test-date key in the cycle file: `sat_YYYY_MM` or `act_YYYY_MM` (tests/planner-redesign-profile.test.mts checks every test date in the cycle file has this shape). */
const TEST_DATE_KEY = /^(sat|act)_\d{4}_(0[1-9]|1[0-2])$/;

/** Whether a value is a cycle-file test-date key (`sat_2026_10`). */
export function isTestDateKey(v: unknown): v is string {
  return typeof v === "string" && TEST_DATE_KEY.test(v);
}

export type EarlyRoundInterest = "ed" | "ea" | "none";

export interface StudentProfilePlans {
  /** Up to 3 two-digit CIP families (lib/majors.ts MAJOR_FAMILIES), most-interested first. */
  intendedMajors: MajorFamily[];
  earlyRoundInterest: EarlyRoundInterest | null;
}

export const MAX_INTENDED_MAJORS = 3;

export interface StudentProfilePreferences {
  sizes: SizeBucket[];
  settings: SettingGroup[];
  /** USPS postal codes, Scorecard regions, or OUTSIDE_US; an empty list means no preference. */
  statesOrRegions: string[];
  /** Dollars; null = no preference. Compared against a college's average paid price, not sticker. */
  maxAverageCost: number | null;
  types: SchoolType[];
}

export interface StudentProfileData {
  basics: StudentProfileBasics;
  academics: StudentProfileAcademics;
  tests: StudentProfileTests;
  plans: StudentProfilePlans;
  preferences: StudentProfilePreferences;
}

/**
 * The graduation year the /me form should default to (student-profile.md "Changes (2026-10-06)"): the profile's
 * own saved value when there is one, else the `students.grad_year` set when the student was invited or added to a
 * household. Null when neither is on file. Pure so it's testable without a profile form or a Supabase round trip.
 */
export function effectiveGradYear(basics: Pick<StudentProfileBasics, "gradYear">, studentGradYear: number | null): number | null {
  return basics.gradYear ?? studentGradYear;
}

export const PROFILE_GROUPS = ["basics", "academics", "tests", "plans", "preferences"] as const;
export type ProfileGroup = (typeof PROFILE_GROUPS)[number];

/** The key signed-out local storage is kept under (student-profile.md "Behavior"). */
export const LOCAL_PROFILE_KEY = "student-profile";

export function emptyProfile(): StudentProfileData {
  return {
    basics: { gradYear: null, stateOfResidence: null, highSchool: null, highSchoolId: null, feeWaiverEligible: null },
    academics: { gpa: null, gpaScale: "4.0", weightedGpa: null, classRankPercentile: null, courseRigorCount: null },
    tests: {
      satTotal: null,
      satReading: null,
      satMath: null,
      actComposite: null,
      actEnglish: null,
      actMath: null,
      actReading: null,
      actScience: null,
      superscore: false,
      plansTestOptional: false,
      focus: null,
      practice: false,
      plannedDates: [],
    },
    plans: { intendedMajors: [], earlyRoundInterest: null },
    preferences: { sizes: [], settings: [], statesOrRegions: [], maxAverageCost: null, types: [] },
  };
}

/* ------------------------------------------------------------------ */
/* Sanitizing untrusted input (form posts, localStorage JSON)          */
/* ------------------------------------------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A finite number within [lo, hi], else null. Never treats a missing or out-of-range value as 0. */
function num(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function int(v: unknown, lo: number, hi: number): number | null {
  const n = num(v, lo, hi);
  return n === null ? null : Math.round(n);
}

function bool(v: unknown): boolean {
  return v === true;
}

/** Yes/No/not set (the fee-waiver question, student-profile.md-style additive field): null unless the value is clearly one or the other. */
function nullableBool(v: unknown): boolean | null {
  if (v === true || v === "true" || v === "yes") return true;
  if (v === false || v === "false" || v === "no") return false;
  return null;
}

function str(v: unknown, maxLen = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= maxLen ? s : null;
}

function arr<T>(v: unknown, keep: (x: unknown) => T | null, max: number): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) {
    const k = keep(item);
    if (k !== null && !out.includes(k)) out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

const SIZE_BUCKET_VALUES: SizeBucket[] = ["small", "medium", "large", "xl"];
const SETTING_GROUP_VALUES: SettingGroup[] = ["city", "suburb", "town", "rural"];
const SCHOOL_TYPE_VALUES: SchoolType[] = ["public", "private-nonprofit", "private-forprofit"];
const EARLY_ROUND_VALUES: EarlyRoundInterest[] = ["ed", "ea", "none"];
const GPA_SCALE_VALUES: GpaScale[] = ["4.0", "5.0", "100"];

/**
 * The highest GPA kept on each scale. A 4.0-scale GPA may run to 5.0: above 4.0 it is weighted by definition, and the
 * plan reads it as a range (planGpaRange; specs/planner/redesign/gpa.md "The design" 3). unweightedGpa4 still caps it.
 */
export function gpaMaxFor(scale: GpaScale): number {
  return scale === "100" ? 100 : 5.0;
}

/**
 * Turns unknown input (a form post, or whatever JSON a browser's localStorage happens to hold) into a valid
 * StudentProfileData, dropping anything invalid rather than throwing. Always returns a complete shape: callers never
 * need to null-check a group.
 */
export function sanitizeProfile(input: unknown): StudentProfileData {
  const empty = emptyProfile();
  if (!isObj(input)) return empty;

  const b = isObj(input.basics) ? input.basics : {};
  const basics: StudentProfileBasics = {
    gradYear: int(b.gradYear, GRAD_YEAR_MIN, GRAD_YEAR_MAX),
    stateOfResidence: str(b.stateOfResidence, 20),
    highSchool: str(b.highSchool, 200),
    highSchoolId: typeof b.highSchoolId === "string" && isHighSchoolId(b.highSchoolId) ? b.highSchoolId : null,
    feeWaiverEligible: nullableBool(b.feeWaiverEligible),
  };

  const ac = isObj(input.academics) ? input.academics : {};
  const gpaScale = GPA_SCALE_VALUES.includes(ac.gpaScale as GpaScale) ? (ac.gpaScale as GpaScale) : "4.0";
  const academics: StudentProfileAcademics = {
    gpa: num(ac.gpa, 0, gpaMaxFor(gpaScale)),
    gpaScale,
    weightedGpa: num(ac.weightedGpa, 0, 120),
    classRankPercentile: int(ac.classRankPercentile, 1, 100),
    courseRigorCount: int(ac.courseRigorCount, 0, 40),
  };

  const t = isObj(input.tests) ? input.tests : {};
  const tests: StudentProfileTests = {
    satTotal: int(t.satTotal, 400, 1600),
    satReading: int(t.satReading, 200, 800),
    satMath: int(t.satMath, 200, 800),
    actComposite: int(t.actComposite, 1, 36),
    actEnglish: int(t.actEnglish, 1, 36),
    actMath: int(t.actMath, 1, 36),
    actReading: int(t.actReading, 1, 36),
    actScience: int(t.actScience, 1, 36),
    superscore: bool(t.superscore),
    plansTestOptional: bool(t.plansTestOptional),
    focus: TEST_FOCUS_VALUES.includes(t.focus as TestFocus) ? (t.focus as TestFocus) : null,
    practice: bool(t.practice),
    plannedDates: arr(t.plannedDates, (x) => (isTestDateKey(x) ? x : null), PLANNED_DATES_MAX),
  };

  const pl = isObj(input.plans) ? input.plans : {};
  const plans: StudentProfilePlans = {
    intendedMajors: arr(pl.intendedMajors, (x) => (typeof x === "string" && isMajorFamily(x) ? x : null), MAX_INTENDED_MAJORS),
    earlyRoundInterest: EARLY_ROUND_VALUES.includes(pl.earlyRoundInterest as EarlyRoundInterest) ? (pl.earlyRoundInterest as EarlyRoundInterest) : null,
  };

  const pr = isObj(input.preferences) ? input.preferences : {};
  const preferences: StudentProfilePreferences = {
    sizes: arr(pr.sizes, (x) => (SIZE_BUCKET_VALUES.includes(x as SizeBucket) ? (x as SizeBucket) : null), 4),
    settings: arr(pr.settings, (x) => (SETTING_GROUP_VALUES.includes(x as SettingGroup) ? (x as SettingGroup) : null), 4),
    statesOrRegions: arr(pr.statesOrRegions, (x) => str(x, 20), 60),
    maxAverageCost: num(pr.maxAverageCost, 0, 400_000),
    types: arr(pr.types, (x) => (SCHOOL_TYPE_VALUES.includes(x as SchoolType) ? (x as SchoolType) : null), 3),
  };

  return { basics, academics, tests, plans, preferences };
}

/* ------------------------------------------------------------------ */
/* GPA normalization (student-profile.md "GPA normalization")         */
/* ------------------------------------------------------------------ */

/**
 * The standard 100-point-to-4.0 conversion table used by most U.S. high schools and colleges (College Board /
 * NACAC's common table): 97+ is a 4.0, 93-96 a 3.7, and so on down to a 0.0 below 65. Bands are checked top-down
 * (the result for 93 is 3.7, matching the worked example in student-profile.md).
 */
const HUNDRED_POINT_BANDS: readonly [number, number][] = [
  [97, 4.0],
  [93, 3.7],
  [90, 3.3],
  [87, 3.0],
  [83, 2.7],
  [80, 2.3],
  [77, 2.0],
  [73, 1.7],
  [70, 1.3],
  [67, 1.0],
  [65, 0.7],
  [0, 0.0],
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function gpaFrom100(score: number): number {
  for (const [min, gpa] of HUNDRED_POINT_BANDS) if (score >= min) return gpa;
  return 0.0;
}

/**
 * The student's GPA converted to an unweighted 4.0 scale: a 5.0-scale GPA is scaled proportionally
 * (`gpa / 5 * 4`); a 100-point GPA uses the standard band table above. Null when no GPA is on file. Every result is
 * rounded to one decimal, since the inputs themselves are approximate.
 */
export function unweightedGpa4(gpa: number | null, scale: GpaScale): number | null {
  if (gpa === null) return null;
  if (scale === "4.0") return round1(Math.min(gpa, 4.0));
  if (scale === "5.0") return round1((gpa / 5) * 4);
  return gpaFrom100(gpa);
}

/**
 * The sentence every tool shows: "3.8 unweighted" on a 4.0 scale, or "about 3.7 unweighted (from 93/100)" when it
 * was converted (student-profile.md "GPA normalization"). Null when no GPA is on file.
 */
export function gpaDisplay(academics: Pick<StudentProfileAcademics, "gpa" | "gpaScale">): string | null {
  const unweighted = unweightedGpa4(academics.gpa, academics.gpaScale);
  if (unweighted === null || academics.gpa === null) return null;
  const formatted = unweighted.toFixed(1);
  if (academics.gpaScale === "4.0") return `${formatted} unweighted`;
  const from = academics.gpaScale === "5.0" ? `${trimTrailingZero(academics.gpa)}/5.0` : `${trimTrailingZero(academics.gpa)}/100`;
  return `about ${formatted} unweighted (from ${from})`;
}

function trimTrailingZero(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/* ------------------------------------------------------------------ */
/* The plan's numbers (specs/planner/redesign/standing.md)             */
/* ------------------------------------------------------------------ */

/**
 * The one test the plan uses (standing.md "The numbers"): the focus test's score when the student picked one; with
 * no focus yet and exactly one score on file, that one; "Not testing", no score, or two scores and no pick: null.
 */
export function planTest(profile: Pick<StudentProfileData, "tests"> | null): { kind: "sat" | "act"; score: number } | null {
  if (!profile) return null;
  const t = profile.tests;
  if (t.focus === "none") return null;
  if (t.focus === "sat") return t.satTotal !== null ? { kind: "sat", score: t.satTotal } : null;
  if (t.focus === "act") return t.actComposite !== null ? { kind: "act", score: t.actComposite } : null;
  if (t.satTotal !== null && t.actComposite === null) return { kind: "sat", score: t.satTotal };
  if (t.actComposite !== null && t.satTotal === null) return { kind: "act", score: t.actComposite };
  return null;
}

/** The student as the standing model reads them: unweighted GPA on 4.0 (unweightedGpa4) and the one test. */
export function planStudent(profile: Pick<StudentProfileData, "tests" | "academics"> | null): StandingStudent {
  if (!profile) return { gpa: null, test: null };
  return { gpa: unweightedGpa4(profile.academics.gpa, profile.academics.gpaScale), test: planTest(profile) };
}

/** A GPA is weighted when it's on the weighted scale, or on the 4.0 scale but above 4.0. */
function isWeightedGpa(a: Pick<StudentProfileAcademics, "gpa" | "gpaScale">): boolean {
  return a.gpa !== null && (a.gpaScale === "5.0" || (a.gpaScale === "4.0" && a.gpa > 4));
}

/**
 * The unweighted range the plan reads the student's GPA as (specs/planner/redesign/gpa.md "The design" 3). An
 * unweighted 4.0-scale GPA is itself; a weighted one (the weighted scale, or above 4.0 on the 4.0 scale) lies in
 * [w − 1, min(4, w)], since weighting adds at most a point per class; a 100-point GPA is the band table's value.
 * Null when no GPA is on file. Only the plan reads this; other tools keep unweightedGpa4.
 */
export function planGpaRange(profile: Pick<StudentProfileData, "academics"> | null): [number, number] | null {
  const a = profile?.academics;
  if (!a || a.gpa === null) return null;
  if (isWeightedGpa(a)) return [Math.max(0, a.gpa - 1), Math.min(4, a.gpa)];
  if (a.gpaScale === "100") {
    const g = gpaFrom100(a.gpa);
    return [g, g];
  }
  return [a.gpa, a.gpa];
}

/**
 * How the plan's reasons show the student's GPA: "3.82"; "about 3.4–4.0 unweighted (from a weighted 4.4)"; "about 3.7
 * unweighted (from 93/100)". Null when no GPA is on file.
 */
export function planGpaLabel(profile: Pick<StudentProfileData, "academics"> | null): string | null {
  const a = profile?.academics;
  const range = planGpaRange(profile ?? null);
  if (!a || a.gpa === null || !range) return null;
  if (isWeightedGpa(a)) return `about ${range[0].toFixed(1)}–${range[1].toFixed(1)} unweighted (from a weighted ${trimTrailingZero(a.gpa)})`;
  if (a.gpaScale === "100") return `about ${range[0].toFixed(1)} unweighted (from ${trimTrailingZero(a.gpa)}/100)`;
  return a.gpa.toFixed(2);
}

/* ------------------------------------------------------------------ */
/* Completeness (student-profile.md "A completeness meter on /me")     */
/* ------------------------------------------------------------------ */

export interface CompletenessItem {
  tool: string;
  /** What's missing, in the student's own words ("Add a GPA to see where you stand"). */
  need: string;
  met: boolean;
}

function hasAnyPreference(p: StudentProfilePreferences): boolean {
  return p.sizes.length > 0 || p.settings.length > 0 || p.statesOrRegions.length > 0 || p.types.length > 0 || p.maxAverageCost !== null;
}

function hasAnyScore(t: StudentProfileTests): boolean {
  return t.satTotal !== null || t.actComposite !== null || t.plansTestOptional;
}

/** What each tool on the site needs from the profile, and whether it's there yet. */
export function completeness(data: StudentProfileData): CompletenessItem[] {
  return [
    { tool: "Where would you land? (ScoreChecker)", need: "Add a SAT or ACT score to see where you'd land", met: hasAnyScore(data.tests) },
    { tool: 'Explore "Fits my scores"', need: "Add a SAT or ACT score, or note you're applying test-optional", met: hasAnyScore(data.tests) },
    { tool: 'Explore "Fits my preferences"', need: "Add at least one preference (size, setting, state, cost, or type)", met: hasAnyPreference(data.preferences) },
    { tool: "Chances (GPA bands)", need: "Add a GPA to see where you stand", met: data.academics.gpa !== null },
    { tool: "Net price estimator", need: "Add your state of residence", met: data.basics.stateOfResidence !== null },
    { tool: "Majors and earnings", need: "Add an intended major", met: data.plans.intendedMajors.length > 0 },
  ];
}

/** Fraction of the completeness list that's met, 0-1. */
export function completenessScore(data: StudentProfileData): number {
  const items = completeness(data);
  return items.filter((i) => i.met).length / items.length;
}

/* ------------------------------------------------------------------ */
/* Fit predicates                                                      */
/* ------------------------------------------------------------------ */

/**
 * Tri-state result for a "fits me" check. "unknown" means the college doesn't report the figure the check needs
 * (e.g. no SAT range), so the student's own number simply can't be compared — it is deliberately NOT the same as
 * "out": a college with no SAT range isn't being told it misses the student's score, there's just nothing to check.
 * Explore's `fit=` filters keep only "in" results, so both "out" and "unknown" colleges are left off the filtered
 * list; this is the one place the distinction collapses, and it's called out in student-profile.md and the Explore
 * chip's copy ("colleges without a reported range aren't shown either way").
 */
export type Fit = "in" | "out" | "unknown";

/** A saved SAT total and/or ACT composite — plain numbers, not a full profile. */
export interface ScoreValues {
  sat: number | null;
  act: number | null;
}

/**
 * Whether a score fits a given SAT and ACT range, or the test policy is test-blind (never asks for scores, so
 * every score "fits"). "unknown" when a score is given but no range for that test, and it isn't test-blind — see
 * the Fit doc comment for why that's not "out". Takes the ranges as plain values rather than reading them from a
 * `School` itself, because **which range to pass matters**: `fitsScoreValues` below passes `satTotal()` (the
 * college's own displayed range — right for ScoreChecker/Compare's "You" marker) while lib/dataset.ts's Explore
 * filter passes `satComposite()` (the sum of sections) instead, the same range its neighboring `minSAT`/`maxSAT`
 * filters use — ranks, sorts, and filters never read the college's own reported total (lib/score-bands.ts's
 * `satTotal` doc comment; enforced for lib/dataset.ts by tests/cds-test-scores-and-policy.test.mts).
 */
export function fitsScoreRange(satRange: [number, number] | null, actRange: [number, number] | null, testPolicy: School["admissions"]["test_policy"], scores: ScoreValues): Fit {
  if (testPolicy === "not-considered") return "in";
  const checks: Fit[] = [];
  if (scores.sat !== null && satRange) checks.push(scores.sat >= satRange[0] && scores.sat <= satRange[1] ? "in" : "out");
  if (scores.act !== null && actRange) checks.push(scores.act >= actRange[0] && scores.act <= actRange[1] ? "in" : "out");
  if (checks.length === 0) return "unknown";
  return checks.includes("in") ? "in" : "out";
}

/**
 * fitsScoreRange against the college's own displayed SAT range (`satTotal`, score-bands.ts) and reported ACT
 * range — what ScoreChecker, Compare's "You" row, and `/me`'s own display logic want. Explore's server-side
 * filter (lib/dataset.ts) calls `fitsScoreRange` directly with `satComposite()` instead; see that function's doc
 * comment for why.
 */
export function fitsScoreValues(school: Pick<School, "admissions" | "reported" | "lineage">, scores: ScoreValues): Fit {
  return fitsScoreRange(satTotal(school), school.admissions.act_composite_25_75, school.admissions.test_policy, scores);
}

/** Convenience wrapper over fitsScoreValues for callers that already have a full profile (e.g. `/me`'s own pages). */
export function fitsScores(school: Pick<School, "admissions" | "reported" | "lineage">, profile: StudentProfileData): Fit {
  return fitsScoreValues(school, { sat: profile.tests.satTotal, act: profile.tests.actComposite });
}

/** The average price this preference check compares against: the all-student estimate, else the sticker price. */
function averagePaid(school: Pick<School, "cost">): number | null {
  return school.cost?.avg_paid_all ?? school.cost?.cost_of_attendance ?? null;
}

/**
 * Whether a college matches every preference the student set (size, setting, state/region, type, max average
 * cost). A preference left blank is skipped. With no preferences set at all, every college is "in" (trivially
 * true, so the chip has something to show before the student fills anything in). "unknown" wins over "in" but
 * loses to "out": one clear mismatch is enough to exclude a college even if another preference can't be checked.
 */
export function fitsPreferences(school: Pick<School, "demographics" | "campus" | "location" | "type" | "cost">, profile: StudentProfileData): Fit {
  const p = profile.preferences;
  const checks: Fit[] = [];
  if (p.sizes.length > 0) checks.push(p.sizes.includes(sizeBucketKey(school.demographics.undergrad_enrollment)) ? "in" : "out");
  if (p.settings.length > 0) {
    const group = school.campus?.setting?.group;
    checks.push(group ? (p.settings.includes(group) ? "in" : "out") : "unknown");
  }
  if (p.statesOrRegions.length > 0) {
    checks.push(p.statesOrRegions.includes(school.location.state) || p.statesOrRegions.includes(school.location.region) ? "in" : "out");
  }
  if (p.types.length > 0) checks.push(p.types.includes(school.type) ? "in" : "out");
  if (p.maxAverageCost !== null) {
    const price = averagePaid(school);
    checks.push(price === null ? "unknown" : price <= p.maxAverageCost ? "in" : "out");
  }
  if (checks.length === 0) return "in";
  if (checks.includes("out")) return "out";
  if (checks.includes("unknown")) return "unknown";
  return "in";
}
