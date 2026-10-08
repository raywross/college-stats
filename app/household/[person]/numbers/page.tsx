import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PersonHeader } from "@/components/account/PersonHeader";
import { StudentNumbers } from "@/components/me/StudentNumbers";
import { ParentsCanEdit } from "@/components/account/ParentsCanEdit";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { myHouseholds, personPage, scheduleStudentReadLog } from "@/lib/households";
import { profileFor } from "@/lib/student-profile-store";

export const metadata: Metadata = { title: "Their numbers", robots: { index: false } };

/**
 * /household/[person]/numbers (specs/product/household-hub.md "A person's page", "Redesign (2026-10-06)"): inside the
 * hub's frame (app/household/layout.tsx), the person area with Numbers selected, then a student's profile form and
 * completeness meter (what /me was). Students only; a guardian's page has just the List tab. A guardian's view is
 * logged, so the student sees it in /account.
 */
export default async function PersonNumbersPage({ params }: { params: Promise<{ person: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { person: id } = await params;
  await requireUser(`/household/${id}/numbers`);

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
  // The student's own page carries the switch over their parents' edit access (on by default; they can turn it off).
  const guardians = profile.relation === "self" ? (await myHouseholds()).flatMap((h) => h.members.filter((m) => m.role === "guardian" && m.member_id !== null)) : [];

  return (
    <div className="space-y-6">
      <PersonHeader id={id} person={person} active="numbers" />
      {guardians.length > 0 && <ParentsCanEdit on={guardians.every((g) => g.can_edit)} guardians={guardians.length} />}
      <StudentNumbers profile={profile} />
    </div>
  );
}
