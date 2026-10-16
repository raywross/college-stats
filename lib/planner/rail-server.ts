import "server-only";
/**
 * The college rail for a list-shape gap (specs/planner/next-steps/list-shape.md "The rail"): colleges at the
 * missing level, drawn from the colleges similar to the ones already on the list and Explore's "fits my numbers"
 * set, estimated fresh with the plan's own hooks, kept at the missing level, and ordered by closeness to the next
 * level up, then distance from home. Server-only: the browser calls app/api/plan/rail/route.ts; nothing here
 * reaches a client bundle. No closeness, no percentage, no estimate number ever leaves this module — only the
 * level, exactly as list-shape.md's "No ranking of colleges by quality" rule requires. The pure parts (the card
 * shape, `excludeOverLimit`, `rankRail`) live in `./rail.ts` so they're unit-testable without the dataset or the
 * estimate; this module adds `similarSchools` (lib/insights.ts, itself server-only) and the I/O.
 */
import { getData, type Dataset } from "@/lib/data";
import { crestBrand } from "@/lib/brand";
import { estimateContext, estimateMany } from "@/lib/chances/estimate";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import { gradeNow } from "@/lib/chances/courses";
import type { StandingLevel } from "@/lib/chances/types";
import { distanceFromHome } from "@/lib/home";
import { similarSchools } from "@/lib/insights";
import { fitsPreferences, fitsScores } from "@/lib/student-profile";
import type { School } from "@/lib/types";
import { hooksFromPlan } from "./hooks";
import { loadPlanFor } from "./load";
import type { ShapeGapKind } from "./list-shape";
import { avgCostOf, CANDIDATE_CAP, excludeOverLimit, rankRail, type RailCard, type RailResult } from "./rail";

export type { RailCard, RailResult } from "./rail";
export { CANDIDATE_CAP, RAIL_CAP, excludeOverLimit, rankRail } from "./rail";

/** Similar colleges drawn per listed college (list-shape.md "The rail"). */
const SIMILAR_PER_COLLEGE = 4;

/**
 * The candidates for a rail (list-shape.md "The rail" "Candidates"): the colleges similar to every one already on
 * the list, plus Explore's "fits my numbers" set — a student's saved scores and preferences both reading "in"
 * (lib/student-profile.ts fitsScores/fitsPreferences, the same predicates components/me/ExploreFitChips.tsx uses) —
 * minus the list itself, capped at `CANDIDATE_CAP` before any estimate is run.
 */
export function railCandidates(
  data: Dataset,
  listedUnitIds: readonly string[],
  profile: Parameters<typeof fitsScores>[1] | null,
): School[] {
  const listed = new Set(listedUnitIds);
  const candidates = new Map<string, School>();
  for (const unitId of listedUnitIds) {
    const school = data.getSchoolById(unitId);
    if (!school) continue;
    for (const { school: s } of similarSchools(data, school, SIMILAR_PER_COLLEGE)) {
      if (!listed.has(s.unit_id) && !candidates.has(s.unit_id)) candidates.set(s.unit_id, s);
    }
    if (candidates.size >= CANDIDATE_CAP) break;
  }
  if (profile && candidates.size < CANDIDATE_CAP) {
    for (const s of data.getAllSchools()) {
      if (candidates.size >= CANDIDATE_CAP) break;
      if (listed.has(s.unit_id) || candidates.has(s.unit_id)) continue;
      if (fitsScores(s, profile) === "in" && fitsPreferences(s, profile) === "in") candidates.set(s.unit_id, s);
    }
  }
  return [...candidates.values()].slice(0, CANDIDATE_CAP);
}

/**
 * The rail for one gap move (list-shape.md "The rail"): `loadPlanFor` for the access check (not-found for a
 * stranger or a student the caller can't see), then the candidates, a fresh estimate over them with the plan's own
 * hooks, kept at `level`, ordered, and cut down to card fields only — never a closeness or estimate number.
 */
export async function railFor(input: { studentId: string; level: StandingLevel; gap: ShapeGapKind }): Promise<RailResult> {
  const load = await loadPlanFor(input.studentId);
  if (load.kind !== "ready") return { ok: false, reason: "not-found" };
  const { ctx } = load;

  const data = await getData();
  const listedUnitIds = ctx.items.map((i) => i.unit_id);
  const limit = ctx.profile?.preferences.maxAverageCost ?? null;
  const candidates = excludeOverLimit(railCandidates(data, listedUnitIds, ctx.profile), input.gap, limit);
  if (candidates.length === 0) return { ok: true, cards: [] };

  const estimateInput = estimateInputFromProfile(ctx.profile, "", null).student;
  const estCtx = await estimateContext(estimateInput, { coreAtTopLevel: ctx.profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(ctx.gradYear, ctx.today) });
  const hooks = hooksFromPlan(ctx.items, ctx.visits, ctx.profile);
  const estimates = estimateMany(estimateInput, candidates.map((s) => s.unit_id), estCtx, hooks);

  const home = ctx.home;
  const ranked = rankRail(
    candidates.map((school) => ({ school, estimate: estimates[school.unit_id], distanceMiles: home ? distanceFromHome(school.location, home) : null })),
    input.level,
  );
  const cards: RailCard[] = ranked.map(({ school, distanceMiles }) => ({
    unitId: school.unit_id,
    name: school.name,
    state: school.location.state,
    brand: crestBrand(school),
    level: input.level,
    avgCost: avgCostOf(school),
    avgCostCite: data.citeField("cost.avg_paid_all", school),
    distanceMiles,
  }));
  return { ok: true, cards };
}
