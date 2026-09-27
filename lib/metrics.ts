import type { School, SizeBucket } from "./types";
import type { TermKey } from "./glossary";
import { money, num, pct, pctSmart } from "./format";

/* ------------------------------------------------------------------ */
/* Derived values (null when the underlying data isn't reported)       */
/* ------------------------------------------------------------------ */

export function satComposite(s: School): [number, number] | null {
  const r = s.admissions.sat_reading_25_75;
  const m = s.admissions.sat_math_25_75;
  if (!r || !m) return null;
  return [r[0] + m[0], r[1] + m[1]];
}

export function satMid(s: School): number | null {
  const c = satComposite(s);
  return c ? Math.round((c[0] + c[1]) / 2) : null;
}

export function actMid(s: School): number | null {
  const a = s.admissions.act_composite_25_75;
  return a ? (a[0] + a[1]) / 2 : null;
}

/** Share of admitted students who enroll. */
export function yieldRate(s: School): number | null {
  const { admitted, enrolled } = s.admissions;
  return admitted && enrolled !== null ? enrolled / admitted : null;
}

/** "1 in N" applicants admitted. */
export function oneIn(s: School): number | null {
  const r = s.admissions.acceptance_rate;
  return r && r > 0 ? Math.max(1, Math.round(1 / r)) : null;
}

/** Human phrasing of an admit rate: "1 in 29" when selective, "8 in 10" when not. */
export function admitRatio(s: School): string | null {
  const r = s.admissions.acceptance_rate;
  if (r === null || r <= 0) return null;
  return r < 0.5 ? `1 in ${oneIn(s)}` : `${Math.round(r * 10)} in 10`;
}

/**
 * Simpson's diversity index: the chance two randomly chosen students
 * come from different racial/ethnic groups (0 = none, 1 = maximal).
 */
export function diversityIndex(s: School): number | null {
  const race = s.demographics.racial_diversity;
  if (!race) return null;
  const values = Object.values(race);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return 1 - values.reduce((acc, v) => acc + (v / total) ** 2, 0);
}

/** Admissions counts are complete enough for the waffle, funnel and yield. */
export function hasAdmissionCounts(s: School): boolean {
  const { applicants, admitted, enrolled } = s.admissions;
  return !!applicants && applicants >= 10 && admitted !== null && enrolled !== null;
}

export function hasTestScores(s: School): boolean {
  return satComposite(s) !== null || s.admissions.act_composite_25_75 !== null;
}

/* ------------------------------------------------------------------ */
/* Tiers                                                               */
/* ------------------------------------------------------------------ */

export function selectivityTier(rate: number | null): { label: string; level: number } {
  if (rate === null) return { label: "Open or not reported", level: 0 };
  if (rate < 0.1) return { label: "Most selective", level: 4 };
  if (rate < 0.25) return { label: "Highly selective", level: 3 };
  if (rate < 0.5) return { label: "Selective", level: 2 };
  return { label: "Broadly accessible", level: 1 };
}

export const SIZE_BUCKETS: { key: SizeBucket; label: string; hint: string; min: number; max: number }[] = [
  { key: "small", label: "Small", hint: "< 5K", min: 0, max: 4999 },
  { key: "medium", label: "Medium", hint: "5–15K", min: 5000, max: 14999 },
  { key: "large", label: "Large", hint: "15–30K", min: 15000, max: 29999 },
  { key: "xl", label: "Very large", hint: "30K+", min: 30000, max: Infinity },
];

export function sizeBucket(enrollment: number) {
  return SIZE_BUCKETS.find((b) => enrollment >= b.min && enrollment <= b.max) ?? SIZE_BUCKETS[3];
}

export const TEST_POLICY_LABELS: Record<string, string> = {
  required: "Test scores required",
  recommended: "Test scores recommended",
  considered: "Test-optional",
  "not-considered": "Test-blind",
};

/* ------------------------------------------------------------------ */
/* Metric registry: one place that knows how to read, format & explain */
/* ------------------------------------------------------------------ */

export type Domain = "admissions" | "size" | "scores" | "access" | "diversity" | "value";

export const DOMAINS: Record<Domain, { label: string; color: string }> = {
  admissions: { label: "Admissions", color: "var(--d-admissions)" },
  size: { label: "Size", color: "var(--d-size)" },
  scores: { label: "Test scores", color: "var(--d-scores)" },
  access: { label: "Access", color: "var(--d-access)" },
  diversity: { label: "Diversity", color: "var(--d-diversity)" },
  value: { label: "Cost & outcomes", color: "var(--d-value)" },
};

