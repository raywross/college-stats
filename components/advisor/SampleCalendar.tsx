"use client";

/**
 * One month of the sample student's calendar: the real `CalendarLane` (components/planner/CalendarLane.tsx) for every
 * lane, with the plan's own colors (`ROUND_VAR`, `STRIPED`, `TEST_VAR`, `VISIT_VAR`) and citations, under a header of
 * week ticks in place of `FamilyCalendar`'s twelve months (one month fits a phone without sideways scroll). A client
 * component only because `CalendarLane` takes its color and citation lookups as functions. The text bubble below it is
 * the reminder the advisor sends the day before.
 */
import { MessageCircle } from "lucide-react";
import { CalendarLane, type MarkStyle } from "@/components/planner/CalendarLane";
import { ROUND_VAR, STRIPED, TEST_VAR, VISIT_VAR, MONEY_VAR } from "@/lib/planner/colors";
import { xPercent, type CalendarCite, type CalendarMark } from "@/lib/planner/calendar";
import type { SampleCalendar as SampleCalendarData } from "./sample";

function styleFor(m: CalendarMark): MarkStyle {
  switch (m.kind) {
    case "bar":
    case "deadline":
    case "decision":
      return { color: ROUND_VAR[m.round], striped: STRIPED.has(m.round) };
    case "test":
      return { color: TEST_VAR, striped: false };
    case "visit":
      return { color: VISIT_VAR, striped: false };
    case "money":
      return { color: MONEY_VAR, striped: false };
    default:
      return { color: "var(--muted-foreground)", striped: false };
  }
}

export function SampleCalendar({ calendar }: { calendar: SampleCalendarData }) {
  const resolveCite = (c: CalendarCite): { url: string } | null => (!c ? null : c.kind === "link" ? { url: c.url } : (calendar.cites[`${c.unitId}:${c.field}`] ?? null));
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-3xl border bg-card" aria-label={`${calendar.monthLabel} on the calendar`}>
        <div className="grid grid-cols-[7rem_1fr] border-b bg-card sm:grid-cols-[11rem_1fr]">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground sm:px-4">{calendar.monthLabel}</div>
          <div className="relative h-8" aria-hidden>
            {calendar.ticks.map((t) => (
              <span key={t.iso} className="absolute top-2 text-[11px] font-semibold whitespace-nowrap text-muted-foreground" style={{ left: `calc(${Math.min(xPercent(calendar.range, t.iso), 88)}% + 2px)` }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
        {calendar.lanes.map((lane) => (
          <CalendarLane key={lane.key} lane={lane} range={calendar.range} today={calendar.today} styleFor={styleFor} resolveCite={resolveCite} />
        ))}
      </section>
      {calendar.bubble && (
        <div className="splash-pop flex animate-pop-in items-end gap-2 [animation-delay:350ms]">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
            <MessageCircle className="size-4" />
          </span>
          <p className="max-w-xs rounded-2xl rounded-bl-sm bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-md">
            <span className="block text-[11px] font-semibold opacity-80">Text from Quad</span>
            {calendar.bubble}
          </p>
        </div>
      )}
    </div>
  );
}
