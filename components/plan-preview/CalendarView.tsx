"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { CalendarPlus, Printer } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ROUND_SHORT } from "@/lib/planner/rounds";
import { cn } from "@/lib/utils";
import type { Derived } from "./derive";
import { MONEY_VAR, ROUND_NAME, ROUND_VAR, STRIPED, TEST_VAR, addDaysIso, dayLabel, daysBetween, monthLabel, type PreviewEntry, type PreviewKid } from "./types";

/** Weeks of work shown before each deadline (calendar.md "Bars"). */
const WORK_WEEKS = 6;
/** Days before an ED deadline the family's cost check is due (rounds.md "Money"). */
const COST_CHECK_DAYS = 21;

type Mark =
  | { kind: "bar"; start: string; end: string; color: string; striped: boolean; label: string; tip: string }
  | { kind: "window"; start: string; end: string; label: string; tip: string; row: number }
  | { kind: "deadline"; date: string; color: string; tip: string }
  | { kind: "decision"; from: string; date: string; color: string; tip: string }
  | { kind: "test"; date: string; color: string; tip: string; past: boolean }
  | { kind: "money"; date: string; color: string; tip: string; label?: string };

interface Lane {
  key: string;
  label: ReactNode;
  sub?: string;
  marks: Mark[];
  note?: string;
  /** Stacked rows (overlapping windows each get their own). */
  rows?: number;
}

interface Event {
  date: string;
  kid: PreviewKid;
  color: string;
  shape: "bar" | "test" | "money" | "decision";
  text: string;
}

/**
 * The family calendar (specs/planner/redesign/calendar.md): a school year as a timeline, one lane per college plus
 * lanes for tests, essays, and money; bars in the round's color ending in the deadline, the decision after it, today
 * as a line. Everyone's on one chart in each child's color, or one child in round colors. "Coming up" below is the
 * same events as a list (and the view phones lead with).
 */
