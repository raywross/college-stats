import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDate } from "@/lib/admin/console";
import { ESSAY_STATUSES, ESSAY_STATUS_LABELS, essayStatus, handReadChecklist, handReadDone, listsByUnit, overridesForCycle, statusCounts } from "@/lib/admin/essays";
import { formLabel } from "@/lib/admin/essays-form";
import { currentCycle } from "@/lib/planner/cycle";
import { getData } from "@/lib/data";

export const metadata: Metadata = { title: "Essays", robots: { index: false, follow: false } };

const linkButton =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90";

/**
 * /admin/essays (specs/product/essays/sources.md "The hand read", "The admin side"): how every college's essay
 * questions stand (published on its own page, confirmed from the form, pointing to the form, none, not read), the
 * hand-read checklist (colleges on a family's list whose questions only the application shows, with no saved read),
 * the colleges already read by hand, and a search for any college. Each row links to its form,
 * /admin/essays/[unit]. A save is a row of `essay_prompt_overrides`, so it counts here at once. Phone-first.
 */
export default async function EssaysPage({ searchParams }: PageProps<"/admin/essays">) {
  await connection();
  await requireAdmin();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const { getAllSchools, getSchoolById, searchSchools } = await getData();
  if (/^\d{6,8}$/.test(q) && getSchoolById(q)) redirect(`/admin/essays/${q}`);

  const cycle = currentCycle(new Date().toISOString().slice(0, 10));
  const schools = getAllSchools();
  const [lists, overrides] = await Promise.all([listsByUnit(), overridesForCycle(cycle)]);
  const counts = statusCounts(schools, overrides);
  const checklist = lists ? handReadChecklist(schools, lists, overrides) : null;
  const done = handReadDone(schools, lists, overrides);
  const results = q ? searchSchools(q, 25) : [];

  return (
    <>
      <PageHeader
        title="Essays"
        subtitle={<>Prompts read from the form: enter a college&apos;s questions from its application, live on the advisor as soon as they&apos;re saved. Cycle {cycle}.</>}
      />
      <div className="space-y-5">
        <Panel title="Every college" id="counts">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Colleges by essay status">
            {ESSAY_STATUSES.map((s) => (
              <li key={s} className="rounded-xl border bg-background p-3" data-status={s}>
                <span className="block font-display text-2xl font-extrabold tabular-nums">{counts[s].toLocaleString("en-US")}</span>
                <span className="block text-xs text-muted-foreground">{ESSAY_STATUS_LABELS[s]}</span>
              </li>
            ))}
          </ul>
          {!overrides && <p className="mt-2 text-xs text-muted-foreground">Saved hand reads couldn&apos;t be read here, so these counts are the dataset&apos;s alone.</p>}
        </Panel>

        <Panel title="To read by hand" id="checklist" aside={checklist ? <span className="text-sm text-muted-foreground">{checklist.length} on families&apos; lists</span> : undefined}>
          {!checklist ? (
            <Empty>Families&apos; lists can&apos;t be read on this deployment, so the checklist isn&apos;t available. Search for a college below instead.</Empty>
          ) : checklist.length === 0 ? (
            <Empty>Every college on a family&apos;s list has its questions. Nothing to read.</Empty>
          ) : (
            <ul className="divide-y rounded-2xl border bg-background" aria-label="Colleges to read by hand">
              {checklist.map((row) => (
                <li key={row.unitId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3" data-unit={row.unitId}>
                  <span className="min-w-0">
                    <span className="block font-semibold break-words">{row.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ESSAY_STATUS_LABELS[row.status]} · on {row.lists} {row.lists === 1 ? "list" : "lists"}
                    </span>
                  </span>
                  <Link href={`/admin/essays/${row.unitId}`} className={linkButton}>
                    Enter the questions
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Find a college" id="search">
          <AdminSearch action="/admin/essays" id="essays-search" defaultValue={q} label="Search colleges" placeholder="College name or unit id" />
          {q && (
            <div className="mt-3">
              {results.length === 0 ? (
                <Empty>No college matches &ldquo;{q}&rdquo;.</Empty>
              ) : (
                <ul className="divide-y rounded-2xl border bg-background" aria-label="Search results">
                  {results.map((c) => {
                    const school = getSchoolById(c.id);
                    return (
                      <li key={c.id}>
                        <Link href={`/admin/essays/${c.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 hover:bg-muted/50">
                          <span className="font-semibold break-words">{c.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {school ? ESSAY_STATUS_LABELS[essayStatus(school, overrides)] : ""} · {c.city}, {c.state}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Read by hand" id="done">
          {done.length === 0 ? (
            <Empty>No college has been read by hand yet.</Empty>
          ) : (
            <ul className="divide-y rounded-2xl border bg-background" aria-label="Colleges read by hand">
              {done.map((row) => (
                <li key={row.unitId}>
                  <Link href={`/admin/essays/${row.unitId}`} className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 hover:bg-muted/50">
                    <span className="font-semibold break-words">{row.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.form ? formLabel(row.form) : "Form"} · read {fmtDate(row.readOn)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
