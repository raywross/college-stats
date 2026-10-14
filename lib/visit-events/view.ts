/**
 * Visit events: the pure, framework-free pieces shared by the server reads (lib/visit-events/read.ts) and the
 * client components (components/visits/**): grouping by day, the kind chips, the read-time and signed-out lines,
 * and picking the "near you" events with measure.ts's nearestFirst. No Supabase, no Next.js, no React import, so
 * this loads safely in a client component bundle as well as under plain `node --test` (tests/visit-events-read.test.mts).
 */
import type { VisitEventKind, VisitEventRow } from "./types.ts";
import { nearestFirst, type MeasuringPoint } from "./measure.ts";

/* ------------------------------------------------------------------ */
/* Day and time formatting, in the event's own zone (specs/product/visit-events.md "Display")                      */
/* ------------------------------------------------------------------ */

type DayTimeInput = Pick<VisitEventRow, "starts_at" | "timezone">;

function zoneOf(event: Pick<VisitEventRow, "timezone">): string {
  return event.timezone || "UTC";
}

/** "2026-10-19": the event's own calendar day, for grouping. Falls back to UTC before the event page confirms a zone. */
export function dayKey(event: DayTimeInput): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zoneOf(event), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(event.starts_at));
}

/** "Mon, Oct 19" for a day group's sticky header. */
export function dayLabel(event: DayTimeInput): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zoneOf(event), weekday: "short", month: "short", day: "numeric" }).format(new Date(event.starts_at));
}

/** "11:40 am", or "All day" for an all-day row. */
export function timeLabel(event: Pick<VisitEventRow, "starts_at" | "all_day" | "timezone">): string {
  if (event.all_day) return "All day";
  return new Intl.DateTimeFormat("en-US", { timeZone: zoneOf(event), hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(event.starts_at)).toLowerCase();
}

/**
 * The event's wall-clock date and 24-hour time in its own zone, for the "Add to calendar" file (lib/ics.ts): floating
 * local times show the same clock time in every calendar app, which is what a Slate event page states.
 */
export function localDateParts(event: DayTimeInput): { date: string; time: string } {
  const tz = zoneOf(event);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(event.starts_at));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.starts_at));
  return { date, time };
}

/** One day's events, oldest group first; a group keeps the order `events` arrived in (callers sort by `starts_at` first). */
export interface DayGroup<T> {
  day: string;
  label: string;
  events: T[];
}

/** Groups events by their own calendar day (day headers, specs/product/visit-events.md "Display"). */
export function groupEventsByDay<T extends DayTimeInput>(events: readonly T[]): DayGroup<T>[] {
  const order: string[] = [];
  const byDay = new Map<string, T[]>();
  for (const event of events) {
    const key = dayKey(event);
    if (!byDay.has(key)) {
      byDay.set(key, []);
      order.push(key);
    }
    byDay.get(key)!.push(event);
  }
  order.sort((a, b) => a.localeCompare(b));
  return order.map((day) => ({ day, label: dayLabel(byDay.get(day)![0]), events: byDay.get(day)! }));
}

/* ------------------------------------------------------------------ */
/* Kind chips (specs/product/visit-events.md "Display": Campus tours · Sessions · Near you · Online · Everything)   */
/* ------------------------------------------------------------------ */

export type VisitChipKey = "tour" | "info_session" | "travel" | "online" | "all";

export const VISIT_CHIPS: { key: VisitChipKey; label: string }[] = [
  { key: "tour", label: "Campus tours" },
  { key: "info_session", label: "Sessions" },
  { key: "travel", label: "Near you" },
  { key: "online", label: "Online" },
  { key: "all", label: "Everything" },
];

/** Whether an event's kind belongs to a chip. "Sessions" covers info sessions, open houses, and anything else on campus. */
export function matchesChip(kind: VisitEventKind, chip: VisitChipKey): boolean {
  if (chip === "all") return true;
  if (chip === "info_session") return kind === "info_session" || kind === "open_house";
  return kind === chip;
}

/* ------------------------------------------------------------------ */
/* Near you (measure.ts composition)                                                                                */
/* ------------------------------------------------------------------ */

/** Events with a resolvable place (a lat/lng), nearest the point first, then soonest. Never online (no distance). */
export function nearYouEvents<T extends Pick<VisitEventRow, "lat" | "lng" | "starts_at" | "online">>(
  events: readonly T[],
  point: MeasuringPoint | null,
  limit?: number,
): T[] {
  if (!point) return [];
  const placed = events.filter((e) => !e.online && e.lat != null && e.lng != null);
  const sorted = nearestFirst(placed, point);
  return limit != null ? sorted.slice(0, limit) : sorted;
}

/** Events held at the campus itself (not the travel calendar, not online), soonest first. */
export function onCampusEvents<T extends Pick<VisitEventRow, "kind" | "starts_at">>(events: readonly T[], limit?: number): T[] {
  const onCampus = events.filter((e) => e.kind !== "travel" && e.kind !== "online").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return limit != null ? onCampus.slice(0, limit) : onCampus;
}

/* ------------------------------------------------------------------ */
/* Read-time and signed-out lines (specs/product/visit-events.md "Display")                                        */
/* ------------------------------------------------------------------ */

/** "Read from UF's calendar at 3:10 am", or null when nothing has been read yet. */
export function readTimeLine(schoolName: string, lastSeen: string | null): string | null {
  if (!lastSeen) return null;
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(lastSeen)).toLowerCase();
  return `Read from ${schoolName}'s calendar at ${time}`;
}

/** "UF lists 528 upcoming events. Sign in to see them." (signed-out college page; the sign-in link is the caller's). */
export function signedOutLine(schoolName: string, count: number): string {
  const events = count === 1 ? "event" : "events";
  return `${schoolName} lists ${count} upcoming ${events}. Sign in to see them.`;
}
