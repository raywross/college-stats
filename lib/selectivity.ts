/**
 * Quad's selectivity (specs/chances/selectivity-index.md): a hidden score (0–100) per college and pool, from the
 * figures the college publishes, read as one of five public tiers, Elite to Open. This module holds the method: the
 * inputs, their scales, the weights, the cutoffs, and the hysteresis band. The build (`npm run build-selectivity`,
 * scripts/lib/selectivity.mts) writes the tiers to `school.selectivity` and the score to data/selectivity-index.json;
 * pages read only the tiers (lib/selectivity-tier.ts). Never shown: the weights, the score, or the cutoffs (the chip's
 * panel lists the inputs as cited facts). Pure, no I/O; kept out of client bundles (tests/selectivity.test.mts).
 *
 * Second version (2026-10-12, "As built (second version)" in the spec): each input is read on a continuous scale (the
 * admit rate and the shares on the log-odds scale, the SAT as points) and standardized over the colleges that report
 * it, so a 3% and a 9% admit rate stay far apart instead of both reading as the 98th percentile. The first version
 * percentiled every input and added trend points before capping at 100, which tied 22 colleges at the top.
 */
import type { School } from "./types";
import type { SelectivityPool, SelectivityTier } from "./chances/types.ts";
import { SELECTIVITY_TIERS } from "./chances/levels.ts";
import { sameClassYield } from "./derive.ts";
import { satTotal } from "./score-bands.ts";
import { actToSat } from "./planner/concordance.ts";
import { admitRatesByResidency } from "./cds/residency-display.ts";

export { tierForStudent } from "./selectivity-tier.ts";

/* ---- Constants (the method; never on a page) ---- */

/**
 * The inputs, each standardized over the colleges that report it (higher = harder to get into):
 * the admit rate, the admitted class's SAT (75th percentile), yield, first-year retention, and the graduation rate.
 */
export type ScoreInput = "admit_rate" | "class_strength" | "yield" | "retention" | "graduation";

/**
 * Weights (sum 90; the score divides by the sum). Checked on 2026-10-12 against seven public rankings (U.S. News
 * national and liberal arts, Forbes, Niche's best and hardest-admissions lists, QS U.S., WSJ): tuned on any five,
 * the weights that did best agreed with the sixth within 0.74–0.92 (rank correlation), and the average agreement
 * moved by under 0.02 across every nearby weighting, so these round, explainable weights were kept over the best fit
 * (0.841 against 0.845). Trend points, early-decision share, the top-GPA share, the waitlist, and the C7 count each
 * lowered the agreement and were dropped.
 */
export const WEIGHTS: Record<ScoreInput, number> = {
  admit_rate: 45,
  class_strength: 20,
  yield: 10,
  retention: 10,
  graduation: 5,
};

/**
 * Evidence: a college that admits few students is pulled toward the middle by admitted ÷ (admitted + this), so a
 * conservatory admitting 26 of 568 or a college admitting 30 of 413 can't top the scale on one small class.
 */
export const EVIDENCE_ADMITS = 50;

/** The score is 40 + 20 × the weighted standardized mean, held to 0–100: the middle college reads about 40. */
export const SCORE_CENTER = 40;
export const SCORE_SPREAD = 20;

/**
 * Ultra selective (key `elite`): score at or above this. Set 2026-10-12 at the gap below the 29th college (80.3, then
 * 79.4); moved only by a deliberate change here. No admit-rate condition: the score already weighs the rate, and a fixed
 * 10% line put colleges ranked above Cornell outside the top tier.
 */
export const ELITE_INDEX = 80;

/**
 * The other cutoffs, hardest first. Selective, Accessible and Open hold about as many colleges as under the first
 * version; the old Highly selective band (55–80) was split on 2026-10-12 (owner) at the gap near 68, and Very selective
 * reaches down to 52, taking the top of the old Selective band with it.
 */
