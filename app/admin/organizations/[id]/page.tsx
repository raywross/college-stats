import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Empty, Fields, Muted, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDate } from "@/lib/admin/console";
import { adminOrganization } from "@/lib/admin/organizations";
import { isUuid } from "@/lib/household-hub";
import { ORG_KIND_LABEL, formatJoinCode } from "@/lib/org-rules";

export const metadata: Metadata = { title: "Organization", robots: { index: false, follow: false } };

/**
 * /admin/organizations/[id] (specs/product/counselor-portal.md "The channel"): one organization's members, the
 * students with a live grant and when it was granted, invited students, and how many asks the office has sent.
 * Every name links to the person's or the student's own console page; nothing here is a student's data (the
 * student page shows that, and logs the view).
 */
export default async function OrganizationPage({ params }: PageProps<"/admin/organizations/[id]">) {
  await connection();
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const org = await adminOrganization(id);
  if (!org) notFound();

  return (
    <>
      <PageHeader
        back={
          <Link href="/admin/organizations" className="text-muted-foreground underline-offset-4 hover:underline">
            Organizations
          </Link>
        }
        title={org.name}
        chips={org.deleted_at ? <StatusChip label={`Deleted ${fmtDate(org.deleted_at)}`} tone="danger" /> : undefined}
        subtitle={`${ORG_KIND_LABEL[org.kind]}${org.highSchoolName ? ` · ${org.highSchoolName}` : ""}`}
      />

      <div className="space-y-5">
        <Panel title="Organization" id="organization">
          <Fields
            items={[
              { label: "Created", value: fmtDate(org.created) },
              { label: "Join code", value: formatJoinCode(org.joinCode) },
              { label: "Website", value: org.website ?? <Muted>Not set</Muted> },
              { label: "Asks sent", value: `${org.asks.total}${org.asks.open ? ` (${org.asks.open} open)` : ""}` },
            ]}
          />
        </Panel>

        <Panel title="Members" id="members">
          {org.members.length === 0 ? (
            <Empty>No members.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {org.members.map((m) => (
                <li key={m.member_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/people/${m.user_id}`} className="font-semibold underline-offset-4 hover:underline">
                      {m.name ?? "Unnamed"}
                    </Link>
                    {m.role === "owner" && <StatusChip label="Owner" tone="info" />}
                  </span>
                  <span className="text-xs text-muted-foreground">Joined {fmtDate(m.joined)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Students" id="students">
          {org.students.length === 0 ? (
            <Empty>No students have granted this organization access yet.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {org.students.map((s) => (
                <li key={s.grant_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    {s.has_account ? (
                      <Link href={`/admin/students/${s.student_id}`} className="font-semibold underline-offset-4 hover:underline">
                        {s.name ?? "Unnamed"}
                      </Link>
                    ) : (
                      <span className="font-semibold">{s.name ?? "Unnamed"}</span>
                    )}
                    {s.grad_year && <span className="text-xs text-muted-foreground">Class of {s.grad_year}</span>}
                    {!s.can_edit && <StatusChip label="View only" />}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Granted {fmtDate(s.granted_at)} ({s.source === "code" ? "by code" : "by invitation"})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Invited students" id="invited">
          {org.invitedStudents.length === 0 ? (
            <Empty>No invitations waiting.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {org.invitedStudents.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-all">{i.display_name ?? i.email}</span>
                    <StatusChip label={i.state === "invited" ? "Invited" : "Expired"} tone={i.state === "invited" ? "info" : "warn"} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i.display_name ? `${i.email} · ` : ""}
                    {i.state === "invited" ? `expires ${fmtDate(i.expires_at)}` : `expired ${fmtDate(i.expires_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Invitation links are never shown here: the console holds no token.</p>
        </Panel>
      </div>
    </>
  );
}
