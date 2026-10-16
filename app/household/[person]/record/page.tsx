import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PersonHeader } from "@/components/account/PersonHeader";
import { RecordOverview } from "@/components/record/RecordOverview";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { personPage, scheduleStudentReadLog } from "@/lib/households";
import { loadPlanFor } from "@/lib/planner/load";
import { profileFor } from "@/lib/student-profile-store";

/** "Their record" for a guardian, "Your record" for the student (the Numbers page's loader, same split). */
async function recordTitleFor(id: string): Promise<string> {
  const person = await personPage(id);
  if (person?.kind !== "student") return "Record";
  const profile = await profileFor(person.access.student.id);
  return profile?.relation === "guardian" ? "Their record" : "Your record";
}

export async function generateMetadata({ params }: { params: Promise<{ person: string }> }): Promise<Metadata> {
  try {
    const { person: id } = await params;
    return { title: await recordTitleFor(id), robots: { index: false } };
  } catch {
    return { title: "Your record", robots: { index: false } };
  }
}

/**
 * /household/[person]/record (specs/planner/record/steps.md "The overview"; specs/product/household-hub.md "Changed
 * (2026-10-16): the Numbers tab becomes the record"): the Numbers page's loader (person, profile, the guardian read
 * log), replacing its form and completeness meter with the record overview. Students only; a guardian's page has
 * just the List tab. A guardian's view is logged, so the student sees it in /account.
 */
export default async function PersonRecordPage({ params }: { params: Promise<{ person: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { person: id } = await params;
  await requireUser(`/household/${id}/record`);

  let person, profile;
  try {
    person = await personPage(id);
    if (person?.kind !== "student") {
      if (person) redirect(`/household/${id}`);
      notFound();
    }
    profile = await profileFor(person.access.student.id);
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Profiles aren't set up yet" />;
    throw err;
  }
  if (!profile) notFound();
  if (profile.relation === "guardian") await scheduleStudentReadLog(profile.student.id, "student_profiles");

  // R6 (specs/planner/record/reading.md "On the record overview"): the plan's estimates feed "How Quad reads your
  // record right now". `access` here is the same access `profileFor` already resolved, so this doesn't repeat the
  // viewer lookup; a plan that isn't ready yet (no list) reads as the empty state, never an error.
  const plan = await loadPlanFor(profile.student.id, profile);

  return (
    <div className="space-y-6">
      <PersonHeader id={id} person={person} active="record" />
      <RecordOverview profile={profile} plan={plan} />
    </div>
  );
}
