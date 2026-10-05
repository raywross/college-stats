import { Term } from "@/components/ui/info-tip";
import { initialsFor } from "@/lib/accounts";
import { canRemove, editAccessControl, householdSeats, memberName, shortDate, type HouseholdView, type RosterMember } from "@/lib/household-rules";
import { leaveHousehold, removeMember, revokeInvitation, setMemberCanEdit } from "@/app/account/household/actions";
import { HouseholdActionButton } from "./HouseholdActionButton";
import { AddManagedStudentForm, InviteForm } from "./HouseholdForms";

function RoleBadge({ m }: { m: RosterMember }) {
  const cls = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold";
  if (m.role === "guardian")
    return (
      <span className={`${cls} bg-muted text-muted-foreground`}>
        <Term term="guardian">Guardian</Term>
      </span>
    );
  if (m.managed)
    return (
      <span className={`${cls} bg-muted text-muted-foreground`}>
        <Term term="managed-student">Managed student</Term>
      </span>
    );
  return <span className={`${cls} bg-pop/25 text-foreground`}>Student</span>;
}

function MemberRow({ m, h }: { m: RosterMember; h: HouseholdView }) {
  const edit = editAccessControl(h.me, m, h.members);
  const name = memberName(m);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">
        {initialsFor(m.display_name, null)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold">{name}</span>
          {m.is_me && <span className="text-xs text-muted-foreground">(you)</span>}
          <RoleBadge m={m} />
        </p>
        {m.role === "guardian" && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {m.can_edit ? (
              <>
                Can <Term term="edit-access">edit</Term> the students&apos; lists and profiles
              </>
            ) : (
              "Can view the students' lists and profiles"
            )}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-end gap-2">
        {m.role === "guardian" && !m.can_edit && edit.grant && (
          <HouseholdActionButton action={setMemberCanEdit} fields={{ member: m.member_id, can_edit: "true" }} label="Allow editing" />
        )}
        {m.role === "guardian" && m.can_edit && edit.revoke && (
          <HouseholdActionButton action={setMemberCanEdit} fields={{ member: m.member_id, can_edit: "false" }} label={m.is_me ? "Give up editing" : "View only"} />
        )}
        {canRemove(h.me, m) && (
          <HouseholdActionButton
            action={removeMember}
            fields={{ member: m.member_id }}
            label="Remove"
            tone="danger"
            confirm={`Remove ${name} from ${h.name}? ${m.role === "guardian" ? "They'll lose access to the students here right away." : "Guardians here will lose access to their information right away."}`}
          />
        )}
      </div>
    </li>
  );
}

/** One household on /account/household: members and seats, pending invitations, invite, add a student, leave. */
export function HouseholdCard({ h }: { h: HouseholdView }) {
  const isGuardian = h.me.guardian !== null;
  const isStudent = h.me.student !== null;
  const seats = householdSeats(h);
  const managedHere = h.members.filter((m) => m.managed_by_me && m.student_id).map((m) => ({ id: m.student_id as string, name: memberName(m) }));
  const nameOf = (userId: string | null) => {
    const m = h.members.find((x) => x.user_id === userId);
    return m ? memberName(m) : "a former member";
  };

  return (
    <section className="rounded-3xl border bg-card p-4 sm:p-6" aria-labelledby={`hh-${h.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`hh-${h.id}`} className="font-display text-xl font-bold break-words sm:text-2xl">
            {h.name}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            You&apos;re {isGuardian && isStudent ? "a guardian and a student" : isGuardian ? "a guardian" : "a student"} here · {seats.taken} of {seats.max} seats taken
            {h.invitations.length > 0 && ", counting invitations"}.
          </p>
        </div>
        <HouseholdActionButton
          action={leaveHousehold}
          fields={{ household: h.id }}
          label="Leave"
          tone="danger"
          confirm={`Leave ${h.name}? ${isStudent ? "Its guardians will stop seeing your information right away." : "You'll stop seeing its students' information right away."} To come back you'll need a new invitation.`}
        />
      </div>

      <h3 className="mt-5 text-sm font-semibold">Members</h3>
      <ul className="divide-y">
        {h.members.map((m) => (
          <MemberRow key={m.member_id} m={m} h={h} />
        ))}
      </ul>

      {h.invitations.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold">
            Waiting for an answer <span className="font-normal text-muted-foreground">({h.invitations.length})</span>
          </h3>
          <ul className="divide-y">
            {h.invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    As {inv.side === "guardian" ? (inv.can_edit ? "a guardian who can edit" : "a guardian") : "a student"} · invited by {nameOf(inv.invited_by)} · expires {shortDate(inv.expires_at)}
                  </p>
                </div>
                <HouseholdActionButton action={revokeInvitation} fields={{ invitation: inv.id }} label="Cancel" confirm={`Cancel the invitation to ${inv.email}? The link stops working.`} />
              </li>
            ))}
          </ul>
        </>
      )}

      {seats.full ? (
        <p className="mt-6 rounded-2xl bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground" role="status">
          This household is full: {seats.max} seats, counting invitations waiting for an answer. Cancel an invitation or remove someone to make room
          {managedHere.length > 0 && "; handing a student you added over to their own account takes no new seat"}.
        </p>
      ) : (
        <>
          <div className="mt-6 border-t pt-5">
            <h3 className="text-sm font-semibold">
              Invite someone <span className="font-normal text-muted-foreground">by <Term term="household-invitation">invitation</Term></span>
            </h3>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
              They join only when they accept, signed in with that email. Someone already in another household with other people can&apos;t accept until
              they leave it.
            </p>
            <InviteForm household={h.id} canInviteStudents={isGuardian} isStudent={isStudent} managedStudents={managedHere} />
          </div>

          {isGuardian && (
            <div className="mt-6 border-t pt-5">
              <h3 className="text-sm font-semibold">
                Add a student without an account <span className="font-normal text-muted-foreground">(a <Term term="managed-student">managed student</Term>)</span>
              </h3>
              <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Start their list now; invite them later to hand it over.</p>
              <AddManagedStudentForm household={h.id} />
            </div>
          )}
        </>
      )}
      {seats.full && managedHere.length > 0 && (
        <div className="mt-6 border-t pt-5">
          <h3 className="text-sm font-semibold">Hand over a student you added</h3>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Their account takes the seat the record already holds.</p>
          <InviteForm household={h.id} canInviteStudents={isGuardian} isStudent={isStudent} managedStudents={managedHere} handoverOnly />
        </div>
      )}
    </section>
  );
}
