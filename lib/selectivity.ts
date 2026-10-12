/**
 * Quad's selectivity (specs/chances/selectivity-index.md): a hidden index (0–100) per college and pool, from the
 * figures the college publishes, read as one of five public tiers, Elite to Open. This module holds the method: the
 * inputs, the weights, the cutoffs, `ELITE_INDEX`, and the hysteresis band. The build (`npm run build-selectivity`,
 * scripts/lib/selectivity.mts) writes the tiers to `school.selectivity` and the index to data/selectivity-index.json;
 * pages read only the tiers (lib/selectivity-tier.ts). Never shown: the weights, the index, or the cutoffs (the chip's
 * panel lists the inputs as cited facts). Pure, no I/O; kept out of client bundles (tests/selectivity.test.mts).
 */
import type { School } from "./types";
import type { SelectivityPool, SelectivityTier } from "./chances/types.ts";
import { SELECTIVITY_TIERS } from "./chances/levels.ts";
import { sameClassYield } from "./derive.ts";
import { satTotal } from "./score-bands.ts";
import { actToSat } from "./planner/concordance.ts";
import { gpaTopShare } from "./chances/reading.ts";
import { admitRatesByResidency } from "./cds/residency-display.ts";
import { indicatorOf, type Direction } from "./indicators.ts";

export { tierForStudent } from "./selectivity-tier.ts";

/* ---- Constants (the method; never on a page) ---- */

/** The percentiled inputs, each turned into a percentile among the colleges that report it (higher = harder). */
export type PercentileInput = "admit_rate" | "class_strength" | "gpa_crowding" | "yield" | "ed_share" | "waitlist";
/** Every input the index reads: the percentiled ones and the C7 count, which is scaled, not percentiled. */
export type IndexInput = PercentileInput | "factors_read";

/** Weights (selectivity-index.md "Inputs"), renormalized over the inputs a college reports. The trend is added after. */
export const WEIGHTS: Record<IndexInput, number> = {
  admit_rate: 45,
  class_strength: 20,
  gpa_crowding: 5,
  yield: 10,
  ed_share: 5,
  factors_read: 5,
  waitlist: 5,
};

/** Points added after the weighted mean: the ten-year selectivity direction ±5, applications ±2. */
export const TREND_POINTS = { selectivity: 5, applications: 2 } as const;

/** The C7 count's top: six factors, rigor, and a required test policy. */
export const FACTORS_READ_MAX = 8;

/**
 * Elite: index at or above this and the pool's admit rate under `ELITE_MAX_RATE`. Set once at build so Elite holds
 * 30–40 colleges, and moved only by a deliberate change here. Set 2026-10-12 on the dataset of that day: 33 colleges
 * Elite, all of them for all applicants (34 colleges admit under 10%; the Naval Academy is the one whose index falls
 * short). At 96 Elite would hold 29, and at 97 Yale drops out (a steady ten-year direction earns no trend points).
 */
export const ELITE_INDEX = 94;
export const ELITE_MAX_RATE = 0.1;

/** The other cutoffs, hardest first. Open is everything under Accessible's. */
export const TIER_CUTOFFS: Record<Exclude<SelectivityTier, "elite" | "open">, number> = {
  highly_selective: 85,
  selective: 60,
  accessible: 30,
};

/** A tier changes at a publish only when the index crosses the cutoff by this many points (or the Elite rate flips). */
export const HYSTERESIS = 2;

/** The Elite count the verify guard holds the dataset to (the target is 30–40; this is the alarm band). */
export const ELITE_COUNT_RANGE: readonly [number, number] = [25, 50];

/* ---- Inputs ---- */

/** One college's published figures, before percentiles. Null = not reported. */
export interface RawInputs {
  /** The overall admit rate (`admissions.acceptance_rate`). */
  admitRate: number | null;
  /** Residency rates (`derived.admit_rate_in_state` / `_out_of_state`) at a public that publishes both. */
  inStateRate: number | null;
  outOfStateRate: number | null;
  /** SAT total 75th percentile, or the ACT 75th through the 2018 concordance. */
  sat75: number | null;
  gpaTopShare: number | null;
  yield: number | null;
  /** C21 ED admitted ÷ first-years enrolled. */
  edShare: number | null;
  /** C2 waitlist offered ÷ admitted. */
  waitlistShare: number | null;
  /** C7 very-important count among the six, +1 rigor, +1 required tests (0–8); null without a C7 grid. */
  factorsRead: number | null;
  /** The ten-year indicators (lib/indicators.ts), when the history supports them. */
  selectivityTrend: Direction | null;
  applicationsTrend: Direction | null;
}

/** The six C7 factors counted when the college rates them very important. */
export const FACTORS_COUNTED = ["essay", "recommendations", "interview", "extracurriculars", "talent", "character"] as const;

