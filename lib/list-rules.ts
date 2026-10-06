/**
 * Saved lists, pure parts (specs/product/saved-lists.md): the shapes the rows in
 * supabase/migrations/20261005150000_lists.sql take, status/outcome transitions, the balance line, deadline
 * resolution, and CSV export/import (Scoir-compatible columns). No server or browser APIs, so tests, server code
 * (lib/lists.ts), and client components can all import it.
 */

export type ListCategory = "reach" | "target" | "likely" | "unsorted";
export type ListStatus = "considering" | "applying" | "applied" | "decided";
export type ListOutcome = "admitted" | "denied" | "waitlisted" | "deferred";
export type ListRound = "ed" | "ed2" | "ea" | "rea" | "rd" | "rolling";

export const LIST_CATEGORIES: ListCategory[] = ["reach", "target", "likely", "unsorted"];
export const LIST_STATUSES: ListStatus[] = ["considering", "applying", "applied", "decided"];
export const LIST_OUTCOMES: ListOutcome[] = ["admitted", "denied", "waitlisted", "deferred"];
export const LIST_ROUNDS: ListRound[] = ["ed", "ed2", "ea", "rea", "rd", "rolling"];

export const CATEGORY_LABELS: Record<ListCategory, string> = {
  reach: "Reach",
  target: "Target",
  likely: "Likely",
  unsorted: "Unsorted",
};

export const STATUS_LABELS: Record<ListStatus, string> = {
  considering: "Considering",
  applying: "Applying",
  applied: "Applied",
  decided: "Decided",
};

export const OUTCOME_LABELS: Record<ListOutcome, string> = {
  admitted: "Admitted",
  denied: "Denied",
  waitlisted: "Waitlisted",
  deferred: "Deferred",
};

export const ROUND_LABELS: Record<ListRound, string> = {
  ed: "Early decision",
  ed2: "Early decision II",
  ea: "Early action",
  rea: "Restrictive early action",
  rd: "Regular decision",
  rolling: "Rolling",
};

export function isListCategory(v: unknown): v is ListCategory {
  return typeof v === "string" && (LIST_CATEGORIES as string[]).includes(v);
}
export function isListStatus(v: unknown): v is ListStatus {
  return typeof v === "string" && (LIST_STATUSES as string[]).includes(v);
}
export function isListOutcome(v: unknown): v is ListOutcome {
  return typeof v === "string" && (LIST_OUTCOMES as string[]).includes(v);
}
export function isListRound(v: unknown): v is ListRound {
  return typeof v === "string" && (LIST_ROUNDS as string[]).includes(v);
}

export interface ListItem {
  id: string;
  list_id: string;
  unit_id: string;
  category: ListCategory;
  status: ListStatus;
  outcome: ListOutcome | null;
  round: ListRound | null;
  position: number;
  added_by: string | null;
  added_at: string;
  decision_date: string | null;
  deadline_text: string | null;
  deadline_date: string | null;
  enrolling: boolean;
  /** "Tell me when this college's numbers change": the follows trigger keeps the owner's follow in step (default on). */
  updates: boolean;
  /** The day they visited, or null. */
  visited_on: string | null;
  /** They say they follow the college on social media. */
  follows_social: boolean;
}

/**
 * Whose list (20261006150000_household_hub.sql): a student record's, or a user's own (a guardian, who has no student
 * record). Exactly one is set on every list.
 */
export type ListOwner = { kind: "student"; id: string } | { kind: "user"; id: string };

export interface ListRecord {
  id: string;
  /** Set for a student's list. */
  student_id: string | null;
  /** Set for a user's own list (a guardian's). */
  user_id: string | null;
  name: string;
  is_default: boolean;
  share_enabled: boolean;
  created_by: string | null;
  created: string;
}

export interface ListNote {
  id: string;
  item_id: string;
  author_id: string;
  body: string;
  private: boolean;
  created: string;
}

/* ------------------------------------------------------------------ */
/* Status transitions                                                  */
/* ------------------------------------------------------------------ */

/**
 * The next { status, outcome } after setting an outcome. `deferred` (an early round's deferral to the regular
 * round) moves the item back to `applied` with no outcome yet, rather than staying "decided": the application is
 * still live. Every other outcome keeps the item `decided`.
 */
export function applyOutcome(outcome: ListOutcome): { status: ListStatus; outcome: ListOutcome | null } {
  if (outcome === "deferred") return { status: "applied", outcome: null };
  return { status: "decided", outcome };
}

/** Whether `status` may carry `outcome` (the database's own check, mirrored so the UI can disable invalid picks). */
export function statusAllowsOutcome(status: ListStatus, outcome: ListOutcome | null): boolean {
  return outcome === null || status === "decided";
}

