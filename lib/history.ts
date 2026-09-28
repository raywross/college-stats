/**
 * Year-by-year history (specs/trends-data.md, specs/trends-design.md): the shapes of the files
 * `npm run sync-history` writes to data/history/, and pure helpers over them (inflation, windows, changes, the
 * "notable" rule, citations). No I/O and no runtime imports beyond other pure modules, so Node scripts, tests,
 * and client components can all use it.
 */
import type { FieldPath } from "./fields";
import type { FormatKind } from "./format";
import type { TermKey } from "./glossary";
import type { DatasetMeta, SourceKey } from "./types";

/* ------------------------------------------------------------------ */
/* Series                                                              */
/* ------------------------------------------------------------------ */

/**
 * How a series' `year` reads. `year` is always the calendar year the academic year starts (the fall term):
 * fall 2024 admissions and 2024–25 prices are both 2024.
 */
export type YearKind = "fall" | "academic";

export type SeriesUnit = "usd" | "count" | "share";

export interface SeriesDef {
  label: string;
  /** Short name for tooltips and legends. */
  short: string;
  /** The snapshot field this series extends back in time (label, glossary, and "last point = today" check). */
  field: FieldPath;
  term?: TermKey;
  unit: SeriesUnit;
  kind: YearKind;
  format: FormatKind;
  /** Where each year comes from; see HISTORY_FAMILIES. Derived series list every input's family. */
  families: readonly HistoryFamily[];
  /** Can be negative: net price goes below zero when grants exceed the cost of attendance. */
  signed?: true;
}

/**
 * The IPEDS file families history reads. Each maps to the source it's cited as (data/meta.json `sources`).
 * Admissions lived in the Institutional Characteristics survey (`IC{year}`) until fall 2013, then moved to `ADM{year}`.
 */
export const HISTORY_FAMILIES = {
  "ic-admissions": { source: "ipeds-ic", kind: "fall", files: "IC{year} (admissions section)" },
  adm: { source: "ipeds-adm", kind: "fall", files: "ADM{year}" },
  prices: { source: "ipeds-ic", kind: "academic", files: "IC{year}_AY, then COST1_{year+1}" },
  sfa: { source: "ipeds-sfa", kind: "academic", files: "SFA{yy}{yy+1}, plus COST2_{year+1} since NCES moved residency and net price there" },
} as const satisfies Record<string, { source: SourceKey; kind: YearKind; files: string }>;

export type HistoryFamily = keyof typeof HISTORY_FAMILIES;

const ADMISSIONS: readonly HistoryFamily[] = ["ic-admissions", "adm"];