export const TIER_CUTOFFS: Record<Exclude<SelectivityTier, "elite" | "open">, number> = {
  highly_selective: 68,
  very_selective: 52,
  selective: 42,
  accessible: 33,
};

/** A tier changes at a publish only when the score crosses the cutoff by this many points. */
export const HYSTERESIS = 2;

/**
 * The top band of Ultra selective (method/standing.md "Revision 3", rule 8; owner, 2026-10-12): Ultra selective
 * colleges whose score for all applicants is at least this. Seven on 2026-10-12 (Yale, Chicago, Harvard, Stanford, MIT,
 * Princeton, Penn); Brown is next at 89.6. Stored on the college as the word `band: "top"`, never the score.
 */
export const TOP_BAND_SCORE = 90;

/**
 * Whether an Ultra selective college is in the top band: its score for all applicants at least TOP_BAND_SCORE to
 * enter; once in (`previous` "top"), it leaves only when the score falls HYSTERESIS points below, as tiers do.
 */
export function topBand(score: number | null, tier: SelectivityTier | null, previous: "top" | null | undefined = null): "top" | null {
  if (score === null || tier !== "elite") return null;
  if (score >= TOP_BAND_SCORE) return "top";
  if (previous === "top" && score > TOP_BAND_SCORE - HYSTERESIS) return "top";
  return null;
}

/** The Elite count the verify guard holds the dataset to (an alarm band, not a target). */
export const ELITE_COUNT_RANGE: readonly [number, number] = [20, 50];

/* ---- Inputs ---- */

/** One college's published figures. Null = not reported. */
export interface RawInputs {
  /** The overall admit rate (`admissions.acceptance_rate`). */
  admitRate: number | null;
  /** Residency rates (`derived.admit_rate_in_state` / `_out_of_state`) at a public that publishes both. */
  inStateRate: number | null;
  outOfStateRate: number | null;
  /** SAT total 75th percentile, or the ACT 75th through the 2018 concordance. */
  sat75: number | null;
  yield: number | null;
  retention: number | null;
  graduation: number | null;
  admitted: number | null;
  enrolled: number | null;
  undergrad: number | null;
}

/** The figures one college publishes, read from the dataset with the site's own helpers. */
export function rawInputs(school: School): RawInputs {
  const a = school.admissions;
  const sat = satTotal(school);
  const act = a.act_composite_25_75;
  const res = school.type === "public" ? admitRatesByResidency(school) : null;
  const pools = res && res.in_state !== null && res.out_of_state !== null;
  return {
    admitRate: a.acceptance_rate,
    inStateRate: pools ? res.in_state : null,
    outOfStateRate: pools ? res.out_of_state : null,
    sat75: sat ? sat[1] : act ? actToSat(act[1]) : null,
    yield: sameClassYield(school),
    retention: school.outcomes?.retention_rate ?? null,
    graduation: school.outcomes?.graduation_rate ?? null,
    admitted: a.admitted ?? null,
    enrolled: a.enrolled ?? null,
    undergrad: school.demographics?.undergrad_enrollment ?? null,
  };
}

/**
 * Figures that can't describe one first-year class: more first-years enrolled than undergraduates in all (a health
 * science center whose admissions count a professional program). Such a college is left unrated.
 */
export function inconsistent(raw: RawInputs): boolean {
  return raw.enrolled !== null && raw.undergrad !== null && raw.undergrad > 0 && raw.enrolled > raw.undergrad;
}

/* ---- Scales ---- */

const EPS = 0.005;
/** Log-odds, with shares held inside 0.5%–99.5% so a 0% or 100% figure stays finite. */
export const logit = (p: number) => {
  const q = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(q / (1 - q));
};

/** The value each input reads on its scale (higher = harder), before standardizing. */
const ON_SCALE: Record<ScoreInput, (r: RawInputs, rate: number | null) => number | null> = {
  admit_rate: (_r, rate) => (rate === null ? null : -logit(rate)),
  class_strength: (r) => r.sat75,
  yield: (r) => (r.yield ? logit(r.yield) : null),
  retention: (r) => (r.retention ? logit(r.retention) : null),
  graduation: (r) => (r.graduation ? logit(r.graduation) : null),
};

