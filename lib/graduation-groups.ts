/**
 * Graduation by group (specs/data-expansion/graduation-by-group.md): 6-year graduation rates for Pell Grant recipients,
 * subsidized-loan recipients without a Pell Grant, and students with neither (IPEDS GR{Y}_PELL_SSL), and by
 * race/ethnicity (College Scorecard `completion_rate_4yr_150_*`). Pure: sync-data, sync-history, tests, and the app
 * share it, so history's last point always matches the snapshot.
 */
import type { School } from "./types";

type Row = Record<string, string> | undefined;

/** Groups smaller than this (in the adjusted cohort) get no rate: a few students swing it by many points. */
export const MIN_GROUP_COHORT = 30;

/**
 * `GR{Y}_PELL_SSL` has one row per college per cohort type. PSGRTYPE 1 is the total cohort at a 4-year college
 * (bachelor's and other degree-seeking students), and its completers within 150% of normal time (`…CMTOT`) are exactly
 * College Scorecard's `completion_rate_4yr_150nt` (all 1,767 colleges matched, GR2024 vs. Scorecard 2024, 2026-10-02).
 */
export const GR_PELL_COHORT_TYPE = "1";

export type AidGroup = "pell" | "loan_no_pell" | "no_pell_no_loan" | "total";
/** Column prefixes: PG Pell recipients, SS subsidized loan without Pell, NR neither, TT all students. */
export const AID_GROUP_PREFIX: Record<AidGroup, string> = { pell: "PG", loan_no_pell: "SS", no_pell_no_loan: "NR", total: "TT" };
export const AID_GROUPS = Object.keys(AID_GROUP_PREFIX) as AidGroup[];
/** Every column the snapshot and history read (adjusted cohort and completers within 150%), for the header check. */
export const GR_PELL_COLUMNS: readonly string[] = ["PSGRTYPE", ...Object.values(AID_GROUP_PREFIX).flatMap((p) => [`${p}ADJCT`, `${p}CMTOT`])];

export const AID_GROUP_LABELS: Record<AidGroup, string> = {
  pell: "Pell Grant recipients",
  loan_no_pell: "Subsidized loan, no Pell Grant",
  no_pell_no_loan: "Neither Pell nor subsidized loan",
  total: "All students",
};

/** Race/ethnicity groups stored, in the site's category order (lib/metrics.ts DEMOGRAPHIC_CATEGORIES), then the small two. */
export const RACE_GROUPS = ["white", "asian", "hispanic", "black", "two_or_more", "international", "aian", "nhpi"] as const;
export type RaceGroup = (typeof RACE_GROUPS)[number];
export const RACE_GROUP_LABELS: Record<RaceGroup, string> = {
  white: "White",
  asian: "Asian",
  hispanic: "Hispanic/Latino",
  black: "Black",
  two_or_more: "Two or more races",
  international: "International",
  aian: "American Indian/Alaska Native",
  nhpi: "Native Hawaiian/Pacific Islander",
};

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

