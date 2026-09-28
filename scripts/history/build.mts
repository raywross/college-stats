/**
 * The history build's pure steps: rows → per-college series → national distributions → Home facts, plus the checks
 * that stop a bad build (specs/trends-data.md#pipeline-npm-run-sync-history). No I/O, so tests drive it with
 * fixture rows. `scripts/sync-history.mts` does the fetching and writing.
 */
import type { School } from "../../lib/types.ts";
import type { IpedsRow } from "../../lib/derive.ts";
import { acceptanceRate, computePrices, netPriceByIncome, toAid, yieldOf } from "../../lib/derive.ts";
import {
  NET_PRICE_BANDS,
  SERIES,
  SERIES_KEYS,
  changeOver,
  historyYearLabel,
  real,
  valueAt,
  type ChangeStats,
  type CpiTable,
  type HistoryFamily,
  type NationalHistory,
  type SchoolHistory,
  type Series,
  type SeriesKey,
  type TrendFacts,
  type YearStats,
} from "../../lib/history.ts";
import { readSpec, type ColumnSpec, type Era, type FileChoice } from "./registry.mts";

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
}

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
export function buildCollege(school: Pick<School, "unit_id" | "type">, inputs: Inputs): SchoolHistory {
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
export function buildNational(histories: readonly SchoolHistory[], window: Record<"fall" | "academic", [number, number]>, cpi: CpiTable): NationalHistory {
  const national: NationalHistory = { series: {}, changes: {} };
  for (const key of SERIES_KEYS) {
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
export function buildFacts(histories: readonly SchoolHistory[], window: Record<"fall" | "academic", [number, number]>, cpi: CpiTable): TrendFacts {
  return { priceGap: priceGap(histories, window.academic, cpi), harderToGetIn: harderToGetIn(histories, window.fall) };
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
      const gap = years[i] - years[i - 1] > 1;
      if ((cur < prev * (1 - maxDrop) || gap) && !allow.some((a) => a.series === k && a.year === years[i])) {
        problems.push(`${k} ${years[i]}: ${gap ? "no colleges reported the year before" : `${cur} colleges, down from ${prev} the year before`}`);
      }
    }
  }
  return problems;
}

/** Tolerance for comparing stored shares (rounded to 4 places) and dollars. */
const same = (a: number, b: number) => Math.abs(a - b) < 1e-4 + 1e-9 * Math.abs(b);

/**
 * Rule 1: each series' latest point equals what the profile shows today (data/schools.json), for colleges whose
 * value comes from the default federal source. Returns mismatches as "unit_id series: history X, snapshot Y".
 */
export function lastPointMismatches(schools: readonly School[], histories: ReadonlyMap<string, SchoolHistory>, latest: Record<"fall" | "academic", number>): string[] {
  const out: string[] = [];
  for (const s of schools) {
    const h = histories.get(s.unit_id);
    if (!h) continue;
    const overridden = (field: string) => !!s.lineage?.[field as keyof NonNullable<School["lineage"]>];
    const check = (key: SeriesKey, snapshot: number | null | undefined) => {
      if (overridden(SERIES[key].field)) return;
      const y = latest[SERIES[key].kind];
      const hv = valueAt(h.series[key], y);
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
    }
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
export function bigJumps(histories: readonly SchoolHistory[], keys: readonly SeriesKey[] = ["applicants", "admitted", "enrolled", "avg_paid_all", "full_price"]): string[] {
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
