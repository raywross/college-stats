"use server";
/**
 * Loads and saves a student's profile (specs/product/student-profile.md) for whichever student the signed-in user
 * is allowed to see or edit. Every read and write goes through the user's own Supabase session, so
 * can_read_student/can_edit_student (supabase/migrations/20261005130000_student_profiles.sql) decide; this module
 * only shapes the result and sanitizes what it writes.
 *
 * Server Actions, called from client components mounted on otherwise-static pages (ScoreChecker's prefill,
 * Compare's "You" column, Explore's fit chips): the fetch happens after the page has already rendered, in the
 * browser, so the public page itself never reads a cookie (tests/accounts.test.mts's guard).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccount, getUser, studentsICanSee } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { viewerBundle } from "@/lib/bundles";
import { callBundle } from "@/lib/bundle-read";
import { requestMemo } from "@/lib/request-memo";
import { cache } from "react";
import type { StudentAccess, StudentRecord } from "@/lib/accounts";
import { coreAnswered, emptyProfile, profileForViewer, sanitizeProfile, sanitizeRecommenders, sanitizeStory, withHomeState, type StudentProfileData } from "@/lib/student-profile";
import { getHighSchool } from "@/lib/high-schools";
import { stateOfHome } from "@/lib/home";
import { myHome } from "@/lib/home-store";
import { matriculationLine } from "@/lib/high-school-ui";

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

export interface ProfileAccess {
  student: StudentRecord;
  /** "guardian" for anyone but the student (a counselor too, until the viewer-relation unit widens this). */
  relation: "self" | "guardian";
  canEdit: boolean;
  data: StudentProfileData;
  /** Whether a row exists yet (false = the empty default shape, never saved). */
  saved: boolean;
}

/**
 * The profile rows the signed-in user can read, once per request: from the viewer bundle when it's installed
 * (lib/bundles.ts), else one read of `student_profiles` that row-level security narrows (U20 "real speed": no longer
 * filtered by the access list, so it runs alongside that read instead of after it; profilesICanSee keeps only the
 * students the user can see, exactly as before).
 */
const readableProfiles = cache(
  (): Promise<Map<string, unknown>> =>
    requestMemo("student_profiles", async () => {
      if (!(await getUser())) return new Map<string, unknown>();
      const bundle = await viewerBundle();
      if (bundle) return new Map(bundle.student_profiles.map((r) => [r.student_id, r.data]));
      const supabase = await createServerSupabase();
      const { data, error } = await supabase.from("student_profiles").select("student_id, data");
      if (error && !isMissingTable(error)) throw new Error(`Reading student profiles failed: ${error.message}`);
      return new Map((data ?? []).map((r: { student_id: string; data: unknown }) => [r.student_id, r.data]));
    }),
);

/** Every student the signed-in user can see, each with their saved profile (or the empty shape if none yet). */
export async function profilesICanSee(): Promise<ProfileAccess[]> {
  const [access, rows, home] = await Promise.all([studentsICanSee(), readableProfiles(), myHome().catch(() => null)]);
  if (access.length === 0) return [];
  const homeState = stateOfHome(home);
  return access.map((a: StudentAccess) => {
    const raw = rows.get(a.student.id);
    // Your story (next-steps/your-story.md): a guardian never receives the text, only that it's written; nor does a
    // counselor (anyone but the student reads it redacted).
    const data = withHomeState(profileForViewer(sanitizeProfile(raw), a.relation), homeState);
    return { student: a.student, relation: a.relation === "self" ? "self" : "guardian", canEdit: a.canEdit, data, saved: raw !== undefined };
  });
}

/** One student's profile, for the signed-in user (must be able to read it); null if they can't see that student. */
export async function profileFor(studentId: string): Promise<ProfileAccess | null> {
  const all = await profilesICanSee();
  return all.find((p) => p.student.id === studentId) ?? null;
}

/** The signed-in user's OWN profile (not one they see as a guardian) — what ScoreChecker and Compare's "You" read. */
export async function myOwnProfile(): Promise<StudentProfileData | null> {
  const account = await getAccount().catch(() => null);
  if (!account) return null;
  const all = await profilesICanSee().catch(() => []);
  return all.find((p) => p.student.user_id === account.user.id)?.data ?? null;
}

/** Minimal shape for the ScoreChecker/Compare client fetchers: just enough to prefill, never the whole profile. */
export interface MyScores {
  signedIn: boolean;
  satTotal: number | null;
  actComposite: number | null;
  plansTestOptional: boolean;
}

