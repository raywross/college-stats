/**
 * A college's first-year GPA as the plan reads it (specs/planner/redesign/gpa.md): its own unweighted average when it
 * publishes one, else the mean of its GPA bands, else an estimate from colleges with similar test scores and admit
 * rates (bounded by a weighted average when that is all it publishes), else nothing. Every source comes back as a
 * range, and `compareGpaRanges` places the student's range against it.
 *
 * Pure (type-only imports plus pure modules), so the server fits the model once per instance
 * (lib/planner/gpa-model-server.ts) and the browser runs `collegeGpa` and the comparison as the student types.
 */
import type { FieldPath } from "../fields.ts";
import type { GpaBands, School } from "../types.ts";
import { satTotal } from "../score-bands.ts";
import { actToSat } from "./concordance.ts";

/** The midpoint of each CDS C11 band, top band (4.0) first, the order lib/cds/admissions.ts GPA_BANDS stores. */
export const GPA_BAND_MIDPOINTS = [4.0, 3.875, 3.625, 3.375, 3.125, 2.75, 2.25, 1.5, 0.5] as const;

/** Shares must add up to at least this before a band mean is trusted (a half-blank column says little). */
export const BAND_MIN_SHARE = 0.5;
/** A band mean is read as a range this wide on each side (it matches the C12 average within about 0.05). */
export const BAND_MARGIN = 0.05;
/** The fitted model is used only with at least this many training colleges and a 90th-percentile miss at most this. */
export const GPA_MODEL_GUARD = { minRows: 25, maxP90: 0.25 } as const;
/** Predictions are clamped to this range. */
export const GPA_PREDICT_RANGE = [2.0, 4.0] as const;

/** The column a band mean reads: "all" first-years, else those who sent test scores. */
export function bandColumn(bands: { all: GpaBands | null; with_test: GpaBands | null } | null | undefined): { column: "all" | "with_test"; shares: GpaBands } | null {
  if (!bands) return null;
  for (const column of ["all", "with_test"] as const) {
    const shares = bands[column];
    if (shares && shares.length === 9 && shares.reduce((a, b) => a + (b ?? 0), 0) >= BAND_MIN_SHARE) return { column, shares };
  }
  return null;
}

/** `derived.gpa_band_mean`: each band's share × its midpoint, over the shares' total. Null without a usable column. */
export function bandMean(bands: { all: GpaBands | null; with_test: GpaBands | null } | null | undefined): number | null {
  const col = bandColumn(bands);
  if (!col) return null;
  let sum = 0;
  let weight = 0;
  col.shares.forEach((share, i) => {
    sum += (share ?? 0) * GPA_BAND_MIDPOINTS[i];
    weight += share ?? 0;
  });
  return sum / weight;
}

type ScoreSchool = Pick<School, "admissions" | "reported" | "lineage">;

/**
 * The college's SAT midpoint: the middle of its SAT total 25th–75th (`satTotal`, the range the plan shows), else the
 * ACT composite 25th–75th's middle through the 2018 concordance (a half point averages the two neighbors).
 */
export function satMidpoint(school: ScoreSchool): number | null {
  const sat = satTotal(school);
  if (sat) return (sat[0] + sat[1]) / 2;
  const act = school.admissions?.act_composite_25_75;
  if (!act) return null;
  const mid = (act[0] + act[1]) / 2;
  const lo = actToSat(Math.floor(mid));
  const hi = actToSat(Math.ceil(mid));
  return lo === null || hi === null ? null : (lo + hi) / 2;
}

export interface GpaRow {
  /** SAT midpoint (satMidpoint). */
  sat: number;
  /** Admit rate, 0–1. */
  rate: number;
  /** The college's unweighted GPA: its band mean when it has bands, else its C12 average. */
  gpa: number;
}

export interface GpaModel {
  /** GPA ≈ coef[0] + coef[1] × (SAT midpoint ÷ 100) + coef[2] × admit rate. */
  coef: [number, number, number];
  /** Training colleges. */
  n: number;
  /** Leave-one-out absolute error: the mean, and the 90th percentile. */
  meanError: number;
  p90Error: number;
}

const features = (r: Pick<GpaRow, "sat" | "rate">) => [1, r.sat / 100, r.rate];

