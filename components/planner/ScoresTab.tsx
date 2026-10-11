"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarClock, PartyPopper, TrendingUp } from "lucide-react";
import type { PlanTabProps } from "@/components/planner/tabs/types";
import CoursesSection from "@/components/planner/CoursesSection";
import ScoreRow from "@/components/planner/ScoreRow";
import { CATEGORY_LABELS } from "@/lib/list-rules";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { datesFor, dayLabel, daysBetween, inTimeRow, inTimeText, registerByText, type InTimeRow } from "@/lib/planner/scores";
import { setPlannedDate } from "@/lib/planner/store-plan";
import type { PlanRowView } from "@/lib/planner/plan-view";
import { TEST_LABEL, type TestKind } from "@/lib/planner/standing";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { CycleEntry } from "@/lib/planner/cycle";

/**
 * The Scores tab (specs/planner/redesign/scores.md): where the student's one test stands at each college on the
 * list, whether to send it, and, only when a realistic retake would move a college up a group, the suggestion and
 * the test dates whose scores would arrive in time. Encouraging first; dates on request. Third person for a
 * guardian viewer ("Maya is taking the SAT"); never a probability or an admit rate.
 */
export default function ScoresTab({ ctx, view }: PlanTabProps) {
  const test = view.student.test;
  const retake = view.retake;
  const isGuardian = ctx.viewer.isGuardian;
  const studentFirstName = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const name = studentFirstName ?? "The student";
  const practice = ctx.profile?.tests.practice === true;
  const focus = ctx.profile?.tests.focus ?? null;
  const planned = ctx.profile?.tests.plannedDates ?? [];
  const studentId = ctx.student?.id ?? null;
  const canEdit = ctx.viewer.canEdit;

  useEffect(() => {
    track("plan_scores_opened", { suggestion: retake !== null });
    // Fires once per mount of the tab, not on every retake recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!test) {
    return (
      <div className="space-y-4">
        <section className="rounded-3xl border bg-card p-5 text-sm">
          <h2 className="font-display text-xl font-bold">{focus === "none" ? "Not testing" : "No score yet"}</h2>
          <p className="mt-1 text-muted-foreground">
            {focus === "none"
              ? `The groups use ${isGuardian ? `${name}'s` : "your"} GPA alone.`
              : `Add ${isGuardian ? `${name}'s` : "your"} SAT or ACT score in the numbers form to see where it stands.`}
          </p>
        </section>
        <CoursesSection ctx={ctx} view={view} />
      </div>
    );
  }

  const label = TEST_LABEL[test.kind];
  const read = view.rows.filter((r) => r.standing?.test);
  const inOrAbove = read.filter((r) => r.standing!.test!.position !== "below").length;
  const everywhere = read.length > 0 && inOrAbove === read.length;
  const dates = datesFor(test.kind, ctx.cycle, ctx.grade, ctx.today, view.rows);
  const moveRows = retake
    ? retake.moves.map((m) => view.rows.find((r) => r.item.id === m.id)).filter((r): r is PlanRowView => r !== undefined)
    : [];
  const inTimeRows = moveRows.map(inTimeRow);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border bg-card p-5">
        <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          {isGuardian ? `${name} is taking the ${label}` : `You're taking the ${label}`}
        </p>
        <p className="mt-1 font-display text-4xl font-bold tabular-nums">
          {test.score}
          {practice && <span className="ml-2 text-sm font-semibold text-muted-foreground">· practice</span>}
        </p>
        {read.length > 0 && (
          <p className="mt-2 flex items-start gap-2 text-sm">
            <PartyPopper className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              In or above the middle 50% at <span className="font-semibold">{inOrAbove} of {read.length}</span> colleges on the list.
              {everywhere ? ` ${isGuardian ? `${name}'s score` : "Your score"} already works everywhere; time is better spent on essays.` : ""}
            </span>
          </p>
        )}
      </section>

      {retake ? (
        <section className="rounded-3xl bg-pop p-5 text-pop-foreground">
          <p className="flex items-center gap-2 text-xs font-bold tracking-wide uppercase">
            <TrendingUp className="size-4" aria-hidden /> Worth one more test
          </p>
          <p className="mt-1 font-display text-2xl leading-tight font-bold">
            A {retake.target} ({retake.delta > 0 ? `+${retake.delta}` : retake.delta}) would move{" "}
            {retake.moves.length === 1 ? "one college" : `${retake.moves.length} colleges`} up a group
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {retake.moves.map((m) => {
              const r = view.rows.find((row) => row.item.id === m.id);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r?.school?.name ?? "A college"}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", GROUP_CLASS[m.from])}>{CATEGORY_LABELS[m.from]}</span>→
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", GROUP_CLASS[m.to])}>{CATEGORY_LABELS[m.to]}</span>
                  <span className="opacity-80">with {test.score + m.needed}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm opacity-90">
            Students who retake gain {test.kind === "sat" ? "about 40 to 60 points" : "a point or two"} on average, more with practice, and most colleges take the best score.
          </p>
          <TestDates dates={dates} today={ctx.today} kind={test.kind} rows={inTimeRows} planned={planned} studentId={studentId} canEdit={canEdit} />
        </section>
      ) : (
        <PlainCard label={label} today={ctx.today} dates={dates} kind={test.kind} planned={planned} studentId={studentId} canEdit={canEdit} />
      )}

      <section className="overflow-hidden rounded-3xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-display text-lg font-bold">College by college</h2>
          <p className="text-xs text-muted-foreground">The bar is the middle 50% of enrolled students; the dot is {isGuardian ? `${name}'s` : "your"} score.</p>
        </div>
        <ul className="divide-y">
          {view.rows.map((r) => (
            <ScoreRow key={r.item.id} row={r} kind={test.kind} score={test.score} />
          ))}
        </ul>
      </section>

      <CoursesSection ctx={ctx} view={view} />
    </div>
  );
}

/** The plain card (scores.md "The suggestion card") when no retake would move a group: on request, the dates. */
function PlainCard({
  label,
  today,
  dates,
  kind,
  planned,
  studentId,
  canEdit,
}: {
  label: string;
  today: string;
  dates: CycleEntry[];
  kind: TestKind;
  planned: readonly string[];
  studentId: string | null;
  canEdit: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <section className="rounded-3xl border bg-card p-5 text-sm">
      <p className="font-semibold">No test needed for this list.</p>
      <p className="text-muted-foreground">A typical retake wouldn&apos;t move any of these colleges to a new group. If you want to try anyway, the dates are here.</p>
      <button type="button" onClick={() => setShow((v) => !v)} className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
        <CalendarClock className="size-4" aria-hidden /> {show ? "Hide" : "Show"} upcoming {label} dates
      </button>
      {show && <TestDates dates={dates} today={today} kind={kind} rows={[]} planned={planned} studentId={studentId} canEdit={canEdit} />}
    </section>
  );
}

function TestDates({
  dates,
  today,
  kind,
  rows,
  planned,
  studentId,
  canEdit,
}: {
  dates: CycleEntry[];
  today: string;
  kind: TestKind;
  rows: InTimeRow[];
  planned: readonly string[];
  studentId: string | null;
  canEdit: boolean;
}) {
  if (dates.length === 0) return <p className="mt-3 text-sm">No upcoming dates on record yet.</p>;
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {dates.map((d) => (
        <TestDateRow key={d.key} entry={d} today={today} kind={kind} rows={rows} initiallyPlanned={planned.includes(d.key)} studentId={studentId} canEdit={canEdit} />
      ))}
    </ul>
  );
}

/** One test date: the date, days away, registration, the official link, the in-time sentence, and "I'll take it". */
function TestDateRow({
  entry,
  today,
  kind,
  rows,
  initiallyPlanned,
  studentId,
  canEdit,
}: {
  entry: CycleEntry;
  today: string;
  kind: TestKind;
  rows: InTimeRow[];
  initiallyPlanned: boolean;
  studentId: string | null;
  canEdit: boolean;
}) {
  const [picked, setPicked] = useState(initiallyPlanned);
  const [pending, startTransition] = useTransition();
  const date = entry.date as string;
  const text = inTimeText(date, rows);

  const toggle = () => {
    if (!studentId || !canEdit) return;
    const next = !picked;
    setPicked(next);
    startTransition(async () => {
      const result = await setPlannedDate(studentId, entry.key, next);
      if (!result.ok) setPicked(!next);
      else track("plan_test_date_picked", { test: kind });
    });
  };

  return (
    <li className="rounded-2xl bg-background/70 px-3 py-2 text-sm text-foreground">
      <p className="font-semibold">
        {entry.label} · {dayLabel(date)} <span className="font-normal text-muted-foreground">({daysBetween(today, date)} days)</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {registerByText(entry.register_by ?? null, today)} ·{" "}
        <a href={entry.source} className="font-semibold text-primary hover:underline" target="_blank" rel="noreferrer">
          official dates
        </a>
      </p>
      {text && <p className="mt-1 text-xs">{text}</p>}
      {canEdit && studentId && (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={cn(
            "mt-2 inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold",
            picked ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
          )}
        >
          {picked ? "Taking it" : "I'll take it"}
        </button>
      )}
    </li>
  );
}
