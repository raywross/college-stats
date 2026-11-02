import Link from "next/link";
import { ArrowLeft, Check, Circle } from "lucide-react";
import { ViewerBanner } from "@/components/account/ViewerBanner";
import { HouseholdActionButton } from "@/components/account/HouseholdActionButton";
import { CustomAskForm, NoteForm } from "@/components/org/StudentForms";
import { Term } from "@/components/ui/info-tip";
import { askStudent, deleteOrgNote } from "@/app/org/actions";
import { ORG_ASKS_PER_WEEK, type OrgAsk, type OrgNote } from "@/lib/org-rules";
import {
  RECORD_SECTION_LABEL,
  askLabel,
  askStatusLine,
  asksThisWeek,
  nextMoves,
  openAskFor,
  shortDay,
  type CaseloadRow,
  type CaseloadStudent,
} from "@/lib/org-caseload";
import { PROFILE_SECTIONS } from "@/lib/planner/profile-progress";
import { planHref, planPrintHref } from "@/lib/planner/plan-tabs";
import { recordPageHref } from "@/lib/planner/record";
import { cn } from "@/lib/utils";

const panel = "min-w-0 space-y-3 rounded-3xl border bg-card p-4 sm:p-5";
const linkBtn = "inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The counselor's view of one student (specs/product/counselor-portal.md "A student"): the banner, the summary line,
 * the signals, then four panels side by side on desktop and stacked on phones: Record (each section filled or
 * missing, Ask on a missing one, Open record), Advisor (the list's shape, the next three steps, Open advisor, Print,
 * Essays), Notes (the office's, newest first), and Asks (what was asked and whether it's done). Server-rendered from
 * what the page read; the forms are small client islands.
 */
export function StudentView({
  orgId,
  row,
  student,
  schools,
  notes,
  asks,
  viewerId,
  today,
  now = new Date(),
}: {
  orgId: string;
  row: CaseloadRow;
  student: CaseloadStudent;
  schools: Record<string, { name: string }>;
  notes: OrgNote[];
  asks: OrgAsk[];
  viewerId: string;
  today: string;
  now?: Date;
}) {
  const first = firstName(row.name);
  const atLimit = asksThisWeek(asks, now) >= ORG_ASKS_PER_WEEK;
  const moves = nextMoves(student, schools, today);
  const missing = new Set(row.record.missing);
  const askButton = (kind: "record_section" | "list", section: string | null, label: string) => {
    const open = openAskFor(asks, kind, section);
    if (open) return <span className="text-xs font-medium text-muted-foreground">Asked {shortDay(open.created, today, true)}</span>;
    if (atLimit) return null;
    return (
      <HouseholdActionButton
        action={askStudent}
        fields={{ org: orgId, student: row.studentId, kind, ...(section ? { section } : {}) }}
        label={label}
        pendingLabel="Asking…"
      />
    );
  };

  return (
    <div className="space-y-5">
      <Link href="/org" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" aria-hidden />
        Caseload
      </Link>
      <ViewerBanner relation="counselor" studentName={first} canEdit={row.canEdit} />
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight break-words sm:text-3xl">{row.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[row.classOf, `Advisor: ${row.advisorLabel}`, row.hasAccount ? null : "No account yet"].filter(Boolean).join(" · ")}
        </p>
        <p className="text-sm font-medium">{row.summary}</p>
        {row.signals.length > 0 && (
          <ul className="space-y-1" aria-label="Signals">
            {row.signals.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-sm">
                <Circle className="mt-1.5 size-2 shrink-0 fill-current text-coral" aria-hidden />
                <span>{s.link ? <a href={s.link} className="underline decoration-dotted underline-offset-2">{s.text}</a> : s.text}</span>
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={panel} aria-labelledby="record-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="record-heading" className="font-display text-lg font-bold">
              Record
            </h2>
            <span className="text-sm text-muted-foreground">{row.record.line} filled</span>
          </div>
          <ul className="divide-y">
            {PROFILE_SECTIONS.map((sec) => (
              <li key={sec} className="flex min-h-11 items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex items-center gap-2">
                  {missing.has(sec) ? <Circle className="size-4 text-muted-foreground" aria-hidden /> : <Check className="size-4 text-primary" aria-hidden />}
                  <span className={cn(missing.has(sec) && "text-muted-foreground")}>{RECORD_SECTION_LABEL[sec]}</span>
                  <span className="sr-only">{missing.has(sec) ? "missing" : "filled"}</span>
                </span>
                {missing.has(sec) && askButton("record_section", sec, `Ask ${first}`)}
              </li>
            ))}
          </ul>
          {atLimit && <p className="text-xs text-muted-foreground">You&apos;ve asked {ORG_ASKS_PER_WEEK} times this week. Asks open up again in a few days.</p>}
          <Link href={recordPageHref(row.studentId)} className={linkBtn}>
            Open record
          </Link>
        </section>

        <section className={panel} aria-labelledby="advisor-heading">
          <h2 id="advisor-heading" className="font-display text-lg font-bold">
            Advisor
          </h2>
          <div>
            <p className="text-sm font-semibold">{row.list.line}</p>
            {row.list.detail && <p className="text-sm text-muted-foreground">{row.list.detail}</p>}
            {row.list.count === 0 && <div className="mt-2">{askButton("list", null, `Ask ${first} to add colleges`)}</div>}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground">Next steps</h3>
            {moves.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing open right now.</p>
            ) : (
              <ol className="mt-1 space-y-1 text-sm">
                {moves.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words">{m.title}</span>
                    {m.when && <span className={cn("shrink-0 text-muted-foreground tabular-nums", m.overdue && "font-semibold text-foreground")}>{m.when}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={planHref({ person: row.studentId })} className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
              Open advisor
            </Link>
            <Link href={planPrintHref({ person: row.studentId })} className={linkBtn}>
              Print
            </Link>
            <Link href={planHref({ person: row.studentId, tab: "essays" })} className={linkBtn}>
              Essays{student.essays.length > 0 ? ` (${student.essays.length})` : ""}
            </Link>
          </div>
        </section>

        <section className={panel} aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="font-display text-lg font-bold">
            Notes
          </h2>
          <p className="text-xs text-muted-foreground">Your office&apos;s notes. {first} and their family never see them.</p>
          <NoteForm orgId={orgId} studentId={row.studentId} />
          {notes.length > 0 && (
            <ul className="divide-y">
              {notes.map((n) => (
                <li key={n.id} className="space-y-1 py-2.5">
                  <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {n.author_name ?? "A former member"} · {shortDay(n.created, today)}
                    </p>
                    {n.author_id === viewerId && (
                      <HouseholdActionButton action={deleteOrgNote} fields={{ note: n.id }} label="Delete" pendingLabel="Deleting…" confirm="Delete this note?" tone="danger" className="[&_button]:h-8 [&_button]:px-3 [&_button]:text-xs" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={panel} aria-labelledby="asks-heading">
          <h2 id="asks-heading" className="font-display text-lg font-bold">
            <Term term="ask">Asks</Term>
          </h2>
          {!atLimit && <CustomAskForm orgId={orgId} studentId={row.studentId} firstName={first} />}
          {asks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing asked yet.</p>
          ) : (
            <ul className="divide-y">
              {asks.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 break-words">{askLabel(a)}</span>
                  <span className={cn("shrink-0 text-xs", a.done_at ? "text-primary" : "text-muted-foreground")}>{askStatusLine(a, today)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