function count(row: Row, key: string): number | null {
  const v = row?.[key];
  if (v === undefined || v === "" || v === ".") return null;
  const n = Number(v);
  // IPEDS codes -1/-2/-3 (not reported, not applicable, not available) are missing, never 0.
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Completers ÷ cohort, or null when the cohort is under MIN_GROUP_COHORT or a count is missing. */
export function groupRate(completers: number | null, cohort: number | null): number | null {
  if (completers === null || cohort === null || cohort < MIN_GROUP_COHORT || completers > cohort) return null;
  return round4(completers / cohort);
}

export interface AidGroupGrad {
  rates: Record<AidGroup, number | null>;
  /** Adjusted cohort sizes, kept even when the rate is suppressed (they explain why). */
  cohorts: Record<AidGroup, number | null>;
}

/** Rates and cohorts from a college's PSGRTYPE 1 row; null when it has none or reports no cohort at all. */
export function aidGroupGradFrom(row: Row): AidGroupGrad | null {
  if (!row || row.PSGRTYPE !== GR_PELL_COHORT_TYPE) return null;
  const rates = {} as AidGroupGrad["rates"];
  const cohorts = {} as AidGroupGrad["cohorts"];
  for (const g of AID_GROUPS) {
    const p = AID_GROUP_PREFIX[g];
    cohorts[g] = count(row, `${p}ADJCT`);
    rates[g] = groupRate(count(row, `${p}CMTOT`), cohorts[g]);
  }
  return cohorts.total === null || cohorts.total === 0 ? null : { rates, cohorts };
}

/** College Scorecard completion suffix per stored group (scripts/history/scorecard.mts uses the same map). */
export const RACE_SCORECARD_SUFFIX: Record<RaceGroup, string> = {
  white: "white",
  black: "black",
  hispanic: "hispanic",
  asian: "asian",
  two_or_more: "2ormore",
  international: "nonresident.alien",
  aian: "aian",
  nhpi: "nhpi",
};
export const scorecardRaceRateField = (g: RaceGroup) => `completion.completion_rate_4yr_150_${RACE_SCORECARD_SUFFIX[g]}`;
export const scorecardRaceCohortField = (g: RaceGroup) => `completion.completion_cohort_4yr_150_${RACE_SCORECARD_SUFFIX[g]}`;

/**
 * Rates and cohorts by race/ethnicity from Scorecard values (`get` reads one field, without its year prefix). Rates are
 * kept only for groups of MIN_GROUP_COHORT or more; null when no group has a cohort.
 */
export function raceGradFrom(get: (field: string) => number | null | undefined): { rates: Record<RaceGroup, number | null>; cohorts: Record<RaceGroup, number | null> } | null {
  const rates = {} as Record<RaceGroup, number | null>;
  const cohorts = {} as Record<RaceGroup, number | null>;
  for (const g of RACE_GROUPS) {
    const c = get(scorecardRaceCohortField(g));
    const r = get(scorecardRaceRateField(g));
    cohorts[g] = typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : null;
    const ok = typeof r === "number" && Number.isFinite(r) && r >= 0 && r <= 1 && cohorts[g] !== null && cohorts[g]! >= MIN_GROUP_COHORT;
    rates[g] = ok ? round4(r as number) : null;
  }
  return RACE_GROUPS.some((g) => cohorts[g] !== null && cohorts[g]! > 0) ? { rates, cohorts } : null;
}

/* ------------------------------------------------------------------ */
/* Gaps                                                                */
/* ------------------------------------------------------------------ */

/**
 * The Pell graduation gap, in points: students with neither a Pell Grant nor a subsidized loan minus Pell recipients.
 * Positive = Pell recipients graduate less often. Null unless both rates are reported, and when they're implausibly
 * far apart (see MAX_PLAUSIBLE_GAP).
 */
/** Whether the profile has anything to show in "Graduation by group". */
export function hasGradByGroup(s: Pick<School, "outcomes">): boolean {
  const o = s.outcomes;
  return o?.grad_rate_pell != null || o?.grad_rate_no_pell_no_loan != null || RACE_GROUPS.some((g) => o?.grad_rate_by_race?.[g] != null);
}

export function pellGap(s: Pick<School, "outcomes">): number | null {
  const g = rawPellGap(s);
  return g === null || Math.abs(g) > MAX_PLAUSIBLE_GAP ? null : g;
}

/**
 * Gaps beyond 40 points either way (about 20 colleges in GR2024: Pell recipients 99% vs. "neither" 0% of 49 students)
 * almost always mean a college sorted students into the groups inconsistently, not a real difference. The rates are
 * still shown as reported, with a caution; the gap isn't ranked, filtered, or charted as a change.
 */
export const MAX_PLAUSIBLE_GAP = 0.4;

/** The gap as reported, without the plausibility check (for the profile's caution). */
export function rawPellGap(s: Pick<School, "outcomes">): number | null {
  const o = s.outcomes;
  const pell = o?.grad_rate_pell ?? null;
  const neither = o?.grad_rate_no_pell_no_loan ?? null;
  return pell === null || neither === null ? null : round4(neither - pell);
}

/** Explore's "Pell gap under 5 points" filter. Pell recipients graduating more often counts as under. */
export const SMALL_PELL_GAP = 0.05;
export function hasSmallPellGap(s: Pick<School, "outcomes">): boolean {
  const g = pellGap(s);
  return g !== null && g < SMALL_PELL_GAP;
}

/** "Known for": Pell students graduate at the same rate (spec: gap ≤ 2 points, 100+ Pell students, overall ≥ 60%). */
export const SAME_RATE = { maxGap: 0.02, minPellCohort: 100, minOverall: 0.6 } as const;
export function pellGraduateAtSameRate(s: Pick<School, "outcomes">): boolean {
  const g = pellGap(s);
  const o = s.outcomes;
  return (
    g !== null &&
    g <= SAME_RATE.maxGap + 1e-9 &&
    (o?.grad_cohorts?.pell ?? 0) >= SAME_RATE.minPellCohort &&
    (o?.grad_rate_ftft ?? 0) >= SAME_RATE.minOverall
  );
}

/** A table cell: "89%", "Under 30 students" when suppressed for size, or null when not reported. */
export function gradRateCell(rate: number | null | undefined, cohort: number | null | undefined): string | null {
  if (rate != null) return `${Math.round(rate * 100)}%`;
  return cohort != null && cohort > 0 && cohort < MIN_GROUP_COHORT ? `Under ${MIN_GROUP_COHORT} students` : null;
}

/** "5 points below", "2 points above", "the same as": how a group's rate compares with a reference rate. */
export function gapPhrase(rate: number, reference: number): string {
  const pts = Math.round((rate - reference) * 100);
  if (pts === 0) return "the same as";
  return `${Math.abs(pts)} point${Math.abs(pts) === 1 ? "" : "s"} ${pts < 0 ? "below" : "above"}`;
}

/* ------------------------------------------------------------------ */
/* History: 3-cohort rolling average                                   */
/* ------------------------------------------------------------------ */

/**
 * Cohort-weighted average of each year and the two before it (completers ÷ students over up to three entering classes).
 * A year needs its own rate and at least one earlier one, each with its cohort size; otherwise null. With no cohort
 * series, classes are weighted equally. Rates and cohorts
 * are aligned arrays starting at `start` (history series), so the result lines up with them.
 */
export function rollingRate(
  rates: { start: number; values: readonly (number | null)[] },
  cohorts: { start: number; values: readonly (number | null)[] } | undefined
): { start: number; values: (number | null)[] } {
  const at = (s: { start: number; values: readonly (number | null)[] } | undefined, y: number) => {
    if (!s) return null;
    const i = y - s.start;
    return i >= 0 && i < s.values.length ? s.values[i] : null;
  };
  const values = rates.values.map((own, i) => {
    const y = rates.start + i;
    if (own === null) return null;
    let students = 0;
    let completers = 0;
    let years = 0;
    for (let k = 0; k < 3; k++) {
      const r = at(rates, y - k);
      // Without cohort sizes (the overall rate), each class counts equally.
      const c = cohorts ? at(cohorts, y - k) : 1;
      if (r === null || c === null || c <= 0) continue;
      students += c;
      completers += r * c;
      years++;
    }
    return years >= 2 && students > 0 ? round4(completers / students) : null;
  });
  return { start: rates.start, values };
}
