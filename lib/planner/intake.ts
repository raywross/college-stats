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
import type { CourseEntry, CourseTerm } from "../chances/types.ts";
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
export type IntakeCourseStatus = "took" | "plan";
export type IntakeExam = "1" | "2" | "3" | "4" | "5" | "pending";

export interface IntakeCourse {
  /** CourseEntry id (kept for existing rows so a guardian's merge finds them), a new id for new ones. */
  id: string;
  /** AP catalog key, e.g. "ap_calculus_ab". */
  key: string;
  status: IntakeCourseStatus | null;
  /** For "took": the exam score, or "pending" ("Not back yet"). */
  exam: IntakeExam | null;
  /** For "plan": a TermOption.value, e.g. "2026-27:full" | "2026-27:fall" | "2026-27:spring". */
  term: string | null;
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
  courses: IntakeCourse[];
}

export interface TermOption {
  value: string;
  label: string;
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

/** The grade a class is in now, unclamped (13 = graduated, 8 = not in high school yet). */
function rawGrade(classYear: number, today: string): number {
  return 12 - (classYear - (schoolYearStart(today) + 1));
}

const clampYear = (g: number): CourseEntry["year"] => Math.min(12, Math.max(9, g)) as CourseEntry["year"];

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

const TERM_RE = /^(\d{4})-(\d{2}):(full|fall|spring)$/;

/** A term value's parts, or null when it isn't one ("2026-27:fall" → { start: 2026, term: "fall" }). */
export function parseTermValue(value: string): { start: number; term: CourseTerm } | null {
  const m = TERM_RE.exec(value);
  if (!m) return null;
  const start = Number(m[1]);
  if (Number(m[2]) !== (start + 1) % 100) return null;
  return { start, term: m[3] as CourseTerm };
}

const yy = (y: number) => String(y % 100).padStart(2, "0");

/** The value for a school year starting in `start` and a term. */
export function termValue(start: number, term: CourseTerm): string {
  return `${start}-${yy(start + 1)}:${term}`;
}

/** "Full year" (this school year), "Full year 27–28", "Fall 2026", "Spring 2027"; "" for a value that isn't one. */
export function termLabel(value: string, today: string): string {
  const p = parseTermValue(value);
  if (!p) return "";
  if (p.term === "fall") return `Fall ${p.start}`;
  if (p.term === "spring") return `Spring ${p.start + 1}`;
  return p.start === schoolYearStart(today) ? "Full year" : `Full year ${yy(p.start)}–${yy(p.start + 1)}`;
}

/**
 * The "When?" chips: for each school year from this one until graduation, Full year, Fall, Spring. A class that
 * graduates this school year (or earlier) still gets this year's three.
 */
export function termOptions(classYear: number, today: string): TermOption[] {
  const first = schoolYearStart(today);
  const last = Math.max(first, classYear - 1);
  const out: TermOption[] = [];
  for (let y = first; y <= last; y++) {
    for (const term of ["full", "fall", "spring"] as const) {
      const value = termValue(y, term);
      out.push({ value, label: termLabel(value, today) });
    }
  }
  return out;
}

/** The pill in a course card's header: "Score 4", "Score pending", "Spring 2027", or "Choose" (incomplete). */
export function courseSummary(c: IntakeCourse, today: string, opts: { examsHidden?: boolean } = {}): { text: string; incomplete: boolean } {
  if (c.status === "took") {
    // A guardian who can't see the student's exam scores (apExamsPrivate) never chooses one.
    if (opts.examsHidden) return { text: "Score hidden", incomplete: false };
    if (c.exam) return { text: c.exam === "pending" ? "Score pending" : `Score ${c.exam}`, incomplete: false };
  }
  if (c.status === "plan" && c.term) {
    const label = termLabel(c.term, today);
    if (label) return { text: label, incomplete: false };
  }
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
  return { id: newCourseId(), key, status: null, exam: null, term: null };
}

/* ------------------------------------------------------------------ */
/* Profile ↔ draft                                                     */
/* ------------------------------------------------------------------ */

/** The rows the intake owns: AP courses with a catalog key. IB, dual, honors, regular, and unnamed rows are kept as they are. */
const isIntakeRow = (c: CourseEntry) => c.kind === "ap" && c.key !== null && isCatalogKeyFor("ap", c.key);

/** A saved AP row as the intake shows it. A course in progress or planned gets its school year's term chip. */
function intakeCourseFrom(c: CourseEntry, classYear: number | null): IntakeCourse {
  if (c.status === "taken") return { id: c.id, key: c.key!, status: "took", exam: c.exam ? (String(c.exam) as IntakeExam) : "pending", term: null };
  const term = classYear === null ? null : termValue(classYear - 13 + c.year, c.term ?? "full");
  return { id: c.id, key: c.key!, status: "plan", exam: null, term };
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
  const empty: IntakeDraft = { classYear: gradYear, gpa: "", scaleOverride: null, test: null, score: "", practice: false, target: "", courses: [] };
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
    courses: a.courses.filter(isIntakeRow).map((c) => intakeCourseFrom(c, gradYear)),
  };
}

