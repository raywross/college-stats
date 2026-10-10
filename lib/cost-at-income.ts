/**
 * How a college's cost at a family income is worded (specs/product/cost-by-income.md "Wording", "How cost is shown"):
 * the price at one income for Compare's slider and Explore's cards and rows, the break point and merit sentences for
 * Compare's rows. Pure: safe in server and client code and in tests. The numbers come from lib/cost-curve.ts and
 * lib/merit.ts; this module only chooses words, so a figure that's modeled always carries the word "estimate".
 *
 * Wording rules: prices rounded to $1K, break points to $10K (the curve already rounds them), a range where the
 * model has one, "Published data end at $110K" where no price can be given, never "you will".
 */
import { FEDERAL_BANDS, FEDERAL_TOP, INCOME_MAX, type CostCurve, type PriceKind, priceAt } from "./cost-curve.ts";
import { offersMerit, type MeritInfo } from "./merit.ts";
import { pctSmart } from "./format.ts";

/** $1K rounding: 41,200 → "$41K". */
export const dollarsK = (v: number): string => `$${Math.round(v / 1000).toLocaleString("en-US")}K`;

/** A family income as written beside a price ("$200K"); the chart's right edge reads "$400K or more". */
export const incomeLabel = (income: number): string => (income >= INCOME_MAX ? `${dollarsK(INCOME_MAX)} or more` : dollarsK(income));

/** Said where an income above $110K has no price because estimates aren't shown or the model has none. */
export const DATA_END_MESSAGE = `Published data end at ${dollarsK(FEDERAL_TOP)}`;
/** Said where a college's aid thins out unevenly above $110K, so there is no clean price or break point. */
export const LITTLE_AID_MESSAGE = `Little need-based aid above ${dollarsK(FEDERAL_TOP)}`;

/* ------------------------------------------------------------------ */
/* Price at an income                                                  */
/* ------------------------------------------------------------------ */

export interface PriceText {
  /** "published" (a federal band), "estimate" (a range), "full_price" (past the break point), "unknown", or "none" (no curve). */
  kind: PriceKind | "none";
  /** The figure is modeled, so the word "estimate" must travel with it. */
  estimate: boolean;
  /** "$41K", "$38K–$47K", or the full price; null when no figure can be given. */
  value: string | null;
  /** Why there's no figure ("Published data end at $110K"), or null when there is one. */
  message: string | null;
  /** Dollars for drawing bars: the range (equal for a published price), null when unknown. */
  lo: number | null;
  hi: number | null;
}

/**
 * The price at one family income. `showEstimates` is the pilot's gate (`estimatesShown()`, passed from the server):
 * closed, nothing above $110K has a figure.
 */
export function priceText(curve: CostCurve | null, income: number, showEstimates: boolean): PriceText {
  if (!curve) return { kind: "none", estimate: false, value: null, message: "No full price reported", lo: null, hi: null };
  const p = priceAt(curve, income, showEstimates);
  if (p.kind === "unknown") {
    const message = income <= FEDERAL_TOP ? "Not reported" : curve.status === "little_above_110k" ? LITTLE_AID_MESSAGE : DATA_END_MESSAGE;
    return { kind: "unknown", estimate: false, value: null, message, lo: null, hi: null };
  }
  if (p.kind === "published") return { kind: "published", estimate: false, value: dollarsK(p.lo), message: null, lo: p.lo, hi: p.hi };
  if (p.kind === "full_price") return { kind: "full_price", estimate: true, value: dollarsK(curve.coa), message: null, lo: curve.coa, hi: curve.coa };
  const lo = dollarsK(p.lo);
  const hi = dollarsK(p.hi);
  return { kind: "estimate", estimate: true, value: lo === hi ? lo : `${lo}–${hi}`, message: null, lo: p.lo, hi: p.hi };
}

/**
 * Explore's card and row line: "About $41K at $200K", "Full price, $92K, at $300K", or why there is none. The caller adds
 * the word "estimate" after it when `estimate` is true (a separate, quieter span).
 */
export interface PriceLine {
  text: string;
  /** Modeled: "estimate" must follow the text. */
  estimate: boolean;
  kind: PriceText["kind"];
}