/** A status set directly (not through applyOutcome): clears any outcome unless the new status is `decided`. */
export function setStatus(current: { status: ListStatus; outcome: ListOutcome | null }, status: ListStatus): { status: ListStatus; outcome: ListOutcome | null } {
  if (status === "decided") return { status, outcome: current.outcome };
  return { status, outcome: null };
}

/* ------------------------------------------------------------------ */
/* Owner                                                               */
/* ------------------------------------------------------------------ */

/** A list row's owner, from whichever owner column is set (the database's one-owner check guarantees exactly one). */
export function listOwner(list: Pick<ListRecord, "student_id" | "user_id">): ListOwner {
  if (list.student_id) return { kind: "student", id: list.student_id };
  if (list.user_id) return { kind: "user", id: list.user_id };
  throw new Error("A list without an owner");
}

/** The owner column and value a query filters by (`.eq(column, id)`). */
export function ownerColumn(owner: ListOwner): { column: "student_id" | "user_id"; id: string } {
  return { column: owner.kind === "student" ? "student_id" : "user_id", id: owner.id };
}

/* ------------------------------------------------------------------ */
/* Tracking row                                                        */
/* ------------------------------------------------------------------ */

/**
 * The tracking row under each college (specs/product/household-hub.md "Display"), always in this order. Applying
 * and Accepted aren't columns of their own: they read and write `status` and `outcome`, so the Scoir-compatible
 * export is unchanged.
 */
export type TrackingKey = "updates" | "applying" | "visited" | "social" | "accepted";
export const TRACKING_ORDER: TrackingKey[] = ["updates", "applying", "visited", "social", "accepted"];
export const TRACKING_LABELS: Record<TrackingKey, string> = {
  updates: "Updates",
  applying: "Applying",
  visited: "Visited",
  social: "Following on social",
  accepted: "Accepted",
};

export interface TrackingChip {
  key: TrackingKey;
  on: boolean;
  /** Shown on but not switchable from the row: Applying once the status has moved past it (applied, decided). */
  locked: boolean;
}

type TrackedItem = Pick<ListItem, "updates" | "status" | "outcome" | "visited_on" | "follows_social">;

export function trackingChips(item: TrackedItem): TrackingChip[] {
  const pastApplying = item.status === "applied" || item.status === "decided";
  const on: Record<TrackingKey, boolean> = {
    updates: item.updates,
    applying: item.status !== "considering",
    visited: item.visited_on !== null,
    social: item.follows_social,
    accepted: item.outcome === "admitted",
  };
  return TRACKING_ORDER.map((key) => ({ key, on: on[key], locked: key === "applying" && pastApplying }));
}

/** The write a toggle makes, for the Server Action of the same name in lib/lists.ts. `today` is yyyy-mm-dd. */
export type TrackingWrite =
  | { action: "setUpdates"; value: boolean }
  | { action: "setItemStatus"; status: ListStatus }
  | { action: "setVisited"; date: string | null }
  | { action: "setFollowsSocial"; value: boolean }
  | { action: "setOutcome"; outcome: "admitted"; date: string };

/**
 * Applying on → status `applying`, off → `considering`. Accepted on → outcome `admitted` decided today, off → back
 * to `applied` with no outcome (owner assumption, 2026-10-06). Visited on → today.
 */
export function trackingWrite(key: TrackingKey, turnOn: boolean, today: string): TrackingWrite {
  switch (key) {
    case "updates":
      return { action: "setUpdates", value: turnOn };
    case "applying":
      return { action: "setItemStatus", status: turnOn ? "applying" : "considering" };
    case "visited":
      return { action: "setVisited", date: turnOn ? today : null };
    case "social":
      return { action: "setFollowsSocial", value: turnOn };
    case "accepted":
      return turnOn ? { action: "setOutcome", outcome: "admitted", date: today } : { action: "setItemStatus", status: "applied" };
  }
}

/* ------------------------------------------------------------------ */
/* Balance line                                                        */
/* ------------------------------------------------------------------ */

export interface BalanceCounts {
  reach: number;
  target: number;
  likely: number;
  unsorted: number;
}

export function countByCategory(items: Pick<ListItem, "category">[]): BalanceCounts {
  const counts: BalanceCounts = { reach: 0, target: 0, likely: 0, unsorted: 0 };
  for (const item of items) counts[item.category]++;
  return counts;
}

/**
 * "3 Reach · 4 Target · 1 Likely" with counselor guidance appended when the balance looks off (specs/product/
 * saved-lists.md "Display"). Zero-count categories are omitted from the tally; unsorted colleges aren't counted
 * toward the guidance (they haven't been placed yet).
 */