/** The review card's rows: label, value, and the step its Edit link opens. */
export function reviewLines(d: IntakeDraft, today: string): { step: 0 | 1 | 2; label: string; value: string }[] {
  void today;
  const test = d.test;
  let testValue = "Not set";
  if (test === "none") testValue = "Not testing";
  else if (test) {
    const t = targetCheck(test, d.score, d.target);
    const aiming = d.target.trim() !== "" && t.ok ? ` · aiming for ${intOf(d.target)}` : "";
    testValue = `${test.toUpperCase()} ${d.score.trim()}${d.practice ? " (practice)" : ""}${aiming}`;
  }
  return [
    { step: 0, label: "Class", value: d.classYear === null ? "Not set" : `Class of ${d.classYear}` },
    { step: 0, label: "GPA", value: d.gpa.trim() === "" ? "Not set" : `${d.gpa.trim()} · ${scaleLabel(effectiveScale(d))}` },
    { step: 1, label: "Test", value: testValue },
    { step: 2, label: "AP courses", value: courseCount(d.courses) ?? "None" },
  ];
}

/** "2 taken · 1 taking or planned", or null with no courses. */
export function courseCount(courses: readonly IntakeCourse[]): string | null {
  if (courses.length === 0) return null;
  const took = courses.filter((c) => c.status === "took").length;
  const plan = courses.filter((c) => c.status === "plan").length;
  return `${took} taken · ${plan} taking or planned`;
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
    courses: d.courses.filter((c) => c.status !== null).map((c) => ({ id: c.id, key: c.key, status: c.status, exam: c.status === "took" ? c.exam : null, term: c.status === "plan" ? c.term : null })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const EXAMS: readonly string[] = ["1", "2", "3", "4", "5", "pending"];

function parseCourse(v: unknown): IntakeCourse | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== "string" || v.id.trim() === "" || v.id.trim().length > 40) return null;
  if (typeof v.key !== "string" || !isCatalogKeyFor("ap", v.key)) return null;
  const status = v.status === null || v.status === undefined ? null : v.status;
  if (status !== null && status !== "took" && status !== "plan") return null;
  const exam = v.exam === null || v.exam === undefined ? null : v.exam;
  if (exam !== null && (typeof exam !== "string" || !EXAMS.includes(exam))) return null;
  const term = v.term === null || v.term === undefined ? null : v.term;
  if (term !== null && (typeof term !== "string" || !parseTermValue(term))) return null;
  return { id: v.id.trim(), key: v.key, status, exam: status === "took" ? (exam as IntakeExam | null) : null, term: status === "plan" ? term : null };
}

/**
 * The server's check of what the browser sent: null (refused) when anything is off — a class year outside the
 * profile's window, a GPA outside its scale's range, a score missing or out of range for the test, a target out of
 * range or without a test, a course that isn't an AP catalog course, an unknown exam or term, a course listed twice.
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
  return { classYear, gpa, gpaScale, focus, score, practice, target, courses };
}

/** The draft course a saved row would open as; an unchanged course keeps its saved row as it is. */
function sameAsSaved(c: IntakeCourse, saved: CourseEntry, classYear: number): boolean {
  const was = intakeCourseFrom(saved, classYear);
  return was.key === c.key && was.status === c.status && was.exam === c.exam && was.term === c.term;
}

/** One intake course as a CourseEntry (intake.md "AP courses"), on top of its saved row when there is one. */
function entryFor(c: IntakeCourse & { status: IntakeCourseStatus }, saved: CourseEntry | undefined, classYear: number, today: string): CourseEntry {
  if (saved && sameAsSaved(c, saved, classYear)) return saved;
  const base: CourseEntry = saved
    ? { ...saved, key: c.key }
    : { id: c.id, kind: "ap", key: c.key, name: null, subject: catalogCourse(c.key)?.subject ?? "other", year: 11, status: "taken", grades: { s1: null, s2: null, final: null }, exam: null };
  const grade = rawGrade(classYear, today);
  if (c.status === "took") {
    // The most recently finished grade (9 for a student in 9th); a row that was already taken keeps its year.
    const year = saved?.status === "taken" ? saved.year : clampYear(grade - 1);
    const exam = c.exam && c.exam !== "pending" ? (Number(c.exam) as CourseEntry["exam"]) : null;
    return { ...base, id: c.id, year, status: "taken", exam, term: null };
  }
  const p = c.term ? parseTermValue(c.term) : null;
  const start = schoolYearStart(today);
  if (!p) return { ...base, id: c.id, year: clampYear(grade), status: "planned", exam: null, term: null };
  const year = clampYear(12 - (classYear - (p.start + 1)));
  return { ...base, id: c.id, year, status: p.start > start ? "planned" : "in_progress", exam: null, term: p.term };
}

/**
 * The profile with the intake applied: the class year, GPA and scale, the focus test with its score, practice flag,
 * and target (the other test's score is kept), and the AP rows replaced by the intake's (a course with nothing chosen
 * is left out; an unchanged one keeps its saved row, grades and all). Rows the intake doesn't show — IB, dual
 * enrollment, honors, regular, and unnamed placeholders — are kept untouched. A guardian's save still goes through
 * mergeCoursesForSave (store-plan.ts saveIntake) so private exam scores survive.
 */
export function applyIntake(profile: StudentProfileData, s: IntakeSave, today: string): StudentProfileData {
  const saved = profile.academics.courses;
  const byId = new Map(saved.filter(isIntakeRow).map((c) => [c.id, c]));
  const byKey = new Map(saved.filter(isIntakeRow).map((c) => [c.key!, c]));
  const mine = s.courses
    .filter((c): c is IntakeCourse & { status: IntakeCourseStatus } => c.status !== null)
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
    basics: { ...profile.basics, gradYear: s.classYear },
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
