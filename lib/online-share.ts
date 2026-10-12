/**
 * Online share (specs/data-expansion/online-share.md): how an IPEDS `EF{Y}A_DIST` row becomes
 * `demographics.online_share` and `demographics.online_any_share`. Pure: sync-data, history, and tests share it, so
 * history's last point always matches the snapshot.
 *
 * EF{Y}A_DIST has one row per college per student level (`EFDELEV`), with the students at that level (`EFDETOT`) split
 * into those taking every course by distance education (`EFDEEXC`), some (`EFDESOM`), and none (`EFDENON`).
 * scripts/lib/ipeds.mts pivots the rows (`wide`) into one row per college with columns like `EFDEEXC_2`.
 *
 * Probed 2026-10-12 (EF2012A_DIST, EF2014A_DIST, EF2024A_DIST and the 2024 dictionary): level 1 is all students, 2 all
 * undergraduates, 3 degree/certificate-seeking undergraduates, 11 non-degree undergraduates, 12 graduate students. The
 * shares use level 2, the population the glossary's online-first rule and the reviewed list it replaced were written
 * from; level 3 (the population of College Scorecard's `student.size`) is only sync-data's enrollment cross-check.
 */

import { ONLINE_FIRST_SHARE } from "./history.ts";

type Row = Record<string, string> | undefined;

/** The levels read, from the EF2024A_DIST data dictionary. */
export const EFA_DIST_LEVELS = { undergrad: 2, undergrad_degree_seeking: 3 } as const;

/** EF{Y}A_DIST pivoted to one row per college (scripts/lib/ipeds.mts `wide`). */
export const EFA_DIST_WIDE = { key: "EFDELEV", values: ["EFDETOT", "EFDEEXC", "EFDESOM", "EFDENON"] } as const;
export const EFA_DIST_COLUMNS = ["EFDELEV", "EFDETOT", "EFDEEXC", "EFDESOM", "EFDENON"] as const;

/** Distance-education counts are collected every fall from 2012 (EF2012A_DIST is the first file). */
export const EFA_DIST_FIRST_YEAR = 2012;

export interface OnlineShares {
  /** Share of all undergraduates taking every course online (0–1). */
  online_share: number;
  /** Share taking at least one course online: every course or some (0–1). */
  online_any_share: number;
  /** Level-2 `EFDETOT`: all undergraduates, the shares' denominator. */
  undergrads: number;
  /** Level-3 `EFDETOT`: degree/certificate-seeking undergraduates, for sync-data's 10% check; null when not reported. */
  degree_seeking: number | null;
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** A count, or null when blank, unreadable, or negative (IPEDS codes missing values as -1, -2). */
function count(row: Record<string, string>, column: string, level: number): number | null {
  const v = row[`${column}_${level}`];
  if (v === undefined || v === "" || v === ".") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A part of the total: NCES leaves a part blank when it doesn't apply (imputation flag `A`: no students in it; every
 * blank part in EF2012A_DIST and EF2024A_DIST is flagged `A`), so a blank part is 0. Negative or non-numeric is null.
 */
function part(row: Record<string, string>, column: string, level: number): number | null {
  const v = row[`${column}_${level}`];
  return v === "" ? 0 : count(row, column, level);
}

/** One level's four counts, or null when the total is missing or any count is unreadable. */
function levelCounts(row: Record<string, string>, level: number): { total: number; exclusive: number; some: number; none: number } | null {
  const total = count(row, "EFDETOT", level);
  const exclusive = part(row, "EFDEEXC", level);
  const some = part(row, "EFDESOM", level);
  const none = part(row, "EFDENON", level);
  if (total === null || exclusive === null || some === null || none === null) return null;
  return { total, exclusive, some, none };
}

/**
 * A college's online shares this fall; null when it has no all-undergraduates row, its total is 0 or blank, or the
 * row doesn't add up (every course + some + none ≠ total), so a stored share is always within 0–1.
 */
export function onlineSharesFrom(row: Row): OnlineShares | null {
  if (!row) return null;
  const u = levelCounts(row, EFA_DIST_LEVELS.undergrad);
  if (!u || u.total <= 0) return null;
  if (u.exclusive + u.some + u.none !== u.total) return null;
  const degree = count(row, "EFDETOT", EFA_DIST_LEVELS.undergrad_degree_seeking);
  return {
    online_share: round4(u.exclusive / u.total),
    online_any_share: round4((u.exclusive + u.some) / u.total),
    undergrads: u.total,
    degree_seeking: degree,
  };
}

/**
 * The add-up rule on every level row of these colleges: `EFDEEXC + EFDESOM + EFDENON = EFDETOT`, no negative or
 * unreadable count. `checked` counts level rows read, `colleges` the colleges with any; each failing row is a problem
 * ("unit_id level L: …"). sync-data stops when more than 1% of rows fail (a changed file, not a college's typo).
 */
export function checkOnlineRows(rows: ReadonlyMap<string, Record<string, string>>, ids: Iterable<string>): { checked: number; colleges: number; problems: string[] } {
  const problems: string[] = [];
  let checked = 0;
  let colleges = 0;
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) continue;
    const levels = Object.keys(row)
      .filter((k) => k.startsWith("EFDETOT_"))
      .map((k) => Number(k.slice("EFDETOT_".length)))
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
    if (!levels.length) continue;
    colleges++;
    for (const level of levels) {
      checked++;
      const c = levelCounts(row, level);
      if (!c) {
        problems.push(`${id} level ${level}: a count is blank or unreadable`);
        continue;
      }
      if (c.exclusive + c.some + c.none !== c.total) problems.push(`${id} level ${level}: ${c.exclusive} + ${c.some} + ${c.none} ≠ ${c.total}`);
    }
  }
  return { checked, colleges, problems };
}

type WithShare = { demographics: { online_share?: number | null } };

/** The share of all undergraduates taking every course online (Explore's filter and card chip); null when not reported. */
export function onlineShare(s: WithShare): number | null {
  return s.demographics.online_share ?? null;
}

/** More than half of undergraduates take every course online (the online-first bar, in the newest fall). */
export function isMostlyOnline(s: WithShare): boolean {
  const v = onlineShare(s);
  return v !== null && v > ONLINE_FIRST_SHARE;
}

/** The profile line shows from this share entirely online (nearly every campus has a few), and "some" from this gap. */
export const ONLINE_LINE_MIN = 0.05;

/**
 * The profile's Students line: the share taking every course online, and the share taking some (but not all) when it's
 * at least `ONLINE_LINE_MIN`; null when the entire-online share is under it or not reported.
 */
export function onlineLine(s: { demographics: { online_share?: number | null; online_any_share?: number | null } }): { all: number; some: number | null } | null {
  const all = s.demographics.online_share ?? null;
  if (all === null || all < ONLINE_LINE_MIN) return null;
  const any = s.demographics.online_any_share ?? null;
  const some = any === null ? null : round4(any - all);
  return { all, some: some !== null && some >= ONLINE_LINE_MIN ? some : null };
}

/** Explore's `online=` filter: campus-based (half or less entirely online; no share counts as campus-based) or mostly online. */
export type OnlineFilter = "campus" | "mostly";
export const isOnlineFilter = (v: unknown): v is OnlineFilter => v === "campus" || v === "mostly";
export const ONLINE_FILTER_LABELS: Record<OnlineFilter, string> = { campus: "Campus-based", mostly: "Mostly online" };

export function matchesOnline(s: WithShare, f: OnlineFilter): boolean {
  return f === "mostly" ? isMostlyOnline(s) : !isMostlyOnline(s);
}
