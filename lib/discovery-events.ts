/**
 * The pure decisions behind the discovery events (specs/product/telemetry.md): which Explore change is which event,
 * whether a compare toggle changed the list, whether a compare view came from a link rather than the saved list, and
 * whether a typed score is inside a college's middle 50%. The components call `track()` with what these return, so
 * the rules run under `node --test` (tests/analytics-discovery.test.mts) without React or the browser.
 * Nothing here ever returns a query, a score, or a filter's value: names of URL keys and booleans only.
 */
import type { AnalyticsEvents } from "./analytics.ts";
import { countActiveFilters, parseView } from "./params.ts";

/** One event to send: its name and exact properties. */
export type ExploreEvent =
  | { event: "explore_view_changed"; properties: AnalyticsEvents["explore_view_changed"] }
  | { event: "explore_filtered"; properties: AnalyticsEvents["explore_filtered"] };

/**
 * The events for one `useExploreParams().update(changes)`: `explore_view_changed` when `view` is among the keys, and
 * `explore_filtered` for the other keys (sorting counts; `page` is paging and counts for nothing). `state` is the URL
 * state after the change as a plain record. `filter` is the key names joined with `+`, never their values.
 */
export function exploreChangeEvents(changedKeys: readonly string[], state: Record<string, string>): ExploreEvent[] {
  const keys = changedKeys.filter((k) => k !== "page");
  const view = parseView(state);
  const events: ExploreEvent[] = [];
  if (keys.includes("view")) events.push({ event: "explore_view_changed", properties: { view } });
  const filters = keys.filter((k) => k !== "view");
  if (filters.length) {
    events.push({
      event: "explore_filtered",
      properties: { filter: filters.join("+"), view, active_filter_count: countActiveFilters(state) },
    });
  }
  return events;
}

/**
 * A compare toggle's outcome: the new list and what happened, or `action: null` when nothing changed (a full list
 * refuses the add), so only real changes are reported.
 */
export function toggledCompare(
  current: readonly string[],
  id: string,
  max: number
): { ids: string[]; action: "add" | "remove" | null } {
  const ids = [...current];
  const i = ids.indexOf(id);
  if (i >= 0) {
    ids.splice(i, 1);
    return { ids, action: "remove" };
  }
  if (ids.length < max) {
    ids.push(id);
    return { ids, action: "add" };
  }
  return { ids, action: null };
}

/** True when the URL's colleges differ from the saved list: a link from a profile or the home page, not the tray. */
export function isPresetCompare(stored: readonly string[], ids: readonly string[]): boolean {
  return stored.join(",") !== ids.join(",");
}

/** Whether a typed score sits inside the college's middle 50% (`[p25, p75]`, inclusive); null with no range. */
export function scoreInRange(score: number, range: readonly [number, number] | null | undefined): boolean | null {
  if (!range) return null;
  return score >= range[0] && score <= range[1];
}
