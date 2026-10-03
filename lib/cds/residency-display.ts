/**
 * Showing CDS C1 by residency (specs/data-expansion/cds-residency-admissions.md): admit rates and yields by where
 * applicants lived, the profile insight, the rate "for you", Explore's two chips, and Compare's cells. Computed at
 * render time from `school.reported.admissions_by_residency` (stored by lib/cds/residency.ts).
 *
 * Partial coverage: none of this feeds METRICS, ranks, medians, percentile strips, sorts, the radar, Key differences,
 * or "Known for" (tests/residency-admissions.test.mts guards it).
 *
 * Pure (imports only pure modules), so client components and Node tests load it directly.
 */
import type { ResidencyCounts, School } from "../types";
import { acceptanceRate } from "../derive.ts";
import { pctSmart } from "../format.ts";
import { stateName } from "../states.ts";

export type ResidencyRateGroup = "in_state" | "out_of_state" | "international";

/** The overall rate's rule: none under 10 applicants. */
export const RESIDENCY_MIN_RATE_APPLICANTS = 10;
/** Yield needs at least this many admits. */
export const RESIDENCY_MIN_YIELD_ADMITS = 10;
/** A gap between two shown groups this large (points) makes the card notable… */
export const RESIDENCY_NOTABLE_GAP = 0.05;
/** …or one rate this many times the other… */
export const RESIDENCY_NOTABLE_RATIO = 1.5;
/** …when both groups have at least this many applicants. */
export const RESIDENCY_MIN_APPLICANTS = 200;
/** `oosEven`: out-of-state rate at least the in-state rate minus this many points. */
export const RESIDENCY_EVEN_GAP = 0.05;

const rateOf = (c: ResidencyCounts | undefined) => (c ? acceptanceRate(c.applicants, c.admitted) : null);
const yieldOfCounts = (c: ResidencyCounts | undefined) =>
  c && c.admitted !== null && c.admitted >= RESIDENCY_MIN_YIELD_ADMITS && c.enrolled !== null && c.enrolled <= c.admitted
    ? Math.round((c.enrolled / c.admitted) * 10000) / 10000
    : null;

/** Admitted ÷ applied for each residency group (null under 10 applicants or without both counts). Unknown never. */
export function admitRatesByResidency(s: Pick<School, "reported">): Record<ResidencyRateGroup, number | null> {
  const b = s.reported?.admissions_by_residency;
  return { in_state: rateOf(b?.in_state), out_of_state: rateOf(b?.out_of_state), international: rateOf(b?.international) };
}

/** Enrolled ÷ admitted for each group, from the same grid (null under 10 admits). */
export function yieldsByResidency(s: Pick<School, "reported">): Record<ResidencyRateGroup, number | null> {
  const b = s.reported?.admissions_by_residency;
  return { in_state: yieldOfCounts(b?.in_state), out_of_state: yieldOfCounts(b?.out_of_state), international: yieldOfCounts(b?.international) };
}

/** All applicants in the grid's own class (C.117 ÷ C.116 of the same document): the bars' tick. */
export function sameClassAdmitRate(s: Pick<School, "reported">): number | null {
  return rateOf(s.reported?.admissions_by_residency?.total);
}

/** "Outside the U.S." in the student profile. */
export const OUTSIDE_US = "outside-us";

/**
 * The rate for a student: in-state when they live in the college's state, other states otherwise, international for
 * "Outside the U.S.". Null ("Not published") without a grid; never the overall rate.
 */
export function rateForStudent(s: Pick<School, "reported" | "location">, studentState: string): { group: ResidencyRateGroup; rate: number | null } {
  const group: ResidencyRateGroup = studentState === OUTSIDE_US ? "international" : studentState.toUpperCase() === s.location.state.toUpperCase() ? "in_state" : "out_of_state";
  return { group, rate: admitRatesByResidency(s)[group] };
}

/** Applicants in a group (for the notable rule's minimum). */
const applicantsIn = (s: Pick<School, "reported">, g: ResidencyRateGroup) => s.reported?.admissions_by_residency?.[g].applicants ?? 0;

export interface ResidencyInsight {
  /** "Tennessee". */
  state: string;
  rates: Record<ResidencyRateGroup, number | null>;
  yields: Record<ResidencyRateGroup, number | null>;
  /** All applicants in the same class (the tick). */
  all: number | null;
  /** Groups shown on the card, in order. */
  shown: ResidencyRateGroup[];
  notable: boolean;
  /** The card's headline, or the one line when not notable. */
  sentence: string;
  /** "Of those admitted, …", or null without two yields. */
  yieldSentence: string | null;
  /** The student's group when a profile state is known (the "(you)" marker); null signed out. */
  you: ResidencyRateGroup | null;
}

