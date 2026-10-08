import { Phone } from "lucide-react";
import { GuardianBanner } from "@/components/account/GuardianBanner";
import { Term } from "@/components/ui/info-tip";
import { SegmentedLinks } from "@/components/ui/segmented-control";
import { myHouseholds, type PersonPage } from "@/lib/households";
import { personActions, statusLabel } from "@/lib/household-hub";
import { formatPhone, type HouseholdView, type RosterMember } from "@/lib/household-rules";
import type { ListOwner } from "@/lib/list-rules";
import { cn } from "@/lib/utils";
import { PersonMenu } from "./PersonMenu";

export type PersonTab = "list" | "plan" | "numbers";

/** Whose lists a person's page shows: a student's record, or a guardian's own (lists.user_id). */
export function personOwner(person: PersonPage): ListOwner {
  return person.kind === "student" ? { kind: "student", id: person.access.student.id } : { kind: "user", id: person.user_id };
}

/** The person's name as their page's title: their own words, never an email. */
export function personTitle(person: PersonPage): string {
  const name = person.kind === "student" ? person.access.student.display_name : person.display_name;
  return name?.trim() || (person.kind === "student" ? "A student" : "A guardian");
}

/** The person's roster row and its household: a student by record, a guardian by membership. Null in the solo view. */
function rosterRow(households: HouseholdView[], person: PersonPage): { h: HouseholdView; row: RosterMember } | null {
  for (const h of households) {
    const row =
      person.kind === "student"
        ? h.members.find((m) => m.student_id === person.access.student.id)
        : h.members.find((m) => m.role === "guardian" && m.member_id !== null && m.user_id === person.user_id);
    if (row) return { h, row };
  }
  return null;
}

const badgeCls = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold";

/**
 * The person area: the top of a person's page, under the people strip (specs/product/household-hub.md "Redesign
 * (2026-10-06)"). One name line: first and last name, "(you)", the role badge, "Class of 2028", a status while they
 * haven't finished joining, and their phone as a call icon; the "⋯" menu (PersonMenu) at the right holds the rare
 * actions (personActions() decides which). Under it, the guardian banner when a guardian is looking at a student,
 * then the List | Plan | Numbers segmented control (students only; specs/planner/model.md "Where it lives"), which links between the routes. No back
 * link and no tabs row: the strip above is how you move between people, and it never changes.
 *
 * A server component: it reads the roster (myHouseholds(), cached per request, the same read the layout makes).
 */
export async function PersonHeader({ id, person, active }: { id: string; person: PersonPage; active: PersonTab }) {
  const title = personTitle(person);
  const own = person.kind === "student" ? person.access.relation === "self" : person.is_me;
  const found = rosterRow(await myHouseholds(), person);
  const row = found?.row ?? null;
  const h = found?.h ?? null;
  const gradYear = row?.grad_year ?? (person.kind === "student" ? person.access.student.grad_year : null);
  const status = row ? statusLabel(row) : null;
  const actions = personActions(h?.me ?? { guardian: null, student: null }, row, h?.members ?? [], { householdId: h?.id ?? "", isSelf: own });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-extrabold tracking-tight break-words sm:text-3xl">
            {title}
            {own && <span className="ml-2 align-middle text-sm font-semibold text-muted-foreground">(you)</span>}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <RoleBadge person={person} managed={row?.managed ?? false} />
            {person.kind === "student" && gradYear && <span>Class of {gradYear}</span>}
            {status && (
              <span className={cn(badgeCls, "border", row?.status === "expired" ? "border-destructive/40 text-destructive" : "text-muted-foreground")}>
                {row?.status === "managed" ? status : <Term term="household-invitation">{status}</Term>}
              </span>
            )}
            {row?.role === "guardian" && row.member_id !== null && (
              <span className="text-xs">
                {row.can_edit ? (
                  <>
                    Can <Term term="edit-access">edit</Term> students&apos; lists and numbers
                  </>
                ) : (
                  "Views students' lists and numbers"
                )}
              </span>
            )}
            {row?.phone && (
              <a
                href={`tel:${row.phone}`}
                aria-label={`Call ${formatPhone(row.phone)}`}
                title={formatPhone(row.phone)}
                className="inline-flex size-8 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Phone className="size-3.5" />
              </a>
            )}
          </div>
        </div>
        <PersonMenu actions={actions} row={row} householdId={h?.id ?? ""} householdName={h?.name ?? ""} viewerIsStudent={h?.me.student != null} />
      </div>

      {person.kind === "student" && person.access.relation === "guardian" && (
        <GuardianBanner studentName={person.access.student.display_name} canEdit={person.access.canEdit} />
      )}

      {person.kind === "student" && (
        <SegmentedLinks
          label={`${title}'s pages`}
          value={active}
          options={[
            { value: "list", label: "List", href: `/household/${id}` },
            { value: "plan", label: "Plan", href: `/household/${id}/plan` },
            { value: "numbers", label: "Numbers", href: `/household/${id}/numbers` },
          ]}
        />
      )}
    </div>
  );
}

function RoleBadge({ person, managed }: { person: PersonPage; managed: boolean }) {
  if (person.kind === "guardian")
    return (
      <span className={`${badgeCls} bg-muted text-muted-foreground`}>
        <Term term="guardian">Guardian</Term>
      </span>
    );
  if (managed)
    return (
      <span className={`${badgeCls} bg-muted text-muted-foreground`}>
        <Term term="managed-student">Managed student</Term>
      </span>
    );
  return <span className={`${badgeCls} bg-pop/25 text-foreground`}>Student</span>;
}
