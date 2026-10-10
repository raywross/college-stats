/**
 * A college's cost as a curve over family income (specs/product/cost-by-income.md "The model"): the published federal
 * net price bands up to $110K, then a labeled estimate that rises from the published part to the full price, and the
 * income where need-based aid ends (the break point). Pure: safe in server and client code and in tests, except
 * `estimatesShown`, which reads the deployment environment and belongs on the server.
 *
 * For the reference family (two parents, two children, one in college, typical assets), up to $110K the price is the
 * published federal band's (cited). Above it, one of two estimates, both continuous everywhere:
 *
 * 1. Anchored on a published promise, when the college publishes a free-tuition line L above $110K (and we know its
 *    tuition): flat at the last published step (P110) up to S = max($110K, its no-contribution line N), a straight
 *    rise to A = COA − tuition at L (the promise: no tuition, so the family pays at most the rest), then
 *      price(I) = min(COA, A + r × (I − L))     for I > L
 *    with r the sector default PROMISE_R (range PROMISE_R_LO–PROMISE_R_HI). Break point L + tuition / r. The $110K+
 *    band isn't used to fit it: that band includes full payers who only took federal loans and families richer than
 *    the national reference, so it can't be reconciled with a promise. It only flags a promise it sits far below.
 * 2. Calibrated, otherwise:
 *      price(I) = min(COA, max(P110, r × (I − P)))
 *    - P: where the family starts paying more than the bottom bands: the college's published no-contribution line,
 *      else DEFAULT_RAMP_START (moved right if needed so the ramp joins P110 at $110K without a jump).
 *    - r: cents of each extra dollar the family pays, calibrated per college so the model's average over the
 *      reference incomes above $110K (data/reference/income-above-110k.json) equals the college's published $110K+
 *      band. Bounded to R_MIN–R_MAX; at or outside a bound (within BOUND_MARGIN), no estimate ("data_ends").
 * COA is the full price, in-state at publics.
 */
import type { School } from "./types";
import { aidPolicyFor, type AidPolicy } from "./aid-policies.ts";
import reference from "../data/reference/income-above-110k.json" with { type: "json" };
import pilot from "../data/reference/cost-curve-pilot.json" with { type: "json" };

/** The federal bands stop here. */
export const FEDERAL_TOP = 110_000;
/** The chart's right edge ("and above"). */
export const INCOME_MAX = 400_000;

/** The four published steps (cost.net_price_by_income 0–3). The fifth band, $110K+, is the calibration target. */
export const FEDERAL_BANDS: { lo: number; hi: number; label: string }[] = [
  { lo: 0, hi: 30_000, label: "$0–30K" },
  { lo: 30_000, hi: 48_000, label: "$30–48K" },
  { lo: 48_000, hi: 75_000, label: "$48–75K" },
  { lo: 75_000, hi: FEDERAL_TOP, label: "$75–110K" },
];

/**
 * Where the ramp starts when the college publishes no income line: the income at which the federal need analysis
 * starts assessing a reference family's income. The spec's figure (cost-by-income.md "The model": "about $90K"),
 * from the need-analysis research in net-price-estimator.md (Research, 2026-10-02): the income protection allowance
 * for a family of four with one dependent student ($44,880 in the 2026–27 tables), plus the allowances for federal,
 * state, and payroll taxes and the employment expense allowance, which together protect income up to roughly this
 * level before parents' available income is assessed (at 22% to 47%). It is a round planning figure, not computed
 * from the tables here: the calibration's range varies it by ±RAMP_START_SPREAD, and the accuracy pilot is what
 * tunes it. Replace it with the versioned need-analysis tables (data/reference/need-analysis/) when the estimator
 * builds them.
 */
export const DEFAULT_RAMP_START = 90_000;
/** How far P is varied either way for the range. */
export const RAMP_START_SPREAD = 10_000;
/** The published $110K+ band is rounded and a sample average: the range reproduces it within ± this. */
export const BAND_SPREAD = 1_000;
/** Bounds on r: outside them the college's figures don't fit the model, so it gets no estimate. */
export const R_MIN = 0.15;
export const R_MAX = 0.6;
/**
 * A calibrated r this close to a bound is treated as outside it ("data_ends"): it means the bound, not the college's
 * figures, set the ramp. Typical cases: a public whose $110K+ band is lowered by state merit aid (r pinned at the
 * floor), or a band no ramp under R_MAX reproduces.
 */
