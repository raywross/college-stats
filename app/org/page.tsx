import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { CaseloadView } from "@/components/org/CaseloadView";
import { OrgHeader } from "@/components/org/OrgHeader";
import { RefreshHeader } from "@/components/org/RefreshHeader";
import { StartOrgForm } from "@/components/org/StartOrgForm";
import { AccountsSetupError, authConfigured, getAccount, requireUser } from "@/lib/auth";
import { getData } from "@/lib/data";
import { advisorStatusFor } from "@/lib/entitlements";
import { requestOrigin } from "@/lib/household-hub";
import { caseloadCounts, caseloadRows, invitedStudents } from "@/lib/org-caseload";
import { joinHref } from "@/lib/org-rules";
import { caseloadData } from "@/lib/orgs";
import { withTiming } from "@/lib/timing-server";
import { PretendTodayBanner } from "@/components/planner/PretendTodayBanner";

export const metadata: Metadata = { title: "Caseload", robots: { index: false, follow: false } };

/**
 * /org (specs/product/counselor-portal.md "The counselor's pages: /org"): with no organization, Start your
 * organization and the free line; otherwise the caseload. Every read uses the counselor's own session (lib/orgs.ts),
 * and every row is computed by lib/org-caseload.ts from what row-level security returned. Two database waves at most:
 * the caseload's one bundle (lib/orgs.ts caseloadData, started before the sign-in check) runs beside the session's
 * viewer bundle. Before the organizations migration is applied, caseloadData() answers none and the start form shows.
 */
export default async function OrgPage() {
  await connection();
  return withTiming("/org", renderOrg);
}

async function renderOrg() {
  if (!authConfigured()) return <AuthUnavailable />;
  // Started now so they run beside the session check; nothing is shown before requireUser passes, and the bundle
  // asks nothing of a signed-out visitor.
  const dataP = caseloadData();
  const datasetP = getData();
  dataP.catch(() => {});
  datasetP.catch(() => {});
  await requireUser("/org");

  let account, data;
  try {
    [account, data] = await Promise.all([getAccount(), dataP]);
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (!account) return null;
  if (account.profile.deleted_at) redirect("/account");

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <RefreshHeader org={false} />
        <PretendTodayBanner />
        <StartOrgForm />
      </div>
    );
  }

  const { org, roster, students, today, pretendDay } = data;
  const [{ getSchoolById }, origin, status] = await Promise.all([datasetP, headers().then(requestOrigin), advisorStatusFor(students.map((s) => s.studentId))]);
  const schools: Record<string, { name: string }> = {};
  for (const s of students) for (const i of s.items) schools[i.unit_id] ??= { name: getSchoolById(i.unit_id)?.name ?? "A college" };
  const rows = caseloadRows({ students, schools, status, today });
  const invited = invitedStudents(roster, origin, today);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <RefreshHeader org />
      <PretendTodayBanner day={pretendDay} />
      <OrgHeader name={org.name} kind={org.kind} active="caseload" />
      <CaseloadView rows={rows} counts={caseloadCounts(rows, invited.length)} invited={invited} joinCode={org.join_code} joinLink={`${origin}${joinHref(org.join_code)}`} />
    </div>
  );
}
