import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { ConfirmTyped } from "@/components/admin/ConfirmTyped";
import { Empty, Fields, KeyValues, Muted, PageHeader, Panel } from "@/components/admin/Panel";
import { PersonPicker } from "@/components/admin/PersonPicker";
import { StandingPanelSlot } from "@/components/admin/StandingPanelSlot";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { CONFIRM_DELETE_RECORD, STUDENT_PAGE_VIEW, fmtDate, fmtDateTime } from "@/lib/admin/console";
import { findPeople } from "@/lib/admin/console-reads";
import { adminStudent, logStudentView, type AdminList, type AdminListItem, type AdminStudent, type SearchRow } from "@/lib/admin/people";
import { getData } from "@/lib/data";
import { isUuid } from "@/lib/household-hub";
import { attachStudent, deleteStudent, editStudent } from "./actions";

export const metadata: Metadata = { title: "Student", robots: { index: false, follow: false } };

/**
 * /admin/students/[id] (specs/product/admin.md "A student record"): the record, then the student's data as the family
 * sees it, read-only: numbers, lists (each college with the standing panel's slot), plan, snapshots. Opening it writes
 * the access row first (admin_log_access, once per render): the student sees "Quad support viewed your information",
 * and nothing is read until the row exists, so a failed log means a failed page, not an unlogged view.
 */
