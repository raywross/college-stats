/**
 * Outcome Measures (specs/data-expansion/outcome-measures.md): what happened, 8 years after entry, to every student who
 * started at a college, including part-timers and transfer students. Pure: sync-data, history, and tests share it, so
 * history's last point always matches the snapshot.
 *
 * The IPEDS OM file has one row per college per cohort (`OMCHRT`). scripts/lib/om.mts pivots those rows into one row
 * per college with columns suffixed by cohort, e.g. `OMACHRT_50` is the adjusted cohort of all entering students.
 */
import type { EightYearGroup, EightYearOutcomes, School } from "./types";

type Row = Record<string, string> | undefined;

/** The OM column holding the cohort code; scripts/lib/om.mts pivots on it. */
export const OM_PIVOT = "OMCHRT";

/** The OM cohort codes read (probed 2026-10-02: the same codes in OM2017 through OM2024). */
export const OM_COHORTS = {
  all: 50,
  pell: 51,
  non_pell: 52,
  first_time_full_time: 10,
  first_time_part_time: 20,
  transfer_full_time: 30,
  transfer_part_time: 40,
} as const;

/**
 * Columns read from every cohort: adjusted cohort, awards by 8 years, the 8-year status of those without one, and awards
 * by 4 and 6 years (specs/data-expansion/time-to-degree.md). sync-data and history stop if any is missing.
 */
export const OM_COLUMNS = ["OMACHRT", "OMAWDN8", "OMENRYI", "OMENRAI", "OMENRUN", "OMAWDN4", "OMAWDN6"] as const;

/** Under this many students in an adjusted cohort, its rates aren't shown (the rule College Scorecard uses). */
export const MIN_COHORT = 30;

/** OM{Y} follows students who entered in fall Y − 8. */
export const OM_LAG = 8;

/** The first OM file with Pell cohorts and the 8-year status split (OM2015 and OM2016 used other cohort codes). */
export const OM_FIRST_FILE = 2017;

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

