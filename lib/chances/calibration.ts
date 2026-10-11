/**
 * The season measurements (specs/chances/method/outcomes.md "Measuring the groups"; specs/chances/calibration.md "The
 * accuracy summary"): pure helpers over consented outcome rows, used by scripts/chances-calibration.mts (which writes
 * `chances_summary`) and by the Data page (which reads it). No I/O.
 *
 * - Wilson intervals (90%) for each group × admit-rate band cell with enough outcomes.
 * - The order check (Likely > Target > Reach in each band) and the Likely-miss flag.
 * - Discrimination: the ordinal AUC of the group against admitted.
 * - Calibration: each cell's admitted share is its implied frequency; the Brier score of those on a later season.
 * - Each input switched off (the snapshot's `without_*` groups), student overrides, and the sharers' mix.
 * - Held out by season, never a random split.
 * - "Students like you" suppression (at least 50 per cell, at least 10 in each sub-count).
 *
 * The summary describes results (counts, shares, intervals, the sharers' mix), never the method; only counts and
 * intervals reach the public table.
 */
import { ABLATION_INPUTS, GROUPS, type AblationInput, type Group, type SnapshotRow } from "./snapshot.ts";

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

/** One consented snapshot with its outcome, as chances_outcome_rows() returns it (no ids). */
export type OutcomeRow = Partial<SnapshotRow> & {
  season: number;
  unit_id: string;
  outcome: string | null;
};

/** A row with a final decision: admitted, or denied / wait-listed (deferred and undecided rows are left out). */
export type DecidedRow = OutcomeRow & { admitted: boolean };

export function decided(rows: readonly OutcomeRow[]): DecidedRow[] {
  const out: DecidedRow[] = [];
  for (const r of rows) {
    if (r.outcome === "admitted") out.push({ ...r, admitted: true });
    else if (r.outcome === "denied" || r.outcome === "waitlisted") out.push({ ...r, admitted: false });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Intervals and bands                                                 */
/* ------------------------------------------------------------------ */

/** z for a two-sided 90% interval. */
export const Z90 = 1.6448536269514722;

/** Wilson score interval for k successes in n trials; null for n = 0. */
export function wilson(k: number, n: number, z = Z90): { low: number; high: number } | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export type RateBand = "lt20" | "20-35" | "35-50" | "50-70" | "70+";
/** The college's overall admit rate, in bands (lower bound inclusive). */
export const RATE_BANDS: readonly { key: RateBand; label: string; min: number; max: number }[] = [
  { key: "lt20", label: "Under 20%", min: 0, max: 0.2 },
  { key: "20-35", label: "20–35%", min: 0.2, max: 0.35 },
  { key: "35-50", label: "35–50%", min: 0.35, max: 0.5 },
  { key: "50-70", label: "50–70%", min: 0.5, max: 0.7 },
  { key: "70+", label: "70% or more", min: 0.7, max: 1.000001 },
];

export function rateBand(rate: number | null | undefined): RateBand | null {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  return RATE_BANDS.find((b) => rate >= b.min && rate < b.max)?.key ?? null;
}

/** A cell reports a share only with at least this many outcomes; below it, "not enough outcomes yet". */
export const MIN_CELL_OUTCOMES = 30;
/** Likely should be wrong at most this often in a band (product/chances-and-fit.md). */
export const LIKELY_MAX_MISS = 0.15;

/* ------------------------------------------------------------------ */
/* Cells                                                               */
/* ------------------------------------------------------------------ */

export interface Cell {
  group: Group;
  band: RateBand;
  n: number;
  admitted: number;
}

export interface CellStats extends Cell {
  /** Null below MIN_CELL_OUTCOMES. */
  share: number | null;
  interval: { low: number; high: number } | null;
}

const cellKey = (group: Group, band: RateBand) => `${group}|${band}`;
const isGroup = (v: unknown): v is Group => v === "reach" || v === "target" || v === "likely";

/** Counts per group × band, the group read by `groupOf` (the estimate's by default). Rows without a group or band are left out. */
export function cellCounts(rows: readonly DecidedRow[], groupOf: (r: DecidedRow) => Group | null | undefined = (r) => r.estimate_group): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const r of rows) {
    const g = groupOf(r);
    const band = rateBand(r.admit_rate);
    if (!isGroup(g) || !band) continue;
    const key = cellKey(g, band);
    const c = cells.get(key) ?? { group: g, band, n: 0, admitted: 0 };
    c.n++;
    if (r.admitted) c.admitted++;
    cells.set(key, c);
  }
  return cells;
}

