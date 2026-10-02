/**
 * Where first-years come from (specs/data-expansion/residence.md): how IPEDS Fall Enrollment part C (EF{Y}C) becomes
 * the stored shares and the per-college home-state table. Pure: sync-data, sync-history, and tests share it, so
 * history's last point always matches the snapshot.
 *
 * EF{Y}C has one row per college per `EFCSTATE` code; the fetch pivots them into one wide row per college with a
 * column `EFRES01_{code}` per code (scripts/lib/ipeds.mts `wide`). `EFRES01` counts first-time degree/certificate-
 * seeking undergraduates. Codes: 1–56 states and DC, 57 state unknown, 58 U.S. total (states, DC, and 57),
 * 60–78 territories, 89 territories total, 90 foreign countries, 98 residence not reported, 99 grand total.
 * These shares reproduce NCES's derived file (DRVEF{Y} `RMINSTTN` / `RMOUSTTN` / `RMFRGNCN` / `RMUNKNWN`) exactly
 * for 1,809 of 1,810 site colleges in fall 2024.
 */
import type { School } from "./types";
import { STATES, stateByPostal } from "./states.ts";

type Row = Record<string, string> | undefined;

export const EFC_CODES = { unknownState: 57, usTotal: 58, territoriesTotal: 89, foreign: 90, notReported: 98, total: 99 } as const;

/** The wide-row column holding one code's first-time students. */
export const efcColumn = (code: number): string => `EFRES01_${code}`;

function count(row: Row, code: number): number {
  const raw = row?.[efcColumn(code)];
  if (raw === undefined || raw === "" || raw === ".") return 0;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export interface ResidenceCounts {
  in_state: number;
  /** Other states, DC, and U.S. territories (as NCES counts "out of state"). */
  out_of_state: number;
  /** Foreign countries. */
  international: number;
  /** State unknown or residence not reported. */
  unknown: number;
  /** Every first-time undergraduate. */
  total: number;
}

/** Counts for a college in `homePostal`; null when it reported no first-time students (or no row). */
export function residenceCounts(row: Row, homePostal: string): ResidenceCounts | null {
  const total = count(row, EFC_CODES.total);
  if (!row || total <= 0) return null;
  const home = stateByPostal(homePostal)?.fips;
  const inState = home === undefined ? 0 : count(row, home);
  const us = count(row, EFC_CODES.usTotal) - count(row, EFC_CODES.unknownState) + count(row, EFC_CODES.territoriesTotal);
  return {
    in_state: inState,
    out_of_state: Math.max(0, us - inState),
    international: count(row, EFC_CODES.foreign),
    unknown: count(row, EFC_CODES.unknownState) + count(row, EFC_CODES.notReported),
    total,
  };
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** Snapshot shares (of every first-year, including those whose residence wasn't reported). */
export type Residence = NonNullable<NonNullable<School["demographics"]["residence"]>>;

/** Home states: USPS code → first-time students, only codes with at least one (states, DC, territories). */
export function homeStatesFrom(row: Row): Record<string, number> {
  const out: [string, number][] = [];
  for (const s of STATES.values()) {
    const n = count(row, s.fips);
    if (n > 0) out.push([s.postal, n]);
  }
  // Largest first, so the detail file reads like the profile's list.
  out.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return Object.fromEntries(out);
}

/** The stored residence for one college, or null when it reported none. */
export function residenceFrom(row: Row, homePostal: string): Residence | null {
  const c = residenceCounts(row, homePostal);
  if (!c) return null;
  const top = Object.entries(homeStatesFrom(row))[0];
  return {
    in_state: round4(c.in_state / c.total),
    out_of_state: round4(c.out_of_state / c.total),
    international: round4(c.international / c.total),
    first_years: c.total,
    top_state: top ? { state: top[0], share: round4(top[1] / c.total) } : null,
  };
}

/** Explore's "Draws nationally" filter: at least half of first-years from other states. */
export const DRAWS_NATIONALLY = 0.5;
/** "Draws students nationally" needs a real class: a few students swing a small college's share. */
export const NATIONAL_MIN_FIRST_YEARS = 500;
/** "Most students are from {state}" (another state): a majority, from a class of at least this many. */
export const MOST_FROM_MIN_FIRST_YEARS = 100;

export function drawsNationally(s: Pick<School, "demographics">): boolean {
  const r = s.demographics.residence;
  return r != null && r.out_of_state >= DRAWS_NATIONALLY;
}

/** The other state most first-years come from, when a majority do (e.g. North Dakota State: Minnesota). */
export function mostFromOtherState(s: Pick<School, "demographics" | "location">): string | null {
  const r = s.demographics.residence;
  const t = r?.top_state;
  if (!r || !t || t.state === s.location.state || t.share < 0.5 || r.first_years < MOST_FROM_MIN_FIRST_YEARS) return null;
  return t.state;
}

/** Share with no reported residence: what's left after the three parts. */
export function unknownShare(r: Residence): number {
  return Math.max(0, round4(1 - r.in_state - r.out_of_state - r.international));
}
