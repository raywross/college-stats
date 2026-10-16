/**
 * Act tracking, the pure parts (specs/planner/v3/guides/show-interest.md "Tracking what they did: the honest
 * version"; build-plan.md "Act tracking", review notes 11 and 12). A click on a guide's act button records a pending
 * act; the return prompt, the next-morning email, or the guide's own Pending line confirms or declines it; a pending
 * act that outlives its window expires. Nothing here reads or writes: the store (lib/planner/store-interest.ts), the
 * server writer (lib/planner/interest-acts-server.ts), the email, the cron, and the guide all call these.
 *
 * The state machine: pending → confirmed | declined | expired, once. A resolved act never changes again (the token
 * resolves once; the prompt asks once, `prompted_at`). Only a confirmed act writes anything the calendar, the hooks,
 * or a parent can see, and it writes it through the built stores (visits, `info_requested_on`, `followed_networks`).
 *
 * Event times: the table keeps `event_starts_at` as an instant, not the event's own zone, so every function that
 * prints a date or time takes the zone (`visit_events.timezone`, read by the caller); without one it prints the day
 * in UTC and no time, rather than a wrong clock time.
 */
import { SOCIAL_LABELS } from "../social.ts";
import type { VisitEventKind } from "../visit-events/types.ts";
import type { VisitKind } from "./types.ts";
import { ACT_RESOLVED_VIA, ACT_STATUSES, INTEREST_ACTS, type ActResolvedVia, type ActStatus, type InterestAct, type InterestActRow } from "./interest-acts-types.ts";

export { ACT_RESOLVED_VIA, ACT_STATUSES, INTEREST_ACTS };
export type { ActResolvedVia, ActStatus, InterestAct, InterestActRow };

/** The return prompt asks about an act clicked under this long ago (review note 12). */
export const PROMPT_WINDOW_MS = 5 * 60_000;
/** A dated act expires this many days after its event. */
export const EVENT_GRACE_DAYS = 7;
/** An undated act expires this many days after the click. */
export const UNDATED_DAYS = 14;

const DAY_MS = 86_400_000;

/** The columns every read of the table selects (in step with the migration; tests hold it to `InterestActRow`). */
export const INTEREST_ACT_COLUMNS =
  "id, item_id, user_id, act, network, url, event_id, event_starts_at, event_place, event_title, clicked_at, prompted_at, emailed_at, status, resolved_at, resolved_via, visit_id, confirm_token";

/** The acts that become a `plan_visits` row when confirmed. */
export const VISIT_ACTS: readonly InterestAct[] = ["tour", "info_session", "open_house", "fair", "event"];
export const isVisitAct = (act: InterestAct): boolean => VISIT_ACTS.includes(act);

export function isInterestAct(v: unknown): v is InterestAct {
  return typeof v === "string" && (INTEREST_ACTS as readonly string[]).includes(v);
}