export const BOUND_MARGIN = 0.01;
/**
 * Above a published free-tuition line, the share of each extra dollar of income a family is expected to pay: a
 * sector default, not calibrated per college. 0.30 is the federal formula's top assessment rate on parents'
 * available income (47%, net-price-estimator.md Research) applied to the roughly two-thirds of an extra pre-tax
 * dollar left after federal, state, and payroll taxes (0.47 × ~0.65 ≈ 0.31), rounded down for institutional formulas
 * that protect more. The range spans the owner's source document's two readings (cost-by-income.md "The source
 * document"): its rule of thumb's low end, 22 cents per dollar, and the roughly 40 cents its own table implies. The
 * accuracy pilot is what tunes it.
 */
export const PROMISE_R = 0.3;
export const PROMISE_R_LO = 0.22;
export const PROMISE_R_HI = 0.4;
/**
 * A promise-anchored curve whose average over the reference incomes is more than this above the published $110K+
 * band gets its promise flagged (`disagrees`) for the pilot. The flag doesn't change the curve.
 */
export const PROMISE_BAND_GAP = 10_000;
/** Need met below this (CDS H2 line i) means aid thins out unevenly ("gapping"): no clean break point. */
export const NEED_MET_FULL = 0.9;
/** Without need-met data, a $110K+ band at or above this share of the full price means little aid above $110K. */
export const LITTLE_AID_BAND_SHARE = 0.85;

export type NeedAidStatus = "break_point" | "little_above_110k" | "data_ends";

export interface CostCurveInput {
  /** The full price: in-state sticker at publics, else breakdown.full_price, else cost_of_attendance. */
  coa: number | null;
  /** cost.net_price_by_income (5 bands). */
  bands: (number | null)[] | null;
  policy: AidPolicy | null;
  /** 0–1: CDS first-year H2 line i, else aid.cds.pct_need_met. */
  needMet: number | null;
  /** school.type. */
  type: string | null;
  /** Yearly tuition and fees (in-state at publics): only used with a free-tuition promise. */
  tuition?: number | null;
}

export interface CostCurve {
  coa: number;
  status: NeedAidStatus;
  /** Steps 0–110K; a band the college has no figure for is left out. */
  published: { lo: number; hi: number; price: number }[];
  /**
   * The estimate's parameters (status "break_point" only). With `pin`, the curve is anchored on a published promise:
   * flat at the last published step to `P`, a straight rise to `pin.price` (COA − tuition) at `pin.income` (the
   * free-tuition line), then `r` (the sector default; `rLo`–`rHi` its range) of each extra dollar to the full price.
   * Without `pin`, calibrated: the ramp `r × (income − P)` above the last published step, `rLo`–`rHi` the r values
   * that still reproduce the $110K+ band within its rounding and P's uncertainty.
   */
  ramp: { P: number; r: number; rLo: number; rHi: number; pin?: { income: number; price: number } } | null;
  /** Rounded to $10K. */
  breakIncome: { mid: number; lo: number; hi: number } | null;
  /**
   * The college's published income lines, as markers. `cap` (free tuition only): the most the promise lets the
   * reference family pay at its income, the full price minus tuition; an anchored curve passes through it.
   * `disagrees`: the published $110K+ band sits far below the anchored curve's average (more than PROMISE_BAND_GAP),
   * or a no-contribution line couldn't be used as the calibrated ramp's start; a flag for the pilot, not a change to
   * the curve.
   */
  promises: { income: number; kind: "free_tuition" | "no_contribution"; label: string; disagrees?: true; cap?: number }[];
}

export type PriceKind = "published" | "estimate" | "full_price" | "unknown";

/* ------------------------------------------------------------------ */
/* Reference incomes above $110K                                       */
/* ------------------------------------------------------------------ */

interface Bracket {
  lo: number;
  hi: number | null;
  share: number;
}
export interface ReferenceDistribution {
  brackets: Bracket[];
  pareto_alpha: number;
  cap: number;
}

/** Points per closed bracket and in the open top bracket: the price is piecewise linear, so this is plenty. */
const CLOSED_POINTS = 50;
const TAIL_POINTS = 400;

/**
 * The reference incomes above FEDERAL_TOP as weighted points (weights sum to 1): closed brackets uniform (a bracket
 * that straddles $110K keeps its share above it, pro rata), the open top bracket a Pareto tail truncated at `cap`,
 * placed at its quantiles.
 */
