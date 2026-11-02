import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { StudentView } from "@/components/org/StudentView";
import { authConfigured, requireUser } from "@/lib/auth";
import { getData } from "@/lib/data";
import { advisorStatusFor } from "@/lib/entitlements";
import { isUuid } from "@/lib/household-hub";
import { openStudentAs } from "@/lib/households";
import { caseloadRow } from "@/lib/org-caseload";
import { caseloadEntry, caseloadStudents, myOrganization, orgAsks, orgNotes } from "@/lib/orgs";
import { todayIso } from "@/lib/planner/context";

export const metadata: Metadata = { title: "Student", robots: { index: false, follow: false } };

/**
 * /org/students/[id] (specs/product/counselor-portal.md "A student"): one student on the caseload. The student must
 * be on this organization's caseload with a live grant (else 404); the read is logged for the student's access log
 * (openStudentAs), and every read runs with the counselor's own session.
 */
export default async function OrgStudentPage({ params }: PageProps<"/org/students/[id]">) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { id } = await params;
  const user = await requireUser(`/org/students/${id}`);
  if (!isUuid(id)) notFound();
  const org = await myOrganization();
  if (!org) redirect("/org");

  const [entry, access] = await Promise.all([caseloadEntry(org.id, id), openStudentAs(id, "student_profiles")]);
  if (!entry || !access) notFound();
  const today = todayIso();
  const [[student], notes, asks, status, { getSchoolById }] = await Promise.all([
    caseloadStudents([entry]),
    orgNotes(org.id, id),
    orgAsks(org.id, id),
    advisorStatusFor([id]),
    getData(),
  ]);
  if (!student) notFound();
  const schools: Record<string, { name: string }> = {};
  for (const i of student.items) schools[i.unit_id] ??= { name: getSchoolById(i.unit_id)?.name ?? "A college" };
  // The banner's edit line follows the grant as the session resolved it (the family can switch it to view only).
  const row = { ...caseloadRow(student, { schools, status, today }), canEdit: access.canEdit };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <StudentView orgId={org.id} row={row} student={student} schools={schools} notes={notes} asks={asks} viewerId={user.id} today={today} />
    </div>
  );
}
