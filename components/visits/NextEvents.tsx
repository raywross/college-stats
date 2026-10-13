"use client";
/**
 * The planner list row's next events (U4, specs/product/visit-events.md "Planner": "the list row's 'Book a visit'
 * shows the next two events"; specs/planner/actions.md "Visits"). Reads through `loadNextEventsFeed`
 * (`lib/planner/visit-feed.ts`, a Server Action: this row needs its own "which sheet is open" state, so it's a
 * Client Component, and a Client Component calls a Server Action rather than importing a Server Component). Signed
 * out or signed in with no events for this college: renders nothing, so the existing "Book a visit" link under it
 * is all that shows.
 *
 * "I registered" opens `VisitForm` prefilled from the event (`visitFormPrefill`, ./next-events-logic.ts): the kind
 * via `planVisitKind`, the date and time split in the event's own zone, `registered` with the event's `book_url`,
 * and the title/time/venue in the notes' free field. Saving goes through the existing `logVisit` (`VisitForm`
 * already calls it; nothing new in the database).
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { VisitForm } from "@/components/planner/VisitForm";
import { track } from "@/lib/analytics";
import { loadNextEventsFeed } from "@/lib/planner/visit-feed";
import { dayLabel, timeLabel } from "@/lib/visit-events/view";
import { eventDistance } from "@/lib/visit-events/measure";
import { formatMiles } from "@/lib/home";
import type { VisitEventRow } from "@/lib/visit-events/types";
import type { MeasuringPoint } from "@/lib/visit-events/measure";
import { nextTwoEvents, venueLine, visitFormPrefill } from "./next-events-logic";

export default function NextEvents({ unitId, itemId, schoolName }: { unitId: string; itemId: string; schoolName: string }) {
  const [feed, setFeed] = useState<{ loaded: boolean; events: VisitEventRow[]; point: MeasuringPoint | null }>({
    loaded: false,
    events: [],
    point: null,
  });
  const [registering, setRegistering] = useState<VisitEventRow | null>(null);

  useEffect(() => {
    let alive = true;
    loadNextEventsFeed(unitId)
      .then((r) => {
        if (alive) setFeed({ loaded: true, events: r.events, point: r.point });
      })
      .catch(() => {
        if (alive) setFeed({ loaded: true, events: [], point: null });
      });
    return () => {
      alive = false;
    };
  }, [unitId]);

  const picked = nextTwoEvents(feed.events, feed.point);

  useEffect(() => {
    if (picked.length > 0) track("visit_events_viewed", { surface: "planner", kind: "all" });
    // Fires once per event set this row loads; `picked` is derived from `feed`, so re-running on it is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.loaded]);

  if (!feed.loaded || picked.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">Next events</p>
      <ul className="space-y-1.5">
        {picked.map((event) => {
          const near = event.kind === "travel";
          const distanceMiles = feed.point ? eventDistance(event, feed.point) : null;
          const place = venueLine(event);
          return (
            <li key={event.id} className="flex items-center gap-2 rounded-lg border p-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {dayLabel(event)} · {event.all_day ? "All day" : timeLabel(event)} · {event.title}
                </p>
                <p className="truncate text-muted-foreground">
                  {place}
                  {place && distanceMiles != null && " · "}
                  {distanceMiles != null && formatMiles(distanceMiles)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <a
                  href={event.book_url}
                  target="_blank"
                  rel="noopener"
                  onClick={() => track("visit_signup_clicked", { unit_id: unitId, kind: event.kind, near })}
                  className="inline-flex h-8 items-center gap-1 rounded-full border px-2.5 font-semibold hover:bg-muted"
                >
                  Sign up <ExternalLink className="size-3" aria-hidden />
                </a>
                <button
                  type="button"
                  onClick={() => setRegistering(event)}
                  className="inline-flex h-8 items-center rounded-full bg-primary px-2.5 font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  I registered
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <SheetDialog open={registering !== null} onOpenChange={(open) => !open && setRegistering(null)} title={`Log a visit · ${schoolName}`}>
        {registering && (
          <VisitForm itemId={itemId} householdNames={[]} prefill={visitFormPrefill(registering)} onDone={() => setRegistering(null)} onCancel={() => setRegistering(null)} />
        )}
      </SheetDialog>
    </div>
  );
}
