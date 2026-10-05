import "server-only";
/**
 * Households for the signed-in user (specs/product/accounts.md "Built: households"): their households with rosters
 * and pending invitations, the student's access log, the delete preview, and the guardian read helper later pages
 * call. Every read uses the user's own session, so row-level security decides. Server only; pure rules and types
 * live in lib/household-rules.ts.
 */
import { cache } from "react";
import { getAccount, studentsICanSee } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import type { StudentAccess } from "@/lib/accounts";
import {
  viewerRoles,
  type AccessLogRow,
  type DeletionPreview,
  type HouseholdView,
  type PendingInvitation,
  type RosterMember,
} from "@/lib/household-rules";

/** Households the signed-in user is an active member of, each with its roster and pending invitations. */
export const myHouseholds = cache(async (): Promise<HouseholdView[]> => {
  const account = await getAccount();
  if (!account) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("households").select("id, name, created").is("deleted_at", null).order("created");
  if (error) throw new Error(`Reading your households failed: ${error.message}`);
  const now = new Date().toISOString();
  const views = await Promise.all(
    (data as { id: string; name: string; created: string }[]).map(async (h): Promise<HouseholdView | null> => {
      const [roster, invitations] = await Promise.all([
        supabase.rpc("household_roster", { p_household: h.id }),
        supabase
          .from("invitations")
          .select("id, email, side, student_id, can_edit, invited_by, created, expires_at")
          .eq("household_id", h.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", now)
          .order("created", { ascending: false }),
      ]);
      if (roster.error) throw new Error(`Reading a household's members failed: ${roster.error.message}`);
      if (invitations.error) throw new Error(`Reading invitations failed: ${invitations.error.message}`);
      const members = roster.data as RosterMember[];
      // The creator of a household that's still empty can read it, but isn't in it: skip.
      if (!members.some((m) => m.is_me)) return null;
      return { ...h, members, invitations: invitations.data as PendingInvitation[], me: viewerRoles(members) };
    }),
  );
  return views.filter((v): v is HouseholdView => v !== null);
});

/** Who viewed the signed-in student's information (my_access_log), newest first. Empty for non-students. */
export async function myAccessLog(limit = 200): Promise<AccessLogRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("my_access_log", { p_limit: limit });
  if (error) throw new Error(`Reading your access log failed: ${error.message}`);
  return data as AccessLogRow[];
}

/** What deleting the account would do to the managed students the user created. */
export async function deletionPreview(): Promise<DeletionPreview> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("account_deletion_preview");
  if (error) throw new Error(`Reading what deletion would remove failed: ${error.message}`);
  return (data as DeletionPreview | null) ?? { own_student: false, managed: [] };
}

/**
 * Records that the signed-in user read one of a student's tables (public.log_access). The database ignores a
 * student's reads of their own data and reads by anyone without access, so callers needn't check. Never throws:
 * a failed log line must not break the page (it's reported server-side).
 */
export async function logStudentRead(studentId: string, table: string): Promise<void> {
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("log_access", { p_student: studentId, p_table: table });
    if (error) console.error(`households: log_access(${table}) failed: ${error.message}`);
  } catch (err) {
    console.error(`households: log_access(${table}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The guardian read helper for pages that show one student's data (a student's profile or list, opened by a
 * guardian): resolves the signed-in user's access to the student and, when they're reading as a guardian, logs it
 * against `table` so the student sees it in /account. Returns null when the user can't see the student. Render
 * `<GuardianBanner>` when `relation === "guardian"`.
 *
 *   const access = await openStudentAs(studentId, "lists");
 *   if (!access) notFound();
 */
export async function openStudentAs(studentId: string, table: string): Promise<StudentAccess | null> {
  const access = (await studentsICanSee()).find((a) => a.student.id === studentId) ?? null;
  if (access?.relation === "guardian") await logStudentRead(studentId, table);
  return access;
}
