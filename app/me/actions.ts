"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { importLocalProfile, profileFor, saveProfile } from "@/lib/student-profile-store";
import { coursesFor, profileFromForm } from "@/lib/student-profile-form";

export type ProfileSaveState = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

/** Saves the form on /me. Reused for every student a guardian can edit (the student id travels with the form). */
export async function saveStudentProfile(_prev: ProfileSaveState, form: FormData): Promise<ProfileSaveState> {
  await requireUser("/me");
  const studentId = String(form.get("student_id") ?? "");
  if (!studentId) return { status: "error", message: "Missing student." };
  const saved = await profileFor(studentId);
  const kept = saved?.saved ? saved.data : null;
  const result = await saveProfile(studentId, profileFromForm(form, kept, coursesFor(form, kept, saved?.relation ?? null)));
  if (!result.ok) return { status: "error", message: result.message };
  refresh();
  return { status: "saved" };
}

export type ImportState = { status: "idle" } | { status: "imported" } | { status: "error"; message: string };

/** The one-time "save what you entered before signing in?" offer (student-profile.md "Behavior"). */
export async function importLocalProfileAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  await requireUser("/me");
  const studentId = String(form.get("student_id") ?? "");
  const localJson = String(form.get("local_profile") ?? "");
  if (!studentId || !localJson) return { status: "error", message: "Nothing to import." };
  let local: unknown;
  try {
    local = JSON.parse(localJson);
  } catch {
    return { status: "error", message: "That saved data wasn't readable." };
  }
  const result = await importLocalProfile(studentId, local);
  if (!result.ok) return { status: "error", message: result.message };
  refresh();
  return { status: "imported" };
}