export type MetricKey =
  | "acceptance"
  | "applicants"
  | "yield"
  | "sat"
  | "act"
  | "enrollment"
  | "pell"
  | "firstGen"
  | "diversity"
  | "netPrice"
  | "earnings"
  | "gradRate"
  | "debt";

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  term: TermKey;
  domain: Domain;
  get: (s: School) => number | null;
  format: (v: number) => string;
  /** Fixed scale for bars, when meaningful. */
  scale?: [number, number];
  /** Wording used in "higher than X%" sentences. */
  more: string;
  less: string;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  acceptance: {
    key: "acceptance",
    label: "Acceptance rate",
    short: "Admit rate",
    term: "acceptance-rate",
    domain: "admissions",
    get: (s) => s.admissions.acceptance_rate,
    format: pctSmart,
    scale: [0, 1],
    more: "less selective",
    less: "more selective",
  },
  applicants: {
    key: "applicants",
    label: "Applicants",
    short: "Applicants",
    term: "applicants",
    domain: "admissions",
    get: (s) => s.admissions.applicants,
    format: num,
    more: "more applicants",
    less: "fewer applicants",
  },
  yield: {
    key: "yield",
    label: "Yield rate",
    short: "Yield",
    term: "yield",
    domain: "admissions",
    get: yieldRate,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "higher yield",
    less: "lower yield",
  },
  sat: {
    key: "sat",
    label: "SAT midpoint",
    short: "SAT mid",
    term: "sat",
    domain: "scores",
    get: satMid,
    format: (v) => String(Math.round(v)),
    scale: [400, 1600],
    more: "higher scores",
    less: "lower scores",
  },
  act: {
    key: "act",
    label: "ACT midpoint",
    short: "ACT mid",
    term: "act",
    domain: "scores",
    get: actMid,
    format: (v) => String(Math.round(v)),
    scale: [1, 36],
    more: "higher scores",
    less: "lower scores",
  },
  enrollment: {
    key: "enrollment",
    label: "Undergrads",
    short: "Undergrads",
    term: "undergrad-enrollment",
    domain: "size",
    get: (s) => s.demographics.undergrad_enrollment,
    format: num,
    more: "larger",
    less: "smaller",
  },
  pell: {
    key: "pell",
    label: "Pell Grant recipients",
    short: "Pell %",
    term: "pell-grant",
    domain: "access",
    get: (s) => s.demographics.pell_grant_percent,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more Pell recipients",
    less: "fewer Pell recipients",
  },
  firstGen: {
    key: "firstGen",
    label: "First-generation students",
    short: "First-gen %",
    term: "first-gen",
    domain: "access",
    get: (s) => s.demographics.first_gen_percent,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "more first-gen students",
    less: "fewer first-gen students",
  },
  diversity: {
    key: "diversity",
    label: "Diversity index",
    short: "Diversity",
    term: "diversity-index",
    domain: "diversity",
    get: diversityIndex,
    format: (v) => v.toFixed(2),
    scale: [0, 1],
    more: "more diverse",
    less: "less diverse",
  },
  netPrice: {
    key: "netPrice",
    label: "Average net price",
    short: "Net price",
    term: "net-price",
    domain: "value",
    get: (s) => s.cost?.avg_net_price ?? null,
    format: money,
    more: "more expensive",
    less: "less expensive",
  },
  earnings: {
    key: "earnings",
    label: "Median earnings, 10 yrs",
    short: "Earnings",
    term: "median-earnings",
    domain: "value",
    get: (s) => s.outcomes?.median_earnings_10yr ?? null,
    format: money,
    more: "higher earnings",
    less: "lower earnings",
  },
  gradRate: {
    key: "gradRate",
    label: "Graduation rate",
    short: "Grad rate",
    term: "graduation-rate",
    domain: "value",
    get: (s) => s.outcomes?.graduation_rate ?? null,
    format: (v) => pct(v),
    scale: [0, 1],
    more: "higher graduation rate",
    less: "lower graduation rate",
  },
  debt: {
    key: "debt",
    label: "Median debt at graduation",
    short: "Median debt",
    term: "median-debt",
    domain: "value",
    get: (s) => s.outcomes?.median_debt ?? null,
    format: money,
    more: "more debt",
    less: "less debt",
  },
};

/** Family-income bands used by net price by income, low to high. */
export const INCOME_BANDS = ["$0–30K", "$30–48K", "$48–75K", "$75–110K", "$110K+"];

/**
 * Rough "payback": years of a typical graduate's salary that four years of
 * average net price would take. A conversation starter, not a financial model.
 */
export function paybackYears(s: School): number | null {
  const price = s.cost?.avg_net_price ?? null;
  const earn = s.outcomes?.median_earnings_10yr ?? null;
  return price !== null && earn ? (price * 4) / earn : null;
}

/** Format a possibly-missing value; missing shows as an en dash. */
export function fmt(key: MetricKey, v: number | null): string {
  return v === null ? "–" : METRICS[key].format(v);
}

/* ------------------------------------------------------------------ */
/* Demographics categories (fixed stack order = fixed color)           */
/* ------------------------------------------------------------------ */

export const DEMOGRAPHIC_CATEGORIES = [
  { key: "white", label: "White", color: "var(--demo-1)" },
  { key: "asian", label: "Asian", color: "var(--demo-2)" },
  { key: "hispanic", label: "Hispanic/Latino", color: "var(--demo-3)" },
  { key: "black", label: "Black", color: "var(--demo-4)" },
  { key: "two_or_more", label: "Two or more", color: "var(--demo-5)" },
  { key: "international", label: "International", color: "var(--demo-6)" },
  { key: "other", label: "Other/unknown", color: "var(--demo-7)" },
] as const;

/* ------------------------------------------------------------------ */
/* Statistics helpers                                                  */
/* ------------------------------------------------------------------ */

export function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** First index in a sorted array whose value is >= target. */
function lowerBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in a sorted array whose value is > target. */
function upperBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Share of the *other* values strictly below `value` (0..1), counting ties
 * as half. `sorted` must be ascending and include `value` itself.
 */
export function percentileRankSorted(value: number, sorted: number[]): number {
  const others = sorted.length - 1;
  if (others <= 0) return 0.5;
  const below = lowerBound(sorted, value);
  const equal = upperBound(sorted, value) - below;
  return Math.min(1, Math.max(0, (below + (equal - 1) / 2) / others));
}
