import { Term } from "@/components/ui/info-tip";
import type { MemberRole } from "@/lib/accounts";
import { HOUSEHOLD_MAX_MEMBERS, type HouseholdView } from "@/lib/household-rules";
import { defaultAddRole } from "@/lib/household-hub";

/**
 * What AddPersonDialog needs, worked out on the server (app/household/layout.tsx and the empty state in
 * app/household/page.tsx share it): the dialog's description, the household to add to ("" to start one), and which
 * roles the viewer may add.
 */
export function addPersonProps(h: HouseholdView | null, myRole: MemberRole, defaultHouseholdName: string) {
  return {
    description: h ? (
      <>
        They appear in the household right away, by name. Anyone with an email joins when they open their <Term term="household-invitation">link</Term>.
      </>
    ) : (
      <>
        Adding the first person starts your <Term term="household">household</Term>: up to {HOUSEHOLD_MAX_MEMBERS} people in any mix of parents and
        students, sharing one home address. If someone invited you, open the link they sent instead.
      </>
    ),
    household: h?.id ?? "",
    myRole,
    canAddStudents: h ? h.me.guardian !== null : myRole === "guardian",
    viewerIsStudent: h ? h.me.student !== null : myRole === "student",
    defaultRole: defaultAddRole(h?.me ?? null, myRole),
    defaultHouseholdName,
  };
}

/** The viewer's side when they have no household yet: what their account says, else student if they have a record. */
export function soloRole(roleHint: string | null | undefined, hasOwnStudent: boolean): MemberRole {
  return roleHint === "guardian" || roleHint === "counselor" ? "guardian" : hasOwnStudent ? "student" : "guardian";
}
