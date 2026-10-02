/**
 * The Classification of Instructional Programs (CIP 2020): NCES's codes for fields of study, which IPEDS completions
 * (majors.md) and College Scorecard's field-of-study files (field-of-study.md) both use. Titles come from the checked-in
 * table data/reference/cip2020.json (`npm run build-cip`), which has every 2-digit family, 4-digit group, and 6-digit
 * program.
 *
 * Codes appear in many spellings: IPEDS writes "11.0701" (and "01.0101" or "1.0101" once a spreadsheet drops the zero),
 * Scorecard writes 4-digit codes as "1107" or "107". `normalizeCip` turns any of them into the canonical dotted form:
 * "11" (family), "11.07" (4-digit), "11.0701" (6-digit). Every helper here accepts any spelling.
 *
 * Server-side only in the app (the table is ~150 KB): client components get titles as props. For family names that
 * client code can use, see lib/majors.ts.
 */
import table from "../data/reference/cip2020.json" with { type: "json" };

export type CipLevel = 2 | 4 | 6;

const TITLES: Readonly<Record<string, string>> = table.titles;
const MOVED_2010: Readonly<Record<string, string>> = table.moved_from_2010;

/** Where the titles come from, for citations and the Data page. */
export const CIP_SOURCE = { label: table.source, url: table.url, crosswalk: table.crosswalk_url, retrieved: table.retrieved } as const;

/** IPEDS's institution-total row in completions files: not a field of study. */
export const CIP_TOTAL = "99";

/**
 * Canonical dotted form of a CIP code ("11", "11.07", "11.0701"), or null when it can't be one. Accepts "11.0701",
 * "110701", "1107", "11.07", "11", "1.0701" / "10701" (leading zero dropped), quotes and Excel's `="…"`. A number is
 * read as written ("11.07" → 4-digit), so pass strings when trailing zeros matter (11.0700 as a number is 11.07).
 * "99" (IPEDS's total row) normalizes to "99" but isn't a field (see isCipField).
 */
export function normalizeCip(code: string | number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const s = String(code).replace(/^=/, "").replace(/["'\s]/g, "");
  if (!s) return null;
  const dotted = /^(\d{1,2})\.(\d{1,4})$/.exec(s);
  if (dotted) {
    const fam = dotted[1].padStart(2, "0");
    const rest = dotted[2];
    // One or three decimals lost a trailing zero ("11.1" from 11.10, "11.070" from 11.0700).
    const tail = rest.length <= 2 ? rest.padEnd(2, "0") : rest.padEnd(4, "0");
    return `${fam}.${tail}`;
  }
  if (!/^\d{1,6}$/.test(s)) return null;
  // Undotted: an odd length lost its leading zero ("107" → "0107", "10701" → "010701").
  const digits = s.length % 2 ? `0${s}` : s;
  if (digits.length === 2) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2)}`;
}

/** 2, 4, or 6 digits; null when the code can't be read. */
export function cipLevel(code: string | number | null | undefined): CipLevel | null {
  const c = normalizeCip(code);
  return c ? ((c.replace(".", "").length as CipLevel)) : null;
}

/** The 2-digit family ("11.0701" → "11"), or null. */
export function cipFamily(code: string | number | null | undefined): string | null {
  const c = normalizeCip(code);
  return c ? c.slice(0, 2) : null;
}

/** The 4-digit group ("11.0701" → "11.07", "1107" → "11.07"); null for a 2-digit family or an unreadable code. */
export function cip4(code: string | number | null | undefined): string | null {
  const c = normalizeCip(code);
  return c && c.length >= 5 ? c.slice(0, 5) : null;
}

/** True when the code (any level) exists in CIP 2020. */
export function hasCip(code: string | number | null | undefined): boolean {
  const c = normalizeCip(code);
  return c !== null && Object.prototype.hasOwnProperty.call(TITLES, c);
}

/** True when a 4-digit group exists in CIP 2020 (a 6-digit code is checked by its group). */
export function hasCip4(code: string | number | null | undefined): boolean {
  const c = cip4(code);
  return c !== null && hasCip(c);
}

/** NCES's title for a code at its own level ("11.0701" → "Computer Science"), or null when CIP 2020 has no such code. */
export function cipTitle(code: string | number | null | undefined): string | null {
  const c = normalizeCip(code);
  return c ? (TITLES[c] ?? null) : null;
}

/** The 4-digit group's title ("11.0701" or "1107" → "Computer Science"). */
export function cip4Title(code: string | number | null | undefined): string | null {
  return cipTitle(cip4(code));
}

/** The family's NCES title ("52" → "Business, Management, Marketing, and Related Support Services"). */
export function cipFamilyTitle(code: string | number | null | undefined): string | null {
  return cipTitle(cipFamily(code));
}

/** True for a real field of study: readable, not IPEDS's "99" total row, and in CIP 2020. */
export function isCipField(code: string | number | null | undefined): boolean {
  const c = normalizeCip(code);
  return c !== null && c !== CIP_TOTAL && hasCip(c);
}

/**
 * A CIP 2010 code in CIP 2020 terms: NCES's crosswalk moved 149 codes (some across families, e.g. veterinary programs
 * from 51 to 01); every other code kept its number. Used for completions files before C2020_A.
 */
export function fromCip2010(code: string | number | null | undefined): string | null {
  const c = normalizeCip(code);
  return c ? (MOVED_2010[c] ?? c) : null;
}

/** Every code at one level, sorted (for tests and pickers). */
export function cipCodes(level: CipLevel): string[] {
  return Object.keys(TITLES)
    .filter((k) => k.replace(".", "").length === level)
    .sort();
}
