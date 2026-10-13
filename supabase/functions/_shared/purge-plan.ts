/**
 * What a hard delete removes (specs/product/accounts.md "Data handling"): accounts, student records, and households
 * that were soft-deleted. Pure, so the selection is unit-tested without a database (tests/purge-accounts.test.mts,
 * tests/admin-auth-function.test.mts). Shared by two callers, so the rule lives in one place:
 *   - `npm run purge-accounts` (scripts/purge-accounts.mts, through scripts/lib/purge-accounts-plan.mts): everything
 *     soft-deleted more than the grace period ago, `planPurge()`;
 *   - the admin-auth Edge Function's `purge` op ("Delete now" in /admin, specs/product/admin.md): one soft-deleted
 *     account and what was deleted with it, today, `planPurgeForUser()`.
 * It lives under supabase/functions/_shared/ because the Edge Function bundle can only reach files inside
 * supabase/functions/ (folders starting with `_` are not deployed as functions). Only Web-standard globals; no imports.
 */

export interface PurgeProfile {
  id: string;
  deleted_at: string | null;
}
export interface PurgeStudent {
  id: string;
  user_id: string | null;
  deleted_at: string | null;
}
export interface PurgeHousehold {
  id: string;
  deleted_at: string | null;
}

export interface PurgePlan {
  cutoff: string;
  /** Auth users to delete (the Auth admin API; their profile, memberships, and access-log rows cascade). */
  users: string[];
  /** Soft-deleted student records to delete (their memberships and access-log rows cascade). */
  students: string[];
  /** Closed households to delete (their memberships and invitations cascade). */
  households: string[];
  /** Soft-deleted students kept because their own account still exists (shouldn't happen; reported). */
  skippedStudents: string[];
}

const DAY_MS = 86_400_000;

function expired(deletedAt: string | null, cutoff: number): boolean {
  if (!deletedAt) return false;
  const t = Date.parse(deletedAt);
  return Number.isFinite(t) && t <= cutoff;
}

/**
 * The selection both callers share: every row soft-deleted at or before `cutoff` (ms). A student record with its own
 * account is purged only with that account: a student's data survives while their user exists, whatever its
 * deleted_at says.
 */
function selectPurge(
  { profiles, students, households }: { profiles: PurgeProfile[]; students: PurgeStudent[]; households: PurgeHousehold[] },
  cutoff: number,
): PurgePlan {
  const users = profiles.filter((p) => expired(p.deleted_at, cutoff)).map((p) => p.id);
  const purging = new Set(users);
  const oldStudents = students.filter((s) => expired(s.deleted_at, cutoff));
  return {
    cutoff: new Date(cutoff).toISOString(),
    users,
    students: oldStudents.filter((s) => s.user_id === null || purging.has(s.user_id)).map((s) => s.id),
    households: households.filter((h) => expired(h.deleted_at, cutoff)).map((h) => h.id),
    skippedStudents: oldStudents.filter((s) => s.user_id !== null && !purging.has(s.user_id)).map((s) => s.id),
  };
}

/** Everything soft-deleted at least `graceDays` (30 or more) before `now`: `npm run purge-accounts`. */
export function planPurge(
  rows: { profiles: PurgeProfile[]; students: PurgeStudent[]; households: PurgeHousehold[] },
  now: Date,
  graceDays = 30,
): PurgePlan {
  if (!Number.isFinite(graceDays) || graceDays < 30) throw new Error(`purge: the grace period can't be shorter than 30 days (got ${graceDays})`);
  return selectPurge(rows, now.getTime() - graceDays * DAY_MS);
}

/** A student record as `planPurgeForUser` needs it: who manages it, to find the managed records deleted with an account. */
export interface PurgeUserStudent extends PurgeStudent {
  managed_by: string | null;
}

/**
 * The rows admin-auth reads for one account: its profile, the student records it owns or manages
 * (`user_id = user or managed_by = user`, soft-deleted), and the households closed at the account's `deleted_at`.
 */
export interface PurgeUserRows {
  profile: PurgeProfile | null;
  students: PurgeUserStudent[];
  households: PurgeHousehold[];
}

export type PurgeUserPlan = { ok: true; plan: PurgePlan } | { ok: false; reason: "not_deleted" };

function sameInstant(a: string | null, t: number): boolean {
  return a !== null && Date.parse(a) === t;
}

/**
 * "Delete now" for one account, without waiting for the grace period: refused unless the account is soft-deleted.
 * What goes is what `delete_my_account()` (or `admin_delete_account()`) soft-deleted with it, all stamped with the
 * same `deleted_at` in that one transaction: its own student record, the managed records it was the last guardian of,
 * and the households it left empty. Then the same selection as the scheduled purge runs over just those rows, with the
 * account's deletion time as the cutoff, so the two can't drift apart.
 */
export function planPurgeForUser(userId: string, rows: PurgeUserRows): PurgeUserPlan {
  const deletedAt = rows.profile && rows.profile.id === userId ? rows.profile.deleted_at : null;
  const t = deletedAt ? Date.parse(deletedAt) : NaN;
  if (!deletedAt || !Number.isFinite(t)) return { ok: false, reason: "not_deleted" };
  const students = rows.students.filter(
    (s) => s.user_id === userId || (s.user_id === null && s.managed_by === userId && sameInstant(s.deleted_at, t)),
  );
  const households = rows.households.filter((h) => sameInstant(h.deleted_at, t));
  return { ok: true, plan: selectPurge({ profiles: [{ id: userId, deleted_at: deletedAt }], students, households }, t) };
}
