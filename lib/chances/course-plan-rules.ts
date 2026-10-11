import "server-only";
/**
 * The course plan's rules and constants (specs/chances/course-plan.md "The rules", method/rigor-reading.md "Grades"):
 * when the grades are too weak to suggest anything, how many advanced courses a year the plan will ever suggest
 * toward, how many suggestions at once, and how many of the list's colleges make a recommendation count. This is the
 * method, not copy: it never reaches a client bundle, a response, or a sentence (the proprietary rule in
 * specs/chances/README.md); tests/chances-course-plan.test.mts fails if any client code reaches this file. The
 * sentences a student sees are in lib/chances/notes.ts and name none of these numbers.
 */
import { courseMark, isAdvancedKind, markPoints } from "../student-profile.ts";
import { RIGOR_RULES } from "./rigor-rules.ts";
import type { CourseEntry } from "./types.ts";

export const COURSE_PLAN_RULES = {
  /** Never suggest a course that would take next year past this many advanced courses (open question 1: five). */
  maxAdvancedPerYear: 5,
  /** Never more than this many suggestions at once. */
  maxSuggestions: 2,
  /** A recent advanced grade below this many points (B−) silences every suggestion. */
  recentWeakPoints: 2.7,
  /** The list's share of colleges whose recommendation makes a subject worth a suggestion ("at least half"). */
  recommendShare: 0.5,
} as const;

export interface GradeCheck {
  /** Suggestions are suppressed. */
  weak: boolean;
  /** The unweighted average of the advanced courses' grades, when any has one. */
  gpa: number | null;
}

/**
 * Whether the student's grades in advanced courses are weak: a low average (the same line the rigor reading calls
 * strong, RIGOR_RULES.strongAdvancedGpa), or a recent grade (this school year or last) below B−. Planned courses have
 * no grades, so they never count against a student.
 */
export function gradeCheck(courses: readonly CourseEntry[], grade: number | null): GradeCheck {
  const advanced = courses.filter((c) => isAdvancedKind(c.kind));
  const graded = advanced.map((c) => ({ c, p: markPoints(courseMark(c)) })).filter((x): x is { c: CourseEntry; p: number } => x.p !== null);
  const gpa = graded.length ? graded.reduce((a, b) => a + b.p, 0) / graded.length : null;
  const lowAverage = gpa !== null && gpa < RIGOR_RULES.strongAdvancedGpa;
  const recentFrom = grade === null ? 0 : grade - 1;
  const recentWeak = graded.some((x) => x.c.year >= recentFrom && x.p < COURSE_PLAN_RULES.recentWeakPoints);
  return { weak: lowAverage || recentWeak, gpa };
}
