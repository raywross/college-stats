import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { CaseloadView } from "@/components/org/CaseloadView";
import { OrgHeader } from "@/components/org/OrgHeader";
import { StartOrgForm } from "@/components/org/StartOrgForm";
import { AccountsSetupError, authConfigured, getAccount, requireUser } from "@/lib/auth";
import { getData } from "@/lib/data";
import { advisorStatusFor } from "@/lib/entitlements";
import { requestOrigin } from "@/lib/household-hub";
import { caseloadCounts, caseloadRows, invitedStudents } from "@/lib/org-caseload";
import { joinHref } from "@/lib/org-rules";
import { caseloadStudents, myOrganization, orgRoster } from "@/lib/orgs";
import { todayIso } from "@/lib/planner/context";

export const metadata: Metadata = { title: "Caseload", robots: { index: false, follow: false } };

/**
 * /org (specs/product/counselor-portal.md "The counselor's pages: /org"): with no organization, Start your
 * organization and the free line; otherwise the caseload. Every read uses the counselor's own session (lib/orgs.ts),
 * and every row is computed by lib/org-caseload.ts from what row-level security returned. Before the organizations
 * migration is applied, myOrganization() answers none and the start form shows.
 */
export default async function OrgPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/org");

  let account, org;
  try {
    [account, org] = await Promise.all([getAccount(), myOrganization()]);
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (!account) return null;
  if (account.profile.deleted_at) redirect("/account");

  if (!org) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <StartOrgForm />
      </div>
    );
  }

  const today = todayIso();
  const roster = await orgRoster(org.id);
  const [students, { getSchoolById }, origin] = await Promise.all([caseloadStudents(roster), getData(), headers().then(requestOrigin)]);
  const status = await advisorStatusFor(students.map((s) => s.studentId));
  const schools: Record<string, { name: string }> = {};
  for (const s of students) for (const i of s.items) schools[i.unit_id] ??= { name: getSchoolById(i.unit_id)?.name ?? "A college" };
  const rows = caseloadRows({ students, schools, status, today });
  const invited = invitedStudents(roster, origin, today);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <OrgHeader name={org.name} kind={org.kind} active="caseload" />
      <CaseloadView rows={rows} counts={caseloadCounts(rows, invited.length)} invited={invited} joinCode={org.join_code} joinLink={`${origin}${joinHref(org.join_code)}`} />
    </div>
  );
}
