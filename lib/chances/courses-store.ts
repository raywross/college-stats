"use server";
/**
 * Saves a student's course list from the places that aren't the /me form (the plan's "Add your courses" sheet): the
 * list, the core-subject answers, and the AP-exam privacy switch, merged into the saved profile with the caller's own
 * session so row-level security decides who may edit (specs/chances/rigor-in-context.md "Entering them"). A guardian
 * never sees exam scores while they are private, so what they post carries none: the saved scores stay on the rows
 * that remain (mergeCoursesForSave), and a guardian can't change the privacy switch.
 */
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { profileFor, saveProfile } from "@/lib/student-profile-store";
import { sanitizeCoreAtTopLevel, sanitizeCourses, sanitizeProfile } from "@/lib/student-profile";
import { mergeCoursesForSave } from "./courses";

export type SaveCoursesResult = { ok: true } | { ok: false; message: string };

export async function saveCourses(
  studentId: string,
  input: { courses: unknown; coreAtTopLevel: unknown; apExamsPrivate: unknown; highSchool?: { id: unknown; name: unknown } | null },
): Promise<SaveCoursesResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };
  const access = typeof studentId === "string" ? await profileFor(studentId) : null;
  if (!access?.canEdit) return { ok: false, message: "You don't have permission to edit this profile." };
  const saved = access.data.academics;
  const merged = mergeCoursesForSave(
    { courses: saved.courses, apExamsPrivate: saved.apExamsPrivate },
    { courses: sanitizeCourses(input.courses), apExamsPrivate: input.apExamsPrivate !== false },
    access.relation,
  );
  const next = sanitizeProfile({
    ...access.data,
    // A high school picked in the sheet (the plan has no other place to pick it); sanitizeProfile checks the id.
    basics: input.highSchool ? { ...access.data.basics, highSchoolId: input.highSchool.id, highSchool: input.highSchool.name } : access.data.basics,
    academics: { ...saved, courses: merged.courses, courseRigorCount: null, apExamsPrivate: merged.apExamsPrivate, coreAtTopLevel: sanitizeCoreAtTopLevel(input.coreAtTopLevel) },
  });
  const result = await saveProfile(studentId, next);
  if (!result.ok) return result;
  revalidatePath("/plan");
  revalidatePath("/household", "layout");
  return { ok: true };
}