const INPUTS = Object.keys(WEIGHTS) as ScoreInput[];
/** What a missing SAT is filled from: the college's other inputs. */
const SAT_FROM: readonly ScoreInput[] = ["admit_rate", "yield", "retention", "graduation"];

/** Each input's mean and spread over the reporters, and the fit that fills a missing SAT. */
export interface Scales {
  mean: Record<ScoreInput, number>;
  sd: Record<ScoreInput, number>;
  /** Intercept, then one coefficient per `SAT_FROM` input, in standardized units. */
  satFit: number[];
}

/** Ordinary least squares with an intercept (normal equations; a handful of predictors). */
export function leastSquares(xs: readonly number[][], ys: readonly number[]): number[] {
  const k = (xs[0]?.length ?? 0) + 1;
  const a = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  xs.forEach((x, n) => {
    const row = [1, ...x];
    for (let i = 0; i < k; i++) {
      b[i] += row[i] * ys[n];
      for (let j = 0; j < k; j++) a[i][j] += row[i] * row[j];
    }
  });
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
    [a[i], a[piv]] = [a[piv], a[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
    for (let r = i + 1; r < k; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < k; c++) a[r][c] -= f * a[i][c];
      b[r] -= f * b[i];
    }
  }
  const beta = new Array<number>(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < k; j++) s -= a[i][j] * beta[j];
    beta[i] = s / a[i][i];
  }
  return beta;
}

/** Standardized readings for one college (null = not reported), before filling. */
function readings(raw: RawInputs, scales: Pick<Scales, "mean" | "sd">, rate: number | null): Record<ScoreInput, number | null> {
  const out = {} as Record<ScoreInput, number | null>;
  for (const k of INPUTS) {
    const v = ON_SCALE[k](raw, rate);
    out[k] = v === null ? null : (v - scales.mean[k]) / scales.sd[k];
  }
  return out;
}

/** The scales over these colleges (every rated, consistent college at this publish). */
export function scales(all: readonly RawInputs[]): Scales {
  const rated = all.filter((r) => r.admitRate !== null && !inconsistent(r));
  const mean = {} as Record<ScoreInput, number>;
  const sd = {} as Record<ScoreInput, number>;
  for (const k of INPUTS) {
    const vs = rated.map((r) => ON_SCALE[k](r, r.admitRate)).filter((v): v is number => v !== null);
    const m = vs.reduce((x, y) => x + y, 0) / (vs.length || 1);
    mean[k] = m;
    sd[k] = Math.sqrt(vs.reduce((x, y) => x + (y - m) ** 2, 0) / (vs.length || 1)) || 1;
  }
  const z = rated.map((r) => readings(r, { mean, sd }, r.admitRate));
  const fitRows = z.filter((r) => r.class_strength !== null && SAT_FROM.every((k) => r[k] !== null));
  const satFit = leastSquares(
    fitRows.map((r) => SAT_FROM.map((k) => r[k] as number)),
    fitRows.map((r) => r.class_strength as number)
  );
  return { mean, sd, satFit };
}

/** The admit rate a pool reads: the residency rate for in-state and out-of-state, else the overall rate. */
export function poolRate(raw: RawInputs, pool: SelectivityPool): number | null {
  return pool === "in_state" ? raw.inStateRate : pool === "out_of_state" ? raw.outOfStateRate : raw.admitRate;
}

/**
 * One college's standardized readings for a pool, every input filled: a missing yield, retention, or graduation rate
 * reads as the middle (0), and a missing SAT (test-blind and test-free colleges) as what the fit predicts from the
 * other four.
 */
