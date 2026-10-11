/**
 * The Plan's intake guide (specs/planner/redesign/intake.md): four steps (grades, test, AP courses, review) and a
 * Done screen, saved once at the end. Everything the guide decides lives here: the class-year chips, GPA scale
 * detection and validation, the score and target checks, the AP search and its aliases, the "When?" term chips, the
 * draft read from a saved profile, and the profile the save writes. Ported from the design prototype's script (Plan
 * Redesign.dc.html). Pure (no server or browser APIs), so the intake's UI, the `saveIntake` Server Action, and tests
 * all run the same rules.
 */
import { apCourses, catalogCourse, isCatalogKeyFor } from "../chances/catalog.ts";
import { newCourseId } from "../chances/courses.ts";
import type { CourseEntry, CourseStatus } from "../chances/types.ts";
import { isHighSchoolId } from "../high-school-core.ts";
import {
  COURSES_MAX,
  GRAD_YEAR_MAX,
  GRAD_YEAR_MIN,
  planTest,
  sanitizeProfile,
  type GpaScale,
  type StudentProfileData,
  type TestFocus,
} from "../student-profile.ts";
import type { PlanContext } from "./types.ts";

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
  test: IntakeTest | null;
  score: string;
  practice: boolean;
  target: string;
  /** The picker's pick (student-profile.ts basics.highSchool/highSchoolId); optional. */
  highSchool: string | null;
  highSchoolId: string | null;
  courses: IntakeCourse[];
}

/** 0 grades, 1 test, 2 AP courses, 3 review, 4 done. */
export type IntakeStep = 0 | 1 | 2 | 3 | 4;

