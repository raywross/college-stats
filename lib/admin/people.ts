import "server-only";
/**
 * The admin console's reads (specs/product/admin.md "People"): a search, a person, a household, a student record
 * and its data, the log, the admins list, a person's export, and the student-page view record. Server only.
 *
 * Every read runs with the admin's own session through the "Admins read" policies (20261012200000_admin.sql), which
 * apply only with the console's request header: adminSupabase() sends it, createServerSupabase() doesn't. So an admin
 * browsing the ordinary site sees only their own family, and every console read must use adminSupabase(). Each
 * function calls requireAdmin() first (a 404 for anyone else); the database checks is_admin() again regardless.
 *
 * Writes are not here: Server Actions call the admin_*() functions directly (each writes its own admin_log row).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin/auth";
import { ADMIN_CONSOLE_HEADER, ADMIN_LOG_PAGE, SUPPORT_VIEWER_NAME } from "@/lib/admin/constants";
import { ACCOUNT_EXPORTERS, buildAccountExport, type AccountExport, type AccountExporter, type ExportContext } from "@/lib/account-export";
import { DELETE_GRACE_DAYS } from "@/lib/household-rules";
import { SITE_NAME } from "@/lib/brand";

/** The console's Supabase client: the admin's own session plus the header that turns on the "Admins read" policies. */
export function adminSupabase(): Promise<SupabaseClient> {
  return createServerSupabase({ headers: { [ADMIN_CONSOLE_HEADER]: "1" } });
}

