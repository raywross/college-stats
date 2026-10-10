"use client";

import { Popover } from "@base-ui/react/popover";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { monthsOf, xPercent, type CalendarCite, type CalendarLane as CalendarLaneData, type CalendarMark, type YearRange } from "@/lib/planner/calendar";

/** A mark's color and whether it's drawn striped (ED II, REA), resolved by the caller from colorBy and round/kid. */
export interface MarkStyle {
  color: string;
  striped: boolean;
}

const stripe = (c: string): CSSProperties => ({ background: `repeating-linear-gradient(135deg, ${c} 0 6px, color-mix(in oklab, ${c} 55%, transparent) 6px 10px)` });

/**
 * One row of the family calendar (specs/planner/redesign/calendar.md "Lanes"): the label on the left, the marks
 * placed by date on the right over month gridlines and a today line. Every mark is a focusable button with a
 * tooltip on hover and focus, the same words as its `aria-label`, and its source citation reachable from the same
 * popover (a plain link for the cycle file, a college's own cited field for a deadline or decision).
 */
export function CalendarLane({
  lane,
  range,
  today,
  styleFor,
  resolveCite,
}: {
  lane: CalendarLaneData;
  range: YearRange;
  today: string;
  styleFor: (mark: CalendarMark) => MarkStyle;
  resolveCite: (cite: CalendarCite) => { url: string } | null;
}) {
  const months = monthsOf(range);
  const x = (iso: string) => xPercent(range, iso);
  return (
    <div className="grid grid-cols-[7rem_1fr] border-b last:border-b-0 sm:grid-cols-[11rem_1fr]">
      <div className="min-w-0 px-3 py-2 sm:px-4">
        <p className="truncate text-sm font-semibold">{lane.label}</p>
        {lane.sub && <p className="truncate text-[11px] text-muted-foreground">{lane.sub}</p>}
      </div>
      <div className="relative min-h-11" style={lane.rows && lane.rows > 1 ? { height: 12 + lane.rows * 24 } : undefined}>
        {months.map((m) => (
          <span key={m.iso} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${x(m.iso)}%` }} aria-hidden />
        ))}
        <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${x(today)}%` }} aria-hidden />
        {lane.note && (
          <p className="absolute inset-y-0 z-10 flex items-center pr-2 text-xs text-muted-foreground" style={{ left: `calc(${x(today)}% + 8px)` }}>
            {lane.note}
          </p>
        )}
        {lane.marks.map((m, i) => (
          <MarkView key={i} mark={m} x={x} style={styleFor(m)} source={resolveCite(m.cite)} />
        ))}
      </div>
    </div>
  );
}

/** A focusable mark with a tooltip on hover and focus (the same words as `aria-label`) and, when the date has a
 *  citation, a "Source" link reachable from that same popover. */
function Tip({ tip, source, className, style, children }: { tip: string; source: { url: string } | null; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={120}
        closeDelay={120}
        aria-label={tip}
        className={cn("absolute z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)}
        style={style}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} collisionPadding={8} className="z-50">
          <Popover.Popup className="max-w-64 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background shadow-lg">
            <p>{tip}</p>
            {source && (
              <a href={source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-normal underline">
                Where this date comes from
              </a>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MarkView({ mark: m, x, style, source }: { mark: CalendarMark; x: (iso: string) => number; style: MarkStyle; source: { url: string } | null }) {
  switch (m.kind) {
    case "bar":
      return (
        <Tip tip={m.tip} source={source} className="top-1/2 flex h-6 -translate-y-1/2 items-center overflow-hidden rounded-l-full pl-2 text-[11px] font-bold text-white" style={{ left: `${x(m.start)}%`, width: `${x(m.end) - x(m.start)}%`, ...(style.striped ? stripe(style.color) : { background: style.color }) }}>
          {m.label}
        </Tip>
      );
    case "window":
      return (
        <Tip tip={m.tip} source={source} className="flex h-5 items-center overflow-hidden rounded-full bg-muted px-2 text-[10px] font-semibold whitespace-nowrap text-muted-foreground ring-1 ring-border" style={{ left: `${x(m.start)}%`, width: `${x(m.end) - x(m.start)}%`, top: 6 + m.row * 24 }}>
          {m.label}
        </Tip>
      );
    case "deadline":
      return (
        <Tip tip={m.tip} source={source} className="top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ring-2 ring-card" style={{ left: `${x(m.date)}%`, background: style.color }} />
      );
    case "decision":
      return (
        <>
          <span className="absolute top-1/2 border-t-2 border-dashed" style={{ left: `${x(m.from)}%`, width: `${x(m.date) - x(m.from)}%`, borderColor: style.color }} aria-hidden />
          <Tip tip={m.tip} source={source} className="top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card" style={{ left: `${x(m.date)}%`, borderColor: style.color }} />
        </>
      );
    case "test":
      return (
        <Tip tip={m.tip} source={source} className={cn("top-1/2 -translate-x-1/2 -translate-y-1/2", m.past && "opacity-35")} style={{ left: `${x(m.date)}%`, width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderBottom: `14px solid ${style.color}` }} />
      );
    case "money":
      return (
        <Tip tip={m.tip} source={source} className="top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-card" style={{ left: `${x(m.date)}%`, background: style.color }}>
          $
        </Tip>
      );
  }
}

export default CalendarLane;
