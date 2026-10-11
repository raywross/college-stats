/**
 * Explore's cost-by-income controls (specs/product/cost-by-income.md "Explore"): the "Need-based aid reaches families
 * earning $X+" filter, "Offers merit aid", and the family income that prices the cards and the "Price at income" sort.
 * Constants for the controls, the active-filter chips, and the sort option, as pure functions so the client toolbar and
 * the tests share them. Pure: relative `.ts` imports only.
 */
import { FEDERAL_TOP, INCOME_MAX } from "./cost-curve.ts";
import { dollarsK, incomeLabel } from "./cost-at-income.ts";

/** The "aid reaches families earning $X+" slider: from where the federal data end to the chart's edge. At the low end it's off. */
export const MIN_AID_INCOME = { min: FEDERAL_TOP, max: INCOME_MAX, step: 10_000 } as const;
/** The family income that prices cards and the sort: the same range and default as Compare's slider. */
export const INCOME_INPUT = { min: 0, max: INCOME_MAX, step: 5_000, default: 150_000 } as const;
/** The sort that prices colleges at `income`. */
export const PRICE_AT_SORT = "price_at";

export interface CostChip {
  key: string;
  label: string;
  /** URL params removed with the chip. */
  clears: string[];
}

const positive = (v: string | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The chips for the cost-by-income params. `get` reads a URL param. The break-point chip is left out while estimates
 * are hidden (the filter does nothing then, and the control says why); the income chip also drops a price sort, which
 * has nothing to price without it.
 */
export function costFilterChips(get: (key: string) => string | null, showEstimates: boolean): CostChip[] {
  const chips: CostChip[] = [];
  const aid = positive(get("minAidIncome"));
  if (aid !== null && showEstimates) chips.push({ key: "minAidIncome", label: `Need-based aid reaches ${dollarsK(aid)}+ (estimate)`, clears: ["minAidIncome"] });
  if (get("merit") === "1") chips.push({ key: "merit", label: "Offers merit aid", clears: ["merit"] });
  const incomeRaw = get("income");
  const income = incomeRaw === null || incomeRaw === "" ? null : Number(incomeRaw);
  if (income !== null && Number.isFinite(income) && income >= 0) {
    chips.push({
      key: "income",
      label: `Prices at ${incomeLabel(income)} income`,
      clears: get("sortBy") === PRICE_AT_SORT ? ["income", "sortBy", "sortDir"] : ["income"],
    });
  }
  return chips;
}

/** The sort dropdown's option for the price sort, offered only while an income is set (like distance needs a ZIP). */
export function priceAtSortOption(income: string | null): { value: typeof PRICE_AT_SORT; label: string; dir: "asc" } | null {
  const n = income === null || income === "" ? NaN : Number(income);
  if (!Number.isFinite(n) || n < 0) return null;
  return { value: PRICE_AT_SORT, label: `Price at ${incomeLabel(n)} income (lowest)`, dir: "asc" };
}