export function referenceSamples(dist: ReferenceDistribution = reference as ReferenceDistribution): { income: number[]; weight: number[] } {
  const income: number[] = [];
  const weight: number[] = [];
  for (const b of dist.brackets) {
    if (b.hi !== null && b.hi <= FEDERAL_TOP) continue;
    const lo = Math.max(b.lo, FEDERAL_TOP);
    if (b.hi === null) {
      const a = dist.pareto_alpha;
      const tailCut = 1 - (lo / dist.cap) ** a;
      for (let k = 0; k < TAIL_POINTS; k++) {
        const u = (k + 0.5) / TAIL_POINTS;
        income.push(lo * (1 - u * tailCut) ** (-1 / a));
        weight.push(b.share / TAIL_POINTS);
      }
    } else {
      const share = (b.share * (b.hi - lo)) / (b.hi - b.lo);
      const w = (b.hi - lo) / CLOSED_POINTS;
      for (let k = 0; k < CLOSED_POINTS; k++) {
        income.push(lo + (k + 0.5) * w);
        weight.push(share / CLOSED_POINTS);
      }
    }
  }
  const total = weight.reduce((a, b) => a + b, 0);
  return { income, weight: weight.map((w) => w / total) };
}

const SAMPLES = referenceSamples();

/* ------------------------------------------------------------------ */
/* The model                                                           */
/* ------------------------------------------------------------------ */

const round10k = (x: number) => Math.round(x / 10_000) * 10_000;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

type Pin = { income: number; price: number };
type Ramp = NonNullable<CostCurve["ramp"]>;

/** Where a calibrated ramp starts for slope r: P, moved right if the ramp would already be above P110 at $110K. */
function rampStart(P: number, r: number, floor: number): number {
  return Math.max(P, FEDERAL_TOP - floor / r);
}

function calibratedPrice(income: number, coa: number, floor: number, start: number, r: number): number {
  return Math.min(coa, Math.max(floor, r * (income - start)));
}

/** The anchored curve at an income above $110K, with slope r above the promise. Continuous by construction. */
function anchoredPrice(income: number, coa: number, floor: number, S: number, pin: Pin, r: number): number {
  if (income <= S) return floor;
  if (income <= pin.income) return floor + ((pin.price - floor) * (income - S)) / (pin.income - S);
  return Math.min(coa, pin.price + r * (income - pin.income));
}

/** The middle of the curve at an income above $110K (r, not the range). */
function centralPrice(curve: CostCurve, ramp: Ramp, income: number): number {
  const floor = lastStep(curve);
  return ramp.pin ? anchoredPrice(income, curve.coa, floor, ramp.P, ramp.pin, ramp.r) : calibratedPrice(income, curve.coa, floor, ramp.P, ramp.r);
}

const lastStep = (curve: Pick<CostCurve, "published">) => curve.published[curve.published.length - 1].price;

function average(price: (income: number) => number, samples = SAMPLES): number {
  let sum = 0;
  for (let i = 0; i < samples.income.length; i++) sum += samples.weight[i] * price(samples.income[i]);
  return sum;
}

