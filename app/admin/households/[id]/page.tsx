import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { ConfirmTyped } from "@/components/admin/ConfirmTyped";
import { Empty, Fields, Muted, PageHeader, Panel } from "@/components/admin/Panel";
import { PersonPicker } from "@/components/admin/PersonPicker";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { CONFIRM_REMOVE, fmtDate, moveWarning } from "@/lib/admin/console";
import { findPeople } from "@/lib/admin/console-reads";
import { adminHousehold, type AdminHousehold, type AdminInvitation, type AdminMember, type SearchRow } from "@/lib/admin/people";
import { isUuid } from "@/lib/household-hub";
import { HOUSEHOLD_MAX_MEMBERS } from "@/lib/household-rules";
import { addToHousehold, cancelInvitation, closeHousehold, removeMember, renameHousehold } from "./actions";

export const metadata: Metadata = { title: "Household", robots: { index: false, follow: false } };

const INVITATION_TONE = { pending: "info", expired: "warn", accepted: "good", revoked: "neutral" } as const;
const INVITATION_LABEL = { pending: "Waiting", expired: "Expired", accepted: "Accepted", revoked: "Cancelled" } as const;

/**
 * /admin/households/[id] (specs/product/admin.md "A household"): the roster as the family sees it, invitations
 * (never the token), the seat count, and every household action. Adding a student or a parent searches on this page
 * (`?add=student|parent&q=…`); someone already in another household is moved, and the button says which household.
 */
