/**
 * The printed calendar (specs/planner/redesign/calendar.md "Feed, print, share"; app/plan/print/page.tsx): the
 * Coming-up list for a whole school year, grouped by month, for one child or everyone (all together, or one page per
 * child). Pure: the events come from lib/planner/calendar.ts eventsFor, so the page prints exactly what the Calendar
 * tab shows.
 */
import { eventsFor, rangeContains, type CalendarEvent, type YearRange } from "./calendar.ts";
import type { PlanView } from "./plan-view.ts";
import type { PlanContext } from "./types.ts";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface PrintMonth {
  /** yyyy-mm. */
  key: string;
  /** "August 2026". */
  label: string;
  events: CalendarEvent[];
}

/**
 * The events in `range`, by month in date order (August first), months with nothing left out. Within a month: by
 * date, then by text, so two children's entries on one day sit in a stable order.
 */
export function printMonths(events: CalendarEvent[], range: YearRange): PrintMonth[] {
  const byMonth = new Map<string, CalendarEvent[]>();
  for (const e of [...events].filter((e) => rangeContains(range, e.date)).sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text))) {
    const key = e.date.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(e);
    else byMonth.set(key, [e]);
  }
  return [...byMonth.entries()].map(([key, list]) => ({ key, label: `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, events: list }));
}

/**
 * Every event of the school year for each child: eventsFor from the range's first day (so the months already past
 * print too), cut at the range's last day. The page marks the ones before today as past.
 */
export function yearEvents(children: { studentId: string; ctx: PlanContext; view: PlanView }[], range: YearRange): CalendarEvent[] {
  return children.flatMap((c) => eventsFor(c.ctx, c.view, range.from, c.studentId)).filter((e) => rangeContains(range, e.date));
}

/** How a print is laid out: one child, everyone on one list, or everyone with a page per child. */
export type PrintLayout = { kind: "one"; studentId: string } | { kind: "together" } | { kind: "each" };

/**
 * The sections to print: a single list (one child, or everyone together with each row naming its child), or one
 * section per child, each its own page. Children with nothing in the year still get their page, saying so.
 */
export function printSections<C extends { studentId: string }>(
  children: C[],
  events: CalendarEvent[],
  range: YearRange,
  layout: PrintLayout,
): { child: C | null; months: PrintMonth[] }[] {
  if (layout.kind === "one") {
    const child = children.find((c) => c.studentId === layout.studentId) ?? null;
    return child ? [{ child, months: printMonths(events.filter((e) => e.studentId === child.studentId), range) }] : [];
  }
  const of = (child: C) => printMonths(events.filter((e) => e.studentId === child.studentId), range);
  if (children.length === 1) return [{ child: children[0], months: of(children[0]) }];
  if (layout.kind === "together") {
    const ids = new Set(children.map((c) => c.studentId));
    return [{ child: null, months: printMonths(events.filter((e) => ids.has(e.studentId)), range) }];
  }
  return children.map((child) => ({ child, months: of(child) }));
}
