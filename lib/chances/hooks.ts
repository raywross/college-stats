import "server-only";
/**
 * The list row's inputs as the method reads them (specs/chances/method/standing.md "The other multipliers",
 * "Floors"; inputs-beyond-academics.md "Legacy", "Recruited athlete", "Demonstrated interest"): legacy weighted by
 * the college's own C7 alumni-relation rating and zero where state law bars it (lib/chances/legacy-bans.ts `banFor`),
 * a coach's contact as a multiplier, a pre-read or likely letter as a floor, and logged interest by the college's C7
 * interest rating. Pure (no I/O) and server-only: the multipliers are the method's and never reach a client bundle,
 * a sentence, or an API response (specs/chances/README.md).
 */
import type { School } from "../types.ts";
import { banFor, sectorOf, type LegacyBan } from "./legacy-bans.ts";
import type { RecruitedPick, SelectivityTier, StandingLevel } from "./types.ts";

type Importance = "very_important" | "important" | "considered" | "not_considered";

/** The values (method/standing.md "The other multipliers"); they change only with a season measurement. */
export const HOOKS_V3 = {
  legacy: { very_important: 2.5, important: 2.5, considered: 1.5, not_considered: 1 } as Record<Importance, number>,
  interest: { very_important: 1.15, important: 1.15, considered: 1.05, not_considered: 1 } as Record<Importance, number>,
  /** "A coach has contacted me". */
  recruitContact: 1.5,
  /** A positive pre-read is a floor only from this academic distance up. */
  preReadMinD: -0.5,
} as const;

type HookSchool = Pick<School, "type" | "location" | "reported">;

const rating = (school: HookSchool, factor: "alumni_relation" | "interest"): Importance | null => (school.reported?.admission_profile?.factors?.[factor] ?? null) as Importance | null;

export interface LegacyReading {
  /** The multiplier for a legacy applicant here (1 where it isn't weighed or is barred). */
  multiplier: number;
  /** The college's C7 alumni-relation rating, or null without C7. */
  rating: Importance | null;
  /** The state ban covering the college's sector, or null. A ban makes the multiplier 1 whatever the rating. */
  ban: LegacyBan | null;
}

/** What a legacy connection does at this college (applies only when the student marked one on the row). */
export function legacyMultiplier(school: HookSchool): LegacyReading {
  const r = rating(school, "alumni_relation");
  const ban = school.location?.state ? banFor(school.location.state, sectorOf(school.type)) : null;
  if (ban) return { multiplier: 1, rating: r, ban };
  return { multiplier: r ? HOOKS_V3.legacy[r] : 1, rating: r, ban: null };
}

/** What logged interest does here: its multiplier and the college's C7 interest rating. */
export function interestMultiplier(school: HookSchool): { multiplier: number; rating: Importance | null } {
  const r = rating(school, "interest");
  return { multiplier: r ? HOOKS_V3.interest[r] : 1, rating: r };
}

/** A coach's contact multiplies; a pre-read and a likely letter are floors instead (recruitedFloor). */
export function recruitMultiplier(pick: RecruitedPick): number {
  return pick === "contact" ? HOOKS_V3.recruitContact : 1;
}

/**
 * The level a recruiting pick guarantees at least (method/standing.md "Floors"): a likely letter, Likely at any tier;
 * a positive pre-read with the academic distance at least HOOKS_V3.preReadMinD, Target at an Elite college and Likely
 * elsewhere. Null otherwise (no pick, a contact, or a pre-read without numbers that place the student).
 */
export function recruitedFloor(pick: RecruitedPick, d: number | null, tier: SelectivityTier | null): StandingLevel | null {
  if (pick === "likely_letter") return "likely";
  if (pick === "pre_read" && d !== null && d >= HOOKS_V3.preReadMinD) return tier === "elite" ? "target" : "likely";
  return null;
}
