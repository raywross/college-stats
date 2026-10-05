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
}

export interface ListRecord {
  id: string;
  student_id: string;
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

export const CSV_COLUMNS = ["College", "Category", "Round", "Status", "Outcome", "Deadline", "Enrolling", "Notes"] as const;

export interface CsvRow {
  name: string;
  category: ListCategory;
  round: ListRound | null;
  status: ListStatus;
  outcome: ListOutcome | null;
  deadline: string | null;
  enrolling: boolean;
  notes: string;
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
}

/**
 * Parses a pasted CSV (the exported format, or a close match — headers in any order, a subset of columns).
 * Unrecognized category/status/round/outcome text falls back to a safe default rather than failing the whole
 * paste; "College" is the only required column, by position or header name.
 */
export function parseCsv(text: string): ParsedCsvRow[] {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
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