export function cellStats(c: Cell, min = MIN_CELL_OUTCOMES): CellStats {
  const enough = c.n >= min;
  return { ...c, share: enough ? c.admitted / c.n : null, interval: enough ? wilson(c.admitted, c.n) : null };
}

/** Every group × band cell, in band then group order, zero-filled. */
export function allCells(rows: readonly DecidedRow[], groupOf?: (r: DecidedRow) => Group | null | undefined): CellStats[] {
  const counts = cellCounts(rows, groupOf);
  return RATE_BANDS.flatMap((b) => GROUPS.map((g) => cellStats(counts.get(cellKey(g, b.key)) ?? { group: g, band: b.key, n: 0, admitted: 0 })));
}

/** Per band: whether Likely > Target > Reach holds among the cells with enough outcomes (null when fewer than two can be compared). */
export function orderChecks(cells: readonly CellStats[]): { band: RateBand; holds: boolean | null }[] {
  return RATE_BANDS.map((b) => {
    const shares = GROUPS.map((g) => cells.find((c) => c.band === b.key && c.group === g)?.share ?? null).filter((s): s is number => s !== null);
    if (shares.length < 2) return { band: b.key, holds: null };
    return { band: b.key, holds: shares.every((s, i) => i === 0 || s > shares[i - 1]) };
  });
}

/** Bands where Likely, with enough outcomes, was wrong more often than LIKELY_MAX_MISS. */
export function likelyMissFlags(cells: readonly CellStats[]): { band: RateBand; miss: number }[] {
  return cells
    .filter((c) => c.group === "likely" && c.share !== null && 1 - c.share > LIKELY_MAX_MISS)
    .map((c) => ({ band: c.band, miss: 1 - (c.share as number) }));
}

/* ------------------------------------------------------------------ */
/* Discrimination and calibration                                      */
/* ------------------------------------------------------------------ */

const RANK: Record<Group, number> = { reach: 0, target: 1, likely: 2 };

/**
 * The AUC of the ordered group (Reach < Target < Likely) against admitted: the chance a random admitted outcome sits
 * in a higher group than a random not-admitted one, ties counted half. Null without both kinds of outcome.
 */
export function ordinalAuc(rows: readonly { group: Group | null | undefined; admitted: boolean }[]): number | null {
  const pos = [0, 0, 0];
  const neg = [0, 0, 0];
  for (const r of rows) {
    if (!isGroup(r.group)) continue;
    (r.admitted ? pos : neg)[RANK[r.group]]++;
  }
  const P = pos[0] + pos[1] + pos[2];
  const N = neg[0] + neg[1] + neg[2];
  if (P === 0 || N === 0) return null;
  let wins = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i > j) wins += pos[i] * neg[j];
      else if (i === j) wins += 0.5 * pos[i] * neg[j];
    }
  }
  return wins / (P * N);
}

/** Each cell's observed admitted share (cells with enough outcomes): the frequency the group implies. */
export function impliedFrequencies(rows: readonly DecidedRow[], groupOf?: (r: DecidedRow) => Group | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cellCounts(rows, groupOf).values()) if (c.n >= MIN_CELL_OUTCOMES) out.set(cellKey(c.group, c.band), c.admitted / c.n);
  return out;
}

/** The implied frequency for a row's group and band, or null. */
export function impliedFor(implied: Map<string, number>, group: Group | null | undefined, rate: number | null | undefined): number | null {
  const band = rateBand(rate);
  if (!isGroup(group) || !band) return null;
  return implied.get(cellKey(group, band)) ?? null;
}

/** The Brier score of implied frequencies on these outcomes (rows whose cell has a frequency); null when none do. */
export function brierScore(implied: Map<string, number>, rows: readonly DecidedRow[], groupOf: (r: DecidedRow) => Group | null | undefined = (r) => r.estimate_group): { n: number; brier: number } | null {
  let n = 0;
  let sum = 0;
  for (const r of rows) {
    const p = impliedFor(implied, groupOf(r), r.admit_rate);
    if (p === null) continue;
    n++;
    sum += (p - (r.admitted ? 1 : 0)) ** 2;
  }
  return n ? { n, brier: sum / n } : null;
}

/** Held out by season: train on every earlier season, test on `testSeason` (default the latest). Null with fewer than two seasons. */
export function heldOutBySeason<T extends { season: number }>(rows: readonly T[], testSeason?: number): { train: T[]; test: T[]; testSeason: number } | null {
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b);
  const target = testSeason ?? seasons[seasons.length - 1];
  if (target === undefined || !seasons.some((s) => s < target)) return null;
  return { train: rows.filter((r) => r.season < target), test: rows.filter((r) => r.season === target), testSeason: target };
}

