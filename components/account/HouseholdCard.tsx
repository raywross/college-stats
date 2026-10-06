import { Term } from "@/components/ui/info-tip";
import { canRemove, editAccessControl, householdSeats, isPending, memberInitial, memberName, shortDate, type HouseholdView, type RosterMember } from "@/lib/household-rules";
import { leaveHousehold, removeMember, revokeInvitation, setMemberCanEdit } from "@/app/account/household/actions";
import type { HomeRow } from "@/lib/home-store";
import { HouseholdActionButton } from "./HouseholdActionButton";
import { HomeForm } from "./HomeForm";
import { AddManagedStudentForm, InviteForm, LinkManagedStudent, ReissueInvitation } from "./HouseholdForms";

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
        {memberInitial(m)}
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
        {m.managed_by_me && m.student_id && <LinkManagedStudent household={h.id} student={m.student_id} name={name} />}
        {m.role === "guardian" && !m.can_edit && edit.grant && (
          <HouseholdActionButton action={setMemberCanEdit} fields={{ member: m.member_id ?? "", can_edit: "true" }} label="Allow editing" />
        )}
        {m.role === "guardian" && m.can_edit && edit.revoke && (
          <HouseholdActionButton action={setMemberCanEdit} fields={{ member: m.member_id ?? "", can_edit: "false" }} label={m.is_me ? "Give up editing" : "View only"} />
        )}
        {canRemove(h.me, m) && (
          <HouseholdActionButton
            action={removeMember}
            fields={{ member: m.member_id ?? "" }}
            label="Remove"
            tone="danger"
            confirm={`Remove ${name} from ${h.name}? ${m.role === "guardian" ? "They'll lose access to the students here right away." : "Guardians here will lose access to their information right away."}`}
          />
        )}
      </div>
    </li>
  );
}

/**
 * One household on /account/household: members and seats, its home address (specs/product/home-and-distance.md),
 * pending invitations, invite, add a student, leave. `home` is this household's saved home, if any.
 */
export function HouseholdCard({ h, home = null, suggestions = false }: { h: HouseholdView; home?: HomeRow | null; suggestions?: boolean }) {
  const isGuardian = h.me.guardian !== null;
  const isStudent = h.me.student !== null;
  const seats = householdSeats(h);
  // The roster now carries pending invitations as rows (20261006150000_household_hub.sql); this page keeps showing
  // them in their own section until the household hub replaces it.
  const members = h.members.filter((m) => m.member_id !== null);
  const invitations = h.members.filter((m) => m.invitation_id !== null && isPending(m));
  const managedHere = members.filter((m) => m.managed_by_me && m.student_id).map((m) => ({ id: m.student_id as string, name: memberName(m) }));

  return (
    <section className="rounded-3xl border bg-card p-4 sm:p-6" aria-labelledby={`hh-${h.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`hh-${h.id}`} className="font-display text-xl font-bold break-words sm:text-2xl">
            {h.name}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            You&apos;re {isGuardian && isStudent ? "a guardian and a student" : isGuardian ? "a guardian" : "a student"} here · {seats.taken} of {seats.max} seats taken
            {invitations.length > 0 && ", counting invitations"}.
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
        {members.map((m) => (
          <MemberRow key={m.member_id} m={m} h={h} />
        ))}
      </ul>

      <div id="home" className="mt-6 scroll-mt-24 border-t pt-5">
        <h3 className="text-sm font-semibold">
          <Term term="home-address">Home address</Term>
        </h3>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Explore and lists say how far each college is from here, for everyone in this household.</p>
        <HomeForm household={h.id} home={home} suggestions={suggestions} />
      </div>

      {invitations.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold">
            Waiting for an answer <span className="font-normal text-muted-foreground">({invitations.length})</span>
          </h3>
          <ul className="divide-y">
            {invitations.map((inv) => {
              const id = inv.invitation_id as string;
              const who = inv.email ?? memberName(inv);
              return (
                <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{inv.display_name?.trim() ? `${inv.display_name}${inv.email ? ` (${inv.email})` : ""}` : who}</p>
                    <p className="text-xs text-muted-foreground">
                      As {inv.role === "guardian" ? (inv.can_edit ? "a guardian who can edit" : "a guardian") : "a student"} ·{" "}
                      {inv.status === "expired" ? "expired" : "expires"} {inv.expires_at ? shortDate(inv.expires_at) : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start justify-end gap-2">
                    <ReissueInvitation household={h.id} invitation={id} />
                    <HouseholdActionButton action={revokeInvitation} fields={{ invitation: id }} label="Cancel" confirm={`Cancel the invitation to ${who}? The link stops working.`} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {seats.full ? (
        <p className="mt-6 rounded-2xl bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground" role="status">
          This household is full: {seats.max} seats, counting invitations waiting for an answer. Cancel an invitation or remove someone to make room.
          {managedHere.length > 0 && " Linking a student you added to their own account (on their row above) still works: it takes no new seat."}
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
    </section>
  );
}