async function db(): Promise<SupabaseClient> {
  await requireAdmin();
  return adminSupabase();
}

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** Rows of a read, or a thrown error naming what failed (the page's error boundary shows it). */
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

/** Display names for user ids (profiles, through the admin policy). */
async function namesFor(supabase: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const found = await rows<{ id: string; display_name: string | null }>("names", supabase.from("profiles").select("id, display_name").in("id", inList(ids)));
  return new Map(found.map((p) => [p.id, p.display_name]));
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export type SearchKind = "user" | "student" | "household" | "invitation";
export type PersonStatus = "active" | "paused" | "deleting" | "invited" | "managed";

/** One row of admin_search_people(). */
export interface SearchRow {
  kind: SearchKind;
  id: string;
  name: string | null;
  email: string | null;
  household: string | null;
  household_id: string | null;
  role: string | null;
  status: PersonStatus;
  created: string;
  last_sign_in: string | null;
}

/** People, student records, households, and pending invitations matching q (names, emails, ids; typos by trigram). */
export async function searchPeople(q: string, max = 50): Promise<SearchRow[]> {
  if (q.trim() === "") return [];
  const supabase = await db();
  return rows<SearchRow>("search", supabase.rpc("admin_search_people", { q, max_rows: max }));
}

/* ------------------------------------------------------------------ */
/* A person                                                            */
/* ------------------------------------------------------------------ */

export interface AdminProfile {
  id: string;
  display_name: string | null;
  birth_year: number | null;
  role_hint: "student" | "guardian" | "counselor" | null;
  phone: string | null;
  created: string;
  updated: string;
  deleted_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
}

/** The Auth side (admin_user_auth()): what only auth.users and auth.mfa_factors know. */
export interface AdminAuthInfo {
  email: string | null;
  email_confirmed_at: string | null;
  providers: string[];
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
  mfa_enrolled: boolean;
}

export interface AdminStudentRef {
  id: string;
  user_id: string | null;
  display_name: string | null;
  grad_year: number | null;
  managed_by: string | null;
  phone: string | null;
  created: string;
  deleted_at: string | null;
}

/** A household member as the console shows them: by name, with how they're in it. */
export interface AdminMember {
  id: string;
  household_id: string;
  role: "guardian" | "student";
  status: string;
  can_edit: boolean;
  since: string;
  user_id: string | null;
  student_id: string | null;
  name: string | null;
  /** A student record without its own account. */
  managed: boolean;
}

export interface AdminMembership {
  member: AdminMember;
  household: { id: string; name: string; deleted_at: string | null };
  /** The household's other active members. */
  others: AdminMember[];
}

export interface AdminListSummary {
  id: string;
  name: string;
  student_id: string | null;
  user_id: string | null;
  is_default: boolean;
  items: number;
}

/** One line of "Who viewed their data": the console names admins too (families see "Quad support"). */
export interface AdminAccessRow {
  at: string;
  table_name: string;
  viewer_id: string;
  viewer_name: string | null;
  by_admin: boolean;
}

export interface AdminPerson {
  profile: AdminProfile;
  auth: AdminAuthInfo | null;
  isAdmin: boolean;
  /** When a deleted account is purged (deleted_at + 30 days). */
  purgeAt: string | null;
  memberships: AdminMembership[];
  ownStudent: AdminStudentRef | null;
  managedStudents: AdminStudentRef[];
  lists: AdminListSummary[];
  notifications: {
    prefs: Record<string, unknown> | null;
    digests: { published_at: string; sent_at: string | null; college_count: number; change_count: number }[];
    smsConsents: { id: string; phone: string; consented_at: string; revoked_at: string | null; provider_opt_out_at: string | null }[];
  };
  accessLog: AdminAccessRow[];
}

const PROFILE_COLUMNS = "id, display_name, birth_year, role_hint, phone, created, updated, deleted_at, suspended_at, suspended_reason";
const STUDENT_COLUMNS = "id, user_id, display_name, grad_year, managed_by, phone, created, deleted_at";
const MEMBER_COLUMNS = "id, household_id, user_id, student_id, role, status, can_edit, created, accepted_at";

type MemberRow = { id: string; household_id: string; user_id: string | null; student_id: string | null; role: "guardian" | "student"; status: string; can_edit: boolean; created: string; accepted_at: string | null };

/** Member rows with names: guardians from profiles, students from their record. */
async function withNames(supabase: SupabaseClient, members: MemberRow[]): Promise<AdminMember[]> {
  const [names, students] = await Promise.all([
    namesFor(supabase, members.map((m) => m.user_id)),
    rows<{ id: string; display_name: string | null; user_id: string | null }>("students", supabase.from("students").select("id, display_name, user_id").in("id", inList(members.map((m) => m.student_id)))),
  ]);
  const byStudent = new Map(students.map((s) => [s.id, s]));
  return members.map((m) => {
    const s = m.student_id ? byStudent.get(m.student_id) : undefined;
    return {
      id: m.id,
      household_id: m.household_id,
      role: m.role,
      status: m.status,
      can_edit: m.can_edit,
      since: m.accepted_at ?? m.created,
      user_id: m.user_id,
      student_id: m.student_id,
      name: m.role === "guardian" ? (names.get(m.user_id ?? "") ?? null) : (s?.display_name ?? null),
      managed: m.role === "student" && s !== undefined && s.user_id === null,
    };
  });
}

/** access_log rows for these student records, newest first, with viewer names and which viewers were admins. */
async function accessFor(supabase: SupabaseClient, studentIds: string[], limit = 200): Promise<AdminAccessRow[]> {
  if (studentIds.length === 0) return [];
  const log = await rows<{ at: string; table_name: string; viewer_id: string }>(
    "access log",
    supabase.from("access_log").select("at, table_name, viewer_id").in("student_id", studentIds).order("at", { ascending: false }).limit(limit),
  );
  const names = await namesFor(supabase, log.map((r) => r.viewer_id));
  return log.map((r) => ({ ...r, viewer_name: names.get(r.viewer_id) ?? null, by_admin: r.table_name === "admin" }));
}

function purgeDate(deletedAt: string | null): string | null {
  if (!deletedAt) return null;
  return new Date(new Date(deletedAt).getTime() + DELETE_GRACE_DAYS * 86_400_000).toISOString();
}

/** Everything the person page shows, or null when there's no such profile. */
export async function adminPerson(userId: string): Promise<AdminPerson | null> {
  const supabase = await db();
  const profile = await maybe<AdminProfile>("profile", supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle());
  if (!profile) return null;

  const [authRows, admin, own, managed, guardianRows, prefs, digests, sms] = await Promise.all([
    rows<AdminAuthInfo>("auth", supabase.rpc("admin_user_auth", { p_user: userId })),
    maybe<{ user_id: string }>("admins", supabase.from("admins").select("user_id").eq("user_id", userId).is("revoked_at", null).maybeSingle()),
    maybe<AdminStudentRef>("own student", supabase.from("students").select(STUDENT_COLUMNS).eq("user_id", userId).maybeSingle()),
    rows<AdminStudentRef>("managed students", supabase.from("students").select(STUDENT_COLUMNS).eq("managed_by", userId).is("user_id", null).order("created")),
    rows<MemberRow>("memberships", supabase.from("household_members").select(MEMBER_COLUMNS).eq("user_id", userId)),
    maybe<Record<string, unknown>>("notification prefs", supabase.from("notification_prefs").select("email_updates, your_week, parent_summary, nudge_emails, updated").eq("user_id", userId).maybeSingle()),
    rows<AdminPerson["notifications"]["digests"][number]>("digests", supabase.from("digests").select("published_at, sent_at, college_count, change_count").eq("user_id", userId).order("published_at", { ascending: false }).limit(20)),
    rows<AdminPerson["notifications"]["smsConsents"][number]>("text consents", supabase.from("sms_consents").select("id, phone, consented_at, revoked_at, provider_opt_out_at").eq("user_id", userId).order("consented_at", { ascending: false })),
  ]);

  const ownRows = own ? await rows<MemberRow>("memberships", supabase.from("household_members").select(MEMBER_COLUMNS).eq("student_id", own.id)) : [];
  const mine = [...guardianRows, ...ownRows];
  const householdIds = [...new Set(mine.map((m) => m.household_id))];
  const [households, allMembers] = await Promise.all([
    rows<{ id: string; name: string; deleted_at: string | null }>("households", supabase.from("households").select("id, name, deleted_at").in("id", inList(householdIds))),
    rows<MemberRow>("members", supabase.from("household_members").select(MEMBER_COLUMNS).in("household_id", inList(householdIds)).eq("status", "active")),
  ]);
  const named = await withNames(supabase, allMembers);
  const mineNamed = await withNames(supabase, mine);
  const memberships = mineNamed.flatMap((member): AdminMembership[] => {
    const household = households.find((h) => h.id === member.household_id);
    if (!household) return [];
    return [{ member, household, others: named.filter((m) => m.household_id === member.household_id && m.id !== member.id) }];
  });

  const studentIds = [own?.id, ...managed.map((s) => s.id)].filter((id): id is string => Boolean(id));
  const lists = await rows<{ id: string; name: string; student_id: string | null; user_id: string | null; is_default: boolean }>(
    "lists",
    supabase.from("lists").select("id, name, student_id, user_id, is_default").or(`user_id.eq.${userId},student_id.in.(${inList(studentIds).join(",")})`),
  );
  const items = await rows<{ list_id: string }>("list items", supabase.from("list_items").select("list_id").in("list_id", inList(lists.map((l) => l.id))));
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.list_id, (counts.get(i.list_id) ?? 0) + 1);

  return {
    profile,
    auth: authRows[0] ?? null,
    isAdmin: admin !== null,
    purgeAt: purgeDate(profile.deleted_at),
    memberships,
    ownStudent: own,
    managedStudents: managed,
    lists: lists.map((l) => ({ ...l, items: counts.get(l.id) ?? 0 })),
    notifications: { prefs, digests, smsConsents: sms },
    accessLog: own ? await accessFor(supabase, [own.id]) : [],
  };
}

/* ------------------------------------------------------------------ */
/* A household                                                         */
/* ------------------------------------------------------------------ */

export interface AdminInvitation {
  id: string;
  email: string;
  side: "guardian" | "student";
  display_name: string | null;
  student_id: string | null;
  can_edit: boolean;
  invited_by: string | null;
  invited_by_name: string | null;
  created: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  state: "pending" | "expired" | "accepted" | "revoked";
}

export interface AdminHousehold {
  id: string;
  name: string;
  created: string;
  created_by: string | null;
  created_by_name: string | null;
  deleted_at: string | null;
  /** City and state only (household_homes_admin); the street is the family's. */
  home: { place: string; set_by_name: string | null; updated_at: string } | null;
  /** Students first, then guardians, each by when they joined. */
  members: AdminMember[];
  invitations: AdminInvitation[];
  /** Active members plus pending, unexpired invitations that aren't a managed student's hand-over (household_seats_taken). */
  seats: number;
}

export function invitationState(i: { accepted_at: string | null; revoked_at: string | null; expires_at: string }, now = new Date()): AdminInvitation["state"] {
  if (i.revoked_at) return "revoked";
  if (i.accepted_at) return "accepted";
  return new Date(i.expires_at) <= now ? "expired" : "pending";
}

export async function adminHousehold(householdId: string): Promise<AdminHousehold | null> {
  const supabase = await db();
  const household = await maybe<{ id: string; name: string; created: string; created_by: string | null; deleted_at: string | null }>(
    "household",
    supabase.from("households").select("id, name, created, created_by, deleted_at").eq("id", householdId).maybeSingle(),
  );
  if (!household) return null;
  const [members, invitations, homes] = await Promise.all([
    rows<MemberRow>("members", supabase.from("household_members").select(MEMBER_COLUMNS).eq("household_id", householdId).eq("status", "active")),
    rows<Omit<AdminInvitation, "invited_by_name" | "state">>(
      "invitations",
      supabase.from("invitations_admin").select("id, email, side, display_name, student_id, can_edit, invited_by, created, expires_at, accepted_at, revoked_at").eq("household_id", householdId).order("created", { ascending: false }),
    ),
    rows<{ place: string; set_by_name: string | null; updated_at: string }>("home", supabase.from("household_homes_admin").select("place, set_by_name, updated_at").eq("household_id", householdId)),
  ]);
  const named = (await withNames(supabase, members)).sort((a, b) => (a.role === b.role ? a.since.localeCompare(b.since) : a.role === "student" ? -1 : 1));
  const names = await namesFor(supabase, [household.created_by, ...invitations.map((i) => i.invited_by)]);
  const now = new Date();
  const invites = invitations.map((i) => ({ ...i, invited_by_name: names.get(i.invited_by ?? "") ?? null, state: invitationState(i, now) }));
  return {
    ...household,
    created_by_name: names.get(household.created_by ?? "") ?? null,
    home: homes[0] ?? null,
    members: named,
    invitations: invites,
    seats: named.length + invites.filter((i) => i.state === "pending" && i.student_id === null).length,
  };
}

/* ------------------------------------------------------------------ */
/* A student record and its data                                       */
/* ------------------------------------------------------------------ */

export interface AdminListItem {
  id: string;
  list_id: string;
  unit_id: string;
  category: string;
  status: string;
  outcome: string | null;
  round: string | null;
  position: number;
  added_at: string;
  added_by: string | null;
  decision_date: string | null;
  deadline_text: string | null;
  deadline_date: string | null;
  enrolling: boolean;
  updates: boolean;
  visited_on: string | null;
  follows_social: boolean;
  applied_on: string | null;
  notes: { id: string; item_id: string; author_id: string; author_name: string | null; body: string; private: boolean; created: string }[];
}

export interface AdminList {
  id: string;
  name: string;
  is_default: boolean;
  share_enabled: boolean;
  created: string;
  items: AdminListItem[];
}

export interface AdminStudent {
  record: AdminStudentRef;
  /** The record's own account, or the guardian who manages it. */
  owner: { id: string; name: string | null } | null;
  manager: { id: string; name: string | null } | null;
  household: { id: string; name: string } | null;
  profile: { data: Record<string, unknown>; updated_at: string; updated_by: string | null } | null;
  lists: AdminList[];
  plan: {
    tasks: Record<string, unknown>[];
    visits: Record<string, unknown>[];
    offers: Record<string, unknown>[];
    /** Metadata only: never the file. */
    letters: { id: string; item_id: string; kind: string; storage_path: string; uploaded_by: string; created_at: string; confirmed_at: string | null }[];
  };
  /** application_snapshots rows in full: binned inputs, the estimate's group, the hidden measurement columns, consent. */
  snapshots: Record<string, unknown>[];
  accessLog: AdminAccessRow[];
}

const ITEM_COLUMNS =
  "id, list_id, unit_id, category, status, outcome, round, position, added_at, added_by, decision_date, deadline_text, deadline_date, enrolling, updates, visited_on, follows_social, applied_on";

/** The student record and its data as the family sees it, read-only. Call logStudentView() once per render too. */
export async function adminStudent(studentId: string): Promise<AdminStudent | null> {
  const supabase = await db();
  const record = await maybe<AdminStudentRef>("student", supabase.from("students").select(STUDENT_COLUMNS).eq("id", studentId).maybeSingle());
  if (!record) return null;

  const [profile, lists, membership] = await Promise.all([
    maybe<AdminStudent["profile"]>("student profile", supabase.from("student_profiles").select("data, updated_at, updated_by").eq("student_id", studentId).maybeSingle()),
    rows<{ id: string; name: string; is_default: boolean; share_enabled: boolean; created: string }>(
      "lists",
      supabase.from("lists").select("id, name, is_default, share_enabled, created").eq("student_id", studentId).order("created"),
    ),
    rows<{ household_id: string }>("membership", supabase.from("household_members").select("household_id").eq("student_id", studentId).eq("status", "active").limit(1)),
  ]);
  const listIds = inList(lists.map((l) => l.id));
  const [items, tasks] = await Promise.all([
    rows<Omit<AdminListItem, "notes">>("list items", supabase.from("list_items").select(ITEM_COLUMNS).in("list_id", listIds).order("position")),
    rows<Record<string, unknown>>("plan tasks", supabase.from("plan_tasks").select("*").in("list_id", listIds).order("due_on", { ascending: true, nullsFirst: false })),
  ]);
  const itemIds = inList(items.map((i) => i.id));
  const [notes, visits, offers, letters, snapshots, household] = await Promise.all([
    rows<{ id: string; item_id: string; author_id: string; body: string; private: boolean; created: string }>("notes", supabase.from("list_notes").select("id, item_id, author_id, body, private, created").in("item_id", itemIds).order("created")),
    rows<Record<string, unknown>>("visits", supabase.from("plan_visits").select("*").in("item_id", itemIds).order("on_date")),
    rows<Record<string, unknown>>("offers", supabase.from("plan_offers").select("*").in("item_id", itemIds)),
    rows<AdminStudent["plan"]["letters"][number]>("letters", supabase.from("plan_letters").select("id, item_id, kind, storage_path, uploaded_by, created_at, confirmed_at").in("item_id", itemIds)),
    rows<Record<string, unknown>>("snapshots", supabase.from("application_snapshots").select("*").eq("student_id", studentId).order("applied_on")),
    membership[0] ? maybe<{ id: string; name: string }>("household", supabase.from("households").select("id, name").eq("id", membership[0].household_id).maybeSingle()) : Promise.resolve(null),
  ]);
  const names = await namesFor(supabase, [record.user_id, record.managed_by, ...notes.map((n) => n.author_id)]);

  return {
    record,
    owner: record.user_id ? { id: record.user_id, name: names.get(record.user_id) ?? null } : null,
    manager: record.managed_by ? { id: record.managed_by, name: names.get(record.managed_by) ?? null } : null,
    household,
    profile,
    lists: lists.map((l) => ({
      ...l,
      items: items
        .filter((i) => i.list_id === l.id)
        .map((i) => ({ ...i, notes: notes.filter((n) => n.item_id === i.id).map((n) => ({ ...n, author_name: names.get(n.author_id) ?? null })) })),
    })),
    plan: { tasks, visits, offers, letters },
    snapshots,
    accessLog: await accessFor(supabase, [studentId]),
  };
}

/**
 * Record that the admin opened a student's data (admin_log_access): the student sees "Quad support viewed your
 * information", and the log gets an access.view row naming `what`. Call once per render of a page that shows it.
 */
export async function logStudentView(studentId: string, what: string): Promise<void> {
  const supabase = await db();
  const { error } = await supabase.rpc("admin_log_access", { p_student: studentId, p_what: what });
  if (error) throw new Error(`admin: recording the view failed: ${error.message}`);
}

/* ------------------------------------------------------------------ */
/* The log and the admins                                              */
/* ------------------------------------------------------------------ */

export interface AdminLogRow {
  id: number;
  admin_id: string | null;
  admin_name: string | null;
  at: string;
  action: string;
  target_kind: "user" | "student" | "household" | "invitation" | "member" | null;
  target_id: string | null;
  details: Record<string, unknown>;
  request_id: string | null;
}

export interface AdminLogFilter {
  /** Rows older than this id (the previous page's `next`). */
  before?: number;
  action?: string;
  adminId?: string;
  targetKind?: AdminLogRow["target_kind"];
  targetId?: string;
}

/** One page of the log, newest first; `next` is the id to pass as `before` for the page after, or null at the end. */
export async function adminLog(filter: AdminLogFilter = {}): Promise<{ rows: AdminLogRow[]; next: number | null }> {
  const supabase = await db();
  let query = supabase.from("admin_log").select("id, admin_id, at, action, target_kind, target_id, details, request_id").order("id", { ascending: false }).limit(ADMIN_LOG_PAGE + 1);
  if (filter.before !== undefined) query = query.lt("id", filter.before);
  if (filter.action) query = query.eq("action", filter.action);
  if (filter.adminId) query = query.eq("admin_id", filter.adminId);
  if (filter.targetKind) query = query.eq("target_kind", filter.targetKind);
  if (filter.targetId) query = query.eq("target_id", filter.targetId);
  const found = await rows<Omit<AdminLogRow, "admin_name">>("log", query);
  const page = found.slice(0, ADMIN_LOG_PAGE);
  const names = await namesFor(supabase, page.map((r) => r.admin_id));
  return {
    rows: page.map((r) => ({ ...r, admin_name: names.get(r.admin_id ?? "") ?? null })),
    next: found.length > ADMIN_LOG_PAGE ? page[page.length - 1].id : null,
  };
}

export interface AdminRow {
  user_id: string;
  name: string | null;
  email: string | null;
  granted_by: string | null;
  granted_by_name: string | null;
  granted_at: string;
  revoked_at: string | null;
  note: string | null;
}

/** Every admin row, current first, then revoked. */
export async function adminsList(): Promise<AdminRow[]> {
  const supabase = await db();
  const admins = await rows<Omit<AdminRow, "name" | "email" | "granted_by_name">>(
    "admins",
    supabase.from("admins").select("user_id, granted_by, granted_at, revoked_at, note").order("granted_at"),
  );
  const [names, emails] = await Promise.all([
    namesFor(supabase, admins.flatMap((a) => [a.user_id, a.granted_by])),
    Promise.all(admins.map(async (a) => (await rows<AdminAuthInfo>("auth", supabase.rpc("admin_user_auth", { p_user: a.user_id })))[0]?.email ?? null)),
  ]);
  return admins
    .map((a, i) => ({ ...a, name: names.get(a.user_id) ?? null, email: emails[i], granted_by_name: names.get(a.granted_by ?? "") ?? null }))
    .sort((a, b) => (a.revoked_at === null) === (b.revoked_at === null) ? a.granted_at.localeCompare(b.granted_at) : a.revoked_at === null ? -1 : 1);
}

/* ------------------------------------------------------------------ */
/* What the household is told (read by its members, not the console)  */
/* ------------------------------------------------------------------ */

export interface HouseholdAdminNotice {
  at: string;
  action: "household.link" | "household.unlink";
  member_name: string | null;
}

/**
 * Admin links and unlinks in the household of the last 30 days, for the one-line notice on /household ("Quad support
 * added Jordan to this household on Oct 12"). Runs with the member's own session; empty on any error (the migration
 * not applied yet, or not a member).
 */
export async function householdAdminNotice(householdId: string): Promise<HouseholdAdminNotice[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("admin_household_notice", { p_household: householdId });
    return error ? [] : ((data ?? []) as HouseholdAdminNotice[]);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Export their data                                                   */
/* ------------------------------------------------------------------ */

/**
 * Every exporter key in lib/account-export.ts, each reviewed for running as an admin over the admin policies:
 * exporters that read through ctx ids (userId, studentIds) give the same rows they give the person; the ones that
 * rely on the person's own session (an unfiltered read, auth.uid() in a function, or a policy only members pass) are
 * replaced in ADMIN_EXPORT_OVERRIDES. A new exporter must be added here after that review (a test checks).
 */
export const ADMIN_EXPORT_REVIEWED = [
  "profile", "students", "households", "memberships", "invitations_sent", "student_profiles", "lists", "home", "follows",
  "planner", "application_snapshots", "access_log",
] as const;

const OVERRIDE_DESCRIPTION_NOTE = " (Exported by Quad support.)";

/** Exporters that would read the admin's own data, or every family's, if run as an admin: same keys, same shapes. */
export const ADMIN_EXPORT_OVERRIDES: Record<string, AccountExporter> = {
  households: {
    key: "households",
    description: "Households you belong to, with each member's name and role." + OVERRIDE_DESCRIPTION_NOTE,
    run: async ({ supabase, userId, ownStudentId }: ExportContext) => {
      const mine = await rows<{ household_id: string }>(
        "household_members",
        supabase.from("household_members").select("household_id").or(`user_id.eq.${userId},student_id.eq.${ownStudentId ?? NONE}`),
      );
      const ids = inList(mine.map((m) => m.household_id));
      const [households, members] = await Promise.all([
        rows<{ id: string; name: string; created: string }>("households", supabase.from("households").select("id, name, created").in("id", ids).is("deleted_at", null).order("created")),
        rows<MemberRow>("household_members", supabase.from("household_members").select(MEMBER_COLUMNS).in("household_id", ids).eq("status", "active")),
      ]);
      const named = await withNames(supabase, members);
      return households.map((h) => ({
        ...h,
        members: named
          .filter((m) => m.household_id === h.id)
          .map((m) => ({ role: m.role, display_name: m.name, can_edit: m.can_edit, managed: m.managed, is_me: m.user_id === userId || (ownStudentId !== null && m.student_id === ownStudentId), joined: m.since })),
      }));
    },
  },
  invitations_sent: {
    key: "invitations_sent",
    description: "Invitations you sent (the links themselves aren't stored)." + OVERRIDE_DESCRIPTION_NOTE,
    run: ({ supabase, userId }: ExportContext) =>
      rows("invitations", supabase.from("invitations_admin").select("household_id, email, side, can_edit, created, expires_at, accepted_at, revoked_at").eq("invited_by", userId)),
  },
  home: {
    key: "home",
    description: "Your household's home as a place (city and state; support exports leave out the street address and map location); null if none is saved.",
    run: async ({ supabase, userId, ownStudentId }: ExportContext) => {
      const mine = await rows<{ household_id: string }>(
        "household_members",
        supabase.from("household_members").select("household_id").or(`user_id.eq.${userId},student_id.eq.${ownStudentId ?? NONE}`).eq("status", "active"),
      );
      const [home] = await rows("household_homes", supabase.from("household_homes_admin").select("household_id, place, set_by_name, updated_at").in("household_id", inList(mine.map((m) => m.household_id))).limit(1));
      return home ?? null;
    },
  },
  access_log: {
    key: "access_log",
    description: "When guardians viewed your information, and when you viewed a student's as a guardian." + OVERRIDE_DESCRIPTION_NOTE,
    run: async ({ supabase, userId, ownStudentId }: ExportContext) => {
      const aboutMe = ownStudentId
        ? await rows<{ at: string; table_name: string; viewer_id: string }>(
            "access_log",
            supabase.from("access_log").select("at, table_name, viewer_id").eq("student_id", ownStudentId).order("at", { ascending: false }).limit(1000),
          )
        : [];
      const names = await namesFor(supabase, aboutMe.map((r) => r.viewer_id));
      return {
        about_me: aboutMe.map((r) => ({ at: r.at, table_name: r.table_name, viewer_name: r.table_name === "admin" ? SUPPORT_VIEWER_NAME : (names.get(r.viewer_id) ?? null) })),
        my_views: await rows("access_log", supabase.from("access_log").select("student_id, table_name, at").eq("viewer_id", userId).order("at", { ascending: false }).limit(1000)),
      };
    },
  },
};

/** The exporters as the console runs them. Throws when an exporter hasn't been reviewed for admin use. */
export function adminExporters(exporters: AccountExporter[] = ACCOUNT_EXPORTERS): AccountExporter[] {
  const reviewed = new Set<string>(ADMIN_EXPORT_REVIEWED);
  const unreviewed = exporters.filter((e) => !reviewed.has(e.key)).map((e) => e.key);
  if (unreviewed.length) throw new Error(`admin export: review ${unreviewed.join(", ")} for admin use (lib/admin/people.ts ADMIN_EXPORT_REVIEWED)`);
  return exporters.map((e) => ADMIN_EXPORT_OVERRIDES[e.key] ?? e);
}

/**
 * "Export their data": the same JSON file the person's own download builds (lib/account-export.ts), read through the
 * admin policies. admin_export() first records it (account.export, and an access_log row the student sees as "Quad
 * support" for each student record included) and says which records those are.
 */
export async function exportFor(userId: string, now = new Date()): Promise<AccountExport> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("admin_export", { p_user: userId });
  if (error) throw new Error(`admin: export failed: ${error.message}`);
  const scope = data as { own_student_id: string | null; student_ids: string[] };
  const auth = (await rows<AdminAuthInfo>("auth", supabase.rpc("admin_user_auth", { p_user: userId })))[0] ?? null;
  return buildAccountExport(
    { supabase, userId, email: auth?.email ?? null, ownStudentId: scope.own_student_id, studentIds: scope.student_ids ?? [] },
    { exporters: adminExporters(), site: SITE_NAME, now },
  );
}