export default async function HouseholdPage({ params, searchParams }: PageProps<"/admin/households/[id]">) {
  await connection();
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const household = await adminHousehold(id);
  if (!household) notFound();

  const sp = await searchParams;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const add = pick(sp.add) === "student" ? "student" : pick(sp.add) === "parent" ? "parent" : null;
  const q = pick(sp.q);
  const found: SearchRow[] | null = add && q ? (await findPeople(q, [add === "student" ? "student" : "user"])).filter((r) => r.household_id !== id) : null;

  const closed = household.deleted_at !== null;
  const empty = household.members.length === 0;
  const guardians = household.members.filter((m) => m.role === "guardian");
  const students = household.members.filter((m) => m.role === "student");

  return (
    <>
      <PageHeader
        back={
          <Link href="/admin/people" className="text-muted-foreground underline-offset-4 hover:underline">
            People
          </Link>
        }
        title={household.name}
        chips={closed ? <StatusChip label={`Closed ${fmtDate(household.deleted_at)}`} tone="danger" /> : undefined}
        subtitle={`${household.seats} of ${HOUSEHOLD_MAX_MEMBERS} seats${household.invitations.some((i) => i.state === "pending") ? ", counting invitations waiting for an answer" : ""}`}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Panel title="Household" id="household">
            <Fields
              items={[
                { label: "Created", value: fmtDate(household.created) },
                { label: "Created by", value: household.created_by ? <PersonLink id={household.created_by} name={household.created_by_name} /> : <Muted>Unknown</Muted> },
                { label: "Home", value: household.home ? `${household.home.place}${household.home.set_by_name ? ` (set by ${household.home.set_by_name})` : ""}` : <Muted>Not set</Muted> },
                { label: "Seats", value: `${household.seats} of ${HOUSEHOLD_MAX_MEMBERS}` },
              ]}
            />
            <p className="mt-2 text-xs text-muted-foreground">City and state only: the street address is the family&apos;s.</p>
          </Panel>

          <Panel title="Who is in it" id="roster">
            {empty ? (
              <Empty>No one is in this household.</Empty>
            ) : (
              <div className="space-y-4">
                {students.length > 0 && <Roster title="Students" members={students} disabled={closed} />}
                {guardians.length > 0 && <Roster title="Parents and guardians" members={guardians} disabled={closed} />}
              </div>
            )}
          </Panel>

          <Panel title="Invitations" id="invitations">
            {household.invitations.length === 0 ? (
              <Empty>No invitations.</Empty>
            ) : (
              <ul className="divide-y text-sm">
                {household.invitations.map((i) => (
                  <InvitationLine key={i.id} i={i} />
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Invitation links are never shown here: the console holds no token.</p>
          </Panel>

          {!closed && (
            <>
              <Panel title="Add a student" id="add-student">
                <PersonPicker
                  action={`/admin/households/${id}`}
                  param="add"
                  mode="student"
                  q={add === "student" ? q : ""}
                  label="Search a student record by name or id"
                  rows={add === "student" ? found : null}
                  renderAction={(r) => <AddButton household={household} row={r} parent={false} />}
                />
              </Panel>
              <Panel title="Add a parent" id="add-parent">
                <PersonPicker
                  action={`/admin/households/${id}`}
                  param="add"
                  mode="parent"
                  q={add === "parent" ? q : ""}
                  label="Search a person by name, email, or id"
                  rows={add === "parent" ? found : null}
                  renderAction={(r) => <AddButton household={household} row={r} parent />}
                />
              </Panel>
            </>
          )}
        </div>

        <aside className="min-w-0">
          <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5 lg:sticky lg:top-(--header-h)">
            <h2 className="font-display text-lg font-bold tracking-tight">Actions</h2>
            {closed ? (
              <p className="text-sm text-muted-foreground">This household is closed. There is nothing to change.</p>
            ) : (
              <div className="space-y-3">
                <AdminForm
                  action={renameHousehold}
                  hidden={{ household: id }}
                  trigger="Rename"
                  submit="Save name"
                  fields={[{ name: "name", label: "Household name", defaultValue: household.name, required: true, maxLength: 80 }]}
                />
                {empty ? (
                  <AdminForm
                    action={closeHousehold}
                    hidden={{ household: id }}
                    trigger="Close household"
                    submit="Close household"
                    tone="danger"
                    description="Closes this empty household and cancels its waiting invitations."
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">A household can be closed once everyone has been removed.</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function PersonLink({ id, name }: { id: string; name: string | null }) {
  return (
    <Link href={`/admin/people/${id}`} className="underline-offset-4 hover:underline">
      {name ?? "Unnamed"}
    </Link>
  );
}

function Roster({ title, members, disabled }: { title: string; members: AdminMember[]; disabled: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <ul className="mt-1 divide-y">
        {members.map((m) => {
          const href = m.user_id ? `/admin/people/${m.user_id}` : m.student_id ? `/admin/students/${m.student_id}` : null;
          const name = m.name ?? "Unnamed";
          return (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {href ? (
                    <Link href={href} className="break-words underline-offset-4 hover:underline">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                  {m.managed && <StatusChip label="No account yet" />}
                  {m.role === "guardian" && !m.can_edit && <StatusChip label="View only" />}
                </p>
                <p className="text-xs text-muted-foreground">Joined {fmtDate(m.since)}</p>
              </div>
              {!disabled && (
                <ConfirmTyped
                  action={removeMember}
                  hidden={{ member: m.id }}
                  trigger="Remove"
                  submit="Remove from household"
                  expected={CONFIRM_REMOVE}
                  description={
                    m.managed
                      ? "Removes this student record from the household. The record itself is never deleted by this. If this is the only parent or guardian of a student without an account, it is refused: add another guardian first, or delete the student's record."
                      : "Removes them from the household. Their own lists and numbers stay with them. The household sees a note that Quad support removed them."
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InvitationLine({ i }: { i: AdminInvitation }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="break-all">{i.display_name ?? i.email}</span>
          <StatusChip label={INVITATION_LABEL[i.state]} tone={INVITATION_TONE[i.state]} />
        </p>
        <p className="text-xs break-all text-muted-foreground">
          {i.display_name ? `${i.email} · ` : ""}
          {i.side === "student" ? "As a student" : "As a parent or guardian"}
          {i.invited_by_name ? ` · invited by ${i.invited_by_name}` : ""} · {i.state === "pending" ? `expires ${fmtDate(i.expires_at)}` : i.state === "expired" ? `expired ${fmtDate(i.expires_at)}` : `sent ${fmtDate(i.created)}`}
        </p>
      </div>
      {i.state === "pending" && <AdminForm action={cancelInvitation} hidden={{ invitation: i.id }} trigger="Cancel invitation" />}
    </li>
  );
}

/** Add (or move) a picked student record or person. The move names the household they are in now. */
function AddButton({ household, row, parent }: { household: AdminHousehold; row: SearchRow; parent: boolean }) {
  const hidden: Record<string, string> = parent ? { household: household.id, user: row.id } : { household: household.id, student: row.id };
  const warning = moveWarning(row.name, row.household, row.household_id, household.id);
  const fields = parent ? [{ name: "can_edit", label: "Can edit this household's lists and numbers", type: "checkbox" as const, checked: true }] : [];
  return (
    <AdminForm
      action={addToHousehold}
      hidden={hidden}
      trigger={warning ? "Move here" : parent ? "Add as parent" : "Add"}
      submit={warning ? "Move to this household" : "Add"}
      tone={warning ? "danger" : "default"}
      description={warning ?? (parent ? "Adds them as a parent or guardian. The household sees a note that Quad support added them." : undefined)}
      fields={fields}
    />
  );
}
