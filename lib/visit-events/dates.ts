/**
 * Dates and times of visit events (specs/product/visit-events.md, "How Slate publishes"). Slate's standard search
 * prints a date with no year ("Wednesday, October 21 at 9:00 AM"); the event page prints the full date, the end time,
 * and the zone ("Wednesday, October 28, 2026 at 6:30 PM until 7:30 PM Eastern Daylight Time UTC -04:00"). The reader
 * (scripts/lib/visit-events/) turns both into a local ISO time plus a zone and stores the instant; the pages and the
 * alert email print it back in the event's own zone with `formatEventWhen`. Pure: no Node or Next.js import, so
 * scripts, server code, and tests all load it.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "9:00 AM" → [9, 0]; "12:30 PM" → [12, 30]; "12:05 AM" → [0, 5]. */
function clock(h: string, m: string, ampm: string): [number, number] {
  const hour = (Number(h) % 12) + (/p/i.test(ampm) ? 12 : 0);
  return [hour, Number(m)];
}

/** Day of the week (0 = Sunday) of a calendar date, independent of the machine's zone. */
function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface SearchWhen {
  /** Local wall-clock time, "2026-10-21T09:00:00" (midnight for an all-day event). */
  iso: string;
  allDay: boolean;
}

/**
 * The standard search's "Wednesday, October 21 at 9:00 AM" (or "Wednesday, October 14" for an all-day event) as a
 * local time. The page gives no year, so the year rule places the date in the twelve months starting yesterday,
 * relative to `now`: run in October–December, October–December dates are this year and January–September dates the
 * next (the brief's rule); run on 2 January, every date lands in the new year. When the printed weekday names a
 * different year among last, this, and next (a date just past), the weekday wins. The row stays
 * `date_confirmed = false` until the event page confirms the year. Null when the text isn't a date.
 */
