/**
 * Pure helpers for the list the plan shows (specs/planner/redesign/list.md), U3's own file so PlanList, PlanRow, and
 * their tests can share them without touching lib/planner/plan-view.ts: the header counts line, the sort control
 * that survives after ranking's removal (distance, cost, deadline stay; "My order" is the Dream/group order plan-view
 * already computes), the group chip's cycle, the round chip's "EA · Nov 1" label, and the deadline strike-through
 * rule. No server or browser APIs.
 */
import type { ListCategory, ListRound } from "../list-rules.ts";
import type { PickedGroup } from "./plan-writes.ts";
import type { PlanRowView, SeasonStatus } from "./plan-view.ts";
import { ROUND_SHORT } from "./rounds.ts";

/** list.md "The row": the status chip's labels, once the season starts. */
export const SEASON_STATUS_LABEL: Record<SeasonStatus, string> = {
  not_started: "Not started",
  working: "Working on it",
  submitted: "Submitted",
  decision: "Decision",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 1" from a yyyy-mm-dd. */
export function dayLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** list.md "The round chip": "EA · Nov 1", or just the round's short name when it has no date on record. */
export function roundOptionLabel(round: ListRound, closingIso: string | null): string {
  return closingIso ? `${ROUND_SHORT[round]} · ${dayLabel(closingIso)}` : ROUND_SHORT[round];
}

/** list.md "The row": a deadline strikes through once it's past. */
export function isPastDeadline(iso: string | null, today: string): boolean {
  return iso !== null && iso < today;
}

/** standing.md "Suggested until changed": tapping the group chip cycles Reach → Target → Likely → Reach; from Unsorted it starts at Reach. */
const GROUP_CYCLE: Record<ListCategory, PickedGroup> = { reach: "target", target: "likely", likely: "reach", unsorted: "reach" };
export function nextGroup(current: ListCategory): PickedGroup {
  return GROUP_CYCLE[current];
}

const GROUP_ORDER: Record<ListCategory, number> = { reach: 0, target: 1, likely: 2, unsorted: 3 };

/** list.md "Order": Dream first, then Reach, Target, Likely, then the student's own order within each group. */
function defaultCompare(a: PlanRowView, b: PlanRowView): number {
  return Number(b.dream) - Number(a.dream) || GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.item.position - b.item.position;
}

const numKey = (n: number | null | undefined): number => (n === null || n === undefined ? Infinity : n);
const dateKey = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Infinity);

/** list.md "Around the list": the sort menu kept from stage 1, ranking dropped. "default" is the Dream/group order. */
export type RowSort = "default" | "deadline" | "avg_cost" | "distance";

export const ROW_SORT_OPTIONS: readonly { value: RowSort; label: string; needs?: string }[] = [
  { value: "default", label: "Dream, then group" },
  { value: "deadline", label: "Deadline" },
  { value: "avg_cost", label: "Average cost" },
  { value: "distance", label: "Distance", needs: "a home address" },
];

/** Orders the list's rows by the chosen sort; a row missing the sort's own field sorts to the end, ties broken by the default order. Never mutates the input. */
export function sortRows(rows: readonly PlanRowView[], sort: RowSort): PlanRowView[] {
  const out = [...rows];
  switch (sort) {
    case "deadline":
      return out.sort((a, b) => dateKey(a.deadline?.iso) - dateKey(b.deadline?.iso) || defaultCompare(a, b));
    case "avg_cost":
      return out.sort((a, b) => numKey(a.school?.avgCost) - numKey(b.school?.avgCost) || defaultCompare(a, b));
    case "distance":
      return out.sort((a, b) => numKey(a.school?.distanceMiles) - numKey(b.school?.distanceMiles) || defaultCompare(a, b));
    default:
      return out.sort(defaultCompare);
  }
}

const GROUP_WORD: Record<Exclude<ListCategory, "unsorted">, string> = { reach: "Reach", target: "Target", likely: "Likely" };

/** list.md "Header line": "8 colleges · 2 Reach · 4 Target · 2 Likely". */
export function headerCountsLine(rows: readonly PlanRowView[]): string {
  const counts: Record<Exclude<ListCategory, "unsorted">, number> = { reach: 0, target: 0, likely: 0 };
  for (const r of rows) if (r.group !== "unsorted") counts[r.group]++;
  const parts = (["reach", "target", "likely"] as const).filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${GROUP_WORD[k]}`);
  return [`${rows.length} college${rows.length === 1 ? "" : "s"}`, ...parts].join(" · ");
}

/** list.md "Header line": "✦ = sorted for you; tap to change", shown while anything on the row is still a suggestion. */
export function anySuggested(rows: readonly PlanRowView[]): boolean {
  return rows.some((r) => r.groupAuto || r.roundAuto);
}

/** list.md "The drawer", line 3: the score move, or the optional-score advice, whichever the model has for this row. */
export function scoreDrawerLine(row: Pick<PlanRowView, "moveUp" | "standing">): string | null {
  if (row.moveUp) return `A ${row.moveUp.score} would make this a ${GROUP_WORD[row.moveUp.to]}.`;
  if (row.standing?.send === "consider-not-sending") return "Optional here: consider not sending.";
  return null;
}
