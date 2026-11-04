/**
 * Calling the batched-read functions (supabase/migrations/20261012140000_plan_bundle.sql; U20 "real speed") with a
 * Supabase client the caller built, and knowing when they aren't there yet. Until the owner applies the migration,
 * every call answers "missing" and the callers fall back to the per-table reads they always made (the pattern the
 * planner used for missing columns, lib/planner/read-plan.ts). A missing function is remembered for a minute per
 * server instance, so a deploy without the SQL makes one wasted call a minute, not one per request, and picks the
 * functions up within a minute of the SQL being applied.
 *
 * Pure (no server-only imports) so tests run it against a fake client (tests/bundles.test.mts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CounselorGrant, HouseholdMember, Profile, StudentRecord } from "./accounts.ts";
import type { RosterMember } from "./household-rules.ts";
import type { PlanData, PlanList } from "./planner/read-plan.ts";
import type { PlanItem, PlanNudge, PlanOffer, PlanTask, PlanVisit } from "./planner/types.ts";

export type BundleFunction = "viewer_bundle" | "plan_bundle" | "save_student_profile";

type PgError = { code?: string; message?: string };

/** The function isn't in the database (or PostgREST's schema cache) yet. */
export function isMissingFunction(error: PgError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|function .* does not exist/i.test(error.message ?? "");
}

const MISSING_FOR_MS = 60_000;
const missingUntil = new Map<BundleFunction, number>();

/** For tests: forget what was learned about missing functions. */
export function resetMissingBundles(): void {
  missingUntil.clear();
}

export type BundleCall<T> = { kind: "ok"; data: T } | { kind: "missing" } | { kind: "error"; error: PgError };

/** One RPC; "missing" (remembered for a minute) when the function isn't there. */
export async function callBundle<T>(client: SupabaseClient, fn: BundleFunction, args: Record<string, unknown> = {}, now: () => number = Date.now): Promise<BundleCall<T>> {
  const until = missingUntil.get(fn);
  if (until !== undefined && now() < until) return { kind: "missing" };
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    if (isMissingFunction(error)) {
      missingUntil.set(fn, now() + MISSING_FOR_MS);
      return { kind: "missing" };
    }
    return { kind: "error", error };
  }
  missingUntil.delete(fn);
  return { kind: "ok", data: data as T };
}

/** viewer_bundle(): who is signed in and what they can see, as the per-table reads return it. */
export interface ViewerBundle {
  profile: Profile | null;
  students: StudentRecord[];
  members: HouseholdMember[];
  households: { id: string; name: string; created: string; members: RosterMember[] }[];
  student_profiles: { student_id: string; data: unknown }[];
  home: Record<string, unknown> | null;
  /**
   * The caller's live grants as a member of a counselor organization (20261102120000_organizations.sql). Absent from a
   * viewer_bundle() defined before that migration, when no organization exists yet: read it as [].
   */
  grants?: CounselorGrant[];
}

/** plan_bundle(): one student's row and their (default or named) list's plan. */
export interface PlanBundle {
  student: StudentRecord | null;
  list: PlanList | null;
  items: PlanItem[];
  tasks: PlanTask[];
  visits: PlanVisit[];
  offers: PlanOffer[];
  nudges: PlanNudge[];
}

/** A plan bundle as readPlan's PlanData (null when the list isn't there or readable, as readPlan returns). */
export function planDataFromBundle(b: PlanBundle): PlanData | null {
  if (!b.list) return null;
  // Next steps' columns read as their defaults from a plan_bundle() defined before 20261014120000_next_steps.sql.
  const items = (b.items ?? []).map((i) => ({ ...i, ed_dismissed_at: i.ed_dismissed_at ?? null, ed_checks: i.ed_checks ?? {} }));
  // Plan v3's skip record reads as null from a plan_bundle() defined before 20261016120000_plan_v3.sql.
  const tasks = (b.tasks ?? []).map((t) => ({ ...t, season: t.season ?? null, action: t.action ?? null, dismissed_at: t.dismissed_at ?? null, dismissed_by: t.dismissed_by ?? null }));
  return { list: b.list, items, tasks, visits: b.visits ?? [], offers: b.offers ?? [], nudges: b.nudges ?? [] };
}

/** Whether `fn` was found missing within the last minute (callers then start their per-table reads right away). */
export function bundleKnownMissing(fn: BundleFunction, now: () => number = Date.now): boolean {
  const until = missingUntil.get(fn);
  return until !== undefined && now() < until;
}
