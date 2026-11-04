import "server-only";
/**
 * The admin console's reads for the counselor portal (specs/product/counselor-portal.md "The channel";
 * specs/product/admin.md "the admin console lists organizations"): every organization, newest first, and one
 * organization with its roster. Server only, through adminSupabase() and the "Admins read" policies
 * (20261102120000_organizations.sql): organizations, org_members, org_invitations, org_students, org_notes, and
 * org_requests each carry one. my_organization() and org_roster() are not used here — both check the caller's own
 * membership (is_org_member), which an admin isn't — so this module reads the tables directly, the way
 * lib/admin/people.ts reads a household's roster directly rather than through my_organization()'s RPC.
 *
 * org_invitations.token and token_hash are column-revoked from every API role, admins included (the migration's
 * "Never"): this module never selects them, and there is no path here that could.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminSupabase } from "@/lib/admin/people";
import { requireAdmin } from "@/lib/admin/auth";
import { fetchHighSchool } from "@/lib/supabase-high-schools";
import type { OrgKind, OrgRole } from "@/lib/org-rules";

async function db(): Promise<SupabaseClient> {
  await requireAdmin();
  return adminSupabase();
}

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

async function rows<T>(what: string, query: Result<T[]>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`admin: reading ${what} failed: ${error.message}`);
  return data ?? [];
}

async function maybe<T>(what: string, query: Result<T>): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(`admin: reading ${what} failed: ${error.message}`);
  return data ?? null;
}

const NONE = "00000000-0000-0000-0000-000000000000";
const inList = (ids: (string | null | undefined)[]) => {
  const clean = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
  return clean.length ? clean : [NONE];
};

async function namesFor(supabase: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const found = await rows<{ id: string; display_name: string | null }>("names", supabase.from("profiles").select("id, display_name").in("id", inList(ids)));
  return new Map(found.map((p) => [p.id, p.display_name]));
}

/* ------------------------------------------------------------------ */
/* One line on a person's page                                         */
/* ------------------------------------------------------------------ */

export interface PersonOrganization {
  org_id: string;
  org_name: string;
  role: OrgRole;
}

/** The organization a person belongs to, and their role in it, for the one line on /admin/people/[user]. */
export async function personOrganization(userId: string): Promise<PersonOrganization | null> {
  const supabase = await db();
  const member = await maybe<{ org_id: string; role: OrgRole }>("membership", supabase.from("org_members").select("org_id, role").eq("user_id", userId).maybeSingle());
  if (!member) return null;
  const org = await maybe<{ name: string }>("organization", supabase.from("organizations").select("name").eq("id", member.org_id).maybeSingle());
  return org ? { org_id: member.org_id, org_name: org.name, role: member.role } : null;
}

export interface StudentOrgGrant {
  org_id: string;
  org_name: string;
  granted_at: string;
}

/** A student's live grants (organization name, since when), for the one line on /admin/students/[id]. */
export async function studentOrganizationGrants(studentId: string): Promise<StudentOrgGrant[]> {
  const supabase = await db();
  const grants = await rows<{ org_id: string; granted_at: string }>("grants", supabase.from("org_students").select("org_id, granted_at").eq("student_id", studentId).is("ended_at", null));
  if (grants.length === 0) return [];
  const orgs = await rows<{ id: string; name: string }>("organizations", supabase.from("organizations").select("id, name").in("id", inList(grants.map((g) => g.org_id))));
  const byId = new Map(orgs.map((o) => [o.id, o.name]));
  return grants.map((g) => ({ org_id: g.org_id, org_name: byId.get(g.org_id) ?? "An organization", granted_at: g.granted_at })).sort((a, b) => a.granted_at.localeCompare(b.granted_at));
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

export const ORG_PAGE_SIZE = 50;

export interface OrgListRow {
  id: string;
  name: string;
  kind: OrgKind;
  ncessch: string | null;
  highSchoolName: string | null;
  created: string;
  deleted_at: string | null;
  /** Roles first, by who joined first. */
  members: { name: string | null; role: OrgRole }[];
  liveStudents: number;
  pendingInvitations: number;
}

type OrgRow = { id: string; name: string; kind: OrgKind; ncessch: string | null; website: string | null; join_code: string; created: string; created_by: string | null; deleted_at: string | null };
const ORG_COLUMNS = "id, name, kind, ncessch, website, join_code, created, created_by, deleted_at";

type MemberRow = { id: string; org_id: string; user_id: string; role: OrgRole; created: string };

/** High school names for a set of ncessch ids, read one at a time (there is no bulk-by-id read; organizations are few). */
async function highSchoolNames(supabase: SupabaseClient, ncesschIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(ncesschIds.filter((id): id is string => Boolean(id)))];
  const found = await Promise.all(ids.map(async (id) => [id, await fetchHighSchool(supabase, id)] as const));
  const out = new Map<string, string>();
  for (const [id, hs] of found) if (hs) out.set(id, hs.city ? `${hs.name}, ${hs.city}, ${hs.state}` : `${hs.name}, ${hs.state}`);
  return out;
}

