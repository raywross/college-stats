import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PrintButton } from "@/components/planner/PrintButton";
import { authConfigured, currentStudent, requireUser } from "@/lib/auth";
import { ROUND_LABELS, type ListRound } from "@/lib/list-rules";
import type { AnyCited } from "@/lib/lineage";
import { dayLabel, schoolYearOf, type CalendarCite, type CalendarEvent } from "@/lib/planner/calendar";
import { KID_VARS, MONEY_VAR, ROUND_VAR, STRIPED, TEST_VAR } from "@/lib/planner/colors";
import { todayIso } from "@/lib/planner/context";
import { loadPlanFor, myPlanChildren, type PlanLoad } from "@/lib/planner/load";
import { planHref } from "@/lib/planner/plan-tabs";
import { printSections, yearEvents, type PrintLayout } from "@/lib/planner/print";
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

export const metadata: Metadata = { title: "Print the plan", robots: { index: false } };

interface PrintChild {
  studentId: string;
  name: string;
  colorSlot: 0 | 1 | 2;
  ctx: PlanContext;
  view: PlanView;
}

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

function longDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Common Data Set 2025–26" for a college date, the site's host for a cycle-file date. */
function sourceText(cite: CalendarCite, ctx: PlanContext | undefined): string | null {
  if (!cite) return null;
  if (cite.kind === "link") {
    try {
      return new URL(cite.url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  const c = ctx?.schools[cite.unitId]?.cites[cite.field] as AnyCited | undefined;
  if (!c) return null;
  return `${c.label}${c.year ? ` ${c.year}` : ""}`;
}

/**
 * /plan/print (specs/planner/redesign/calendar.md "Feed, print, share"): the Coming-up list for the whole school year,
 * grouped by month, for one child (`?for=`) or everyone, all together or a page per child (`?each=1`). Round colors
 * with shapes (◆ due, ○ decision, ▲ test, $ money) and the round named in each line, so it reads in grayscale too.
 * Signed in only; a student prints their own, a guardian the children the household grants them (loadPlanFor reads
 * with the viewer's session and logs a guardian's read for the student, as /plan does). The browser's print dialog
 * saves it as a PDF. `plan_calendar_printed` fires from the calendar's Print link (FamilyCalendar).
 */
export default async function PlanPrintPage({ searchParams }: { searchParams: Promise<{ for?: string; each?: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { for: forParam, each } = await searchParams;
  const forId = typeof forParam === "string" && forParam ? forParam : null;
  await requireUser(forId ? `/plan/print?for=${encodeURIComponent(forId)}` : "/plan/print");

  const today = todayIso();
  const range = schoolYearOf(today);
  const yearLabel = `${range.startYear}–${String((range.startYear + 1) % 100).padStart(2, "0")}`;

  const self = await currentStudent();
  let candidates: { studentId: string; name: string | null; colorSlot: 0 | 1 | 2 }[];
  if (self) candidates = [{ studentId: self.id, name: self.display_name, colorSlot: 0 }];
  else candidates = (await myPlanChildren()).map((c) => ({ studentId: c.studentId, name: c.name, colorSlot: c.colorSlot }));

  const back = (
    <Link href={planHref({ person: self ? null : forId, tab: "calendar" })} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground print:hidden">
      <ArrowLeft className="size-4" aria-hidden /> Back to the calendar
    </Link>
  );
  const message = (text: string) => (
    <div className="space-y-3">
      {back}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );

  if (forId && !candidates.some((c) => c.studentId === forId)) return message("That plan isn't one you can see.");
  const chosen = forId ? candidates.filter((c) => c.studentId === forId) : candidates;
  if (chosen.length === 0) return message("No student yet, so there's nothing to print.");

  const loads: PlanLoad[] = await Promise.all(chosen.map((c) => loadPlanFor(c.studentId)));
  const children: PrintChild[] = chosen.flatMap((c, i) => {
    const load = loads[i];
    if (load.kind !== "ready") return [];
    return [{ studentId: c.studentId, name: firstName(c.name) ?? "Student", colorSlot: c.colorSlot, ctx: load.ctx, view: load.view }];
  });
  if (children.length === 0) return message("No plan yet, so there's nothing to print.");

  const layout: PrintLayout = forId || self ? { kind: "one", studentId: children[0].studentId } : each === "1" ? { kind: "each" } : { kind: "together" };
  const events = yearEvents(children, range);
  const sections = printSections(children, events, range, layout);
  const byId = new Map(children.map((c) => [c.studentId, c]));
  const naming = layout.kind === "together" && children.length > 1;
  const title = (child: PrintChild | null) => (self ? "Your calendar" : child ? `${child.name}'s calendar` : "The family calendar");

  return (
    <div className="space-y-4">
      {/* Print only the calendar, not the site around it; keep the round colors and print dark text on white. */}
      <style>{`@media print {
  body * { visibility: hidden !important; }
  #plan-print, #plan-print * { visibility: visible !important; }
  #plan-print { position: absolute; inset: 0 auto auto 0; width: 100%; color: #000; background: #fff; }
  #plan-print svg { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          {!self && !forId && children.length > 1 && (
            <div className="inline-flex rounded-full border bg-card p-0.5 text-xs font-semibold" role="group" aria-label="Layout">
              <Link href="/plan/print" aria-current={layout.kind === "together" ? "page" : undefined} className={`rounded-full px-3 py-2 ${layout.kind === "together" ? "bg-muted" : "text-muted-foreground hover:text-foreground"}`}>
                All together
              </Link>
              <Link href="/plan/print?each=1" aria-current={layout.kind === "each" ? "page" : undefined} className={`rounded-full px-3 py-2 ${layout.kind === "each" ? "bg-muted" : "text-muted-foreground hover:text-foreground"}`}>
                A page per child
              </Link>
            </div>
          )}
          <PrintButton />
        </div>
      </div>

      <article id="plan-print" className="space-y-6 rounded-3xl border bg-card p-4 text-sm sm:p-6 print:space-y-4 print:rounded-none print:border-0 print:p-0">
        {sections.map(({ child, months }, i) => (
          <section key={child?.studentId ?? "all"} className={`space-y-4 ${i < sections.length - 1 ? "print:break-after-page" : ""}`}>
            <header>
              <h1 className="font-display text-2xl font-bold">{title(child)}</h1>
              <p className="text-muted-foreground print:text-black">
                {yearLabel} school year · printed {longDay(today)}
              </p>
            </header>
            <Legend />
            {months.length === 0 ? (
              <p className="text-muted-foreground">Nothing dated in the {yearLabel} school year yet.</p>
            ) : (
              months.map((m) => (
                <div key={m.key} className="break-inside-avoid">
                  <h2 className="border-b pb-1 font-display text-base font-bold">{m.label}</h2>
                  <ul className="divide-y">
                    {m.events.map((e, j) => {
                      const who = byId.get(e.studentId);
                      const source = sourceText(e.cite, who?.ctx);
                      const past = e.date < today;
                      return (
                        <li key={`${e.studentId}-${e.date}-${j}`} className={`flex items-start gap-2 py-1.5 ${past ? "text-muted-foreground print:text-neutral-500" : ""}`}>
                          <span className="w-14 shrink-0 font-semibold tabular-nums">{dayLabel(e.date)}</span>
                          <span className="mt-0.5 shrink-0">
                            <Shape event={e} />
                          </span>
                          <span className="min-w-0 flex-1">
                            {naming && who && (
                              <span className="mr-1.5 inline-flex items-center gap-1 font-bold">
                                <span className="inline-block size-2 rounded-full print:hidden" style={{ background: KID_VARS[who.colorSlot] }} aria-hidden />
                                {who.name}:
                              </span>
                            )}
                            {e.text}
                            {past && <span className="ml-1 text-xs">(past)</span>}
                            {source && <span className="block text-xs text-muted-foreground print:text-neutral-600">Source: {source}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </section>
        ))}
        <footer className="border-t pt-3 text-xs text-muted-foreground print:text-neutral-700">
          College dates come from each college&apos;s Common Data Set (the edition is on each line); test and aid dates from
          the publishers&apos; calendars. Check the college&apos;s own site before a deadline.
        </footer>
      </article>
    </div>
  );
}

/** The mark's shape in its color, as SVG so it prints whatever the browser's background setting: a filled diamond for
 *  a deadline (a white stripe for ED II and REA), a ring for a decision, a triangle for a test, a coin for money. */
function Shape({ event }: { event: CalendarEvent }) {
  const label = event.shape === "bar" ? "Deadline" : event.shape === "decision" ? "Decision" : event.shape === "test" ? "Test date" : "Money";
  if (event.shape === "test") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={label}>
        <path d="M7 1 L13 13 L1 13 Z" style={{ fill: TEST_VAR }} />
      </svg>
    );
  }
  if (event.shape === "money") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={label}>
        <circle cx="7" cy="7" r="6.5" style={{ fill: MONEY_VAR }} />
        <text x="7" y="10.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
          $
        </text>
      </svg>
    );
  }
  const round = (event.round ?? "rd") as ListRound;
  const color = ROUND_VAR[round];
  if (event.shape === "decision") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={`${label}, ${ROUND_LABELS[round]}`}>
        <circle cx="7" cy="7" r="5" style={{ fill: "none", stroke: color, strokeWidth: 2.5 }} />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={`${label}, ${ROUND_LABELS[round]}`}>
      <path d="M7 0.5 L13.5 7 L7 13.5 L0.5 7 Z" style={{ fill: color }} />
      {STRIPED.has(round) && <path d="M3.5 10.5 L10.5 3.5" style={{ stroke: "#fff", strokeWidth: 2 }} />}
    </svg>
  );
}

function Legend() {
  const rounds: ListRound[] = ["ed", "ed2", "ea", "rea", "rd", "rolling"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground print:text-neutral-700">
      <span className="inline-flex items-center gap-1">
        <Shape event={{ date: "", studentId: "", shape: "bar", round: "rd", text: "", cite: null, daysAway: 0 }} /> due
      </span>
      <span className="inline-flex items-center gap-1">
        <Shape event={{ date: "", studentId: "", shape: "decision", round: "rd", text: "", cite: null, daysAway: 0 }} /> decision expected
      </span>
      <span className="inline-flex items-center gap-1">
        <Shape event={{ date: "", studentId: "", shape: "test", text: "", cite: null, daysAway: 0 }} /> test date
      </span>
      <span className="inline-flex items-center gap-1">
        <Shape event={{ date: "", studentId: "", shape: "money", text: "", cite: null, daysAway: 0 }} /> money
      </span>
      <span className="inline-flex flex-wrap items-center gap-x-2">
        {rounds.map((r) => (
          <span key={r} className="inline-flex items-center gap-1">
            <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden>
              <rect width="16" height="8" rx="4" style={{ fill: ROUND_VAR[r] }} />
            </svg>
            {ROUND_LABELS[r]}
          </span>
        ))}
      </span>
    </div>
  );
}