/* ------------------------------------------------------------------ */
/* Inputs switched off, overrides                                      */
/* ------------------------------------------------------------------ */

const WITHOUT: Record<AblationInput, keyof SnapshotRow> = {
  residency: "without_residency",
  crowding: "without_crowding",
  rigor: "without_rigor",
  rank: "without_rank",
};

export interface Ablation {
  input: AblationInput;
  /** Rows with both groups recorded. */
  n: number;
  /** Rows where switching the input off changed the group. */
  changed: number;
  aucWith: number | null;
  aucWithout: number | null;
}

/** What each input bought: the same rows' AUC with the group as given and with the input switched off. */
export function ablations(rows: readonly DecidedRow[]): Ablation[] {
  return ABLATION_INPUTS.map((input) => {
    const both = rows.filter((r) => isGroup(r.estimate_group) && isGroup(r[WITHOUT[input]]));
    return {
      input,
      n: both.length,
      changed: both.filter((r) => r.estimate_group !== r[WITHOUT[input]]).length,
      aucWith: ordinalAuc(both.map((r) => ({ group: r.estimate_group, admitted: r.admitted }))),
      aucWithout: ordinalAuc(both.map((r) => ({ group: r[WITHOUT[input]] as Group, admitted: r.admitted }))),
    };
  });
}

/**
 * Whether rigor may lower a group (method/standing.md open question 1): at crowded colleges, *some*-rigor students
 * admitted measurably less often (non-overlapping intervals) than *most*-rigor students in the same position and
 * band, in at least one comparison with enough outcomes on both sides, and higher in none.
 */
export function rigorLowerEvidence(rows: readonly DecidedRow[]): { met: boolean; comparisons: { position: string; band: RateBand; some: CellStats; most: CellStats; lower: boolean | null }[] } {
  const groups = new Map<string, { some: Cell; most: Cell; position: string; band: RateBand }>();
  for (const r of rows) {
    const band = rateBand(r.admit_rate);
    if (!r.crowded || !r.position || !band || (r.rigor_reading !== "some" && r.rigor_reading !== "most")) continue;
    const key = `${r.position}|${band}`;
    const g = groups.get(key) ?? { position: r.position, band, some: { group: "target", band, n: 0, admitted: 0 }, most: { group: "target", band, n: 0, admitted: 0 } };
    const c = g[r.rigor_reading];
    c.n++;
    if (r.admitted) c.admitted++;
    groups.set(key, g);
  }
  const comparisons = [...groups.values()].map((g) => {
    const some = cellStats(g.some);
    const most = cellStats(g.most);
    const lower = some.interval && most.interval ? (some.interval.high < most.interval.low ? true : some.interval.low > most.interval.high ? false : null) : null;
    return { position: g.position, band: g.band, some, most, lower };
  });
  return { met: comparisons.some((c) => c.lower === true) && !comparisons.some((c) => c.lower === false), comparisons };
}

/**
 * Student overrides: for outcomes where the student changed the group, the Brier score of the estimate's group and of
 * the student's own group, both read through the implied frequencies (lower is closer to what happened).
 */
export function overrideComparison(rows: readonly DecidedRow[], implied: Map<string, number>): { n: number; estimate: number; student: number } | null {
  let n = 0;
  let est = 0;
  let stu = 0;
  for (const r of rows) {
    if (!r.group_changed) continue;
    const pe = impliedFor(implied, r.estimate_group, r.admit_rate);
    const ps = impliedFor(implied, r.student_group, r.admit_rate);
    if (pe === null || ps === null) continue;
    const y = r.admitted ? 1 : 0;
    n++;
    est += (pe - y) ** 2;
    stu += (ps - y) ** 2;
  }
  return n ? { n, estimate: est / n, student: stu / n } : null;
}

/* ------------------------------------------------------------------ */
/* The sharers' mix                                                    */
/* ------------------------------------------------------------------ */

/** A state shows by name only with at least this many sharers; the rest are "Other". */
export const MIX_STATE_MIN = 10;

export interface SharersMix {
  n: number;
  /** Share of outcomes per admit-rate band. */
  bands: Partial<Record<RateBand, number>>;
  /** Shares by state, largest first; small states pooled as "Other". */
  states: { state: string; share: number }[];
  /** Share of outcomes from students who applied without a test score. */
  testOptional: number;
}

