/**
 * Word lists and limits for the five-level build (specs/chances/levels.md, selectivity-index.md, depth.md,
 * inputs-beyond-academics.md): the runtime half of the contracts in lib/chances/types.ts, which holds types only.
 * Pure and client-safe.
 */
import type { ClassStanding, CollegeHooks, RecruitedPick, SelectivityTier, StandingLevel } from "./types.ts";

/** The five levels, lowest first (levels.md "The levels"). */
export const STANDING_LEVELS: readonly StandingLevel[] = ["high_reach", "reach", "target", "likely", "safe"];
export const STANDING_LEVEL_LABELS: Record<StandingLevel, string> = {
  high_reach: "High reach",
  reach: "Reach",
  target: "Target",
  likely: "Likely",
  safe: "Safe",
};

/**
 * Quad's selectivity tiers, hardest first (selectivity-index.md "Tiers"). The top tier's key stays `elite` (stored in
 * snapshots and the estimate label); its name on the site is "Ultra selective" (owner, 2026-10-12).
 */
export const SELECTIVITY_TIERS: readonly SelectivityTier[] = ["elite", "highly_selective", "very_selective", "selective", "accessible", "open"];
export const SELECTIVITY_TIER_LABELS: Record<SelectivityTier, string> = {
  elite: "Ultra selective",
  highly_selective: "Highly selective",
  very_selective: "Very selective",
  selective: "Selective",
  accessible: "Accessible",
  open: "Open",
};

/**
 * Most activities a student lists across the four intake steps (sports, clubs, work, other; depth.md). The Common App
 * allows 10; this is twice that so a student can enter everything and pick their ten later. The depth reading uses
 * only the top two, so a longer list neither helps nor hurts (raised from 8, U13, 2026-10-12).
 */
export const ACTIVITIES_MAX = 20;
/** Most awards a student lists (inputs-beyond-academics.md "Awards"). */
export const AWARDS_MAX = 6;

/** The `classRankPercentile` each class-standing pick stores; "no_rank" stores null. */
export const CLASS_STANDING_PERCENTILE: Record<ClassStanding, number | null> = { top1: 1, top5: 5, top10: 10, top25: 25, top50: 50, lower: 75, no_rank: null };

export const RECRUITED_PICKS: readonly RecruitedPick[] = ["none", "contact", "pre_read", "likely_letter"];
/** A college with nothing marked on its list row. */
export const NO_HOOKS: CollegeHooks = { legacy: false, recruited: "none", interest: false };