export function balanceLine(items: Pick<ListItem, "category">[]): string {
  const c = countByCategory(items);
  const parts = (["reach", "target", "likely"] as const).filter((k) => c[k] > 0).map((k) => `${c[k]} ${CATEGORY_LABELS[k]}`);
  const tally = parts.length ? parts.join(" · ") : "No colleges sorted yet";
  const placed = c.reach + c.target + c.likely;
  if (placed === 0) return tally;
  let guidance: string | null = null;
  if (c.likely === 0) guidance = "counselors suggest at least 1–2 Likely";
  else if (c.likely === 1) guidance = "counselors suggest 2–3 Likely";
  else if (c.reach > c.target + c.likely) guidance = "that's a lot of Reach relative to Target and Likely";
  return guidance ? `${tally}: ${guidance}` : tally;
}

/* ------------------------------------------------------------------ */
/* Deadlines                                                           */
/* ------------------------------------------------------------------ */

export interface ResolvedDeadline {
  /** ISO yyyy-mm-dd, when known. CDS month/day values have no year, so this applies the given cycle year. */
  date: string | null;
  /** Free text when there's no date (e.g. "varies") or the student's own note. */
  text: string | null;
  /** Whether this came from the college's own reported data, or the student's typed override. */
  source: "reported" | "student" | null;
}

/** A month/day with no year, as CDS dates are stored (lib/types.ts CdsDate) — either part may be missing. */
export interface MonthDay {
  month: number | null;
  day: number | null;
}