export const SERIES = {
  applicants: { label: "Applicants", short: "Applied", field: "admissions.applicants", term: "applicants", unit: "count", kind: "fall", format: "compact", families: ADMISSIONS },
  admitted: { label: "Admitted", short: "Admitted", field: "admissions.admitted", term: "admitted", unit: "count", kind: "fall", format: "compact", families: ADMISSIONS },
  enrolled: { label: "Enrolled first-years", short: "Enrolled", field: "admissions.enrolled", term: "enrolled", unit: "count", kind: "fall", format: "compact", families: ADMISSIONS },
  acceptance_rate: { label: "Acceptance rate", short: "Acceptance rate", field: "admissions.acceptance_rate", term: "acceptance-rate", unit: "share", kind: "fall", format: "pctSmart", families: ADMISSIONS },
  yield: { label: "Yield", short: "Yield", field: "derived.yield", term: "yield", unit: "share", kind: "fall", format: "pct", families: ADMISSIONS },
  tuition_in_state: { label: "Tuition & fees, in-state", short: "Tuition, in-state", field: "cost.tuition_fees", term: "in-state-tuition", unit: "usd", kind: "academic", format: "money", families: ["prices"] },
  tuition_out_of_state: { label: "Tuition & fees, out-of-state", short: "Tuition, out-of-state", field: "cost.tuition_fees", term: "in-state-tuition", unit: "usd", kind: "academic", format: "money", families: ["prices"] },
  sticker_in_state: { label: "Full price, in-state", short: "Full price, in-state", field: "cost.sticker", term: "cost-of-attendance", unit: "usd", kind: "academic", format: "money", families: ["prices"] },
  sticker_out_of_state: { label: "Full price, out-of-state", short: "Full price, out-of-state", field: "cost.sticker", term: "cost-of-attendance", unit: "usd", kind: "academic", format: "money", families: ["prices"] },
  full_price: { label: "Full price", short: "Full price", field: "cost.breakdown", term: "cost-of-attendance", unit: "usd", kind: "academic", format: "money", families: ["prices", "sfa"] },
  avg_paid_all: { label: "Average total cost", short: "Average cost", field: "cost.avg_paid_all", term: "average-cost", unit: "usd", kind: "academic", format: "money", families: ["prices", "sfa"] },
  aided_net_price: { label: "Net price, students with grants", short: "Net price with grants", field: "cost.aided_net_price", term: "net-price", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  grant_pct: { label: "Share receiving grants", short: "Get grants", field: "aid.grant_pct", term: "grant-aid", unit: "share", kind: "academic", format: "pct", families: ["sfa"] },
  grant_avg: { label: "Average grant", short: "Average grant", field: "aid.grant_avg", term: "grant-aid", unit: "usd", kind: "academic", format: "money", families: ["sfa"] },
  aid_generosity: { label: "Aid generosity", short: "Aid generosity", field: "derived.aid_generosity", term: "aid-generosity", unit: "share", kind: "academic", format: "pct", families: ["prices", "sfa"] },
  net_price_income_1: { label: "Net price, family income $0–30K", short: "$0–30K", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  net_price_income_2: { label: "Net price, family income $30–48K", short: "$30–48K", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  net_price_income_3: { label: "Net price, family income $48–75K", short: "$48–75K", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  net_price_income_4: { label: "Net price, family income $75–110K", short: "$75–110K", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
  net_price_income_5: { label: "Net price, family income $110K+", short: "$110K+", field: "cost.net_price_by_income", term: "net-price-by-income", unit: "usd", kind: "academic", format: "money", families: ["sfa"], signed: true },
} as const satisfies Record<string, SeriesDef>;

export type SeriesKey = keyof typeof SERIES;
export const SERIES_KEYS = Object.keys(SERIES) as SeriesKey[];
export const NET_PRICE_BANDS = ["net_price_income_1", "net_price_income_2", "net_price_income_3", "net_price_income_4", "net_price_income_5"] as const;

export function isSeriesKey(k: string): k is SeriesKey {
  return Object.prototype.hasOwnProperty.call(SERIES, k);
}

/* ------------------------------------------------------------------ */
/* Files in data/history/                                              */
/* ------------------------------------------------------------------ */

/** One series for one college: `values[i]` is year `start + i`. Gaps are null, never interpolated. */
export interface Series {
  start: number;
  values: (number | null)[];
  /** Years computed with a fallback formula (2007–08 average cost: share with grants × average grant). */
  approx?: number[];
}

/** data/history/schools/{unit_id}.json */
export interface SchoolHistory {
  unit_id: string;
  series: Partial<Record<SeriesKey, Series>>;
  /**
   * Fall terms left out of the admissions series because applicants, admits, and enrollees were identical to the
   * year before (a carried-forward report, not a new count).
   */
  repeated?: number[];
}

/** Distribution across colleges for one year: [25th percentile, median, 75th percentile, colleges reporting]. */
export type YearStats = [number, number, number, number];

/** A college's change over the default window, as it's distributed nationally (for the "notable" rule). */
export interface ChangeStats {
  from: number;
  to: number;
  /** "ratio" = relative change (money after inflation, counts); "points" = difference in shares. */
  measure: "ratio" | "points";
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  n: number;
}

/** data/history/national.json: every college in the dataset, whether or not its shard is written. */
export interface NationalHistory {
  series: Partial<Record<SeriesKey, { start: number; stats: (YearStats | null)[] }>>;
  changes: Partial<Record<SeriesKey, ChangeStats>>;
}

/** One file NCES published, as used for one year. */
export interface HistoryFile {
  year: number;
  file: string;
  url: string;
  /** NCES's revised release (the `_rv` CSV inside the zip). */
  revised: boolean;
}

/** data/history/meta.json: what the build read and when. */
export interface HistoryMeta {
  built: string;
  /** Default window: the last 10 years ending with the latest, per year kind. */
  latest: Record<YearKind, number>;
  files: Record<HistoryFamily, HistoryFile[]>;
  /** The newest year of a family whose earlier years were revised but this one hasn't been yet. */
  provisional: Partial<Record<HistoryFamily, number>>;
  /** Colleges with a shard in data/history/schools/ (every college unless the build was limited with --ids). */
  schools: number;
  /** Colleges in the dataset, which national.json and facts.json cover. */
  universe: number;
}

/** data/history/cpi.json: CPI-U school-year averages (July–June), as NCES's Digest uses. */
export interface CpiTable {
  series: string;
  label: string;
  url: string;
  retrieved: string;
  basis: string;
  start: number;
  values: number[];
  /** Months missing from BLS (e.g. October 2025, not collected during the funding lapse), averaged without them. */
  missing: string[];
}

/** data/history/facts.json: the Home page's national trend facts (fixed panels; see specs/trends-design.md). */
export interface TrendFacts {
  priceGap: {
    from: number;
    to: number;
    /** Colleges reporting both measures in both years. */
    n: number;
    /** Change in the panel's median after inflation, e.g. 0.12 = +12%. */
    fullPriceChange: number;
    avgPaidChange: number;
    /** Panel medians per year, indexed to 100 at `from` (after inflation). */
    fullPriceIndex: (number | null)[];
    avgPaidIndex: (number | null)[];
  } | null;
  harderToGetIn: {
    from: number;
    to: number;
    n: number;
    applicantsChange: number;
    enrolledChange: number;
    /** Applications per enrolled first-year, per year, summed over the panel. */
    perSeat: (number | null)[];
  } | null;
}

/* ------------------------------------------------------------------ */
/* Years                                                               */
/* ------------------------------------------------------------------ */

/** "Fall 2024" or "2023–24". */
export function historyYearLabel(year: number, kind: YearKind): string {
  return kind === "fall" ? `Fall ${year}` : `${year}–${String(year + 1).slice(2)}`;
}

/** Compact axis label: "2024" or "’23–24". */
export function axisYearLabel(year: number, kind: YearKind): string {
  return kind === "fall" ? String(year) : `’${String(year).slice(2)}–${String(year + 1).slice(2)}`;
}

export function valueAt(s: Series | undefined, year: number): number | null {
  if (!s) return null;
  const i = year - s.start;
  return i >= 0 && i < s.values.length ? s.values[i] : null;
}

export function lastYear(s: Series): number {
  return s.start + s.values.length - 1;
}

/** The latest reported year and value. */
export function latestPoint(s: Series | undefined): { year: number; value: number } | null {
  if (!s) return null;
  for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return { year: s.start + i, value: s.values[i]! };
  return null;
}

/** The earliest reported year at or after `from`. */
export function firstPointFrom(s: Series | undefined, from: number): { year: number; value: number } | null {
  if (!s) return null;
  for (let i = Math.max(0, from - s.start); i < s.values.length; i++) if (s.values[i] !== null) return { year: s.start + i, value: s.values[i]! };
  return null;
}

export const WINDOW_YEARS = 10;

/** The default window: 10 years ending with the latest year of that kind (e.g. 2013–14 → 2023–24). */
export function defaultWindow(meta: Pick<HistoryMeta, "latest">, kind: YearKind): [number, number] {
  const to = meta.latest[kind];
  return [to - WINDOW_YEARS, to];
}

/* ------------------------------------------------------------------ */
/* Inflation                                                           */
/* ------------------------------------------------------------------ */

export function cpiFor(cpi: CpiTable, year: number): number | null {
  const i = year - cpi.start;
  return i >= 0 && i < cpi.values.length ? cpi.values[i] : null;
}

/** `value` from `year` in `base`-year dollars. Null when either year's CPI is missing. */
export function real(value: number, year: number, cpi: CpiTable, base: number): number | null {
  const from = cpiFor(cpi, year);
  const to = cpiFor(cpi, base);
  return from && to ? (value * to) / from : null;
}

/** A money series converted to `base`-year dollars (others unchanged). */
export function inDollarsOf(s: Series, unit: SeriesUnit, cpi: CpiTable, base: number): Series {
  if (unit !== "usd") return s;
  return { ...s, values: s.values.map((v, i) => (v === null ? null : real(v, s.start + i, cpi, base))) };
}

/* ------------------------------------------------------------------ */
/* Change over a window                                                */
/* ------------------------------------------------------------------ */

export interface Change {
  key: SeriesKey;
  from: { year: number; value: number };
  to: { year: number; value: number };
  /** Relative change for money (after inflation) and counts; difference for shares. */
  measure: "ratio" | "points";
  change: number;
}

/** Below these bases a percent change misleads; show "from → to" instead (specs/trends-design.md). */
const TINY_BASE: Partial<Record<SeriesKey, number>> = { applicants: 200, admitted: 100, enrolled: 50 };

/**
 * Change from the window's start (or the first year after it the college reports) to its end. Money compares in
 * `to`-year dollars. Null without both endpoints, or when the start is more than 2 years late (a different window).
 */
export function changeOver(key: SeriesKey, s: Series | undefined, window: [number, number], cpi: CpiTable): Change | null {
  const def = SERIES[key];
  const end = valueAt(s, window[1]);
  const start = firstPointFrom(s, window[0]);
  if (end === null || !start || start.year > window[0] + 2 || start.year >= window[1]) return null;
  const measure = def.unit === "share" ? "points" : "ratio";
  let from = start.value;
  if (def.unit === "usd") {
    const r = real(from, start.year, cpi, window[1]);
    if (r === null) return null;
    from = r;
  }
  if (measure === "ratio" && from <= 0) return null;
  const change = measure === "points" ? end - from : end / from - 1;
  return { key, from: { year: start.year, value: from }, to: { year: window[1], value: end }, measure, change };
}

export function isTinyBase(c: Change): boolean {
  const min = TINY_BASE[c.key];
  return min !== undefined && Math.min(c.from.value, c.to.value) < min;
}

/**
 * Floors a change must clear to count as notable, on top of being outside the national middle half
 * (specs/trends-design.md): cost ±5% after inflation, admit rate ±3 points, applicants ±25%, grant share ±5 points.
 */
export const NOTABLE_FLOORS: Partial<Record<SeriesKey, number>> = {
  avg_paid_all: 0.05,
  full_price: 0.05,
  acceptance_rate: 0.03,
  applicants: 0.25,
  grant_pct: 0.05,
};

/** Beyond the national 25th/75th percentile of the same change, and past the floor. */
export function isNotable(c: Change, national: NationalHistory): boolean {
  const floor = NOTABLE_FLOORS[c.key];
  const stats = national.changes[c.key];
  if (floor === undefined || !stats || isTinyBase(c)) return false;
  if (Math.abs(c.change) < floor) return false;
  return c.change < stats.p25 || c.change > stats.p75;
}

/** Changes the Overview "10 years" tile may add after average cost, in priority order (specs/trends-design.md). */
export const TILE_CANDIDATES: readonly SeriesKey[] = ["full_price", "acceptance_rate", "applicants", "grant_pct"];

/**
 * The profile's "10 years" tile: average total cost over the default window (always shown when available), then up
 * to two notable changes.
 */
export function tenYearSummary(
  h: SchoolHistory,
  national: NationalHistory,
  cpi: CpiTable,
  meta: Pick<HistoryMeta, "latest">
): { avgCost: Change | null; notable: Change[] } {
  const change = (k: SeriesKey) => changeOver(k, h.series[k], defaultWindow(meta, SERIES[k].kind), cpi);
  const notable = TILE_CANDIDATES.map(change)
    .filter((c): c is Change => c !== null && isNotable(c, national))
    .slice(0, 2);
  return { avgCost: change("avg_paid_all"), notable };
}

/** "+12%", "−3 pts": signed, with a true minus sign. */
export function formatChange(c: Pick<Change, "measure" | "change">): string {
  const sign = c.change > 0 ? "+" : c.change < 0 ? "−" : "";
  const abs = Math.abs(c.change);
  return c.measure === "points" ? `${sign}${Math.round(abs * 100)} pts` : `${sign}${Math.round(abs * 100).toLocaleString("en-US")}%`;
}

/* ------------------------------------------------------------------ */
/* Citations                                                           */
/* ------------------------------------------------------------------ */

/** One family's contribution to a set of series: e.g. IPEDS Admissions, fall 2014 to fall 2024. */
export interface HistorySource {
  key: SourceKey;
  label: string;
  publisher: string;
  /** "Fall 2014 to Fall 2024" */
  years: string;
  url: string;
  files: string;
}

/** NCES's index of every IPEDS data file by year, where each cited file can be downloaded. */
export const IPEDS_DATA_FILES_URL = "https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx";

/**
 * The distinct sources behind a set of series, with the years each covered. Reads only data/history/meta.json.
 * `range` limits it to the years a view uses (e.g. a 10-year fact cites only the files in those years).
 */
export function historySources(keys: readonly SeriesKey[], hmeta: HistoryMeta, meta: DatasetMeta, range?: [number, number]): HistorySource[] {
  const families = [...new Set(keys.flatMap((k) => SERIES[k].families))];
  const out: HistorySource[] = [];
  for (const f of families) {
    const files = hmeta.files[f]?.filter((x) => !range || (x.year >= range[0] && x.year <= range[1]));
    if (!files?.length) continue;
    const fam = HISTORY_FAMILIES[f];
    const info = meta.sources[fam.source];
    const first = files[0].year;
    const last = files[files.length - 1].year;
    out.push({
      key: fam.source,
      label: f === "ic-admissions" ? `${info.label} (admissions section)` : info.label,
      publisher: info.publisher,
      years: `${historyYearLabel(first, fam.kind)} to ${historyYearLabel(last, fam.kind)}`,
      url: IPEDS_DATA_FILES_URL,
      files: fam.files,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Validation (sync-history before writing; check:lineage on the files) */
/* ------------------------------------------------------------------ */

/** Problems with one shard: unknown series, malformed arrays, or values that can't be right. */
export function validateShard(h: SchoolHistory, knownIds?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const where = `history ${h.unit_id}`;
  if (knownIds && !knownIds.has(h.unit_id)) errors.push(`${where}: not a college in data/schools.json`);
  for (const [k, s] of Object.entries(h.series)) {
    if (!isSeriesKey(k)) {
      errors.push(`${where}: unknown series "${k}" (register it in SERIES, lib/history.ts)`);
      continue;
    }
    if (!s || !Number.isInteger(s.start) || !Array.isArray(s.values) || !s.values.length) {
      errors.push(`${where}: ${k} is malformed`);
      continue;
    }
    if (s.values[0] === null || s.values[s.values.length - 1] === null) errors.push(`${where}: ${k} isn't trimmed to reported years`);
    const def: SeriesDef = SERIES[k];
    for (const v of s.values) {
      if (v === null) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || (v < 0 && !def.signed) || (def.unit === "share" && v > 1)) {
        errors.push(`${where}: ${k} has an impossible value ${v}`);
        break;
      }
    }
  }
  return errors;
}

/** Problems with the history metadata's fit with the dataset (every family cites a known source). */
export function validateHistoryMeta(hmeta: HistoryMeta, meta: DatasetMeta): string[] {
  const errors: string[] = [];
  for (const f of Object.keys(HISTORY_FAMILIES) as HistoryFamily[]) {
    if (!(HISTORY_FAMILIES[f].source in meta.sources)) errors.push(`history: family ${f} cites unknown source ${HISTORY_FAMILIES[f].source}`);
    const files = hmeta.files[f];
    if (!files?.length) errors.push(`history meta: no files recorded for ${f}`);
    else if (files.some((x, i) => i > 0 && x.year !== files[i - 1].year + 1)) errors.push(`history meta: ${f} years aren't consecutive`);
  }
  return errors;
}
