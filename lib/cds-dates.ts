/**
 * Month/day dates in a Common Data Set (specs/data-expansion/cds-application-logistics.md, "Date handling"): C14's
 * closing and priority dates, C16's notification date, C17's reply date and housing deposit deadline, and later D9 and
 * H9–H11 if those specs want them. Built on lib/cds-sections.ts's `monthDay` (the one cell parser the records reader
 * already uses), adding split month/day cells, the `valid-date` check's three outcomes, ordering within an admissions
 * cycle, and display.
 *
 * Pure: imports only lib/cds-sections.ts (itself import-free).
 */
import type { CdsDate } from "./types";
import { monthDay, type MonthDay } from "./cds-sections.ts";

/**
 * A month/day with no year (lib/types.ts): the year lives in the field's lineage record ("Fall 2026 cycle"). Both null
 * means the cell held free text ("Early April", "11 months 1 day"); the verbatim text stays in the lineage quote.
 */
export type { CdsDate };

const NO_DATE: CdsDate = { month: null, day: null };

/**
 * One date from a cell: the stored "--MM-DD", "11/1", "1-Nov", "Nov 1st", and with `excel` a serial number
 * (William & Mary's C.1608 "46113" → April 1, from the 1899-12-30 epoch; never for PDF or HTML text). Anything that
 * isn't exactly one calendar date gives `{ month: null, day: null }`. Never throws.
 */
export function parseCdsDate(raw: unknown, opts: { excel?: boolean } = {}): CdsDate {
  try {
    return monthDay(raw, opts) ?? { ...NO_DATE };
  } catch {
    return { ...NO_DATE };
  }
}

/** A split month/day pair (the template's native form: C.1402 month 1, C.1403 day 5). */
export function splitCdsDate(month: unknown, day: unknown): CdsDate {
  if (typeof month !== "number" || typeof day !== "number") return { ...NO_DATE };
  return parseCdsDate(`${month}/${day}`);
}

/** A parsed date (both parts known). */
export const isConcrete = (d: CdsDate | null | undefined): d is MonthDay => !!d && d.month !== null && d.day !== null;

/**
 * The `valid-date` check: `valid` for one calendar date; `unparsed` for free text (kept as a quote, `status: "blank"`
 * for the value, not a failure); `invalid` only for a cell that *looks* numeric but is out of range (day 34, month 13,
 * February 30), which goes to review. Split cells pass `[month, day]`.
 */
export function dateCheck(raw: unknown, opts: { excel?: boolean } = {}): "valid" | "unparsed" | "invalid" | "blank" {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return "blank";
  if (Array.isArray(raw)) {
    const [m, d] = raw;
    if ((m === null || m === undefined) && (d === null || d === undefined)) return "blank";
    if (typeof m !== "number" || typeof d !== "number") return "unparsed";
    return isConcrete(splitCdsDate(m, d)) ? "valid" : "invalid";
  }
  if (isConcrete(parseCdsDate(raw, opts))) return "valid";
  const s = String(raw).trim();
  // Numeric-looking but not a date: "13/1", "2/30", "--02-30", or a bare number outside a workbook.
  if (/^(?:--)?\d{1,2}\s*[/-]\s*\d{1,2}$/.test(s)) return "invalid";
  return "unparsed";
}

/**
 * Position of a date within one admissions cycle, which runs from August (early deadlines, rolling notifications) to
 * July: November 1 sorts before January 5. Used for "regular closing on or after early closing" and "reply on or after
 * notification", both compared within the same cycle year.
 */
export function cycleOrder(d: MonthDay): number {
  return ((d.month + 12 - 8) % 12) * 100 + d.day;
}

/** < 0 when `a` comes earlier in the cycle than `b`, 0 when the same day. */
export const compareInCycle = (a: MonthDay, b: MonthDay) => cycleOrder(a) - cycleOrder(b);

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "January 5"; null without both parts. */
export function formatCdsDate(d: CdsDate | null | undefined): string | null {
  return isConcrete(d) ? `${MONTH_NAMES[d.month - 1]} ${d.day}` : null;
}
