import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadProfile } from "@/lib/profile-data";
import { ProfileHero } from "@/components/profile/ProfileHero";
import { VisitCalendar } from "@/components/visits/VisitCalendar";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const school = (await loadProfile(id))?.school;
  return { title: school ? `${school.name}: event calendar` : "School not found", robots: { index: false } };
}

/**
 * The college's event calendar (specs/product/visit-events.md "Display"): the same hero as the overview, with the
 * calendar in place of the stats. Its own route, so the overview stays prerendered: this one is rendered per person
 * (VisitCalendar reads the viewer's session and sends a signed-out visitor to sign up, then back here).
 */
export default async function SchoolEventsPage({ params }: Props) {
  const { id } = await params;
  const p = await loadProfile(id);
  if (!p) notFound();
  return (
    <div>
      <ProfileHero profile={p} eventsActive />
      <VisitCalendar unitId={p.school.unit_id} schoolName={p.school.name} />
    </div>
  );
}
