"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, Search, UserPlus, Users } from "lucide-react";
import { HouseholdActionButton } from "@/components/account/HouseholdActionButton";
import { JoinCode } from "@/components/org/JoinCode";
import { cancelOrgInvitation, resendStudentInvitation } from "@/app/org/actions";
import { track } from "@/lib/analytics";
import { orgStudentHref } from "@/lib/org-rules";
import { SIGNAL_CHIP, caseloadSizeBucket, filterCaseload, type CaseloadCounts, type CaseloadRow, type InvitedStudent } from "@/lib/org-caseload";
import { cn } from "@/lib/utils";

const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
const control = "h-10 min-w-0 rounded-full border border-input bg-background px-3.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const actionBtn = "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold";

/**
 * The caseload (specs/product/counselor-portal.md "The caseload"): the office's counts, the filters (class year,
 * "needs something", a name search), Add students and Export CSV, one row per student in the caseload's order (rows
 * come sorted from lib/org-caseload.ts caseloadRows), then invited students by name. On a phone a row is the name,
 * the class, the next deadline, and one chip; the student's page has the rest. Filtering is in the browser over
 * rows the server computed: nothing is read again.
 */
export function CaseloadView({
  rows,
  counts,
  invited,
  joinCode,
  joinLink,
}: {
  rows: CaseloadRow[];
  counts: CaseloadCounts;
  invited: InvitedStudent[];
  joinCode: string;
  joinLink: string;
}) {
  const [classOf, setClassOf] = useState<number | null>(null);
  const [needs, setNeeds] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => filterCaseload(rows, { classOf, needs, q }), [rows, classOf, needs, q]);
  const years = useMemo(() => [...new Set(rows.map((r) => r.gradYear).filter((y): y is number => y !== null))].sort(), [rows]);

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || rows.length === 0) return;
    tracked.current = true;
    track("org_caseload_viewed", { size: caseloadSizeBucket(rows.length) });
  }, [rows.length]);

  if (rows.length === 0 && invited.length === 0) return <EmptyCaseload joinCode={joinCode} joinLink={joinLink} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm font-semibold" role="status">
          {counts.line}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/org/students/new" className={cn(actionBtn, "bg-primary text-primary-foreground")}>
            <UserPlus className="size-4" aria-hidden />
            Add students
          </Link>
          <a href="/org/export" download className={cn(actionBtn, "border hover:bg-muted")}>
            <Download className="size-4" aria-hidden />
            Export CSV
          </a>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Search by name</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className={cn(control, "w-full pl-9")} />
          </label>
          {years.length > 1 && (
            <label>
              <span className="sr-only">Class year</span>
              <select value={classOf ?? ""} onChange={(e) => setClassOf(e.target.value ? Number(e.target.value) : null)} className={control}>
                <option value="">Every class</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    Class of {y}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            aria-pressed={needs}
            onClick={() => setNeeds(!needs)}
            className={cn("inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors", needs ? "bg-foreground text-background" : "border hover:bg-muted")}
          >
            Needs something
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y rounded-2xl border bg-card">
          {shown.map((r) => (
            <CaseloadRowItem key={r.studentId} row={r} />
          ))}
          {shown.length === 0 && <li className="p-4 text-sm text-muted-foreground">No student matches. Clear a filter to see more.</li>}
        </ul>
      )}

      {invited.length > 0 && (
        <section aria-labelledby="invited-heading" className="space-y-2">
          <h2 id="invited-heading" className="text-sm font-semibold text-muted-foreground">
            Invited
          </h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {invited.map((inv) => (
              <InvitedRow key={inv.invitationId} inv={inv} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One student: everything on desktop, the name, class, next deadline, and one chip on a phone. */
export function CaseloadRowItem({ row }: { row: CaseloadRow }) {
  const first = row.signals[0] ?? null;
  const missing = row.record.missingLabels.length > 0 ? `Missing: ${row.record.missingLabels.join(", ")}` : "Every section is in";
  return (
    <li>
      <Link href={orgStudentHref(row.studentId)} className="block p-3.5 hover:bg-muted/50 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold break-words">{row.name}</span>
              <span className={cn(chip, "bg-muted text-muted-foreground")} title="Advisor status">
                {row.advisorLabel}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {row.classOf ?? "Class not set"}
              {row.nextDeadline && <span className="sm:hidden"> · {row.nextDeadline.label}</span>}
            </p>
          </div>
          {first && (
            <span className={cn(chip, "border sm:hidden")} title={first.text}>
              {SIGNAL_CHIP[first.id]}
            </span>
          )}
        </div>
        <dl className="mt-3 hidden grid-cols-3 gap-x-4 gap-y-2 text-sm sm:grid lg:grid-cols-5">
          <Fact label="Record" title={missing}>
            {row.record.line}
          </Fact>
          <Fact label="List" title={row.list.detail ?? undefined}>
            {row.list.line}
          </Fact>
          <Fact label="Applications">{row.applications ?? "Not yet"}</Fact>
          <Fact label="Next deadline">
            <span className={cn(row.nextDeadline?.overdue && "font-semibold")}>{row.nextDeadline?.label ?? "None dated"}</span>
          </Fact>
          <Fact label="Last activity">{row.lastActivity.label}</Fact>
        </dl>
        {row.signals.length > 0 && (
          <ul className="mt-2 hidden flex-wrap gap-1.5 sm:flex" aria-label="Signals">
            {row.signals.map((s) => (
              <li key={s.id} className={cn(chip, "border")} title={s.text}>
                {SIGNAL_CHIP[s.id]}
              </li>
            ))}
          </ul>
        )}
      </Link>
    </li>
  );
}

function Fact({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{children}</dd>
    </div>
  );
}

function InvitedRow({ inv }: { inv: InvitedStudent }) {
  return (
    <li className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="min-w-0">
        <p className="font-semibold break-words">{inv.name}</p>
        <p className="text-xs break-words text-muted-foreground">
          {inv.email ? `${inv.email} · ` : ""}
          {inv.line}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {inv.link && <CopyLink link={inv.link} />}
        <HouseholdActionButton action={resendStudentInvitation} fields={{ invitation: inv.invitationId }} label="Send again" pendingLabel="Sending…" />
        <HouseholdActionButton action={cancelOrgInvitation} fields={{ invitation: inv.invitationId }} label="Cancel" pendingLabel="Cancelling…" confirm={`Cancel ${inv.name}'s invitation? The link stops working.`} tone="danger" />
      </div>
    </li>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-semibold hover:bg-muted"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/** No students yet: the join code to share, and Add students. */
export function EmptyCaseload({ joinCode, joinLink }: { joinCode: string; joinLink: string }) {
  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-8">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <Users className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-xl font-bold sm:text-2xl">
        Bring in your <span className="highlight">first students</span>
      </h2>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">Share your code in class or a message, or invite students by email.</p>
      <JoinCode code={joinCode} link={joinLink} className="mt-5 max-w-xl" />
      <Link href="/org/students/new" className={cn(actionBtn, "mt-5 bg-primary text-primary-foreground")}>
        <UserPlus className="size-4" aria-hidden />
        Add students
      </Link>
    </section>
  );
}
