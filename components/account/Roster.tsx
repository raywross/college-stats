import Link from "next/link";
import { Bookmark, GraduationCap, Phone } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { leaveHousehold, removeMember, revokeInvitation, setMemberCanEdit } from "@/app/household/actions";
import { canRemove, editAccessControl, formatPhone, isPending, memberInitial, memberName, personHref, type HouseholdView, type RosterMember } from "@/lib/household-rules";
import { statusLabel } from "@/lib/household-hub";
import { cn } from "@/lib/utils";
import { HouseholdActionButton } from "./HouseholdActionButton";
import { CopyInvitationButton, InviteManagedStudent, ResendInvitationButton } from "./InvitationControls";

const badgeCls = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold";
/** The List / Numbers links on a row: the person's pages, filled so they read as the row's main action. */
const pageLinkCls = "inline-flex h-9 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 text-sm font-semibold text-primary hover:bg-primary/20";

function RoleBadge({ m }: { m: RosterMember }) {
  if (m.role === "guardian")
    return (
      <span className={`${badgeCls} bg-muted text-muted-foreground`}>
        <Term term="guardian">Guardian</Term>
      </span>
    );
  if (m.managed)
    return (
      <span className={`${badgeCls} bg-muted text-muted-foreground`}>
        <Term term="managed-student">Managed student</Term>
      </span>
    );
  return <span className={`${badgeCls} bg-pop/25 text-foreground`}>Student</span>;
}

function StatusChip({ m }: { m: RosterMember }) {
  const label = statusLabel(m);
  if (!label) return null;
  return (
    <span
      className={cn(
        badgeCls,
        "border",
        m.status === "expired" ? "border-destructive/40 text-destructive" : m.status === "invited" ? "border-primary/40 text-primary" : "text-muted-foreground",
      )}
    >
      {m.status === "invited" || m.status === "expired" ? <Term term="household-invitation">{label}</Term> : label}
    </span>
  );
}

function Avatar({ m }: { m: RosterMember }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
        isPending(m) ? "border border-dashed border-primary/50 text-primary" : "bg-primary/12 text-primary",
      )}
    >
      {memberInitial(m)}
    </span>
  );
}

function MemberRow({ m, h, leaveHere }: { m: RosterMember; h: HouseholdView; leaveHere: boolean }) {
  const name = memberName(m);
  const href = personHref(m);
  const edit = editAccessControl(h.me, m, h.members);
  const isStudentViewer = h.me.student !== null;
  const details = [m.role === "student" && m.grad_year ? `Class of ${m.grad_year}` : null, m.email].filter(Boolean).join(" · ");

  const identity = (
    <>
      <Avatar m={m} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("font-semibold break-words", href && "group-hover:text-primary group-hover:underline")}>{name}</span>
          {m.is_me && <span className="text-xs text-muted-foreground">(you)</span>}
        </span>
      </span>
    </>
  );

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3.5">
      <div className="min-w-0 flex-1 basis-56">
        {href ? (
          <Link href={href} className="group flex min-w-0 items-center gap-3">
            {identity}
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-3">{identity}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-13">
          <RoleBadge m={m} />
          <StatusChip m={m} />
          {details && <span className="text-xs text-muted-foreground break-all">{details}</span>}
        </div>
        {m.phone && (
          <p className="mt-1 flex items-center gap-1.5 pl-13 text-xs text-muted-foreground">
            <Phone className="size-3" aria-hidden />
            <a href={`tel:${m.phone}`} className="hover:text-foreground">
              {formatPhone(m.phone)}
            </a>
          </p>
        )}
        {m.role === "guardian" && m.member_id !== null && (
          <p className="mt-1 pl-13 text-xs text-muted-foreground">
            {m.can_edit ? (
              <>
                Can <Term term="edit-access">edit</Term> the students&apos; lists and profiles
              </>
            ) : (
              "Can view the students' lists and profiles"
            )}
          </p>
        )}
        {m.role === "guardian" && m.member_id === null && m.can_edit && (
          <p className="mt-1 pl-13 text-xs text-muted-foreground">
            Will be able to <Term term="edit-access">edit</Term> {isStudentViewer ? "your" : "the students'"} list and profile
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-end gap-2 max-sm:w-full max-sm:justify-start max-sm:pl-13">
        {href && (
          <Link href={href} className={pageLinkCls}>
            <Bookmark className="size-3.5" aria-hidden />
            List
          </Link>
        )}
        {href && m.role === "student" && (
          <Link href={`${href}/numbers`} className={pageLinkCls}>
            <GraduationCap className="size-3.5" aria-hidden />
            Numbers
          </Link>
        )}
        {m.invitation_id && m.status === "invited" && <CopyInvitationButton invitation={m.invitation_id} />}
        {m.invitation_id && isPending(m) && <ResendInvitationButton household={h.id} invitation={m.invitation_id} name={name} />}
        {m.invitation_id && isPending(m) && (
          <HouseholdActionButton
            action={revokeInvitation}
            fields={{ invitation: m.invitation_id }}
            label="Cancel"
            confirm={
              m.member_id === null
                ? `Cancel the invitation to ${name}? The link stops working and they leave the list.`
                : `Cancel the link that hands ${name}'s record over? It stops working; ${name} stays in the household.`
            }
          />
        )}
        {m.status === "managed" && m.managed_by_me && m.student_id && <InviteManagedStudent household={h.id} student={m.student_id} name={name} />}
        {m.role === "guardian" && m.member_id && !m.can_edit && edit.grant && (
          <HouseholdActionButton action={setMemberCanEdit} fields={{ member: m.member_id, can_edit: "true" }} label="Allow editing" />
        )}
        {m.role === "guardian" && m.member_id && m.can_edit && edit.revoke && (
          <HouseholdActionButton action={setMemberCanEdit} fields={{ member: m.member_id, can_edit: "false" }} label={m.is_me ? "Give up editing" : "View only"} />
        )}
        {m.member_id && canRemove(h.me, m) && (
          <HouseholdActionButton
            action={removeMember}
            fields={{ member: m.member_id }}
            label="Remove"
            tone="danger"
            confirm={`Remove ${name} from ${h.name}? ${m.role === "guardian" ? "They'll lose access to the students here right away." : "Guardians here will lose access to their information right away."}`}
          />
        )}
        {leaveHere && h.id && (
          <HouseholdActionButton
            action={leaveHousehold}
            fields={{ household: h.id }}
            label="Leave"
            tone="danger"
            confirm={`Leave ${h.name}? ${isStudentViewer ? "Its guardians will stop seeing your information right away." : "You'll stop seeing its students' information right away."} To come back you'll need a new invitation.`}
          />
        )}
      </div>
    </li>
  );
}

/**
 * The household's one roster (specs/product/household-hub.md "The roster: everyone by name"): students, then
 * guardians, each with an avatar letter, name, role, class year, phone, status (Invited · Expired · No account yet),
 * and the actions that row allows. The name links to the person's page. Pending invitations are rows like anyone
 * else's. `h.id` empty is the solo view (no household yet): just the viewer, no actions.
 */
export function Roster({ h }: { h: HouseholdView }) {
  // Leave sits on the viewer's first own row (someone can be both a guardian and, through their own record, a student).
  const leaveRow = h.members.find((m) => m.is_me && m.member_id !== null);
  return (
    <ul className="divide-y">
      {h.members.map((m) => (
        <MemberRow key={m.member_id ?? m.invitation_id ?? m.user_id ?? m.student_id} m={m} h={h} leaveHere={m === leaveRow} />
      ))}
    </ul>
  );
}
