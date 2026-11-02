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
  assembleCaseloadStudents,
  CASELOAD_ESSAY_COLUMNS,
  CASELOAD_LIST_SELECT,
  type CaseloadEssayRow,
  type CaseloadListRow,
  type CaseloadProfileRow,
  type CaseloadStudent,
} from "@/lib/org-caseload";
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

/* ------------------------------------------------------------------ */
/* The caseload's reads (U3)                                           */
/* ------------------------------------------------------------------ */

/** Students per query: keeps each `.in()` URL short and each embedded read small. */
const CASELOAD_CHUNK = 50;
/** PostgREST's default page; a read that returns this many asks for the next page. */
const PAGE = 1000;

type Page = PromiseLike<{ data: unknown; error: PgError | null }>;

/** Every row of a read, a thousand at a time (`page(from, to)` applies `.range(from, to)`). */
async function readAll<T>(what: string, page: (from: number, to: number) => Page): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) {
      // A table that isn't there yet (essays before its migration) reads as none; anything else is a real failure.
      if (isMissing(error)) return out;
      fail(what, error);
    }
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function chunks<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Everything the caseload shows about the roster's live students, read with the counselor's own session (row-level
 * security decides; a student whose grant ended reads as nothing): profiles, each default list with its items, their
 * visits, and the list's steps, and essays (when each was last changed). Three queries per fifty students, run
 * together. No estimate, no finances, no nudges: nothing here could read them.
 */
export async function caseloadStudents(roster: readonly OrgRosterRow[]): Promise<CaseloadStudent[]> {
  const live = roster.filter((r) => r.status === "active" && r.student_id);
  if (live.length === 0) return [];
  const supabase = await client();
  const ids = live.map((r) => r.student_id!);
  const parts = await Promise.all(
    chunks(ids, CASELOAD_CHUNK).map(async (part) => {
      const [profiles, lists, essays] = await Promise.all([
        readAll<CaseloadProfileRow>("student_profiles", (from, to) => supabase.from("student_profiles").select("student_id, data").in("student_id", part).order("student_id").range(from, to)),
        readAll<CaseloadListRow>("lists", (from, to) => supabase.from("lists").select(CASELOAD_LIST_SELECT).in("student_id", part).eq("is_default", true).order("id").range(from, to)),
        readAll<CaseloadEssayRow>("essays", (from, to) => supabase.from("essays").select(CASELOAD_ESSAY_COLUMNS).in("student_id", part).order("id").range(from, to)),
      ]);
      return { profiles, lists, essays };
    }),
  );
  return assembleCaseloadStudents(live, {
    profiles: parts.flatMap((p) => p.profiles),
    lists: parts.flatMap((p) => p.lists),
    essays: parts.flatMap((p) => p.essays),
  });
}

/** The roster's live row for one student, or null when they aren't on this organization's caseload. */
export async function caseloadEntry(orgId: string, studentId: string): Promise<OrgRosterRow | null> {
  const roster = await orgRoster(orgId);
  return roster.find((r) => r.status === "active" && r.student_id === studentId) ?? null;
}
