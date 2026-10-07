import "server-only";
/**
 * Households for the signed-in user (specs/product/accounts.md "Built: households"): their households with rosters
 * and pending invitations, the student's access log, the delete preview, and the guardian read helper later pages
 * call. Every read uses the user's own session, so row-level security decides. Server only; pure rules and types
 * live in lib/household-rules.ts.
 */
import { cache } from "react";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccount, studentsICanSee } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import type { StudentAccess } from "@/lib/accounts";
import {
  viewerRoles,
  type AccessLogRow,
  type DeletionPreview,
  type HouseholdView,
  type RosterMember,
} from "@/lib/household-rules";

/**
 * Households the signed-in user is an active member of, each with its roster: members and pending invitations in
 * one list (household_roster(), 20261006150000_household_hub.sql), students first.
 */
export const myHouseholds = cache(async (): Promise<HouseholdView[]> => {
  const account = await getAccount();
  if (!account) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("households").select("id, name, created").is("deleted_at", null).order("created");
  if (error) throw new Error(`Reading your households failed: ${error.message}`);
  const views = await Promise.all(
    (data as { id: string; name: string; created: string }[]).map(async (h): Promise<HouseholdView | null> => {
      const roster = await supabase.rpc("household_roster", { p_household: h.id });
      if (roster.error) throw new Error(`Reading a household's members failed: ${roster.error.message}`);
      const members = roster.data as RosterMember[];
      // The creator of a household that's still empty can read it, but isn't in it: skip.
      if (!members.some((m) => m.is_me)) return null;
      return { ...h, members, me: viewerRoles(members) };
    }),
  );
  return views.filter((v): v is HouseholdView => v !== null);
});

/** What a `/household/[person]` id resolves to for the signed-in viewer. */
export type PersonPage =
  | { kind: "student"; access: StudentAccess }
  | { kind: "guardian"; user_id: string; display_name: string | null; is_me: boolean };

/**
 * Resolves a `/household/[person]` id (a student id for a student, a user id for a guardian; personHref() builds
 * them) against the viewer's household. A student: any student the viewer can see (their own record, a managed
 * record, or one they reach as a guardian). A guardian: an active guardian in the viewer's household, or the viewer
 * themselves (also before they have a household). Null for anyone else, so the page can 404. Doesn't log the read:
 * a page that then shows a student's data as a guardian calls logStudentRead() (or uses openStudentAs()).
 *
 * Memoized per request (React `cache`, keyed by the id string): the layout, the page, and ListPage share one result.
 * Read-only, so safe to memoize; the viewer cannot change between its calls within one request.
 */
export const personPage = cache(async (id: string): Promise<PersonPage | null> => {
  const account = await getAccount();
  if (!account) return null;
  const students = await studentsICanSee();
  const access = students.find((a) => a.student.id === id);
  if (access) return { kind: "student", access };
  const guardian = (await myHouseholds()).flatMap((h) => h.members).find((m) => m.role === "guardian" && m.member_id !== null && m.user_id === id);
  if (guardian) return { kind: "guardian", user_id: id, display_name: guardian.display_name, is_me: guardian.is_me };
  // The viewer's own page before they're in a household: by user id, unless they're a student (whose page is their
  // student record's).
  if (id === account.user.id && !students.some((a) => a.relation === "self")) {
    return { kind: "guardian", user_id: id, display_name: account.profile.display_name, is_me: true };
  }
  return null;
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

/** The log_access call itself, on a client the caller already built. Never throws: errors are reported server-side. */
async function writeAccessLog(supabase: SupabaseClient, studentId: string, table: string): Promise<void> {
  try {
    const { error } = await supabase.rpc("log_access", { p_student: studentId, p_table: table });
    if (error) console.error(`households: log_access(${table}) failed: ${error.message}`);
  } catch (err) {
    console.error(`households: log_access(${table}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Records that the signed-in user read one of a student's tables (public.log_access). The database ignores a
 * student's reads of their own data and reads by anyone without access, so callers needn't check. Never throws:
 * a failed log line must not break the page (it's reported server-side).
 */
export async function logStudentRead(studentId: string, table: string): Promise<void> {
  try {
    await writeAccessLog(await createServerSupabase(), studentId, table);
  } catch (err) {
    console.error(`households: log_access(${table}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The same log line, off the critical path: scheduled with `after()` so it runs once the response has been sent,
 * every time, with the same error logging (never throws). `after()` cannot read cookies once the render is over
 * (Server Components), so the Supabase client, which holds the request's session, is built here, before it. In a
 * Server Action or Route Handler `after()` works the same way. Outside any request (a script or test) `after()`
 * throws; the line is then written inline so it is never dropped.
 */
async function scheduleStudentReadLog(studentId: string, table: string): Promise<void> {
  let supabase: SupabaseClient;
  try {
    supabase = await createServerSupabase();
  } catch (err) {
    console.error(`households: log_access(${table}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  try {
    after(() => writeAccessLog(supabase, studentId, table));
  } catch {
    await writeAccessLog(supabase, studentId, table);
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
  // A guardian's read is logged for the student (their access log), after the response: the page doesn't wait on it.
  if (access?.relation === "guardian") await scheduleStudentReadLog(studentId, table);
  return access;
}
