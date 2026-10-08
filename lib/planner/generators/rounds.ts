/**
 * The `rounds` generator (U3; specs/planner/early-rounds.md, timeline.md "Generators" → `stage`): one student-wide
 * `decide_rounds` step, due six weeks before the earliest early-round deadline on the list, while the plan is in season
 * and some college offers an early round. Its date carries the deadline's lineage (field, edition, last-cycle note).
 * Accepting the rounds plan ticks it (lib/planner/store-rounds.ts).
 *
 * Contract (lib/planner/tasks.ts): pure, no I/O; key `{list_id}:decide_rounds:-`.
 */
import { inSeason } from "../cycle.ts";
import { addDays } from "../stage.ts";
import { taskKey } from "../tasks.ts";
import { earliestEarlyDeadline, ROUND_SHORT } from "../rounds.ts";
import type { GeneratedTask, GeneratorInput } from "../types.ts";

/** How long before the earliest early deadline the decision is due. */
export const DECIDE_ROUNDS_LEAD_DAYS = 42;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export function generate(input: GeneratorInput): GeneratedTask[] {
  if (!inSeason(input.grade)) return [];
  const earliest = earliestEarlyDeadline(input.items, input.schools);
  if (!earliest) return [];
  const item = input.items.find((i) => i.id === earliest.itemId)!;
  const school = input.schools[item.unit_id];
  const round = earliest.date.field.includes("early_decision.first")
    ? "ed"
    : earliest.date.field.includes("early_decision.other")
      ? "ed2"
      : school?.profile?.early_action?.restrictive
        ? "rea"
        : "ea";
  return [
    {
      key: taskKey(input.list.id, "decide_rounds"),
      item_id: null,
      kind: "decide_rounds",
      title: "Decide your application rounds",
      detail: `Who gets ED, EA, or REA, before the first early deadline: ${school?.name ?? "a college"} ${ROUND_SHORT[round]}, ${day(earliest.date.iso)}. Open Rounds to see the proposal.`,
      due_on: addDays(earliest.date.iso, -DECIDE_ROUNDS_LEAD_DAYS),
      window_start: null,
      window_end: null,
      assignee: "student",
      source: "stage",
      source_field: earliest.date.field,
      source_edition: earliest.dates.edition,
      date_note: earliest.dates.lastCycle ? "last_cycle" : null,
      position: 0,
    },
  ];
}
