/**
 * The college rail's pure parts (specs/planner/next-steps/list-shape.md "The rail"): the card shape, the cost
 * exclusion, and the ranking — split out of lib/planner/rail-server.ts (which needs `similarSchools`,
 * `lib/insights.ts`, itself `server-only`) so they're unit-testable without the dataset or the estimate
 * (tests/planner-list-shape.test.mts). No I/O; safe in tests and, in principle, client code, though only the
 * server module is actually imported anywhere.
 */
import type { EstimateResult, StandingLevel } from "../chances/types.ts";
import type { School } from "../types.ts";
import type { ShapeGapKind } from "./list-shape.ts";

export interface RailCard {
  unitId: string;
  name: string;
  state: string | null;
  brand?: unknown;
  level: StandingLevel;
  avgCost: number | null;
  /** The citation for `avgCost` (lib/fields.ts citeField), serialized loosely like PlanSchool's own `avgCostCite`. */
  avgCostCite?: unknown;
  distanceMiles: number | null;
}

export type RailResult = { ok: true; cards: RailCard[] } | { ok: false; reason: "not-found" };

/** Most candidates estimated in one call (list-shape.md "The rail": "about 60"), before the level filter and cap. */
export const CANDIDATE_CAP = 60;
/** Cards a rail shows at most (list-shape.md "The rail"). */
export const RAIL_CAP = 12;

/** A college's average cost the way the plan itself shows it (lib/planner/context.ts planSchoolFor): only
 * `avg_paid_all`, never a sticker-price fallback. */
export function avgCostOf(school: Pick<School, "cost">): number | null {
  return school.cost?.avg_paid_all ?? null;
}

/** Excludes anything over the family's cost limit, when the gap is affordability (list-shape.md "The rail"). */
export function excludeOverLimit(schools: readonly School[], gap: ShapeGapKind, limit: number | null): School[] {
  if (gap !== "affordable" || limit === null) return [...schools];
  return schools.filter((s) => {
    const cost = avgCostOf(s);
    return cost === null || cost <= limit;
  });
}

export interface RankInput {
  school: School;
  estimate: EstimateResult | undefined;
  distanceMiles: number | null;
}

/** Kept at the missing level, closeness to the next level up first, then distance from home (list-shape.md "The
 * rail"). */
export function rankRail(rows: readonly RankInput[], level: StandingLevel): RankInput[] {
  return rows
    .filter((r) => r.estimate?.group === level)
    .sort((a, b) => (b.estimate?.closeness ?? -1) - (a.estimate?.closeness ?? -1) || (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, RAIL_CAP);
}
