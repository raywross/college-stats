/**
 * The Plan's intake guide (specs/planner/redesign/intake.md): grades, test, AP courses, four optional activity steps
 * (sports, clubs, work, other; their rules in ./activity-steps.ts), review, and a Done screen, saved once at the end. Everything the guide decides lives here: the class-year chips, GPA scale
 * detection and validation, the score and target checks, the AP search and its aliases, the "When?" term chips, the
 * draft read from a saved profile, and the profile the save writes. Ported from the design prototype's script (Plan
 * Redesign.dc.html). Pure (no server or browser APIs), so the intake's UI, the `saveIntake` Server Action, and tests
 * all run the same rules.
 */
import { apCourses, catalogCourse, isCatalogKeyFor } from "../chances/catalog.ts";
import { newCourseId } from "../chances/courses.ts";
import type { ActivityEntry, AwardEntry, ClassStanding, CourseEntry, CourseStatus, RankExpectation } from "../chances/types.ts";
import { isHighSchoolId } from "../high-school-core.ts";
import {
  COURSES_MAX,
  GRAD_YEAR_MAX,
  GRAD_YEAR_MIN,
  isClassStanding,
  isRankExpectation,
  planTest,
  sanitizeActivities,
  sanitizeActivitiesNone,
  sanitizeAwards,
  sanitizeConnections,
  sanitizeProfile,
  type ActivitiesNone,
  type ConnectionEntry,
  type GpaScale,
  type StudentProfileData,
  type TestFocus,
} from "../student-profile.ts";
import { isUnitId } from "../follow-state.ts";
import type { PlanContext } from "./types.ts";
import { reconcileStepNone, stepReviewValue, type ActivityStep } from "./activity-steps.ts";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type IntakeTest = "sat" | "act" | "none";
export type IntakeExam = "1" | "2" | "3" | "4" | "5" | "pending";

export interface IntakeCourse {
  /** CourseEntry id (kept for existing rows so a guardian's merge finds them), a new id for new ones. */
  id: string;
  /** AP catalog key, e.g. "ap_calculus_ab". */
  key: string;
  /** Which of the student's four high-school years ("Which year?"); null while nothing's picked. Taken/taking/planned
   * is derived from this and the class year (`yearStatus`), not stored separately. */
  year: 9 | 10 | 11 | 12 | null;
  /** The exam score, or "pending" ("Not back yet"); only meaningful once the picked year is over. */
  exam: IntakeExam | null;
}

export interface IntakeDraft {
  classYear: number | null;
  /** As typed. */
  gpa: string;
  /** The scale the student picked over the detected one; null follows detection. */
  scaleOverride: GpaScale | null;
  /** As typed, optional (intake.md "Grades"): "Many schools weight honors and AP grades; if yours does, add it." */
  weightedGpa: string;
  /** The class-standing pick, kept consistent with `classRankPercentile` the way ClassStandingPick does. */
  classStanding: ClassStanding | null;
  classRankPercentile: number | null;
  /** "Do you expect to be valedictorian or salutatorian?" (method/standing.md "Revision 1"); None reads as null. */
  rankExpectation: RankExpectation | null;
  test: IntakeTest | null;
  score: string;
  practice: boolean;
  target: string;
  /** The picker's pick (student-profile.ts basics.highSchool/highSchoolId); optional. */
  highSchool: string | null;
  highSchoolId: string | null;
  courses: IntakeCourse[];
  /**
   * The four optional activity steps' entries (depth.md "What the student enters"), one list: each step shows the
   * entries `stepOfActivity` gives it. `sanitizeActivities`'s ACTIVITIES_MAX caps the whole list. Carried through
   * unchanged when the steps are skipped.
   */
  activities: ActivityEntry[];
  /** The Other step's awards (inputs-beyond-academics.md "Awards"), capped by AWARDS_MAX. */
  awards: AwardEntry[];
  /**
   * Plan v3's Connections step (specs/planner/v3/connections.md), between Work and Other: the colleges a parent,
   * grandparent, or sibling went to, or that are recruiting the student, at most CONNECTIONS_MAX.
   */
  connections: ConnectionEntry[];
  /** The activity steps (and plan v3's Connections step) answered "None" (student-profile.ts academics.activitiesNone; owner, 2026-10-12). */
  activitiesNone: ActivitiesNone;
}

/** 0 grades, 1 test, 2 AP courses, 3 sports, 4 clubs, 5 work, 6 connections, 7 other (3–7 optional), 8 review, 9 done. */
export type IntakeStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const INTAKE_REVIEW = 8;
export const INTAKE_DONE = 9;
/** The step each activity screen is (Connections, step 6, isn't one of the four — it's handled directly in this module). */
export const ACTIVITY_STEP_INDEX: Readonly<Record<ActivityStep, 3 | 4 | 5 | 7>> = { sports: 3, clubs: 4, work: 5, other: 7 };
/** The activity screen a step index is, or null. */
/**
 * A `&step=N` link into edit mode (the plan's people line, "Next: add clubs"; owner 2026-10-12): an entry step 0–7
 * (grades through Other), else null (Review, Done, and anything else aren't linkable this way).
 */
export function intakeStepParam(v: string | null | undefined): IntakeStep | null {
  if (v == null || !/^[0-7]$/.test(v)) return null;
  return Number(v) as IntakeStep;
}

export function activityStepAt(step: IntakeStep): ActivityStep | null {
  return step === 3 ? "sports" : step === 4 ? "clubs" : step === 5 ? "work" : step === 7 ? "other" : null;
}

