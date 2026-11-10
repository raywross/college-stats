/**
 * The college's event calendar view (specs/product/visit-events.md "Display"): rendered by
 * app/schools/[id]/events/page.tsx in place of the stats, under the same hero as the overview. A back link, the title,
 * then one list with the kind chips open from the start; "Near me" measures the travel calendar from the viewer's
 * home or high school with their alert radius. Signed out, the view redirects to sign-up and returns here. Server
 * component: reads with the viewer's own session (lib/visit-events/read.ts), which is why the calendar has a route
 * of its own.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { authConfigured, getUser } from "@/lib/auth";
import { eventsForUnit, myMeasuringPoint, myVisitPrefs, readAt } from "@/lib/visit-events/read";
import { eventDistance } from "@/lib/visit-events/measure";
import { isShownKind } from "@/lib/visit-events/types";
import { readTimeLine, type NearMeScope } from "@/lib/visit-events/view";
import type { VisitListItem } from "@/components/visits/VisitEventList";
import { VisitEventsExpand } from "@/components/visits/VisitEventsExpand";
import { ViewedBeacon } from "@/components/visits/ViewedBeacon";
import { signupHref } from "@/components/visits/EventCalendarButton";

export async function VisitCalendar({ unitId, schoolName }: { unitId: string; schoolName: string }) {
  const back = `/schools/${unitId}`;
  if (!authConfigured()) redirect(back);
  const user = await getUser();
  if (!user) redirect(signupHref(`${back}/events`));

  const [events, point, prefs, lastSeen] = await Promise.all([eventsForUnit(unitId, { limit: 1000 }), myMeasuringPoint(), myVisitPrefs(), readAt(unitId)]);
  const shown = events.filter((e) => isShownKind(e.kind));
  const withDistance: VisitListItem[] = shown.map((e) => ({ ...e, distanceMiles: point ? eventDistance(e, point) : null }));
  const near: NearMeScope | null = point ? { label: point.label, radiusMiles: prefs.radius_miles } : null;
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
          <VisitEventsExpand events={withDistance} schoolName={schoolName} surface="profile" alwaysOpen near={near} />
        )}
      </section>
    </div>
  );
}
