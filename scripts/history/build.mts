/**
 * The history build's pure steps: rows → per-college series → national distributions → Home facts, plus the checks
 * that stop a bad build (specs/trends-data.md#pipeline-npm-run-sync-history). No I/O, so tests drive it with
 * fixture rows. `scripts/sync-history.mts` does the fetching and writing.
 */
import type { AdmissionFactor, School } from "../../lib/types.ts";
import { FIELDS, isFieldPath, type FieldPath } from "../../lib/fields.ts";
import type { IpedsRow } from "../../lib/derive.ts";
import { FACTOR_CODE, FACTOR_COLUMNS, FACTOR_ERA, acceptanceRate, admitRatesBySex, applicationFeeFrom, computePrices, housingFrom, netPriceByIncome, promiseProgramFrom, raceShares, satMedian, toAid, tuitionPlansFrom, yieldOf } from "../../lib/derive.ts";
import {
  GRAD_RACE_SERIES,
  FULL_TIME_FACULTY_FROM,
  FINANCE_FROM,
  NET_PRICE_BANDS,
  RACE_FROM,
  RACE_SERIES,
  SERIES,
  TEST_POLICY_CODES,
  lastYear,
  latestPoint,
  SERIES_KEYS,
  changeOver,
  historyYearLabel,
  real,
  valueAt,
  isCategorical,
  type ChangeStats,
  type CpiTable,
  type HistoryFamily,
  type NationalHistory,
  type SchoolHistory,
  type Series,
  type SeriesKey,
  type TrendFacts,
  type YearKind,
  type YearStats,
} from "../../lib/history.ts";
import { readSpec, type ColumnSpec, type Era, type FileChoice } from "./registry.mts";
import { associationCode, footballConferenceCode, mainConferenceCode, rotcCode } from "../../lib/campus-services.ts";
import { facultySalaryFrom, studentFacultyRatioFrom } from "../../lib/academics.ts";
import { instructionSpending } from "../../lib/finances.ts";
import { eightYearFrom } from "../../lib/outcome-measures.ts";
import { aidGroupGradFrom, raceGradFrom } from "../../lib/graduation-groups.ts";
import { residenceFrom } from "../../lib/residence.ts";
import { transferInFrom } from "../../lib/transfers.ts";
import { MAJOR_FAMILY_CODES, familiesFromRow, isMajorFamily, type MajorFamily } from "../../lib/majors.ts";
import { majorSeriesKey } from "../../lib/history.ts";
import { seriesStep } from "../../lib/history.ts";
import { COHORT_LAG, type ScorecardRow } from "./scorecard.mts";

/** One year of one family, read. */
export interface YearTable {
  year: number;
  family: HistoryFamily;
  rows: ReadonlyMap<string, IpedsRow>;
  /** Price files: the column suffix holding this year. */
  suffix?: "2" | "3";
  /** Admissions: where applicants/admitted/enrolled are. */
  values?: Record<string, ColumnSpec>;
}

export interface Inputs {
  admissions: readonly YearTable[];
  prices: readonly YearTable[];
  sfa: readonly YearTable[];
  /** Housing and policy columns (IC{Y}, then COST1_{Y+1}), one table per academic year. */
  characteristics?: readonly YearTable[];
  /** Athletics and ROTC columns (IC{Y}), one table per academic year. */
  services?: readonly YearTable[];
  /** Student-to-faculty ratio (EF{Y}D), one table per fall. */
  efd?: readonly YearTable[];
  /** 8-year outcomes (OM{Y+8}, pivoted by cohort), one table per entering fall. */
  om?: readonly YearTable[];
  /** Faculty salary, all-ranks row (SAL{Y}_IS), one table per fall. */
  sal?: readonly YearTable[];
  /** Residence of first-years (EF{Y}C pivoted to one wide row per college), one table per even-numbered fall. */
  efc?: readonly YearTable[];
  /** Transfers in (EF{Y}A pivoted to one wide row per college by level), one table per fall. */
  efa?: readonly YearTable[];
  /** Completions (C{Y+1}_A summed to first-major bachelor's by family, lib/majors.ts familyColumn), one per school year. */
  ca?: readonly YearTable[];
  /** College Scorecard year-prefixed values by unit ID (scripts/history/scorecard.mts), and the years requested. */
  scorecard?: { rows: ReadonlyMap<string, ScorecardRow>; first: number; last: number };
  /** Graduation by Pell and loan status (GR{Y+6}_PELL_SSL), one table per entering class. */
  grPell?: readonly YearTable[];
  /** Graduation by race/ethnicity: Scorecard year-prefixed completion fields (scorecard.mts gradByRaceFields). */
  scorecardGradRace?: { rows: ReadonlyMap<string, ScorecardRow>; first: number; last: number };
}

const VALID_POLICY = new Set<number>(Object.values(TEST_POLICY_CODES));
/** Factor codes kept in history: 1 required, 2 recommended (to fall 2021), 3 neither / not considered, 5 considered. */
const VALID_FACTOR = new Set([1, 2, 3, 5]);

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** A college's values by series and year, before trimming into Series. */
type Raw = Partial<Record<SeriesKey, Map<number, number>>>;

function put(raw: Raw, key: SeriesKey, year: number, v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return;
  (raw[key] ??= new Map()).set(year, v);
}

/** Compact a year→value map into a Series trimmed to the first and last reported years. */
export function toSeries(m: Map<number, number> | undefined, approx?: Set<number>): Series | undefined {
  if (!m?.size) return undefined;
  const years = [...m.keys()];
  const start = Math.min(...years);
  const end = Math.max(...years);
  const values = Array.from({ length: end - start + 1 }, (_, i) => m.get(start + i) ?? null);
  const a = approx ? [...approx].filter((y) => m.has(y)).sort() : [];
  return { start, values, ...(a.length ? { approx: a } : {}) };
}

