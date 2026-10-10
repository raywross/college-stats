"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { CalendarChild, CalendarTabProps } from "@/components/planner/tabs/types";
import { CalendarLane, type MarkStyle } from "@/components/planner/CalendarLane";
import { ComingUp } from "@/components/planner/ComingUp";
import {
  calendarFor,
  comingUp,
  monthsOf,
  schoolYearOf,
  stepRange,
  xPercent,
  type CalendarCite,
  type CalendarEvent,
  type CalendarMark,
  type YearRange,
} from "@/lib/planner/calendar";
import { KID_VARS, MONEY_VAR, ROUND_VAR, STRIPED, TEST_VAR } from "@/lib/planner/colors";
import { ROUND_LABELS, type ListRound } from "@/lib/list-rules";
import { createCalendarToken } from "@/lib/planner/store-timeline";
import { track } from "@/lib/analytics";
import type { PlanContext } from "@/lib/planner/types";

type ColorBy = "child" | "round";

/**
 * The Calendar tab (specs/planner/redesign/calendar.md): every child's application year as colored bars ending in
 * their deadlines, test dates, essay and recommendation windows, and the money dates that are the parent's part,
 * on one chart with today as a line. A student sees only their own; Everyone stacks each child's lanes under a
 * header row and can color by child (the default) or by round. Below it (first on phones): Coming up, the same
 * events as an accessible list.
 */
