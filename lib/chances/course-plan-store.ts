"use server";
/**
 * The course plan's own saves (specs/chances/course-plan.md "Where it shows"): "Not for me" (a suggestion set aside for
 * this season), "mark next year's schedule done", and the student's marks of which AP courses their school offers.
 * Each reads the saved profile with the caller's own session, so row-level security decides who may edit, changes one
 * field of `academics`, and saves it back through sanitizeProfile. Adding a suggested course uses the existing
 * courses save (lib/chances/courses-store.ts saveCourses): it is a planned row on the list like any other.
 */
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { profileFor, saveProfile } from "@/lib/student-profile-store";
import { sanitizeCoursePlan, sanitizeProfile, sanitizeSchoolOffers } from "@/lib/student-profile";
import { planSeason } from "./course-plan-view";

export type CoursePlanSave = { ok: true } | { ok: false; message: string };

const today = () => new Date().toISOString().slice(0, 10);

async function change(studentId: string, edit: (academics: ReturnType<typeof sanitizeProfile>["academics"]) => Partial<ReturnType<typeof sanitizeProfile>["academics"]>): Promise<CoursePlanSave> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };
  const access = typeof studentId === "string" ? await profileFor(studentId) : null;
  if (!access?.canEdit) return { ok: false, message: "You don't have permission to edit this profile." };
  const next = sanitizeProfile({ ...access.data, academics: { ...access.data.academics, ...edit(access.data.academics) } });
  const result = await saveProfile(studentId, next);
  if (!result.ok) return result;
  revalidatePath("/plan");
  revalidatePath("/household", "layout");
  return { ok: true };
}

/** "Not for me": the suggestion is set aside for this school year (a new season starts clean). */
export async function dismissSuggestion(studentId: string, suggestionId: string): Promise<CoursePlanSave> {
  const season = planSeason(today());
  return change(studentId, (a) => {
    const current = a.coursePlan && a.coursePlan.season === season ? a.coursePlan : { season, dismissed: [], done: false };
    return { coursePlan: sanitizeCoursePlan({ ...current, dismissed: [...new Set([...current.dismissed, suggestionId])] }) };
  });
}

/** Marks next year's schedule done (the card collapses to the list), or takes the mark back. */
export async function markScheduleDone(studentId: string, done: boolean): Promise<CoursePlanSave> {
  const season = planSeason(today());
  return change(studentId, (a) => {
    const current = a.coursePlan && a.coursePlan.season === season ? a.coursePlan : { season, dismissed: [], done: false };
    return { coursePlan: sanitizeCoursePlan({ ...current, done: done === true }) };
  });
}

/** The AP courses the student marked as offered at their school ("Which of these does your school offer?"). */
export async function saveSchoolOffers(studentId: string, keys: unknown): Promise<CoursePlanSave> {
  return change(studentId, () => ({ schoolOffers: sanitizeSchoolOffers(keys) }));
}
