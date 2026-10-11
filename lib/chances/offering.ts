/**
 * What a student's high school offers (specs/chances/rigor-in-context.md "The school's offering", course-plan.md
 * "The school's course list"), best source first:
 * 1. the school profile's AP list (`detail.ap_courses`, pilot schools), matched to catalog keys;
 * 2. courses other students at the school have listed (the pooled list, already held to the three-student threshold
 *    by the server; never shown below it);
 * 3. the student's own marks ("Which of these does your school offer?");
 * 4. the CRDC count (`rigor.ap_courses`): how many, not which; 0 when the school said it offers none.
 * IB and dual enrollment come from the profile's IB list, else CRDC's enrollment counts (> 0 offered, 0 not).
 * Pure and client-safe.
 */
import type { HighSchool, HighSchoolDetail } from "../high-school-types.ts";
import { apKeysForName, catalogCourse } from "./catalog.ts";
import type { SchoolOffering } from "./types.ts";

export interface OfferingInput {
  /** The high school's row (CRDC counts in `rigor`); null when not on record. */
  school: Pick<HighSchool, "rigor"> | null;
  /** The school's own profile, when collected (pilot schools). */
  detail?: Pick<HighSchoolDetail, "ap_courses" | "ib_courses"> | null;
  /** Catalog keys the student marked as offered at the school. */
  studentMarks?: readonly string[] | null;
}

const NOTHING: SchoolOffering = { apCount: null, apKeys: null, ib: null, dual: null, source: null, field: null };

const offered = (n: number | null | undefined): boolean | null => (n == null ? null : n > 0);
const apOnly = (keys: readonly string[]) => [...new Set(keys.filter((k) => k.startsWith("ap_") && catalogCourse(k)))];

/**
 * The profile's printed AP list as keys and a count: each recognized name's keys ("Physics 1 & 2" is two courses),
 * each unrecognized name counted once, and a course printed twice counted once.
 */
export function profileApList(names: readonly string[]): { keys: string[]; count: number } {
  const keys = new Set<string>();
  const unmatched = new Set<string>();
  for (const n of names) {
    const k = apKeysForName(n);
    if (k.length) k.forEach((x) => keys.add(x));
    else unmatched.add(n.trim().toLowerCase());
  }
  return { keys: [...keys], count: keys.size + unmatched.size };
}

/** The school's offering, best source first (see the module comment). `pooled` is the pooled list's catalog keys. */
export function schoolOffering(highSchool: OfferingInput | null, pooled?: readonly string[] | null): SchoolOffering {
  if (!highSchool) return NOTHING;
  const rigor = highSchool.school?.rigor ?? null;
  const profileIb = highSchool.detail?.ib_courses;
  const ib = profileIb && profileIb.length > 0 ? true : offered(rigor?.ib_enrolled);
  const dual = offered(rigor?.dual_enrolled);
  const base = { ib, dual };

  const printed = highSchool.detail?.ap_courses;
  if (printed && printed.length > 0) {
    const { keys, count } = profileApList(printed);
    return { ...base, apCount: count, apKeys: keys, source: "profile", field: "detail.ap_courses" };
  }
  const pooledKeys = pooled ? apOnly(pooled) : [];
  if (pooledKeys.length > 0) return { ...base, apCount: pooledKeys.length, apKeys: pooledKeys, source: "pooled", field: null };
  const marks = highSchool.studentMarks ? apOnly(highSchool.studentMarks) : [];
  if (marks.length > 0) return { ...base, apCount: marks.length, apKeys: marks, source: "student", field: null };
  if (rigor?.ap_courses != null) return { ...base, apCount: rigor.ap_courses, apKeys: null, source: "crdc", field: "rigor.ap_courses" };
  return { ...NOTHING, ...base };
}