/** What `saveIntake` takes: the draft, checked and converted. */
export interface IntakeSave {
  classYear: number;
  gpa: number | null;
  gpaScale: GpaScale;
  focus: TestFocus;
  score: number | null;
  practice: boolean;
  target: number | null;
  highSchool: string | null;
  highSchoolId: string | null;
  courses: IntakeCourse[];
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

/** Whether a step lets the student continue. The review step needs the first two; AP courses never block. */
export function stepValid(d: IntakeDraft, step: IntakeStep): boolean {
  if (step === 0) return d.classYear !== null && gpaCheck(d).ok;
  if (step === 1) {
    if (d.test === null) return false;
    if (d.test === "none") return true;
    return scoreCheck(d.test, d.score).ok && targetCheck(d.test, d.score, d.target).ok;
  }
  if (step === 3) return stepValid(d, 0) && stepValid(d, 1);
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
 * future one), "Taking now" (this year), or "Choose" (incomplete). A guardian who can't see a private saved score
 * sees "Score saved (hidden)" instead of "Choose" once a past year is picked but nothing's chosen this session yet;
 * picking a score here replaces the saved one (`mergeCoursesForSave`).
 */
export function courseSummary(c: IntakeCourse, classYear: number, today: string, opts: { examsHidden?: boolean } = {}): { text: string; incomplete: boolean } {
  if (c.year === null) return { text: "Choose", incomplete: true };
  const label = GRADE_LABEL[c.year];
  const status = yearStatus(c.year, classYear, today);
  if (status === "planned") return { text: `${label} year`, incomplete: false };
  if (status === "in_progress") return { text: "Taking now", incomplete: false };
  if (c.exam) return { text: `${label} · Score ${c.exam === "pending" ? "pending" : c.exam}`, incomplete: false };
  if (opts.examsHidden) return { text: "Score saved (hidden)", incomplete: false };
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
 * Search words students type that the catalog's aliases don't carry (the design's list). Kept here rather than in the
 * catalog file: several are ambiguous ("calc", "gov", "physics" name two or more courses), and the catalog's aliases
 * map a school profile's printed name to one course (apKeysForName), which these must never do.
 */
const SEARCH_ALIASES: Readonly<Record<string, string>> = {
  ap_us_history: "apush ush",
  ap_us_government: "gov apgov",
  ap_calculus_ab: "calc",
  ap_calculus_bc: "calc",
  ap_english_language: "lang english",
  ap_english_literature: "lit english",
  ap_computer_science_principles: "csp cs",
  ap_computer_science_a: "csa cs",
  ap_european_history: "euro",
  ap_human_geography: "hug geo",
  ap_world_history_modern: "whap",
  ap_environmental_science: "apes enviro",
  ap_physics_c_electricity_and_magnetism: "physics",
  ap_physics_c_mechanics: "physics",
  ap_comparative_government: "gov",
};

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

const SEARCH_INDEX: { key: string; name: string; haystack: string }[] = apCourses()
  .map((c) => {
    const name = apName(c.key);
    return { key: c.key, name, haystack: [name, c.name, ...(c.aliases ?? []), SEARCH_ALIASES[c.key] ?? ""].join(" ").toLowerCase() };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * The picker's chips: with no query, the popular courses (later ones fill in as earlier ones are added), up to 8;
 * with one, every course whose name or aliases contain it, A–Z, up to 10. Courses in `exclude` never appear.
 */
export function searchAp(query: string, exclude: readonly string[], limit?: number): { key: string; name: string }[] {
  const q = query.trim().toLowerCase();
  const skip = new Set(exclude);
  if (!q) {
    return POPULAR_POOL.filter((k) => !skip.has(k))
      .slice(0, limit ?? 8)
      .map((key) => ({ key, name: apName(key) }));
  }
  return SEARCH_INDEX.filter((c) => !skip.has(c.key) && c.haystack.includes(q))
    .slice(0, limit ?? 10)
    .map(({ key, name }) => ({ key, name }));
}

/** A course just added from the picker: open, nothing chosen yet. */
export function newIntakeCourse(key: string): IntakeCourse {
  return { id: newCourseId(), key, year: null, exam: null };
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
    test: null,
    score: "",
    practice: false,
    target: "",
    highSchool: null,
    highSchoolId: null,
    courses: [],
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
    test,
    score: score === null ? "" : String(score),
    practice: test !== "none" && t.practice,
    target: test !== "none" && t.target !== null ? String(t.target) : "",
    highSchool: profile.basics.highSchool,
    highSchoolId: profile.basics.highSchoolId,
    courses: a.courses.filter(isIntakeRow).map(intakeCourseFrom),
  };
}

/** The review card's rows: label, value, and the step its Edit link opens. */
export function reviewLines(d: IntakeDraft, today: string): { step: 0 | 1 | 2; label: string; value: string }[] {
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
    { step: 0, label: "School", value: d.highSchool ?? "Not set" },
    { step: 1, label: "Test", value: testValue },
    { step: 2, label: "AP courses", value: courseCount(d.courses, classYear, today) ?? "None" },
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

/** The draft as a save, or null when the grades or test step isn't valid. Courses with nothing chosen are left out. */
export function intakeToSave(d: IntakeDraft): IntakeSave | null {
  if (!stepValid(d, 0) || !stepValid(d, 1) || d.classYear === null || d.test === null) return null;
  const testing = d.test !== "none";
  return {
    classYear: d.classYear,
    gpa: numberOf(d.gpa),
    gpaScale: effectiveScale(d),
    focus: d.test,
    score: testing ? intOf(d.score) : null,
    practice: testing && d.practice,
    target: testing && d.target.trim() !== "" ? intOf(d.target) : null,
    highSchool: d.highSchool && d.highSchool.trim() !== "" ? d.highSchool.trim() : null,
    highSchoolId: d.highSchoolId,
    courses: d.courses.filter((c) => c.year !== null).map((c) => ({ id: c.id, key: c.key, year: c.year, exam: c.exam })),
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
  return { classYear, gpa, gpaScale, focus, score, practice, target, highSchool, highSchoolId, courses };
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
    academics: { ...profile.academics, gpa: s.gpa, gpaScale: s.gpaScale, courses, courseRigorCount: null },
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
