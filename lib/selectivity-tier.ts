/**
 * Reading a college's stored selectivity tier (specs/chances/selectivity-index.md): which of its tiers applies to a
 * student, and the words for a chip. Tiers only: the index, its weights, and the cutoffs live in lib/selectivity.ts,
 * which client code never imports (tests/selectivity.test.mts walks the client import graph). `tierForStudent` is
 * re-exported there, so server code and the model import it from either module. Pure, client-safe.
 */
import type { School } from "./types";
import type { SelectivityPool, SelectivityTier } from "./chances/types.ts";
import { SELECTIVITY_TIER_LABELS, SELECTIVITY_TIERS } from "./chances/levels.ts";
import { stateName } from "./states.ts";

/**
 * The tier for a student from `state` (a USPS code, or null when unknown): the in-state tier when the student lives in
 * the college's state and it has one; the out-of-state tier when the state is known and different and it has one;
 * else the tier for all applicants. A college with no tier (not rated) gives `{ tier: null, pool: "all" }`.
 */
export function tierForStudent(school: Pick<School, "selectivity" | "location">, state: string | null): { tier: SelectivityTier | null; pool: SelectivityPool } {
  const s = school.selectivity;
  if (!s) return { tier: null, pool: "all" };
  if (state && state === school.location.state && s.in_state) return { tier: s.in_state, pool: "in_state" };
  if (state && state !== school.location.state && s.out_of_state) return { tier: s.out_of_state, pool: "out_of_state" };
  return { tier: s.tier, pool: "all" };
}

/** True when the college has a tier for each pool and they differ (the profile shows both). */
export function poolsDiffer(school: Pick<School, "selectivity">): boolean {
  const s = school.selectivity;
  return !!s?.in_state && !!s.out_of_state && s.in_state !== s.out_of_state;
}

/** Hardest first: Elite 0 … Open 4; null for a college that isn't rated. For sorts. */
export function tierRank(tier: SelectivityTier | null | undefined): number | null {
  return tier ? SELECTIVITY_TIERS.indexOf(tier) : null;
}

export function isSelectivityTier(v: unknown): v is SelectivityTier {
  return typeof v === "string" && (SELECTIVITY_TIERS as readonly string[]).includes(v);
}

export function tierLabel(tier: SelectivityTier): string {
  return SELECTIVITY_TIER_LABELS[tier];
}

/** One tier a chip shows, with its pool ("all" when the college has one tier for everyone). */
export interface ChipTier {
  tier: SelectivityTier;
  pool: SelectivityPool;
  /** The college's state, for "from Georgia". */
  stateName: string;
}

/**
 * What a chip shows: both pools where a public's in-state and out-of-state tiers differ (in-state first), else the one
 * tier (a public's shared pool tier when it has one). Empty for a college that isn't rated.
 */
export function chipTiers(school: Pick<School, "selectivity" | "location">): ChipTier[] {
  const s = school.selectivity;
  if (!s) return [];
  const name = stateName(school.location.state);
  if (s.in_state && s.out_of_state && s.in_state !== s.out_of_state)
    return [
      { tier: s.in_state, pool: "in_state", stateName: name },
      { tier: s.out_of_state, pool: "out_of_state", stateName: name },
    ];
  // Both pools the same: that's the tier every student with a known state gets, so it's the one to show.
  const one = s.in_state && s.in_state === s.out_of_state ? s.in_state : s.tier;
  return one ? [{ tier: one, pool: "all", stateName: name }] : [];
}

/** The tier in words for a line of text: "Elite", or "Highly selective in-state, Elite out of state". Null when not rated. */
export function tierText(school: Pick<School, "selectivity" | "location">): string | null {
  const tiers = chipTiers(school);
  if (!tiers.length) return null;
  return tiers.map((t) => `${tierLabel(t.tier)}${t.pool === "in_state" ? " in-state" : t.pool === "out_of_state" ? " out of state" : ""}`).join(", ");
}