export async function myScores(): Promise<MyScores> {
  const user = await getUser().catch(() => null);
  if (!user) return { signedIn: false, satTotal: null, actComposite: null, plansTestOptional: false };
  const profile = await myOwnProfile();
  const tests = profile?.tests ?? emptyProfile().tests;
  return { signedIn: true, satTotal: tests.satTotal, actComposite: tests.actComposite, plansTestOptional: tests.plansTestOptional };
}

export type SaveProfileResult = { ok: true } | { ok: false; message: string };

/** Sanitizes and upserts a student's profile. Relies on can_edit_student through RLS; a denial comes back as `ok: false`. */
export async function saveProfile(studentId: string, raw: unknown): Promise<SaveProfileResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in to save your profile." };
  const data = sanitizeProfile(raw);
  const supabase = await createServerSupabase();
  // One call when save_student_profile() is installed (U20 "real speed"; the upsert and the grad-year sync below, in
  // one transaction, through the same policies); else the two writes.
  const rpc = await callBundle<null>(supabase, "save_student_profile", { p_student: studentId, p_data: data });
  if (rpc.kind === "ok") return { ok: true };
  const { error } =
    rpc.kind === "error"
      ? rpc
      : await supabase
          .from("student_profiles")
          .upsert({ student_id: studentId, data, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
  if (error) {
    if (isMissingTable(error)) return { ok: false, message: "Profiles aren't set up on this deployment yet." };
    if (error.code === "42501" || /row-level security/i.test(error.message ?? "")) return { ok: false, message: "You don't have permission to edit this profile." };
    return { ok: false, message: "We couldn't save that. Try again in a moment." };
  }
  // Keep students.grad_year in step with what the student just saved (student-profile.md "Changes (2026-10-06)"):
  // the roster, invite flow, and anything else that reads the student record directly should see the same year as
  // the profile form, not whatever was set when the record was created. Best-effort and silent on failure — the
  // student_profiles row above is the field's source of truth for every tool that reads the profile itself, so a
  // denied or failed sync here (e.g. a view-only guardian's stale write, which can_edit_student already should have
  // blocked before this point) never fails the profile save the student is waiting on.
  if (data.basics.gradYear !== null) await syncStudentGradYear(supabase, studentId, data.basics.gradYear);
  return { ok: true };
}

/** One conditional update (it was a read, then the update): only a row whose year differs is touched. */
async function syncStudentGradYear(supabase: SupabaseClient, studentId: string, gradYear: number): Promise<void> {
  try {
    if (!Number.isInteger(gradYear)) return;
    await supabase.from("students").update({ grad_year: gradYear }).eq("id", studentId).or(`grad_year.is.null,grad_year.neq.${gradYear}`);
  } catch {
    // Best-effort sync; see the call site's comment.
  }
}

export type StorySaveState = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

/**
 * Saves the story's one narrative (form field `narrative`; specs/planner/v3/guides/your-story.md), from the Numbers
 * page's StorySection, the move's StoryCard, or the story guide: a Server Action shape (`useActionState`), same pattern as app/me/actions.ts
 * saveStudentProfile. Reads the profile that's actually saved first and changes only `story`, so nothing else on the
 * profile is ever touched by this form. Student only (IECA's rule: nobody writes it but the student), even for a
 * guardian with edit access elsewhere — `profileFor` already strips the text for a guardian, so `access.data.story`
 * would otherwise silently blank it back out on save.
 */
export async function saveStory(_prev: StorySaveState, form: FormData): Promise<StorySaveState> {
  const user = await getUser();
  if (!user) return { status: "error", message: "Sign in to save your story." };
  const studentId = String(form.get("student_id") ?? "");
  if (!studentId) return { status: "error", message: "Missing student." };
  const access = await profileFor(studentId);
  if (!access) return { status: "error", message: "You don't have permission to edit this profile." };
  if (access.relation !== "self") return { status: "error", message: "Only the student can write their own story." };
  if (!access.canEdit) return { status: "error", message: "You don't have permission to edit this profile." };
  const narrative = form.get("narrative");
  const story = sanitizeStory({ narrative: typeof narrative === "string" ? narrative : "", updatedAt: new Date().toISOString() });
  const result = await saveProfile(studentId, { ...access.data, story });
  if (!result.ok) return { status: "error", message: result.message };
  return { status: "saved" };
}

/**
 * Saves the recommenders list (guides/recommenders.md "Stored"): the student, or a guardian with edit access (a
 * teacher's name isn't a private note, unlike the story). Reads the profile exactly as it's stored — not the
 * viewer's copy, which `profileFor` redacts the story for a guardian — so a guardian's save can never blank out the
 * student's own story: only `recommenders` changes.
 */
export async function saveRecommenders(studentId: string, entries: unknown): Promise<SaveProfileResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in to save your recommenders." };
  const access = await profileFor(studentId);
  if (!access) return { ok: false, message: "You don't have permission to edit this profile." };
  if (!access.canEdit) return { ok: false, message: "You don't have permission to edit this profile." };
  const rows = await readableProfiles();
  const stored = sanitizeProfile(rows.get(studentId));
  return saveProfile(studentId, { ...stored, recommenders: sanitizeRecommenders(entries) });
}

