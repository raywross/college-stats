import type { AxisSpec, ScatterZone } from "@/components/charts/ScatterPlot";

/**
 * Shared scatter chart configs. Plain data (no functions) so server pages
 * can hand them to the client chart component.
 */

export const LANDSCAPE_X: AxisSpec = {
  label: "Acceptance rate",
  short: "Admit",
  hint: "less selective",
  term: "acceptance-rate",
  format: "pct",
  step: 0.1,
  min: 0,
  max: 1,
};

export const LANDSCAPE_Y: AxisSpec = {
  label: "SAT midpoint",
  short: "SAT mid",
  hint: "higher = higher scores",
  term: "sat",
  format: "int",
  step: 100,
  max: 1600,
};

export const LANDSCAPE_ZONE: ScatterZone = { x: [0, 0.1], y: [0, 1600], label: "Most selective zone" };

export const VALUE_X: AxisSpec = {
  label: "Average cost per year, all students (est.)",
  short: "Avg cost",
  hint: "more expensive",
  term: "average-cost",
  format: "moneyCompact",
  step: 10000,
  min: 0,
};

export const VALUE_Y: AxisSpec = {
  label: "Median earnings 10 years after entry",
  short: "Earnings",
  hint: "higher = more",
  term: "median-earnings",
  format: "moneyCompact",
  step: 20000,
  min: 0,
};

/** Top-left quadrant: cheaper than the median, earning more than the median. */
export function valueZone(medianCost: number | null, medianEarnings: number | null): ScatterZone | undefined {
  if (medianCost === null || medianEarnings === null) return undefined;
  return { x: [0, medianCost], y: [medianEarnings, 1e7], label: "Lower cost, higher earnings" };
}

export const STICKER_X: AxisSpec = {
  label: "Full price per year (sticker)",
  short: "Full price",
  hint: "higher sticker price",
  term: "cost-of-attendance",
  format: "moneyCompact",
  step: 10000,
  min: 0,
};

export const STICKER_Y: AxisSpec = {
  label: "Average total cost, all students (est.)",
  short: "Avg cost",
  hint: "what students actually pay",
  term: "average-cost",
  format: "moneyCompact",
  step: 10000,
  min: 0,
};
