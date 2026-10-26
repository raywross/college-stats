/**
 * Explore's Common App filters (specs/data-expansion/common-app.md "Display"): predicates read from `school.apply`
 * (lib/common-app/types.ts SchoolApply), shared by lib/dataset.ts (which applies them) and lib/explore-facets.ts
 * (which counts them). No "Common App" chip anywhere (quiet sources): each predicate's label names the fact
 * (the fee waiver, the round, the deadline), never the vendor. Pure module.
 */
import type { School } from "../types";

/** The Common App fee waiver can be used: accepted for anyone, or for U.S. applicants only (apply.fee_waiver). */
export function takesFeeWaiver(s: Pick<School, "apply">): boolean {
  const w = s.apply?.fee_waiver;
  return w === "accepted" || w === "us_only";
}

/** Offers Early Decision (apply.deadlines.ed). */
export function offersEd(s: Pick<School, "apply">): boolean {
  return s.apply?.deadlines?.ed != null;
}

/** Offers Early Decision II (apply.deadlines.ed2). */
export function offersEd2(s: Pick<School, "apply">): boolean {
  return s.apply?.deadlines?.ed2 != null;
}

/** Offers Early Action, EA II, or Restrictive Early Action (apply.deadlines.{ea,ea2,rea}). */
export function offersEarlyAction(s: Pick<School, "apply">): boolean {
  const d = s.apply?.deadlines;
  return d?.ea != null || d?.ea2 != null || d?.rea != null;
}

/**
 * The application fee to read for "No application fee" (lib/housing.ts noApplicationFee, newest-wins display-time
 * rule in specs/data-expansion/common-app.md "Store"): the Requirements Grid's U.S. fee when the college has a grid
 * row this cycle (the newest statement), else the federal/CDS fee already stored at `admissions.application_fee`.
 * Deadlines and fees are never written into `admissions.application_fee` itself — only read here, display-time,
 * the same way U2's card and U4's planner hooks prefer `apply.*` first.
 */
export function applicationFeeKnown(s: Pick<School, "apply" | "admissions">): number | null {
  if (s.apply?.common_app?.cycle) return s.apply.fee?.us ?? null;
  return s.admissions.application_fee ?? null;
}

export type ApplyingFilterParam = "feeWaiver" | "ed" | "ed2" | "ea";

/** Explore's "Applying" chips (specs/data-expansion/common-app.md "Display"): URL param, label, and predicate. */
export const APPLYING_FILTERS: readonly { key: string; param: ApplyingFilterParam; label: string; predicate: (s: School) => boolean }[] = [
  { key: "feeWaiver", param: "feeWaiver", label: "Takes the fee waiver", predicate: takesFeeWaiver },
  { key: "ed", param: "ed", label: "Early Decision", predicate: offersEd },
  { key: "ed2", param: "ed2", label: "ED II", predicate: offersEd2 },
  { key: "ea", param: "ea", label: "Early Action", predicate: offersEarlyAction },
];
