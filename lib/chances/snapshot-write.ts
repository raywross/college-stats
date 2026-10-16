/**
 * The snapshot write in the applied transition (specs/chances/calibration.md "Collecting outcomes" 1): when a college
 * is marked applied, record the student's inputs as of that day, binned, with the estimate they saw. Best-effort: it
 * never throws and never fails the user's action; a missing table or function (the migration not applied yet) reads
 * as "unavailable".
 *
 * Every dependency is injected (`SnapshotDeps`), so this module has no server-only imports and tests drive it with
 * fakes. lib/chances/snapshot-deps.ts builds the app's defaults; lib/planner/store-apply.ts `markApplied` calls
 *
 *   after(() => snapshotOnApplied(itemId, snapshotDeps(supabase)));
 *
 * The seam for the estimate: `deps.estimate`, an `AppliedEstimator` taking the same `EstimateInput` the snapshot bins
 * (built here from the saved profile by `estimateInputFromProfile`, with the list row's legacy and recruited inputs and
 * whether a visit or information request is logged for it). With none, the snapshot records the inputs and leaves the
 * estimate's columns empty.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollegeHooks, EstimateInput, RecruitedPick, SchoolOffering } from "./types.ts";
import { NO_HOOKS, RECRUITED_PICKS } from "./levels.ts";
import { buildSnapshot, estimateInputFromProfile, type AppliedEstimate } from "./snapshot.ts";
import { sanitizeProfile, withHomeState } from "../student-profile.ts";
import { homeStateForStudent } from "../home-state.ts";

/** The estimate to record for this input, or null; may throw or reject (the snapshot is then written without it). */
export type AppliedEstimator = (input: EstimateInput) => Promise<AppliedEstimate | null> | AppliedEstimate | null;

export interface SnapshotDeps {
  /** The acting user's session (row-level security and record_application_snapshot() decide). */
  supabase: Pick<SupabaseClient, "from" | "rpc">;
  estimate: AppliedEstimator | null;
  /** The student's high school's offering by id; null when unknown. */
  offeringFor: (highSchoolId: string) => Promise<SchoolOffering | null> | SchoolOffering | null;
  /** The college's overall admit rate (0–1, admissions.acceptance_rate) as the site shows it; null when unknown. */
  admitRateFor: (unitId: string) => Promise<number | null> | number | null;
}

/** written: stored. skipped: nothing to record (not applied, a guardian's own list). unavailable: the migration isn't applied. failed: logged. */
export type SnapshotOutcome = "written" | "skipped" | "unavailable" | "failed";

type DbError = { code?: string; message?: string } | null;

/** A table, column, or function that isn't there yet (the migration not applied). */
export function isMissingSchema(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache|could not find the function/i.test(error.message ?? "")
  );
}

interface ItemRow {
  list_id: string;
  unit_id: string;
  round: string | null;
  category: string | null;
  category_source?: string | null;
  applied_on: string | null;
}

async function settle<T>(f: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await f();
  } catch {
    return fallback;
  }
}

type Query = { select: (cols: string) => Query; eq: (col: string, v: unknown) => Query; limit?: (n: number) => Query; not?: (col: string, op: string, v: unknown) => Query; maybeSingle: () => PromiseLike<{ data: unknown; error: DbError }> };

/**
 * The list row's inputs for the estimate (inputs-beyond-academics.md): the legacy and recruited columns (read on their
 * own, so a database without them yet still records the snapshot), and interest when a visit or a completed
 * information request is logged for the item. Each part is best-effort; anything unreadable reads as nothing marked.
 */
