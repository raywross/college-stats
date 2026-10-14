/**
 * A list of visit events grouped by day with sticky day headers (specs/product/visit-events.md "Display"). `staff`
 * rows are never rendered, even if a caller passes one through. Server-renderable (no hooks of its own): the pages
 * and the client expand panel both use it.
 */
import { groupEventsByDay } from "@/lib/visit-events/view";
import { isShownKind, type VisitEventRow as VisitEventRowData } from "@/lib/visit-events/types";
import { VisitEventRow } from "@/components/visits/VisitEventRow";

export interface VisitListItem extends VisitEventRowData {
  distanceMiles?: number | null;
}

export function VisitEventList({
  events,
  schoolName,
  near = false,
  emptyMessage,
}: {
  events: readonly VisitListItem[];
  schoolName: string;
  /** Whether these rows come from a "near you" context, for the sign-up click's telemetry. */
  near?: boolean;
  emptyMessage?: string;
}) {
  const shown = events.filter((e) => isShownKind(e.kind));
  if (shown.length === 0) {
    return emptyMessage ? <p className="rounded-2xl border border-dashed bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p> : null;
  }
  const groups = groupEventsByDay(shown);
  return (
    <div className="divide-y-0">
      {groups.map((group) => (
        <div key={group.day}>
          <p
            className="sticky z-10 -mx-1 bg-background/90 px-1 py-1.5 text-xs font-bold text-muted-foreground backdrop-blur"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + var(--header-offset))" }}
          >
            {group.label}
          </p>
          <ul>
            {group.events.map((event) => (
              <VisitEventRow key={event.id} event={event} schoolName={schoolName} distanceMiles={event.distanceMiles ?? null} near={near || event.kind === "travel"} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
