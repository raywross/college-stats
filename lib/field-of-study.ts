/**
 * Field of study earnings and debt (specs/data-expansion/field-of-study.md): the shape of one college's
 * `detail.programs` table (lib/detail.ts) and small pure helpers shared by the sync
 * (scripts/lib/field-of-study-sync.mts) and the app. Pure module: no runtime imports.
 */

export interface ProgramEarnings {
  /** From the bulk CSV's CIPDESC, trailing period stripped. */
  title: string;
  /**
   * Completers in the two most recent reported award years, summed; null when neither year is a reported number
   * (privacy-suppressed or not available — see the spec's "As built" for why a program row can still exist).
   */
  graduates: number | null;
  earnings: {
    /** Median earnings 1 year after completion. */
    y1: number | null;
    /** Median earnings 4 years after completion. */
    y4: number | null;
    /** National median, same field and credential, 4 years after completion. */
    y4_national: number | null;
    /** 4 years after completion, Pell Grant recipients. Pools an older cohort than y4 — see the spec. */
    y4_pell: number | null;
    /** 4 years after completion, no Pell Grant. Pools the same older cohort as y4_pell. */
    y4_non_pell: number | null;
  };
  /** Median cumulative federal loan debt (Direct/Stafford + Grad PLUS) among borrowers who completed here. */
  debt_median: number | null;
}

/** 4-digit CIP code in the site's dotted display form, e.g. "11.07" (Computer Science). */
export type Cip4 = string;

/**
 * Shape check only ("11.07"): two digits, a dot, two digits. This module stays pure (client components use it), so
 * the existence check against CIP 2020 (`hasCip4`, lib/cip.ts) runs where the table is loaded: the sync's builder
 * (scripts/lib/field-of-study-sync.mts) and the detail-file check (lib/detail.ts).
 */
export function isPlausibleCip4(cip: string): boolean {
  return /^\d{2}\.\d{2}$/.test(cip);
}

/** CIPCODE as the Field of Study bulk CSV writes it ("1107") to the site's dotted 4-digit form ("11.07"). */
export function toCip4(cipcode: string): Cip4 {
  const padded = cipcode.padStart(4, "0");
  return `${padded.slice(0, 2)}.${padded.slice(2, 4)}`;
}

/** True when a program has at least one usable earnings figure (never "too few graduates to report" for every measure). */
export function hasEarnings(p: ProgramEarnings): boolean {
  return p.earnings.y1 !== null || p.earnings.y4 !== null;
}

/** The `n` highest-earning programs with data, ranked by 4-year earnings (falling back to 1-year when 4-year is suppressed). */
export function topEarningPrograms(rows: Record<string, ProgramEarnings> | undefined, n = 5): (ProgramEarnings & { cip4: Cip4 })[] {
  if (!rows) return [];
  return Object.entries(rows)
    .filter(([, p]) => hasEarnings(p))
    .map(([cip4, p]) => ({ cip4, ...p }))
    .sort((a, b) => (b.earnings.y4 ?? b.earnings.y1 ?? 0) - (a.earnings.y4 ?? a.earnings.y1 ?? 0))
    .slice(0, n);
}

/** All programs with earnings data, for the Compare "your major" picker, sorted by title. */
export function programsWithEarnings(rows: Record<string, ProgramEarnings> | undefined): (ProgramEarnings & { cip4: Cip4 })[] {
  if (!rows) return [];
  return Object.entries(rows)
    .filter(([, p]) => hasEarnings(p))
    .map(([cip4, p]) => ({ cip4, ...p }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