function count(row: Row, col: string, cohort: number): number | null {
  const v = row?.[`${col}_${cohort}`];
  if (v === undefined || v === "" || v === ".") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Counts for one or more cohorts, summed (first-time = full-time + part-time). A cohort without a row counts as 0. */
function counts(row: Row, cohorts: readonly number[]) {
  const sum = (col: string) => {
    let total = 0;
    for (const c of cohorts) {
      const v = count(row, col, c);
      // A row present with a blank in a counted column is unreadable, not zero.
      if (v === null && count(row, "OMACHRT", c) !== null) return null;
      total += v ?? 0;
    }
    return total;
  };
  return {
    counts: { cohort: sum("OMACHRT"), award: sum("OMAWDN8"), still: sum("OMENRYI"), elsewhere: sum("OMENRAI"), unknown: sum("OMENRUN") },
    // Kept apart: a blank here only loses time-to-degree, never the 8-year outcomes.
    award4: sum("OMAWDN4"),
    award6: sum("OMAWDN6"),
  };
}

/**
 * Awards by 4, 6, and 8 years are cumulative in OM (probed 2026-10-02: every site row of OM2017 and OM2024). If a
 * refreshed file ever breaks that, the 4- and 6-year shares are dropped rather than showing an impossible step down.
 */
export function isCumulative(award4: number | null, award6: number | null, award8: number | null): boolean {
  return award4 !== null && award6 !== null && award8 !== null && award4 <= award6 && award6 <= award8;
}

/** One group's 8-year outcome shares. Rates are null under MIN_COHORT; null when no one is in the group. */
function groupFrom(row: Row, cohorts: readonly number[]): EightYearGroup | null {
  const { counts: c, award4, award6 } = counts(row, cohorts);
  // An unreadable count (a blank in a present row) makes the whole group unreadable: shares wouldn't sum to 1.
  if (c.cohort === null || c.cohort <= 0 || Object.values(c).some((v) => v === null)) return null;
  const n = c.cohort;
  const share = (v: number | null) => (n < MIN_COHORT || v === null ? null : round4(v / n));
  const timely = isCumulative(award4, award6, c.award);
  return {
    cohort: n,
    award: share(c.award),
    award_4: timely ? share(award4) : null,
    award_6: timely ? share(award6) : null,
    still_enrolled: share(c.still),
    transferred: share(c.elsewhere),
    unknown: share(c.unknown),
  };
}

/** Award rates only (Pell, non-Pell). */
function awardFrom(row: Row, cohort: number): Pick<EightYearGroup, "cohort" | "award" | "award_4" | "award_6"> | null {
  const g = groupFrom(row, [cohort]);
  return g && { cohort: g.cohort, award: g.award, award_4: g.award_4, award_6: g.award_6 };
}

/** A college's 8-year outcomes from its pivoted OM row; null when the college isn't in the file. */
export function eightYearFrom(row: Row, enteringYear: number): EightYearOutcomes | null {
  const all = groupFrom(row, [OM_COHORTS.all]);
  if (!all) return null;
  return {
    entering_year: enteringYear,
    all,
    first_time: groupFrom(row, [OM_COHORTS.first_time_full_time, OM_COHORTS.first_time_part_time]),
    transfer_in: groupFrom(row, [OM_COHORTS.transfer_full_time, OM_COHORTS.transfer_part_time]),
    pell: awardFrom(row, OM_COHORTS.pell),
    non_pell: awardFrom(row, OM_COHORTS.non_pell),
  };
}

/** The four outcomes in display order: the order they stack, and the order of the legend. */
export const OUTCOME_PARTS = [
  { key: "award", label: "Earned a degree or certificate here" },
  { key: "still_enrolled", label: "Still enrolled here" },
  { key: "transferred", label: "Enrolled at another college" },
  { key: "unknown", label: "Left, no record of enrolling elsewhere" },
] as const satisfies readonly { key: keyof EightYearGroup; label: string }[];

export type OutcomeGroupKey = "all" | "first_time" | "transfer_in";
export const OUTCOME_GROUPS: readonly { key: OutcomeGroupKey; label: string; who: string }[] = [
  { key: "all", label: "All students", who: "students who start here" },
  { key: "first_time", label: "Started in college here", who: "first-time students who start here" },
  { key: "transfer_in", label: "Transferred in", who: "students who transfer in" },
];

/** A group whose rates are shown (big enough cohort, all four shares reported). */
export function isShown(g: EightYearGroup | null | undefined): g is EightYearGroup & Record<"award" | "still_enrolled" | "transferred" | "unknown", number> {
  return !!g && g.award !== null && g.still_enrolled !== null && g.transferred !== null && g.unknown !== null;
}

/** Share of all entering students with a degree or certificate within 8 years (Explore's column). */
export function completion8(s: Pick<School, "outcomes">): number | null {
  return s.outcomes?.eight_year?.all.award ?? null;
}

/** Share of all entering students with a degree or certificate within 4 years (time-to-degree; Explore's sort). */
export function completion4(s: Pick<School, "outcomes">): number | null {
  return s.outcomes?.eight_year?.all.award_4 ?? null;
}

/** "62 of 100 finish within 4 years, 74 within 6, and 76 within 8." Null unless all three are shown. */
export function timeToDegreeHeadline(g: EightYearGroup | null | undefined): string | null {
  if (!g || g.award_4 == null || g.award_6 == null || g.award == null) return null;
  const [a4, a6, a8] = [g.award_4, g.award_6, g.award].map((v) => Math.round(v * 100));
  return `${a4} of 100 finish within 4 years, ${a6} within 6, and ${a8} within 8.`;
}

/** Shown 8-year groups (all, first-time, transfer-in) across colleges, and how many lack 4/6-year shares; sync-data's guard. */
export function timeToDegreeCoverage(schools: readonly Pick<School, "outcomes">[]): { shown: number; missing: number } {
  let shown = 0;
  let missing = 0;
  for (const s of schools) {
    const o = s.outcomes?.eight_year;
    for (const g of [o?.all, o?.first_time, o?.transfer_in]) {
      if (!g || g.award == null) continue;
      shown++;
      if (g.award_4 == null || g.award_6 == null) missing++;
    }
  }
  return { shown, missing };
}

/** Share of all entering students enrolled at another college 8 years on (transfer-out). */
export function transferOut8(s: Pick<School, "outcomes">): number | null {
  return s.outcomes?.eight_year?.all.transferred ?? null;
}

/** Of students who left without a credential, the share who enrolled at another college (null when few left). */
export function leaversElsewhere(g: EightYearGroup | null | undefined): number | null {
  if (!isShown(g)) return null;
  const left = g.transferred + g.unknown;
  // Under 5% leaving, the split says little (a handful of students).
  return left < 0.05 ? null : g.transferred / left;
}

/** "93 of 100 students who start here earn a degree or certificate within 8 years; 4 more are enrolled at another college." */
export function outcomeHeadline(g: EightYearGroup, who = "students who start here"): string | null {
  if (!isShown(g)) return null;
  const award = Math.round(g.award * 100);
  const elsewhere = Math.round(g.transferred * 100);
  const first = `${award} of 100 ${who} earn a degree or certificate here within 8 years`;
  return elsewhere > 0 ? `${first}; ${elsewhere} more ${elsewhere === 1 ? "is" : "are"} enrolled at another college.` : `${first}.`;
}
