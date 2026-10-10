/**
 * A college's first-year GPA as the plan reads it (specs/planner/redesign/gpa.md): its own unweighted average when it
 * publishes one, else the mean of its GPA bands, else an estimate from colleges with similar test scores, admit
 * rates, and test-submission shares (bounded by a weighted average when that is all it publishes), else nothing. Every source comes back as a
 * range, and `compareGpaRanges` places the student's range against it. Where the college has a middle 50% of
 * first-year GPAs (its own from the GPA bands, else estimated by the p25/p75 models), `compareGpaMiddle` places the
 * student against that instead, the way the test scores are read.
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
/**
 * When a fitted model may be used (gpa.md "The model", guard changed 2026-10-11): at least `minRows` training colleges;
 * a leave-one-out 90th-percentile miss of at most `maxP90`; and a leave-one-out typical (mean) miss at least `minGain`
 * below a flat guess's (each college guessed as the mean of the others), so a model that adds nothing over the average
 * of its training colleges is refused even when its misses happen to be small.
 */
export interface GpaGuard {
  minRows: number;
  maxP90: number;
  minGain: number;
}
/** The average model's guard. */
export const GPA_MODEL_GUARD: GpaGuard = { minRows: 25, maxP90: 0.25, minGain: 0.1 };
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
  return actPointToSat((act[0] + act[1]) / 2);
}

/** An ACT composite (possibly a half point) on the SAT scale: a half point averages the two neighbors. */
function actPointToSat(act: number): number | null {
  const lo = actToSat(Math.floor(act));
  const hi = actToSat(Math.ceil(act));
  return lo === null || hi === null ? null : (lo + hi) / 2;
}

/**
 * The college's SAT 25th and 75th percentiles for the GPA curve models (gpa.md "The design" 7): the Reading and Math
 * ends added up, else the ACT composite's ends through the 2018 concordance.
 */
export function satQuartiles(school: Pick<School, "admissions">): [number, number] | null {
  const r = school.admissions?.sat_reading_25_75;
  const m = school.admissions?.sat_math_25_75;
  if (r && m) return [r[0] + m[0], r[1] + m[1]];
  const act = school.admissions?.act_composite_25_75;
  if (!act) return null;
  const lo = actPointToSat(act[0]);
  const hi = actPointToSat(act[1]);
  return lo === null || hi === null ? null : [lo, hi];
}

export interface GpaRow {
  /** SAT midpoint (satMidpoint). */
  sat: number;
  /** Admit rate, 0–1. */
  rate: number;
  /** Test-submission share, 0–1 (testSubmitShare). */
  submit: number;
  /** The college's unweighted GPA: its band mean when it has bands, else its C12 average. */
  gpa: number;
}

/**
 * The share of first-years who sent a test score: the larger of the SAT and ACT submission shares (IPEDS, or the newer
 * CDS), a lower bound on the share who sent either. At a test-optional college where few send scores, the reported
 * SAT range describes only the students who chose to send them and overstates the class, so the models read it
 * beside the scores (gpa.md "The model", 2026-10-11). Null when the college reports neither share.
 */
export function testSubmitShare(school: Pick<School, "admissions">): number | null {
  const a = school.admissions;
  const sat = a?.test_submission_rate_sat ?? null;
  const act = a?.test_submission_rate_act ?? null;
  if (sat === null && act === null) return null;
  return Math.max(sat ?? 0, act ?? 0);
}

/** The number of terms in the models: [1, SAT ÷ 100, admit rate, test-submission share]. */
const TERMS = 4;
export type GpaCoef = [number, number, number, number];

export interface GpaModel {
  /** GPA ≈ coef[0] + coef[1] × (SAT ÷ 100) + coef[2] × admit rate + coef[3] × test-submission share. */
  coef: GpaCoef;
  /** Training colleges. */
  n: number;
  /** Leave-one-out absolute error: the mean, and the 90th percentile. */
  meanError: number;
  p90Error: number;
  /** A flat guess's leave-one-out mean absolute error (each college guessed as the mean of the others), for the guard. */
  flatMeanError: number;
}