/** n ÷ d, or null without both (or with nothing to divide by). */
const ratio = (n: number | null | undefined, d: number | null | undefined): number | null => (n != null && d ? n / d : null);

/** The figures one college publishes, read from the dataset with the site's own helpers. */
export function rawInputs(school: School): RawInputs {
  const a = school.admissions;
  const profile = school.reported?.admission_profile;
  const sat = satTotal(school);
  const act = a.act_composite_25_75;
  const res = school.type === "public" ? admitRatesByResidency(school) : null;
  const pools = res && res.in_state !== null && res.out_of_state !== null;
  const factors = profile?.factors;
  let factorsRead: number | null = null;
  if (factors && Object.keys(factors).length) {
    factorsRead = FACTORS_COUNTED.filter((f) => factors[f] === "very_important").length;
    if (factors.rigor === "very_important") factorsRead++;
    if (a.test_policy === "required") factorsRead++;
  }
  return {
    admitRate: a.acceptance_rate,
    inStateRate: pools ? res.in_state : null,
    outOfStateRate: pools ? res.out_of_state : null,
    sat75: sat ? sat[1] : act ? actToSat(act[1]) : null,
    gpaTopShare: gpaTopShare(school),
    yield: sameClassYield(school),
    // A share of the class, so never above 1 (the ED count and the enrolled count can describe different classes).
    edShare: ((v) => (v === null ? null : Math.min(1, v)))(ratio(profile?.early_decision?.admitted, a.enrolled)),
    // Offered a place ÷ admitted: heavy waitlisting can offer more places than admits, so no cap.
    waitlistShare: ratio(profile?.wait_list?.offered, a.admitted),
    factorsRead,
    selectivityTrend: indicatorOf(school, "selectivity")?.direction ?? null,
    applicationsTrend: indicatorOf(school, "applications")?.direction ?? null,
  };
}

/* ---- Percentiles ---- */

/** Each percentiled input's values over every college that reports it, sorted ascending, and its direction. */
export type Distributions = Record<PercentileInput, { values: number[]; lowerIsHarder: boolean }>;

const PERCENTILE_SOURCES: Record<PercentileInput, { get: (r: RawInputs) => number | null; lowerIsHarder: boolean }> = {
  admit_rate: { get: (r) => r.admitRate, lowerIsHarder: true },
  class_strength: { get: (r) => r.sat75, lowerIsHarder: false },
  gpa_crowding: { get: (r) => r.gpaTopShare, lowerIsHarder: false },
  yield: { get: (r) => r.yield, lowerIsHarder: false },
  ed_share: { get: (r) => r.edShare, lowerIsHarder: false },
  waitlist: { get: (r) => r.waitlistShare, lowerIsHarder: false },
};

/** The distributions over these colleges (every college with the input, at this publish). */
export function distributions(all: readonly RawInputs[]): Distributions {
  const out = {} as Distributions;
  for (const [k, src] of Object.entries(PERCENTILE_SOURCES) as [PercentileInput, (typeof PERCENTILE_SOURCES)[PercentileInput]][]) {
    out[k] = { values: all.map(src.get).filter((v): v is number => v !== null).sort((x, y) => x - y), lowerIsHarder: src.lowerIsHarder };
  }
  return out;
}

