/**
 * The Requirements Grid's test-policy codes in the site's vocabulary (specs/data-expansion/common-app.md "Store",
 * newest wins): shared by the merge (scripts/lib/common-app/merge.mts), which writes the mapped value into
 * `admissions.test_policy` when the grid is the newest statement, and the lineage guard (lib/cds/test-blocks.ts
 * `validateTests`), which checks a value cited to `common-app` against the stored grid code. Pure.
 */
import type { TestPolicyAnswer } from "../types";
import type { GridTestCode } from "./types";

/**
 * N never required → considered (test-optional); I ignored → not-considered (test-blind); A always required and
 * F flexible → required (`apply.test_policy.code` keeps F, so the card can say "flexible"); S sometimes required →
 * required-some.
 */
export const GRID_POLICY: Record<GridTestCode, TestPolicyAnswer> = {
  N: "considered",
  I: "not-considered",
  A: "required",
  F: "required",
  S: "required-some",
};

/** The fall a grid cycle's applicants enter: "2026-27" → 2027. Null for text that isn't a cycle. */
export function gridCycleFall(cycle: string | null | undefined): number | null {
  const m = /^(\d{4})[-–](\d{2}|\d{4})$/.exec(cycle?.trim() ?? "");
  if (!m) return null;
  const start = Number(m[1]);
  return start + 1;
}