/** r that makes the calibrated average equal `target`, or the bound it falls outside ("low" / "high"). */
function solveR(target: number, coa: number, floor: number, P: number): number | "low" | "high" {
  const f = (r: number) => average((i) => calibratedPrice(i, coa, floor, rampStart(P, r, floor), r)) - target;
  if (f(R_MIN) > 0) return "low";
  if (f(R_MAX) < 0) return "high";
  let lo = R_MIN;
  let hi = R_MAX;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const clampR = (r: number | "low" | "high") => (r === "low" ? R_MIN : r === "high" ? R_MAX : r);
/** Inside the bounds by more than the margin: the college's figures, not a bound, set r. */
const fits = (r: number | "low" | "high"): r is number => typeof r === "number" && r - R_MIN >= BOUND_MARGIN && R_MAX - r >= BOUND_MARGIN;

const kDollars = (x: number) => `$${Math.round(x / 1000)}K`;

/**
 * The policy's income lines as markers. The curve is the in-state curve at publics (costCurveInput), so a line that
 * applies only to in-state families (`applies_to: "in_state"`) belongs on it, labeled so; an out-of-state view must not
 * use these promises or this curve's ramp.
 */
function promisesOf(policy: AidPolicy | null): CostCurve["promises"] {
  const out: CostCurve["promises"] = [];
  const who = policy?.applies_to === "in_state" ? " (in-state)" : "";
  if (policy?.free_tuition_under) out.push({ income: policy.free_tuition_under, kind: "free_tuition", label: `No tuition under ${kDollars(policy.free_tuition_under)}${who}` });
  if (policy?.no_contribution_under)
    out.push({ income: policy.no_contribution_under, kind: "no_contribution", label: `Families pay nothing toward cost under ${kDollars(policy.no_contribution_under)}${who}` });
  return out.sort((a, b) => a.income - b.income);
}

/**
 * The model's inputs from a school record and its published policy (looked up when not passed; null for none). At
 * publics everything is in-state (full price, tuition, and the federal net price, which covers in-state students), so
 * a policy line for in-state families applies as stated.
 */
export function costCurveInput(school: School, policy?: AidPolicy | null): CostCurveInput {
  const c = school.cost;
  const isPublic = school.type === "public";
  const coa = isPublic
    ? (c?.sticker?.in_state ?? c?.cost_of_attendance ?? null)
    : (c?.breakdown?.full_price ?? c?.sticker?.in_state ?? c?.cost_of_attendance ?? null);
  const tuition = isPublic
    ? (c?.tuition_fees?.in_state ?? c?.tuition_in_state ?? null)
    : (c?.breakdown?.tuition_fees ?? c?.tuition_fees?.in_state ?? c?.tuition_in_state ?? null);
  return {
    coa,
    bands: c?.net_price_by_income ?? null,
    policy: policy === undefined ? aidPolicyFor(school.unit_id) : policy,
    needMet: school.reported?.aid?.first_years?.i ?? school.aid?.cds?.pct_need_met ?? null,
    type: school.type ?? null,
    tuition,
  };
}

/** The curve, or null when the college has no full price. */
export function costCurve(input: CostCurveInput): CostCurve | null {
  const coa = input.coa;
  if (!isNum(coa) || coa <= 0) return null;
  const bands = input.bands ?? [];
  const published = FEDERAL_BANDS.flatMap((b, i) => (isNum(bands[i]) ? [{ lo: b.lo, hi: b.hi, price: bands[i] as number }] : []));
  const promises = promisesOf(input.policy);
  const base = { coa, published, promises };
  const none = (status: NeedAidStatus): CostCurve => ({ ...base, status, ramp: null, breakIncome: null });
  if (!published.length) return none("data_ends");
  const floor = lastStep(base);
  const band110 = bands[4];
  const policy = input.policy;

  // 1. Anchored on a published free-tuition line above $110K. An in-state line counts only on a public's (in-state) curve.
  const L = policy?.free_tuition_under;
  const tuition = input.tuition;
  const lineApplies = policy?.applies_to !== "in_state" || input.type === "public";
  if (isNum(L) && L > FEDERAL_TOP && isNum(tuition) && tuition > 0 && tuition < coa && lineApplies) {
    const pin: Pin = { income: L, price: coa - tuition };
    const N = policy?.no_contribution_under ?? null;
    // The rise starts at the no-contribution line (never before $110K), and always before L so it stays continuous.
    const S = Math.min(Math.max(N ?? FEDERAL_TOP, FEDERAL_TOP), L - 10_000);
    const ramp: Ramp = { P: Math.max(S, FEDERAL_TOP), r: PROMISE_R, rLo: PROMISE_R_LO, rHi: PROMISE_R_HI, pin };
    const breakAt = (r: number) => round10k(L + tuition / r);
    const curve: CostCurve = { ...base, status: "break_point", ramp, breakIncome: { mid: breakAt(PROMISE_R), lo: breakAt(PROMISE_R_HI), hi: breakAt(PROMISE_R_LO) } };
    for (const p of promises) if (p.kind === "free_tuition") p.cap = pin.price;
    if (isNum(band110) && band110 < average((i) => centralPrice(curve, ramp, i)) - PROMISE_BAND_GAP)
      for (const p of promises) if (p.kind === "free_tuition") p.disagrees = true;
    return curve;
  }

  // 2. Calibrated to the $110K+ band.
  if (!isNum(band110)) return none("data_ends");
  const needMet = input.needMet;
  if (isNum(needMet) ? needMet < NEED_MET_FULL : band110 >= LITTLE_AID_BAND_SHARE * coa) return none("little_above_110k");

  const policyP = policy?.no_contribution_under ?? null;
  let P = policyP ?? DEFAULT_RAMP_START;
  let r = solveR(band110, coa, floor, P);
  if (!fits(r) && policyP !== null && policyP !== DEFAULT_RAMP_START) {
    // The no-contribution line and the band don't fit together: start from the default and flag the line.
    const fallback = solveR(band110, coa, floor, DEFAULT_RAMP_START);
    if (fits(fallback)) {
      P = DEFAULT_RAMP_START;
      r = fallback;
      for (const p of promises) if (p.kind === "no_contribution") p.disagrees = true;
    }
  }
  if (!fits(r)) return none("data_ends");
  const corners = [r];
  for (const dB of [-BAND_SPREAD, BAND_SPREAD]) for (const dP of [-RAMP_START_SPREAD, 0, RAMP_START_SPREAD]) corners.push(clampR(solveR(band110 + dB, coa, floor, P + dP)));
  const rLo = Math.min(...corners);
  const rHi = Math.max(...corners);
  const start = rampStart(P, r, floor);
  const breakIncome = {
    mid: round10k(start + coa / r),
    lo: round10k(rampStart(start, rHi, floor) + coa / rHi),
    hi: round10k(start + coa / rLo),
  };
  return { ...base, status: "break_point", ramp: { P: start, r, rLo, rHi }, breakIncome };
}

/**
 * The model's own average price over the reference incomes above $110K, or null without an estimate: for a calibrated
 * curve, what the calibration matched to the $110K+ band; for an anchored curve, what the flag compares with it.
 */
export function calibrationAverage(curve: CostCurve): number | null {
  const ramp = curve.ramp;
  if (!ramp) return null;
  return average((i) => centralPrice(curve, ramp, i));
}

/**
 * The price at one income: published (the band's figure), estimate (a range), full_price (past the break point), or
 * unknown (lo/hi NaN): a missing band, no estimate for this college, or estimates turned off (`showEstimates` false,
 * so everything above $110K is unknown).
 */
export function priceAt(curve: CostCurve, income: number, showEstimates: boolean): { lo: number; hi: number; kind: PriceKind } {
  const unknown = { lo: NaN, hi: NaN, kind: "unknown" as const };
  if (income <= FEDERAL_TOP) {
    const i = FEDERAL_BANDS.findIndex((b) => income < b.hi);
    const band = FEDERAL_BANDS[i === -1 ? FEDERAL_BANDS.length - 1 : i];
    const step = curve.published.find((p) => p.lo === band.lo);
    return step ? { lo: step.price, hi: step.price, kind: "published" } : unknown;
  }
  const ramp = curve.ramp;
  if (!showEstimates || curve.status !== "break_point" || !ramp) return unknown;
  const floor = lastStep(curve);
  const at = (r: number, start: number) =>
    ramp.pin ? anchoredPrice(income, curve.coa, floor, ramp.P, ramp.pin, r) : calibratedPrice(income, curve.coa, floor, start, r);
  const a = at(ramp.rLo, ramp.P);
  const b = at(ramp.rHi, rampStart(ramp.P, ramp.rHi, floor));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo >= curve.coa ? { lo: curve.coa, hi: curve.coa, kind: "full_price" } : { lo, hi, kind: "estimate" };
}

/** The curve sampled every `step` dollars from $0 to INCOME_MAX (plus $110K itself), for charts and tables. */
export function curvePoints(curve: CostCurve, showEstimates: boolean, step = 10_000): { income: number; lo: number; hi: number; mid: number; kind: PriceKind }[] {
  const incomes: number[] = [];
  for (let x = 0; x <= INCOME_MAX; x += step) incomes.push(x);
  if (!incomes.includes(FEDERAL_TOP)) incomes.push(FEDERAL_TOP);
  return incomes
    .sort((a, b) => a - b)
    .map((income) => {
      const p = priceAt(curve, income, showEstimates);
      return { income, ...p, mid: (p.lo + p.hi) / 2 };
    });
}

/**
 * Whether estimated prices and break points are shown (the accuracy pilot's gate, cost-by-income.md): on preview
 * and development deployments, or in production once data/reference/cost-curve-pilot.json says the pilot passed.
 * Server-side only (VERCEL_ENV isn't sent to the browser): pass the result down as a prop.
 */
export function estimatesShown(env: string | undefined = typeof process !== "undefined" ? process.env.VERCEL_ENV : undefined): boolean {
  return env !== "production" || (pilot as { passed: boolean }).passed === true;
}