export async function hooksForItem(supabase: Pick<SupabaseClient, "from">, itemId: string): Promise<CollegeHooks> {
  const from = (t: string) => supabase.from(t) as unknown as Query;
  const row = await settle(async () => {
    const r = await from("list_items").select("legacy, recruited").eq("id", itemId).maybeSingle();
    return r.error ? null : (r.data as { legacy?: unknown; recruited?: unknown } | null);
  }, null);
  // The sibling column (20261012130000_list_item_sibling.sql) is read on its own, so a database without it yet keeps
  // the legacy and recruited reads above.
  const sibling = await settle(async () => {
    const r = await from("list_items").select("legacy_sibling").eq("id", itemId).maybeSingle();
    return !r.error && (r.data as { legacy_sibling?: unknown } | null)?.legacy_sibling === true;
  }, false);
  const any = async (q: Query) => {
    if (q.limit) q = q.limit(1);
    const r = await q.maybeSingle();
    return !r.error && !!r.data;
  };
  const visited = await settle(() => any(from("plan_visits").select("id").eq("item_id", itemId)), false);
  const requested =
    visited ||
    (await settle(() => {
      const q = from("plan_tasks").select("id").eq("item_id", itemId).eq("kind", "request_info");
      // Only a request actually made (the task done), never one merely suggested.
      return q.not ? any(q.not("done_at", "is", null)) : false;
    }, false));
  const recruited = RECRUITED_PICKS.includes(row?.recruited as RecruitedPick) ? (row!.recruited as RecruitedPick) : NO_HOOKS.recruited;
  return { legacy: row?.legacy === true, sibling, recruited, interest: visited || requested };
}

/** Records the snapshot for an item just marked applied. Never throws. */
export async function snapshotOnApplied(itemId: string, deps: SnapshotDeps): Promise<SnapshotOutcome> {
  try {
    const { supabase } = deps;
    const itemRes = await supabase.from("list_items").select("list_id, unit_id, round, category, category_source, applied_on").eq("id", itemId).maybeSingle();
    if (itemRes.error) return isMissingSchema(itemRes.error) ? "unavailable" : logFailed("reading the item", itemRes.error);
    const item = itemRes.data as ItemRow | null;
    if (!item || !item.applied_on) return "skipped";

    const listRes = await supabase.from("lists").select("student_id").eq("id", item.list_id).maybeSingle();
    if (listRes.error) return logFailed("reading the list", listRes.error);
    const studentId = (listRes.data as { student_id: string | null } | null)?.student_id ?? null;
    if (!studentId) return "skipped";

    const profileRes = await supabase.from("student_profiles").select("data").eq("student_id", studentId).maybeSingle();
    const raw = profileRes.error ? undefined : (profileRes.data as { data: unknown } | null)?.data;
    // Residency from the household's address when the record has none (owner, 2026-10-16), as profilesICanSee does.
    const profile = raw === undefined ? null : withHomeState(sanitizeProfile(raw), await homeStateForStudent(supabase, studentId));

    const input: EstimateInput = { ...estimateInputFromProfile(profile, item.unit_id, item.round), hooks: await hooksForItem(supabase, itemId) };
    const hsId = input.student.highSchoolId;
    const [offering, admitRate, estimate] = await Promise.all([
      hsId ? settle(() => deps.offeringFor(hsId), null) : Promise.resolve(null),
      settle(() => deps.admitRateFor(item.unit_id), null),
      deps.estimate ? settle(() => deps.estimate!(input), null) : Promise.resolve(null),
    ]);

    const row = buildSnapshot({
      input,
      estimate,
      offering,
      admitRate,
      studentGroup: item.category_source === "student" ? item.category : null,
    });
    const { error } = await supabase.rpc("record_application_snapshot", { p_item: itemId, p_snapshot: row });
    if (error) return isMissingSchema(error) ? "unavailable" : logFailed("recording", error);
    return "written";
  } catch (err) {
    return logFailed("snapshot", { message: err instanceof Error ? err.message : String(err) });
  }
}

function logFailed(what: string, error: DbError): "failed" {
  console.error(`application snapshot: ${what} failed: ${error?.message ?? "unknown error"}`);
  return "failed";
}

/**
 * The season-end cleanup (delete_unconsented_snapshots(), the migration's rule 5) with a service-role client:
 * deletes unconsented snapshots of finished seasons. Returns how many went, or null when the function isn't there
 * yet or the call failed (logged). Never throws.
 */
export async function cleanupUnconsentedSnapshots(client: Pick<SupabaseClient, "rpc">): Promise<number | null> {
  try {
    const { data, error } = await client.rpc("delete_unconsented_snapshots");
    if (error) {
      if (!isMissingSchema(error)) console.error(`application snapshot cleanup failed: ${error.message}`);
      return null;
    }
    return typeof data === "number" ? data : Number(data ?? 0);
  } catch (err) {
    console.error(`application snapshot cleanup failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
