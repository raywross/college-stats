/**
 * The college page's event calendar view (specs/product/visit-events.md "Display"): rendered by app/schools/[id]/page.tsx
 * in place of the stats when the URL carries `?view=events`, under the unchanged hero. A back link first, then the next
 * three on campus and the next three near the person, then the whole calendar with the kind chips and the state filter
 * open from the start. Signed out, the view redirects to sign-up and returns here. Server component: reads with the
 * viewer's own session (lib/visit-events/read.ts).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { authConfigured, getUser } from "@/lib/auth";
import { eventsForUnit, myMeasuringPoint, readAt } from "@/lib/visit-events/read";
import { eventDistance } from "@/lib/visit-events/measure";
import { isShownKind } from "@/lib/visit-events/types";
import { nearYouEvents, onCampusEvents, readTimeLine } from "@/lib/visit-events/view";
import { VisitEventList, type VisitListItem } from "@/components/visits/VisitEventList";
import { VisitEventsExpand } from "@/components/visits/VisitEventsExpand";
import { ViewedBeacon } from "@/components/visits/ViewedBeacon";
import { signupHref } from "@/components/visits/EventCalendarButton";

export async function VisitCalendar({ unitId, schoolName }: { unitId: string; schoolName: string }) {
  const back = `/schools/${unitId}`;
  if (!authConfigured()) redirect(back);
  const user = await getUser();
  if (!user) redirect(signupHref(`${back}?view=events`));

  const [events, point, lastSeen] = await Promise.all([eventsForUnit(unitId, { limit: 1000 }), myMeasuringPoint(), readAt(unitId)]);
  const shown = events.filter((e) => isShownKind(e.kind));
  const withDistance: VisitListItem[] = shown.map((e) => ({ ...e, distanceMiles: point ? eventDistance(e, point) : null }));
  const onCampus = onCampusEvents(withDistance, 3);
  const near = nearYouEvents(withDistance, point, 3);
  const readLine = readTimeLine(schoolName, lastSeen);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="space-y-6 pt-2 sm:pt-4" aria-label="Event calendar">
        <ViewedBeacon surface="profile" />
        <Link href={back} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back to {schoolName}
        </Link>
        <div>
          <h2 className="font-display text-2xl font-bold">Event calendar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Campus tours and sessions, online sessions, and the days {schoolName}&apos;s admissions officers visit high schools and fairs. Sign up on the
            college&apos;s own page; Quad never takes a booking.
          </p>
          {readLine && <p className="mt-1 text-xs text-muted-foreground">{readLine}</p>}
        </div>

        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
            Nothing on {schoolName}&apos;s calendar right now; we read it again every night.
          </p>
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Next on campus</p>
                <VisitEventList events={onCampus} schoolName={schoolName} emptyMessage="No campus tours or sessions on the calendar yet." />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">{point ? `Near you: ${point.label}` : "Near you"}</p>
                {point ? (
                  <VisitEventList events={near} schoolName={schoolName} near emptyMessage="Nothing within reach yet." />
                ) : (
                  <p className="rounded-2xl border border-dashed bg-card/50 px-4 py-4 text-sm text-muted-foreground">
                    Add a home or high school on{" "}
                    <Link href="/household" className="font-semibold text-primary hover:underline">
                      your household page
                    </Link>{" "}
                    to see what&apos;s near you.
                  </p>
                )}
              </div>
            </div>
            <div>
              <h3 className="font-display text-lg font-bold">Everything on the calendar</h3>
              <VisitEventsExpand events={withDistance} schoolName={schoolName} surface="profile" alwaysOpen />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
