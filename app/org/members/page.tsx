import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { MembersView } from "@/components/org/MembersView";
import { OrgHeader } from "@/components/org/OrgHeader";
import { authConfigured, requireUser } from "@/lib/auth";
import { getHighSchool } from "@/lib/high-schools";
import { requestOrigin } from "@/lib/household-hub";
import { joinHref } from "@/lib/org-rules";
import { myOrganization } from "@/lib/orgs";

export const metadata: Metadata = { title: "Members and settings", robots: { index: false, follow: false } };

/** /org/members (specs/product/counselor-portal.md "Members and settings"). */
export default async function OrgMembersPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/org/members");
  const org = await myOrganization();
  if (!org) redirect("/org");
  const [origin, school] = await Promise.all([headers().then(requestOrigin), org.ncessch ? getHighSchool(org.ncessch).catch(() => null) : Promise.resolve(null)]);
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <OrgHeader name={org.name} kind={org.kind} active="members" />
      <MembersView org={org} joinLink={`${origin}${joinHref(org.join_code)}`} highSchoolName={school?.school.name ?? null} />
    </div>
  );
}
