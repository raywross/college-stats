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
 * (built here from the saved profile by `estimateInputFromProfile`). With none, the snapshot records the inputs and
 * leaves the estimate's columns empty.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateInput, SchoolOffering } from "./types.ts";
import { buildSnapshot, estimateInputFromProfile, type AppliedEstimate } from "./snapshot.ts";
import { sanitizeProfile } from "../student-profile.ts";

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
    const profile = raw === undefined ? null : sanitizeProfile(raw);

    const input = estimateInputFromProfile(profile, item.unit_id, item.round);
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
