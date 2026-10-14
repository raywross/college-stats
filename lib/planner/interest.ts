/**
 * Interest and visits (specs/planner/next-steps/interest-and-visits.md). STUB written by U1 Foundation with the build
 * brief's exported signatures (specs/planner/next-steps/build-plan.md "Rule modules"); U3 replaces the bodies. The
 * season generator (lib/planner/generators/season.ts) calls `interestMoves` once per regeneration and
 * `interestTasks` for the moves. Pure; no I/O.
 */
import type { CollegeHooks, EstimateResult } from "../chances/types.ts";
import type { EdCandidate } from "./ed-opportunities.ts";
import type { Season } from "./seasons.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool } from "./types.ts";

export interface InterestMove { itemId: string; rule: "visit_ed" | "important" | "considered"; kind: "visit_ed" | "show_interest" }

export function interestMoves(
  rows: readonly PlanItem[],
  estimates: Record<string, EstimateResult>,
  schools: Record<string, PlanSchool>,
  hooks: Record<string, CollegeHooks>,
  edCandidates: readonly EdCandidate[],
  opts: { season: Season; today: string },
): InterestMove[] {
  void [rows, estimates, schools, hooks, edCandidates, opts];
  return [];
}

export function interestTasks(input: GeneratorInput, moves: readonly InterestMove[]): GeneratedTask[] {
  void [input, moves];
  return [];
}
