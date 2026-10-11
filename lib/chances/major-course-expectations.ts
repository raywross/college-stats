/**
 * What colleges and professional bodies commonly expect from high school for a major family
 * (specs/chances/course-plan.md "Data"): data/reference/major-course-expectations.json, editorial, with the published
 * pages each entry was written from. Shown as "commonly expected", never as a college's requirement. Read by the
 * course plan (lib/chances/course-plan.ts) for its "your intended major" reason and the path a 9th or 10th grader
 * sees; checked by scripts/check-major-course-expectations.mts in `npm run verify`. Pure and client-safe.
 */
import file from "../../data/reference/major-course-expectations.json" with { type: "json" };
import { catalogCourse, COURSE_SUBJECTS } from "./catalog.ts";
import { isMajorFamily } from "../majors.ts";
import type { CourseSubject } from "./types.ts";

export interface ExpectedSubject {
  subject: CourseSubject;
  /** "math through calculus", "physics and chemistry". */
  text: string;
  /** The catalog course that reaches the expected level in the subject. */
  top: string;
}

export interface ExpectationSource {
  label: string;
  url: string;
  verified_via: "page" | "search";
}

export interface MajorExpectation {
  family: string;
  expects: ExpectedSubject[];
  sources: ExpectationSource[];
}

export interface ExpectationsFile {
  retrieved: string;
  editorial: string;
  families: MajorExpectation[];
}

export const MAJOR_EXPECTATIONS = file as ExpectationsFile;

/** The expectations for a major family (two-digit code), or null when none are written. */
export function expectationsFor(family: string | null | undefined, source: ExpectationsFile = MAJOR_EXPECTATIONS): MajorExpectation | null {
  if (!family) return null;
  return source.families.find((f) => f.family === family) ?? null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isHttps(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** Problems with the file, one line each (empty means sound). */
export function validateExpectations(input: ExpectationsFile): string[] {
  if (!input || !Array.isArray(input.families)) return ['"families" must be an array'];
  const errors: string[] = [];
  if (typeof input.retrieved !== "string" || !ISO.test(input.retrieved)) errors.push("retrieved must be yyyy-mm-dd");
  if (typeof input.editorial !== "string" || !input.editorial.trim()) errors.push('"editorial" must say the entries are editorial');
  const seen = new Set<string>();
  input.families.forEach((f, i) => {
    const where = `families[${i}] ${f && typeof f.family === "string" ? f.family : "(no family)"}`;
    if (!f || typeof f !== "object") {
      errors.push(`families[${i}]: not an object`);
      return;
    }
    if (typeof f.family !== "string" || !isMajorFamily(f.family)) errors.push(`${where}: family isn't a lib/majors.ts family`);
    else if (seen.has(f.family)) errors.push(`${where}: listed twice`);
    else seen.add(f.family);
    if (!Array.isArray(f.expects) || f.expects.length === 0) errors.push(`${where}: expects must be a non-empty list`);
    else
      for (const e of f.expects) {
        if (!COURSE_SUBJECTS.includes(e?.subject)) errors.push(`${where}: subject ${JSON.stringify(e?.subject)} isn't a course subject`);
        if (typeof e?.text !== "string" || !e.text.trim()) errors.push(`${where}: each expectation needs text`);
        const top = typeof e?.top === "string" ? catalogCourse(e.top) : null;
        if (!top) errors.push(`${where}: top ${JSON.stringify(e?.top)} isn't a catalog course`);
        else if (top.subject !== e.subject) errors.push(`${where}: top ${e.top} is a ${top.subject} course, not ${e.subject}`);
      }
    if (!Array.isArray(f.sources) || f.sources.length === 0) errors.push(`${where}: at least one published source is required`);
    else
      for (const s of f.sources) {
        if (!s || typeof s.label !== "string" || !s.label.trim()) errors.push(`${where}: each source needs a label`);
        if (!isHttps(s?.url)) errors.push(`${where}: each source needs an https url`);
        if (s?.verified_via !== "page" && s?.verified_via !== "search") errors.push(`${where}: verified_via must be "page" or "search"`);
      }
  });
  return errors;
}
