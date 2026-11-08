import "server-only";
/**
 * Quad's estimate for every college on a plan (specs/chances/estimate.md "In the planner"), computed on the server for
 * the plan loader (lib/planner/load.ts) and the suggestion sync (store-plan.ts syncAuto), then handed to `planView`.
 * The student and a guardian get the same estimate (a guardian sees the AP exam scores too; owner, 2026-10-11).
 * Never throws: an estimate that can't be computed leaves the rows on their stored groups.
 */
import { estimateContext, estimateMany, type EstimateContext } from "@/lib/chances/estimate";
import { span } from "@/lib/timing";
import { gradeNow } from "@/lib/chances/courses";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import type { EstimateResult } from "@/lib/chances/types";
import type { StudentProfileData } from "@/lib/student-profile";
import { hooksFromPlan, type HooksItem } from "./hooks";
import type { PlanVisit } from "./types";

// The hooks themselves are built by the pure lib/planner/hooks.ts (legacy, recruited, and interest from visits,
// information requests, and follows); re-exported here for callers that already import them from this module.
export { hooksFromPlan, type HooksItem } from "./hooks";

/**
 * The estimate at every college on the plan. `opts.context` is the estimate context the plan loader already started
 * from the profile's high school (lib/planner/load.ts, its second wave: the high school's reads, started as soon as the
 * profile resolved), so they're never waited on twice; the coursework answers and the grade are this call's, laid over
 * it. Without one the context is built here. Two spans (specs/serving-architecture.md "Timing a request"):
 * `estimates.context` (waiting on the reads) and `estimates.compute` (the per-college math).
 */
export async function planEstimates(
  profile: StudentProfileData | null,
  items: readonly HooksItem[],
  opts: { gradYear: number | null; today: string; visits?: readonly Pick<PlanVisit, "item_id">[]; context?: Promise<EstimateContext> },
): Promise<Record<string, EstimateResult>> {
  const unitIds = items.map((i) => i.unit_id);
  if (unitIds.length === 0) return {};
  try {
    const input = estimateInputFromProfile(profile, "", null).student;
    const prepared = opts.context;
    const ctx = await span("estimates.context", async () =>
      prepared
        ? { ...(await prepared), coreAtTopLevel: profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(opts.gradYear, opts.today) }
        : estimateContext(input, { coreAtTopLevel: profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(opts.gradYear, opts.today) }),
    );
    return await span("estimates.compute", () => {
      const hooks = hooksFromPlan(items, opts.visits ?? [], profile);
      return estimateMany(input, unitIds, ctx, hooks);
    });
  } catch (err) {
    console.error(`planner: estimates failed: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * The estimate context's reads for a profile, started without waiting for anything else (lib/planner/load.ts chains it
 * on the profile's promise): the high school's offering and state (lib/chances/estimate.ts estimateContext), keyed by
 * the same high school id planEstimates reads from the profile. planEstimates lays the coursework answers and the grade
 * over it. Never rejects unhandled: a failure surfaces where planEstimates awaits it (and is caught there).
 */
export function startEstimateContext(profile: StudentProfileData | null): Promise<EstimateContext> {
  const p = estimateContext({ highSchoolId: estimateInputFromProfile(profile, "", null).student.highSchoolId });
  p.catch(() => {});
  return p;
}
