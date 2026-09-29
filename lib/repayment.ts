/**
 * Borrowers' status 3 years into repayment (specs/data-expansion/loans-and-repayment.md): Scorecard's eight categories
 * grouped into six a reader can follow, as ranges (some shares are published as bands). Pure, for the profile and tests.
 */
import type { RepaymentStatus, School, ShareRange } from "./types";

export type RepaymentGroupKey = "paid" | "progress" | "paused" | "stalled" | "behind" | "discharged";

export const REPAYMENT_GROUPS: readonly { key: RepaymentGroupKey; label: string; statuses: readonly RepaymentStatus[]; color: string }[] = [
  { key: "paid", label: "Paid in full", statuses: ["paid_in_full"], color: "var(--good)" },
  { key: "progress", label: "Paying it down", statuses: ["making_progress"], color: "color-mix(in oklch, var(--good) 55%, white)" },
  { key: "paused", label: "Payments paused", statuses: ["deferment", "forbearance"], color: "var(--muted-foreground)" },
  { key: "stalled", label: "Not paying it down", statuses: ["not_making_progress"], color: "var(--warning)" },
  { key: "behind", label: "Behind or in default", statuses: ["delinquent", "default"], color: "var(--critical)" },
  { key: "discharged", label: "Forgiven or discharged", statuses: ["discharged"], color: "color-mix(in oklch, var(--muted-foreground) 45%, var(--card))" },
];

export const REPAYMENT_STATUSES = REPAYMENT_GROUPS.flatMap((g) => g.statuses);

/** Midpoints must add to within this of 100%, or the bands are too wide to chart honestly. */
export const REPAYMENT_SUM_TOLERANCE = 0.1;

export interface RepaymentGroup {
  key: RepaymentGroupKey;
  label: string;
  color: string;
  /** Range of the group's share: the members' lows and highs added. */
  low: number;
  high: number;
  /** Width in the 100% bar: the midpoint, scaled so the bar adds to exactly 100%. */
  share: number;
}

/** The six groups, or null unless all eight categories are published and add up to about 100%. */
export function repaymentGroups(s: Pick<School, "outcomes">): RepaymentGroup[] | null {
  const r = s.outcomes?.repayment_3yr;
  if (!r || REPAYMENT_STATUSES.some((k) => !r[k])) return null;
  const range = (keys: readonly RepaymentStatus[]): ShareRange =>
    keys.reduce((a, k) => ({ low: a.low + r[k]!.low, high: a.high + r[k]!.high }), { low: 0, high: 0 });
  const groups = REPAYMENT_GROUPS.map((g) => ({ ...g, ...range(g.statuses) }));
  const total = groups.reduce((a, g) => a + (g.low + g.high) / 2, 0);
  if (Math.abs(total - 1) > REPAYMENT_SUM_TOLERANCE) return null;
  return groups.map(({ key, label, color, low, high }) => ({ key, label, color, low, high, share: (low + high) / 2 / total }));
}

/** Explore's "Few students borrow" filter: at most this share of undergrads have a federal loan. */
export const FEW_LOANS_MAX = 0.2;

export function hasFewLoans(s: Pick<School, "outcomes">): boolean {
  const r = s.outcomes?.federal_loan_rate;
  return r != null && r <= FEW_LOANS_MAX;
}

/** Whether the profile's borrowing card has anything to show (so its phone fold isn't an empty button). */
export function hasLoanData(s: Pick<School, "outcomes">): boolean {
  const o = s.outcomes;
  const inc = o?.median_debt_by_income;
  return (
    o?.federal_loan_rate != null ||
    o?.median_debt_pell != null ||
    o?.median_debt_no_pell != null ||
    (inc != null && (inc.low != null || inc.mid != null || inc.high != null)) ||
    repaymentGroups(s) !== null
  );
}

/** "31%" or "31–32%". */
export function rangeLabel({ low, high }: ShareRange): string {
  const p = (v: number) => Math.round(v * 100);
  return p(low) === p(high) ? `${p(low)}%` : `${p(low)}–${p(high)}%`;
}
