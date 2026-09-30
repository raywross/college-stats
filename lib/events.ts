/**
 * Policy changes ("events") derived from a college's yearly codes (specs/data-expansion/admission-factors.md): admission
 * factors, and the housing policies from housing-and-policies.md. Nothing is hand-kept. Pure, for the profile and tests.
 *
 * Rules, because code meanings shifted: a factor event is recorded for required ↔ not required in any era, and for any
 * change once both years are fall 2022 or later (when 3 came to mean "not considered"); a change out of "recommended"
 * across the fall 2022 redesign is a re-coding, not a decision. A change undone within two years (A → B → A) is dropped as
 * a reporting slip.
 */
import { FACTOR_ERA } from "./derive.ts";
import { historyYearLabel, type SchoolHistory, type SeriesKey, type YearKind } from "./history.ts";
import type { AdmissionFactor } from "./types";

export interface PolicyEvent {
  key: SeriesKey;
  year: number;
  kind: YearKind;
  /** e.g. "Stopped considering legacy status". */
  text: string;
  /** Which part of the profile it belongs to. */
  area: "admissions" | "campus" | "cost";
}

/** What each factor is called in an event sentence. */
export const FACTOR_PHRASES: Record<AdmissionFactor, string> = {
  gpa: "high school GPA",
  class_rank: "class rank",
  hs_record: "the high school record",
  college_prep: "a college-prep program",
  recommendations: "recommendations",
  competencies: "a demonstration of competencies",
  english_test: "an English proficiency test",
  other_test: "other tests",
  work_experience: "work experience",
  essay: "an essay",
  legacy: "legacy status",
};

/** A change undone within this many years (A → B → A) is treated as a reporting slip, and both are dropped. */
export const REVERSAL_YEARS = 2;

/** A series' reported years in order, as [year, code] pairs. */
function points(h: SchoolHistory, key: SeriesKey): [number, number][] {
  const s = h.series[key];
  if (!s) return [];
  return s.values.flatMap((v, i) => (v === null ? [] : [[s.start + i, v] as [number, number]]));
}

/** Changes between consecutive reported years, with A → B → A reversals in consecutive years dropped. */
function changes(pts: [number, number][], keep: (from: number, to: number, fromYear: number, toYear: number) => boolean) {
  const out: { year: number; from: number; to: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [y0, a] = pts[i - 1];
    const [y1, b] = pts[i];
    if (a !== b && keep(a, b, y0, y1)) out.push({ year: y1, from: a, to: b });
  }
  return out.filter((c, i) => {
    const next = out[i + 1];
    const prev = out[i - 1];
    const reversedNext = next && next.year - c.year <= REVERSAL_YEARS && next.to === c.from;
    const reversesPrev = prev && c.year - prev.year <= REVERSAL_YEARS && c.to === prev.from;
    return !reversedNext && !reversesPrev;
  });
}

function factorEvents(h: SchoolHistory, factor: AdmissionFactor): PolicyEvent[] {
  const key = `factor_${factor}` as SeriesKey;
  const phrase = FACTOR_PHRASES[factor];
  // "Recommended" (2) was abolished in fall 2022, so any change out of it across that boundary is a re-coding.
  const recoded = (a: number, y0: number, y1: number) => a === 2 && y0 < FACTOR_ERA && y1 >= FACTOR_ERA;
  const keep = (a: number, b: number, y0: number, y1: number) => !recoded(a, y0, y1) && ((a === 1) !== (b === 1) || y0 >= FACTOR_ERA);
  return changes(points(h, key), keep).map(({ year, from, to }) => {
    const modern = year >= FACTOR_ERA;
    let text: string;
    if (to === 1) text = `Started requiring ${phrase}`;
    else if (from === 1) text = `Stopped requiring ${phrase}${modern ? (to === 5 ? " (still considered)" : " (no longer considered)") : ""}`;
    else text = to === 5 ? `Started considering ${phrase}` : `Stopped considering ${phrase}`;
    return { key, year, kind: "fall" as const, text, area: "admissions" as const };
  });
}

const POLICY_TEXT: Record<"live_on" | "tuition_guarantee" | "promise", { on: string; off: string; area: PolicyEvent["area"] }> = {
  live_on: { on: "Began requiring first-years to live on campus", off: "Stopped requiring first-years to live on campus", area: "campus" },
  tuition_guarantee: { on: "Began offering a tuition guarantee", off: "Stopped offering a tuition guarantee", area: "cost" },
  promise: { on: "Joined a Promise program", off: "Left a Promise program", area: "cost" },
};

function policyChanges(h: SchoolHistory, key: keyof typeof POLICY_TEXT): PolicyEvent[] {
  const t = POLICY_TEXT[key];
  return changes(points(h, key), () => true).map(({ year, to }) => ({ key, year, kind: "academic" as const, text: to === 1 ? t.on : t.off, area: t.area }));
}

/** Every event for a college, newest first. */
export function historyEvents(h: SchoolHistory): PolicyEvent[] {
  const factors = (Object.keys(FACTOR_PHRASES) as AdmissionFactor[]).flatMap((f) => factorEvents(h, f));
  const policies = (Object.keys(POLICY_TEXT) as (keyof typeof POLICY_TEXT)[]).flatMap((k) => policyChanges(h, k));
  return [...factors, ...policies].sort((a, b) => b.year - a.year || a.text.localeCompare(b.text));
}


/** "fall 2023" or "2023–24", as the event's year reads in a sentence. */
export function eventYear(e: Pick<PolicyEvent, "year" | "kind">): string {
  return e.kind === "fall" ? historyYearLabel(e.year, "fall").toLowerCase() : historyYearLabel(e.year, "academic");
}
