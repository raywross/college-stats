/**
 * What a student's high school offers (specs/chances/rigor-in-context.md "The school's offering", course-plan.md
 * "The school's course list"), best source first:
 * 1. the school profile's AP list (`detail.ap_courses`, pilot schools), matched to catalog keys;
 * 2. College Board's AP Course Ledger (`ap_ledger`): the courses the school is authorized to offer this year, by
 *    name, public and private; an empty list is a school listed with none;
 * 3. courses other students at the school have listed (the pooled list, already held to the three-student threshold
 *    by the server; never shown below it);
 * 4. the student's own marks ("Which of these does your school offer?");
 * 5. the CRDC count (`rigor.ap_courses`): how many, not which; 0 when the school said it offers none.
 * IB and dual enrollment come from the profile's IB list, else CRDC's enrollment counts (> 0 offered, 0 not).
 * Pure and client-safe.
 */
import type { HighSchool, HighSchoolDetail } from "../high-school-types.ts";
import { apKeysForName, catalogCourse } from "./catalog.ts";
import type { SchoolOffering } from "./types.ts";

export interface OfferingInput {
  /** The high school's row (CRDC counts in `rigor`, the Ledger's list in `ap_ledger`); null when not on record. */
  school: (Pick<HighSchool, "rigor"> & Partial<Pick<HighSchool, "ap_ledger">>) | null;
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

/**
 * Every AP course on record for a school, by name, each once: the profile's printed list (recognized names as the
 * catalog's names, "Physics 1 & 2" as two) and the Ledger's list and `other`, in alphabetical order. The page's
 * one list (field `ap_list`); the offering below still prefers one source.
 */
export function apCoursesOnRecord(printed: readonly string[] | null | undefined, ledger: Pick<NonNullable<HighSchool["ap_ledger"]>, "courses" | "other"> | null | undefined): string[] {
  const keys = new Set<string>();
  const other = new Map<string, string>();
  const addOther = (name: string) => {
    const n = name.trim();
    const id = n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (id && !other.has(id)) other.set(id, n);
  };
  for (const k of ledger?.courses ?? []) {
    if (catalogCourse(k)) keys.add(k);
    else addOther(k);
  }
  for (const n of ledger?.other ?? []) addOther(n);
  for (const n of printed ?? []) {
    const k = apKeysForName(n);
    if (k.length) k.forEach((x) => keys.add(x));
    else addOther(n);
  }
  const names = [...keys].map((k) => catalogCourse(k)!.name);
  for (const n of other.values()) if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  return names.sort((a, b) => a.localeCompare(b, "en"));
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
  const ledger = highSchool.school?.ap_ledger ?? null;
  if (ledger) {
    // Courses the catalog lacks (`other`) count but can't be picked; the keys are the pickable list.
    const keys = apOnly(ledger.courses);
    return { ...base, apCount: keys.length + ledger.other.length, apKeys: keys, source: "ledger", field: "ap_ledger" };
  }
  const pooledKeys = pooled ? apOnly(pooled) : [];
  if (pooledKeys.length > 0) return { ...base, apCount: pooledKeys.length, apKeys: pooledKeys, source: "pooled", field: null };
  const marks = highSchool.studentMarks ? apOnly(highSchool.studentMarks) : [];
  if (marks.length > 0) return { ...base, apCount: marks.length, apKeys: marks, source: "student", field: null };
  if (rigor?.ap_courses != null) return { ...base, apCount: rigor.ap_courses, apKeys: null, source: "crdc", field: "rigor.ap_courses" };
  return { ...NOTHING, ...base };
}
