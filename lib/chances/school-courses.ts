import "server-only";
/**
 * The pooled course list for a high school (specs/chances/course-plan.md "The school's course list" 2): the catalog
 * keys of AP courses that at least three students at the school have listed, read through the security-definer
 * function `school_course_list` (supabase/migrations/20261011120000_school_course_counts.sql), which applies the
 * three-student threshold and returns course keys only, never a count or a student. Tolerant of everything: a
 * database without the function, no Supabase configuration, a failed call, or a school with no list is `null`.
 *
 * From the `supabase` high-schools source the list arrives with the school (high_school_bundle(); lib/high-schools.ts
 * getHighSchoolRecord) and apCourseKeys() reads it; pooledCourseKeys() is the `json` source's own call.
 */
import { createServerSupabase } from "@/lib/supabase-server";
import { isHighSchoolId } from "@/lib/high-school-core";
import { isCatalogKeyFor } from "./catalog";

/** The AP catalog keys in a raw course list, or null when there are none. */
export function apCourseKeys(data: unknown): string[] | null {
  if (!Array.isArray(data)) return null;
  const keys = data.filter((k): k is string => typeof k === "string" && isCatalogKeyFor("ap", k));
  return keys.length > 0 ? keys : null;
}

export async function pooledCourseKeys(highSchoolId: string): Promise<string[] | null> {
  if (!isHighSchoolId(highSchoolId)) return null;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("school_course_list", { p_high_school_id: highSchoolId });
    return error ? null : apCourseKeys(data);
  } catch {
    return null;
  }
}
