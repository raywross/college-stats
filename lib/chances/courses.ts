/**
 * The course list's pure helpers (specs/chances/rigor-in-context.md "The student's courses"): names, defaults for a new
 * row, the core-subject answers resolved against the list, the You column of "What you'll need in high school", the
 * list grouped by year, and what a guardian may see or save. Pure and client-safe: no thresholds, no method (the
 * reading itself is server-only, rigor.ts). Relative imports so tests load it directly.
 */
import { catalogCourse } from "./catalog.ts";
import type { CourseEntry, CourseKind, CourseStatus, CourseSubject } from "./types.ts";
import {
  CORE_SUBJECT_KEYS,
  CORE_YEARS,
  isAdvancedKind,
  isPlaceholderCourse,
  type CoreAtTopLevel,
  type CoreSubject,
  type CoreYear,
} from "../student-profile.ts";

/** The first intended major's families that ask for regular math and science rows (major-and-grades.md "The student's side"). */
export const STEM_FAMILIES: readonly string[] = ["11", "14", "15", "27", "40", "26", "51"];

/** Whether the student's first intended major (two-digit families, most-interested first) is math- or science-heavy. */
export function isStemMajor(majors: readonly string[] | null | undefined): boolean {
  const first = majors?.[0];
  return first !== undefined && STEM_FAMILIES.includes(first.slice(0, 2));
}

export const KIND_LABELS: Record<CourseKind, string> = {
  ap: "AP",
  ib_hl: "IB HL",
  ib_sl: "IB SL",
  dual: "Dual enrollment",
  honors: "Honors",
  regular: "Regular",
};

export const SUBJECT_LABELS: Record<CourseSubject, string> = {
  english: "English",
  math: "Math",
  science: "Science",
  history: "History and social science",
  language: "World language",
  cs: "Computer science",
  arts: "Arts",
  other: "Other",
};

export const STATUS_LABELS: Record<CourseStatus, string> = { taken: "Taken", in_progress: "In progress", planned: "Planned" };

/** A course as the student sees it: the catalog's name, the name they typed, or "AP course (unnamed)" for a count-only row. */
export function courseName(c: Pick<CourseEntry, "kind" | "key" | "name">): string {
  if (c.key) {
    const entry = catalogCourse(c.key);
    if (entry) return entry.name;
  }
  if (c.name) return c.name;
  return isPlaceholderCourse(c) ? "AP course (not named yet)" : KIND_LABELS[c.kind];
}

/** The school year a graduating class is in, as a grade 9–12 (null outside high school), on a school year that turns over in August. */
export function gradeNow(gradYear: number | null | undefined, today: string): 9 | 10 | 11 | 12 | null {
  if (!gradYear) return null;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const endYear = m >= 8 ? y + 1 : y;
  const g = 12 - (gradYear - endYear);
  return g >= 9 && g <= 12 ? (g as 9 | 10 | 11 | 12) : null;
}

/** The year a new row opens on: the course's usual grade level at or after the student's grade (else its last usual one). */
export function usualYear(key: string | null, grade: number | null): CourseEntry["year"] {
  const usual = (key ? catalogCourse(key)?.grades : null) ?? [];
  const years = usual.filter((g): g is CourseEntry["year"] => g >= 9 && g <= 12);
  if (years.length === 0) return grade && grade >= 9 && grade <= 12 ? (grade as CourseEntry["year"]) : 11;
  if (grade === null) return years[0];
  return years.find((y) => y >= grade) ?? years[years.length - 1];
}

/** The status a row opens on: a past year is taken, this year in progress, a later one planned (taken when the grade is unknown). */
export function defaultStatus(year: number, grade: number | null): CourseStatus {
  if (grade === null) return "taken";
  return year < grade ? "taken" : year === grade ? "in_progress" : "planned";
}

let counter = 0;
/** A fresh row id. */
export function newCourseId(): string {
  counter += 1;
  return `c${Date.now().toString(36)}${counter}`;
}

/** A new row from the catalog (AP or IB) or typed (dual, honors, regular), with the year and status defaults. */
export function newCourse(input: { kind: CourseKind; key?: string | null; name?: string | null; subject?: CourseSubject; grade: number | null; year?: CourseEntry["year"] }): CourseEntry {
  const key = input.key ?? null;
  const entry = key ? catalogCourse(key) : null;
  const year = input.year ?? usualYear(key, input.grade);
  return {
    id: newCourseId(),
    kind: input.kind,
    key,
    name: key ? null : (input.name ?? null),
    subject: entry?.subject ?? input.subject ?? "other",
    year,
    status: defaultStatus(year, input.grade),
    grades: { s1: null, s2: null, final: null },
    exam: null,
  };
}

/** The list by year, oldest first, each year's rows in the order entered (advanced before honors and regular). */
export function groupByYear(courses: readonly CourseEntry[]): { year: CourseEntry["year"]; rows: CourseEntry[] }[] {
  const rank = (c: CourseEntry) => (isAdvancedKind(c.kind) ? 0 : c.kind === "honors" ? 1 : 2);
  return ([9, 10, 11, 12] as const)
    .map((year) => ({ year, rows: courses.filter((c) => c.year === year).sort((a, b) => rank(a) - rank(b)) }))
    .filter((g) => g.rows.length > 0);
}

/* ------------------------------------------------------------------ */
/* The core-subject question                                           */
/* ------------------------------------------------------------------ */