/** What `saveIntake` takes: the draft, checked and converted. */
export interface IntakeSave {
  classYear: number;
  gpa: number | null;
  gpaScale: GpaScale;
  weightedGpa: number | null;
  classStanding: ClassStanding | null;
  classRankPercentile: number | null;
  rankExpectation: RankExpectation | null;
  focus: TestFocus;
  score: number | null;
  practice: boolean;
  target: number | null;
  highSchool: string | null;
  highSchoolId: string | null;
  courses: IntakeCourse[];
  activities: ActivityEntry[];
  awards: AwardEntry[];
  connections: ConnectionEntry[];
  activitiesNone: ActivitiesNone;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const yearOf = (today: string) => Number(today.slice(0, 4));
const monthOf = (today: string) => Number(today.slice(5, 7));

/** The calendar year the current school year starts in (the school year turns over in August, like gradeNow). */
export function schoolYearStart(today: string): number {
  return monthOf(today) >= 8 ? yearOf(today) : yearOf(today) - 1;
}

/**
 * The "Class of" chips: four years starting at the current senior class (from July on, next year's), plus a stored
 * grad year outside that range as a fifth chip, in order.
 */
export function classYearOptions(today: string, stored: number | null): number[] {
  const first = monthOf(today) >= 7 ? yearOf(today) + 1 : yearOf(today);
  const out = [first, first + 1, first + 2, first + 3];
  if (stored !== null && Number.isInteger(stored) && !out.includes(stored)) out.push(stored);
  return out.sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ */
/* Step 1: grades                                                      */
/* ------------------------------------------------------------------ */

const SCALE_LABELS: Record<GpaScale, string> = { "100": "100-point scale", "4.0": "4.0 scale", "5.0": "5.0 weighted" };
/** The scale chips, in the design's order. */
export const INTAKE_SCALES: readonly GpaScale[] = ["100", "4.0", "5.0"];

/** A typed number, or NaN for anything that isn't one. */
function numberOf(s: string): number {
  const t = s.trim();
  return t === "" ? NaN : Number(t);
}

/** The scale a GPA looks like: empty or above 10 → 100-point; above 4 up to 10 → 5.0 weighted; up to 4 → 4.0. */
export function detectScale(gpa: string): GpaScale {
  const g = numberOf(gpa);
  if (!(g > 0) || g > 10) return "100";
  return g > 4 ? "5.0" : "4.0";
}

/** The student's own pick when they made one, else the detected scale. */
export function effectiveScale(d: Pick<IntakeDraft, "gpa" | "scaleOverride">): GpaScale {
  return d.scaleOverride ?? detectScale(d.gpa);
}

/** "100-point scale" | "4.0 scale" | "5.0 weighted". */
export function scaleLabel(s: GpaScale): string {
  return SCALE_LABELS[s];
}

/** Whether a GPA is valid on a scale: 100-point 40–120 (over 100 is fine), 4.0 up to 4.0, 5.0 up to 5.0. */
export function gpaInRange(gpa: number, scale: GpaScale): boolean {
  if (!Number.isFinite(gpa) || !(gpa > 0)) return false;
  if (scale === "100") return gpa >= 40 && gpa <= 120;
  return gpa <= (scale === "4.0" ? 4 : 5);
}

/** The GPA field's state: valid or not, the hint under it (amber on an error), and the scale button's caption. */
export function gpaCheck(d: Pick<IntakeDraft, "gpa" | "scaleOverride">): { ok: boolean; hint: string; tone: "muted" | "amber"; caption: "Default" | "Detected" | "Scale" } {
  const sc = effectiveScale(d);
  const empty = d.gpa.trim() === "";
  const caption = d.scaleOverride ? "Scale" : empty ? "Default" : "Detected";
  if (empty) return { ok: false, hint: "Enter it the way your transcript shows it. We'll work out the scale.", tone: "muted", caption };
  if (gpaInRange(numberOf(d.gpa), sc)) {
    const hint = d.scaleOverride ? `Using a ${SCALE_LABELS[sc]}.` : `Looks like a ${SCALE_LABELS[sc]}. Change it if that's wrong.`;
    return { ok: true, hint, tone: "muted", caption };
  }
  const hint = sc === "100" ? "On a 100-point scale, enter a number like 92.5. Over 100 is fine." : `On a ${SCALE_LABELS[sc]}, GPA goes up to ${sc}.`;
  return { ok: false, hint, tone: "amber", caption };
}

/**
 * The weighted-GPA field reads like the unweighted one (owner, 2026-10-12: "it doesn't use the same format as the
 * non-weighted where it calculates the scale based on what's entered"): the scale is detected from what's typed
 * (`detectScale`) and shown the same way ("Looks like a …"), but a weighted value is never flagged for running
 * above its scale's top — weighting runs higher by design (a 4.0 school's weighted 4.6; a 100-point school's
 * 104.3). Empty is valid; the field is optional.
 */
export function weightedGpaCheck(weightedGpa: string): { ok: boolean; hint: string; tone: "muted" | "amber" } {
  const empty = weightedGpa.trim() === "";
  if (empty) return { ok: true, hint: "Many schools weight honors and AP grades; if yours does, add it.", tone: "muted" };
  const n = numberOf(weightedGpa);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, hint: "Enter a number, like 4.4 or 104.3.", tone: "amber" };
  return { ok: true, hint: `Looks like a ${scaleLabel(detectScale(weightedGpa))}.`, tone: "muted" };
}

/* ------------------------------------------------------------------ */
/* Step 2: test                                                        */
/* ------------------------------------------------------------------ */

const SCORE_RANGE = { sat: [400, 1600], act: [1, 36] } as const;
const RANGE_HINT = { sat: "SAT scores run from 400 to 1600.", act: "ACT scores run from 1 to 36." } as const;

/** A typed whole number, or null. */
function intOf(s: string): number | null {
  const t = s.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

function inRange(test: "sat" | "act", n: number | null): n is number {
  return n !== null && n >= SCORE_RANGE[test][0] && n <= SCORE_RANGE[test][1];
}

/** The score field: valid when a whole number in the test's range. The hint is the range message on an error. */
export function scoreCheck(test: "sat" | "act", score: string): { ok: boolean; hint: string | null } {
  const ok = inRange(test, intOf(score));
  if (ok || score.trim() === "") return { ok, hint: "Your best single sitting." };
  return { ok: false, hint: RANGE_HINT[test] };
}

/**
 * The optional target score: empty is fine (no hint); out of range blocks Continue (amber); at or below the current
 * score is allowed with a note; above it says what the Scores tab will show.
 */
export function targetCheck(test: "sat" | "act", score: string, target: string): { ok: boolean; hint: string | null; tone: "muted" | "amber" } {
  if (target.trim() === "") return { ok: true, hint: null, tone: "muted" };
  const t = intOf(target);
  if (!inRange(test, t)) return { ok: false, hint: RANGE_HINT[test], tone: "amber" };
  const n = intOf(score);
  if (n !== null && t <= n) return { ok: true, hint: "That's at or below your current score.", tone: "muted" };
  return { ok: true, hint: `We'll show which colleges a ${t} would move.`, tone: "muted" };
}

/** Whether a step lets the student continue. The review step needs the first two; AP courses and the activity steps never block. */
export function stepValid(d: IntakeDraft, step: IntakeStep): boolean {
  if (step === 0) return d.classYear !== null && gpaCheck(d).ok;
  if (step === 1) {
    if (d.test === null) return false;
    if (d.test === "none") return true;
    return scoreCheck(d.test, d.score).ok && targetCheck(d.test, d.score, d.target).ok;
  }
  if (step === INTAKE_REVIEW) return stepValid(d, 0) && stepValid(d, 1);
  return true;
}

/* ------------------------------------------------------------------ */
/* Step 3: AP courses                                                  */
/* ------------------------------------------------------------------ */

const yy = (y: number) => String(y % 100).padStart(2, "0");

const GRADE_LABEL: Readonly<Record<9 | 10 | 11 | 12, string>> = { 9: "Freshman", 10: "Sophomore", 11: "Junior", 12: "Senior" };

/** The calendar year a high-school year's school year starts in, for a class graduating in `classYear` (12th grade starts the year before graduation). */
export function yearStart(year: 9 | 10 | 11 | 12, classYear: number): number {
  return classYear - 13 + year;
}

/** Whether a picked year's school year is already over, the current one, or still ahead (owner feedback, 2026-10-11: "just the years should be fine"; status follows from the year picked and today, never typed separately). */
export function yearStatus(year: 9 | 10 | 11 | 12, classYear: number, today: string): CourseStatus {
  const start = yearStart(year, classYear);
  const now = schoolYearStart(today);
  if (start < now) return "taken";
  if (start === now) return "in_progress";
  return "planned";
}

export interface YearOption {
  year: 9 | 10 | 11 | 12;
  label: string;
  /** The school year under the label ("24–25"), or null without a class year ("show the four chips with grade names only"). */
  sub: string | null;
}

/** The four "Which year?" chips: Freshman/Sophomore/Junior/Senior, each with its school year once a class is picked. */
export function yearOptions(classYear: number | null): YearOption[] {
  return ([9, 10, 11, 12] as const).map((year) => ({
    year,
    label: GRADE_LABEL[year],
    sub: classYear === null ? null : `${yy(yearStart(year, classYear))}–${yy(yearStart(year, classYear) + 1)}`,
  }));
}

/**
 * The pill in a course card's header: "Junior · Score 4", "Sophomore · Score pending" (a past year), "Senior year" (a
 * future one), "Taking now" (this year), or "Choose" (incomplete). A guardian sees and picks scores like the student.
 */
export function courseSummary(c: IntakeCourse, classYear: number, today: string): { text: string; incomplete: boolean } {
  if (c.year === null) return { text: "Choose", incomplete: true };
  const label = GRADE_LABEL[c.year];
  const status = yearStatus(c.year, classYear, today);
  if (status === "planned") return { text: `${label} year`, incomplete: false };
  if (status === "in_progress") return { text: "Taking now", incomplete: false };
  if (c.exam) return { text: `${label} · Score ${c.exam === "pending" ? "pending" : c.exam}`, incomplete: false };
  return { text: "Choose", incomplete: true };
}

/** The exam chips, in the design's order ("pending" reads "Not back yet"). */
export const INTAKE_EXAMS: readonly IntakeExam[] = ["5", "4", "3", "2", "1", "pending"];

/** The design's short names where they differ from the catalog's (catalog name without "AP " otherwise). */
const SHORT_NAMES: Readonly<Record<string, string>> = {
  ap_english_language: "English Language",
  ap_english_literature: "English Literature",
  ap_comparative_government: "Comparative Government",
  ap_us_government: "US Government",
  ap_us_history: "US History",
  ap_world_history_modern: "World History",
  ap_physics_1: "Physics 1",
  ap_physics_2: "Physics 2",
  ap_physics_c_electricity_and_magnetism: "Physics C: E&M",
  ap_chinese: "Chinese",
  ap_french: "French",
  ap_german: "German",
  ap_italian: "Italian",
  ap_japanese: "Japanese",
  ap_spanish_language: "Spanish Language",
  ap_spanish_literature: "Spanish Literature",
};

/**
 * The names students actually type for each course ("lit", "apush", "bio", "calc", "e&m"), matched before anything
 * else so a nickname finds its course without the full word. Kept here rather than in the catalog file: several are
 * shared ("calc", "gov", "physics" name two or more courses), and the catalog's aliases map a school profile's printed
 * name to one course (apKeysForName), which these must never do. Written already normalized (`normalizeQuery`).
 */
const NICKNAMES: Readonly<Record<string, readonly string[]>> = {
  ap_us_history: ["apush", "ush", "us hist", "american history", "history"],
  ap_us_government: ["gov", "govt", "apgov", "us gov", "civics", "politics"],
  ap_comparative_government: ["comp gov", "compgov", "gov", "govt", "politics"],
  ap_calculus_ab: ["calc", "calc ab", "ab calc", "math"],
  ap_calculus_bc: ["calc", "calc bc", "bc calc", "math"],
  ap_precalculus: ["precalc", "pre calc", "math"],
  ap_statistics: ["stats", "stat", "math"],
  ap_english_language: ["lang", "eng lang", "english lang", "aplang", "english"],
  ap_english_literature: ["lit", "eng lit", "english lit", "aplit", "english"],
  ap_computer_science_principles: ["csp", "cs", "cs principles", "comp sci", "computer science"],
  ap_computer_science_a: ["csa", "cs", "cs a", "java", "comp sci", "computer science"],
  ap_cybersecurity: ["cyber"],
  ap_european_history: ["euro", "apeuro", "history"],
  ap_human_geography: ["hug", "aphug", "hgap", "geo", "geography"],
  ap_world_history_modern: ["whap", "apwh", "world", "history"],
  ap_african_american_studies: ["afam", "aas"],
  ap_environmental_science: ["apes", "enviro", "es", "science"],
  ap_psychology: ["psych", "appsych"],
  ap_biology: ["bio", "apbio", "science"],
  ap_chemistry: ["chem", "apchem", "science"],
  ap_physics_1: ["phys 1", "p1", "physics", "physics 1", "science"],
  ap_physics_2: ["phys 2", "p2", "physics", "physics 2", "science"],
  ap_physics_c_mechanics: ["mech", "phys c", "physics c", "physics", "science"],
  ap_physics_c_electricity_and_magnetism: ["e&m", "em", "phys c", "physics c", "physics", "science"],
  ap_macroeconomics: ["macro", "econ", "economics"],
  ap_microeconomics: ["micro", "econ", "economics"],
  ap_art_history: ["art hist", "arth", "art"],
  ap_music_theory: ["music"],
  ap_2d_art_and_design: ["2d", "2d art", "studio art", "photo", "photography", "art"],
  ap_3d_art_and_design: ["3d", "3d art", "studio art", "sculpture", "art"],
  ap_drawing: ["draw", "studio art", "art"],
  ap_spanish_language: ["spanish", "span", "span lang", "spanish lang"],
  ap_spanish_literature: ["span lit", "spanish lit"],
  ap_chinese: ["mandarin"],
  ap_seminar: ["capstone"],
  ap_research: ["capstone"],
  ap_business_personal_finance: ["business", "finance", "personal finance"],
};

/** Lowercase, "AP " dropped from the front, punctuation other than & read as a space ("Physics C: E&M" → "physics c e&m"). */
function normalizeQuery(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .trim()
    .replace(/^ap\s+/, "")
    .replace(/\s+/g, " ");
}

/** "Calculus AB" (the UI shows "AP Calculus AB"); the key itself for one that isn't in the catalog. */
export function apName(key: string): string {
  if (SHORT_NAMES[key]) return SHORT_NAMES[key];
  const name = catalogCourse(key)?.name;
  return name ? name.replace(/^AP\s+/, "") : key;
}

/** The popular courses the picker offers before anything is typed, in the design's order; the first 8 show. */
const POPULAR_POOL: readonly string[] = [
  "ap_english_language",
  "ap_us_history",
  "ap_calculus_ab",
  "ap_psychology",
  "ap_biology",
  "ap_statistics",
  "ap_human_geography",
  "ap_environmental_science",
  "ap_world_history_modern",
  "ap_chemistry",
  "ap_precalculus",
  "ap_computer_science_principles",
];
export const POPULAR_AP: readonly string[] = POPULAR_POOL.slice(0, 8);

const SEARCH_INDEX: { key: string; name: string; nicknames: readonly string[]; words: string[] }[] = apCourses()
  .map((c) => {
    const name = apName(c.key);
    const words = normalizeQuery([name, c.name, ...(c.aliases ?? [])].join(" ")).split(" ");
    return { key: c.key, name, nicknames: NICKNAMES[c.key] ?? [], words: [...new Set(words)] };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * How well a course matches a normalized query, best first, or null for no match: 0 a nickname exactly ("lit"), 1 a
 * nickname that starts with it ("calc" for "cal"), 2 every word of the query starting a word of the course's names
 * ("eng lit", "human geo"). Never the middle of a word, so "lit" doesn't find "Politics".
 */
function matchRank(c: (typeof SEARCH_INDEX)[number], q: string): number | null {
  if (c.nicknames.includes(q)) return 0;
  if (c.nicknames.some((n) => n.startsWith(q))) return 1;
  const parts = q.split(" ");
  if (parts.every((p) => c.words.some((w) => w.startsWith(p)))) return 2;
  return null;
}

/**
 * The picker's chips: with no query, the popular courses (later ones fill in as earlier ones are added), up to 8;
 * with one, the courses it names (matchRank), best match first, then popular courses, then A–Z, up to 10. Courses in
 * `exclude` never appear.
 */
export function searchAp(query: string, exclude: readonly string[], limit?: number): { key: string; name: string }[] {
  const q = normalizeQuery(query);
  const skip = new Set(exclude);
  if (!q) {
    return POPULAR_POOL.filter((k) => !skip.has(k))
      .slice(0, limit ?? 8)
      .map((key) => ({ key, name: apName(key) }));
  }
  const popular = (key: string) => {
    const i = POPULAR_POOL.indexOf(key);
    return i === -1 ? POPULAR_POOL.length : i;
  };
  return SEARCH_INDEX.flatMap((c) => {
    if (skip.has(c.key)) return [];
    const rank = matchRank(c, q);
    return rank === null ? [] : [{ c, rank }];
  })
    .sort((a, b) => a.rank - b.rank || popular(a.c.key) - popular(b.c.key) || a.c.name.localeCompare(b.c.name))
    .slice(0, limit ?? 10)
    .map(({ c }) => ({ key: c.key, name: c.name }));
}

/** A course just added from the picker: open, nothing chosen yet. */
export function newIntakeCourse(key: string): IntakeCourse {
  return { id: newCourseId(), key, year: null, exam: null };
}

/* ------------------------------------------------------------------ */
/* Connections (specs/planner/v3/connections.md)                       */
/* ------------------------------------------------------------------ */

let connectionCounter = 0;
/** A fresh connection row id. */
function newConnectionId(): string {
  connectionCounter += 1;
  return `connection-${Date.now().toString(36)}${connectionCounter}`;
}

/** A college just added on the Connections step: nothing picked yet (a card with nothing picked isn't saved). */
export function newIntakeConnection(unitId: string): ConnectionEntry {
  return { id: newConnectionId(), unitId, family: [], recruited: "none" };
}

/* ------------------------------------------------------------------ */
/* Profile ↔ draft                                                     */
/* ------------------------------------------------------------------ */

/** The rows the intake owns: AP courses with a catalog key. IB, dual, honors, regular, and unnamed rows are kept as they are. */
const isIntakeRow = (c: CourseEntry) => c.kind === "ap" && c.key !== null && isCatalogKeyFor("ap", c.key);

/** A saved AP row as the intake shows it. A course in progress or planned gets its school year's term chip. */
/** A saved AP row as the intake shows it: its year directly (`CourseEntry.year` is already 9–12), and its score once taken. */
function intakeCourseFrom(c: CourseEntry): IntakeCourse {
  return { id: c.id, key: c.key!, year: c.year, exam: c.status === "taken" ? (c.exam ? (String(c.exam) as IntakeExam) : "pending") : null };
}

function trimNumber(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * The draft the guide opens on: the saved numbers and AP courses (edit mode), or an empty draft. A GPA above 4.0 saved
 * on the 4.0 scale is weighted by definition (isWeightedGpa) and opens on the detected 5.0 weighted scale.
 */
export function draftFromProfile(profile: StudentProfileData | null, gradYear: number | null, today: string): IntakeDraft {
  void today;
  const empty: IntakeDraft = {
    classYear: gradYear,
    gpa: "",
    scaleOverride: null,
    weightedGpa: "",
    classStanding: null,
    classRankPercentile: null,
    rankExpectation: null,
    test: null,
    score: "",
    practice: false,
    target: "",
    highSchool: null,
    highSchoolId: null,
    courses: [],
    activities: [],
    awards: [],
    connections: [],
    activitiesNone: {},
  };
  if (!profile) return empty;
  const a = profile.academics;
  const t = profile.tests;
  const gpa = a.gpa === null ? "" : trimNumber(a.gpa);
  const detected = detectScale(gpa);
  const weighted4 = a.gpaScale === "4.0" && a.gpa !== null && a.gpa > 4;
  const scaleOverride = a.gpa === null || weighted4 || a.gpaScale === detected ? null : a.gpaScale;
  const test: IntakeTest | null = t.focus ?? planTest(profile)?.kind ?? null;
  const score = test === "sat" ? t.satTotal : test === "act" ? t.actComposite : null;
  return {
    classYear: gradYear,
    gpa,
    scaleOverride,
    weightedGpa: a.weightedGpa === null ? "" : trimNumber(a.weightedGpa),
    // A stored "no_rank" (from before the question was reworded, owner 2026-10-12) reads as unanswered, like
    // sanitizeClassStanding treats it everywhere else.
    classStanding: a.classStanding === "no_rank" ? null : a.classStanding,
    classRankPercentile: a.classStanding === "no_rank" ? null : a.classRankPercentile,
    rankExpectation: a.rankExpectation,
    test,
    score: score === null ? "" : String(score),
    practice: test !== "none" && t.practice,
    target: test !== "none" && t.target !== null ? String(t.target) : "",
    highSchool: profile.basics.highSchool,
    highSchoolId: profile.basics.highSchoolId,
    courses: a.courses.filter(isIntakeRow).map(intakeCourseFrom),
    activities: a.activities,
    awards: a.awards,
    connections: a.connections,
    activitiesNone: a.activitiesNone ?? {},
  };
}

/** Class-standing labels for the review line (components/me/ClassStandingPick.tsx's own words, kept in step). */
const CLASS_STANDING_LABELS: Readonly<Record<ClassStanding, string>> = {
  top1: "Top 1%",
  top5: "Top 5%",
  top10: "Top 10%",
  top25: "Top quarter",
  top50: "Top half",
  lower: "Lower half",
  no_rank: "Doesn't rank",
};

const RANK_EXPECTATION_LABELS: Readonly<Record<RankExpectation, string>> = { valedictorian: "Valedictorian", salutatorian: "Salutatorian" };

/**
 * The Connections review line (specs/planner/v3/connections.md "Adding one"): "Duke (parent, grandparent), Michigan
 * (sibling), Elon (recruited)", "None" when answered with nothing, or "Not set" when not answered at all. `names`
 * maps a unit id to its display name (the caller passes the ones it has; an unknown id falls back to the id itself).
 */
function connectionsReviewValue(connections: readonly ConnectionEntry[], none: boolean, names: Record<string, string>): string {
  if (connections.length === 0) return none ? "None" : "Not set";
  return connections
    .map((c) => {
      const parts: string[] = [...c.family];
      if (c.recruited !== "none") parts.push("recruited");
      return `${names[c.unitId] ?? c.unitId} (${parts.join(", ")})`;
    })
    .join(", ");
}

/** The review card's rows: label, value, and the step its Edit link opens. `names` maps a connection's unit id to its display name. */
export function reviewLines(d: IntakeDraft, today: string, names: Record<string, string> = {}): { step: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; label: string; value: string }[] {
  const test = d.test;
  let testValue = "Not set";
  if (test === "none") testValue = "Not testing";
  else if (test) {
    const t = targetCheck(test, d.score, d.target);
    const aiming = d.target.trim() !== "" && t.ok ? ` · aiming for ${intOf(d.target)}` : "";
    testValue = `${test.toUpperCase()} ${d.score.trim()}${d.practice ? " (practice)" : ""}${aiming}`;
  }
  const classYear = d.classYear ?? Number(today.slice(0, 4));
  return [
    { step: 0, label: "Class", value: d.classYear === null ? "Not set" : `Class of ${d.classYear}` },
    { step: 0, label: "GPA", value: d.gpa.trim() === "" ? "Not set" : `${d.gpa.trim()} · ${scaleLabel(effectiveScale(d))}` },
    { step: 0, label: "Weighted GPA", value: d.weightedGpa.trim() === "" ? "Not set" : `${d.weightedGpa.trim()} weighted` },
    { step: 0, label: "Class standing", value: d.classStanding ? CLASS_STANDING_LABELS[d.classStanding] : "Not set" },
    { step: 0, label: "Rank expectation", value: d.rankExpectation ? RANK_EXPECTATION_LABELS[d.rankExpectation] : "None" },
    { step: 0, label: "School", value: d.highSchool ?? "Not set" },
    { step: 1, label: "Test", value: testValue },
    { step: 2, label: "AP courses", value: courseCount(d.courses, classYear, today) ?? "None" },
    { step: 3, label: "Sports", value: stepReviewValue("sports", d.activities, d.awards, d.activitiesNone.sports === true) },
    { step: 4, label: "Clubs", value: stepReviewValue("clubs", d.activities, d.awards, d.activitiesNone.clubs === true) },
    { step: 5, label: "Work", value: stepReviewValue("work", d.activities, d.awards, d.activitiesNone.work === true) },
    { step: 6, label: "Connections", value: connectionsReviewValue(d.connections, d.activitiesNone.connections === true, names) },
    { step: 7, label: "Other", value: stepReviewValue("other", d.activities, d.awards, d.activitiesNone.other === true) },
  ];
}

/** "2 taken · 1 taking or planned" (status derived from each course's year), or null with no courses chosen. */
export function courseCount(courses: readonly IntakeCourse[], classYear: number, today: string): string | null {
  if (courses.length === 0) return null;
  const chosen = courses.filter((c): c is IntakeCourse & { year: 9 | 10 | 11 | 12 } => c.year !== null);
  const taken = chosen.filter((c) => yearStatus(c.year, classYear, today) === "taken").length;
  const rest = chosen.length - taken;
  return `${taken} taken · ${rest} taking or planned`;
}

/**
 * Connections whose unit id is at least validly formatted (lib/follow-state.ts isUnitId); this module has no
 * dataset access to check a college actually exists — the step's own search only ever offers real ones, so this
 * just keeps a tampered or malformed id from being stored as a connection.
 */
function sanitizeIntakeConnections(input: unknown): ConnectionEntry[] {
  const rows = Array.isArray(input) ? input.filter((c) => isUnitId((c as { unitId?: unknown } | null | undefined)?.unitId)) : input;
  return sanitizeConnections(rows);
}

/**
 * The Connections step's "None" (connections.md "A card with nothing picked isn't saved"), reconciled the way the
 * four activity steps' own None is (owner, 2026-10-12): kept only while there are no connections entered; adding
 * one clears it.
 */
function reconcileConnectionsNone(rawNone: ActivitiesNone, connectionsCount: number, base: ActivitiesNone): ActivitiesNone {
  return rawNone.connections && connectionsCount === 0 ? { ...base, connections: true } : base;
}

/** The draft as a save, or null when the grades or test step isn't valid. Courses with nothing chosen are left out. */
export function intakeToSave(d: IntakeDraft): IntakeSave | null {
  if (!stepValid(d, 0) || !stepValid(d, 1) || d.classYear === null || d.test === null) return null;
  const testing = d.test !== "none";
  const weightedGpa = d.weightedGpa.trim() === "" ? null : numberOf(d.weightedGpa);
  const connections = sanitizeIntakeConnections(d.connections);
  return {
    classYear: d.classYear,
    gpa: numberOf(d.gpa),
    gpaScale: effectiveScale(d),
    // Optional, never blocking: an out-of-range weighted GPA is just dropped, like a bad high-school id elsewhere.
    weightedGpa: weightedGpa !== null && Number.isFinite(weightedGpa) && weightedGpa >= 0 && weightedGpa <= 120 ? weightedGpa : null,
    classStanding: d.classStanding,
    classRankPercentile: d.classRankPercentile,
    rankExpectation: d.rankExpectation,
    focus: d.test,
    score: testing ? intOf(d.score) : null,
    practice: testing && d.practice,
    target: testing && d.target.trim() !== "" ? intOf(d.target) : null,
    highSchool: d.highSchool && d.highSchool.trim() !== "" ? d.highSchool.trim() : null,
    highSchoolId: d.highSchoolId,
    courses: d.courses.filter((c) => c.year !== null).map((c) => ({ id: c.id, key: c.key, year: c.year, exam: c.exam })),
    activities: sanitizeActivities(d.activities),
    awards: sanitizeAwards(d.awards),
    connections,
    // A step with entries can't also be "None" (adding an entry clears it); same rule for Connections.
    activitiesNone: reconcileConnectionsNone(d.activitiesNone, connections.length, reconcileStepNone(d.activities, d.awards, d.activitiesNone)),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const EXAMS: readonly string[] = ["1", "2", "3", "4", "5", "pending"];
const YEARS: readonly number[] = [9, 10, 11, 12];

/** A trimmed, length-checked string, or null (student-profile.ts's own sanitizer does the same for `basics.highSchool`). */
function trimmedOrNull(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= maxLen ? s : null;
}

function parseCourse(v: unknown): IntakeCourse | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== "string" || v.id.trim() === "" || v.id.trim().length > 40) return null;
  if (typeof v.key !== "string" || !isCatalogKeyFor("ap", v.key)) return null;
  const year = v.year === null || v.year === undefined ? null : v.year;
  if (year !== null && (typeof year !== "number" || !YEARS.includes(year))) return null;
  const exam = v.exam === null || v.exam === undefined ? null : v.exam;
  if (exam !== null && (typeof exam !== "string" || !EXAMS.includes(exam))) return null;
  return { id: v.id.trim(), key: v.key, year: year as 9 | 10 | 11 | 12 | null, exam: exam as IntakeExam | null };
}

/**
 * The server's check of what the browser sent: null (refused) when anything is off — a class year outside the
 * profile's window, a GPA outside its scale's range, a score missing or out of range for the test, a target out of
 * range or without a test, a high school id that isn't one, a course that isn't an AP catalog course, an unknown
 * exam or year, a course listed twice.
 */
export function parseIntakeSave(input: unknown): IntakeSave | null {
  if (!isObj(input)) return null;
  const classYear = input.classYear;
  if (typeof classYear !== "number" || !Number.isInteger(classYear) || classYear < GRAD_YEAR_MIN || classYear > GRAD_YEAR_MAX) return null;
  const gpaScale = input.gpaScale;
  if (gpaScale !== "100" && gpaScale !== "4.0" && gpaScale !== "5.0") return null;
  let gpa: number | null = null;
  if (input.gpa !== null && input.gpa !== undefined) {
    if (typeof input.gpa !== "number" || !gpaInRange(input.gpa, gpaScale)) return null;
    gpa = input.gpa;
  }
  let weightedGpa: number | null = null;
  if (input.weightedGpa !== null && input.weightedGpa !== undefined) {
    if (typeof input.weightedGpa !== "number" || input.weightedGpa < 0 || input.weightedGpa > 120) return null;
    weightedGpa = input.weightedGpa;
  }
  // An unrecognized pick (including a stored "no_rank" from before the question was reworded) reads as unanswered
  // rather than refusing the whole save — matches sanitizeClassStanding's own leniency.
  let classStanding: ClassStanding | null = null;
  if (input.classStanding !== null && input.classStanding !== undefined && isClassStanding(input.classStanding)) {
    classStanding = input.classStanding;
  }
  let classRankPercentile: number | null = null;
  if (input.classRankPercentile !== null && input.classRankPercentile !== undefined) {
    if (typeof input.classRankPercentile !== "number" || !Number.isInteger(input.classRankPercentile) || input.classRankPercentile < 1 || input.classRankPercentile > 100) return null;
    classRankPercentile = input.classRankPercentile;
  }
  let rankExpectation: RankExpectation | null = null;
  if (input.rankExpectation !== null && input.rankExpectation !== undefined) {
    if (!isRankExpectation(input.rankExpectation)) return null;
    rankExpectation = input.rankExpectation;
  }
  const focus = input.focus;
  if (focus !== "sat" && focus !== "act" && focus !== "none") return null;
  let score: number | null = null;
  let target: number | null = null;
  if (focus === "none") {
    if ((input.score ?? null) !== null || (input.target ?? null) !== null) return null;
  } else {
    if (typeof input.score !== "number" || !Number.isInteger(input.score) || !inRange(focus, input.score)) return null;
    score = input.score;
    if (input.target !== null && input.target !== undefined) {
      if (typeof input.target !== "number" || !Number.isInteger(input.target) || !inRange(focus, input.target)) return null;
      target = input.target;
    }
  }
  if (input.practice !== undefined && typeof input.practice !== "boolean") return null;
  const practice = focus !== "none" && input.practice === true;
  const highSchool = trimmedOrNull(input.highSchool ?? null, 200);
  let highSchoolId: string | null = null;
  if (input.highSchoolId !== null && input.highSchoolId !== undefined) {
    if (typeof input.highSchoolId !== "string" || !isHighSchoolId(input.highSchoolId)) return null;
    highSchoolId = input.highSchoolId;
  }
  if (!Array.isArray(input.courses) || input.courses.length > COURSES_MAX) return null;
  const courses: IntakeCourse[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const raw of input.courses) {
    const c = parseCourse(raw);
    if (!c || keys.has(c.key) || ids.has(c.id)) return null;
    keys.add(c.key);
    ids.add(c.id);
    courses.push(c);
  }
  const activities = sanitizeActivities(input.activities);
  const awards = sanitizeAwards(input.awards);
  const connections = sanitizeIntakeConnections(input.connections);
  const rawNone = sanitizeActivitiesNone(input.activitiesNone);
  const activitiesNone = reconcileConnectionsNone(rawNone, connections.length, reconcileStepNone(activities, awards, rawNone));
  return { classYear, gpa, gpaScale, weightedGpa, classStanding, classRankPercentile, rankExpectation, focus, score, practice, target, highSchool, highSchoolId, courses, activities, awards, connections, activitiesNone };
}

/** The draft course a saved row would open as; an unchanged course keeps its saved row as it is. */
function sameAsSaved(c: IntakeCourse, saved: CourseEntry): boolean {
  const was = intakeCourseFrom(saved);
  return was.key === c.key && was.year === c.year && was.exam === c.exam;
}

/** One intake course as a CourseEntry (intake.md "AP courses"): the picked year directly, status derived from it. */
function entryFor(c: IntakeCourse & { year: 9 | 10 | 11 | 12 }, saved: CourseEntry | undefined, classYear: number, today: string): CourseEntry {
  if (saved && sameAsSaved(c, saved)) return saved;
  const base: CourseEntry = saved
    ? { ...saved, key: c.key }
    : { id: c.id, kind: "ap", key: c.key, name: null, subject: catalogCourse(c.key)?.subject ?? "other", year: c.year, status: "taken", grades: { s1: null, s2: null, final: null }, exam: null };
  const status = yearStatus(c.year, classYear, today);
  const exam = status === "taken" && c.exam && c.exam !== "pending" ? (Number(c.exam) as CourseEntry["exam"]) : null;
  return { ...base, id: c.id, year: c.year, status, exam, term: null };
}

/**
 * The profile with the intake applied: the class year, high school, GPA and scale, the focus test with its score,
 * practice flag, and target (the other test's score is kept), and the AP rows replaced by the intake's (a course
 * with no year picked is left out; an unchanged one keeps its saved row, grades and all). Rows the intake doesn't
 * show — IB, dual enrollment, honors, regular, and unnamed placeholders — are kept untouched. A guardian's save
 * still goes through mergeCoursesForSave (store-plan.ts saveIntake) so a private saved score survives unless they
 * pick a new one.
 */
export function applyIntake(profile: StudentProfileData, s: IntakeSave, today: string): StudentProfileData {
  const saved = profile.academics.courses;
  const byId = new Map(saved.filter(isIntakeRow).map((c) => [c.id, c]));
  const byKey = new Map(saved.filter(isIntakeRow).map((c) => [c.key!, c]));
  const mine = s.courses
    .filter((c): c is IntakeCourse & { year: 9 | 10 | 11 | 12 } => c.year !== null)
    .map((c) => {
      const was = byId.get(c.id) ?? byKey.get(c.key);
      return { was, entry: entryFor(c, was, s.classYear, today) };
    });
  // The saved order: each row where it was (an AP row the intake dropped is gone), new courses at the end.
  const replaced = new Map(mine.filter((m) => m.was).map((m) => [m.was!, m.entry]));
  const courses = [
    ...saved.flatMap((c) => (!isIntakeRow(c) ? [c] : replaced.has(c) ? [replaced.get(c)!] : [])),
    ...mine.filter((m) => !m.was).map((m) => m.entry),
  ];
  const tests = { ...profile.tests, focus: s.focus, practice: s.focus !== "none" && s.practice, target: s.focus === "none" ? null : s.target };
  if (s.focus === "sat" && s.score !== null) tests.satTotal = s.score;
  if (s.focus === "act" && s.score !== null) tests.actComposite = s.score;
  return sanitizeProfile({
    ...profile,
    basics: { ...profile.basics, gradYear: s.classYear, highSchool: s.highSchool, highSchoolId: s.highSchoolId },
    // courseRigorCount null: the count follows the list, never re-adds placeholder rows for removed courses.
    academics: {
      ...profile.academics,
      gpa: s.gpa,
      gpaScale: s.gpaScale,
      weightedGpa: s.weightedGpa,
      classStanding: s.classStanding,
      classRankPercentile: s.classRankPercentile,
      rankExpectation: s.rankExpectation,
      courses,
      courseRigorCount: null,
      activities: s.activities,
      awards: s.awards,
      // Plan v3: the Connections step now owns its own "None" key, reconciled in intakeToSave/parseIntakeSave.
      connections: s.connections,
      activitiesNone: s.activitiesNone,
    },
    tests,
  });
}

/**
 * Whether the plan shows the intake in place of the tabs (intake.md "When it shows"): the student has no grad year, or
 * neither a GPA nor a test choice yet. Never for a guardian's own list (no student).
 */
export function intakeNeeded(ctx: Pick<PlanContext, "profile" | "student">): boolean {
  if (!ctx.student) return false;
  if (ctx.student.grad_year === null) return true;
  const p = ctx.profile;
  return !p || (p.academics.gpa === null && p.tests.focus === null);
}