/** Every series for one college. `approx` collects years whose average cost used the fallback grant formula. */
export function buildCollege(school: Pick<School, "unit_id" | "type"> & { location?: Pick<School["location"], "state"> }, inputs: Inputs): SchoolHistory {
  const id = school.unit_id;
  const raw: Raw = {};
  const approx = new Set<number>();

  const repeated: number[] = [];
  let prior: string | null = null;
  for (const t of inputs.admissions) {
    const row = t.rows.get(id);
    if (!row || !t.values) {
      prior = null;
      continue;
    }
    const applicants = readSpec(row, t.values.applicants);
    const admitted = readSpec(row, t.values.admitted);
    const enrolled = readSpec(row, t.values.enrolled);
    // Applicants, admits, and enrollees identical to the year before: the prior report carried forward (1–3% of
    // colleges a year in the IC survey, 2002–2013; nearly none since ADM). Treated as not reported.
    const triple = `${applicants}/${admitted}/${enrolled}`;
    const isRepeat = triple === prior && !!applicants;
    prior = triple;
    if (isRepeat) {
      repeated.push(t.year);
      continue;
    }
    put(raw, "applicants", t.year, applicants);
    put(raw, "admitted", t.year, admitted);
    put(raw, "enrolled", t.year, enrolled);
    put(raw, "acceptance_rate", t.year, acceptanceRate(applicants, admitted));
    // Same rule as the profile's yield (lib/metrics.ts yieldRate).
    const y = yieldOf(admitted, enrolled);
    put(raw, "yield", t.year, y === null ? null : round4(y));

    // Scores as the profile computes them: SAT total = Reading/Writing + Math at each percentile, only when all four
    // are reported (lib/metrics.ts satComposite); ACT when both percentiles are.
    const v = (k: string) => (t.values![k] ? readSpec(row, t.values![k]) : null);
    const [r25, r75, m25, m75] = [v("satvr25"), v("satvr75"), v("satmt25"), v("satmt75")];
    if (r25 !== null && r75 !== null && m25 !== null && m75 !== null) {
      put(raw, "sat_25", t.year, r25 + m25);
      put(raw, "sat_75", t.year, r75 + m75);
    }
    const [a25, a75] = [v("act25"), v("act75")];
    if (a25 !== null && a75 !== null) {
      put(raw, "act_25", t.year, a25);
      put(raw, "act_75", t.year, a75);
    }
    const satPct = v("satpct");
    const actPct = v("actpct");
    put(raw, "sat_submit", t.year, satPct === null ? null : satPct / 100);
    put(raw, "act_submit", t.year, actPct === null ? null : actPct / 100);
    const policy = v("policy");
    if (policy !== null && VALID_POLICY.has(policy)) put(raw, "test_policy", t.year, policy);

    // Admission factors as raw codes (1, 2, 3, 5); what they mean depends on the era (lib/events.ts).
    for (const k of Object.keys(FACTOR_COLUMNS) as AdmissionFactor[]) {
      const code = v(`factor_${k}`);
      if (code !== null && VALID_FACTOR.has(code)) put(raw, `factor_${k}` as SeriesKey, t.year, code);
    }

    // By sex, with the overall rate's rule (lib/metrics.ts admitRatesBySex); medians from fall 2022 (lib/metrics.ts satMedian).
    put(raw, "admit_rate_men", t.year, acceptanceRate(v("applicants_men"), v("admitted_men")));
    put(raw, "admit_rate_women", t.year, acceptanceRate(v("applicants_women"), v("admitted_women")));
    const [sr50, sm50] = [v("satvr50"), v("satmt50")];
    if (sr50 !== null && sm50 !== null) put(raw, "sat_50", t.year, sr50 + sm50);
    put(raw, "act_50", t.year, v("act50"));
  }

  const sc = inputs.scorecard?.rows.get(id);
  if (sc && inputs.scorecard) {
    for (let y = inputs.scorecard.first; y <= inputs.scorecard.last; y++) {
      const size = sc[`${y}.student.size`];
      if (size && size > 0) put(raw, "undergrads", y, size);
      // Shares round like the snapshot (sync-data), so the last point matches it exactly.
      const men = sc[`${y}.student.demographics.men`];
      if (men !== undefined && men !== null) put(raw, "men_share", y, round4(men));
      const partTime = sc[`${y}.student.part_time_share`];
      if (partTime !== undefined && partTime !== null) put(raw, "part_time_share", y, round4(partTime));
      if (y >= FULL_TIME_FACULTY_FROM) {
        const ft = sc[`${y}.school.ft_faculty_rate`];
        if (ft !== undefined && ft !== null) put(raw, "faculty_full_time_share", y, round4(ft));
      }
      if (y >= RACE_FROM) {
        const shares = raceShares((f) => sc[`${y}.student.demographics.race_ethnicity.${f}`] ?? null);
        if (shares) for (const [k, key] of Object.entries(RACE_SERIES)) put(raw, key, y, shares[k as keyof typeof shares]);
      }
      const grad = sc[`${y}.completion.completion_rate_4yr_150nt`];
      if (grad !== undefined && grad !== null) put(raw, "grad_rate", y - COHORT_LAG, round4(grad));
      put(raw, "median_debt", y, sc[`${y}.aid.median_debt.completers.overall`]);
      // Key Y is the Y−1–Y school year, stored at its fall (Y−1); rounded like the snapshot.
      const loans = sc[`${y}.aid.federal_loan_rate`];
      if (loans !== undefined && loans !== null) put(raw, "federal_loan_rate", y - 1, round4(loans));
      // Instruction spending per student (specs/data-expansion/finances.md): key Y describes fiscal (Y-1)-Y, same
      // convention as the snapshot's DRVF{Y} fiscal_year (stored at its start, Y-1).
      if (y >= FINANCE_FROM) put(raw, "instruction_per_student", y - 1, instructionSpending(sc[`${y}.school.instructional_expenditure_per_fte`]));
    }
  }

  // Housing capacity and application fee, as sync-data reads them (lib/derive.ts).
  for (const t of inputs.characteristics ?? []) {
    const row = t.rows.get(id);
    put(raw, "housing_capacity", t.year, housingFrom(row)?.capacity);
    put(raw, "application_fee", t.year, applicationFeeFrom(row));
    // Policies as codes for events: the same readers as the snapshot, so the last point matches it.
    const live = housingFrom(row)?.first_years_required;
    put(raw, "live_on", t.year, live == null ? null : live ? 1 : 2);
    const plans = tuitionPlansFrom(row);
    put(raw, "tuition_guarantee", t.year, plans === null ? null : plans.includes("guarantee") ? 1 : 2);
    const promise = promiseProgramFrom(row);
    put(raw, "promise", t.year, promise === null ? null : promise ? 1 : 2);
  }

  // Student-to-faculty ratio, with the snapshot's reader (lib/academics.ts).
  for (const t of inputs.efd ?? []) put(raw, "student_faculty_ratio", t.year, studentFacultyRatioFrom(t.rows.get(id)));

  // 8-year outcomes by entering fall, with the snapshot's reader (lib/outcome-measures.ts); suppressed cohorts stay gaps.
  for (const t of inputs.om ?? []) {
    const o = eightYearFrom(t.rows.get(id), t.year);
    put(raw, "om_award", t.year, o?.all.award);
    put(raw, "om_transfer", t.year, o?.all.transferred);
    put(raw, "om_award_pell", t.year, o?.pell?.award);
    put(raw, "om_award_non_pell", t.year, o?.non_pell?.award);
    put(raw, "om_award_4", t.year, o?.all.award_4);
    put(raw, "om_award_6", t.year, o?.all.award_6);
  }
  // Graduation by group (lib/graduation-groups.ts, the snapshot's readers), stored at the entering class.
  for (const t of inputs.grPell ?? []) {
    const g = aidGroupGradFrom(t.rows.get(id));
    put(raw, "grad_rate_pell", t.year, g?.rates.pell);
    put(raw, "grad_rate_no_pell_no_loan", t.year, g?.rates.no_pell_no_loan);
    put(raw, "grad_cohort_pell", t.year, g?.cohorts.pell);
    put(raw, "grad_cohort_no_pell_no_loan", t.year, g?.cohorts.no_pell_no_loan);
  }
  const race = inputs.scorecardGradRace;
  const rc = race?.rows.get(id);
  if (race && rc) {
    for (let y = race.first; y <= race.last; y++) {
      const g = raceGradFrom((f) => rc[`${y}.${f}`]);
      if (!g) continue;
      for (const [group, [rate, cohort]] of Object.entries(GRAD_RACE_SERIES)) {
        put(raw, rate, y - COHORT_LAG, g.rates[group as keyof typeof GRAD_RACE_SERIES]);
        put(raw, cohort, y - COHORT_LAG, g.cohorts[group as keyof typeof GRAD_RACE_SERIES]);
      }
    }
  }
  // Faculty salary, with the snapshot's reader (lib/academics.ts): asserts the row is really ARANK 7.
  for (const t of inputs.sal ?? []) put(raw, "faculty_salary", t.year, facultySalaryFrom(t.rows.get(id)));
  // Transfers in, with the snapshot's reader (lib/transfers.ts).
  for (const t of inputs.efa ?? []) {
    const tr = transferInFrom(t.rows.get(id));
    put(raw, "transfer_in_count", t.year, tr?.count);
    put(raw, "transfer_in_share", t.year, tr?.share_of_new);
  }
  // Where first-years come from, with the snapshot's reader (lib/residence.ts); in-state is the college's state today.
  if (school.location?.state) {
    for (const t of inputs.efc ?? []) {
      const r = residenceFrom(t.rows.get(id), school.location.state);
      put(raw, "out_of_state_share", t.year, r?.out_of_state);
      put(raw, "international_share", t.year, r?.international);
    }
  }

  // Majors (specs/data-expansion/majors.md): each family's share of the year's first-major bachelor's. Every family the
  // college had in any year gets a value in every year it awarded bachelor's (0 when none in that field).
  const byYear = new Map<number, { total: number; fams: Record<string, number> }>();
  for (const t of inputs.ca ?? []) {
    const fams = familiesFromRow(t.rows.get(id));
    const total = Object.values(fams).reduce((a, b) => a + b, 0);
    if (total > 0) byYear.set(t.year, { total, fams });
  }
  const seen = new Set([...byYear.values()].flatMap((y) => Object.keys(y.fams)));
  for (const f of seen) if (!isMajorFamily(f)) throw new Error(`${id}: bachelor's degrees in CIP family ${f}, which lib/majors.ts MAJOR_FAMILIES doesn't list (add it with a name)`);
  for (const [year, { total, fams }] of byYear) {
    put(raw, "bachelors", year, total);
    for (const f of seen) put(raw, majorSeriesKey(f as MajorFamily), year, round4((fams[f] ?? 0) / total));
  }

  // Athletics and ROTC as codes for events: the same readers as the snapshot (lib/campus-services.ts).
  for (const t of inputs.services ?? []) {
    const row = t.rows.get(id);
    if (!row) continue;
    put(raw, "athletic_association", t.year, associationCode(row));
    put(raw, "conference", t.year, mainConferenceCode(row));
    put(raw, "football_conference", t.year, footballConferenceCode(row));
    put(raw, "rotc", t.year, rotcCode(row));
  }

  const sfaByYear = new Map(inputs.sfa.map((t) => [t.year, t]));
  const years = new Set([...inputs.prices.map((t) => t.year), ...inputs.sfa.map((t) => t.year)]);
  const pricesByYear = new Map(inputs.prices.map((t) => [t.year, t]));
  for (const year of years) {
    const sfa = sfaByYear.get(year)?.rows.get(id);
    const aid = toAid(sfa);
    put(raw, "grant_pct", year, aid?.grant_pct);
    put(raw, "grant_avg", year, aid?.grant_avg);
    netPriceByIncome(school.type, sfa).forEach((v, i) => put(raw, NET_PRICE_BANDS[i], year, v));
    const pt = pricesByYear.get(year);
    const p = pt ? computePrices(school.type, pt.rows.get(id), pt.suffix!, sfa, aid) : null;
    if (!p) continue;
    put(raw, "tuition_in_state", year, p.tuition_fees.in_state);
    put(raw, "tuition_out_of_state", year, p.tuition_fees.out_of_state);
    put(raw, "sticker_in_state", year, p.sticker.in_state);
    put(raw, "sticker_out_of_state", year, p.sticker.out_of_state);
    put(raw, "full_price", year, p.full_price);
    put(raw, "avg_paid_all", year, p.avg_paid_all);
    put(raw, "aided_net_price", year, p.aided_net_price);
    // Same as lib/metrics.ts aidGenerosity, from the same breakdown.
    if (p.breakdown && p.breakdown.full_price > 0) put(raw, "aid_generosity", year, round4(p.breakdown.grant_per_student / p.breakdown.full_price));
    if (p.approx) approx.add(year);
  }

  const series: SchoolHistory["series"] = {};
  for (const k of SERIES_KEYS) {
    const s = toSeries(raw[k], k === "avg_paid_all" || k === "aid_generosity" ? approx : undefined);
    if (s) series[k] = s;
  }
  return { unit_id: id, series, ...(repeated.length ? { repeated } : {}) };
}

