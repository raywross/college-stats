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
import { conferenceName } from "./conferences.ts";
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

/** A conference as it reads in a sentence; null for independents and "Other", which aren't leagues. */
function league(code: number): string | null {
  const name = conferenceName(code);
  return name && !/independent|^other$/i.test(name) ? `the ${name.replace(/^The /, "")}` : null;
}

function moveText(from: number, to: number, prefix = ""): string {
  const [a, b] = [league(from), league(to)];
  // 113 "Division I-A Independents" is FBS; 112 and 114 are the other Division I independents.
  if (!a && to === 113 && (from === 112 || from === 114)) return prefix ? `${prefix} moved up to FBS as an independent` : "Moved up to FBS as an independent";
  const t = a && b ? `moved from ${a} to ${b}` : b ? `joined ${b}` : a ? `left ${a} to play as an independent` : "changed conference";
  return prefix ? `${prefix} ${t}` : t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Conference moves (specs/data-expansion/campus-services.md). A football move gets its own line only when the rest of
 * the college didn't make the same move that year.
 */
function conferenceEvents(h: SchoolHistory): PolicyEvent[] {
  const main = changes(points(h, "conference"), () => true);
  const events: PolicyEvent[] = main.map(({ year, from, to }) => ({ key: "conference", year, kind: "academic", text: moveText(from, to), area: "campus" }));
  const mainByYear = new Map(points(h, "conference"));
  for (const c of changes(points(h, "football_conference"), () => true)) {
    if (main.some((m) => m.year === c.year && m.to === c.to)) continue;
    // A reporting fix, not a move: an independent (UConn, Notre Dame) first listed its home conference for football.
    const prevMain = mainByYear.get(c.year - 1);
    if (league(c.to) === null && prevMain === c.from) continue;
    events.push({ key: "football_conference", year: c.year, kind: "academic", text: moveText(c.from, c.to, "Football"), area: "campus" });
  }
  return events;
}

/** athletic_association: 1 NCAA, 2 NAIA only, 3 neither (lib/campus-services.ts associationCode). */
const ASSOCIATION_NAMES: Record<number, string> = { 1: "the NCAA", 2: "the NAIA" };

function associationEvents(h: SchoolHistory): PolicyEvent[] {
  return changes(points(h, "athletic_association"), () => true).map(({ year, from, to }) => {
    const [a, b] = [ASSOCIATION_NAMES[from], ASSOCIATION_NAMES[to]];
    const text = a && b ? `Moved from ${a} to ${b}` : b ? `Joined ${b}` : `Left ${a}`;
    return { key: "athletic_association" as const, year, kind: "academic" as const, text, area: "campus" as const };
  });
}

/** ROTC: 1 offered, 2 not listed. "Not listed" is an unticked box, so the drop is worded softly. */
function rotcEvents(h: SchoolHistory): PolicyEvent[] {
  return changes(points(h, "rotc"), () => true).map(({ year, to }) => ({
    key: "rotc" as const,
    year,
    kind: "academic" as const,
    text: to === 1 ? "Began offering ROTC" : "No longer lists ROTC",
    area: "campus" as const,
  }));
}

/** Every event for a college, newest first. */
export function historyEvents(h: SchoolHistory): PolicyEvent[] {
  const factors = (Object.keys(FACTOR_PHRASES) as AdmissionFactor[]).flatMap((f) => factorEvents(h, f));
  const policies = (Object.keys(POLICY_TEXT) as (keyof typeof POLICY_TEXT)[]).flatMap((k) => policyChanges(h, k));
  const athletics = [...conferenceEvents(h), ...associationEvents(h), ...rotcEvents(h)];
  return [...factors, ...policies, ...athletics].sort((a, b) => b.year - a.year || a.text.localeCompare(b.text));
}


/** "fall 2023" or "2023–24", as the event's year reads in a sentence. */
export function eventYear(e: Pick<PolicyEvent, "year" | "kind">): string {
  return e.kind === "fall" ? historyYearLabel(e.year, "fall").toLowerCase() : historyYearLabel(e.year, "academic");
}