const features = (r: Pick<GpaRow, "sat" | "rate" | "submit">) => [1, r.sat / 100, r.rate, r.submit];

/** Least squares on [1, sat/100, rate, submit] through the normal equations; null when they're singular. */
function leastSquares(rows: GpaRow[]): GpaCoef | null {
  const a = Array.from({ length: TERMS }, () => new Array<number>(TERMS).fill(0));
  const b = new Array<number>(TERMS).fill(0);
  for (const r of rows) {
    const x = features(r);
    for (let i = 0; i < TERMS; i++) {
      b[i] += x[i] * r.gpa;
      for (let j = 0; j < TERMS; j++) a[i][j] += x[i] * x[j];
    }
  }
  // Gaussian elimination with partial pivoting.
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < TERMS; col++) {
    let pivot = col;
    for (let r = col + 1; r < TERMS; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < TERMS; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= TERMS; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[TERMS] / row[i]) as GpaCoef;
}

const predictRaw = (coef: GpaCoef, sat: number, rate: number, submit: number) => coef[0] + coef[1] * (sat / 100) + coef[2] * rate + coef[3] * submit;

/** The nearest-rank percentile of a list of numbers. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/** The guard's verdict on a measured fit (fitGpaModel): true when the model may be used. */
export function passesGuard(m: Pick<GpaModel, "n" | "p90Error" | "meanError" | "flatMeanError">, guard: GpaGuard): boolean {
  return m.n >= guard.minRows && m.p90Error <= guard.maxP90 && m.meanError <= (1 - guard.minGain) * m.flatMeanError;
}

/**
 * Fits the model and measures it by leave-one-out: each college predicted by a fit on the others, and by the mean of
 * the others (the flat guess). Null under the guard (`passesGuard`), so only the colleges' own figures are used.
 */
export function fitGpaModel(rows: GpaRow[], guard: GpaGuard = GPA_MODEL_GUARD): GpaModel | null {
  if (rows.length < TERMS + 2) return null;
  const coef = leastSquares(rows);
  if (!coef) return null;
  const errors: number[] = [];
  const flat: number[] = [];
  const total = rows.reduce((a, r) => a + r.gpa, 0);
  for (let i = 0; i < rows.length; i++) {
    const rest = leastSquares(rows.filter((_, j) => j !== i));
    if (!rest) return null;
    errors.push(Math.abs(predictRaw(rest, rows[i].sat, rows[i].rate, rows[i].submit) - rows[i].gpa));
    flat.push(Math.abs((total - rows[i].gpa) / (rows.length - 1) - rows[i].gpa));
  }
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const model: GpaModel = { coef, n: rows.length, meanError: mean(errors), p90Error: percentile(errors, 0.9), flatMeanError: mean(flat) };
  return passesGuard(model, guard) ? model : null;
}

