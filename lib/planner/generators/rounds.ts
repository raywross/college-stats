/**
 * The `rounds` generator (U6; specs/planner/redesign/rounds.md "Money"; timeline.md "Generators" → `stage`): a
 * `cost_check` task per non-withdrawn, not-yet-applied/decided row sitting in ED or ED II, due 21 days before that
 * round's closing date, assigned to the guardian ("Check the cost of Wake Forest together before applying ED I").
 * Keyed by item and round, so moving the round off ED/ED II (or applying/withdrawing/deciding) orphans it through
 * mergeTasks — the point of a new proposal-era `decide_rounds` step is gone (build-plan.md "Review notes" #6), so
 * this generator no longer emits it.
 *
 * Next steps (ed-opportunities.md "Moves and timing"): from the summer before senior year, a `cost_check` per Good ED
 * opportunity too (lib/planner/ed-opportunities.ts), keyed `{list}:cost_check:{item}:candidate`, due 21 days before
 * the round its pill names closes, assigned to the guardian; it orphans when the college stops being a candidate. A
 * candidate's own key replaces the round-keyed one for that row, so pressing "Start it in ED" keeps the same task
 * (and a guardian's tick on it) rather than swapping it for a new one.
 *
 * Nothing without a published closing date; nothing on a guardian's own list. Pure, no I/O.
 */
import { taskKey } from "../tasks.ts";
import { ED_DECIDE_SEASON, edOpportunities } from "../ed-opportunities.ts";
import { seasonRank } from "../seasons.ts";
import { ROUND_SHORT, roundDates, type RoundDate, type RoundDates } from "../rounds.ts";
import { addDays } from "../stage.ts";
import type { GeneratedTask, GeneratorInput, PlanSchool } from "../types.ts";

/** How long before the round's closing date the cost check is due. */
export const COST_CHECK_LEAD_DAYS = 21;

export function generate(input: GeneratorInput): GeneratedTask[] {
  if (input.list.student_id === null) return [];
  const out: GeneratedTask[] = [];
  const live = input.items.filter((i) => !i.withdrawn_on);
  const candidates =
    seasonRank(input.season) >= seasonRank(ED_DECIDE_SEASON) && input.season !== "unknown"
      ? edOpportunities(live, input.estimates ?? {}, input.schools, { season: input.season, today: input.today })
      : [];
  const candidateIds = new Set<string>();
  for (const c of candidates) {
    const item = live.find((i) => i.id === c.itemId);
    if (!item || item.status === "applied" || item.status === "decided") continue;
    const school = input.schools[item.unit_id];
    const round = c.round === "ed2" ? "ed2" : "ed";
    const dates = roundDates(school, round);
    if (!dates.closing) continue;
    candidateIds.add(item.id);
    out.push(costCheck(input, item.id, `${item.id}:candidate`, school, round, { ...dates, closing: dates.closing }));
  }
  for (const item of live) {
    if (candidateIds.has(item.id)) continue;
    if (item.round !== "ed" && item.round !== "ed2") continue;
    if (item.status === "applied" || item.status === "decided") continue;
    const school = input.schools[item.unit_id];
    const dates = roundDates(school, item.round);
    if (!dates.closing) continue;
    out.push(costCheck(input, item.id, `${item.id}:${item.round}`, school, item.round, { ...dates, closing: dates.closing }));
  }
  return out;
}

function costCheck(input: GeneratorInput, itemId: string, suffix: string, school: PlanSchool | undefined, round: "ed" | "ed2", dates: RoundDates & { closing: RoundDate }): GeneratedTask {
  return {
    key: taskKey(input.list.id, "cost_check", suffix),
    item_id: itemId,
    kind: "cost_check",
    title: `Check the cost of ${school?.name ?? "the college"} together before applying ${ROUND_SHORT[round]}`,
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
  };
}