export function parseSearchWhen(text: string, now: Date): SearchWhen | null {
  const m = /^\s*(?:([A-Za-z]+),\s+)?([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M))?/i.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  const day = Number(m[3]);
  if (month < 1 || day < 1 || day > 31) return null;
  let year: number;
  if (m[4]) year = Number(m[4]);
  else {
    // Today as the run's calendar date (UTC is close enough: the slack day covers an evening run in the Americas).
    const ty = now.getUTCFullYear();
    const yesterday = Date.UTC(ty, now.getUTCMonth(), now.getUTCDate() - 1);
    const candidates = [ty - 1, ty, ty + 1].filter((y) => Date.UTC(y, month - 1, day) >= yesterday);
    year = candidates[0];
    const named = m[1] ? WEEKDAYS.indexOf(m[1].toLowerCase()) : -1;
    if (named >= 0 && weekday(year, month, day) !== named) {
      const match = [ty - 1, ty, ty + 1].find((y) => weekday(y, month, day) === named);
      if (match !== undefined) year = match;
    }
  }
  const [hour, minute] = m[5] ? clock(m[5], m[6], m[7]) : [0, 0];
  return { iso: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`, allDay: !m[5] };
}

/** Windows-style zone names Slate prints on the event page → IANA zones. */
const ZONES: Record<string, string> = {
  eastern: "America/New_York",
  central: "America/Chicago",
  mountain: "America/Denver",
  pacific: "America/Los_Angeles",
  alaska: "America/Anchorage",
  alaskan: "America/Anchorage",
  hawaii: "Pacific/Honolulu",
  hawaiian: "Pacific/Honolulu",
  "hawaii-aleutian": "Pacific/Honolulu",
  atlantic: "America/Puerto_Rico",
  "us mountain": "America/Phoenix",
  arizona: "America/Phoenix",
};

/** "Eastern Daylight Time" → "America/New_York"; standard and daylight names alike; unknown → null. */
export function zoneFor(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /^\s*(.+?)(?:\s+(?:standard|daylight|summer))?\s+time\s*$/i.exec(name.trim());
  const key = (m ? m[1] : name).trim().toLowerCase();
  return ZONES[key] ?? null;
}

/** The zone most of a state keeps, for a search row whose event page hasn't been read (a guess, never stored as the zone). */
const STATE_ZONES: Record<string, string> = {
  AK: "America/Anchorage", AZ: "America/Phoenix", CA: "America/Los_Angeles", CO: "America/Denver", HI: "Pacific/Honolulu",
  ID: "America/Boise", MT: "America/Denver", NM: "America/Denver", NV: "America/Los_Angeles", OR: "America/Los_Angeles",
  UT: "America/Denver", WA: "America/Los_Angeles", WY: "America/Denver", PR: "America/Puerto_Rico",
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago", IL: "America/Chicago", KS: "America/Chicago",
  LA: "America/Chicago", MN: "America/Chicago", MO: "America/Chicago", MS: "America/Chicago", ND: "America/Chicago",
  NE: "America/Chicago", OK: "America/Chicago", SD: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
};

/** The zone to read a state's local times in until an event page says otherwise: the table above, else Eastern. */
export function zoneForState(state: string | null | undefined): string {
  return (state && STATE_ZONES[state.toUpperCase()]) || "America/New_York";
}

export interface EventPageWhen {
  /** Local start, "2026-10-28T18:30:00" (midnight for an all-day event). */
  start: string;
  /** Local end, or null when the page gives none. */
  end: string | null;
  /** IANA zone from the page's zone name, or null when it names none we know. */
  zone: string | null;
  /** The page's own offset at the start, "-04:00", or null when it prints none. */
  offset: string | null;
  allDay: boolean;
}

/**
 * The event page's date line: "Wednesday, October 28, 2026 at 6:30 PM until 7:30 PM Eastern Daylight Time UTC
 * -04:00", "… at 8:00 AM until 5:00 PM …", "Wednesday, October 28, 2026 at 6:30 PM until Thursday, October 29, 2026
 * at 1:00 PM …", or a date alone (all day, perhaps "until" another date). Null when no full date is found.
 */
export function parseEventPageWhen(text: string): EventPageWhen | null {
  const t = text.replace(/\s+/g, " ").trim();
  const date = /(?:[A-Za-z]+,\s+)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M))?/i;
  const s = date.exec(t);
  if (!s) return null;
  const month = MONTHS.indexOf(s[1].toLowerCase()) + 1;
  if (month < 1) return null;
  const y = Number(s[3]);
  const d = Number(s[2]);
  const [h, mi] = s[4] ? clock(s[4], s[5], s[6]) : [0, 0];
  const start = `${y}-${pad(month)}-${pad(d)}T${pad(h)}:${pad(mi)}:00`;
  const rest = t.slice(s.index + s[0].length);
  let end: string | null = null;
  const until = /^\s*until\s+(.*)$/i.exec(rest);
  if (until) {
    const e = date.exec(until[1]);
    const timeOnly = /^(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(until[1]);
    if (e && e.index === 0) {
      const em = MONTHS.indexOf(e[1].toLowerCase()) + 1;
      const [eh, emi] = e[4] ? clock(e[4], e[5], e[6]) : [0, 0];
      if (em > 0) end = `${e[3]}-${pad(em)}-${pad(Number(e[2]))}T${pad(eh)}:${pad(emi)}:00`;
    } else if (timeOnly) {
      const [eh, emi] = clock(timeOnly[1], timeOnly[2], timeOnly[3]);
      end = `${y}-${pad(month)}-${pad(d)}T${pad(eh)}:${pad(emi)}:00`;
    }
  }
  // The zone name follows the last time: words before "Time", never the "PM" of the clock.
  const zoneName = /\b((?:(?!AM\b|PM\b)[A-Z][A-Za-z-]+\s+){1,3}Time)\b/.exec(rest.replace(/\d{1,2}:\d{2}\s*[AP]M/gi, " "));
  const off = /UTC\s*([+-−])\s*(\d{1,2}):?(\d{2})/.exec(rest);
  const offset = off ? `${off[1] === "+" ? "+" : "-"}${pad(Number(off[2]))}:${off[3]}` : null;
  let zone = zoneFor(zoneName?.[1]);
  // Arizona prints "Mountain Standard Time" all summer: a standard name at -07:00 in a daylight month is Phoenix.
  if (zone === "America/Denver" && /standard/i.test(zoneName?.[1] ?? "") && offset === "-07:00" && month >= 4 && month <= 10) zone = "America/Phoenix";
  return { start, end, zone, offset, allDay: !s[4] };
}

/** Offset of `zone` at the instant `utcMs`, in minutes east of UTC (New York in October: -240). */
export function zoneOffsetMinutes(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/**
 * A local wall-clock time as a UTC ISO instant, for `starts_at`: `offsetOrZone` is "-04:00" (the page's own offset,
 * used as printed) or an IANA zone ("America/New_York", resolved for that date, daylight saving included).
 */
export function toInstant(localIso: string, offsetOrZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(localIso);
  if (!m) throw new Error(`not a local time: ${localIso}`);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  const off = /^([+-])(\d{2}):?(\d{2})$/.exec(offsetOrZone);
  if (off) {
    const minutes = (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3]));
    return new Date(wall - minutes * 60_000).toISOString();
  }
  // Guess with the offset at the wall time read as UTC, then correct once for a DST change between the two.
  let utc = wall - zoneOffsetMinutes(offsetOrZone, wall) * 60_000;
  utc = wall - zoneOffsetMinutes(offsetOrZone, utc) * 60_000;
  return new Date(utc).toISOString();
}

/** A stored instant back as the local wall-clock time in `zone`, "2026-10-28T18:30:00". */
export function localIsoIn(instant: string, zone: string): string {
  const ms = Date.parse(instant);
  const shifted = new Date(ms + zoneOffsetMinutes(zone, ms) * 60_000);
  return shifted.toISOString().slice(0, 19);
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * How a page or the alert email prints an event's start: "Mon 19 Oct · 11:40 am" in the event's own zone (the stored
 * `timezone`; before the page is read, the state's usual zone), "Mon 19 Oct · all day" for an all-day event.
 */
export function formatEventWhen(row: { starts_at: string; timezone: string | null; all_day: boolean; state?: string | null }): string {
  const zone = row.timezone ?? zoneForState(row.state);
  const local = localIsoIn(row.starts_at, zone);
  const [y, mo, d] = local.slice(0, 10).split("-").map(Number);
  const day = `${SHORT_DAYS[weekday(y, mo, d)]} ${d} ${SHORT_MONTHS[mo - 1]}`;
  if (row.all_day) return `${day} · all day`;
  const h = Number(local.slice(11, 13));
  const min = local.slice(14, 16);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} · ${h12}:${min} ${h < 12 ? "am" : "pm"}`;
}
