"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { importLocalProfile, saveProfile } from "@/lib/student-profile-store";
import type { StudentProfileData } from "@/lib/student-profile";

export type ProfileSaveState = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

function numField(form: FormData, name: string): number | null {
  const v = form.get(name);
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strField(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function boolField(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "1" || form.get(name) === "true";
}

function arrField(form: FormData, name: string): string[] {
  return form.getAll(name).map(String).filter(Boolean);
}

/** "TN, CA, New England" -> ["TN", "CA", "New England"]; also accepts newline- or slash-separated lists. */
function csvField(form: FormData, name: string): string[] {
  const raw = strField(form, name);
  return raw ? raw.split(/[,\n/]/).map((s) => s.trim()).filter(Boolean) : [];
}

/** The form's fields back into the raw shape sanitizeProfile() expects; it drops anything out of range itself. */
function profileFromForm(form: FormData): unknown {
  return {
    basics: {
      gradYear: numField(form, "gradYear"),
      stateOfResidence: strField(form, "stateOfResidence"),
      highSchool: strField(form, "highSchool"),
      highSchoolId: strField(form, "highSchoolId"),
    },
    academics: {
      gpa: numField(form, "gpa"),
      gpaScale: strField(form, "gpaScale") ?? "4.0",
      weightedGpa: numField(form, "weightedGpa"),
      classRankPercentile: numField(form, "classRankPercentile"),
      courseRigorCount: numField(form, "courseRigorCount"),
    },
    tests: {
      satTotal: numField(form, "satTotal"),
      satReading: numField(form, "satReading"),
      satMath: numField(form, "satMath"),
      actComposite: numField(form, "actComposite"),
      actEnglish: numField(form, "actEnglish"),
      actMath: numField(form, "actMath"),
      actReading: numField(form, "actReading"),
      actScience: numField(form, "actScience"),
      superscore: boolField(form, "superscore"),
      plansTestOptional: boolField(form, "plansTestOptional"),
    },
    plans: {
      intendedMajors: arrField(form, "intendedMajors"),
      earlyRoundInterest: strField(form, "earlyRoundInterest"),
    },
    preferences: {
      sizes: arrField(form, "sizes"),
      settings: arrField(form, "settings"),
      statesOrRegions: csvField(form, "statesOrRegionsText"),
      maxAverageCost: numField(form, "maxAverageCost"),
      types: arrField(form, "types"),
    },
  } satisfies Partial<Record<keyof StudentProfileData, unknown>>;
}

/** Saves the form on /me. Reused for every student a guardian can edit (the student id travels with the form). */
export async function saveStudentProfile(_prev: ProfileSaveState, form: FormData): Promise<ProfileSaveState> {
  await requireUser("/me");
  const studentId = String(form.get("student_id") ?? "");
  if (!studentId) return { status: "error", message: "Missing student." };
  const result = await saveProfile(studentId, profileFromForm(form));
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
