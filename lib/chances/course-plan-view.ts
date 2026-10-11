/**
 * What the browser gets of the course plan (specs/chances/course-plan.md): the suggestions and guardrail messages as
 * sentences already written from the note catalog, never the rules behind them (grades threshold, yearly cap, how
 * many colleges make a recommendation count). The server computes it (course-plan.ts, course-plan-server.ts) and puts
 * it on the PlanContext; the card renders it. Pure and client-safe: tests/chances-course-plan.test.mts fails if any
 * client code reaches the rules.
 */
import type { AnyCited } from "../lineage.ts";
import type { CourseSubject } from "./types.ts";

/** Why a course is suggested, in the spec's order: a requirement before a recommendation. */
export type SuggestionReason = "required" | "recommended" | "top_level" | "major";
export const REASON_ORDER: readonly SuggestionReason[] = ["required", "recommended", "top_level", "major"];

/** What the card shows instead of (or beside) suggestions. */
export type CoursePlanKind =
  /** One or two suggestions. */
  | "suggestions"
  /** Nothing to add: "you're set". */
  | "set"
  /** A guardrail replaced the suggestions (weak grades, already as demanding as the school allows, a full load). */
  | "guardrail"
  /** Senior year: the schedule is set. */
  | "late"
  /** 9th and 10th grade: the path to the top course in the subjects tied to the major. */
  | "path"
  /** Nothing to say (no class year, or no major for a younger student). */
  | "none";

export interface SuggestionView {
  /** The catalog key, or "subject:science" for a suggestion that names no course. Also what "Not for me" stores. */
  id: string;
  /** The catalog key when a course is named; null for a subject-level suggestion (no "Add to my plan"). */
  key: string | null;
  /** "AP Calculus AB", or "A fourth year of science" for a subject-level one. */
  name: string;
  subject: CourseSubject;
  reason: SuggestionReason;
  /** The reason as a sentence. */
  sentence: string;
  /** The school year the course would go on (next year's grade, 10–12). */
  year: 10 | 11 | 12;
  /** "It would make your schedule most of what your school offers." when the reading moves; else null. */
  readingLine: string | null;
  /** The evidence the sentence names: the colleges' C8 recommendations, a unit's page, or the course's page. */
  evidence: { label: string; cite: AnyCited | null; href?: string }[];
}

export interface CoursePlanView {
  kind: CoursePlanKind;
  /** The school year now, "2026-27": what a dismissal is remembered for. */
  season: string;
  /** The student's grade now (9–12), or null. */
  grade: number | null;
  /** The grade next year's courses are for (10–12), or null. */
  nextYear: 10 | 11 | 12 | null;
  /** The usual registration window (February to April) is open: the card opens by itself. */
  inWindow: boolean;
  /** The student marked next year's schedule done this season. */
  done: boolean;
  suggestions: SuggestionView[];
  /** Guardrail and "you're set" sentences, in order. */
  messages: string[];
  /** The path for a 9th or 10th grader, one sentence per subject. */
  path: string[];
  /** Offered when the school's list isn't on record: the catalog to mark, and what the student has marked. */
  askOffering: { catalog: { key: string; name: string; subject: CourseSubject }[]; marks: string[] } | null;
  /** The College Board's page for the evidence link on the method ("how the sequences were written"). */
  methodNote: string | null;
  /** Telemetry: reasons shown (comma-joined) and the guardrail that fired, never a course, a grade, or a score. */
  telemetry: { reasons: string; guardrail: string };
}

/** The school year a date falls in, "2026-27": the year turns over in August. */
export function planSeason(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The usual registration season: February through April (course-plan.md "Where it shows"). */
export function inRegistrationWindow(today: string): boolean {
  const m = Number(today.slice(5, 7));
  return m >= 2 && m <= 4;
}

/** The grade next year's schedule is for, from the grade now: 9th and 10th graders get a path, a senior nothing. */
export function nextYearOf(grade: number | null): 10 | 11 | 12 | null {
  return grade !== null && grade >= 9 && grade <= 11 ? ((grade + 1) as 10 | 11 | 12) : null;
}