/** One page of every organization, newest first (admins read every row; there is no admin_list_organizations()). */
export async function listOrganizations(page: number): Promise<{ rows: OrgListRow[]; total: number }> {
  const supabase = await db();
  // No admin_list_organizations() (there are few organizations while the portal is new, per the spec's "not a per-
  // counselor caseload yet"): every row is read, sorted newest first, and paged in code, as a plain `.range()` would
  // otherwise do.
  const all = await rows<OrgRow>("organizations", supabase.from("organizations").select(ORG_COLUMNS).order("created", { ascending: false }));
  const from = (page - 1) * ORG_PAGE_SIZE;
  const orgs = all.slice(from, from + ORG_PAGE_SIZE);
  if (orgs.length === 0) return { rows: [], total: all.length };

  const orgIds = inList(orgs.map((o) => o.id));
  const now = new Date().toISOString();
  const [members, students, invitations, hsNames] = await Promise.all([
    rows<MemberRow>("members", supabase.from("org_members").select("id, org_id, user_id, role, created").in("org_id", orgIds).order("created")),
    rows<{ org_id: string }>("students", supabase.from("org_students").select("org_id").in("org_id", orgIds).is("ended_at", null)),
    rows<{ org_id: string }>(
      "invitations",
      supabase.from("org_invitations").select("org_id").in("org_id", orgIds).eq("side", "student").is("accepted_at", null).is("revoked_at", null).gt("expires_at", now),
    ),
    highSchoolNames(supabase, orgs.map((o) => o.ncessch)),
  ]);
  const names = await namesFor(supabase, members.map((m) => m.user_id));
  const countBy = (list: { org_id: string }[], id: string) => list.filter((r) => r.org_id === id).length;

  return {
    rows: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      ncessch: o.ncessch,
      highSchoolName: o.ncessch ? (hsNames.get(o.ncessch) ?? null) : null,
      created: o.created,
      deleted_at: o.deleted_at,
      members: members
        .filter((m) => m.org_id === o.id)
        .sort((a, b) => (a.role === b.role ? a.created.localeCompare(b.created) : a.role === "owner" ? -1 : 1))
        .map((m) => ({ name: names.get(m.user_id) ?? null, role: m.role })),
      liveStudents: countBy(students, o.id),
      pendingInvitations: countBy(invitations, o.id),
    })),
    total: all.length,
  };
}

/* ------------------------------------------------------------------ */
/* One organization                                                    */
/* ------------------------------------------------------------------ */

export interface OrgDetailMember {
  member_id: string;
  user_id: string;
  name: string | null;
  role: OrgRole;
  joined: string;
}

export interface OrgDetailStudent {
  grant_id: string;
  student_id: string;
  name: string | null;
  grad_year: number | null;
  can_edit: boolean;
  source: "invite" | "code";
  granted_at: string;
  has_account: boolean;
}

