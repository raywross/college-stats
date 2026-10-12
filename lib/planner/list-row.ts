/**
 * Pure helpers for the list the plan shows (specs/planner/redesign/list.md), U3's own file so PlanList, PlanRow, and
 * their tests can share them without touching lib/planner/plan-view.ts: the group sections (Reach, Target, Likely,
 * Not sorted yet), the header line, the round chip's "EA · Nov 1" label, the deadline strike-through and urgency
 * rules, and whether a student has picked rounds yet (decision 12: an underclassman's rows show "Round picked senior
 * year" instead). Groups are Quad's only now (no chip to cycle, no sort menu): the student-facing controls this file
 * once supported for those are gone. No server or browser APIs.
 */
import { CATEGORY_LABELS, type ListCategory, type ListRound } from "../list-rules.ts";
import type { PlanRowView, SeasonStatus } from "./plan-view.ts";
import type { Grade } from "./cycle.ts";
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

/** list.md "The row chip": "EA · Nov 1", or just the round's short name when it has no date on record. */
export function roundOptionLabel(round: ListRound, closingIso: string | null): string {
  return closingIso ? `${ROUND_SHORT[round]} · ${dayLabel(closingIso)}` : ROUND_SHORT[round];
}

/** list.md "The row": a deadline strikes through once it's past. */
export function isPastDeadline(iso: string | null, today: string): boolean {
  return iso !== null && iso < today;
}

/** list.md "The row": the deadline is bold within a week (0–7 days out, not past). */
export function isUrgentDeadline(iso: string | null, today: string): boolean {
  if (iso === null) return false;
  const days = (Date.parse(iso) - Date.parse(today)) / 86_400_000;
  return days >= 0 && days <= 7;
}

/** list.md "Underclassmen" (decision 12): a student hasn't picked rounds until senior year starts. */
const ROUNDS_PICKED_GRADES: ReadonlySet<Grade> = new Set(["senior_fall", "senior_winter", "senior_spring", "summer_after", "graduated"]);
export function roundsPicked(grade: Grade): boolean {
  return ROUNDS_PICKED_GRADES.has(grade);
}

/** list.md "Grouped by Reach / Target / Likely" + "Not sorted yet": the group pill's heading text. */
export const GROUP_HEADING: Record<ListCategory, string> = { ...CATEGORY_LABELS, unsorted: "Not sorted yet" };

const GROUP_SECTION_ORDER: readonly ListCategory[] = ["reach", "target", "likely", "unsorted"];

export interface RowGroup {
  group: ListCategory;
  rows: PlanRowView[];
}

/** list.md "Grouped by...": the rows split into their group sections, in that order, empty ones left out. `rows`
 * is assumed already ordered (plan-view.ts: Dream first, then by group, then list position), so each section keeps
 * that order and a group's Dream (if it has one) stays first within it. */
export function groupedRows(rows: readonly PlanRowView[]): RowGroup[] {
  return GROUP_SECTION_ORDER.map((group) => ({ group, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length > 0);
}

/** list.md "Header line": "8 colleges". */
export function headerCountsLine(rows: readonly PlanRowView[]): string {
  return `${rows.length} college${rows.length === 1 ? "" : "s"}`;
}

/** list.md "Header line": "✦ suggested round", shown on desktop while any row's round is still the starting one
 * (groups are never a suggestion anymore, so this only tracks rounds). */
export function anySuggestedRound(rows: readonly PlanRowView[]): boolean {
  return rows.some((r) => r.roundAuto);
}

const GROUP_WORD: Record<Exclude<ListCategory, "unsorted">, string> = { reach: "Reach", target: "Target", likely: "Likely" };

/** list.md "The drawer", line 3: the score move, or the optional-score advice, whichever the model has for this row. */
export function scoreDrawerLine(row: Pick<PlanRowView, "moveUp" | "standing">): string | null {
  if (row.moveUp) return `A ${row.moveUp.score} would make this a ${GROUP_WORD[row.moveUp.to]}.`;
  if (row.standing?.send === "consider-not-sending") return "Optional here: consider not sending.";
  return null;
}
