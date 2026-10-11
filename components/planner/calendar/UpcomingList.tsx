"use client";

/**
 * The 8-week dated list (specs/planner/redesign/calendar.md "Coming up"): the Calendar tab's default view ("tab":
 * full width with the date column) and the desktop plan's right-column card ("aside": compact, titled "Coming up",
 * with a "Full year" link). Both read the same dated groups from `lib/planner/calendar.ts` (`eventsFor` +
 * `upcomingDays`); the "tab" variant leaves its own "Coming up" heading and the 8-weeks/Full-year toggle to its
 * caller (FamilyCalendar), since the aside needs the heading but the tab doesn't (the toggle already carries it).
 */
import { useState } from "react";
import Link from "next/link";
import { BookMarked, Heart } from "lucide-react";
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";
import { roundsPicked } from "@/lib/planner/list-row";
import { daysBetween, eventsFor, laterSummary, monthLabel, upcomingDays, type CalendarCite, type CalendarEvent, type UpcomingDay } from "@/lib/planner/calendar";
import { MONEY_VAR, ROUND_VAR, TEST_VAR } from "@/lib/planner/colors";
import { ROUND_SHORT } from "@/lib/planner/rounds";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/** Beyond the 8-week window, "Show" re-groups everything this far out instead of paging (calendar.md "Coming up"). */
const SHOW_ALL_WEEKS = 520;

function resolveCite(ctx: PlanContext, cite: CalendarCite): { url: string } | null {
  if (!cite) return null;
  if (cite.kind === "link") return { url: cite.url };
  const cited = ctx.schools[cite.unitId]?.cites[cite.field] as { url?: string } | undefined;
  return cited?.url ? { url: cited.url } : null;
}

export function UpcomingList({
  ctx,
  view,
  studentId,
  variant,
  fullYearHref,
}: {
  ctx: PlanContext;
  view: PlanView;
  studentId: string;
  variant: "tab" | "aside";
  /** Where the aside's "Full year" link goes (the Calendar tab's full-year view). */
  fullYearHref?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const today = ctx.today;
  // Before senior year no round is picked yet (list.md "Round picked senior year"), so the starting rounds' college
  // dates stay off the list; tests, money dates, and tasks still show.
  const events = eventsFor(ctx, view, today, studentId).filter((e) => roundsPicked(ctx.grade) || e.round === undefined);
  const days = upcomingDays(events, today, expanded ? SHOW_ALL_WEEKS : 8);
  const later = variant === "tab" && !expanded ? laterSummary(events, today, 8) : null;

  if (variant === "aside") {
    return (
      <section className="rounded-3xl border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Coming up</h2>
          {fullYearHref && (
            <Link href={fullYearHref} className="text-xs font-semibold text-primary hover:underline">
              Full year
            </Link>
          )}
        </div>
        {days.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing dated yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {days.map((d) => (
              <DayCard key={d.date} ctx={ctx} day={d} today={today} compact />
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-3">
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing dated in the next 8 weeks.</p>
      ) : (
        <ul className="space-y-3">
          {days.map((d) => (
            <DayCard key={d.date} ctx={ctx} day={d} today={today} compact={false} />
          ))}
        </ul>
      )}
      {later && (
        <p className="text-sm text-muted-foreground">
          Then {later.count} in {later.month} ·{" "}
          <button type="button" onClick={() => setExpanded(true)} className="font-semibold text-primary hover:underline">
            Show
          </button>
        </p>
      )}
    </div>
  );
}

/** One date's card: the date column (weekday or "BY" for a money/task due-by date, the day, the month) and a card
 *  listing that date's items, with a lime "In N days" tag within a week (the full "tab" view only — the aside stays
 *  quiet so it reads calmly beside Next up). */
function DayCard({ ctx, day, today, compact }: { ctx: PlanContext; day: UpcomingDay; today: string; compact: boolean }) {
  const inDays = daysBetween(today, day.date);
  // A date that's only money/task markers reads as a soft "by" deadline, not a fixed-day event (calendar.md "Lanes" 3).
  const dueBy = day.events.every((e) => e.shape === "money");
  const weekday = dueBy ? "BY" : WEEKDAYS[new Date(`${day.date}T00:00:00Z`).getUTCDay()];
  const dayNum = Number(day.date.slice(8, 10));
  const month = monthLabel(Number(day.date.slice(5, 7)) - 1);

  return (
    <li className="flex gap-3">
      <div className="w-10 shrink-0 text-center sm:w-12">
        <p className="text-[10px] font-semibold text-muted-foreground sm:text-[11px]">{weekday}</p>
        <p className="font-display text-xl leading-none font-extrabold sm:text-2xl">{dayNum}</p>
        <p className="text-[10px] text-muted-foreground sm:text-[11px]">{month}</p>
      </div>
      <div className={cn("min-w-0 flex-1 rounded-3xl border bg-card", compact ? "p-2.5" : "p-3")}>
        {!compact && inDays <= 7 && (
          <span className="mb-2 inline-flex rounded-full bg-pop px-2 py-0.5 text-[11px] font-bold text-pop-foreground">
            {inDays === 0 ? "Today" : `In ${inDays} day${inDays === 1 ? "" : "s"}`}
          </span>
        )}
        <ul className="divide-y">
          {day.events.map((e, i) => (
            <EventLine key={i} ctx={ctx} event={e} />
          ))}
        </ul>
      </div>
    </li>
  );
}

function EventLine({ ctx, event }: { ctx: PlanContext; event: CalendarEvent }) {
  const source = resolveCite(ctx, event.cite);
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm first:pt-0 last:pb-0">
      <span className="flex min-w-0 items-center gap-2">
        <Marker event={event} />
        <span className="truncate font-semibold">{event.label ?? event.text}</span>
        {event.dream && <Heart className="size-3.5 shrink-0 fill-rose-500 text-rose-500" aria-hidden />}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {event.shape === "decision" ? (
          <span className="font-semibold text-foreground">Decision</span>
        ) : (
          event.round && <span className="font-semibold text-foreground">{ROUND_SHORT[event.round]}</span>
        )}
        {source && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Where the ${event.label ?? event.text} date comes from`}
            className="text-muted-foreground hover:text-primary"
          >
            <BookMarked className="size-3.5" aria-hidden />
          </a>
        )}
      </span>
    </li>
  );
}

function Marker({ event }: { event: CalendarEvent }) {
  if (event.shape === "money") return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: MONEY_VAR }} aria-hidden />;
  if (event.shape === "decision") {
    return <span className="inline-block size-2.5 shrink-0 rounded-full border-2" style={{ borderColor: event.round ? ROUND_VAR[event.round] : TEST_VAR }} aria-hidden />;
  }
  const color = event.round ? ROUND_VAR[event.round] : TEST_VAR;
  return <span className="inline-block size-2.5 shrink-0 rotate-45" style={{ background: color }} aria-hidden />;
}

export default UpcomingList;
