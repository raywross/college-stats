/**
 * What `npm run purge-accounts` hard-deletes (specs/product/accounts.md "Data handling"): accounts, student records,
 * and households soft-deleted more than DELETE_GRACE_DAYS ago. Pure, so the selection is unit-tested
 * (tests/purge-accounts.test.mts) without a database.
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
 * Everything soft-deleted at least `graceDays` before `now`. A student record with its own account is purged only
 * with that account: a student's data survives while their user exists, whatever its deleted_at says.
 */
export function planPurge(
  { profiles, students, households }: { profiles: PurgeProfile[]; students: PurgeStudent[]; households: PurgeHousehold[] },
  now: Date,
  graceDays = 30,
): PurgePlan {
  if (!Number.isFinite(graceDays) || graceDays < 30) throw new Error(`purge: the grace period can't be shorter than 30 days (got ${graceDays})`);
  const cutoff = now.getTime() - graceDays * DAY_MS;
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

/** `--apply` deletes; anything else (including `--dry-run`, the default) only prints the plan. */
export function parsePurgeArgs(argv: string[]): { apply: boolean; days: number } {
  let apply = false;
  let days = 30;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a === "--days") days = Number(argv[++i]);
    else throw new Error(`purge-accounts: unknown argument ${a} (use --dry-run, --apply, --days N)`);
  }
  if (argv.includes("--apply") && argv.includes("--dry-run")) throw new Error("purge-accounts: choose --dry-run or --apply, not both");
  return { apply, days };
}
