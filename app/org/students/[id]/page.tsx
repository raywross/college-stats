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
import { studentData } from "@/lib/orgs";
import { withTiming } from "@/lib/timing-server";

export const metadata: Metadata = { title: "Student", robots: { index: false, follow: false } };

/**
 * /org/students/[id] (specs/product/counselor-portal.md "A student"): one student on the caseload. The student must
 * be on this organization's caseload with a live grant (else 404); the read is logged for the student's access log
 * (openStudentAs), and every read runs with the counselor's own session. Two database waves: the student's one bundle
 * (lib/orgs.ts studentData, started before the sign-in check) beside the session's viewer bundle, which openStudentAs
 * shares.
 */
export default async function OrgStudentPage({ params }: PageProps<"/org/students/[id]">) {
  await connection();
  const { id } = await params;
  return withTiming("/org/students/[id]", () => renderStudent(id));
}

async function renderStudent(id: string) {
  if (!authConfigured()) return <AuthUnavailable />;
  // Started now so they run beside the session check; nothing is shown before requireUser and the checks below pass.
  const dataP = isUuid(id) ? studentData(id) : null;
  const datasetP = getData();
  dataP?.catch(() => {});
  datasetP.catch(() => {});
  const user = await requireUser(`/org/students/${id}`);
  if (!isUuid(id) || !dataP) notFound();

  const [data, access] = await Promise.all([dataP, openStudentAs(id, "student_profiles")]);
  if (!data) redirect("/org");
  if (!data.entry || !access) notFound();
  const { org, student, notes, asks, today } = data;
  if (!student) notFound();
  const [status, { getSchoolById }] = await Promise.all([advisorStatusFor([id]), datasetP]);
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