export default function FamilyCalendar({ children, viewer, everyone }: CalendarTabProps) {
  const today = children[0]?.ctx.today ?? new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState<YearRange>(() => schoolYearOf(today));
  const [colorBy, setColorBy] = useState<ColorBy>(everyone ? "child" : "round");
  const byChild = everyone && colorBy === "child";

  useEffect(() => {
    track("plan_calendar_opened", { everyone, color_by: byChild ? "child" : "round" });
    // Fire once per mount of this tab; colorBy changes are a deliberate re-view, tracked the same way below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onColorBy = (v: ColorBy) => {
    setColorBy(v);
    track("plan_calendar_opened", { everyone, color_by: v === "child" && everyone ? "child" : "round" });
  };

  // The money lane's caption follows the signed-in viewer (calendar.md "Lanes" 3: "your part" for a guardian,
  // "with a parent" for a student), not each child's own context, which is the same person's but kept separately.
  const moneySub = viewer === "guardian" ? "your part" : "with a parent";
  const groups = useMemo(
    () =>
      children.map((c) => ({
        child: c,
        lanes: calendarFor(c.ctx, c.view, range).map((lane) => (lane.key === "money" ? { ...lane, sub: moneySub } : lane)),
      })),
    [children, range, moneySub],
  );
  const names = useMemo(() => Object.fromEntries(children.map((c) => [c.studentId, { name: c.name, colorSlot: c.colorSlot }])), [children]);
  const events = useMemo(() => comingUp(children.map((c) => ({ studentId: c.studentId, ctx: c.ctx, view: c.view })), today, 12), [children, today]);

  const ctxById = useMemo(() => Object.fromEntries(children.map((c) => [c.studentId, c.ctx])), [children]);
  const resolveCite = (studentId: string) => (cite: CalendarCite): { url: string } | null => {
    if (!cite) return null;
    if (cite.kind === "link") return { url: cite.url };
    const ctx: PlanContext | undefined = ctxById[studentId];
    const school = ctx?.schools[cite.unitId];
    const cited = school?.cites[cite.field] as { url?: string } | undefined;
    return cited?.url ? { url: cited.url } : null;
  };

  const kidColor = (slot: 0 | 1 | 2) => KID_VARS[slot];
  const roundColor = (round: ListRound) => ROUND_VAR[round];
  const styleForChild =
    (colorSlot: 0 | 1 | 2) =>
    (m: CalendarMark): MarkStyle => {
      const striped = (m.kind === "bar" || m.kind === "deadline" || m.kind === "decision") && STRIPED.has(m.round);
      if (byChild) return { color: kidColor(colorSlot), striped };
      if (m.kind === "test") return { color: TEST_VAR, striped: false };
      if (m.kind === "money") return { color: MONEY_VAR, striped: false };
      if (m.kind === "window") return { color: "", striped: false };
      return { color: roundColor(m.round), striped };
    };

  const colorForEvent = (colorSlot: 0 | 1 | 2) => (e: CalendarEvent): string => {
    if (byChild) return kidColor(colorSlot);
    if (e.shape === "test") return TEST_VAR;
    if (e.shape === "money") return MONEY_VAR;
    return roundColor(e.round!);
  };
  // Coming up mixes children, so its per-row color follows that row's own child's slot.
  const colorForAnyEvent = (e: CalendarEvent): string => {
    const slot = children.find((c) => c.studentId === e.studentId)?.colorSlot ?? 0;
    return colorForEvent(slot)(e);
  };

  if (children.length === 0) {
    return (
      <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">Nothing on the calendar yet.</section>
    );
  }

  return (
    <div className="space-y-4">
      {/* Coming up leads on phones (specs/mobile.md); the chart leads from sm. */}
      <div className="sm:hidden">
        <ComingUpForEvents events={events} everyone={everyone} today={today} names={names} colorForAnyEvent={colorForAnyEvent} resolveCite={resolveCite} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {everyone && (
            <SegmentedControl
              label="Color by"
              value={colorBy}
              onChange={onColorBy}
              options={[
                { value: "child", label: "Color by child" },
                { value: "round", label: "Color by round" },
              ]}
            />
          )}
          <RangeStepper range={range} onStep={setRange} />
        </div>
        <div className="flex gap-2">
          <PrintLink everyone={everyone} studentId={children.length === 1 ? children[0].studentId : null} />
          {children.length === 1 && <AddToCalendar listId={children[0].ctx.list.id} everyone={everyone} />}
        </div>
      </div>

      <section className="overflow-x-auto rounded-3xl border bg-card">
        <div className="min-w-[760px]">
          <div className="sticky top-0 z-10 grid grid-cols-[7rem_1fr] border-b bg-card sm:grid-cols-[11rem_1fr]">
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground sm:px-4">
              {range.startYear}–{String((range.startYear + 1) % 100).padStart(2, "0")} school year
            </div>
            <div className="relative h-8">
              {monthsOf(range).map((m) => (
                <span key={m.iso} className="absolute top-2 text-[11px] font-semibold text-muted-foreground" style={{ left: `calc(${xPercent(range, m.iso)}% + 4px)` }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {groups.map(({ child, lanes }) => (
            <div key={child.studentId}>
              {children.length > 1 && (
                <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-bold sm:px-4">
                  <span className="size-3 rounded-full" style={{ background: kidColor(child.colorSlot) }} aria-hidden />
                  {child.name} · class of {child.gradYear ?? "—"}
                  {children.length === 1 ? null : <AddToCalendarSmall listId={child.ctx.list.id} />}
                </div>
              )}
              {lanes.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">Nothing on {child.name}&rsquo;s calendar in {range.startYear}–{String((range.startYear + 1) % 100).padStart(2, "0")}.</p>
              ) : (
                lanes.map((lane) => (
                  <CalendarLane key={lane.key} lane={lane} range={range} today={today} styleFor={styleForChild(child.colorSlot)} resolveCite={resolveCite(child.studentId)} />
                ))
              )}
            </div>
          ))}
        </div>
      </section>

      <Legend byChild={byChild} kids={children} />

      <div className="hidden sm:block">
        <ComingUpForEvents events={events} everyone={everyone} today={today} names={names} colorForAnyEvent={colorForAnyEvent} resolveCite={resolveCite} />
      </div>
    </div>
  );
}

function RangeStepper({ range, onStep }: { range: YearRange; onStep: (r: YearRange) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-card p-0.5">
      <button type="button" aria-label="Previous school year" className="inline-flex size-7 items-center justify-center rounded-full hover:bg-muted" onClick={() => onStep(stepRange(range, -1))}>
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-1 text-xs font-semibold tabular-nums">
        {range.startYear}–{String((range.startYear + 1) % 100).padStart(2, "0")}
      </span>
      <button type="button" aria-label="Next school year" className="inline-flex size-7 items-center justify-center rounded-full hover:bg-muted" onClick={() => onStep(stepRange(range, 1))}>
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function PrintLink({ everyone, studentId }: { everyone: boolean; studentId: string | null }) {
  const href = everyone || !studentId ? "/plan/print" : `/plan/print?for=${studentId}`;
  return (
    <Link href={href} onClick={() => track("plan_calendar_printed", { everyone })} className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold hover:bg-muted">
      <Printer className="size-4" /> Print
    </Link>
  );
}

/** "Add to my calendar" for one child's list, reusing the existing per-list feed (lib/planner/store-timeline.ts)
 *  until the per-viewer feed (specs/planner/redesign/calendar.md "Feed, print, share") lands. */
function AddToCalendar({ listId, everyone }: { listId: string; everyone: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const subscribe = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await createCalendarToken(listId);
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      setUrl(`webcal://${window.location.host}/api/plan/${r.token}.ics`);
      track("plan_calendar_feed_added", { everyone });
    });

  if (url) {
    return (
      <a href={url} className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold hover:bg-muted">
        <CalendarPlus className="size-4" /> Open in my calendar
      </a>
    );
  }
  return (
    <button type="button" disabled={pending} onClick={subscribe} className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold hover:bg-muted disabled:opacity-60">
      <CalendarPlus className="size-4" /> Add to my calendar
      {message && <span className="sr-only">{message}</span>}
    </button>
  );
}

/** The same control, compact, beside a child's header row in Everyone. */
function AddToCalendarSmall({ listId }: { listId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const subscribe = () =>
    startTransition(async () => {
      const r = await createCalendarToken(listId);
      if (!r.ok) return;
      setUrl(`webcal://${window.location.host}/api/plan/${r.token}.ics`);
      setDone(true);
      track("plan_calendar_feed_added", { everyone: true });
    });
  if (done && url) {
    return (
      <a href={url} className="ml-auto inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-[11px] font-semibold hover:bg-muted">
        <CalendarPlus className="size-3" /> Open
      </a>
    );
  }
  return (
    <button type="button" disabled={pending} onClick={subscribe} className="ml-auto inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-[11px] font-semibold hover:bg-muted disabled:opacity-60">
      <CalendarPlus className="size-3" /> Add to my calendar
    </button>
  );
}

function ComingUpForEvents({
  events,
  everyone,
  today,
  names,
  colorForAnyEvent,
  resolveCite,
}: {
  events: CalendarEvent[];
  everyone: boolean;
  today: string;
  names: Record<string, { name: string; colorSlot: 0 | 1 | 2 }>;
  colorForAnyEvent: (e: CalendarEvent) => string;
  resolveCite: (studentId: string) => (cite: CalendarCite) => { url: string } | null;
}) {
  return (
    <ComingUp
      events={events}
      everyone={everyone}
      today={today}
      names={names}
      colorFor={colorForAnyEvent}
      resolveCite={(cite) => {
        // A citation never names its own child here, so this is resolved per event instead: ComingUp calls back
        // with the mark's citation only, which is enough for a cycle-file link (no student needed) and, for a
        // college field, the student is found by trying every child's school map (each has its own PlanSchool
        // records, and a college id collides across children only in the rare case both apply to it, where either
        // resolves the same cited field anyway).
        if (!cite) return null;
        if (cite.kind === "link") return { url: cite.url };
        for (const studentId of Object.keys(names)) {
          const r = resolveCite(studentId)(cite);
          if (r) return r;
        }
        return null;
      }}
    />
  );
}

function Legend({ byChild, kids }: { byChild: boolean; kids: CalendarChild[] }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <span key={label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {swatch}
      {label}
    </span>
  );
  const bar = (c: string) => <span className="h-2.5 w-5 rounded-full" style={{ background: c }} />;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {byChild
        ? kids.map((c) => item(bar(KID_VARS[c.colorSlot]), c.name))
        : (["ed", "ed2", "ea", "rea", "rd"] as ListRound[]).map((r) => item(bar(ROUND_VAR[r]), ROUND_LABELS[r]))}
    </div>
  );
}