export default async function StudentPage({ params, searchParams }: PageProps<"/admin/students/[id]">) {
  await connection();
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  try {
    await logStudentView(id, STUDENT_PAGE_VIEW);
  } catch (err) {
    if (err instanceof Error && /student_not_found/.test(err.message)) notFound();
    throw err;
  }
  const student = await adminStudent(id);
  if (!student) notFound();

  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const attaching = (Array.isArray(sp.attach) ? sp.attach[0] : sp.attach) === "1";

  const { record } = student;
  const deleted = record.deleted_at !== null;
  const managed = record.user_id === null;
  const found: SearchRow[] | null = attaching && q && managed && !deleted ? await findPeople(q, ["user"]) : null;

  const { getSchoolsByIds } = await getData();
  const unitIds = [...new Set(student.lists.flatMap((l) => l.items.map((i) => i.unit_id)))];
  const names = new Map(getSchoolsByIds(unitIds).map((s) => [s.unit_id, s.name]));

  return (
    <>
      <PageHeader
        back={
          student.household ? (
            <Link href={`/admin/households/${student.household.id}`} className="text-muted-foreground underline-offset-4 hover:underline">
              {student.household.name} household
            </Link>
          ) : (
            <Link href="/admin/people" className="text-muted-foreground underline-offset-4 hover:underline">
              People
            </Link>
          )
        }
        title={record.display_name ?? "Unnamed student"}
        chips={
          <span className="flex flex-wrap items-center gap-1.5">
            {managed ? <StatusChip label="No account yet" /> : <StatusChip label="Has an account" tone="info" />}
            {deleted && <StatusChip label={`Deleted ${fmtDate(record.deleted_at)}`} tone="danger" />}
          </span>
        }
        subtitle="This is what the family sees. Your visit was recorded: the student sees “Quad support viewed your information”."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Panel title="Record" id="record">
            <Fields
              items={[
                { label: "Name", value: record.display_name ?? <Muted>None</Muted> },
                { label: "Graduation year", value: record.grad_year ?? <Muted>Not given</Muted> },
                { label: "Phone", value: record.phone ?? <Muted>None</Muted> },
                { label: "Created", value: fmtDate(record.created) },
                {
                  label: managed ? "Managed by" : "Account",
                  value: (managed ? student.manager : student.owner) ? (
                    <Link href={`/admin/people/${(managed ? student.manager : student.owner)!.id}`} className="underline-offset-4 hover:underline">
                      {(managed ? student.manager : student.owner)!.name ?? "Unnamed"}
                    </Link>
                  ) : (
                    <Muted>None</Muted>
                  ),
                },
                {
                  label: "Household",
                  value: student.household ? (
                    <Link href={`/admin/households/${student.household.id}`} className="underline-offset-4 hover:underline">
                      {student.household.name}
                    </Link>
                  ) : (
                    <Muted>Not in one</Muted>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="Numbers" id="numbers" aside={student.profile ? <Muted>Updated {fmtDate(student.profile.updated_at)}</Muted> : undefined}>
            {student.profile ? <KeyValues data={student.profile.data} /> : <Empty>Nothing entered yet.</Empty>}
          </Panel>

          <Panel title="Lists" id="lists">
            {student.lists.length === 0 ? (
              <Empty>No lists.</Empty>
            ) : (
              <div className="space-y-6">
                {student.lists.map((l) => (
                  <ListBlock key={l.id} list={l} studentId={id} names={names} />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Plan" id="plan">
            <PlanBlock plan={student.plan} />
          </Panel>

          <Panel title="Snapshots" id="snapshots">
            {student.snapshots.length === 0 ? (
              <Empty>No application snapshots.</Empty>
            ) : (
              <ul className="space-y-2">
                {student.snapshots.map((s, i) => (
                  <li key={String(s.id ?? i)}>
                    <details className="rounded-xl border p-3">
                      <summary className="cursor-pointer text-sm font-semibold">
                        {names.get(String(s.unit_id ?? "")) ?? String(s.unit_id ?? "A college")}
                        {s.applied_on ? <span className="font-normal text-muted-foreground"> · applied {fmtDate(String(s.applied_on))}</span> : null}
                      </summary>
                      <div className="mt-2">
                        <KeyValues data={s} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {managed && !deleted && (
            <Panel title="Attach to an account" id="attach">
              <p className="mb-3 text-sm text-muted-foreground">
                Gives this record to an account that has no student record of its own (the same merge a hand-over invitation does). Refused, with the reason, when they already have one.
              </p>
              <PersonPicker
                action={`/admin/students/${id}`}
                param="attach"
                mode="1"
                q={attaching ? q : ""}
                label="Search a person by name, email, or id"
                rows={found}
                renderAction={(r) => (
                  <AdminForm
                    action={attachStudent}
                    hidden={{ student: id, user: r.id }}
                    trigger="Attach to them"
                    submit="Attach record"
                    description={`${record.display_name ?? "This record"} becomes ${r.name ?? "their"}'s own student record. The household's note says Quad support linked them.`}
                  />
                )}
              />
            </Panel>
          )}

          <Panel title="Who viewed this record" id="views">
            {student.accessLog.length === 0 ? (
              <Empty>No views recorded.</Empty>
            ) : (
              <ul className="divide-y text-sm">
                {student.accessLog.slice(0, 50).map((v, i) => (
                  <li key={`${v.at}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 py-1.5">
                    <span>{v.by_admin ? "Quad support (an admin)" : (v.viewer_name ?? "Someone")}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(v.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="min-w-0">
          <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5 lg:sticky lg:top-(--header-h)">
            <h2 className="font-display text-lg font-bold tracking-tight">Actions</h2>
            {deleted ? (
              <p className="text-sm text-muted-foreground">This record is deleted. The purge removes it 30 days after it was deleted.</p>
            ) : (
              <div className="space-y-3">
                <AdminForm
                  action={editStudent}
                  hidden={{ student: id }}
                  trigger="Edit record"
                  submit="Save"
                  fields={[
                    { name: "display_name", label: "Name", defaultValue: record.display_name ?? "", maxLength: 80 },
                    { name: "grad_year", label: "Graduation year", type: "number", defaultValue: record.grad_year?.toString() ?? "" },
                    { name: "phone", label: "Phone", type: "tel", defaultValue: record.phone ?? "" },
                  ]}
                />
                {managed ? (
                  <ConfirmTyped
                    action={deleteStudent}
                    hidden={{ student: id }}
                    trigger="Delete the record"
                    submit="Delete record"
                    expected={CONFIRM_DELETE_RECORD}
                    description="For a child a family added by mistake. Removes the record from its household and cancels its hand-over invitations; the purge removes it for good after 30 days."
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">This record belongs to an account. Use that person&apos;s page to delete or restore the account.</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function ListBlock({ list, studentId, names }: { list: AdminList; studentId: string; names: Map<string, string> }) {
  return (
    <section aria-label={list.name}>
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-bold">
        {list.name}
        <span className="text-sm font-normal text-muted-foreground">
          {list.items.length} {list.items.length === 1 ? "college" : "colleges"}
          {list.share_enabled ? " · shared by link" : ""}
        </span>
      </h3>
      {list.items.length === 0 ? (
        <Empty>Empty.</Empty>
      ) : (
        <ul className="mt-2 divide-y rounded-xl border">
          {list.items.map((i) => (
            <ItemRow key={i.id} item={i} name={names.get(i.unit_id) ?? `College ${i.unit_id}`} studentId={studentId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemRow({ item, name, studentId }: { item: AdminListItem; name: string; studentId: string }) {
  const facts = [item.category, item.round, item.status, item.outcome, item.applied_on ? `applied ${fmtDate(item.applied_on)}` : null, item.deadline_text ?? (item.deadline_date ? `due ${fmtDate(item.deadline_date)}` : null)].filter(Boolean);
  return (
    <li className="space-y-1.5 p-3">
      <p className="text-sm font-semibold">
        <Link href={`/admin/colleges/${item.unit_id}`} className="underline-offset-4 hover:underline">
          {name}
        </Link>
      </p>
      {facts.length > 0 && <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>}
      {item.notes.length > 0 && (
        <ul className="space-y-1 text-sm">
          {item.notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-muted/60 px-2.5 py-1.5">
              <span className="break-words">{n.body}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {n.author_name ?? "Someone"}, {fmtDate(n.created)}
                {n.private ? " · private note" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Unit U7 fills this: the standing panel (collapsed), server-rendered inside this page's requireAdmin(). */}
      <StandingPanelSlot studentId={studentId} unitId={item.unit_id} itemId={item.id} />
    </li>
  );
}

function monthKey(date: unknown): string {
  return typeof date === "string" && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "No date";
}

function monthLabel(key: string): string {
  if (key === "No date") return key;
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function PlanBlock({ plan }: { plan: AdminStudent["plan"] }) {
  if (plan.tasks.length + plan.visits.length + plan.offers.length + plan.letters.length === 0) return <Empty>Nothing planned yet.</Empty>;
  const byMonth = new Map<string, Record<string, unknown>[]>();
  for (const t of plan.tasks) byMonth.set(monthKey(t.due_on), [...(byMonth.get(monthKey(t.due_on)) ?? []), t]);
  return (
    <div className="space-y-5 text-sm">
      {byMonth.size > 0 && (
        <div>
          <h3 className="font-semibold">Tasks by month</h3>
          <div className="mt-2 space-y-3">
            {[...byMonth.entries()].map(([key, tasks]) => (
              <div key={key}>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{monthLabel(key)}</p>
                <ul className="mt-1 divide-y">
                  {tasks.map((t, i) => (
                    <li key={String(t.id ?? i)} className="flex flex-wrap justify-between gap-x-4 py-1">
                      <span className="break-words">{String(t.title ?? "Task")}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.due_on ? fmtDate(String(t.due_on)) : ""}
                        {t.assignee ? ` · ${String(t.assignee)}` : ""}
                        {t.done_at || t.completed_at ? " · done" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {plan.visits.length > 0 && (
        <div>
          <h3 className="font-semibold">Visits</h3>
          <ul className="mt-1 divide-y">
            {plan.visits.map((v, i) => (
              <li key={String(v.id ?? i)} className="flex flex-wrap justify-between gap-x-4 py-1">
                <span>{String(v.kind ?? "visit").replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">
                  {v.on_date ? fmtDate(String(v.on_date)) : ""}
                  {v.registered ? " · registered" : ""}
                  {v.rating ? ` · rated ${String(v.rating)}/5` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.offers.length > 0 && (
        <div>
          <h3 className="font-semibold">Offers</h3>
          <div className="mt-1 space-y-2">
            {plan.offers.map((o, i) => (
              <details key={String(o.id ?? i)} className="rounded-xl border p-3">
                <summary className="cursor-pointer font-medium">Award year {String(o.award_year ?? "")}</summary>
                <div className="mt-2">
                  <KeyValues data={o} />
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
      {plan.letters.length > 0 && (
        <div>
          <h3 className="font-semibold">Letters</h3>
          <p className="text-xs text-muted-foreground">Metadata only: the files stay in the family&apos;s storage.</p>
          <ul className="mt-1 divide-y">
            {plan.letters.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-x-4 py-1">
                <span>{l.kind.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">
                  Uploaded {fmtDate(l.created_at)}
                  {l.confirmed_at ? " · confirmed" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