export function sharersMix(rows: readonly DecidedRow[]): SharersMix {
  const n = rows.length;
  const bands: Partial<Record<RateBand, number>> = {};
  const byState = new Map<string, number>();
  let noTest = 0;
  for (const r of rows) {
    const b = rateBand(r.admit_rate);
    if (b) bands[b] = (bands[b] ?? 0) + 1;
    const st = r.state ?? "Unknown";
    byState.set(st, (byState.get(st) ?? 0) + 1);
    if (!r.test_kind) noTest++;
  }
  const share = (k: number) => (n ? Math.round((k / n) * 1000) / 1000 : 0);
  let other = 0;
  const states: { state: string; share: number }[] = [];
  for (const [state, k] of [...byState.entries()].sort((a, b) => b[1] - a[1])) {
    if (k >= MIX_STATE_MIN && state !== "Unknown") states.push({ state, share: share(k) });
    else other += k;
  }
  if (other) states.push({ state: "Other", share: share(other) });
  return {
    n,
    bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, share(v as number)])) as SharersMix["bands"],
    states,
    testOptional: share(noTest),
  };
}

/* ------------------------------------------------------------------ */
/* The public summary rows                                             */
/* ------------------------------------------------------------------ */

/** A row of `chances_summary` (supabase/migrations/20261011110000_chances_summary.sql). */
export interface SummaryRow {
  season: number;
  model_version: string;
  scope: "all" | "estimate" | "student";
  estimate_group: Group | null;
  rate_band: RateBand | null;
  n: number;
  admitted: number | null;
  interval_low: number | null;
  interval_high: number | null;
  sharers_mix: SharersMix | null;
  next_summary_on: string | null;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function cellRow(season: number, model: string, scope: "estimate" | "student", c: CellStats, next: string | null): SummaryRow {
  return {
    season,
    model_version: model,
    scope,
    estimate_group: c.group,
    rate_band: c.band,
    n: c.n,
    admitted: c.share === null ? null : c.admitted,
    interval_low: c.interval ? r3(c.interval.low) : null,
    interval_high: c.interval ? r3(c.interval.high) : null,
    sharers_mix: null,
    next_summary_on: next,
  };
}

/**
 * The public rows for one season: per model version, the season total with the sharers' mix, every group × band cell
 * by the estimate's group, and every cell by the student's own group where they changed it. Only rows with an
 * estimate group and a model version count. Thin cells keep their count but no share.
 */
export function summaryRows(rows: readonly OutcomeRow[], season: number, nextSummaryOn: string | null): SummaryRow[] {
  const seasonRows = decided(rows).filter((r) => r.season === season && isGroup(r.estimate_group) && r.model_version);
  const versions = [...new Set(seasonRows.map((r) => r.model_version as string))].sort();
  return versions.flatMap((model) => {
    const mine = seasonRows.filter((r) => r.model_version === model);
    const total: SummaryRow = {
      season,
      model_version: model,
      scope: "all",
      estimate_group: null,
      rate_band: null,
      n: mine.length,
      admitted: null,
      interval_low: null,
      interval_high: null,
      sharers_mix: sharersMix(mine),
      next_summary_on: nextSummaryOn,
    };
    const byEstimate = allCells(mine).map((c) => cellRow(season, model, "estimate", c, nextSummaryOn));
    const byStudent = allCells(mine.filter((r) => r.group_changed), (r) => r.student_group).map((c) => cellRow(season, model, "student", c, nextSummaryOn));
    return [total, ...byEstimate, ...byStudent];
  });
}

/** The internal season report the script prints (never published: it includes the method's measures). */
export function seasonReport(rows: readonly OutcomeRow[], season: number) {
  const all = decided(rows);
  const current = all.filter((r) => r.season === season && isGroup(r.estimate_group));
  const cells = allCells(current);
  const split = heldOutBySeason(all.filter((r) => isGroup(r.estimate_group)), season);
  const trainImplied = split ? impliedFrequencies(split.train) : null;
  const ownImplied = impliedFrequencies(current);
  return {
    season,
    outcomes: current.length,
    cells,
    order: orderChecks(cells),
    likelyMisses: likelyMissFlags(cells),
    auc: {
      overall: ordinalAuc(current.map((r) => ({ group: r.estimate_group, admitted: r.admitted }))),
      byBand: RATE_BANDS.map((b) => ({ band: b.key, auc: ordinalAuc(current.filter((r) => rateBand(r.admit_rate) === b.key).map((r) => ({ group: r.estimate_group, admitted: r.admitted }))) })),
    },
    heldOutBrier: split && trainImplied ? { trainedOn: [...new Set(split.train.map((r) => r.season))].sort(), ...brierScore(trainImplied, split.test) } : null,
    ablations: ablations(current),
    rigorLower: rigorLowerEvidence(current),
    overrides: overrideComparison(current, ownImplied),
    mix: sharersMix(current),
  };
}

/** What the script does for a season: nothing ("no outcomes yet"), or the report it prints and the rows it writes. */
export function planCalibration(
  rows: readonly OutcomeRow[],
  season: number,
  nextSummaryOn: string | null,
): { status: "empty" } | { status: "ok"; report: ReturnType<typeof seasonReport>; summary: SummaryRow[] } {
  const summary = summaryRows(rows, season, nextSummaryOn);
  if (summary.length === 0) return { status: "empty" };
  return { status: "ok", report: seasonReport(rows, season), summary };
}

/* ------------------------------------------------------------------ */
/* The Data page's view of the summary                                 */
/* ------------------------------------------------------------------ */

export interface SummaryView {
  season: number;
  modelVersions: string[];
  nextSummaryOn: string | null;
  total: number;
  mix: SharersMix | null;
  /** By band, each group's cell (summed over model versions). */
  bands: { band: RateBand; label: string; cells: Record<Group, CellStats> }[];
  /** Where students changed the group: by the student's group, summed over bands. */
  student: Record<Group, CellStats>;
  /** The estimate's cells summed over bands, for comparison with `student`. */
  estimate: Record<Group, CellStats>;
}

function sumCells(rows: readonly SummaryRow[], group: Group, band: RateBand | "all"): CellStats {
  const mine = rows.filter((r) => r.estimate_group === group && (band === "all" || r.rate_band === band));
  const n = mine.reduce((s, r) => s + r.n, 0);
  // A share needs every contributing row's admitted count (thin rows withhold theirs); recompute the interval on the sum.
  const known = mine.every((r) => r.admitted !== null || r.n === 0);
  const admitted = known ? mine.reduce((s, r) => s + (r.admitted ?? 0), 0) : 0;
  // A sum over every band carries the first band's key; the page doesn't read `band` on those.
  const stats = cellStats({ group, band: band === "all" ? RATE_BANDS[0].key : band, n, admitted });
  return known ? stats : { ...stats, share: null, interval: null };
}

/** The latest season in the table, shaped for the page; null when there's nothing yet. */
export function summaryView(rows: readonly SummaryRow[]): SummaryView | null {
  if (rows.length === 0) return null;
  const season = Math.max(...rows.map((r) => r.season));
  const mine = rows.filter((r) => r.season === season);
  const totals = mine.filter((r) => r.scope === "all");
  const estimate = mine.filter((r) => r.scope === "estimate");
  const student = mine.filter((r) => r.scope === "student");
  const versions = [...new Set(mine.map((r) => r.model_version))].sort();
  const pick = (scope: readonly SummaryRow[], band: RateBand | "all") => Object.fromEntries(GROUPS.map((g) => [g, sumCells(scope, g, band)])) as Record<Group, CellStats>;
  return {
    season,
    modelVersions: versions,
    nextSummaryOn: mine.map((r) => r.next_summary_on).find((d): d is string => !!d) ?? null,
    total: totals.reduce((s, r) => s + r.n, 0),
    // One model version: its mix; several: the largest one's (each run's mix describes its own sharers).
    mix: [...totals].sort((a, b) => b.n - a.n)[0]?.sharers_mix ?? null,
    bands: RATE_BANDS.map((b) => ({ band: b.key, label: b.label, cells: pick(estimate, b.key) })),
    student: pick(student, "all"),
    estimate: pick(estimate, "all"),
  };
}

/* ------------------------------------------------------------------ */
/* "Students like you" (calibration.md)                                */
/* ------------------------------------------------------------------ */

/** A cell is shown only with at least this many outcomes in the last three seasons. */
export const LIKE_YOU_MIN = 50;
/** ...and at least this many in every sub-count (admitted, not admitted): the scattergram threshold. */
export const LIKE_YOU_SUBCOUNT_MIN = 10;

/** Whether a cell's counts may be shown. */
export function likeYouVisible(n: number, admitted: number): boolean {
  return Number.isInteger(n) && Number.isInteger(admitted) && n >= LIKE_YOU_MIN && admitted >= LIKE_YOU_SUBCOUNT_MIN && n - admitted >= LIKE_YOU_SUBCOUNT_MIN;
}

/** The last three finished seasons ending with `lastFinished` (snapshot.ts lastFinishedSeason): [from, to]. */
export function likeYouSeasons(lastFinished: number): [number, number] {
  return [lastFinished - 2, lastFinished];
}
