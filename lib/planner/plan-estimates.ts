import "server-only";
/**
 * Quad's estimate for every college on a plan (specs/chances/estimate.md "In the planner"), computed on the server for
 * the plan loader (lib/planner/load.ts) and the suggestion sync (store-plan.ts syncAuto), then handed to `planView`.
 * The student and a guardian get the same estimate (a guardian sees the AP exam scores too; owner, 2026-10-11).
 * Never throws: an estimate that can't be computed leaves the rows on their stored groups.
 */
import { estimateContext, estimateMany } from "@/lib/chances/estimate";
import { gradeNow } from "@/lib/chances/courses";
import { NO_HOOKS } from "@/lib/chances/levels";
import { estimateInputFromProfile } from "@/lib/chances/snapshot";
import type { CollegeHooks } from "@/lib/chances/types";
import { citedPaths, isEstimateFactPath } from "@/lib/chances/what-went-in";
import type { EstimateResult } from "@/lib/chances/types";
import { getData } from "@/lib/data";
import type { FieldPath } from "@/lib/fields";
import type { StudentProfileData } from "@/lib/student-profile";
import type { PlanItem, PlanSchool, PlanVisit } from "./types";

/** What hooksFromPlan reads of a list item: its id and unit id, the two per-college toggles, and the tracking row's own "logged" dates. */
export type HooksItem = Pick<PlanItem, "id" | "unit_id" | "legacy" | "recruited" | "visited_on" | "info_requested_on">;

/**
 * The hooks estimateMany reads, built from the list (specs/chances/README.md decision 5 "Hooks in requests"):
 * `legacy` and `recruited` are the row's own toggles (components/planner/AboutYouAndCollege.tsx, U8); `interest` is
 * true once a visit, interview, or information request is logged for the college — the tracking row's own date
 * fields, or an entry in `plan_visits` (lib/planner/types.ts PlanVisit, keyed by item id). A college with nothing
 * set is left out of the map (estimateMany reads a missing entry as NO_HOOKS).
 */
export function hooksFromPlan(items: readonly HooksItem[], visits: readonly Pick<PlanVisit, "item_id">[] = []): Record<string, CollegeHooks> {
  const visitedItemIds = new Set(visits.map((v) => v.item_id));
  const out: Record<string, CollegeHooks> = {};
  for (const item of items) {
    const interest = item.visited_on !== null || item.info_requested_on !== null || visitedItemIds.has(item.id);
    const hooks: CollegeHooks = { legacy: item.legacy === true, recruited: item.recruited ?? NO_HOOKS.recruited, interest };
    if (hooks.legacy || hooks.recruited !== "none" || hooks.interest) out[item.unit_id] = hooks;
  }
  return out;
}

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

/**
 * The plan's colleges with the citations their estimates name added to `cites`, so the row drawer's "What went into
 * this estimate" can show a source beside each fact (the plan page resolves them here because the browser has no
 * dataset). Only the fields an estimate cites, only where the estimate cites them; a college without an estimate is
 * unchanged.
 */
export async function withFactCites(schools: Record<string, PlanSchool>, estimates: Record<string, EstimateResult>): Promise<Record<string, PlanSchool>> {
  const { getSchoolById, citeField } = await getData();
  const out = { ...schools };
  for (const [id, est] of Object.entries(estimates)) {
    const planSchool = schools[id];
    const school = getSchoolById(id);
    if (!planSchool || !school) continue;
    const cites = { ...planSchool.cites };
    for (const path of citedPaths(est)) if (isEstimateFactPath(path) && !(path in cites)) cites[path] = citeField(path as FieldPath, school);
    out[id] = { ...planSchool, cites };
  }
  return out;
}
