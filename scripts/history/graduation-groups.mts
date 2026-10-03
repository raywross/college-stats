/**
 * Rule 1 for graduation by group (specs/data-expansion/graduation-by-group.md): the newest entering class in history
 * equals what the profile shows, for the Pell/loan rates (IPEDS GR{Y}_PELL_SSL) and the race/ethnicity rates
 * (College Scorecard). Same "unit_id series: history X, snapshot Y" format as lastPointMismatches in build.mts, so
 * sync-history and the tests run both through ruleOneProblems.
 */
import type { School } from "../../lib/types.ts";
import { GRAD_RACE_SERIES, lastYear, valueAt, type SchoolHistory, type SeriesKey } from "../../lib/history.ts";

const same = (a: number, b: number) => Math.abs(a - b) < 1e-4;

/** The newest year any college's series reaches: the class the snapshot's file describes. */
function newestYear(histories: ReadonlyMap<string, SchoolHistory>, key: SeriesKey): number | null {
  const years = [...histories.values()].flatMap((h) => (h.series[key] ? [lastYear(h.series[key]!)] : []));
  return years.length ? Math.max(...years) : null;
}

export function gradByGroupMismatches(schools: readonly School[], histories: ReadonlyMap<string, SchoolHistory>): string[] {
  const out: string[] = [];
  // Cohort sizes are reported for (nearly) every college, so their newest year is the newest file's class.
  const grYear = newestYear(histories, "grad_cohort_pell");
  const raceYear = Math.max(...Object.values(GRAD_RACE_SERIES).map(([, cohort]) => newestYear(histories, cohort) ?? -Infinity));
  for (const s of schools) {
    const h = histories.get(s.unit_id);
    if (!h) continue;
    const o = s.outcomes;
    const check = (key: SeriesKey, year: number | null, snapshot: number | null | undefined) => {
      if (year === null || !Number.isFinite(year)) return;
      const hv = valueAt(h.series[key], year);
      const sv = snapshot ?? null;
      if (hv === null && sv === null) return;
      if (hv === null || sv === null || !same(hv, sv)) out.push(`${s.unit_id} ${key}: history ${hv ?? "none"}, snapshot ${sv ?? "none"}`);
    };
    // History stays federal (specs/data-expansion/cds-student-body-and-outcomes.md): where a newer CDS class replaced
    // the Pell/loan rates, compare with the kept federal class in outcomes.federal.graduation, not the shown one.
    const gr = o?.federal?.graduation ?? o;
    check("grad_rate_pell", grYear, gr?.grad_rate_pell);
    check("grad_rate_no_pell_no_loan", grYear, gr?.grad_rate_no_pell_no_loan);
    check("grad_cohort_pell", grYear, gr?.grad_cohorts?.pell);
    check("grad_cohort_no_pell_no_loan", grYear, gr?.grad_cohorts?.no_pell_no_loan);
    for (const [group, [rate, cohort]] of Object.entries(GRAD_RACE_SERIES)) {
      const g = group as keyof typeof GRAD_RACE_SERIES;
      check(rate, raceYear, o?.grad_rate_by_race?.[g]);
      check(cohort, raceYear, o?.grad_cohorts_by_race?.[g]);
    }
  }
  return out;
}