/** Least squares on [1, sat/100, rate] through the normal equations; null when they're singular. */
function leastSquares(rows: GpaRow[]): [number, number, number] | null {
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (const r of rows) {
    const x = features(r);
    for (let i = 0; i < 3; i++) {
      b[i] += x[i] * r.gpa;
      for (let j = 0; j < 3; j++) a[i][j] += x[i] * x[j];
    }
  }
  // Gaussian elimination with partial pivoting.
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

const predictRaw = (coef: [number, number, number], sat: number, rate: number) => coef[0] + coef[1] * (sat / 100) + coef[2] * rate;

/** The nearest-rank percentile of a list of numbers. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/**
 * Fits the model and measures it by leave-one-out: each college predicted by a fit on the others. Null under the guard
 * (fewer than `minRows` rows, or a 90th-percentile miss above `maxP90`), so only the colleges' own figures are used.
 */
export function fitGpaModel(rows: GpaRow[], guard: { minRows: number; maxP90: number } = GPA_MODEL_GUARD): GpaModel | null {
  if (rows.length < guard.minRows || rows.length < 4) return null;
  const coef = leastSquares(rows);
  if (!coef) return null;
  const errors: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rest = leastSquares(rows.filter((_, j) => j !== i));
    if (!rest) return null;
    errors.push(Math.abs(predictRaw(rest, rows[i].sat, rows[i].rate) - rows[i].gpa));
  }
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const p90Error = percentile(errors, 0.9);
  if (p90Error > guard.maxP90) return null;
  return { coef, n: rows.length, meanError, p90Error };
}

/** The model's prediction, clamped to [2.0, 4.0]. */
export function predictGpa(model: GpaModel, sat: number, rate: number): number {
  const [lo, hi] = GPA_PREDICT_RANGE;
  return Math.min(hi, Math.max(lo, predictRaw(model.coef, sat, rate)));
}

type GpaSchool = Pick<School, "admissions" | "reported" | "lineage">;

/** The college's C12 average when the rule may use it as is: unweighted, or scale not stated and at most 4.0. */
function usableAverage(school: GpaSchool): number | null {
  const gpa = school.reported?.admission_profile?.gpa;
  const avg = gpa?.average;
  if (avg == null || avg > 4) return null;
  return gpa!.scale === "unweighted" || gpa!.scale === "not_stated" ? avg : null;
}

/** The weighted average a college publishes instead of an unweighted one (marked weighted, or above 4.0). */
function weightedAverage(school: GpaSchool): number | null {
  const gpa = school.reported?.admission_profile?.gpa;
  const avg = gpa?.average;
  if (avg == null) return null;
  return gpa!.scale === "weighted" || avg > 4 ? avg : null;
}

/** A training row for the college, when its GPA comes from source 1 or 2 and it has an SAT midpoint and admit rate. */
export function trainingRow(school: GpaSchool): GpaRow | null {
  const gpa = school.reported?.admission_profile?.gpa;
  if (!gpa || weightedAverage(school) !== null) return null;
  const target = bandMean(gpa.bands) ?? usableAverage(school);
  const sat = satMidpoint(school);
  const rate = school.admissions?.acceptance_rate ?? null;
  return target === null || sat === null || rate === null ? null : { sat, rate, gpa: target };
}

/** Training rows from every college in the dataset (never weighted reporters). */
export function trainingRows(schools: GpaSchool[]): GpaRow[] {
  return schools.map(trainingRow).filter((r): r is GpaRow => r !== null);
}

export type CollegeGpaKind = "reported" | "bands" | "estimated" | "none";

export interface CollegeGpa {
  kind: CollegeGpaKind;
  /** The unweighted range the comparison uses; null for "none". */
  range: [number, number] | null;
  /** The number shown: the average, the band mean, or the estimate. */
  point: number | null;
  /** The weighted average the college publishes, when that bounded the estimate (or is all it publishes). */
  weighted: number | null;
  /** For an estimate: how many colleges the model was fitted on. */
  n: number | null;
}

const clampRange = (lo: number, hi: number): [number, number] => [Math.max(0, lo), Math.min(4, hi)];