export function CalendarView({
  kids,
  derived,
  entries,
  today,
  isParent,
  kidColor,
  everyone,
}: {
  kids: PreviewKid[];
  derived: Record<string, Derived>;
  entries: PreviewEntry[];
  today: string;
  isParent: boolean;
  kidColor: (id: string) => string;
  everyone: boolean;
}) {
  const [colorBy, setColorBy] = useState<"round" | "kid">(everyone ? "kid" : "round");
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const byKid = everyone && colorBy === "kid";

  const y = Number(today.slice(0, 4));
  const startYear = Number(today.slice(5, 7)) >= 8 ? y : y - 1;
  const from = `${startYear}-08-01`;
  const to = `${startYear + 1}-07-31`;
  const span = daysBetween(from, to);
  const x = (iso: string) => Math.max(0, Math.min(100, (daysBetween(from, iso) / span) * 100));
  const inRange = (iso: string) => iso >= from && iso <= to;

  const lanesFor = (kid: PreviewKid): { lanes: Lane[]; events: Event[] } => {
    const d = derived[kid.id];
    const kc = kidColor(kid.id);
    const color = (c: string) => (byKid ? kc : c);
    const lanes: Lane[] = [];
    const events: Event[] = [];
    const applying = kid.cycleStart === startYear;

    // Tests: only while the student is still testing (a junior) or when another test would help.
    if (d.student.test && (!applying || d.retake)) {
      const label = d.student.test.kind === "sat" ? "SAT" : "ACT";
      const last = d.rows.reduce((m, r) => (r.deadline && r.deadline.iso > m ? r.deadline.iso : m), "");
      const tests = entries.filter((e) => e.applies === "plans_tests" && e.date && inRange(e.date) && e.label.startsWith(label) && (!applying || e.date <= last));
      lanes.push({
        key: `${kid.id}:tests`,
        label: `${label} dates`,
        sub: applying ? "another test could help" : "pick one or two",
        marks: tests.map((t) => ({
          kind: "test",
          date: t.date!,
          color: color(TEST_VAR),
          past: t.date! < today,
          tip: `${t.label} ${dayLabel(t.date!)}${t.registerBy ? ` · register by ${dayLabel(t.registerBy)}` : ""}`,
        })),
      });
      for (const t of tests.filter((t) => t.date! >= today)) events.push({ date: t.date!, kid, color: color(TEST_VAR), shape: "test", text: `${t.label} test date${t.registerBy && t.registerBy >= today ? ` (register by ${dayLabel(t.registerBy)})` : ""}` });
    }

    // Essays and recommendations: the cycle's windows for this student.
    const windows = entries.filter((e) => e.kid === kid.id && e.window && e.window[1] >= from && e.window[0] <= to && e.applies !== "committed");
    if (windows.length > 0) {
      // Greedy packing: each window takes the first row whose last window has ended.
      const ends: string[] = [];
      const marks: Mark[] = [...windows]
        .sort((a, b) => a.window![0].localeCompare(b.window![0]))
        .map((w) => {
          const start = w.window![0] < from ? from : w.window![0];
          const end = w.window![1] > to ? to : w.window![1];
          let row = ends.findIndex((e) => e < start);
          if (row === -1) row = ends.length;
          ends[row] = end;
          return { kind: "window", start, end, row, label: w.label, tip: `${w.label}: ${dayLabel(w.window![0])} – ${dayLabel(w.window![1])}` };
        });
      lanes.push({ key: `${kid.id}:work`, label: "Essays & recs", marks, rows: ends.length });
    }

    // Money: aid forms open, the cost check before a binding round, the reply date.
    const money: Mark[] = [];
    for (const e of entries.filter((e) => e.kid === kid.id && e.date && inRange(e.date) && (e.assignee === "guardian" || e.key === "reply_date"))) {
      if (e.applies === "has_css_college" && !applying) continue;
      money.push({ kind: "money", date: e.date!, color: color(MONEY_VAR), tip: `${e.label} · ${dayLabel(e.date!)}` });
      if (e.date! >= today) events.push({ date: e.date!, kid, color: color(MONEY_VAR), shape: "money", text: e.label });
    }
    for (const r of d.rows.filter((r) => (r.round === "ed" || r.round === "ed2") && r.deadline && inRange(r.deadline.iso))) {
      const due = addDaysIso(r.deadline!.iso, -COST_CHECK_DAYS);
      money.push({ kind: "money", date: due, color: color(MONEY_VAR), tip: `Check the cost of ${r.school.name} together before applying ${ROUND_SHORT[r.round]} · ${dayLabel(due)}` });
      if (due >= today) events.push({ date: due, kid, color: color(MONEY_VAR), shape: "money", text: `Cost check with a parent before ${r.school.name} ${ROUND_SHORT[r.round]}` });
    }
    if (money.length > 0 && applying) lanes.push({ key: `${kid.id}:money`, label: "Money", sub: isParent ? "your part" : "with a parent", marks: money });

    // Colleges: a work bar ending in the deadline, then the wait for the decision.
    const dated = d.rows.filter((r) => r.deadline && inRange(r.deadline.iso)).sort((a, b) => a.deadline!.iso.localeCompare(b.deadline!.iso));
    for (const r of dated) {
      const end = r.deadline!.iso;
      const c = color(ROUND_VAR[r.round]);
      const marks: Mark[] = [
        { kind: "bar", start: addDaysIso(end, -WORK_WEEKS * 7) < from ? from : addDaysIso(end, -WORK_WEEKS * 7), end, color: c, striped: STRIPED.has(r.round), label: ROUND_SHORT[r.round], tip: `${r.school.name} · ${ROUND_NAME[r.round]} · due ${dayLabel(end)}` },
        { kind: "deadline", date: end, color: c, tip: `${r.school.name} ${ROUND_SHORT[r.round]} due ${dayLabel(end)}` },
      ];
      if (r.decision && inRange(r.decision.iso) && r.decision.iso > end) marks.push({ kind: "decision", from: end, date: r.decision.iso, color: c, tip: `${r.school.name} decision around ${dayLabel(r.decision.iso)}` });
      lanes.push({ key: `${kid.id}:${r.school.id}`, label: r.school.name, sub: r.dream ? "Dream" : undefined, marks });
      if (end >= today) events.push({ date: end, kid, color: c, shape: "bar", text: `${r.school.name} ${ROUND_SHORT[r.round]} due` });
      if (r.decision && r.decision.iso >= today) events.push({ date: r.decision.iso, kid, color: c, shape: "decision", text: `${r.school.name} decision expected` });
    }
    const undated = d.rows.length - dated.length;
    if (!applying) {
      lanes.push({ key: `${kid.id}:later`, label: "Applications", marks: [], note: `${d.rows.length} colleges on the list; their deadlines start next school year (applications open Aug 1, ${kid.cycleStart})` });
    } else if (undated > 0) {
      lanes.push({ key: `${kid.id}:undated`, label: "No date on record", marks: [], note: `${d.rows.filter((r) => !r.deadline).map((r) => r.school.name).join(", ")}: add the date from the college's site` });
    }
    return { lanes, events };
  };

  const groups = kids.map((k) => ({ kid: k, ...lanesFor(k) }));
  const events = groups.flatMap((g) => g.events).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = (7 + i) % 12;
    const yr = startYear + (7 + i >= 12 ? 1 : 0);
    return { label: monthLabel(m), iso: `${yr}-${String(m + 1).padStart(2, "0")}-01` };
  });

  const show = (e: React.MouseEvent | React.FocusEvent, text: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, text });
  };
  const markProps = (text: string) => ({
    "aria-label": text,
    onMouseEnter: (e: React.MouseEvent) => show(e, text),
    onFocus: (e: React.FocusEvent) => show(e, text),
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {everyone && (
            <SegmentedControl
              label="Color by"
              value={colorBy}
              onChange={setColorBy}
              options={[
                { value: "kid", label: "Color by child" },
                { value: "round", label: "Color by round" },
              ]}
            />
          )}
          <Legend byKid={byKid} kids={kids} kidColor={kidColor} />
        </div>
        <div className="flex gap-2">
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold" title="Subscribes Google, Apple, or Outlook to this calendar (the feed the planner already has)">
            <CalendarPlus className="size-4" /> Add to my calendar
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold">
            <Printer className="size-4" /> Print
          </button>
        </div>
      </div>

      <section className="overflow-x-auto rounded-3xl border bg-card">
        <div className="min-w-[760px]">
          <div className="sticky top-0 grid grid-cols-[11rem_1fr] border-b bg-card">
            <div className="px-4 py-2 text-xs font-semibold text-muted-foreground">
              {startYear}–{String((startYear + 1) % 100).padStart(2, "0")} school year
            </div>
            <div className="relative h-8">
              {months.map((m) => (
                <span key={m.iso} className="absolute top-2 text-[11px] font-semibold text-muted-foreground" style={{ left: `calc(${x(m.iso)}% + 4px)` }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.kid.id}>
              {(everyone || kids.length > 1) && (
                <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs font-bold">
                  <span className="size-3 rounded-full" style={{ background: kidColor(g.kid.id) }} />
                  {g.kid.name} · class of {g.kid.gradYear}
                </div>
              )}
              {g.lanes.map((lane) => (
                <div key={lane.key} className="grid grid-cols-[11rem_1fr] border-b last:border-b-0">
                  <div className="min-w-0 px-4 py-2">
                    <p className="truncate text-sm font-semibold">{lane.label}</p>
                    {lane.sub && <p className="truncate text-[11px] text-muted-foreground">{lane.sub}</p>}
                  </div>
                  <div className="relative min-h-11" style={lane.rows && lane.rows > 1 ? { height: 12 + lane.rows * 24 } : undefined}>
                    {months.map((m) => (
                      <span key={m.iso} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${x(m.iso)}%` }} />
                    ))}
                    <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${x(today)}%` }} aria-hidden />
                    {lane.note && <p className="absolute inset-y-0 z-10 flex items-center pr-2 text-xs text-muted-foreground" style={{ left: `calc(${x(today)}% + 8px)` }}>{lane.note}</p>}
                    {lane.marks.map((m, i) => (
                      <MarkView key={i} mark={m} x={x} markProps={markProps} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {tip && (
        <div role="tooltip" className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background shadow-lg" style={{ left: tip.x, top: tip.y - 6 }}>
          {tip.text}
        </div>
      )}

      <section className="rounded-3xl border bg-card p-4">
        <h2 className="font-display text-lg font-bold">Coming up</h2>
        <ul className="mt-2 divide-y">
          {events.map((e, i) => (
            <li key={i} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-16 shrink-0 font-semibold tabular-nums">{dayLabel(e.date)}</span>
              <Shape shape={e.shape} color={e.color} />
              {everyone && (
                <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: kidColor(e.kid.id) }}>
                  {e.kid.name}
                </span>
              )}
              <span className="min-w-0 flex-1">{e.text}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{daysBetween(today, e.date)} days</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const stripe = (c: string): CSSProperties => ({ background: `repeating-linear-gradient(135deg, ${c} 0 6px, color-mix(in oklab, ${c} 55%, transparent) 6px 10px)` });

function MarkView({ mark: m, x, markProps }: { mark: Mark; x: (iso: string) => number; markProps: (t: string) => Record<string, unknown> }) {
  switch (m.kind) {
    case "bar": {
      const w = x(m.end) - x(m.start);
      return (
        <button
          type="button"
          {...markProps(m.tip)}
          className="absolute top-1/2 z-10 flex h-6 -translate-y-1/2 items-center overflow-hidden rounded-l-full pl-2 text-[11px] font-bold text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          style={{ left: `${x(m.start)}%`, width: `${w}%`, ...(m.striped ? stripe(m.color) : { background: m.color }) }}
        >
          {m.label}
        </button>
      );
    }
    case "window":
      return (
        <button
          type="button"
          {...markProps(m.tip)}
          className="absolute z-10 flex h-5 items-center overflow-hidden rounded-full bg-muted px-2 text-[10px] font-semibold whitespace-nowrap text-muted-foreground ring-1 ring-border"
          style={{ left: `${x(m.start)}%`, width: `${x(m.end) - x(m.start)}%`, top: 6 + m.row * 24 }}
        >
          {m.label}
        </button>
      );
    case "deadline":
      return <button type="button" {...markProps(m.tip)} className="absolute top-1/2 z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ring-2 ring-card" style={{ left: `${x(m.date)}%`, background: m.color }} />;
    case "decision":
      return (
        <>
          <span className="absolute top-1/2 border-t-2 border-dashed" style={{ left: `${x(m.from)}%`, width: `${x(m.date) - x(m.from)}%`, borderColor: m.color }} aria-hidden />
          <button type="button" {...markProps(m.tip)} className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card" style={{ left: `${x(m.date)}%`, borderColor: m.color }} />
        </>
      );
    case "test":
      return (
        <button
          type="button"
          {...markProps(m.tip)}
          className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2", m.past && "opacity-35")}
          style={{ left: `${x(m.date)}%`, width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderBottom: `14px solid ${m.color}` }}
        />
      );
    case "money":
      return (
        <button type="button" {...markProps(m.tip)} className="absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-card" style={{ left: `${x(m.date)}%`, background: m.color }}>
          $
        </button>
      );
  }
}

function Shape({ shape, color }: { shape: Event["shape"]; color: string }) {
  if (shape === "test") return <span className="shrink-0" style={{ width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: `10px solid ${color}` }} />;
  if (shape === "money") return <span className="flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: color }}>$</span>;
  if (shape === "decision") return <span className="size-3 shrink-0 rounded-full border-2" style={{ borderColor: color }} />;
  return <span className="size-3 shrink-0 rotate-45" style={{ background: color }} />;
}

function Legend({ byKid, kids, kidColor }: { byKid: boolean; kids: PreviewKid[]; kidColor: (id: string) => string }) {
  const item = (swatch: ReactNode, label: string) => (
    <span key={label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {swatch}
      {label}
    </span>
  );
  const bar = (c: string, striped = false) => <span className="h-2.5 w-5 rounded-full" style={striped ? stripe(c) : { background: c }} />;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {byKid
        ? kids.map((k) => item(bar(kidColor(k.id)), k.name))
        : [
            item(bar(ROUND_VAR.ed), "ED"),
            item(bar(ROUND_VAR.ed2, true), "ED II"),
            item(bar(ROUND_VAR.ea), "EA"),
            item(bar(ROUND_VAR.rea, true), "REA"),
            item(bar(ROUND_VAR.rd), "RD / rolling"),
          ]}
      {item(<Shape shape="bar" color="currentColor" />, "deadline")}
      {item(<Shape shape="decision" color="currentColor" />, "decision")}
      {item(<Shape shape="test" color={byKid ? "currentColor" : TEST_VAR} />, "test date")}
      {item(<Shape shape="money" color={byKid ? "var(--muted-foreground)" : MONEY_VAR} />, "money")}
    </div>
  );
}
