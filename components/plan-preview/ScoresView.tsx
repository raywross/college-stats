"use client";

import { useState } from "react";
import { CalendarClock, PartyPopper, TrendingUp } from "lucide-react";
import { SourceTip } from "@/components/ui/info-tip";
import { ROUND_SHORT } from "@/lib/planner/rounds";
import { TEST_LABEL, actToSat, satToAct, type TestKind } from "@/lib/planner/standing";
import { cn } from "@/lib/utils";
import type { Derived, KidState, Row } from "./derive";
import { FIT_CLASS, FIT_LABEL } from "./ListView";
import { addDaysIso, dayLabel, daysBetween, type PreviewEntry, type PreviewKid } from "./types";

/** Days from a test date to scores a college can use (scores.md "Score timing"); the digital SAT is faster than this. */
const SCORE_LAG: Record<TestKind, number> = { sat: 14, act: 14 };
const AXIS: Record<TestKind, [number, number]> = { sat: [1000, 1600], act: [18, 36] };

/**
 * Scores (specs/planner/redesign/scores.md): where the student's one test stands at each college, whether to send it,
 * and, only when a common retake gain would move a college up a group, the suggestion and the next test dates that
 * land in time. Encouraging first; dates on request.
 */
export function ScoresView({
  kid,
  state,
  derived,
  entries,
  today,
  isParent,
}: {
  kid: PreviewKid;
  state: KidState;
  derived: Derived;
  entries: PreviewEntry[];
  today: string;
  isParent: boolean;
  onState: (f: (s: KidState) => KidState) => void;
}) {
  const [showDates, setShowDates] = useState(false);
  const test = state.test;
  const you = isParent ? kid.name : "you";
  const your = isParent ? `${kid.name}'s` : "your";

  if (!test) {
    return (
      <section className="rounded-3xl border bg-card p-5 text-sm">
        <h2 className="font-display text-xl font-bold">Not testing</h2>
        <p className="mt-1 text-muted-foreground">
          The groups use {your} GPA alone. {derived.rows.filter((r) => r.standing.send === "required-missing").map((r) => r.school.name).join(", ") || "None of these colleges"}{" "}
          {derived.rows.some((r) => r.standing.send === "required-missing") ? "ask for a score." : "require a score."}
        </p>
      </section>
    );
  }

  const label = TEST_LABEL[test.kind];
  const read = derived.rows.filter((r) => r.standing.test);
  const inOrAbove = read.filter((r) => r.standing.test!.position !== "below").length;
  const retake = derived.retake;
  const byId = new Map(derived.rows.map((r) => [r.school.id, r]));
  // A senior sees only dates whose scores could still reach a deadline on the list; a junior sees the next few.
  const applying = today >= `${kid.cycleStart}-08-01`;
  const last = derived.rows.reduce((m, r) => (r.deadline && r.deadline.iso > m ? r.deadline.iso : m), "");
  const dates = entries
    .filter((e) => e.applies === "plans_tests" && e.date && e.date >= today && e.label.startsWith(label) && (!applying || addDaysIso(e.date, SCORE_LAG[test.kind]) <= last))
    .sort((a, b) => a.date!.localeCompare(b.date!))
    .slice(0, applying ? 3 : 4);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border bg-card p-5">
        <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{isParent ? `${kid.name} is taking the ${label}` : `You're taking the ${label}`}</p>
        <p className="mt-1 font-display text-4xl font-bold tabular-nums">{test.score}</p>
        <p className="mt-2 flex items-start gap-2 text-sm">
          <PartyPopper className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <span>
            In or above the middle 50% at <span className="font-semibold">{inOrAbove} of {read.length}</span> colleges on the list.
            {inOrAbove === read.length ? ` ${isParent ? "That score" : "Your score"} already works everywhere; time is better spent on essays.` : ""}
          </span>
        </p>
      </section>

      {retake ? (
        <section className="rounded-3xl bg-pop p-5 text-pop-foreground">
          <p className="flex items-center gap-2 text-xs font-bold tracking-wide uppercase">
            <TrendingUp className="size-4" /> Worth one more test
          </p>
          <p className="mt-1 font-display text-2xl leading-tight font-bold">
            A {retake.target} ({retake.delta > 0 ? `+${retake.delta}` : retake.delta}) would move {retake.moves.length === 1 ? "one college" : `${retake.moves.length} colleges`} up a group
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {retake.moves.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{byId.get(m.id)?.school.name}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", FIT_CLASS[m.from])}>{FIT_LABEL[m.from]}</span>→
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", FIT_CLASS[m.to])}>{FIT_LABEL[m.to]}</span>
                <span className="opacity-80">with {test.score + m.needed}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm opacity-90">
            Students who retake gain {test.kind === "sat" ? "about 40 to 60 points" : "a point or two"} on average, more with practice, and most colleges take the best score.
          </p>
          <TestDates dates={dates} today={today} kind={test.kind} rows={retake.moves.map((m) => byId.get(m.id)!).filter(Boolean)} />
        </section>
      ) : (
        <section className="rounded-3xl border bg-card p-5 text-sm">
          <p className="font-semibold">No test needed for this list.</p>
          <p className="text-muted-foreground">A typical retake wouldn&apos;t move any of these colleges to a new group. If {you} want to try anyway, the dates are here.</p>
          <button type="button" onClick={() => setShowDates((v) => !v)} className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            <CalendarClock className="size-4" /> {showDates ? "Hide" : "Show"} upcoming {label} dates
          </button>
          {showDates && <TestDates dates={dates} today={today} kind={test.kind} rows={[]} plain />}
        </section>
      )}

      <section className="overflow-hidden rounded-3xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-display text-lg font-bold">College by college</h2>
          <p className="text-xs text-muted-foreground">The bar is the middle 50% of enrolled students; the dot is {your} score.</p>
        </div>
        <ul className="divide-y">
          {derived.rows.map((r) => (
            <ScoreRow key={r.school.id} row={r} kind={test.kind} score={test.score} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function TestDates({ dates, today, kind, rows, plain = false }: { dates: PreviewEntry[]; today: string; kind: TestKind; rows: Row[]; plain?: boolean }) {
  if (dates.length === 0) return <p className="mt-3 text-sm">No upcoming dates on record yet.</p>;
  return (
    <ul className={cn("mt-3 grid gap-2 sm:grid-cols-2", plain && "text-foreground")}>
      {dates.map((d) => {
        const ready = addDaysIso(d.date!, SCORE_LAG[kind]);
        const inTime = rows.filter((r) => r.deadline && r.deadline.iso >= ready);
        // A college whose chosen round closes first may have a later round the new score can still reach.
        const later = rows
          .filter((r) => !inTime.includes(r))
          .map((r) => {
            const alt = r.pickable.filter((x) => x !== r.round).find((x) => (r.school.dates[x].closing?.iso ?? "") >= ready);
            return alt ? `${r.school.name} ${ROUND_SHORT[alt]} (${dayLabel(r.school.dates[alt].closing!.iso)})` : null;
          })
          .filter(Boolean);
        const closed = d.registerBy !== null && d.registerBy < today;
        return (
          <li key={d.id} className={cn("rounded-2xl px-3 py-2 text-sm", plain ? "bg-muted/60" : "bg-background/70 text-foreground")}>
            <p className="font-semibold">
              {d.label} · {dayLabel(d.date!)} <span className="font-normal text-muted-foreground">({daysBetween(today, d.date!)} days)</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {d.registerBy ? (closed ? `Registration closed ${dayLabel(d.registerBy)}; late registration may be open` : `Register by ${dayLabel(d.registerBy)}`) : "Registration not open yet"} ·{" "}
              <a href={d.source} className="font-semibold text-primary hover:underline" target="_blank" rel="noreferrer">
                official dates
              </a>
            </p>
            {rows.length > 0 && (
              <p className="mt-1 text-xs">
                {inTime.length > 0 && `Scores in time for ${inTime.map((r) => `${r.school.name} ${ROUND_SHORT[r.round]}`).join(", ")}. `}
                {later.length > 0 && `Too late for ${inTime.length > 0 ? "the rest" : "the rounds you picked"}; in time for ${later.join(", ")}.`}
                {inTime.length === 0 && later.length === 0 && "Scores arrive after these deadlines."}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const SEND_LABEL = {
  send: "Send it",
  "consider-not-sending": "Optional here: consider not sending",
  "required-missing": "Score required",
  "not-used": "Doesn't use scores",
} as const;

function ScoreRow({ row, kind, score }: { row: Row; kind: TestKind; score: number }) {
  const t = row.standing.test;
  const [lo, hi] = AXIS[kind];
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  // A concorded range is drawn on the student's own test's scale.
  const range: [number, number] | null = t ? (t.concorded ? (kind === "act" ? [satToAct(t.range[0]) ?? lo, satToAct(t.range[1]) ?? hi] : [actToSat(t.range[0]) ?? lo, actToSat(t.range[1]) ?? hi]) : t.range) : null;
  const cite = t ? (t.kind === "sat" ? row.school.cites.sat : row.school.cites.act) : row.school.cites.policy;
  return (
    <li className="grid grid-cols-1 items-center gap-2 px-4 py-3 sm:grid-cols-[14rem_1fr_13rem]">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{row.school.name}</p>
        {row.fit && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", FIT_CLASS[row.fit])}>{FIT_LABEL[row.fit]}</span>}
      </div>
      {range ? (
        <div className="relative h-6" aria-label={`Middle 50% ${range[0]} to ${range[1]}; ${score}`}>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
          <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted-foreground/30" style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }} />
          <span className="absolute top-full text-[10px] text-muted-foreground tabular-nums" style={{ left: pct(range[0]) }}>
            {range[0]}
          </span>
          <span className="absolute top-full -translate-x-full text-[10px] text-muted-foreground tabular-nums" style={{ left: pct(range[1]) }}>
            {range[1]}
          </span>
          <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card" style={{ left: pct(score) }} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{row.standing.send === "not-used" ? "Test-blind: scores aren't read." : "No score range on record."}</p>
      )}
      <div className="flex flex-wrap items-center gap-1 text-xs sm:justify-end">
        {row.standing.send && <span className={cn("font-semibold", row.standing.send === "send" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{SEND_LABEL[row.standing.send]}</span>}
        {cite && <SourceTip cited={cite} />}
        {row.moveUp && (
          <span className="w-full text-muted-foreground sm:text-right">
            {row.moveUp.score} → {FIT_LABEL[row.moveUp.to]}
            {t?.concorded ? " (via concordance)" : ""}
          </span>
        )}
      </div>
    </li>
  );
}