/** The college's GPA, best source first (gpa.md "The design" 1). */
export function collegeGpa(school: GpaSchool, model: GpaModel | null): CollegeGpa {
  const none = (weighted: number | null = null): CollegeGpa => ({ kind: "none", range: null, point: null, weighted, n: null });

  const avg = usableAverage(school);
  if (avg !== null) return { kind: "reported", range: [avg, avg], point: avg, weighted: null, n: null };

  const weighted = weightedAverage(school);
  if (weighted === null) {
    const mean = bandMean(school.reported?.admission_profile?.gpa?.bands);
    if (mean !== null) return { kind: "bands", range: clampRange(mean - BAND_MARGIN, mean + BAND_MARGIN), point: mean, weighted: null, n: null };
  }

  const sat = satMidpoint(school);
  const rate = school.admissions?.acceptance_rate ?? null;
  if (!model || sat === null || rate === null) return none(weighted);
  const est = predictGpa(model, sat, rate);
  let range = clampRange(est - model.p90Error, est + model.p90Error);
  let point = est;
  if (weighted !== null) {
    // Weighting only adds, at most a point per class: the unweighted GPA lies in [w − 1, min(4, w)].
    const bound: [number, number] = [Math.max(0, weighted - 1), Math.min(4, weighted)];
    const lo = Math.max(range[0], bound[0]);
    const hi = Math.min(range[1], bound[1]);
    range = lo <= hi ? [lo, hi] : bound;
    point = Math.min(bound[1], Math.max(bound[0], est));
  }
  return { kind: "estimated", range, point, weighted, n: model.n };
}

export type GpaPosition = "below" | "in" | "above";

/**
 * The student's range against the college's (gpa.md "The design" 4). Above when the student's low end clears the
 * college's high end by more than the band; below the other way round; in when both ends sit within the band of the
 * other range; otherwise null ("can't tell"). For two points this is the original rule: |difference| ≤ band is in.
 */
export function compareGpaRanges(student: [number, number], college: [number, number], band: number): GpaPosition | null {
  const [s0, s1] = student;
  const [c0, c1] = college;
  // Clearly apart: even the closest ends of the two ranges are more than the band apart.
  if (s0 - c1 > band) return "above";
  if (c0 - s1 > band) return "below";
  // Close: the middles are within the band, and the student's own GPA is known well enough (an unweighted number,
  // not a weighted one spread over up to a point). Requiring the whole range inside the band (the first rule,
  // 2026-10-10) made an estimated college, about ±0.17 wide, never "close" to anyone; the middles carry the estimate.
  const mid = (a: number, b: number) => (a + b) / 2;
  if (Math.abs(mid(s0, s1) - mid(c0, c1)) <= band && s1 - s0 <= STUDENT_RANGE_FOR_CLOSE) return "in";
  return null;
}

/** The widest student GPA range that can still be "close to" a college's (a weighted GPA's range is up to 1.0). */
export const STUDENT_RANGE_FOR_CLOSE = 0.4;

/**
 * The citation behind a college's GPA, keyed by the field its sentence's ⓘ cites (standing.ts GpaCite): the C12
 * average, `derived.gpa_band_mean`, or `derived.gpa_estimate` with the fitted model's own formula, colleges, and
 * typical miss. Empty for "none". `cite` is the app's citeField.
 */
export function gpaCites<C extends object>(school: GpaSchool, gpa: CollegeGpa, model: GpaModel | null, cite: (path: FieldPath, school: never) => C): Record<string, C> {
  const s = school as never;
  if (gpa.kind === "reported") return { "reported.admission_profile.gpa.average": cite("reported.admission_profile.gpa.average", s) };
  if (gpa.kind === "bands") return { "derived.gpa_band_mean": cite("derived.gpa_band_mean", s) };
  if (gpa.kind === "estimated" && model) return { "derived.gpa_estimate": { ...cite("derived.gpa_estimate", s), formula: gpaModelFormula(model) } };
  return {};
}

/** The model as one plain line, for `derived.gpa_estimate`'s ⓘ (the formula, the colleges, the typical miss). */
export function gpaModelFormula(model: GpaModel): string {
  const [b0, b1, b2] = model.coef;
  const sign = (v: number, digits: number) => `${v < 0 ? "−" : "+"} ${Math.abs(v).toFixed(digits)}`;
  return (
    `Estimated from colleges with similar test scores and admit rates: GPA ≈ ${b0.toFixed(2)} ${sign(b1, 3)} × (SAT midpoint ÷ 100) ${sign(b2, 2)} × admit rate, ` +
    `fitted on ${model.n} colleges that publish an unweighted GPA. Its typical miss is ${model.meanError.toFixed(2)} GPA points (90% of misses under ${model.p90Error.toFixed(2)}). ` +
    "A college that publishes only a weighted average is kept between that average minus 1 and 4.0."
  );
}
