/**
 * The per-college hooks the estimate reads, built from the list (specs/chances/README.md decision 5 "Hooks in
 * requests"). Pure and client-safe, so it can be tested and shared; lib/planner/plan-estimates.ts calls it on the
 * server for the plan loader and the suggestion sync.
 *
 * - `legacy`, `sibling`, and `recruited`: plan v3 (specs/planner/v3/connections.md "What reads it"), from the
 *   student's profile (`academics.connections`, `connectionFor`), by the row's unit id — not the row's own columns
 *   any more. `legacy` is true for a connection with a parent or grandparent; `sibling` for one with a sibling;
 *   `recruited` is the connection's own pick. A connection on a college not on the list is read by `connectionFor`
 *   directly (the standing card) but never shows up here, since this only walks the list's own rows.
 * - `interest` (demonstrated interest): true once the family has shown the college interest in any way the plan
 *   records: a visit (`visited_on`, or any entry in `plan_visits`), an information request (`info_requested_on`), or
 *   following the college on social (`followed_networks`, or the older tracking row's `follows_social`). Following
 *   joined on 2026-10-12 when the capture panel started collecting it (owner: "capture visited and follows").
 *
 * A college with nothing set is left out of the map (estimateMany reads a missing entry as NO_HOOKS).
 */
import { NO_HOOKS } from "../chances/levels.ts";
import { connectionFor } from "../student-profile.ts";
import type { StudentProfileData } from "../student-profile.ts";
import type { CollegeHooks } from "../chances/types.ts";
import type { PlanItem, PlanVisit } from "./types.ts";

/** What hooksFromPlan reads of a list item: its ids and the interest records (the connection toggles come from the profile now). */
export type HooksItem = Pick<PlanItem, "id" | "unit_id" | "visited_on" | "info_requested_on"> &
  Partial<Pick<PlanItem, "followed_networks" | "follows_social">>;

/** Whether the plan records any demonstrated interest in this college (see the module comment). */
export function showsInterest(item: HooksItem, visitedItemIds: ReadonlySet<string>): boolean {
  return (
    item.visited_on !== null ||
    item.info_requested_on !== null ||
    visitedItemIds.has(item.id) ||
    (item.followed_networks?.length ?? 0) > 0 ||
    item.follows_social === true
  );
}

export function hooksFromPlan(
  items: readonly HooksItem[],
  visits: readonly Pick<PlanVisit, "item_id">[] = [],
  profile: Pick<StudentProfileData, "academics"> | null = null,
): Record<string, CollegeHooks> {
  const visitedItemIds = new Set(visits.map((v) => v.item_id));
  const out: Record<string, CollegeHooks> = {};
  for (const item of items) {
    const conn = connectionFor(profile, item.unit_id);
    const hooks: CollegeHooks = {
      legacy: conn ? conn.family.includes("parent") || conn.family.includes("grandparent") : false,
      sibling: conn ? conn.family.includes("sibling") : false,
      recruited: conn?.recruited ?? NO_HOOKS.recruited,
      interest: showsInterest(item, visitedItemIds),
    };
    if (hooks.legacy || hooks.sibling || hooks.recruited !== "none" || hooks.interest) out[item.unit_id] = hooks;
  }
  return out;
}
