/**
 * A college's cost as a curve over family income (specs/product/cost-by-income.md "The model"): the published federal
 * net price bands up to $110K, then a labeled estimate that ramps from the published part to the full price, and the
 * income where need-based aid ends (the break point). Pure: safe in server and client code and in tests, except
 * `estimatesShown`, which reads the deployment environment and belongs on the server.
 *
 * For the reference family (two parents, two children, one in college, typical assets), the price at income I:
 *
 *   price(I) = federal band price                 for I ≤ $110K   (published, cited)
 *   price(I) = min(COA, max(P110, r × (I − P)))    for I > $110K   (estimate)
 *
 * - COA: the full price (in-state at publics).
 * - P110: the published curve's last step, so the estimate joins it without a jump.
 * - P: where the family starts paying more than the bottom bands: the college's published "no contribution" line,
 *   else DEFAULT_RAMP_START. A published free-tuition line L adds price(L) ≤ COA − tuition, which moves P right.
 * - r: cents of each extra dollar the family pays, calibrated per college so the model's average over the reference
 *   incomes above $110K (data/reference/income-above-110k.json) equals the college's published $110K+ band. Bounded
 *   to R_MIN–R_MAX; outside, no estimate ("data_ends").
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
   * The estimate's parameters (status "break_point" only). `pin`, when a free-tuition promise constrains the ramp:
   * at `pin.income` the price can't exceed `pin.price` (COA − tuition), so a steeper r starts later.
   */
  ramp: { P: number; r: number; rLo: number; rHi: number; pin?: { income: number; price: number } } | null;
  /** Rounded to $10K. */
  breakIncome: { mid: number; lo: number; hi: number } | null;
  /**
   * The college's published income lines, as markers. `disagrees`: the published $110K+ band can't be reproduced
   * with the ramp held to this promise (a free-tuition pin, or a no-contribution line as P), so the estimate was
   * calibrated without it. The promise wins where they disagree: `priceAt` holds estimates at and below its income to
   * `cap` (the full price minus tuition for free tuition; the $75–110K price for no contribution), so the curve steps
   * up at the promise's income. The disagreement is for the pilot to settle.
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

type Pin = { income: number; price: number } | undefined;

/**
 * Where the ramp starts for slope r: P, moved right when the ramp would otherwise already be above the last published
 * step at $110K (so it joins the published part without a jump) or break a free-tuition pin.
 */
function rampStart(P: number, r: number, pin: Pin, floor: number): number {
  const joined = Math.max(P, FEDERAL_TOP - floor / r);
  return pin ? Math.max(joined, pin.income - pin.price / r) : joined;
}

function rampPrice(income: number, coa: number, floor: number, start: number, r: number): number {
  return Math.min(coa, Math.max(floor, r * (income - start)));
}

function averagePrice(coa: number, floor: number, P: number, r: number, pin: Pin, samples = SAMPLES): number {
  const start = rampStart(P, r, pin, floor);
  let sum = 0;
  for (let i = 0; i < samples.income.length; i++) sum += samples.weight[i] * rampPrice(samples.income[i], coa, floor, start, r);
  return sum;
}

/** r that makes the average equal `target`, or the bound it falls outside ("low" / "high"). */
function solveR(target: number, coa: number, floor: number, P: number, pin: Pin): number | "low" | "high" {
  const f = (r: number) => averagePrice(coa, floor, P, r, pin) - target;
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

  const band110 = bands[4];
  if (!isNum(band110) || !published.length) return none("data_ends");
  const needMet = input.needMet;
  if (isNum(needMet) ? needMet < NEED_MET_FULL : band110 >= LITTLE_AID_BAND_SHARE * coa) return none("little_above_110k");

  const floor = published[published.length - 1].price;
  const ftu = input.policy?.free_tuition_under;
  const wantedPin: Pin = isNum(ftu) && ftu > FEDERAL_TOP && isNum(input.tuition) && input.tuition > 0 ? { income: ftu, price: coa - input.tuition } : undefined;
  const policyP = input.policy?.no_contribution_under ?? null;

  // The promises and the band may not all hold over the reference incomes. Try the ramp held to every promise, then
  // without the free-tuition pin, then without the no-contribution line; flag what was dropped (it wins on display).
  const attempts: { P: number; pin: Pin; dropped: CostCurve["promises"][number]["kind"][] }[] = [{ P: policyP ?? DEFAULT_RAMP_START, pin: wantedPin, dropped: [] }];
  if (wantedPin) attempts.push({ P: policyP ?? DEFAULT_RAMP_START, pin: undefined, dropped: ["free_tuition"] });
  if (policyP !== null && policyP !== DEFAULT_RAMP_START) {
    if (wantedPin) attempts.push({ P: DEFAULT_RAMP_START, pin: wantedPin, dropped: ["no_contribution"] });
    attempts.push({ P: DEFAULT_RAMP_START, pin: undefined, dropped: wantedPin ? ["free_tuition", "no_contribution"] : ["no_contribution"] });
  }
  let chosen: (typeof attempts)[number] | null = null;
  let r: number | "low" | "high" = "high";
  for (const a of attempts) {
    r = solveR(band110, coa, floor, a.P, a.pin);
    if (typeof r === "number") {
      chosen = a;
      break;
    }
  }
  if (!chosen || typeof r !== "number") return none("data_ends");
  const { P, pin } = chosen;
  for (const p of promises) {
    if (!chosen.dropped.includes(p.kind)) continue;
    p.disagrees = true;
    const cap = p.kind === "free_tuition" ? wantedPin?.price : floor;
    if (cap !== undefined) p.cap = cap;
  }
  const corners = [r];
  for (const dB of [-BAND_SPREAD, BAND_SPREAD]) for (const dP of [-RAMP_START_SPREAD, 0, RAMP_START_SPREAD]) corners.push(clampR(solveR(band110 + dB, coa, floor, P + dP, pin)));
  const rLo = Math.min(...corners);
  const rHi = Math.max(...corners);
  const start = rampStart(P, r, pin, floor);
  const breakIncome = {
    mid: round10k(start + coa / r),
    lo: round10k(rampStart(start, rHi, pin, floor) + coa / rHi),
    hi: round10k(start + coa / rLo),
  };
  return { ...base, status: "break_point", ramp: { P: start, r, rLo, rHi, ...(pin ? { pin } : {}) }, breakIncome };
}

/** The model's own average price over the reference incomes above $110K (what calibration matched), or null. */
export function calibrationAverage(curve: CostCurve): number | null {
  if (!curve.ramp) return null;
  const floor = curve.published[curve.published.length - 1].price;
  return averagePrice(curve.coa, floor, curve.ramp.P, curve.ramp.r, undefined);
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
  const floor = curve.published[curve.published.length - 1].price;
  const a = rampPrice(income, curve.coa, floor, ramp.P, ramp.rLo);
  const b = rampPrice(income, curve.coa, floor, rampStart(ramp.P, ramp.rHi, ramp.pin, floor), ramp.rHi);
  // A promise the estimate disagrees with wins at and below its income.
  const cap = Math.min(...curve.promises.filter((p) => p.disagrees && p.cap !== undefined && income <= p.income).map((p) => p.cap!));
  const lo = Math.min(a, b, cap);
  const hi = Math.min(Math.max(a, b), cap);
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
