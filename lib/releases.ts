/**
 * Release calendar (data/release-calendar.json): when each source is expected to
 * publish newer data. Hand-maintained; `npm run sync-data` probes NCES for each
 * entry's files and marks it published when they appear. See specs/data-page.md.
 *
 * Pure module (type-only imports) so the sync, tests and the app share it.
 */
import type { VintageKey } from "./fields.ts";

export type ReleaseStatus = "estimated" | "confirmed" | "published";

export interface Release {
  id: string;
  source: "ipeds" | "scorecard" | "colleges";
  label: string;
  /** What the release contains, in plain words (year labels live here, not in UI code). */
  brings: string[];
  /** Releases on the site (meta.json `vintages`) that this one replaces with a newer year. */
  updates: VintageKey[];
  /** Expected month, "YYYY-MM"; null when the source publishes irregularly. */
  expected: string | null;
  /** End of a rolling window, "YYYY-MM". */
  expectedEnd?: string;
  status: ReleaseStatus;
  /** ISO date the sync first found the release's files. */
  published?: string;
  /** Why we expect that date. */
  basis: string;
  /** Where the date comes from (a publisher's schedule or changelog); omitted when there's no single page. */
  url?: string;
  /** IPEDS bulk-file names (without .zip) whose appearance on NCES means the release is out. */
  files?: string[];
  /** For revisions of files that already exist: published once every file is modified after this ISO date. */
  filesUpdatedAfter?: string;
  note?: string;
}

export interface ReleaseCalendar {
  /** ISO date a person last checked the entries against the publishers' schedules. */
  reviewed: string;
  releases: Release[];
  /** Released files the site doesn't use yet. */
  notUsedYet: { file: string; released: string; what: string; url: string }[];
  /** Sources not used yet, with their status. */
  watching: { id: string; name: string; status: string; summary: string; latest: string; why: string; links: { label: string; url: string }[] }[];
}

/** The page warns when the calendar hasn't been reviewed for this long. */
export const STALE_AFTER_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM" or "YYYY-MM-DD" → the first moment of that month / day (UTC). */
export function parseMonth(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function daysSince(isoDate: string, now: Date): number {
  return Math.floor((now.getTime() - parseMonth(isoDate).getTime()) / DAY_MS);
}

export function isStale(calendar: Pick<ReleaseCalendar, "reviewed">, now: Date): boolean {
  return daysSince(calendar.reviewed, now) > STALE_AFTER_DAYS;
}

/** "Dec 2026" from "YYYY-MM". */
export function monthLabel(value: string): string {
  const d = parseMonth(value);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Jul 28, 2026" from an ISO date. */
export function dateLabel(value: string): string {
  const d = parseMonth(value);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Dec 2026", "Aug–Nov 2026", "Feb–Aug 2027", "Nov 2026–Feb 2027", or "Irregular". */
export function expectedLabel(r: Pick<Release, "expected" | "expectedEnd">): string {
  if (!r.expected) return "Irregular";
  if (!r.expectedEnd) return monthLabel(r.expected);
  const a = parseMonth(r.expected);
  const b = parseMonth(r.expectedEnd);
  return a.getUTCFullYear() === b.getUTCFullYear()
    ? `${MONTHS[a.getUTCMonth()]}–${monthLabel(r.expectedEnd)}`
    : `${monthLabel(r.expected)}–${monthLabel(r.expectedEnd)}`;
}

/** Still not out after the last expected month ended. */
export function isOverdue(r: Release, now: Date): boolean {
  const last = r.expectedEnd ?? r.expected;
  if (r.status === "published" || !last) return false;
  const end = parseMonth(last);
  return now.getTime() >= Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1);
}

/** Releases not out yet, soonest first; irregular ones last. */
export function upcoming(calendar: ReleaseCalendar): Release[] {
  const at = (r: Release) => (r.expected ? parseMonth(r.expected).getTime() : Infinity);
  return calendar.releases.filter((r) => r.status !== "published").sort((a, b) => at(a) - at(b));
}

/** The next release that brings a newer year of a release on the site. */
export function nextReleaseFor(vintage: VintageKey, calendar: ReleaseCalendar): Release | null {
  return upcoming(calendar).find((r) => r.updates.includes(vintage)) ?? null;
}

/**
 * When the period a display year describes began: "Fall YYYY" → Sep 1; an academic
 * year like "YYYY–YY" → Jul 1 of its first year. Null for anything else.
 */
export function periodStart(year: string | null): Date | null {
  if (!year) return null;
  // "Students entering fall 2016" (Outcome Measures) describes that entering class, like "Fall 2016".
  const fall = /^(?:students entering )?fall (\d{4})$/i.exec(year.trim());
  if (fall) return new Date(Date.UTC(Number(fall[1]), 8, 1));
  const academic = /^(\d{4})\s*[–-]\s*(\d{2}|\d{4})$/.exec(year.trim());
  if (academic) return new Date(Date.UTC(Number(academic[1]), 6, 1));
  return null;
}

/* ------------------------------------------------------------------ */
/* Publication probe (run by the sync)                                 */
/* ------------------------------------------------------------------ */

export interface FileProbe {
  exists: boolean;
  /** ISO date from the Last-Modified header, when the file exists. */
  lastModified: string | null;
}

/** True when every file the release names is on NCES (and, for revisions, newer than `filesUpdatedAfter`). */
export function isPublished(r: Release, probes: ReadonlyMap<string, FileProbe>): boolean {
  if (!r.files?.length) return false;
  return r.files.every((f) => {
    const p = probes.get(f);
    if (!p?.exists) return false;
    if (!r.filesUpdatedAfter) return true;
    return !!p.lastModified && p.lastModified > r.filesUpdatedAfter;
  });
}

/** The calendar with newly found releases marked published (dated `today`), and their ids. */
export function applyProbes(
  calendar: ReleaseCalendar,
  probes: ReadonlyMap<string, FileProbe>,
  today: string,
): { calendar: ReleaseCalendar; published: string[] } {
  const published: string[] = [];
  const releases = calendar.releases.map((r) => {
    if (r.status === "published" || !isPublished(r, probes)) return r;
    published.push(r.id);
    return { ...r, status: "published" as const, published: today };
  });
  return { calendar: { ...calendar, releases }, published };
}

/** Files the sync should probe: those of releases not yet marked published. */
export function filesToProbe(calendar: ReleaseCalendar): string[] {
  return [...new Set(calendar.releases.filter((r) => r.status !== "published").flatMap((r) => r.files ?? []))];
}