/** The email's token: two UUIDs without dashes (the migration's default). */
export function isActToken(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

const ACT_LABELS: Record<Exclude<InterestAct, "event">, string> = {
  tour: "tour",
  info_session: "information session",
  open_house: "open house",
  fair: "college fair",
  info_request: "information request",
  mailing_list: "mailing list",
  follow: "follow",
  test_register: "SAT/ACT registration",
};

/** What an act is called in a sentence: "tour", "information session", …; a named event is its own title. */
export function actLabel(act: InterestAct, eventTitle?: string | null): string {
  if (act === "event") return eventTitle?.trim() || "event";
  return ACT_LABELS[act];
}

/** The act an event's Register button records (lib/visit-events/kinds.ts' kinds). */
export function actForEvent(kind: VisitEventKind): InterestAct {
  switch (kind) {
    case "tour":
      return "tour";
    case "info_session":
      return "info_session";
    case "open_house":
      return "open_house";
    case "travel":
      return "fair";
    default:
      return "event";
  }
}

/** The visit kind a confirmed act logs (the act → kind map; `planVisitKind` agrees for every event kind). */
export function visitKindForAct(act: InterestAct, eventPlace: string | null): VisitKind {
  switch (act) {
    case "tour":
      return "campus_tour";
    case "info_session":
      return "info_session";
    case "open_house":
      return "open_house";
    case "fair":
      return "fair";
    default:
      return eventPlace === "Online" ? "virtual" : "other";
  }
}

/** The test a `test_register` act is for, from its title or its test-date key (`sat_2026_11`); never anything else. */
export function testOf(row: Pick<InterestActRow, "event_title" | "event_id">): "SAT" | "ACT" | null {
  const title = row.event_title?.trim().toUpperCase();
  if (title === "SAT" || title === "ACT") return title;
  const key = row.event_id ?? "";
  if (/^sat_\d{4}_\d{2}$/.test(key)) return "SAT";
  if (/^act_\d{4}_\d{2}$/.test(key)) return "ACT";
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The event's wall-clock date and time in its zone: { date: "2026-11-03", time: "10:00" }; time null without a zone. */
export function localParts(iso: string, timeZone: string | null | undefined): { date: string; time: string | null } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { date: iso.slice(0, 10), time: null };
  if (!timeZone) return { date: at.toISOString().slice(0, 10), time: null };
  try {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
    return { date, time };
  } catch {
    return { date: at.toISOString().slice(0, 10), time: null };
  }
}

/** "Nov 3" from "2026-11-03". */
export function shortDate(isoDay: string): string {
  return `${MONTHS[Number(isoDay.slice(5, 7)) - 1]} ${Number(isoDay.slice(8, 10))}`;
}

/** "10 AM", "7:30 PM" from "10:00", "19:30". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}

/** "Nov 3 at 10 AM", "Nov 3" (all day or no zone), or null for an undated act. */
export function whenLabel(row: Pick<InterestActRow, "event_starts_at">, timeZone?: string | null, opts: { time?: boolean } = {}): string | null {
  if (!row.event_starts_at) return null;
  const { date, time } = localParts(row.event_starts_at, timeZone);
  const withTime = opts.time !== false && time !== null;
  return withTime ? `${shortDate(date)} at ${clockLabel(time)}` : shortDate(date);
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/**
 * The return prompt's one question (spec "The return prompt"): "Did you register for Duke's tour on Nov 3 at 10 AM?";
 * "Following Elon on Instagram?"; an undated visit act asks whether they booked one (the date comes next).
 */
export function promptQuestion(row: Pick<InterestActRow, "act" | "network" | "event_starts_at" | "event_title" | "event_id">, collegeName: string | null, timeZone?: string | null): string {
  const college = collegeName?.trim() || "the college";
  const when = whenLabel(row, timeZone);
  switch (row.act) {
    case "follow":
      return `Following ${college}${row.network ? ` on ${SOCIAL_LABELS[row.network]}` : ""}?`;
    case "info_request":
      return `Did you request information from ${college}?`;
    case "mailing_list":
      return `Did you join ${possessive(college)} mailing list?`;
    case "test_register": {
      const test = testOf(row) ?? "test";
      return `Did you register for the ${test}${when ? ` on ${when}` : ""}?`;
    }
    default: {
      const what = actLabel(row.act, row.event_title);
      return when ? `Did you register for ${possessive(college)} ${what} on ${when}?` : `Did you book a ${what} at ${college}?`;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Time: expiry and the prompt window                                  */
/* ------------------------------------------------------------------ */

/** When a pending act expires: the event's date + 7 days, else the click + 14 days (spec "A pending act that reaches …"). */
export function expiresAt(row: Pick<InterestActRow, "clicked_at" | "event_starts_at">): string {
  const base = row.event_starts_at ? Date.parse(row.event_starts_at) : Date.parse(row.clicked_at);
  const days = row.event_starts_at ? EVENT_GRACE_DAYS : UNDATED_DAYS;
  return new Date(base + days * DAY_MS).toISOString();
}

/** Whether a still-pending act is past its window on `now`. A resolved act is never "expired" by this. */
export function isExpired(row: Pick<InterestActRow, "status" | "clicked_at" | "event_starts_at">, now: Date): boolean {
  return row.status === "pending" && Date.parse(expiresAt(row)) <= now.getTime();
}

/** The act the return prompt asks about: the newest pending act not yet asked about, clicked under PROMPT_WINDOW_MS ago. */
export function pendingForPrompt<T extends Pick<InterestActRow, "status" | "prompted_at" | "clicked_at">>(rows: readonly T[], now: Date): T | null {
  const t = now.getTime();
  const open = rows.filter((r) => {
    if (r.status !== "pending" || r.prompted_at !== null) return false;
    const age = t - Date.parse(r.clicked_at);
    return age >= 0 && age < PROMPT_WINDOW_MS;
  });
  open.sort((a, b) => b.clicked_at.localeCompare(a.clicked_at));
  return open[0] ?? null;
}

/**
 * The key that makes two acts "the same act" for deduping (QA finding 3): same item (or item-less), same act, same
 * event (or no event), and — a follow's only way to tell two pending rows apart, since it has no event — the same
 * network. `recordAct` reuses a pending row sharing this key instead of inserting a second one; `coalesceByKey`
 * collapses any that slipped through anyway (a legacy duplicate, or two tabs racing) to the newest.
 */
export function actKey(row: Pick<InterestActRow, "item_id" | "act" | "event_id" | "network">): string {
  return [row.item_id ?? "", row.act, row.event_id ?? "", row.act === "follow" ? row.network ?? "" : ""].join("\u0000");
}

/** Keeps the newest row per `actKey` (defensive: the page and the email both coalesce, even if a duplicate exists). */
export function coalesceByKey<T extends Pick<InterestActRow, "item_id" | "act" | "event_id" | "network" | "clicked_at">>(rows: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const key = actKey(r);
    const prev = byKey.get(key);
    if (!prev || r.clicked_at > prev.clicked_at) byKey.set(key, r);
  }
  return [...byKey.values()];
}

/** The pending acts a page shows ("Pending: did you register …"), newest first, without the expired ones, and with
 * any duplicate row for the same act (clicked twice before the first was answered) coalesced to the newest. */
export function visiblePending<T extends Pick<InterestActRow, "status" | "clicked_at" | "event_starts_at" | "item_id" | "act" | "event_id" | "network">>(
  rows: readonly T[],
  now: Date,
): T[] {
  const live = rows.filter((r) => r.status === "pending" && !isExpired(r, now));
  return coalesceByKey(live).sort((a, b) => b.clicked_at.localeCompare(a.clicked_at));
}

/* ------------------------------------------------------------------ */
/* Resolving                                                           */
/* ------------------------------------------------------------------ */

export type ActAnswer = "confirmed" | "declined";

/** The row's patch for an answer, or null when the act is no longer pending (a token or a prompt resolves once). */
export function resolutionPatch(row: Pick<InterestActRow, "status">, answer: ActAnswer, via: ActResolvedVia, now: Date): { status: ActAnswer; resolved_at: string; resolved_via: ActResolvedVia } | null {
  if (row.status !== "pending") return null;
  return { status: answer, resolved_at: now.toISOString(), resolved_via: via };
}

export interface ConfirmedVisit {
  kind: VisitKind;
  onDate: string;
  atTime: string | null;
  registered: true;
  registrationUrl: string;
  notesFree: string | null;
}

/**
 * The visit a confirmed visit act logs: the mapped kind, the event's own date and time (or the date the family
 * picked), registered with the URL that was opened, and the title and venue in the notes. Null when there is no date
 * at all (an undated act confirmed without one: the caller asks for it).
 */
export function visitFromAct(
  row: Pick<InterestActRow, "act" | "url" | "event_starts_at" | "event_place" | "event_title">,
  extra: { visitDate?: string | null; visitTime?: string | null; kind?: VisitKind | null } = {},
  timeZone?: string | null,
): ConfirmedVisit | null {
  const parts = row.event_starts_at ? localParts(row.event_starts_at, timeZone) : null;
  const onDate = extra.visitDate || parts?.date || null;
  if (!onDate || !/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return null;
  const atTime = extra.visitDate ? (extra.visitTime ?? null) : (extra.visitTime ?? parts?.time ?? null);
  const notes = [row.event_title, row.event_place].map((s) => s?.trim()).filter((s): s is string => Boolean(s));
  return {
    kind: extra.kind ?? visitKindForAct(row.act, row.event_place),
    onDate,
    atTime: atTime || null,
    registered: true,
    registrationUrl: row.url,
    notesFree: notes.length ? notes.join(", ").slice(0, 2000) : null,
  };
}

/* ------------------------------------------------------------------ */
/* The morning email's selection                                       */
/* ------------------------------------------------------------------ */

/** Midnight UTC of `now`'s day: acts clicked before it are "since yesterday or earlier". */
export function startOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Who gets the morning email and about what (spec "The confirmation email"): every act still pending, not yet asked
 * by email, clicked before today (UTC), and not past its window, grouped by person, each person's acts newest first.
 */
export function selectForEmail<T extends Pick<InterestActRow, "user_id" | "status" | "emailed_at" | "clicked_at" | "event_starts_at">>(rows: readonly T[], now: Date): Map<string, T[]> {
  const cutoff = startOfUtcDay(now);
  const out = new Map<string, T[]>();
  for (const r of rows) {
    if (r.status !== "pending" || r.emailed_at !== null || r.clicked_at >= cutoff || isExpired(r, now)) continue;
    out.set(r.user_id, [...(out.get(r.user_id) ?? []), r]);
  }
  for (const list of out.values()) list.sort((a, b) => b.clicked_at.localeCompare(a.clicked_at));
  return out;
}

/** The email's one-click link: `/api/plan/interest/confirm?token=…&answer=yes|no`. */
export function confirmUrl(siteUrl: string, token: string, answer: "yes" | "no"): string {
  return `${siteUrl.replace(/\/$/, "")}/api/plan/interest/confirm?token=${encodeURIComponent(token)}&answer=${answer}`;
}
