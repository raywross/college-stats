/**
 * iCalendar (RFC 5545) text for the planner's calendar files (specs/planner/timeline.md "Display", actions.md): a
 * per-visit `.ics` download and the per-list feed. Pure strings, no dependencies: CRLF line endings, lines folded at
 * 75 octets, text escaped. All-day events use DATE values (the end is the next day, exclusive); timed events are
 * floating local times (no time zone), which every calendar shows at that clock time.
 *
 * The feed carries titles only ("Michigan: apply (ED I)"): callers never pass notes or personal numbers.
 */

export interface IcsEvent {
  /** Stable and unique per event (a task or visit id plus a domain): calendars update an event with the same uid. */
  uid: string;
  /** yyyy-mm-dd. */
  date: string;
  /** hh:mm or hh:mm:ss, local; omit for an all-day event. */
  time?: string | null;
  /** Length of a timed event in minutes (default 60); ignored for all-day events. */
  minutes?: number;
  /** For an all-day span (a window): the last day, yyyy-mm-dd, inclusive. */
  endDate?: string | null;
  summary: string;
  description?: string | null;
  url?: string | null;
  location?: string | null;
}

export interface IcsCalendarOptions {
  /** The calendar's display name (X-WR-CALNAME). */
  name: string;
  /** PRODID; defaults to the site's. */
  prodId?: string;
  /** DTSTAMP for every event (UTC, an ISO timestamp); defaults to now. Tests pin it. */
  stamp?: string;
}

/** Escapes TEXT values: backslash, semicolon, comma, and newlines. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets (UTF-8), continuation lines starting with one space; never splits a character. */
export function icsFold(line: string): string {
  const encoder = new TextEncoder();
  const bytes = (s: string) => encoder.encode(s).length;
  if (bytes(line) <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let limit = 75;
  for (const ch of line) {
    if (bytes(cur + ch) > limit) {
      parts.push(cur);
      cur = ch;
      limit = 74; // the leading space counts toward the next line's 75
    } else cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function localTime(date: string, time: string, plusMinutes = 0): string {
  const [h, m, s] = time.split(":").map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m + plusMinutes, s || 0);
  const iso = d.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}T${iso.slice(11, 19).replace(/:/g, "")}`;
}

/** One VEVENT block's lines (unfolded). */
export function icsEvent(e: IcsEvent, stamp: string = new Date().toISOString()): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${icsEscape(e.uid)}`, `DTSTAMP:${utcStamp(stamp)}`];
  if (e.time) {
    lines.push(`DTSTART:${localTime(e.date, e.time)}`, `DTEND:${localTime(e.date, e.time, e.minutes ?? 60)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(e.endDate ?? e.date))}`);
  }
  lines.push(`SUMMARY:${icsEscape(e.summary)}`);
  if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  return lines;
}

/** A whole calendar file: VCALENDAR around the events, folded, CRLF-terminated. */
export function icsCalendar(events: IcsEvent[], options: IcsCalendarOptions): string {
  const stamp = options.stamp ?? new Date().toISOString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${options.prodId ?? "-//Quad//Planner//EN"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(options.name)}`,
    ...events.flatMap((e) => icsEvent(e, stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
