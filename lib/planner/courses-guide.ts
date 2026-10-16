/**
 * The Choose next year's APs guide's own view of the course list (specs/planner/v3/guides/ap-choices.md "What
 * you've taken"): the list grouped by subject family, one cell per school year, so the guide can draw "Biology (H) →
 * Chemistry (H) → AP Chemistry (now) → ?". The suggestions, the guardrails, and the depth tracks stay where they are
 * (lib/chances/course-plan-view.ts, lib/chances/depth.ts); this file only reshapes `CourseEntry[]` for that one
 * table. Pure and client-safe: no server import, no I/O. Relative imports so tests load it directly.
 */
import { catalogCourse } from "../chances/catalog.ts";
import { gradeNow, SUBJECT_LABELS } from "../chances/courses.ts";
import { DEPTH_FAMILIES } from "../chances/depth.ts";
import type { CourseEntry, CourseKind, CourseStatus, CourseSubject } from "../chances/types.ts";
import { yearStatus } from "./intake.ts";

/** "Biology", "AP Chemistry", or the student's typed name — never the kind mark, which `kindMark` gives on its own. */
function rowCourseName(c: Pick<CourseEntry, "key" | "name" | "kind">): string {
  if (c.key) {
    const entry = catalogCourse(c.key);
    if (entry) return entry.name;
  }
  return c.name ?? "";
}

export interface CourseRowCourse {
  id: string;
  name: string;
  kind: CourseKind;
  /** Taken, in progress, or planned, worked out fresh from the year and today (`yearStatus`), never read off the saved row. */
  status: CourseStatus;
}

export interface CourseRowCell {
  year: 9 | 10 | 11 | 12;
  courses: CourseRowCourse[];
}

export interface CourseRow {
  family: CourseSubject;
  label: string;
  /** Only the years with a course in this family, oldest first. */
  cells: CourseRowCell[];
  /** The grade next year's courses are for (the guide's "?" slot), or null for a senior or without a class year. */
  nextYear: 10 | 11 | 12 | null;
}

/** "(H)" honors, "AP", "IB" (HL or SL), "DE" dual enrollment, "" regular — the mark the guide prints after a course's name. */
export function kindMark(kind: CourseKind): string {
  switch (kind) {
    case "honors":
      return "(H)";
    case "ap":
      return "AP";
    case "ib_hl":
    case "ib_sl":
      return "IB";
    case "dual":
      return "DE";
    case "regular":
      return "";
  }
}

/** The grade next year's courses are for, from the grade now (9th through 11th get one; a senior or an unknown grade gets none). */
function nextYearFrom(grade: number | null): 10 | 11 | 12 | null {
  return grade !== null && grade >= 9 && grade <= 11 ? ((grade + 1) as 10 | 11 | 12) : null;
}

/**
 * One row per subject family the student has a course in (specs/planner/v3/guides/ap-choices.md "What you've
 * taken"): the major's families first (`majorFamilies`, in the order given), then the rest in depth's order
 * (`DEPTH_FAMILIES`); each row's cells hold only the years with a course, so the guide's arrows draw the track as
 * it's actually run. Status is recomputed from the year and today (`yearStatus`), not read off the saved row, so it
 * never drifts from what was actually picked (intake.md "AP courses").
 */
export function courseRows(courses: readonly CourseEntry[], classYear: number | null, today: string, majorFamilies: readonly string[] = []): CourseRow[] {
  const grade = gradeNow(classYear, today);
  const nextYear = nextYearFrom(grade);
  const present = new Set(courses.map((c) => c.subject));
  const major = majorFamilies.filter((f): f is CourseSubject => (DEPTH_FAMILIES as readonly string[]).includes(f) && present.has(f as CourseSubject)) as CourseSubject[];
  const order: CourseSubject[] = [...major, ...DEPTH_FAMILIES.filter((f) => present.has(f) && !major.includes(f))];

  return order.map((family) => {
    const cells: CourseRowCell[] = ([9, 10, 11, 12] as const)
      .map((year) => ({
        year,
        courses: courses
          .filter((c) => c.subject === family && c.year === year)
          .map((c) => ({ id: c.id, name: rowCourseName(c), kind: c.kind, status: classYear !== null ? yearStatus(year, classYear, today) : c.status })),
      }))
      .filter((cell) => cell.courses.length > 0);
    return { family, label: SUBJECT_LABELS[family], cells, nextYear };
  });
}

/** The courses already on the list for `nextYear` (the running "Next year so far" list); empty without a next year. */
export function nextYearCourses(courses: readonly CourseEntry[], nextYear: 10 | 11 | 12 | null): CourseEntry[] {
  if (nextYear === null) return [];
  return courses.filter((c) => c.year === nextYear);
}
