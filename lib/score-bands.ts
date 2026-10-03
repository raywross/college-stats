/**
 * Score bands and the SAT total a college shows (CDS C9; specs/data-expansion/cds-test-scores-and-policy.md,
 * Decision 3 and Display): band edges per test, column normalization, `bandOf`, shares below and through a band, the
 * sentences, `MIN_SUBMITTERS`, and `satTotal` (`derived.sat_total`).
 *
 * Pure module: type-only imports, safe for client components and Node tests.
 */
import type { Bands6, BandTest, Pct3, School } from "./types";

/** A test with fewer submitters passes its checks but is neither shown nor applied (open question 2). */
export const MIN_SUBMITTERS = 50;

type Band = { lo: number; hi: number };
const SECTION: Band[] = [
  { lo: 700, hi: 800 },
  { lo: 600, hi: 699 },
  { lo: 500, hi: 599 },
  { lo: 400, hi: 499 },
  { lo: 300, hi: 399 },
  { lo: 200, hi: 299 },
];
const ACT: Band[] = [
  { lo: 30, hi: 36 },
  { lo: 24, hi: 29 },
  { lo: 18, hi: 23 },
  { lo: 12, hi: 17 },
  { lo: 6, hi: 11 },
  { lo: 1, hi: 5 },
];

/** Band edges per test, top band first (the template's order). */
export const BAND_EDGES: Record<BandTest, readonly Band[]> = {
  sat_ebrw: SECTION,
  sat_math: SECTION,
  sat_composite: [
    { lo: 1400, hi: 1600 },
    { lo: 1200, hi: 1399 },
    { lo: 1000, hi: 1199 },
    { lo: 800, hi: 999 },
    { lo: 600, hi: 799 },
    { lo: 400, hi: 599 },
  ],
  act_composite: ACT,
  act_english: ACT,
  act_math: ACT,
};

/** What each band column is called in a sentence and on the page. */
export const BAND_TEST_LABELS: Record<BandTest, { label: string; test: "SAT" | "ACT" }> = {
  sat_composite: { label: "SAT total", test: "SAT" },
  sat_ebrw: { label: "SAT Reading & Writing", test: "SAT" },
  sat_math: { label: "SAT Math", test: "SAT" },
  act_composite: { label: "ACT composite", test: "ACT" },
  act_english: { label: "ACT English", test: "ACT" },
  act_math: { label: "ACT Math", test: "ACT" },
};

/** "1400–1600", "below 6". */
export function bandLabel(test: BandTest, i: number): string {
  const b = BAND_EDGES[test][i];
  return b.lo === 1 ? "below 6" : `${b.lo}–${b.hi}`;
}

/** The band index holding a score, or null outside the scale. */
export function bandOf(score: number, test: BandTest): number | null {
  const i = BAND_EDGES[test].findIndex((b) => score >= b.lo && score <= b.hi + 0.999);
  return i < 0 ? null : i;
}

/** Share of senders below band i (the bands under it). */
export function shareBelow(bands: Bands6, i: number): number {
  return bands.slice(i + 1).reduce((a, b) => a + b, 0);
}

/** Share of senders at or below band i. */
export function shareThrough(bands: Bands6, i: number): number {
  return shareBelow(bands, i) + bands[i];
}

/**
 * One band column as printed → shares 0–1 (Checks, "Band column form" and "Bands sum"): blanks in a filled column are 0;
 * a column whose cells are all blank is blank (null); values summing to 1 ± 0.01 are fractions, to 100 ± 1 percents;
 * anything else is null (it fails, and the checks send it to review).
 */
export function normalizeBandColumn(cells: readonly (number | null | undefined)[]): Bands6 | null {
  if (cells.length !== 6) return null;
  if (cells.every((c) => c === null || c === undefined)) return null;
  const v = cells.map((c) => c ?? 0);
  if (v.some((x) => x < 0)) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  if (sum === 0) return null;
  const scaled = Math.abs(sum - 1) <= 0.01 ? v : Math.abs(sum - 100) <= 1 ? v.map((x) => x / 100) : null;
  return scaled ? (scaled.map((x) => Math.round(x * 10000) / 10000) as Bands6) : null;
}

/**
 * Bands agree with percentiles (Checks): for p = 25 and 75, the band holding the p-th percentile satisfies share below
 * ≤ p ≤ share through, ± 2 points. True when there's nothing to compare.
 */
export function bandsAgreeWithPercentiles(bands: Bands6, pct: Pct3 | null, test: BandTest): boolean {
  for (const [p, v] of [
    [0.25, pct?.p25],
    [0.75, pct?.p75],
  ] as const) {
    if (v === null || v === undefined) continue;
    const i = bandOf(v, test);
    if (i === null) return false;
    if (shareBelow(bands, i) > p + 0.02 || shareThrough(bands, i) < p - 0.02) return false;
  }
  return true;
}

/** Checks, "Composite vs sections": |composite − (EBRW + Math)| at each percentile with all three present. */
export const COMPOSITE_TOLERANCE = 50;

/** The percentiles where the college's SAT total and its section sum disagree by more than the tolerance. */
export function compositeVsSections(composite: Pct3 | null, ebrw: Pct3 | null, math: Pct3 | null, tolerance = COMPOSITE_TOLERANCE): ("p25" | "p50" | "p75")[] {
  const out: ("p25" | "p50" | "p75")[] = [];
  for (const p of ["p25", "p50", "p75"] as const) {
    const c = composite?.[p];
    const e = ebrw?.[p];
    const m = math?.[p];
    if (c == null || e == null || m == null) continue;
    if (Math.abs(c - (e + m)) > tolerance) out.push(p);
  }
  return out;
}

