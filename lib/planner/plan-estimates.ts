import "server-only";
/**
 * Quad's estimate for every college on a plan (specs/chances/estimate.md "In the planner"), computed on the server for
 * the plan loader (lib/planner/load.ts) and the suggestion sync (store-plan.ts syncAuto), then handed to `planView`.
 * The student and a guardian get the same estimate (a guardian sees the AP exam scores too; owner, 2026-10-11).
 * Never throws: an estimate that can't be computed leaves the rows on their stored groups.
 */
import { estimateContext, estimateMany } from "@/lib/chances/estimate";
import { gradeNow } from "@/lib/chances/courses";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import type { EstimateResult } from "@/lib/chances/types";
import type { StudentProfileData } from "@/lib/student-profile";
import { hooksFromPlan, type HooksItem } from "./hooks";
import type { PlanVisit } from "./types";

// The hooks themselves are built by the pure lib/planner/hooks.ts (legacy, recruited, and interest from visits,
// information requests, and follows); re-exported here for callers that already import them from this module.
export { hooksFromPlan, type HooksItem } from "./hooks";

export async function planEstimates(
  profile: StudentProfileData | null,
  items: readonly HooksItem[],
  opts: { gradYear: number | null; today: string; visits?: readonly Pick<PlanVisit, "item_id">[] },
): Promise<Record<string, EstimateResult>> {
  const unitIds = items.map((i) => i.unit_id);
  if (unitIds.length === 0) return {};
  try {
    const input = estimateInputFromProfile(profile, "", null).student;
    const ctx = await estimateContext(input, { coreAtTopLevel: profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(opts.gradYear, opts.today) });
    const hooks = hooksFromPlan(items, opts.visits ?? []);
    return estimateMany(input, unitIds, ctx, hooks);
  } catch (err) {
    console.error(`planner: estimates failed: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}
