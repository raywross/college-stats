import "server-only";
/**
 * The counselor portal's server reads (specs/product/counselor-portal.md), over the functions and policies in
 * supabase/migrations/20261102120000_organizations.sql. Every read uses the caller's own Supabase session, so row-level
 * security and the functions' own checks decide; this module only shapes results. Each throws with a plain sentence
 * (lib/org-rules.ts orgErrorMessage) rather than the database's text. Until the migration is applied, the reads that
 * a page makes for everyone (myOrganization, myCounselorGrants, openAsksForStudent) answer "none" instead of failing.
 * Pure types and rules live in lib/org-rules.ts.
 */
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { isMissingFunction } from "@/lib/bundle-read";
import {
  orgErrorMessage,
  type CounselorGrantView,
  type OpenOrgAsk,
  type OrgAsk,
  type OrgNote,
  type OrgRosterRow,
  type Organization,
} from "@/lib/org-rules";

type PgError = { code?: string; message?: string };

function isMissingTable(error: PgError): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** Not installed yet: the function or table isn't in the database. */
function isMissing(error: PgError): boolean {
  return isMissingFunction(error) || isMissingTable(error);
}

function fail(what: string, error: PgError): never {
  console.error(`orgs: ${what} failed: ${error.message ?? "unknown error"}`);
  throw new Error(orgErrorMessage(error.message));
}

async function client(): Promise<SupabaseClient> {
  return createServerSupabase();
}

/** The caller's organization with its members, or null (none, or the portal isn't installed). Once per request. */
export const myOrganization = cache(async (): Promise<Organization | null> => {
  const { data, error } = await (await client()).rpc("my_organization");
  if (error) {
    if (isMissing(error)) return null;
    fail("my_organization", error);
  }
  return (data as Organization | null) ?? null;
});

/** The caseload's students and invited students (members only; empty for anyone else). */
export async function orgRoster(orgId: string): Promise<OrgRosterRow[]> {
  const { data, error } = await (await client()).rpc("org_roster", { p_org: orgId });
  if (error) fail("org_roster", error);
  return (data as OrgRosterRow[]) ?? [];
}

/** The live grants of the caller's own record and of every student of their family ("Your counselors"). */
export const myCounselorGrants = cache(async (): Promise<CounselorGrantView[]> => {
  const { data, error } = await (await client()).rpc("my_counselor_grants");
  if (error) {
    if (isMissing(error)) return [];
    fail("my_counselor_grants", error);
  }
  return (data as CounselorGrantView[]) ?? [];
});

/** The office's notes on one student, newest first, with each author's name from the organization's members. */
export async function orgNotes(orgId: string, studentId: string): Promise<OrgNote[]> {
  const [{ data, error }, org] = await Promise.all([
    (await client())
      .from("org_notes")
      .select("id, org_id, student_id, author_id, body, created, updated")
      .eq("org_id", orgId)
      .eq("student_id", studentId)
      .order("created", { ascending: false }),
    myOrganization(),
  ]);
  if (error) fail("org_notes", error);
  const names = new Map((org?.id === orgId ? org.members : []).map((m) => [m.user_id, m.display_name]));
  return ((data ?? []) as Omit<OrgNote, "author_name">[]).map((n) => ({ ...n, author_name: (n.author_id && names.get(n.author_id)) || null }));
}

/** What the office has asked one student for, newest first, open and done. */
export async function orgAsks(orgId: string, studentId: string): Promise<OrgAsk[]> {
  const { data, error } = await (await client())
    .from("org_requests")
    .select("id, org_id, student_id, kind, section, note, created_by, created, done_at, seen_at")
    .eq("org_id", orgId)
    .eq("student_id", studentId)
    .order("created", { ascending: false });
  if (error) fail("org_requests", error);
  return (data ?? []) as OrgAsk[];
}

/** A student's open asks with who asked, for the advisor's notice (the family sees every live grant's; a member, their own). */
export async function openAsksForStudent(studentId: string): Promise<OpenOrgAsk[]> {
  const { data, error } = await (await client()).rpc("org_open_asks", { p_student: studentId });
  if (error) {
    if (isMissing(error)) return [];
    fail("org_open_asks", error);
  }
  return (data as OpenOrgAsk[]) ?? [];
}

export interface CodePreview {
  org_name: string;
  org_kind: "iec" | "school";
  join_code: string;
  counselor_names: string[];
}

/** What a join code shows (works signed out); null when no organization has it. */
export async function codePreview(code: string): Promise<CodePreview | null> {
  const { data, error } = await (await client()).rpc("org_code_preview", { p_code: code });
  if (error) {
    if (isMissing(error)) return null;
    fail("org_code_preview", error);
  }
  return (data as CodePreview | null) ?? null;
}

export interface InvitationPreview {
  org_name: string;
  org_kind: "iec" | "school";
  inviter_name: string | null;
  side: "counselor" | "student";
  display_name: string | null;
  expires_at: string;
  state: "pending" | "accepted" | "expired" | "revoked";
}

/** What an invitation link shows (works signed out; never the email); null when the token is unknown. */
export async function invitationPreview(token: string): Promise<InvitationPreview | null> {
  const { data, error } = await (await client()).rpc("org_invitation_preview", { p_token: token });
  if (error) {
    if (isMissing(error)) return null;
    fail("org_invitation_preview", error);
  }
  return (data as InvitationPreview | null) ?? null;
}
