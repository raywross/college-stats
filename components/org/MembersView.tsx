import { HouseholdActionButton } from "@/components/account/HouseholdActionButton";
import { JoinCode } from "@/components/org/JoinCode";
import { DeleteOrgForm, InviteCounselorForm, OrgSettingsForm } from "@/components/org/MembersForms";
import { Term } from "@/components/ui/info-tip";
import { leaveOrganization, regenerateJoinCode, removeMember, setMemberRole } from "@/app/org/actions";
import { ORG_KIND_LABEL, type Organization } from "@/lib/org-rules";

const card = "space-y-4 rounded-3xl border bg-card p-4 sm:p-6";
const ROLE_LABEL = { owner: "Owner", counselor: "Counselor" } as const;

/**
 * Members and settings (specs/product/counselor-portal.md "Members and settings"): the organization's name, kind,
 * high school, and website (owners edit); the join code with its link, Copy, and Regenerate; the members with roles,
 * a role change and Remove (owners); Invite a counselor (owners); Leave; and, for owners, Delete with a typed
 * confirmation. The database holds every rule (the last owner can't leave or step down without naming another).
 */
export function MembersView({ org, joinLink, highSchoolName }: { org: Organization; joinLink: string; highSchoolName: string | null }) {
  const owner = org.my_role === "owner";
  return (
    <div className="space-y-5">
      <section className={card} aria-labelledby="settings-heading">
        <h2 id="settings-heading" className="font-display text-lg font-bold">
          Organization
        </h2>
        {owner ? (
          <OrgSettingsForm org={{ id: org.id, name: org.name, kind: org.kind, website: org.website, ncessch: org.ncessch, highSchoolName }} />
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium break-words">{org.name}</dd>
            <dt className="text-muted-foreground">Kind</dt>
            <dd>{ORG_KIND_LABEL[org.kind]}</dd>
            {org.kind === "school" && (
              <>
                <dt className="text-muted-foreground">High school</dt>
                <dd>{highSchoolName ?? "Not set"}</dd>
              </>
            )}
            {org.website && (
              <>
                <dt className="text-muted-foreground">Website</dt>
                <dd className="break-words">{org.website}</dd>
              </>
            )}
          </dl>
        )}
      </section>

      <section className={card} aria-labelledby="code-heading">
        <div>
          <h2 id="code-heading" className="font-display text-lg font-bold">
            <Term term="join-code">Join code</Term>
          </h2>
          <p className="text-sm text-muted-foreground">Students open the link or type the code at /join to share their account with you.</p>
        </div>
        <JoinCode code={org.join_code} link={joinLink} />
        {owner && (
          <HouseholdActionButton
            action={regenerateJoinCode}
            fields={{ org: org.id }}
            label="Regenerate"
            pendingLabel="Making a new code…"
            confirm="Make a new code? The old code and its link stop working at once. Students already on your caseload stay."
            className="items-start"
          />
        )}
      </section>

      <section className={card} aria-labelledby="members-heading">
        <h2 id="members-heading" className="font-display text-lg font-bold">
          Members
        </h2>
        <ul className="divide-y">
          {org.members.map((m) => (
            <li key={m.member_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold break-words">
                  {m.display_name ?? "A member"}
                  {m.is_me && <span className="font-normal text-muted-foreground"> (you)</span>}
                </p>
                <p className="text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</p>
              </div>
              {owner && (
                <div className="flex flex-wrap items-start gap-2">
                  <HouseholdActionButton
                    action={setMemberRole}
                    fields={{ member: m.member_id, role: m.role === "owner" ? "counselor" : "owner" }}
                    label={m.role === "owner" ? "Make counselor" : "Make owner"}
                    pendingLabel="Saving…"
                  />
                  {!m.is_me && (
                    <HouseholdActionButton
                      action={removeMember}
                      fields={{ member: m.member_id }}
                      label="Remove"
                      pendingLabel="Removing…"
                      confirm={`Remove ${m.display_name ?? "this member"}? They stop seeing the caseload at once.`}
                      tone="danger"
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {owner && (
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">Invite a counselor</h3>
            <InviteCounselorForm orgId={org.id} />
          </div>
        )}
      </section>

      <section className={card} aria-labelledby="leave-heading">
        <h2 id="leave-heading" className="font-display text-lg font-bold">
          Leave or delete
        </h2>
        <HouseholdActionButton
          action={leaveOrganization}
          fields={{}}
          label="Leave the organization"
          pendingLabel="Leaving…"
          confirm={`Leave ${org.name}? You stop seeing its students at once.`}
          tone="danger"
          className="items-start"
        />
        {owner && <DeleteOrgForm orgId={org.id} orgName={org.name} />}
      </section>
    </div>
  );
}
