/**
 * The `rounds` generator (U6; specs/planner/redesign/rounds.md "Money"; timeline.md "Generators" → `stage`): a
 * `cost_check` task per non-withdrawn, not-yet-applied/decided row sitting in ED or ED II, due 21 days before that
 * round's closing date, assigned to the guardian ("Check the cost of Wake Forest together before applying ED I").
 * Keyed by item and round, so moving the round off ED/ED II (or applying/withdrawing/deciding) orphans it through
 * mergeTasks — the point of a new proposal-era `decide_rounds` step is gone (build-plan.md "Review notes" #6), so
 * this generator no longer emits it.
 *
 * Nothing without a published closing date; nothing on a guardian's own list. Pure, no I/O.
 */
import { taskKey } from "../tasks.ts";
import { ROUND_SHORT, roundDates } from "../rounds.ts";
import { addDays } from "../stage.ts";
import type { GeneratedTask, GeneratorInput } from "../types.ts";

/** How long before the round's closing date the cost check is due. */
export const COST_CHECK_LEAD_DAYS = 21;

export function generate(input: GeneratorInput): GeneratedTask[] {
  if (input.list.student_id === null) return [];
  const out: GeneratedTask[] = [];
  for (const item of input.items) {
    if (item.withdrawn_on) continue;
    if (item.round !== "ed" && item.round !== "ed2") continue;
    if (item.status === "applied" || item.status === "decided") continue;
    const school = input.schools[item.unit_id];
    const dates = roundDates(school, item.round);
    if (!dates.closing) continue;
    out.push({
      key: taskKey(input.list.id, "cost_check", `${item.id}:${item.round}`),
      item_id: item.id,
      kind: "cost_check",
      title: `Check the cost of ${school?.name ?? "the college"} together before applying ${ROUND_SHORT[item.round]}`,
      detail: school?.links?.price_calculator
        ? `ED and ED II are binding, except for aid that makes attending impossible: use the net price calculator before applying. ${school.links.price_calculator}`
        : "ED and ED II are binding, except for aid that makes attending impossible: check together what it would really cost before applying.",
      due_on: addDays(dates.closing.iso, -COST_CHECK_LEAD_DAYS),
      window_start: null,
      window_end: null,
      assignee: "guardian",
      source: "stage",
      source_field: dates.closing.field,
      source_edition: dates.edition,
      date_note: dates.lastCycle ? "last_cycle" : null,
      position: 0,
    });
  }
  return out;
}