export function filledReadings(raw: RawInputs, sc: Scales, pool: SelectivityPool = "all"): Record<ScoreInput, number> | null {
  const rate = poolRate(raw, pool);
  if (rate === null) return null;
  const z = readings(raw, sc, rate);
  const out = {} as Record<ScoreInput, number>;
  for (const k of INPUTS) if (k !== "class_strength") out[k] = z[k] ?? 0;
  out.class_strength = z.class_strength ?? sc.satFit[0] + SAT_FROM.reduce((s, k, i) => s + sc.satFit[i + 1] * out[k], 0);
  return out;
}

/**
 * The score before rounding: the weighted mean of the filled readings, pulled toward the middle for a small admitted
 * class, on the 40 ± 20 scale, held to 0–100. Null without an admit rate for the pool, or with inconsistent figures.
 * The build orders colleges by it, so two colleges whose rounded scores match still get distinct ranks.
 */
export function selectivityScoreExact(raw: RawInputs, sc: Scales, pool: SelectivityPool = "all"): number | null {
  if (inconsistent(raw)) return null;
  const z = filledReadings(raw, sc, pool);
  if (!z) return null;
  const total = INPUTS.reduce((s, k) => s + WEIGHTS[k], 0);
  let c = INPUTS.reduce((s, k) => s + WEIGHTS[k] * z[k], 0) / total;
  const n = raw.admitted ?? 0;
  c *= n / (n + EVIDENCE_ADMITS);
  return Math.min(100, Math.max(0, SCORE_CENTER + SCORE_SPREAD * c));
}

/** The score (0–100, two decimals). */
export function selectivityScore(raw: RawInputs, sc: Scales, pool: SelectivityPool = "all"): number | null {
  const exact = selectivityScoreExact(raw, sc, pool);
  return exact === null ? null : Math.round(exact * 100) / 100;
}

/* ---- Tiers ---- */

const RANK = (t: SelectivityTier) => SELECTIVITY_TIERS.indexOf(t);

/**
 * The tier with every cutoff moved by `shift` points (0 = the plain rule). With `strict`, a tier needs the score above
 * its moved cutoff, not at it: falling exactly the band below a cutoff counts as crossing it, as rising exactly the
 * band above one does.
 */
function tierAt(score: number, shift: number, strict = false): SelectivityTier {
  const clears = (cutoff: number) => (strict ? score > cutoff + shift : score >= cutoff + shift);
  if (clears(ELITE_INDEX)) return "elite";
  if (clears(TIER_CUTOFFS.highly_selective)) return "highly_selective";
  if (clears(TIER_CUTOFFS.very_selective)) return "very_selective";
  if (clears(TIER_CUTOFFS.selective)) return "selective";
  if (clears(TIER_CUTOFFS.accessible)) return "accessible";
  return "open";
}

/**
 * The tier for a score. With the tier from the last published dataset (`previous`), it moves only when the score
 * crosses a cutoff by `HYSTERESIS` points or more: up when the score clears the next cutoff up by the band, down when
 * it falls the band below its own.
 */
export function selectivityTier(score: number | null, previous: SelectivityTier | null = null): SelectivityTier | null {
  if (score === null) return null;
  const plain = tierAt(score, 0);
  if (!previous || plain === previous) return plain;
  const up = tierAt(score, HYSTERESIS);
  if (RANK(up) < RANK(previous)) return up;
  const down = tierAt(score, -HYSTERESIS, true);
  if (RANK(down) > RANK(previous)) return down;
  return previous;
}

/* ---- One college ---- */

export interface CollegeIndex {
  all: number | null;
  in_state?: number | null;
  out_of_state?: number | null;
}

/** The score for each pool the college has: all applicants, and in-state and out-of-state at a public with both rates. */
export function collegeIndex(raw: RawInputs, sc: Scales): CollegeIndex {
  const out: CollegeIndex = { all: selectivityScore(raw, sc, "all") };
  if (out.all !== null && raw.inStateRate !== null && raw.outOfStateRate !== null) {
    out.in_state = selectivityScore(raw, sc, "in_state");
    out.out_of_state = selectivityScore(raw, sc, "out_of_state");
  }
  return out;
}