/** A CDS month/day applied to the application cycle's year (deadlines in the fall are the cycle's start year, else the next). Null if either part is missing. */
function monthDayToIso(md: MonthDay, cycleStartYear: number): string | null {
  if (md.month === null || md.day === null) return null;
  const year = md.month >= 7 ? cycleStartYear : cycleStartYear + 1;
  return `${year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
}

/**
 * The deadline to show for a list item's chosen round: the college's own reported data when it has it for that
 * round (specs/product/saved-lists.md "Display" — CDS C14/C21/C22 via reported.admissions_logistics and
 * admission_profile), else the student's own override date/text, else null.
 */
export function deadlineFor(
  round: ListRound | null,
  logistics: { regular_closing?: MonthDay | null; priority_date?: MonthDay | null } | null | undefined,
  admissionProfile: {
    early_decision?: { first?: { closing?: MonthDay | null } | null; other?: { closing?: MonthDay | null } | null } | null;
    early_action?: { closing?: MonthDay | null } | null;
  } | null | undefined,
  cycleStartYear: number,
  override: { text: string | null; date: string | null },
): ResolvedDeadline {
  let md: MonthDay | null | undefined = null;
  if (round === "rd" || round === null) md = logistics?.regular_closing;
  else if (round === "ed") md = admissionProfile?.early_decision?.first?.closing;
  else if (round === "ed2") md = admissionProfile?.early_decision?.other?.closing;
  else if (round === "ea" || round === "rea") md = admissionProfile?.early_action?.closing;
  // round === "rolling" has no fixed closing date.

  const iso = md ? monthDayToIso(md, cycleStartYear) : null;
  if (iso) return { date: iso, text: null, source: "reported" };
  if (override.date) return { date: override.date, text: override.text, source: "student" };
  if (override.text) return { date: null, text: override.text, source: "student" };
  return { date: null, text: null, source: null };
}

/** Items (with a resolved deadline) due within `days` of `today`, soonest first — for the "Next 30 days" strip. */
export function upcomingDeadlines<T extends { deadline: ResolvedDeadline }>(items: T[], today: Date, days = 30): T[] {
  const from = today.getTime();
  const to = from + days * 86400000;
  return items
    .filter((i) => i.deadline.date !== null)
    .filter((i) => {
      const t = new Date(`${i.deadline.date}T00:00:00`).getTime();
      return t >= from && t <= to;
    })
    .sort((a, b) => a.deadline.date!.localeCompare(b.deadline.date!));
}

/* ------------------------------------------------------------------ */
/* CSV export / import (Scoir-compatible columns)                      */
/* ------------------------------------------------------------------ */

/**
 * The Scoir-compatible columns first, then the tracking row's three (specs/product/household-hub.md "Display"):
 * `updates` ("Yes"/"No"), `visited_on` (yyyy-mm-dd or blank), `follows_social` ("Yes" or blank). Import treats the
 * last three as optional, so a Scoir or Common App export still pastes.
 */
export const SCOIR_COLUMNS = ["College", "Category", "Round", "Status", "Outcome", "Deadline", "Enrolling", "Notes"] as const;
export const TRACKING_COLUMNS = ["updates", "visited_on", "follows_social"] as const;
export const CSV_COLUMNS = [...SCOIR_COLUMNS, ...TRACKING_COLUMNS] as const;

export interface CsvRow {
  name: string;
  category: ListCategory;
  round: ListRound | null;
  status: ListStatus;
  outcome: ListOutcome | null;
  deadline: string | null;
  enrolling: boolean;
  notes: string;
  updates: boolean;
  visited_on: string | null;
  follows_social: boolean;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A yyyy-mm-dd that is a real calendar date, else null (visited_on from the tracking row and CSV import). */
export function isoDateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The exported file's text, header first. */
export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        CATEGORY_LABELS[r.category],
        r.round ? ROUND_LABELS[r.round] : "",
        STATUS_LABELS[r.status],
        r.outcome ? OUTCOME_LABELS[r.outcome] : "",
        r.deadline ?? "",
        r.enrolling ? "Yes" : "",
        r.notes,
        r.updates ? "Yes" : "No",
        r.visited_on ?? "",
        r.follows_social ? "Yes" : "",
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  return lines.join("\n");
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const CATEGORY_BY_LABEL = new Map(Object.entries(CATEGORY_LABELS).map(([k, v]) => [v.toLowerCase(), k as ListCategory]));
const ROUND_BY_LABEL = new Map(Object.entries(ROUND_LABELS).map(([k, v]) => [v.toLowerCase(), k as ListRound]));
const STATUS_BY_LABEL = new Map(Object.entries(STATUS_LABELS).map(([k, v]) => [v.toLowerCase(), k as ListStatus]));
const OUTCOME_BY_LABEL = new Map(Object.entries(OUTCOME_LABELS).map(([k, v]) => [v.toLowerCase(), k as ListOutcome]));

export interface ParsedCsvRow {
  name: string;
  category: ListCategory;
  round: ListRound | null;
  status: ListStatus;
  outcome: ListOutcome | null;
  deadline: string | null;
  enrolling: boolean;
  notes: string;
  /** On unless the cell says no (a paste without the column keeps the default). */
  updates: boolean;
  visited_on: string | null;
  follows_social: boolean;
}

/**
 * Parses a pasted CSV (the exported format, or a close match — headers in any order, a subset of columns).
 * Unrecognized category/status/round/outcome text falls back to a safe default rather than failing the whole
 * paste; "College" is the only required column, by position or header name. Without the tracking columns (a Scoir
 * export), updates stays on, visited_on empty, follows_social off: the defaults of a college added by hand.
 */
export function parseCsv(text: string): ParsedCsvRow[] {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const hasHeader = header.includes("college");
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const rows = hasHeader ? lines.slice(1) : lines;
  const idx = {
    name: hasHeader ? col("college") : 0,
    category: hasHeader ? col("category") : 1,
    round: hasHeader ? col("round") : 2,
    status: hasHeader ? col("status") : 3,
    outcome: hasHeader ? col("outcome") : 4,
    deadline: hasHeader ? col("deadline") : 5,
    enrolling: hasHeader ? col("enrolling") : 6,
    notes: hasHeader ? col("notes") : 7,
    updates: hasHeader ? col("updates") : 8,
    visited_on: hasHeader ? col("visited_on") : 9,
    follows_social: hasHeader ? col("follows_social") : 10,
  };
  const get = (cells: string[], i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : "");
  return rows
    .map((line) => parseCsvLine(line))
    .filter((cells) => get(cells, idx.name).length > 0)
    .map((cells) => ({
      name: get(cells, idx.name),
      category: CATEGORY_BY_LABEL.get(get(cells, idx.category).toLowerCase()) ?? "unsorted",
      round: ROUND_BY_LABEL.get(get(cells, idx.round).toLowerCase()) ?? null,
      status: STATUS_BY_LABEL.get(get(cells, idx.status).toLowerCase()) ?? "considering",
      outcome: OUTCOME_BY_LABEL.get(get(cells, idx.outcome).toLowerCase()) ?? null,
      deadline: get(cells, idx.deadline) || null,
      enrolling: /^y(es)?$/i.test(get(cells, idx.enrolling)),
      notes: get(cells, idx.notes),
      updates: !/^(n|no|false|0|off)$/i.test(get(cells, idx.updates)),
      visited_on: isoDateOrNull(get(cells, idx.visited_on)),
      follows_social: /^(y|yes|true|1)$/i.test(get(cells, idx.follows_social)),
    }));
}

/* ------------------------------------------------------------------ */
/* Misc                                                                 */
/* ------------------------------------------------------------------ */

export const DEFAULT_LIST_NAME = "My list";
export const MAX_LIST_NOTE_LENGTH = 2000;
export const MAX_COMPARE_FROM_LIST = 4;

/** "Added by Mom" / "Added by you" for the row attribution (specs/product/saved-lists.md "Guardian view"). */
export function addedByLabel(addedByName: string | null, isSelf: boolean): string {
  if (isSelf) return "Added by you";
  return addedByName ? `Added by ${addedByName}` : "Added by a guardian";
}