export interface OrgDetailInvitation {
  id: string;
  display_name: string | null;
  email: string;
  grad_year: number | null;
  created: string;
  expires_at: string;
  /** Never the token: this is "invited" (still open) or "expired"; accepted and revoked invitations aren't shown. */
  state: "invited" | "expired";
}

export interface OrgDetail {
  id: string;
  name: string;
  kind: OrgKind;
  ncessch: string | null;
  highSchoolName: string | null;
  website: string | null;
  joinCode: string;
  created: string;
  deleted_at: string | null;
  members: OrgDetailMember[];
  students: OrgDetailStudent[];
  invitedStudents: OrgDetailInvitation[];
  asks: { total: number; open: number };
}

/** One organization's roster, read directly (never through my_organization()/org_roster(), which check membership). */
export async function adminOrganization(orgId: string): Promise<OrgDetail | null> {
  const supabase = await db();
  const org = await maybe<OrgRow>("organization", supabase.from("organizations").select(ORG_COLUMNS).eq("id", orgId).maybeSingle());
  if (!org) return null;

  const now = new Date().toISOString();
  const [members, grants, invitations, asks, hsNames] = await Promise.all([
    rows<MemberRow>("members", supabase.from("org_members").select("id, org_id, user_id, role, created").eq("org_id", orgId).order("created")),
    rows<{ id: string; student_id: string; can_edit: boolean; source: "invite" | "code"; granted_at: string }>(
      "students",
      supabase.from("org_students").select("id, student_id, can_edit, source, granted_at").eq("org_id", orgId).is("ended_at", null),
    ),
    rows<{ id: string; display_name: string | null; email: string; grad_year: number | null; created: string; expires_at: string }>(
      "invitations",
      supabase.from("org_invitations").select("id, display_name, email, grad_year, created, expires_at").eq("org_id", orgId).eq("side", "student").is("accepted_at", null).is("revoked_at", null),
    ),
    rows<{ done_at: string | null }>("asks", supabase.from("org_requests").select("done_at").eq("org_id", orgId)),
    highSchoolNames(supabase, [org.ncessch]),
  ]);

  const studentIds = inList(grants.map((g) => g.student_id));
  const students = await rows<{ id: string; display_name: string | null; grad_year: number | null; user_id: string | null }>(
    "student records",
    supabase.from("students").select("id, display_name, grad_year, user_id").in("id", studentIds),
  );
  const byStudent = new Map(students.map((s) => [s.id, s]));
  const names = await namesFor(supabase, members.map((m) => m.user_id));

  return {
    id: org.id,
    name: org.name,
    kind: org.kind,
    ncessch: org.ncessch,
    highSchoolName: org.ncessch ? (hsNames.get(org.ncessch) ?? null) : null,
    website: org.website,
    joinCode: org.join_code,
    created: org.created,
    deleted_at: org.deleted_at,
    members: members
      .sort((a, b) => (a.role === b.role ? a.created.localeCompare(b.created) : a.role === "owner" ? -1 : 1))
      .map((m) => ({ member_id: m.id, user_id: m.user_id, name: names.get(m.user_id) ?? null, role: m.role, joined: m.created })),
    students: grants
      .map((g) => {
        const s = byStudent.get(g.student_id);
        return { grant_id: g.id, student_id: g.student_id, name: s?.display_name ?? null, grad_year: s?.grad_year ?? null, can_edit: g.can_edit, source: g.source, granted_at: g.granted_at, has_account: Boolean(s?.user_id) };
      })
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    invitedStudents: invitations
      .map((i) => ({ id: i.id, display_name: i.display_name, email: i.email, grad_year: i.grad_year, created: i.created, expires_at: i.expires_at, state: (i.expires_at > now ? "invited" : "expired") as "invited" | "expired" }))
      .sort((a, b) => (a.display_name ?? a.email).localeCompare(b.display_name ?? b.email)),
    asks: { total: asks.length, open: asks.filter((a) => !a.done_at).length },
  };
}
