/**
 * The college page's "Upcoming visits" block (specs/product/visit-events.md "Display"), placed under OfficialLinks
 * in app/schools/[id]/page.tsx: the next three on-campus events and the next three near the signed-in person, with
 * "All N events" expanding the full, filterable list in place. Signed out, one line names the public count and
 * invites sign-in. Server component: reads with the viewer's own session (lib/visit-events/read.ts).
 */
import Link from "next/link";
import { authConfigured, getUser } from "@/lib/auth";
import { loginHref } from "@/lib/accounts";
import { countForUnit, eventsForUnit, myMeasuringPoint, readAt } from "@/lib/visit-events/read";
import { eventDistance } from "@/lib/visit-events/measure";
import { nearYouEvents, onCampusEvents, readTimeLine, signedOutLine } from "@/lib/visit-events/view";
import { VisitEventList, type VisitListItem } from "@/components/visits/VisitEventList";
import { VisitEventsExpand } from "@/components/visits/VisitEventsExpand";
import { ViewedBeacon } from "@/components/visits/ViewedBeacon";

export async function UpcomingVisits({ unitId, schoolName }: { unitId: string; schoolName: string }) {
  if (!authConfigured()) return null;
  const user = await getUser();

  if (!user) {
    const count = await countForUnit(unitId);
    if (count === 0) return null;
    return (
      <p className="mt-4 rounded-2xl border bg-card/60 px-4 py-3 text-sm text-muted-foreground sm:mt-5">
        {signedOutLine(schoolName, count)}{" "}
        <Link href={loginHref(`/schools/${unitId}`)} className="font-semibold text-primary hover:underline">
          Sign in
        </Link>{" "}
        to see them.
      </p>
    );
  }

  const [events, point, lastSeen] = await Promise.all([eventsForUnit(unitId, { limit: 400 }), myMeasuringPoint(), readAt(unitId)]);
  const shown = events.filter((e) => e.kind !== "staff");
  if (shown.length === 0) return null;

  const withDistance: VisitListItem[] = shown.map((e) => ({ ...e, distanceMiles: point ? eventDistance(e, point) : null }));
  const onCampus = onCampusEvents(withDistance, 3);
  const near = nearYouEvents(withDistance, point, 3);
  const readLine = readTimeLine(schoolName, lastSeen);

  return (
    <section className="mt-5 sm:mt-6" aria-label="Upcoming visits">
      <ViewedBeacon surface="profile" />
      <h2 className="font-display text-lg font-bold">Upcoming visits</h2>
      {readLine && <p className="mt-0.5 text-xs text-muted-foreground">{readLine}</p>}
      <div className="mt-3 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">On campus</p>
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
      <VisitEventsExpand events={withDistance} schoolName={schoolName} surface="profile" />
    </section>
  );
}
