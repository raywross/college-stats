"use client";
/**
 * One visit event line (specs/product/visit-events.md "Display"): day · time (the event's own zone, "All day" for an
 * all-day row) · title · venue, town · distance when the viewer has a measuring point · open/full/closed · Sign up ↗
 * (a real link, new tab) · Add to calendar. Phones: one row, Sign up at the right (specs/mobile.md).
 */
import { CalendarPlus, ExternalLink } from "lucide-react";
import { formatMiles } from "@/lib/home";
import { icsCalendar } from "@/lib/ics";
import { track } from "@/lib/analytics";
import type { VisitEventRow as VisitEventRowData } from "@/lib/visit-events/types";
import { localDateParts, timeLabel } from "@/lib/visit-events/view";

const AVAILABILITY_STYLE: Record<"open" | "full" | "closed", string> = {
  open: "bg-[--d-access]/15 text-[--d-access]",
  full: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};
const AVAILABILITY_LABEL: Record<"open" | "full" | "closed", string> = { open: "Open", full: "Full", closed: "Closed" };

function placeLine(event: VisitEventRowData): string | null {
  if (event.online) return "Online";
  const town = [event.city, event.state].filter(Boolean).join(", ");
  if (event.venue && town) return `${event.venue}, ${town}`;
  return event.venue || town || null;
}

function downloadIcs(event: VisitEventRowData, schoolName: string) {
  const { date, time } = localDateParts(event);
  const minutes = event.ends_at ? Math.max(15, Math.round((new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()) / 60000)) : 60;
  const ics = icsCalendar(
    [
      {
        uid: `visit-event-${event.id}`,
        date,
        time: event.all_day ? undefined : time,
        minutes,
        summary: `${schoolName}: ${event.title}`,
        description: event.description ?? undefined,
        url: event.book_url,
        location: placeLine(event) ?? undefined,
      },
    ],
    { name: `${schoolName} visits` },
  );
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.id.replace(/[^a-z0-9]+/gi, "-")}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function VisitEventRow({
  event,
  schoolName,
  distanceMiles,
  near = false,
}: {
  event: VisitEventRowData;
  schoolName: string;
  distanceMiles: number | null;
  /** Whether this row is shown as a "near you" result (visit_signup_clicked.near). */
  near?: boolean;
}) {
  if (event.kind === "staff") return null; // Never shown, even if a caller passes one through.
  const place = placeLine(event);

  return (
    <li className="flex items-center gap-3 border-b py-2.5 last:border-b-0 sm:py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span className="shrink-0 font-semibold tabular-nums">{timeLabel(event)}</span>
          <span className="min-w-0 truncate font-semibold">{event.title}</span>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {place && <span className="truncate">{place}</span>}
          {place && distanceMiles != null && <span aria-hidden>·</span>}
          {distanceMiles != null && <span className="shrink-0">{formatMiles(distanceMiles)}</span>}
          {event.availability && (
            <span className={`ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${AVAILABILITY_STYLE[event.availability]}`}>
              {AVAILABILITY_LABEL[event.availability]}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          title="Add to calendar"
          aria-label="Add to calendar"
          onClick={() => downloadIcs(event, schoolName)}
          className="inline-flex size-8 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CalendarPlus className="size-4" />
        </button>
        <a
          href={event.book_url}
          target="_blank"
          rel="noopener"
          onClick={() => track("visit_signup_clicked", { unit_id: event.unit_id, kind: event.kind, near })}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Sign up <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
    </li>
  );
}
