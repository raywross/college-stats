/**
 * Pure logic behind the planner row's next-events block (U4, specs/product/visit-events.md "Planner": "the list
 * row's 'Book a visit' shows the next two events"; specs/planner/actions.md "Visits"). No React and no directive,
 * so `tests/visit-events-planner.test.mts` runs it under plain `node --test` like the other visit-events pure
 * modules (`lib/visit-events/view.ts`'s own tests). `components/visits/NextEvents.tsx` is the only caller.
 */
import { planVisitKind } from "../../lib/visit-events/kinds.ts";
import { isShownKind, type VisitEventRow } from "../../lib/visit-events/types.ts";
import { localDateParts, nearYouEvents, onCampusEvents, timeLabel } from "../../lib/visit-events/view.ts";
import type { MeasuringPoint } from "../../lib/visit-events/measure.ts";
import type { VisitKind } from "../../lib/planner/types.ts";

/**
 * The next two events for a college's planner row: the next on-campus event, then the nearest travel event when the
 * viewer has a measuring point (specs/product/visit-events.md "Display": "the next two events"). Falls back to the
 * second on-campus event when there's no point or no travel event, so a college with two on-campus events but no
 * "near you" match still shows two. `events` need not be sorted; `onCampusEvents`/`nearYouEvents` sort internally.
 */
export function nextTwoEvents(events: readonly VisitEventRow[], point: MeasuringPoint | null): VisitEventRow[] {
  // Staff rows are never shown (RLS already keeps them out of eventsForUnit; this defends like VisitEventRow does).
  const shown = events.filter((e) => isShownKind(e.kind));
  const campus = onCampusEvents(shown);
  const first = campus[0] ?? null;
  let second: VisitEventRow | null = null;
  if (point) {
    const travel = shown.filter((e) => e.kind === "travel");
    const nearest = nearYouEvents(travel, point, 1)[0];
    if (nearest && nearest.id !== first?.id) second = nearest;
  }
  if (!second) second = campus.find((e) => e.id !== first?.id) ?? null;
  return [first, second].filter((e): e is VisitEventRow => e !== null);
}

/** "Welcome Center", "Decatur, GA", "Online", or null when nothing is known yet. */
export function venueLine(event: Pick<VisitEventRow, "venue" | "city" | "state" | "online">): string | null {
  if (event.online) return "Online";
  const town = [event.city, event.state].filter(Boolean).join(", ");
  return event.venue || town || null;
}

export interface VisitFormPrefill {
  kind: VisitKind;
  onDate: string;
  atTime: string | null;
  registered: true;
  registrationUrl: string;
  notesFree: string;
}

/**
 * What "I registered" prefills `VisitForm` with (specs/product/visit-events.md "Planner"): the mapped kind
 * (`planVisitKind`; every `VisitEventKind` maps to a valid `VisitKind`), the date and time split in the event's own
 * zone, `registered` with the event's `book_url`, and the title/time/venue in the notes' free field ("Campus Tour,
 * 9:00 am, Welcome Center").
 */
export function visitFormPrefill(event: VisitEventRow): VisitFormPrefill {
  const { date, time } = localDateParts(event);
  const venue = venueLine(event);
  const parts = [event.title, event.all_day ? "All day" : timeLabel(event), venue].filter((p): p is string => Boolean(p));
  return {
    kind: planVisitKind(event.kind),
    onDate: date,
    atTime: event.all_day ? null : time,
    registered: true,
    registrationUrl: event.book_url,
    notesFree: parts.join(", "),
  };
}
