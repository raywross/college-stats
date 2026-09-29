/**
 * Student body groupings (specs/data-expansion/student-body.md): the gender-balance buckets Explore filters by and
 * the "mostly full-time" rule. Pure, so the dataset, the filter panel, and tests share one definition.
 */
import type { School } from "./types";

export type GenderBalance = "women" | "balanced" | "men";

/** Buckets by men's share of undergraduates. A 60/40 split either way is where a campus reads as mostly one sex. */
export const GENDER_BALANCE: readonly { key: GenderBalance; label: string; hint: string; test: (men: number) => boolean }[] = [
  { key: "women", label: "Mostly women", hint: "Over 60% women", test: (m) => m < 0.4 },
  { key: "balanced", label: "Balanced", hint: "40–60% each", test: (m) => m >= 0.4 && m <= 0.6 },
  { key: "men", label: "Mostly men", hint: "Over 60% men", test: (m) => m > 0.6 },
];

export function isGenderBalance(v: string): v is GenderBalance {
  return GENDER_BALANCE.some((b) => b.key === v);
}

export function genderBalanceOf(s: School): GenderBalance | null {
  const m = s.demographics.men_share;
  if (m == null) return null;
  return GENDER_BALANCE.find((b) => b.test(m))?.key ?? null;
}

/** "Mostly full-time": at most this share of undergraduates study part-time. */
export const FULL_TIME_MAX_PART_TIME = 0.1;

export function isMostlyFullTime(s: School): boolean {
  const p = s.demographics.part_time_share;
  return p != null && p <= FULL_TIME_MAX_PART_TIME;
}