/**
 * The Admissions page's "Where applicants live" block: shown when the in-state and out-of-state rates are both
 * computable; international joins when its rate is. Notable when any two shown groups with 200+ applicants each differ
 * by 5+ points or one rate is 1.5× the other.
 */
export function admissionsByResidency(s: Pick<School, "reported" | "location">, studentState?: string | null): ResidencyInsight | null {
  const rates = admitRatesByResidency(s);
  if (rates.in_state === null || rates.out_of_state === null) return null;
  const yields = yieldsByResidency(s);
  const shown: ResidencyRateGroup[] = rates.international === null ? ["in_state", "out_of_state"] : ["in_state", "out_of_state", "international"];
  const big = shown.filter((g) => applicantsIn(s, g) >= RESIDENCY_MIN_APPLICANTS);
  let notable = false;
  for (let i = 0; i < big.length; i++)
    for (let j = i + 1; j < big.length; j++) {
      const [x, y] = [rates[big[i]]!, rates[big[j]]!];
      const lo = Math.min(x, y);
      if (Math.abs(x - y) >= RESIDENCY_NOTABLE_GAP - 1e-9 || (lo > 0 && Math.max(x, y) / lo >= RESIDENCY_NOTABLE_RATIO)) notable = true;
    }
  const state = stateName(s.location.state);
  const sentence = notable
    ? `${state} applicants were admitted at ${pctSmart(rates.in_state)}, applicants from other states at ${pctSmart(rates.out_of_state)}` +
      (rates.international !== null ? `, and international applicants at ${pctSmart(rates.international)}.` : ".")
    : `Applicants from ${state} and from other states were admitted at similar rates (${pctSmart(rates.in_state)} and ${pctSmart(rates.out_of_state)}).`;
  const y = yields;
  const yieldSentence =
    y.in_state !== null && y.out_of_state !== null
      ? `Of those admitted, ${pctSmart(y.in_state)} from ${state} enrolled, against ${pctSmart(y.out_of_state)} from other states` +
        (y.international !== null && shown.includes("international") ? ` and ${pctSmart(y.international)} from abroad.` : ".")
      : null;
  const you = studentState ? rateForStudent(s, studentState).group : null;
  return { state, rates, yields, all: sameClassAdmitRate(s), shown, notable, sentence, yieldSentence, you };
}

/* ------------------------------------------------------------------ */
/* Explore: "Where applicants live" (boolean chips only)               */
/* ------------------------------------------------------------------ */

export type ResidencyFilterParam = "byRes" | "oosEven";

/** A passed grid with in-state and out-of-state rates. */
export const publishesResidencyRates = (s: Pick<School, "reported">) => {
  const r = admitRatesByResidency(s);
  return r.in_state !== null && r.out_of_state !== null;
};

/** Out-of-state rate ≥ in-state rate − 5 points, both groups with 200+ applicants. */
export const admitsOutOfStateEvenly = (s: Pick<School, "reported">) => {
  const r = admitRatesByResidency(s);
  return (
    r.in_state !== null &&
    r.out_of_state !== null &&
    applicantsIn(s, "in_state") >= RESIDENCY_MIN_APPLICANTS &&
    applicantsIn(s, "out_of_state") >= RESIDENCY_MIN_APPLICANTS &&
    r.out_of_state >= r.in_state - RESIDENCY_EVEN_GAP - 1e-9
  );
};

export const RESIDENCY_FILTERS: readonly { param: ResidencyFilterParam; label: string; test: (s: School) => boolean }[] = [
  { param: "byRes", label: "Publishes admit rates by residency", test: publishesResidencyRates },
  { param: "oosEven", label: "Admits out-of-state applicants about as often as in-state", test: admitsOutOfStateEvenly },
];

/* ------------------------------------------------------------------ */
/* Compare: "All the numbers"                                          */
/* ------------------------------------------------------------------ */

/** Shown when a college's Common Data Set has no residency breakdown. */
export const NOT_PUBLISHED = "Not published";

const triple = (v: Record<ResidencyRateGroup, number | null>) =>
  (["in_state", "out_of_state", "international"] as const).map((g) => (v[g] === null ? "–" : pctSmart(v[g]!))).join(" / ");

/** "10% / 5.3% / 4.0%" (in-state / other states / international), or "Not published" without a grid. */
export function compareAdmitRates(s: Pick<School, "reported">): string {
  if (!s.reported?.admissions_by_residency) return NOT_PUBLISHED;
  const r = admitRatesByResidency(s);
  return r.in_state === null && r.out_of_state === null && r.international === null ? NOT_PUBLISHED : triple(r);
}

export function compareYields(s: Pick<School, "reported">): string {
  if (!s.reported?.admissions_by_residency) return NOT_PUBLISHED;
  const y = yieldsByResidency(s);
  return y.in_state === null && y.out_of_state === null && y.international === null ? NOT_PUBLISHED : triple(y);
}