/** The model's prediction, clamped to [2.0, 4.0]. */
export function predictGpa(model: GpaModel, sat: number, rate: number, submit: number): number {
  const [lo, hi] = GPA_PREDICT_RANGE;
  return Math.min(hi, Math.max(lo, predictRaw(model.coef, sat, rate, submit)));
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

/**
 * A training row for the college, when its GPA comes from source 1 or 2 and it has an SAT midpoint, an admit rate,
 * and a test-submission share.
 */
export function trainingRow(school: GpaSchool): GpaRow | null {
  const gpa = school.reported?.admission_profile?.gpa;
  if (!gpa || weightedAverage(school) !== null) return null;
  const target = bandMean(gpa.bands) ?? usableAverage(school);
  const sat = satMidpoint(school);
  const rate = school.admissions?.acceptance_rate ?? null;
  const submit = testSubmitShare(school);
  return target === null || sat === null || rate === null || submit === null ? null : { sat, rate, submit, gpa: target };
}

/** Training rows from every college in the dataset (never weighted reporters). */
export function trainingRows(schools: GpaSchool[]): GpaRow[] {
  return schools.map(trainingRow).filter((r): r is GpaRow => r !== null);
}

/* The GPA curve: a middle 50%, like the test scores (gpa.md "The design" 7) */

/** Each CDS C11 band's [low, high] edges, top band first (lib/cds/admissions.ts GPA_BANDS, read as continuous). */
export const GPA_BAND_EDGES = [
  [4.0, 4.0],
  [3.75, 4.0],
  [3.5, 3.75],
  [3.25, 3.5],
  [3.0, 3.25],
  [2.5, 3.0],
  [2.0, 2.5],
  [1.0, 2.0],
  [0, 1.0],
] as const;

/**
 * The p25 and p75 models' guard (GpaGuard). The cap is wider than the average model's because a percentile of a
 * college's spread varies more than its mean (a flat guess at the 25th percentile misses by 0.49 at the 90th
 * percentile, against 0.32 for the average); the required gain over a flat guess is the same.
 */
export const GPA_CURVE_GUARD: GpaGuard = { minRows: 25, maxP90: 0.35, minGain: 0.1 };

/**
 * The GPA at percentile `p` (0–1) of a column of C11 shares: walk up from the bottom band, assuming an even spread
 * inside each band (the 4.0 band is a point). Shares are read over their own total. Null for an empty column.
 */
export function gpaPercentile(bands: readonly (number | null)[], p: number): number | null {
  const total = bands.reduce<number>((a, b) => a + (b ?? 0), 0);
  if (!(total > 0)) return null;
  let cum = 0;
  for (let i = GPA_BAND_EDGES.length - 1; i >= 0; i--) {
    const share = (bands[i] ?? 0) / total;
    if (share > 0 && cum + share >= p - 1e-12) {
      const [lo, hi] = GPA_BAND_EDGES[i];
      return lo + Math.min(1, Math.max(0, (p - cum) / share)) * (hi - lo);
    }
    cum += share;
  }
  return GPA_BAND_EDGES[0][1];
}

/**
 * The college's own middle 50% from its C11 bands (`derived.gpa_middle_half` as the plan reads it): the "all"
 * column, else "with test", with shares adding up to at least half. Never for a weighted reporter (marked weighted,
 * or an average above 4.0), whose bands pile into the top one.
 */
export function bandMiddle(school: GpaSchool): { p25: number; p75: number } | null {
  if (weightedAverage(school) !== null) return null;
  const col = bandColumn(school.reported?.admission_profile?.gpa?.bands);
  if (!col) return null;
  const p25 = gpaPercentile(col.shares, 0.25);
  const p75 = gpaPercentile(col.shares, 0.75);
  return p25 === null || p75 === null ? null : { p25, p75 };
}

/** The two percentile models: p25 on [1, SAT 25th ÷ 100, admit rate, submission share], p75 on the SAT 75th instead. */
export interface GpaCurve {
  p25: GpaModel;
  p75: GpaModel;
}

/** Training rows for the curve models: colleges with an exact middle 50%, SAT/ACT quartiles, an admit rate, and a submission share. */
export function curveRows(schools: GpaSchool[]): { p25: GpaRow[]; p75: GpaRow[] } {
  const p25: GpaRow[] = [];
  const p75: GpaRow[] = [];
  for (const s of schools) {
    const mid = bandMiddle(s);
    const sat = satQuartiles(s);
    const rate = s.admissions?.acceptance_rate ?? null;
    const submit = testSubmitShare(s);
    if (!mid || !sat || rate === null || submit === null) continue;
    p25.push({ sat: sat[0], rate, submit, gpa: mid.p25 });
    p75.push({ sat: sat[1], rate, submit, gpa: mid.p75 });
  }
  return { p25, p75 };
}

/** Both curve models, or null when either fails its guard (estimated colleges then use the average rule). */
export function fitGpaCurve(rows: { p25: GpaRow[]; p75: GpaRow[] }, guard: GpaGuard = GPA_CURVE_GUARD): GpaCurve | null {
  const p25 = fitGpaModel(rows.p25, guard);
  const p75 = fitGpaModel(rows.p75, guard);
  return p25 && p75 ? { p25, p75 } : null;
}

/** The college's middle 50% of first-year GPAs: each end a range (a point when exact). */
export interface GpaMiddle {
  p25: [number, number];
  p75: [number, number];
  /** The two numbers shown ("3.62–4.00"): the exact ends, or the two predictions. */
  shown: [number, number];
  kind: "bands" | "estimated";
}

/**
 * The middle 50% (gpa.md "The design" 7): exact from the bands; else, for a college without its own unweighted
 * figure (no C12 average it may use, or only a weighted one), estimated from the two models ± each one's
 * 90th-percentile miss, clamped to [2.0, 4.0] with the 75th never under the 25th. A college with only a reported
 * average and no bands gets none (the average rule applies).
 */
export function gpaMiddle(school: GpaSchool, curve: GpaCurve | null): GpaMiddle | null {
  const exact = bandMiddle(school);
  if (exact) return { p25: [exact.p25, exact.p25], p75: [exact.p75, exact.p75], shown: [exact.p25, exact.p75], kind: "bands" };
  if (!curve || usableAverage(school) !== null) return null;
  const sat = satQuartiles(school);
  const rate = school.admissions?.acceptance_rate ?? null;
  const submit = testSubmitShare(school);
  if (!sat || rate === null || submit === null) return null;
  const [min, max] = GPA_PREDICT_RANGE;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const a = predictGpa(curve.p25, sat[0], rate, submit);
  const b = Math.max(a, predictGpa(curve.p75, sat[1], rate, submit));
  const p25: [number, number] = [clamp(a - curve.p25.p90Error), clamp(a + curve.p25.p90Error)];
  const p75: [number, number] = [Math.max(p25[0], clamp(b - curve.p75.p90Error)), Math.max(p25[1], clamp(b + curve.p75.p90Error))];
  return { p25, p75, shown: [a, b], kind: "estimated" };
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
  /**
   * The middle 50% of first-years' GPAs (gpaMiddle), when the college has one; the position rule prefers it. Absent
   * or null: the average rule.
   */
  middle?: GpaMiddle | null;
}

const clampRange = (lo: number, hi: number): [number, number] => [Math.max(0, lo), Math.min(4, hi)];

/** The college's GPA, best source first (gpa.md "The design" 1), with its middle 50% when it has one (7). */
export function collegeGpa(school: GpaSchool, model: GpaModel | null, curve: GpaCurve | null = null): CollegeGpa {
  return { ...averageGpa(school, model), middle: gpaMiddle(school, curve) };
}

function averageGpa(school: GpaSchool, model: GpaModel | null): CollegeGpa {
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
  const submit = testSubmitShare(school);
  if (!model || sat === null || rate === null || submit === null) return none(weighted);
  const est = predictGpa(model, sat, rate, submit);
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
 * The student's range against the college's middle 50% (gpa.md "The design" 7): below when it is entirely under the
 * 25th percentile's low end, above when entirely over the 75th's high end, in otherwise when the student's range is
 * at most STUDENT_RANGE_FOR_CLOSE wide, else null ("can't tell", only for a weighted student GPA). It leans toward
 * "in" when an estimate is uncertain.
 */
export function compareGpaMiddle(student: [number, number], middle: Pick<GpaMiddle, "p25" | "p75">): GpaPosition | null {
  const [s0, s1] = student;
  if (s1 < middle.p25[0]) return "below";
  if (s0 > middle.p75[1]) return "above";
  return s1 - s0 <= STUDENT_RANGE_FOR_CLOSE ? "in" : null;
}

/**
 * The citation behind a college's GPA, keyed by the field its sentence's ⓘ cites (standing.ts GpaCite): the C12
 * average, `derived.gpa_band_mean`, or `derived.gpa_estimate` with the fitted model's own formula, colleges, and
 * typical miss. Empty for "none". `cite` is the app's citeField.
 */
export function gpaCites<C extends object>(
  school: GpaSchool,
  gpa: CollegeGpa,
  model: GpaModel | null,
  cite: (path: FieldPath, school: never) => C,
  curve: GpaCurve | null = null,
): Record<string, C> {
  const s = school as never;
  // The middle 50%, when there is one, is what the sentence names (gpa.md "The design" 7).
  if (gpa.middle?.kind === "bands") return { "derived.gpa_middle_half": { ...cite("derived.gpa_middle_half", s), formula: GPA_MIDDLE_FORMULA } };
  if (gpa.middle?.kind === "estimated" && curve) return { "derived.gpa_estimate": { ...cite("derived.gpa_estimate", s), formula: gpaModelFormula(model, curve) } };
  if (gpa.kind === "reported") return { "reported.admission_profile.gpa.average": cite("reported.admission_profile.gpa.average", s) };
  if (gpa.kind === "bands") return { "derived.gpa_band_mean": cite("derived.gpa_band_mean", s) };
  if (gpa.kind === "estimated" && model) return { "derived.gpa_estimate": { ...cite("derived.gpa_estimate", s), formula: gpaModelFormula(model) } };
  return {};
}

/** How the plan reads `derived.gpa_middle_half` (its ⓘ): percentiles within the bands, not just the bands' edges. */
export const GPA_MIDDLE_FORMULA =
  "The 25th and 75th percentiles of first-years' GPAs, read from the college's GPA bands by walking up from the lowest band and assuming an even spread inside each band (the top band is exactly 4.0); the \"all\" column, else the column for students who sent test scores";

const signed = (v: number, digits: number) => `${v < 0 ? "−" : "+"} ${Math.abs(v).toFixed(digits)}`;

/**
 * The fitted models as plain lines, for `derived.gpa_estimate`'s ⓘ (each formula, its colleges, its typical miss):
 * the average model, and the two middle-50% models when the estimate is a middle 50%.
 */
export function gpaModelFormula(model: GpaModel | null, curve: GpaCurve | null = null): string {
  const parts: string[] = [];
  if (curve) {
    const line = (m: GpaModel, sat: string) =>
      `≈ ${m.coef[0].toFixed(2)} ${signed(m.coef[1], 3)} × (${sat} ÷ 100) ${signed(m.coef[2], 2)} × admit rate ${signed(m.coef[3], 2)} × share sending scores (typical miss ${m.meanError.toFixed(2)}, 90% of misses under ${m.p90Error.toFixed(2)})`;
    parts.push(
      `Estimated from colleges with similar test scores, admit rates, and shares sending scores: 25th-percentile GPA ${line(curve.p25, "SAT 25th")}; ` +
        `75th-percentile GPA ${line(curve.p75, "SAT 75th")}. ` +
        `Fitted on ${curve.p25.n} colleges whose GPA bands give their middle 50%; each end is shown with its 90th-percentile miss either side.`,
    );
  }
  if (model) {
    const [b0, b1, b2, b3] = model.coef;
    parts.push(
      `${curve ? "The average" : "Estimated from colleges with similar test scores, admit rates, and shares sending scores:"} GPA ≈ ${b0.toFixed(2)} ${signed(b1, 3)} × (SAT midpoint ÷ 100) ${signed(b2, 2)} × admit rate ${signed(b3, 2)} × share sending scores, ` +
        `fitted on ${model.n} colleges that publish an unweighted GPA. Its typical miss is ${model.meanError.toFixed(2)} GPA points (90% of misses under ${model.p90Error.toFixed(2)}). ` +
        "A college that publishes only a weighted average is kept between that average minus 1 and 4.0.",
    );
  }
  return parts.join(" ");
}