/* ------------------------------------------------------------------ */
/* National                                                            */
/* ------------------------------------------------------------------ */

/** Linear-interpolated quantile of an ascending array. */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Fewer colleges than this and a year's distribution isn't published. */
export const MIN_REPORTING = 20;

const roundStat = (key: SeriesKey, v: number) => (SERIES[key].unit === "share" ? round4(v) : Math.round(v));

/**
 * Per series and year, the 25th percentile, median, and 75th percentile across every college (nominal dollars; the
 * site converts at display time, which preserves percentiles). Plus each series' 10-year change distribution for
 * the "notable" rule.
 */
export function buildNational(histories: readonly SchoolHistory[], window: Record<YearKind, [number, number]>, cpi: CpiTable): NationalHistory {
  const national: NationalHistory = { series: {}, changes: {} };
  for (const key of SERIES_KEYS) {
    // A category code has no median; the share of colleges in each category is a Home fact instead.
    if (isCategorical(SERIES[key].unit)) continue;
    const byYear = new Map<number, number[]>();
    const changes: number[] = [];
    let measure: ChangeStats["measure"] = "ratio";
    for (const h of histories) {
      const s = h.series[key];
      if (!s) continue;
      s.values.forEach((v, i) => {
        if (v === null) return;
        const y = s.start + i;
        (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(v);
      });
      const c = changeOver(key, s, window[SERIES[key].kind], cpi);
      if (c) {
        changes.push(c.change);
        measure = c.measure;
      }
    }
    const years = [...byYear.keys()].filter((y) => byYear.get(y)!.length >= MIN_REPORTING);
    if (!years.length) continue;
    const start = Math.min(...years);
    const end = Math.max(...years);
    const stats: (YearStats | null)[] = [];
    for (let y = start; y <= end; y++) {
      const vals = byYear.get(y);
      if (!vals || vals.length < MIN_REPORTING) {
        stats.push(null);
        continue;
      }
      const sorted = [...vals].sort((a, b) => a - b);
      stats.push([roundStat(key, quantile(sorted, 0.25)), roundStat(key, quantile(sorted, 0.5)), roundStat(key, quantile(sorted, 0.75)), sorted.length]);
    }
    national.series[key] = { start, stats };
    if (changes.length >= MIN_REPORTING) {
      const sorted = changes.sort((a, b) => a - b);
      const [from, to] = window[SERIES[key].kind];
      national.changes[key] = {
        from,
        to,
        measure,
        p5: round4(quantile(sorted, 0.05)),
        p25: round4(quantile(sorted, 0.25)),
        median: round4(quantile(sorted, 0.5)),
        p75: round4(quantile(sorted, 0.75)),
        p95: round4(quantile(sorted, 0.95)),
        n: sorted.length,
      };
    }
  }
  return national;
}

/* ------------------------------------------------------------------ */
/* Home facts (fixed panels)                                           */
/* ------------------------------------------------------------------ */

function medianOf(vals: number[]): number | null {
  if (!vals.length) return null;
  return quantile([...vals].sort((a, b) => a - b), 0.5);
}

/**
 * National facts over fixed panels: only colleges that report both endpoint years, so colleges entering or leaving
 * the data don't masquerade as change (specs/trends-data.md#known-caveats-to-surface-in-the-ui).
 */
export function buildFacts(histories: readonly SchoolHistory[], window: Record<YearKind, [number, number]>, cpi: CpiTable): TrendFacts {
  return {
    priceGap: priceGap(histories, window.academic, cpi),
    harderToGetIn: harderToGetIn(histories, window.fall),
    testRequired: testRequired(histories, window.fall[1]),
    legacy: legacy(histories, window.fall[1]),
    majors: majorsShift(histories),
  };
}

/**
 * What graduates study (specs/data-expansion/majors.md): each family's national share of first-major bachelor's, the
 * newest completions year vs. 10 years earlier, over colleges awarding bachelor's in both (shares weighted by each
 * college's graduates, so it's the share of all graduates, not the median college). Its own window: completions
 * (C{Y}_A) run a year ahead of the price files that set the academic window.
 */
export function majorsShift(histories: readonly SchoolHistory[]): TrendFacts["majors"] {
  const ends = histories.flatMap((h) => (h.series.bachelors ? [lastYear(h.series.bachelors)] : []));
  if (!ends.length) return null;
  const to = Math.max(...ends);
  const from = to - 10;
  const panel = histories.filter((h) => (valueAt(h.series.bachelors, from) ?? 0) > 0 && (valueAt(h.series.bachelors, to) ?? 0) > 0);
  if (panel.length < MIN_REPORTING) return null;
  const grads = (y: number) => panel.reduce((a, h) => a + valueAt(h.series.bachelors, y)!, 0);
  /** A family's share of the panel's graduates in year `y`, over the panel colleges that awarded bachelor's that year. */
  const shareAt = (f: MajorFamily, y: number): number | null => {
    let num = 0;
    let den = 0;
    for (const h of panel) {
      const total = valueAt(h.series.bachelors, y);
      if (!total) continue;
      num += (valueAt(h.series[majorSeriesKey(f)], y) ?? 0) * total;
      den += total;
    }
    return den ? round4(num / den) : null;
  };
  const families = MAJOR_FAMILY_CODES.map((f) => ({ family: f, from: shareAt(f, from)!, to: shareAt(f, to)! }))
    .filter((r) => r.from > 0 || r.to > 0)
    .sort((a, b) => b.to - b.from - (a.to - a.from) || a.family.localeCompare(b.family));
  if (!families.length) return null;
  const top = families[0].family as MajorFamily;
  const byYear = Array.from({ length: to - from + 1 }, (_, i) => shareAt(top, from + i));
  return { from, to, n: panel.length, gradsFrom: grads(from), gradsTo: grads(to), families, byYear };
}

/** Legacy status considered (required or considered), over colleges reporting it in fall 2022 and the newest fall. */
function legacy(histories: readonly SchoolHistory[], to: number): TrendFacts["legacy"] {
  const from = FACTOR_ERA;
  if (to <= from) return null;
  const at = (h: SchoolHistory, y: number) => valueAt(h.series.factor_legacy, y);
  const panel = histories.filter((h) => at(h, from) !== null && at(h, to) !== null);
  if (panel.length < MIN_REPORTING) return null;
  const considers = (code: number | null) => code === 1 || code === 5;
  const share = (y: number) => {
    const members = panel.filter((h) => at(h, y) !== null);
    if (members.length < panel.length * 0.9) return null;
    return round4(members.filter((h) => considers(at(h, y))).length / members.length);
  };
  const byYear = Array.from({ length: to - from + 1 }, (_, i) => share(from + i));
  return {
    from,
    to,
    n: panel.length,
    consideredFrom: panel.filter((h) => considers(at(h, from))).length,
    consideredTo: panel.filter((h) => considers(at(h, to))).length,
    stopped: panel.filter((h) => considers(at(h, from)) && !considers(at(h, to))).length,
    started: panel.filter((h) => !considers(at(h, from)) && considers(at(h, to))).length,
    byYear,
  };
}

/**
 * Fact 3 compares the last fall before the pandemic, when test-optional policies spread, with the latest fall. A
 * methodological constant (the baseline must predate the change), not a data vintage.
 */
export const PRE_PANDEMIC_FALL = 2019;

/** Share of colleges requiring the SAT or ACT, over colleges reporting a policy in both years. */
function testRequired(histories: readonly SchoolHistory[], to: number): TrendFacts["testRequired"] {
  const from = PRE_PANDEMIC_FALL;
  if (to <= from) return null;
  const panel = histories.filter((h) => valueAt(h.series.test_policy, from) !== null && valueAt(h.series.test_policy, to) !== null);
  if (panel.length < MIN_REPORTING) return null;
  const share = (y: number) => {
    const members = panel.filter((h) => valueAt(h.series.test_policy, y) !== null);
    if (members.length < panel.length * 0.9) return null;
    return round4(members.filter((h) => valueAt(h.series.test_policy, y) === TEST_POLICY_CODES.required).length / members.length);
  };
  const byYear = Array.from({ length: to - from + 1 }, (_, i) => share(from + i));
  return { from, to, n: panel.length, requiredFrom: byYear[0]!, requiredTo: byYear[byYear.length - 1]!, byYear };
}

function priceGap(histories: readonly SchoolHistory[], [from, to]: [number, number], cpi: CpiTable): TrendFacts["priceGap"] {
  const panel = histories.filter((h) =>
    [from, to].every((y) => valueAt(h.series.full_price, y) !== null && valueAt(h.series.avg_paid_all, y) !== null)
  );
  if (panel.length < MIN_REPORTING) return null;
  const medianReal = (key: "full_price" | "avg_paid_all", y: number) =>
    medianOf(panel.map((h) => valueAt(h.series[key], y)).filter((v): v is number => v !== null).map((v) => real(v, y, cpi, to)!));
  const index = (key: "full_price" | "avg_paid_all") => {
    const base = medianReal(key, from)!;
    return Array.from({ length: to - from + 1 }, (_, i) => {
      const m = medianReal(key, from + i);
      return m === null ? null : Math.round((m / base) * 1000) / 10;
    });
  };
  const fullPriceIndex = index("full_price");
  const avgPaidIndex = index("avg_paid_all");
  return {
    from,
    to,
    n: panel.length,
    fullPriceChange: round4(fullPriceIndex[fullPriceIndex.length - 1]! / 100 - 1),
    avgPaidChange: round4(avgPaidIndex[avgPaidIndex.length - 1]! / 100 - 1),
    fullPriceIndex,
    avgPaidIndex,
  };
}

/** How many of the most selective colleges fact 2 follows. */
export const SELECTIVE_PANEL = 100;

function harderToGetIn(histories: readonly SchoolHistory[], [from, to]: [number, number]): TrendFacts["harderToGetIn"] {
  const reports = (h: SchoolHistory, y: number) => valueAt(h.series.applicants, y) !== null && valueAt(h.series.enrolled, y) !== null;
  // Today's most selective colleges, among those that report applicants and enrollees in both years.
  const panel = histories
    .filter((h) => reports(h, from) && reports(h, to) && valueAt(h.series.acceptance_rate, to) !== null && valueAt(h.series.applicants, to)! >= 1000)
    .sort((a, b) => valueAt(a.series.acceptance_rate, to)! - valueAt(b.series.acceptance_rate, to)!)
    .slice(0, SELECTIVE_PANEL);
  if (panel.length < SELECTIVE_PANEL) return null;
  const sum = (key: "applicants" | "enrolled", y: number, members = panel) => members.reduce((a, h) => a + (valueAt(h.series[key], y) ?? 0), 0);
  const perSeat = Array.from({ length: to - from + 1 }, (_, i) => {
    const y = from + i;
    // A ratio over the colleges reporting that year, so one missing report doesn't read as a change; a year where
    // over a tenth of the panel is missing is left out.
    const members = panel.filter((h) => reports(h, y));
    if (members.length < panel.length * 0.9) return null;
    return Math.round((sum("applicants", y, members) / sum("enrolled", y, members)) * 10) / 10;
  });
  return {
    from,
    to,
    n: panel.length,
    applicantsChange: round4(sum("applicants", to) / sum("applicants", from) - 1),
    enrolledChange: round4(sum("enrolled", to) / sum("enrolled", from) - 1),
    perSeat,
  };
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/** Header check: every column the era reads must exist in the file (a renamed column fails loudly). */
export function missingColumns(required: readonly string[], columns: ReadonlySet<string>): string[] {
  return required.filter((c) => !columns.has(c));
}

/** A year whose coverage drop is expected, with the reason. */
export interface CoverageException {
  series: SeriesKey;
  year: number;
  reason: string;
}

/** Colleges reporting each series each year. */
export function coverage(histories: readonly SchoolHistory[]): Partial<Record<SeriesKey, Map<number, number>>> {
  const out: Partial<Record<SeriesKey, Map<number, number>>> = {};
  for (const h of histories) {
    for (const [k, s] of Object.entries(h.series) as [SeriesKey, Series][]) {
      const m = (out[k] ??= new Map());
      s.values.forEach((v, i) => v !== null && m.set(s.start + i, (m.get(s.start + i) ?? 0) + 1));
    }
  }
  return out;
}

/**
 * Years where a series' coverage fell more than `maxDrop` below the year before: the signature of a moved column
 * or a changed layout (the 2023–24 release would have blanked income data for every college).
 */
export function coverageDrops(
  cov: ReturnType<typeof coverage>,
  allow: readonly CoverageException[] = [],
  maxDrop = 0.2
): string[] {
  const problems: string[] = [];
  for (const [k, m] of Object.entries(cov) as [SeriesKey, Map<number, number>][]) {
    const years = [...m.keys()].sort((a, b) => a - b);
    for (let i = 1; i < years.length; i++) {
      const [prev, cur] = [m.get(years[i - 1])!, m.get(years[i])!];
      // A series collected every other year (residence) skips the odd years by design.
      const gap = years[i] - years[i - 1] > seriesStep(k);
      if ((cur < prev * (1 - maxDrop) || gap) && !allow.some((a) => a.series === k && a.year === years[i])) {
        problems.push(`${k} ${years[i]}: ${gap ? "no colleges reported the year before" : `${cur} colleges, down from ${prev} the year before`}`);
      }
    }
  }
  return problems;
}

/**
 * Series whose snapshot value isn't always their newest year: Scorecard's "latest" median debt sometimes comes from
 * a different release than the year-prefixed fields (~3% of colleges). A share of colleges up to this limit may
 * differ; past it, the build fails. Every other series must match exactly.
 */
export const SOFT_LAST_POINT: Partial<Record<SeriesKey, number>> = { median_debt: 0.05 };

/** Splits rule-1 mismatches into hard failures and soft ones within their allowance (see SOFT_LAST_POINT). */
export function ruleOneProblems(mismatches: readonly string[], schools: readonly School[]): { hard: string[]; soft: string[] } {
  const soft: string[] = [];
  const hard: string[] = [];
  const byKey = new Map<string, string[]>();
  for (const m of mismatches) {
    const key = m.split(" ")[1].replace(":", "");
    if (key in SOFT_LAST_POINT) (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(m);
    else hard.push(m);
  }
  for (const [key, list] of byKey) {
    if (list.length > schools.length * SOFT_LAST_POINT[key as SeriesKey]!) hard.push(...list);
    else soft.push(...list);
  }
  return { hard, soft };
}

/** Tolerance for comparing stored shares (rounded to 4 places) and dollars. */
const same = (a: number, b: number) => Math.abs(a - b) < 1e-4 + 1e-9 * Math.abs(b);

/**
 * Rule 1: each series' latest point equals what the profile shows today (data/schools.json), for colleges whose
 * value comes from the default federal source. Returns mismatches as "unit_id series: history X, snapshot Y".
 */
export function lastPointMismatches(schools: readonly School[], histories: ReadonlyMap<string, SchoolHistory>, latest: Pick<Record<YearKind, number>, "fall" | "academic">): string[] {
  const out: string[] = [];
  // The federal admissions fall the snapshot was built from: every college without a CDS override shares it.
  const federalFall = schools.find((s) => s.admissions.year !== null && !s.lineage?.["admissions.year"])?.admissions.year ?? null;
  // The school year Scorecard's current loan rate describes: the newest year any college's series reaches.
  const loanYears = [...histories.values()].flatMap((h) => (h.series.federal_loan_rate ? [lastYear(h.series.federal_loan_rate)] : []));
  const loanYear = loanYears.length ? Math.max(...loanYears) : null;
  // The fall Scorecard's current full-time faculty share describes, for the same reason as loans.
  const ftFacultyYears = [...histories.values()].flatMap((h) => (h.series.faculty_full_time_share ? [lastYear(h.series.faculty_full_time_share)] : []));
  const ftFacultyYear = ftFacultyYears.length ? Math.max(...ftFacultyYears) : null;
  // The newest IC year history read for athletics and ROTC: what the snapshot's IC file describes.
  const servicesYears = [...histories.values()].flatMap((h) => (["athletic_association", "rotc"] as const).flatMap((k) => (h.series[k] ? [lastYear(h.series[k]!)] : [])));
  const servicesYear = servicesYears.length ? Math.max(...servicesYears) : null;
  // The newest EF part D fall history read: what the snapshot's EF{Y}D describes (its own year, not admissions').
  const efdYears = [...histories.values()].flatMap((h) => (h.series.student_faculty_ratio ? [lastYear(h.series.student_faculty_ratio)] : []));
  const efdYear = efdYears.length ? Math.max(...efdYears) : null;
  // The newest entering fall history read from OM: what the snapshot's OM file describes.
  const omYears = [...histories.values()].flatMap((h) => (h.series.om_award ? [lastYear(h.series.om_award)] : []));
  const omYear = omYears.length ? Math.max(...omYears) : null;
  // The newest SAL{Y}_IS fall history read: what the snapshot's salary figure describes.
  const salYears = [...histories.values()].flatMap((h) => (h.series.faculty_salary ? [lastYear(h.series.faculty_salary)] : []));
  const salYear = salYears.length ? Math.max(...salYears) : null;
  // The newest EF part C fall history read (an even year): what the snapshot's EF{Y}C describes.
  const efcYears = [...histories.values()].flatMap((h) => (h.series.out_of_state_share ? [lastYear(h.series.out_of_state_share)] : []));
  const efcYear = efcYears.length ? Math.max(...efcYears) : null;
  // The newest EF part A fall history read: what the snapshot's EF{Y}A describes.
  const efaYears = [...histories.values()].flatMap((h) => (h.series.transfer_in_count ? [lastYear(h.series.transfer_in_count)] : []));
  const efaYear = efaYears.length ? Math.max(...efaYears) : null;
  // The newest school year history read from C{Y}_A: what the snapshot's completions file describes.
  const caYears = [...histories.values()].flatMap((h) => (h.series.bachelors ? [lastYear(h.series.bachelors)] : []));
  const caYear = caYears.length ? Math.max(...caYears) : null;
  // The newest fiscal year history's instruction-spending series reaches: what the snapshot's DRVF{Y} describes.
  const financeYears = [...histories.values()].flatMap((h) => (h.series.instruction_per_student ? [lastYear(h.series.instruction_per_student)] : []));
  const financeYear = financeYears.length ? Math.max(...financeYears) : null;
  for (const s of schools) {
    const h = histories.get(s.unit_id);
    if (!h) continue;
    // A derived field (e.g. the SAT total) is overridden when any of its inputs is (lib/fields.ts).
    const overridden = (field: string): boolean => {
      if (s.lineage?.[field as FieldPath]) return true;
      const def = isFieldPath(field) ? (FIELDS[field] as { derived?: { inputs: readonly string[] } }) : undefined;
      return !!def?.derived?.inputs.some((i) => overridden(i));
    };
    /** `atLatest`: compare the series' own latest point (Scorecard fields, which don't share one year). */
    /** `at`: compare at this year instead of the kind's latest (athletics: the newest IC year). */
    /** `kept`: the snapshot value is the federal one a newer CDS value replaced (demographics.federal), so compare even though the shown value has lineage. */
    const check = (key: SeriesKey, snapshot: number | null | undefined, atLatest = false, at?: number, kept = false) => {
      if (!kept && overridden(SERIES[key].field)) return;
      const kind = SERIES[key].kind;
      const hv = at !== undefined ? valueAt(h.series[key], at) : atLatest ? (latestPoint(h.series[key])?.value ?? null) : kind === "cohort" ? null : valueAt(h.series[key], latest[kind]);
      const sv = snapshot ?? null;
      if (hv === null && sv === null) return;
      if (hv === null || sv === null || !same(hv, sv)) out.push(`${s.unit_id} ${key}: history ${hv ?? "none"}, snapshot ${sv ?? "none"}`);
    };
    // Admissions come from the latest ADM file only when the snapshot does (admissions.year).
    if (s.admissions.year === latest.fall) {
      check("applicants", s.admissions.applicants);
      check("admitted", s.admissions.admitted);
      check("enrolled", s.admissions.enrolled);
      check("acceptance_rate", s.admissions.acceptance_rate);
      const { admitted, enrolled } = s.admissions;
      if (!overridden("admissions.enrolled") && !overridden("admissions.admitted")) {
        const y = yieldOf(admitted, enrolled);
        check("yield", y === null ? null : round4(y));
      }
      const r = s.admissions.sat_reading_25_75;
      const m = s.admissions.sat_math_25_75;
      check("sat_25", r && m ? r[0] + m[0] : null);
      check("sat_75", r && m ? r[1] + m[1] : null);
      check("act_25", s.admissions.act_composite_25_75?.[0]);
      check("act_75", s.admissions.act_composite_25_75?.[1]);
      check("sat_submit", s.admissions.test_submission_rate_sat);
      check("act_submit", s.admissions.test_submission_rate_act);
      // "required-some" is CDS-only, always with a lineage record, so `check` skips it; it never has a code.
      check("test_policy", s.admissions.test_policy ? ((TEST_POLICY_CODES as Record<string, number>)[s.admissions.test_policy] ?? null) : null);
    }
    // By sex and medians are always federal (no CDS override sets them), so they're checked against the ADM file's fall.
    if (federalFall === latest.fall) {
      const rates = admitRatesBySex(s);
      check("admit_rate_men", rates.men);
      check("admit_rate_women", rates.women);
      check("sat_50", satMedian(s));
      check("act_50", s.admissions.act_composite_median);
      for (const k of Object.keys(FACTOR_COLUMNS) as AdmissionFactor[]) {
        // A factor a newer CDS replaced (cds-admissions.md) is compared as IPEDS reported it (admissions.federal_factors).
        const kept = s.admissions.federal_factors;
        const use = kept && k in kept ? kept[k] : s.admissions.factors?.[k];
        check(`factor_${k}` as SeriesKey, use ? FACTOR_CODE[use] : null);
      }
    }
    // College Scorecard series end on the snapshot's "latest" values. (Graduation isn't compared: the profile shows
    // Scorecard's consumer rate, which has no history; the chart is the 6-year rate and says so.)
    // Where a newer CDS fall replaced them (specs/data-expansion/cds-student-body-and-outcomes.md), history stays
    // federal: its last point is compared with the kept federal values in demographics.federal, not the shown ones.
    const fed = s.demographics.federal;
    const dem = fed ?? s.demographics;
    if (h.series.undergrads) check("undergrads", dem.undergrad_enrollment, true, undefined, !!fed);
    if (h.series.men_share || dem.men_share != null) check("men_share", dem.men_share, true, undefined, !!fed);
    // At the newest loan-rate year any college reports, not each series' own last point: some colleges (the service
    // academies, a few small ones) reported 0% years ago and nothing since, and Scorecard's "latest" is empty for them.
    if (loanYear !== null && (h.series.federal_loan_rate || s.outcomes?.federal_loan_rate != null)) {
      const hv = valueAt(h.series.federal_loan_rate, loanYear);
      const sv = s.outcomes?.federal_loan_rate ?? null;
      if (hv !== null || sv !== null) {
        if (hv === null || sv === null || !same(hv, sv)) out.push(`${s.unit_id} federal_loan_rate: history ${hv ?? "none"}, snapshot ${sv ?? "none"}`);
      }
    }
    if (h.series.part_time_share || dem.part_time_share != null) check("part_time_share", dem.part_time_share, true, undefined, !!fed);
    const race = dem.racial_diversity;
    if (race && h.series.race_white) for (const [k, key] of Object.entries(RACE_SERIES)) check(key, race[k as keyof typeof race], true, undefined, !!fed);
    if (h.series.median_debt || s.outcomes?.median_debt != null) check("median_debt", s.outcomes?.median_debt, true);
    const c = s.cost;
    // Only when the snapshot describes the same year (a newer sync-data run moves it ahead until history catches up).
    const sameYear = c?.year === historyYearLabel(latest.academic, "academic");
    if (c?.year && sameYear) {
      check("tuition_in_state", c.tuition_fees?.in_state);
      check("tuition_out_of_state", c.tuition_fees?.out_of_state);
      check("sticker_in_state", c.sticker?.in_state);
      check("sticker_out_of_state", c.sticker?.out_of_state);
      check("avg_paid_all", c.avg_paid_all);
      check("aided_net_price", c.aided_net_price);
      if (c.breakdown) check("full_price", c.breakdown.full_price);
      const b = c.breakdown;
      check("aid_generosity", b && b.full_price > 0 ? round4(b.grant_per_student / b.full_price) : null);
      // Housing and the fee come from the same academic year's characteristics file as the prices.
      check("housing_capacity", s.campus?.housing?.capacity);
      check("application_fee", s.admissions.application_fee);
      const h = s.campus?.housing;
      check("live_on", h?.first_years_required == null ? null : h.first_years_required ? 1 : 2);
      const plans = c.tuition_plans;
      check("tuition_guarantee", plans == null ? null : plans.includes("guarantee") ? 1 : 2);
      check("promise", c.promise_program == null ? null : c.promise_program ? 1 : 2);
    }
    if (efdYear !== null) check("student_faculty_ratio", s.academics?.student_faculty_ratio, false, efdYear);
    const om = s.outcomes?.eight_year;
    if (omYear !== null && (!om || om.entering_year === omYear)) {
      check("om_award", om?.all.award, false, omYear);
      check("om_transfer", om?.all.transferred, false, omYear);
      check("om_award_pell", om?.pell?.award, false, omYear);
      check("om_award_non_pell", om?.non_pell?.award, false, omYear);
      check("om_award_4", om?.all.award_4, false, omYear);
      check("om_award_6", om?.all.award_6, false, omYear);
    }
    if (salYear !== null) check("faculty_salary", s.academics?.faculty?.avg_salary_9mo, false, salYear);
    // At the newest year any college reports, like the loan rate: ~80 colleges reported a full-time share years ago and
    // nothing since, so Scorecard's "latest" is empty for them while their history ends on an older year.
    if (ftFacultyYear !== null && (h.series.faculty_full_time_share || s.academics?.faculty?.full_time_share != null))
      check("faculty_full_time_share", s.academics?.faculty?.full_time_share, false, ftFacultyYear);
    if (efaYear !== null) {
      check("transfer_in_count", s.demographics.transfer_in?.count, false, efaYear);
      check("transfer_in_share", s.demographics.transfer_in?.share_of_new, false, efaYear);
    }
    if (efcYear !== null) {
      check("out_of_state_share", s.demographics.residence?.out_of_state, false, efcYear);
      check("international_share", s.demographics.residence?.international, false, efcYear);
    }
    // Majors: bachelor's and each family's share at the newest C{Y}_A year (a family the snapshot lacks is 0%).
    if (caYear !== null) {
      const ac = s.academics;
      const total = ac?.bachelors_awarded ?? null;
      check("bachelors", total ? total : null, false, caYear);
      for (const f of MAJOR_FAMILY_CODES) {
        const key = majorSeriesKey(f);
        const snap = total ? round4((ac?.bachelors_by_family?.[f] ?? 0) / total) : null;
        if (h.series[key] || (snap !== null && snap > 0)) check(key, snap, false, caYear);
      }
    }
    if (financeYear !== null) check("instruction_per_student", s.finances?.instruction_per_student, false, financeYear);
    // Athletics and ROTC: the snapshot reads the newest IC file, which is the services series' newest year.
    const a = s.campus?.athletics;
    if (servicesYear !== null && (a !== undefined || h.series.athletic_association)) {
      const at = servicesYear;
      check("athletic_association", a == null ? null : a.associations.includes("ncaa") ? 1 : a.associations.includes("naia") ? 2 : 3, false, at);
      check("conference", a?.conference?.code, false, at);
      check("football_conference", a ? (a.football_conference?.code ?? (a.sports.includes("football") ? a.conference?.code : null)) : null, false, at);
      const p = s.campus?.programs;
      check("rotc", p == null ? null : p.rotc.length ? 1 : 2, false, at);
    }
    if (s.aid && sameYear) {
      check("grant_pct", s.aid.grant_pct);
      check("grant_avg", s.aid.grant_avg);
    }
  }
  return out;
}

/**
 * Net price by income comes from IPEDS in history but from College Scorecard in the snapshot; they publish the same
 * figures, so any difference is reported (Scorecard can lag a revision).
 */
export function netPriceMismatches(schools: readonly School[], histories: ReadonlyMap<string, SchoolHistory>, year: number): string[] {
  const out: string[] = [];
  for (const s of schools) {
    const h = histories.get(s.unit_id);
    const snap = s.cost?.net_price_by_income;
    if (!h || !snap) continue;
    NET_PRICE_BANDS.forEach((k, i) => {
      const hv = valueAt(h.series[k], year);
      if (snap[i] !== null && hv !== null && hv !== snap[i]) out.push(`${s.unit_id} ${k}: IPEDS ${hv}, Scorecard ${snap[i]}`);
    });
  }
  return out;
}

/** Year-over-year jumps beyond 3× (or below ⅓): usually a typo in a college's report. Flagged for review, not fatal. */
export function bigJumps(histories: readonly SchoolHistory[], keys: readonly SeriesKey[] = ["applicants", "admitted", "enrolled", "avg_paid_all", "full_price", "undergrads"]): string[] {
  const out: string[] = [];
  for (const h of histories) {
    for (const k of keys) {
      const s = h.series[k];
      if (!s) continue;
      for (let i = 1; i < s.values.length; i++) {
        const [a, b] = [s.values[i - 1], s.values[i]];
        if (a && b && a >= 50 && (b / a > 3 || a / b > 3)) out.push(`${h.unit_id} ${k} ${s.start + i - 1}→${s.start + i}: ${a} → ${b}`);
      }
    }
  }
  return out;
}

export type { Era, FileChoice };