/** Checks, "Number vs share": |stated share − number ÷ C1 enrolled| ≤ 1 point, and number ≤ enrolled. */
export function submittersAgree(n: number, share: number, enrolled: number): boolean {
  return n <= enrolled && Math.abs(share - n / enrolled) <= 0.01;
}

const pctText = (x: number) => `${Math.round(x * 100)}%`;

/**
 * The score-band sentence: the top band's share when it's ≥ 10% ("23% of enrolled first-years who sent an SAT scored
 * 1400 or higher"), else the largest band ("91% scored 1000–1399"); when one band holds ≥ 90%, "Nearly all who sent an
 * SAT (98%) scored 1400 or higher".
 */
export function bandsSentence(bands: Bands6, test: BandTest): string {
  const t = BAND_TEST_LABELS[test].test;
  const scored = (i: number) => (i === 0 ? `${BAND_EDGES[test][0].lo} or higher` : bandLabel(test, i));
  const largest = bands.reduce((best, v, i) => (v > bands[best] ? i : best), 0);
  if (bands[largest] >= 0.9) return `Nearly all who sent an ${t} (${pctText(bands[largest])}) scored ${scored(largest)}.`;
  if (bands[0] >= 0.1) return `${pctText(bands[0])} of enrolled first-years who sent an ${t} scored ${scored(0)}.`;
  return `${pctText(bands[largest])} of enrolled first-years who sent an ${t} scored ${scored(largest)}.`;
}

/** True when one band holds ≥ 90%: the sentence alone says it, a bar adds nothing. */
export function oneBandDominates(bands: Bands6): boolean {
  return bands.some((v) => v >= 0.9);
}

/**
 * The ScoreChecker line for a typed score: "Your score is in the 1400–1600 band, where 74% of enrolled first-years who
 * sent an SAT scored. 26% scored below 1400."
 */
export function yourBandSentence(score: number, bands: Bands6, test: BandTest): string | null {
  const i = bandOf(score, test);
  if (i === null) return null;
  const t = BAND_TEST_LABELS[test].test;
  const below = shareBelow(bands, i);
  const lo = BAND_EDGES[test][i].lo;
  const tail = i === bands.length - 1 ? "" : ` ${pctText(below)} scored below ${lo === 1 ? 6 : lo}.`;
  return `Your score is in the ${bandLabel(test, i)} band, where ${pctText(bands[i])} of enrolled first-years who sent an ${t} scored.${tail}`;
}

/** The caveat under the bands: "Shares of the 24% of first-years who sent an SAT; …". */
export function bandsCaveat(share: number | null, test: "SAT" | "ACT"): string {
  const who = share !== null ? `the ${pctText(share)} of first-years who sent an ${test}` : `first-years who sent an ${test}`;
  return `Shares of ${who}; students who didn't send scores aren't in these bands.`;
}

/* ------------------------------------------------------------------ */
/* The SAT total a college shows (Decision 3, "One SAT total per view") */
/* ------------------------------------------------------------------ */

/** The fall a lineage year describes: "Fall 2025" → 2025, "2025-26" / "2025–26" → 2025. */
export function lineageFall(year: string | null | undefined): number | null {
  const m = /(\d{4})/.exec(year ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * True when the college's SAT sections come from the same Common Data Set class as its reported C9 (a block the newest
 * merge replaced, or a hand-imported override of the same edition) and that CDS reports its own total.
 */
export function satTotalFromCds(s: Pick<School, "admissions" | "reported" | "lineage">): boolean {
  const t = s.reported?.tests;
  const c = t?.sat_composite;
  if (!t || c?.p25 == null || c.p75 == null) return false;
  const rec = s.lineage?.["admissions.sat_reading_25_75"];
  return (rec?.source === "college-site" || rec?.source === "cds") && lineageFall(rec.year) === t.year;
}

/**
 * `derived.sat_total`: the college's own SAT total 25th–75th when its SAT block came from a CDS that reports one, else
 * the sum of sections. Drawn wherever a college's own range is (ScoreChecker, card bar, Compare); never ranked: ranks,
 * medians, sorts, and filters keep `satComposite` (the sum) for every college.
 */
export function satTotal(s: Pick<School, "admissions" | "reported" | "lineage">): [number, number] | null {
  if (satTotalFromCds(s)) {
    const c = s.reported!.tests!.sat_composite!;
    return [c.p25!, c.p75!];
  }
  const r = s.admissions.sat_reading_25_75;
  const m = s.admissions.sat_math_25_75;
  return r && m ? [r[0] + m[0], r[1] + m[1]] : null;
}

/** The SAT total's median ring: the CDS composite 50th with the CDS total, else the sum of section medians. */
export function satTotalMedian(s: Pick<School, "admissions" | "reported" | "lineage">): number | null {
  if (satTotalFromCds(s)) return s.reported!.tests!.sat_composite!.p50;
  const { sat_reading_median: r, sat_math_median: m } = s.admissions;
  return r != null && m != null ? r + m : null;
}

/** A test's submitters as known: the number, else share × enrolled. */
export function submitters(n: number | null | undefined, share: number | null | undefined, enrolled: number | null | undefined): number | null {
  if (n != null) return n;
  return share != null && enrolled != null ? Math.round(share * enrolled) : null;
}
