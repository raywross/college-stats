/**
 * The list's shape by season (specs/planner/next-steps/list-shape.md). STUB written by U1 Foundation with the build
 * brief's exported signatures (specs/planner/next-steps/build-plan.md "Rule modules"); U4 replaces the bodies. The
 * season generator (lib/planner/generators/season.ts) calls `shapeGaps` once per regeneration and `shapeTasks` for
 * the move. Pure; no I/O.
 */
import type { StandingLevel } from "../chances/types.ts";
import type { Season } from "./seasons.ts";
import type { Assignee, GeneratedTask, GeneratorInput } from "./types.ts";

export type ShapeGapKind = "likely_min" | "affordable" | "target_min" | "reach_min" | "over_max" | "total_off";
export interface ShapeGap { kind: ShapeGapKind; level: StandingLevel | null; who: Assignee; line: string }
/** A season's shape: the total range and each level's range, [min, max]. U4 fills it. */
export interface Shape { total: [number, number]; levels: Partial<Record<StandingLevel, [number, number]>> }

export const LIST_SHAPE: Partial<Record<Season, Shape>> = {};

export function shapeFor(season: Season): Shape | null {
  return LIST_SHAPE[season] ?? null;
}

export function shapeGaps(counts: Record<StandingLevel, number>, unsorted: number, season: Season, affordability: "ok" | "none" | "unknown"): ShapeGap[] {
  void [counts, unsorted, season, affordability];
  return [];
}

export function countLine(counts: Record<StandingLevel, number>): string {
  void [counts];
  return "";
}

export function shapeTasks(input: GeneratorInput, gaps: readonly ShapeGap[]): GeneratedTask[] {
  void [input, gaps];
  return [];
}
