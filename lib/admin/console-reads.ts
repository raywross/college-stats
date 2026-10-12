import "server-only";
/**
 * Reads only the console's own pages need, beside the typed readers in lib/admin/people.ts: the landing page's counts
 * and the pickers' searches. Same rules as people.ts: admin only (requireAdmin first), through adminSupabase() so the
 * "Admins read" policies apply, and a failed read throws a message naming what failed.
 */
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase, searchPeople, type SearchKind, type SearchRow } from "@/lib/admin/people";

export interface AdminCounts {
  people: number;
  paused: number;
  deleting: number;
  households: number;
  /** Student records with no account of their own (a parent made them). */
  managedStudents: number;
  pendingInvitations: number;
  admins: number;
}

type CountResult = PromiseLike<{ count: number | null; error: { message: string } | null }>;

async function count(what: string, query: CountResult): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw new Error(`admin: counting ${what} failed: ${error.message}`);
  return n ?? 0;
}

/** The landing page's numbers. */
export async function adminCounts(): Promise<AdminCounts> {
  await requireAdmin();
  const s = await adminSupabase();
  const head = { count: "exact", head: true } as const;
  const [people, paused, deleting, households, managedStudents, pendingInvitations, admins] = await Promise.all([
    count("people", s.from("profiles").select("id", head).is("deleted_at", null)),
    count("paused accounts", s.from("profiles").select("id", head).is("deleted_at", null).not("suspended_at", "is", null)),
    count("accounts being deleted", s.from("profiles").select("id", head).not("deleted_at", "is", null)),
    count("households", s.from("households").select("id", head).is("deleted_at", null)),
    count("managed students", s.from("students").select("id", head).is("deleted_at", null).is("user_id", null)),
    count("invitations", s.from("invitations_admin").select("id", head).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())),
    count("admins", s.from("admins").select("user_id", head).is("revoked_at", null)),
  ]);
  return { people, paused, deleting, households, managedStudents, pendingInvitations, admins };
}

/** Search for the pickers: only the kinds the picker can use, and never a closed or deleted household or record. */
export async function findPeople(q: string, kinds: SearchKind[], max = 20): Promise<SearchRow[]> {
  const rows = await searchPeople(q, 50);
  return rows.filter((r) => kinds.includes(r.kind) && r.status !== "deleting").slice(0, max);
}