/** Index of the first element ≥ v (or > v with `strict`) in an ascending array. */
function bound(sorted: readonly number[], v: number, strict: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strict ? sorted[mid] <= v : sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where `v` sits among `sorted` (0–100, higher = harder): the share of colleges it beats plus half the ties (the
 * mid-rank percentile). A value outside the reporters (a pool rate) is placed in the same distribution.
 */
export function percentileOf(sorted: readonly number[], v: number, lowerIsHarder: boolean): number {
  if (!sorted.length) return 50;
  const below = bound(sorted, v, false);
  const ties = bound(sorted, v, true) - below;
  const above = sorted.length - below - ties;
  const beaten = lowerIsHarder ? above : below;
  return (100 * (beaten + ties / 2)) / sorted.length;
}

/** What `selectivityIndex` combines: each input's 0–100 reading (null = not reported) and the trend points. */
export interface IndexInputs {
  readings: Partial<Record<IndexInput, number | null>>;
  /** Added after the mean: TREND_POINTS by direction. */
  trend: number;
}

/** The trend points for these directions: more selective +5, less −5; applications growing +2, shrinking −2. */
export function trendPoints(selectivity: Direction | null, applications: Direction | null): number {
  const dir = (d: Direction | null) => (d === "up" ? 1 : d === "down" ? -1 : 0);
  return dir(selectivity) * TREND_POINTS.selectivity + dir(applications) * TREND_POINTS.applications;
}

/** One college's readings for a pool: its pool's admit rate placed among every college's overall rate. */
export function indexInputs(raw: RawInputs, dist: Distributions, pool: SelectivityPool = "all"): IndexInputs {
  const rate = poolRate(raw, pool);
  const p = (k: PercentileInput, v: number | null) => (v === null ? null : percentileOf(dist[k].values, v, dist[k].lowerIsHarder));
  return {
    readings: {
      admit_rate: p("admit_rate", rate),
      class_strength: p("class_strength", raw.sat75),
      gpa_crowding: p("gpa_crowding", raw.gpaTopShare),
      yield: p("yield", raw.yield),
      ed_share: p("ed_share", raw.edShare),
      waitlist: p("waitlist", raw.waitlistShare),
      factors_read: raw.factorsRead === null ? null : (100 * raw.factorsRead) / FACTORS_READ_MAX,
    },
    trend: trendPoints(raw.selectivityTrend, raw.applicationsTrend),
  };
}

/** The admit rate a pool reads: the residency rate for in-state and out-of-state, else the overall rate. */
export function poolRate(raw: RawInputs, pool: SelectivityPool): number | null {
  return pool === "in_state" ? raw.inStateRate : pool === "out_of_state" ? raw.outOfStateRate : raw.admitRate;
}

/**
 * The index (0–100, one decimal): the weighted mean of the readings the college has, weights renormalized over them,
 * plus the trend points, clamped. Null without an admit-rate reading (the rate is required).
 */
export function selectivityIndex(inputs: IndexInputs): number | null {
  if (inputs.readings.admit_rate == null) return null;
  let sum = 0;
  let weight = 0;
  for (const [k, w] of Object.entries(WEIGHTS) as [IndexInput, number][]) {
    const v = inputs.readings[k];
    if (v == null) continue;
    sum += w * v;
    weight += w;
  }
  const raw = sum / weight + inputs.trend;
  return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
}

/* ---- Tiers ---- */

const RANK = (t: SelectivityTier) => SELECTIVITY_TIERS.indexOf(t);

/**
 * The tier with every cutoff moved by `shift` points (0 = the plain rule). With `strict`, a tier needs the index above
 * its moved cutoff, not at it: falling exactly the band below a cutoff counts as crossing it, as rising exactly the
 * band above one does.
 */
function tierAt(index: number, rate: number | null, shift: number, strict = false): SelectivityTier {
  const clears = (cutoff: number) => (strict ? index > cutoff + shift : index >= cutoff + shift);
  if (clears(ELITE_INDEX) && rate !== null && rate < ELITE_MAX_RATE) return "elite";
  if (clears(TIER_CUTOFFS.highly_selective)) return "highly_selective";
  if (clears(TIER_CUTOFFS.selective)) return "selective";
  if (clears(TIER_CUTOFFS.accessible)) return "accessible";
  return "open";
}

/**
 * The tier for an index and its pool's admit rate. With the tier from the last published dataset (`previous`), it
 * moves only when the index crosses a cutoff by `HYSTERESIS` points or more: up when the index clears the next cutoff
 * up by the band, down when it falls the band below its own. Elite's rate condition applies at once either way: a
 * pool whose rate reaches 10% leaves Elite at the next publish.
 */
export function selectivityTier(index: number | null, poolRateValue: number | null, previous: SelectivityTier | null = null): SelectivityTier | null {
  if (index === null) return null;
  const plain = tierAt(index, poolRateValue, 0);
  if (!previous || plain === previous) return plain;
  const up = tierAt(index, poolRateValue, HYSTERESIS);
  if (RANK(up) < RANK(previous)) return up;
  const down = tierAt(index, poolRateValue, -HYSTERESIS, true);
  if (RANK(down) > RANK(previous)) return down;
  // Inside the band: keep the previous tier, unless it was Elite and the rate no longer allows it.
  if (previous === "elite" && !(poolRateValue !== null && poolRateValue < ELITE_MAX_RATE)) return down;
  return previous;
}

/* ---- One college ---- */

export interface CollegeIndex {
  all: number | null;
  in_state?: number | null;
  out_of_state?: number | null;
}

/** The index for each pool the college has: all applicants, and in-state and out-of-state at a public with both rates. */
export function collegeIndex(raw: RawInputs, dist: Distributions): CollegeIndex {
  const out: CollegeIndex = { all: selectivityIndex(indexInputs(raw, dist, "all")) };
  if (raw.inStateRate !== null && raw.outOfStateRate !== null) {
    out.in_state = selectivityIndex(indexInputs(raw, dist, "in_state"));
    out.out_of_state = selectivityIndex(indexInputs(raw, dist, "out_of_state"));
  }
  return out;
}
