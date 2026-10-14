/**
 * ED opportunities (specs/planner/next-steps/ed-opportunities.md). STUB written by U1 Foundation with the build
 * brief's exported signatures (specs/planner/next-steps/build-plan.md "Rule modules"); U2 replaces the bodies. The
 * season generator (lib/planner/generators/season.ts) calls `edOpportunities` once per regeneration and `edMoves` for
 * the moves. Pure; no I/O.
 */
import type { EstimateResult, StandingLevel } from "../chances/types.ts";
import type { Season } from "./seasons.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool } from "./types.ts";

export interface EdCandidate { itemId: string; unitId: string; round: "ed" | "ed2" | "ed_alt"; rank: number; level: StandingLevel; dream: boolean; dismissed: boolean }
/** What a candidate is read from: a list row. */
export type EdRow = Pick<PlanItem, "id" | "unit_id" | "round" | "dream" | "status" | "withdrawn_on" | "position"> & Partial<Pick<PlanItem, "ed_dismissed_at">>;
/** The ED sheet's facts (the college's own numbers, never the estimate's); U2 defines the fields. */
export type EdSheetFacts = Record<string, unknown>;

export function edOpportunities(rows: readonly EdRow[], estimates: Record<string, EstimateResult>, schools: Record<string, PlanSchool>, opts: { season: Season; today: string }): EdCandidate[] {
  void [rows, estimates, schools, opts];
  return [];
}

export function edMoves(input: GeneratorInput, candidates: readonly EdCandidate[]): GeneratedTask[] {
  void [input, candidates];
  return [];
}

export function edSheetFacts(row: EdRow, school: PlanSchool | undefined, estimate: EstimateResult | undefined): EdSheetFacts | null {
  void [row, school, estimate];
  return null;
}