const isCoreSubject = (s: CourseSubject): s is CoreSubject => (CORE_SUBJECT_KEYS as readonly string[]).includes(s);

/** Whether the list has an AP, IB, or dual-enrollment course in the subject and year: what pre-checks a cell. */
export function listSuggests(courses: readonly CourseEntry[], year: CoreYear, subject: CoreSubject): boolean {
  return courses.some((c) => isAdvancedKind(c.kind) && c.year === year && c.subject === subject);
}

/** Every cell as the student sees it: their own answer when given, else what the list suggests. */
export function resolveCore(courses: readonly CourseEntry[], stored: CoreAtTopLevel): Record<CoreYear, Record<CoreSubject, boolean>> {
  const out = { 11: {}, 12: {} } as Record<CoreYear, Record<CoreSubject, boolean>>;
  for (const y of CORE_YEARS) for (const s of CORE_SUBJECT_KEYS) out[y][s] = stored[y][s] ?? listSuggests(courses, y, s);
  return out;
}

/** How many of the ten cells are checked (0–10). */
export function coreCount(courses: readonly CourseEntry[], stored: CoreAtTopLevel): number {
  const r = resolveCore(courses, stored);
  return CORE_YEARS.reduce((n, y) => n + CORE_SUBJECT_KEYS.filter((s) => r[y][s]).length, 0);
}

/* ------------------------------------------------------------------ */
/* The You column of "What you'll need in high school"                 */
/* ------------------------------------------------------------------ */

/** The CDS C5 subject rows (lib/cds/application-logistics-display.ts HS_SUBJECT_ROWS) a course subject can count toward. */
export const HS_ROW_SUBJECT: Readonly<Record<string, CoreSubject>> = {
  english: "english",
  math: "math",
  science: "science",
  foreign_language: "language",
  social_studies: "history",
  history: "history",
};

export interface YouYears {
  /** Years of the subject the list and the core answers can count, 9th through 12th grade. */
  years: number;
  /** How many of those are only planned. */
  planned: number;
}

/**
 * Years of a subject the student's list can count: each grade with a course in the subject, plus an 11th or 12th grade
 * year the student checked as the most advanced the school offered. A year whose only evidence is planned courses
 * counts as planned. Null when the list can't count the subject ("add your courses to compare"); the count is what
 * the list shows, never a claim that the student took nothing else.
 */
export function youYears(courses: readonly CourseEntry[], stored: CoreAtTopLevel, subject: CoreSubject): YouYears | null {
  const evidence = new Map<number, { firm: boolean }>();
  for (const c of courses) {
    if (c.subject !== subject) continue;
    const e = evidence.get(c.year) ?? { firm: false };
    if (c.status !== "planned") e.firm = true;
    evidence.set(c.year, e);
  }
  for (const y of CORE_YEARS) {
    if (stored[y][subject] === true) evidence.set(y, { firm: true });
  }
  if (evidence.size === 0) return null;
  return { years: evidence.size, planned: [...evidence.values()].filter((e) => !e.firm).length };
}

/** "3 (1 planned)" or "4". */
export function youText(y: YouYears): string {
  return y.planned > 0 ? `${y.years} (${y.planned} planned)` : String(y.years);
}

export { isCoreSubject };

/* ------------------------------------------------------------------ */
/* Who sees and saves what                                             */
/* ------------------------------------------------------------------ */

/**
 * A reading's sentence for a parent looking at a student's plan ("Maya has taken or planned 6 of their school's 14 AP
 * courses."): the catalog sentences are written to the student, so the pronouns change and nothing else does.
 */
export function thirdPerson(text: string, name: string | null): string {
  return text
    .replace(/\bYou've\b/g, name ? `${name} has` : "They've")
    .replace(/\byou've\b/g, "they've")
    .replace(/\bYour\b/g, name ? `${name}'s` : "Their")
    .replace(/\byour\b/g, "their")
    .replace(/\bYou\b/g, name ?? "They")
    .replace(/\byou\b/g, "they");
}

/** The list without AP exam scores: what a guardian sees while `apExamsPrivate` holds. */
export function withoutExams(courses: readonly CourseEntry[]): CourseEntry[] {
  return courses.map((c) => (c.exam === null ? c : { ...c, exam: null }));
}

/**
 * The list and privacy flag to save when `relation` edits a profile that already holds `saved`. A guardian never sees
 * exam scores while they are private, so what they post carries none: the saved scores are put back on the rows that
 * still exist, and a guardian can't flip the privacy switch. The student's own post is taken as sent.
 */
export function mergeCoursesForSave(
  saved: { courses: readonly CourseEntry[]; apExamsPrivate: boolean },
  incoming: { courses: readonly CourseEntry[]; apExamsPrivate: boolean },
  relation: "self" | "guardian",
): { courses: CourseEntry[]; apExamsPrivate: boolean } {
  if (relation === "self") return { courses: [...incoming.courses], apExamsPrivate: incoming.apExamsPrivate };
  if (!saved.apExamsPrivate) return { courses: [...incoming.courses], apExamsPrivate: false };
  const byId = new Map(saved.courses.map((c) => [c.id, c.exam]));
  return { courses: incoming.courses.map((c) => ({ ...c, exam: byId.get(c.id) ?? null })), apExamsPrivate: true };
}