/**
 * One-time import from the signed-out localStorage copy (student-profile.md "Behavior"): merges every field the
 * local copy has into the student's saved profile, without overwriting a field the student already saved there.
 * Called once, right after sign-in, from components/me/ImportLocalProfile.tsx.
 */
export async function importLocalProfile(studentId: string, localRaw: unknown): Promise<SaveProfileResult> {
  const local = sanitizeProfile(localRaw);
  const existing = await profileFor(studentId);
  if (!existing) return { ok: false, message: "You don't have permission to edit this profile." };
  const merged = mergeProfiles(existing.data, local);
  return saveProfile(studentId, merged);
}

/** Fills only the blanks in `base` from `incoming`; never overwrites a value `base` already has. */
function mergeProfiles(base: StudentProfileData, incoming: StudentProfileData): StudentProfileData {
  const pick = <T extends object>(a: T, b: T): T => {
    const out = { ...a } as Record<string, unknown>;
    for (const [key, incoming] of Object.entries(b as Record<string, unknown>)) {
      const current = out[key];
      const currentEmpty = current === null || (Array.isArray(current) && current.length === 0) || current === false;
      const incomingEmpty = incoming === null || (Array.isArray(incoming) && incoming.length === 0) || incoming === false;
      if (currentEmpty && !incomingEmpty) out[key] = incoming;
    }
    return out as T;
  };
  return {
    basics: pick(base.basics, incoming.basics),
    academics: {
      ...pick(base.academics, incoming.academics),
      // The core-subject answers are an object of nulls, never "empty" to pick(): the saved ones win once any is answered.
      coreAtTopLevel: coreAnswered(base.academics.coreAtTopLevel) ? base.academics.coreAtTopLevel : incoming.academics.coreAtTopLevel,
    },
    tests: pick(base.tests, incoming.tests),
    plans: pick(base.plans, incoming.plans),
    preferences: pick(base.preferences, incoming.preferences),
    // Your story (next steps): the saved one wins; a signed-out copy fills it only when none is saved.
    story: base.story ?? incoming.story,
    recommenders: base.recommenders.length > 0 ? base.recommenders : incoming.recommenders,
  };
}

/** The signed-in student's high school's matriculation line for one college, when it has one (specs/product/high-school-data.md "Display"). */
export interface MyHighSchoolMatriculation {
  schoolId: string;
  schoolName: string;
  /** "6 enrolled in 2023–2025 (school profile, 2025–26)" (lib/high-school-ui.ts matriculationLine), built here so the
   * profile's own edition is read in lib/, not in the UI component (tests/citation-guards.test.mts). */
  line: string;
}

/**
 * "From your high school: 6 enrolled in 2023–2025 (school profile, 2025–26)" (components/high-schools/MyHighSchoolLine.tsx):
 * the signed-in student's own high school (never a guardian's view of a student, and never another student's), when
 * it has a profile detail file that lists this college among its matriculation entries with a count. Same pattern as
 * myScores(): a Server Action called from a client component mounted on the otherwise-static college profile, so the
 * page itself never reads cookies while rendering (tests/accounts.test.mts).
 */
export async function myHighSchoolMatriculation(collegeUnitId: string): Promise<MyHighSchoolMatriculation | null> {
  const profile = await myOwnProfile().catch(() => null);
  const hsId = profile?.basics.highSchoolId;
  if (!hsId) return null;
  const view = await getHighSchool(hsId).catch(() => null);
  const matriculation = view?.detail?.matriculation;
  if (!matriculation) return null;
  const entry = matriculation.entries.find((e) => e.unit_id === collegeUnitId);
  if (!entry || entry.count === null) return null;
  return {
    schoolId: view.school.id,
    schoolName: view.school.name,
    line: matriculationLine(entry.count, matriculation.classes, view.detail!.profile.edition),
  };
}
