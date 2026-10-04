/**
 * Showing CDS Greek life, phase 1 (specs/greek-life.md): the profile's "Greek life" block (BenchmarkBars against the
 * median of reporting colleges), Compare's two undergrad-percentage rows, and Explore's "Fraternity or sorority
 * participation" filter. Reads `school.reported.greek` (stored by lib/cds/greek.ts).
 *
 * Partial coverage: none of this feeds METRICS, ranks, medians, percentile strips, sorts, the radar, Key
 * differences, or "Known for" (tests/cds-greek.test.mts guards it). "Known for: Big Greek life" (spec's Where it
 * appears) isn't built: with 10 colleges in the round-3 pilot and 7 reporting F1, a top decile would be 1 college —
 * not meaningful. Revisit once at least `KNOWN_FOR_MIN_REPORTERS` colleges report an undergrad percentage.
 *
 * Pure (imports only pure modules), so client components and Node tests load it directly.
 */
import type { ReportedGreek, School } from "../types";
import { pctSmart } from "../format.ts";

/** "Known for: Big Greek life" waits for at least this many colleges to report an undergrad percentage (spec Open questions). */
export const KNOWN_FOR_MIN_REPORTERS = 50;

/** Either undergrad percentage reported (never summed: spec Rules, "never add the two percents"). */
export function hasGreekParticipation(s: Pick<School, "reported">): boolean {
  const g = s.reported?.greek;
  return !!g && (g.frat_pct_undergrad !== null || g.sor_pct_undergrad !== null);
}

/** Colleges with an undergrad fraternity or sorority percentage, for benchmark medians and the "how many report" line. */
export function greekReporters(schools: readonly Pick<School, "reported">[]): Pick<School, "reported">[] {
  return schools.filter(hasGreekParticipation);
}

/** The median undergrad fraternity percentage among colleges that report it; null without any. */
export function fratMedian(schools: readonly Pick<School, "reported">[]): number | null {
  return medianOf(schools.map((s) => s.reported?.greek?.frat_pct_undergrad ?? null));
}

/** The median undergrad sorority percentage among colleges that report it; null without any. */
export function sorMedian(schools: readonly Pick<School, "reported">[]): number | null {
  return medianOf(schools.map((s) => s.reported?.greek?.sor_pct_undergrad ?? null));
}

function medianOf(values: readonly (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/* ------------------------------------------------------------------ */
/* Profile block                                                       */
/* ------------------------------------------------------------------ */

export interface GreekCardModel {
  g: ReportedGreek;
  frat: { firstYear: number | null; undergrad: number | null } | null;
  sor: { firstYear: number | null; undergrad: number | null } | null;
  housing: boolean | null;
}

/** The profile's "Greek life" block model, or null without any F1 percentage or F4 answer. */
export function greekCard(s: Pick<School, "reported">): GreekCardModel | null {
  const g = s.reported?.greek;
  if (!g) return null;
  const any = g.frat_pct_first_year !== null || g.frat_pct_undergrad !== null || g.sor_pct_first_year !== null || g.sor_pct_undergrad !== null || g.housing !== null;
  if (!any) return null;
  const frat = g.frat_pct_first_year !== null || g.frat_pct_undergrad !== null ? { firstYear: g.frat_pct_first_year, undergrad: g.frat_pct_undergrad } : null;
  const sor = g.sor_pct_first_year !== null || g.sor_pct_undergrad !== null ? { firstYear: g.sor_pct_first_year, undergrad: g.sor_pct_undergrad } : null;
  return { g, frat, sor, housing: g.housing };
}

/* ------------------------------------------------------------------ */
/* Compare: "All the numbers" (the two undergrad percentages, spec's Where it appears)                              */
/* ------------------------------------------------------------------ */

/** "16%", or null (shown blank, never 0) without a reported fraternity percentage. */
export function compareFratPct(s: Pick<School, "reported">): string | null {
  const v = s.reported?.greek?.frat_pct_undergrad;
  return v == null ? null : pctSmart(v);
}

/** "23%", or null (shown blank, never 0) without a reported sorority percentage. */
export function compareSorPct(s: Pick<School, "reported">): string | null {
  const v = s.reported?.greek?.sor_pct_undergrad;
  return v == null ? null : pctSmart(v);
}

/* ------------------------------------------------------------------ */
/* Explore: "Fraternity or sorority participation ≥ X%" (reporting colleges only)                                    */
/* ------------------------------------------------------------------ */

/** Explore's participation chips: at least this share of undergrad men or women. */
export const MIN_GREEK_OPTIONS = [0.1, 0.2, 0.3] as const;

/**
 * At least `min` of undergrad men join fraternities, or undergrad women join sororities (never summed). A college
 * that doesn't report either percentage never matches, however low `min` is.
 */
export function meetsGreekThreshold(s: Pick<School, "reported">, min: number): boolean {
  const g = s.reported?.greek;
  if (!g) return false;
  return (g.frat_pct_undergrad ?? -1) >= min || (g.sor_pct_undergrad ?? -1) >= min;
}

export const GREEK_FILTER_LABEL = "Fraternity or sorority participation";
