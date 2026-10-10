/**
 * Colleges' published aid promises and rules (specs/product/cost-by-income.md "Published promises"): income lines
 * ("families under $200K pay no tuition"), full-need and no-loan policies, need-only (no merit), and how home equity
 * and siblings are treated. Hand-curated in data/aid-policies.json from each college's own page, checked by
 * scripts/check-aid-policies.mts in `npm run verify`, cited as college-published values (lib/fields.ts `aid_policy.*`).
 * Pure: safe in server and client code and in tests.
 */
import file from "../data/aid-policies.json" with { type: "json" };

export type HomeEquityRule = "ignored" | { cap_multiple: number } | "full";
export type SiblingRule = "split" | "reduce" | "none";

export interface AidPolicy {
  unit_id: string;
  /** The award year the policy is stated for, e.g. "2025-26". */
  as_of: string;
  /** Families below this income (typical assets) pay no tuition. */
  free_tuition_under: number | null;
  /** Families below this income pay nothing toward the cost of attendance. */
  no_contribution_under: number | null;
  meets_full_need: boolean | null;
  no_loans: boolean | null;
  /** No merit aid: every grant is need-based. */
  need_only: boolean | null;
  home_equity: HomeEquityRule | null;
  siblings: SiblingRule | null;
  /** The college's own wording or rule, short ("Parent contribution × 60% per sibling"). */
  siblings_note: string | null;
  /** The college's own page the entry was checked against. */
  source: string;
  /** ISO date the entry was last checked. */
  checked: string;
  /** "page": read on the college's page; "search": quoted from the college's page in a web search result, not yet opened. */
  verified_via: "page" | "search";
}

export interface AidPolicyFile {
  description?: string;
  policies: AidPolicy[];
}

const byId = new Map((file as AidPolicyFile).policies.map((p) => [p.unit_id, p]));

/** The college's published policy, or null when none is curated. */
export function aidPolicyFor(unitId: string): AidPolicy | null {
  return byId.get(unitId) ?? null;
}

/** Every curated policy (the check script and tests). */
export function allAidPolicies(): AidPolicy[] {
  return (file as AidPolicyFile).policies;
}
