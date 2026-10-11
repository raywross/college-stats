import "server-only";
/**
 * The rigor reading's rules and constants (specs/chances/method/rigor-reading.md): which schedules land in which
 * reading. This is the method, not copy: it never reaches a client bundle, a response, or a sentence (the proprietary
 * rule in specs/chances/README.md). tests/chances-rigor.test.mts fails if any client component imports this file.
 * The sentences a reading shows are in lib/chances/notes.ts and name no threshold.
 */
import type { RigorReading } from "./types.ts";

/** One object, tuned by the pilot against outcomes (method/rigor-reading.md "Pilot against outcomes"). */
export const RIGOR_RULES = {
  /** Five core subjects × 11th and 12th grade: no one can take all of a 23-course catalog. */
  reachableCap: 10,
  /** share of the reachable courses for "most" and "much". */
  shareMost: 0.7,
  shareMuch: 0.4,
  /** Core-subject cells checked (of ten) for "most" and "much". */
  coreMost: 8,
  coreMuch: 5,
  /** Unweighted 4.0-scale average of the advanced courses' grades that keeps a schedule "strong". */
  strongAdvancedGpa: 3.3,
  /** An advanced final grade below this many points (C) keeps a schedule from reading "most". */
  weakFinalPoints: 2.0,
  /** A school offering this many AP courses or fewer reads "few offered" when the student took what there was. */
  fewOfferedMax: 3,
} as const;

/** What the rules read: counts and grades only, already computed from the student's list and the school's offering. */
export interface RigorFacts {
  /** Different AP courses the school offers; null when not on record. */
  offered: number | null;
  /** AP, IB, and dual-enrollment rows, any status. */
  advanced: number;
  /** Whether the student entered anything the reading can use (a course of any kind, or a core-subject answer). */
  entered: boolean;
  /** Core-subject cells checked, 0–10. */
  core: number;
  /** Unweighted average of the advanced courses' grades; null without a letter grade. */
  advancedGpa: number | null;
  /** The lowest advanced final grade in 4.0-scale points; null without one. */
  lowestFinal: number | null;
}

export interface Placement {
  reading: RigorReading;
  /** The advanced grades are weak: the schedule can't read "most", and a "much" says so. */
  weak: boolean;
}

/** Whether the advanced grades are strong enough for a "most" schedule. */
export function isStrong(f: Pick<RigorFacts, "advancedGpa" | "lowestFinal">): boolean {
  const r = RIGOR_RULES;
  return (f.advancedGpa === null || f.advancedGpa >= r.strongAdvancedGpa) && (f.lowestFinal === null || f.lowestFinal >= r.weakFinalPoints);
}

/** The reading for a schedule against a school's offering (method/rigor-reading.md "The reading"). */
export function placeRigor(f: RigorFacts): Placement {
  const r = RIGOR_RULES;
  if (f.offered === null || !f.entered) return { reading: "cant_place", weak: false };
  const strong = isStrong(f);
  if (f.offered <= r.fewOfferedMax && f.advanced >= f.offered) return { reading: "few_offered", weak: !strong };
  const share = f.advanced / Math.max(Math.min(f.offered, r.reachableCap), 1);
  if ((share >= r.shareMost || f.core >= r.coreMost) && strong) return { reading: "most", weak: false };
  if (share >= r.shareMuch || f.core >= r.coreMuch) return { reading: "much", weak: !strong };
  return { reading: "some", weak: !strong };
}
