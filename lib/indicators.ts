/**
 * Trend indicators (specs/trend-indicators.md): four plain-language answers about how a college changed over the
 * last 10 years, read from school.trends. Is cost rising? Are applications growing? Is it getting more diverse? More
 * selective? Each is up, steady, or down, where "up" always means more of the named quality (more selective = a lower
 * acceptance rate). Pure, so server pages, client components, and tests share one definition.
 */
import type { School, TrendKey, TrendSummary } from "./types";
import type { Domain } from "./metrics";
import type { TermKey } from "./glossary";
import type { YearKind } from "./history";

export type IndicatorKey = "cost" | "applications" | "diversity" | "selectivity";
export type Direction = "up" | "steady" | "down";

export const DIRECTIONS: readonly Direction[] = ["up", "steady", "down"];

export interface IndicatorDef {
  key: IndicatorKey;
  label: string;
  /** The question it answers, for headers and tooltips. */
  question: string;
  /** The school.trends entry it reads. */
  trend: TrendKey;
  /** How the change reads: percent, percentage points, or diversity index points. */
  measure: "ratio" | "points" | "index";
  /** Changes within ±steady count as steady. */
  steady: number;
  /** True when a rising value means less of the quality (acceptance rate vs. selectivity). */
  invert?: boolean;
  /** Both ends need this many applicants: a rate or count on a handful of applicants swings on a few decisions. */
  minApplicants?: number;
  words: Record<Direction, string>;
  /** Explore URL parameter holding the chosen directions. */
  param: string;
  term: TermKey;
  domain: Domain;
  kind: YearKind;
}

/**
 * Steady bands (specs/trend-indicators.md#thresholds): cost ±5% after inflation and selectivity ±3 points match
 * NOTABLE_FLOORS in lib/history.ts; applications ±10% and diversity ±0.03 sit near the national 25th percentile of
 * change, so "growing" and "more diverse" still mean more than the usual drift.
 */
export const INDICATORS: Record<IndicatorKey, IndicatorDef> = {
  cost: {
    key: "cost",
    label: "Cost",
    question: "Is it getting more expensive?",
    trend: "avg_paid_all",
    measure: "ratio",
    steady: 0.05,
    words: { up: "Rising", steady: "Steady", down: "Falling" },
    param: "costTrend",
    term: "average-cost",
    domain: "value",
    kind: "academic",
  },
  applications: {
    key: "applications",
    label: "Applications",
    question: "Are more students applying?",
    trend: "applicants",
    measure: "ratio",
    steady: 0.1,
    minApplicants: 200,
    words: { up: "Growing", steady: "Steady", down: "Shrinking" },
    param: "appsTrend",
    term: "applicants",
    domain: "admissions",
    kind: "fall",
  },
  diversity: {
    key: "diversity",
    label: "Diversity",
    question: "Is the student body getting more diverse?",
    trend: "diversity",
    measure: "index",
    steady: 0.03,
    words: { up: "More diverse", steady: "Steady", down: "Less diverse" },
    param: "divTrend",
    term: "diversity-index",
    domain: "diversity",
    kind: "fall",
  },
  selectivity: {
    key: "selectivity",
    label: "Selectivity",
    question: "Is it getting harder to get in?",
    trend: "acceptance_rate",
    measure: "points",
    steady: 0.03,
    invert: true,
    minApplicants: 200,
    words: { up: "More selective", steady: "Steady", down: "Less selective" },
    param: "selTrend",
    term: "selectivity",
    domain: "admissions",
    kind: "fall",
  },
};

export const INDICATOR_KEYS = Object.keys(INDICATORS) as IndicatorKey[];

export interface Indicator {
  def: IndicatorDef;
  direction: Direction;
  /** school.trends entry: start year, start and end values, change. */
  trend: TrendSummary;
  /**
   * The fall the trend ends on, set only when the profile shows a newer figure than it (a college's CDS replaced the
   * federal one: `demographics.federal`, `admissions.federal`), so the two numbers aren't read as one.
   */
  endFall?: number;
}

/** One indicator for a college, or null when its history can't support it. */
export function indicatorOf(s: School, key: IndicatorKey): Indicator | null {
  const def = INDICATORS[key];
  const t = s.trends?.[def.trend];
  if (!t) return null;
  if (def.minApplicants) {
    const a = s.trends?.applicants;
    if (!a || Math.min(a.from, a.to) < def.minApplicants) return null;
  }
  const c = def.invert ? -t.change : t.change;
  // Compare in the stored precision so a change of exactly the band (e.g. 0.05) is steady, not up.
  const direction: Direction = c > def.steady + 1e-9 ? "up" : c < -def.steady - 1e-9 ? "down" : "steady";
  // History stays federal (specs/data-expansion/cds-student-body-and-outcomes.md): name its end fall when the shown value is newer.
  const endFall = key === "diversity" ? s.demographics?.federal?.year : key === "selectivity" ? (s.admissions?.federal?.year ?? undefined) : undefined;
  return { def, direction, trend: t, ...(endFall != null ? { endFall } : {}) };
}

export function indicatorsOf(s: School): Indicator[] {
  return INDICATOR_KEYS.map((k) => indicatorOf(s, k)).filter((i): i is Indicator => i !== null);
}

const MINUS = "−";
const signed = (v: number, text: string) => `${v > 0 ? "+" : v < 0 ? MINUS : ""}${text}`;

/** The change itself: "+12%", "−4 pts", "+0.06". */
export function changeText(i: Indicator): string {
  const v = i.trend.change;
  if (i.def.measure === "ratio") return signed(Math.round(v * 100), `${Math.abs(Math.round(v * 100)).toLocaleString("en-US")}%`);
  if (i.def.measure === "points") return signed(Math.round(v * 100), `${Math.abs(Math.round(v * 100))} pts`);
  return signed(Math.round(v * 100), Math.abs(v).toFixed(2));
}

/** A short detail line under the direction word: "−12% after inflation", "+54%", "admit rate 45% → 38%", "index 0.52 → 0.60". */
export function detailText(i: Indicator): string {
  const { from, to } = i.trend;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const end = i.endFall !== undefined ? ` (to fall ${i.endFall})` : "";
  switch (i.def.key) {
    case "cost":
      return `${changeText(i)} after inflation`;
    case "applications":
      return changeText(i);
    case "diversity":
      return `index ${from.toFixed(2)} → ${to.toFixed(2)}${end}`;
    case "selectivity":
      return `admit rate ${pct(from)} → ${pct(to)}${end}`;
  }
}

/** Explore filter: keep colleges whose indicator is in one of the chosen directions (and drop ones without it). */
export function matchesIndicators(s: School, chosen: Partial<Record<IndicatorKey, Direction[]>>): boolean {
  for (const k of INDICATOR_KEYS) {
    const dirs = chosen[k];
    if (!dirs?.length) continue;
    const i = indicatorOf(s, k);
    if (!i || !dirs.includes(i.direction)) return false;
  }
  return true;
}

export function isDirection(v: string): v is Direction {
  return (DIRECTIONS as readonly string[]).includes(v);
}
