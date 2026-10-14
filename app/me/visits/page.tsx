import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { VisitEventList } from "@/components/visits/VisitEventList";
import { MuteSwitch } from "@/components/visits/MuteSwitch";
import { NearYouRadius } from "@/components/visits/NearYouRadius";
import { ViewedBeacon } from "@/components/visits/ViewedBeacon";
import { authConfigured, requireUser } from "@/lib/auth";
import { myFollows } from "@/lib/follows";
import { getData } from "@/lib/data";
import { eventsForMe, myMeasuringPoint, myVisitMutes, myVisitPrefs, readTimeLine } from "@/lib/visit-events/read";
import { nearYouEvents } from "@/lib/visit-events/view";

export const metadata: Metadata = { title: "Your visits", robots: { index: false } };

/**
 * /me/visits (specs/product/visit-events.md "`/me/visits`"): Near you first (events within the radius, nearest
 * first), then every followed college in list order with its events and its mute switch. Signed-in only.
 */
export default async function MyVisitsPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/me/visits");

  const [follows, events, prefs, mutes, point, data] = await Promise.all([
    myFollows(),
    eventsForMe({ limit: 1000 }),
    myVisitPrefs(),
    myVisitMutes(),
    myMeasuringPoint(),
    getData(),
  ]);

  const mutedSet = new Set(mutes);
  const nonStaff = events.filter((e) => e.kind !== "staff");
  const near = nearYouEvents(nonStaff, point).filter((e) => e.distanceMiles != null && e.distanceMiles <= prefs.radius_miles);
  // Every list shows when it was read (the spec's display rule): the newest read among the colleges on the page.
  const lastSeen = nonStaff.reduce<string | null>((max, e) => (max == null || e.last_seen > max ? e.last_seen : max), null);
  const readLine = readTimeLine("each college", lastSeen);

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
      <ViewedBeacon surface="me" />
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Your visits</h1>
        <p className="mt-1 text-muted-foreground">
          Tours, sessions, and visits to your area, for the colleges on your list. Change the radius or point here or on{" "}
          <Link href="/account#visit-alerts" className="font-semibold text-primary hover:underline">
            your account page
          </Link>
          .
        </p>
        {readLine && <p className="mt-1 text-xs text-muted-foreground">{readLine}</p>}
      </header>

      <section aria-label="Near you">
        <h2 className="font-display text-xl font-bold">Near you</h2>
        <NearYouRadius radiusMiles={prefs.radius_miles} pointLabel={point?.label ?? null} />
        {!point ? (
          <p className="mt-3 rounded-2xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
            Add a home or high school on{" "}
            <Link href="/household" className="font-semibold text-primary hover:underline">
              your household page
            </Link>{" "}
            to see what&apos;s near you.
          </p>
        ) : (
          <div className="mt-3">
            <VisitEventList events={near} schoolName="your colleges" near emptyMessage="Nothing within your radius yet." />
          </div>
        )}
      </section>

      <section aria-label="Your colleges">
        <h2 className="font-display text-xl font-bold">Your colleges</h2>
        {follows.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
            You&apos;re not following any colleges yet. Add one from its own page to see its visits here.
          </p>
        ) : nonStaff.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
            No events yet for the colleges on your list; we read their calendars every night.
          </p>
        ) : (
          <div className="mt-3 space-y-6">
            {follows.map((f) => {
              const school = data.getSchoolById(f.unit_id);
              const name = school?.name ?? f.unit_id;
              const collegeEvents = nonStaff.filter((e) => e.unit_id === f.unit_id);
              return (
                <div key={f.unit_id} className="rounded-3xl border bg-card p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/schools/${f.unit_id}`} className="font-display font-bold hover:text-primary">
                      {name}
                    </Link>
                    <MuteSwitch unitId={f.unit_id} schoolName={name} initiallyMuted={mutedSet.has(f.unit_id)} />
                  </div>
                  <div className="mt-2">
                    <VisitEventList events={collegeEvents} schoolName={name} emptyMessage="No events yet for this college; we read its calendar every night." />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