export function priceLine(curve: CostCurve | null, income: number, showEstimates: boolean): PriceLine {
  const t = priceText(curve, income, showEstimates);
  const at = incomeLabel(income);
  if (t.value === null) return { text: t.message ?? "", estimate: false, kind: t.kind };
  const text = t.kind === "full_price" ? `Full price, ${t.value}, at ${at}` : `About ${t.value} at ${at}`;
  return { text, estimate: t.estimate, kind: t.kind };
}

/* ------------------------------------------------------------------ */
/* Merit                                                               */
/* ------------------------------------------------------------------ */

/** The merit sentence for Compare's row: null when the class is unknown. */
export function meritText(m: MeritInfo): string | null {
  const avg = m.avg !== null && m.avg > 0 ? `averaging ${dollarsK(m.avg)}` : null;
  switch (m.cls) {
    case "need_only":
      return "No merit aid";
    case "merit_reported": {
      const share = m.share !== null && m.share > 0 ? `${pctSmart(m.share)} got merit aid` : "Offers merit aid";
      return avg ? `${share}, ${avg}` : share;
    }
    case "merit_proxy": {
      const share = m.share !== null ? `${pctSmart(m.share)} got a grant without federal aid` : "Grants without federal aid";
      return `${avg ? `${share}, ${avg}` : share} (proxy)`;
    }
    default:
      return null;
  }
}

/**
 * The note under a college's bar at one income: merit possible above $110K where the college offers it (merit has no
 * income limit), "No merit aid" past the break point where it doesn't. Null when neither applies.
 */
export function meritNote(m: MeritInfo, kind: PriceText["kind"], income: number): string | null {
  if (offersMerit(m) && income > FEDERAL_TOP) {
    const avg = m.avg !== null && m.avg > 0 ? `; averaging ${dollarsK(m.avg)}` : "";
    return `Merit possible${m.cls === "merit_proxy" ? " (proxy)" : ""}${avg}`;
  }
  if (m.cls === "need_only" && kind === "full_price") return "No merit aid: everyone pays the full price";
  return null;
}

/* ------------------------------------------------------------------ */
/* The break point                                                     */
/* ------------------------------------------------------------------ */

/**
 * Compare's "Need-based aid up to" cell: a range with "estimate" when the model has a break point and estimates are
 * shown, otherwise why not. Null without a curve.
 */
export function breakPointText(curve: CostCurve | null, showEstimates: boolean): string | null {
  if (!curve) return null;
  if (curve.status === "little_above_110k") return LITTLE_AID_MESSAGE;
  if (curve.status !== "break_point" || !curve.breakIncome || !showEstimates) return DATA_END_MESSAGE;
  const { mid, lo, hi } = curve.breakIncome;
  if (lo >= INCOME_MAX) return `Above ${dollarsK(INCOME_MAX)} (estimate)`;
  const top = hi > INCOME_MAX ? `above ${dollarsK(INCOME_MAX)}` : dollarsK(hi);
  if (mid > INCOME_MAX) return `${dollarsK(lo)} to ${top} (estimate)`;
  return lo === hi ? `About ${dollarsK(mid)} (estimate)` : `About ${dollarsK(mid)} (estimate, ${dollarsK(lo)}–${top})`;
}

/** The Published-promise cell's income lines, joined: "No tuition under $200K (in-state); …". Null when the college has none. */
export function promiseText(curve: CostCurve | null): string | null {
  return curve && curve.promises.length ? curve.promises.map((p) => p.label).join("; ") : null;
}

/* ------------------------------------------------------------------ */
/* The table view                                                      */
/* ------------------------------------------------------------------ */

/**
 * The incomes the Compare table lists: the four federal bands (priced at each band's low end), then the pilot's
 * incomes above $110K (specs/product/cost-by-income-pilot.md).
 */
export const TABLE_INCOMES: readonly { label: string; income: number }[] = [
  ...FEDERAL_BANDS.map((b) => ({ label: b.label, income: b.lo })),
  ...[125_000, 150_000, 200_000, 250_000, 300_000, 350_000, INCOME_MAX].map((income) => ({ label: incomeLabel(income), income })),
];
