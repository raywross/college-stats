/**
 * Biggest movers (specs/trends/top-10-lists.md): the registry of top-10 lists and the one function that ranks a list
 * over any set of colleges. Pure (no I/O): `scripts/trends/movers.mts` runs it over every college for
 * data/history/trends/movers.json, the conference and state builders run it over a group's members, and the test
 * recomputes a list from the shards with the same rules.
 *
 * Every list is a change the site already measures for profiles and Explore (`changeOver`, `pellGapAt`), with:
 * - a floor at the start of the window, on the base (rule 1), some also at the end (`at: "both"`);
 * - campus-based only for growth (rule 2): for-profits and the reviewed online-first list are left out of `growth`
 *   lists until the distance-education share exists;
 * - still open on every list: a latest undergraduate count under 300, or a campus on the reviewed closed/merged list,
 *   keeps a college out (rules 2 and 3);
 * - reporting errors out (rule 4): an endpoint that jumped more than 3× from the year next to it;
 * - ties at the last rank kept (rule 5).
 */
import type { FieldPath } from "./fields";
import type { TermKey } from "./glossary";
import { changeOver, pellGapAt, valueAt, type CpiTable, type HistoryMeta, type SchoolHistory, type SeriesKey, type YearKind } from "./history.ts";
import type { School, SchoolType, SortKey } from "./types";

/** Years back from history's newest year of the list's kind. Ten is the default (as profiles and Explore). */
export type MoverWindow = 10 | 5;
export const MOVER_WINDOWS: readonly MoverWindow[] = [10, 5];
export const isMoverWindow = (v: unknown): v is MoverWindow => v === 10 || v === 5;

/** Entries kept per list (plus any tied with the last); the page shows the first `MOVERS_SHOWN`. */
export const MOVERS_KEPT = 25;
export const MOVERS_SHOWN = 10;

/** Rule 2: a college under this many undergraduates in the newest fall is closing, not shrinking. Every list. */
export const STILL_OPEN_MIN_UNDERGRADS = 300;
/** Rule 4: an endpoint more than this many times (or under 1/this) the year next to it is a reporting jump. */
export const JUMP_FACTOR = 3;
/** The history build's jump report ignores bases under this (scripts/history/build.mts `bigJumps`). */
export const JUMP_MIN_BASE = 50;

export type MoverListKey =
  | "applications-surged"
  | "harder-to-get-into"
  | "easier-to-get-into"
  | "grew-most"
  | "shrank-most"
  | "pay-less"
  | "pay-more"
  | "grad-rate-climbed"
  | "more-out-of-state"
  | "pell-gap-closed";

/** A minimum a college must meet to be ranked: `series` ≥ `min` at the window's start (or at both ends). */
export interface MoverFloor {
  /** A count or dollar series, or "entering_class" (the graduation-rate class, summed over its reported groups). */
  series: SeriesKey | "entering_class";
  min: number;
  at: "start" | "both";
}

export interface MoverListDef {
  key: MoverListKey;
  /** The measure's domain color (a CSS variable, specs/design-system.md), for its bars. */
  color: string;
  /** What happened, never "worst" (rule 6). */
  title: string;
  /** The measure, for the method note ("Applicants, % change"). */
  measure: string;
  /** Series measured (one, or the Pell gap's two rates). */
  series: readonly SeriesKey[];
  kind: YearKind;
  /** "ratio": relative change (money after inflation); "points": difference of shares. */
  change: "ratio" | "points";
  /** Which way the list ranks: "up" = biggest increases first. Only colleges that moved this way are listed. */
  direction: "up" | "down";
  floors: readonly MoverFloor[];
  /** Only these control types (e.g. public colleges for out-of-state students). */
  types?: readonly SchoolType[];
  /** Growth list: for-profits and the online-first list are left out (rule 2). */
  campusBased?: true;
  /** A decline list: the page reminds readers that smaller can be deliberate. */
  decline?: true;
  /** Count series whose endpoint jumps flag a reporting error (rule 4). */
  jumpKeys: readonly SeriesKey[];
  /** The floor in a sentence ("2,000+ applicants"), with the window's first year added by the page. */
  floorText: string;
  term: TermKey;
  /** Registered fields of every series read (measure and floors), for lineage. */
  fields: readonly FieldPath[];
  /** "See all in Explore": the same ten-year sort with the same floors, when Explore has the sort. */
  explore?: { sortBy: SortKey; sortDir: "asc" | "desc"; params?: Record<string, string> };
}

/** Graduation-rate classes are counted over these groups (the cohort itself isn't stored; this is a lower bound). */
export const ENTERING_CLASS_SERIES = [
  "grad_cohort_white",
  "grad_cohort_asian",
  "grad_cohort_hispanic",
  "grad_cohort_black",
  "grad_cohort_two_or_more",
  "grad_cohort_international",
] as const satisfies readonly SeriesKey[];

/** The lists, in page order (specs/trends/top-10-lists.md#what-readers-see). */
export const MOVER_LISTS = [
  {
    key: "applications-surged",
    color: "var(--d-admissions)",
    title: "Applications surged",
    measure: "Applicants, % change",
    series: ["applicants"],
    kind: "fall",
    change: "ratio",
    direction: "up",
    floors: [{ series: "applicants", min: 2000, at: "start" }],
    campusBased: true,
    jumpKeys: ["applicants"],
    floorText: "2,000+ applicants",
    term: "applicants",
    fields: ["admissions.applicants", "demographics.undergrad_enrollment"],
    explore: { sortBy: "apps_change", sortDir: "desc", params: { minApplicants: "2000" } },
  },
  {
    key: "harder-to-get-into",
    color: "var(--d-admissions)",
    title: "Got much harder to get into",
    measure: "Acceptance rate, points",
    series: ["acceptance_rate"],
    kind: "fall",
    change: "points",
    direction: "down",
    floors: [{ series: "applicants", min: 2000, at: "start" }],
    jumpKeys: ["applicants", "admitted"],
    floorText: "2,000+ applicants",
    term: "acceptance-rate",
    fields: ["admissions.acceptance_rate", "admissions.applicants", "admissions.admitted", "demographics.undergrad_enrollment"],
    explore: { sortBy: "admit_rate_change", sortDir: "asc", params: { minApplicants: "2000" } },
  },
  {
    key: "easier-to-get-into",
    color: "var(--d-admissions)",
    title: "Got much easier to get into",
    measure: "Acceptance rate, points",
    series: ["acceptance_rate"],
    kind: "fall",
    change: "points",
    direction: "up",
    floors: [{ series: "applicants", min: 2000, at: "start" }],
    jumpKeys: ["applicants", "admitted"],
    floorText: "2,000+ applicants",
    term: "acceptance-rate",
    fields: ["admissions.acceptance_rate", "admissions.applicants", "admissions.admitted", "demographics.undergrad_enrollment"],
    explore: { sortBy: "admit_rate_change", sortDir: "desc", params: { minApplicants: "2000" } },
  },
  {
    key: "grew-most",
    color: "var(--d-size)",
    title: "Grew the most",
    measure: "Undergraduates, % change",
    series: ["undergrads"],
    kind: "fall",
    change: "ratio",
    direction: "up",
    floors: [{ series: "undergrads", min: 1000, at: "start" }],
    campusBased: true,
    jumpKeys: ["undergrads"],
    floorText: "1,000+ undergraduates",
    term: "undergrad-enrollment",
    fields: ["demographics.undergrad_enrollment"],
    explore: { sortBy: "size_change", sortDir: "desc", params: { minUndergrads: "1000", types: "public,private-nonprofit" } },
  },
  {
    key: "shrank-most",
    color: "var(--d-size)",
    title: "Shrank the most",
    measure: "Undergraduates, % change",
    series: ["undergrads"],
    kind: "fall",
    change: "ratio",
    direction: "down",
    floors: [{ series: "undergrads", min: 1000, at: "start" }],
    decline: true,
    jumpKeys: ["undergrads"],
    floorText: "1,000+ undergraduates",
    term: "undergrad-enrollment",
    fields: ["demographics.undergrad_enrollment"],
    explore: { sortBy: "size_change", sortDir: "asc", params: { minUndergrads: "1000" } },
  },
  {
    key: "pay-less",
    color: "var(--d-value)",
    title: "Students pay much less",
    measure: "Average total cost, % change after inflation",
    series: ["avg_paid_all"],
    kind: "academic",
    change: "ratio",
    direction: "down",
    floors: [
      { series: "undergrads", min: 1000, at: "start" },
      { series: "avg_paid_all", min: 5000, at: "start" },
    ],
    jumpKeys: ["avg_paid_all"],
    floorText: "1,000+ undergraduates and an average cost over $5,000",
    term: "average-cost",
    fields: ["cost.avg_paid_all", "demographics.undergrad_enrollment"],
    explore: { sortBy: "avg_cost_change", sortDir: "asc", params: { minUndergrads: "1000" } },
  },
  {
    key: "pay-more",
    color: "var(--d-value)",
    title: "Students pay much more",
    measure: "Average total cost, % change after inflation",
    series: ["avg_paid_all"],
    kind: "academic",
    change: "ratio",
    direction: "up",
    floors: [
      { series: "undergrads", min: 1000, at: "start" },
      { series: "avg_paid_all", min: 5000, at: "start" },
    ],
    jumpKeys: ["avg_paid_all"],
    floorText: "1,000+ undergraduates and an average cost over $5,000",
    term: "average-cost",
    fields: ["cost.avg_paid_all", "demographics.undergrad_enrollment"],
    explore: { sortBy: "avg_cost_change", sortDir: "desc", params: { minUndergrads: "1000" } },
  },
  {
    key: "grad-rate-climbed",
    color: "var(--d-scores)",
    title: "Graduation rate climbed",
    measure: "6-year graduation rate, points",
    series: ["grad_rate"],
    kind: "cohort",
    change: "points",
    direction: "up",
    floors: [
      { series: "undergrads", min: 1000, at: "start" },
      { series: "entering_class", min: 200, at: "both" },
    ],
    jumpKeys: [],
    floorText: "1,000+ undergraduates when the first class entered and 200+ students in both entering classes",
    term: "graduation-rate",
    fields: ["outcomes.graduation_rate", "outcomes.grad_cohorts_by_race", "demographics.undergrad_enrollment"],
  },
  {
    key: "more-out-of-state",
    color: "var(--d-diversity)",
    title: "More students from out of state",
    measure: "First-years from other states, points (public colleges)",
    series: ["out_of_state_share"],
    kind: "fall",
    change: "points",
    direction: "up",
    floors: [{ series: "enrolled", min: 500, at: "start" }],
    types: ["public"],
    jumpKeys: ["enrolled"],
    floorText: "500+ enrolled first-years",
    term: "in-state-student",
    fields: ["demographics.residence", "admissions.enrolled", "demographics.undergrad_enrollment"],
  },
  {
    key: "pell-gap-closed",
    color: "var(--d-access)",
    title: "Pell gap closed most",
    measure: "Graduation rate, students with neither Pell nor a subsidized loan minus Pell recipients, points",
    series: ["grad_rate_pell", "grad_rate_no_pell_no_loan"],
    kind: "cohort",
    change: "points",
    direction: "down",
    // The spec's 100 Pell recipients, plus 100 in the comparison group: with a few dozen students on that side, the
    // gap swings 30+ points between classes (the first build's top ten was mostly such classes).
    floors: [
      { series: "grad_cohort_pell", min: 100, at: "both" },
      { series: "grad_cohort_no_pell_no_loan", min: 100, at: "both" },
    ],
    jumpKeys: [],
    floorText: "100+ Pell recipients and 100+ students with neither in both entering classes",
    term: "pell-graduation-gap",
    fields: ["outcomes.grad_rate_pell", "outcomes.grad_rate_no_pell_no_loan", "outcomes.grad_cohorts", "demographics.undergrad_enrollment"],
    // No Explore link: its Pell-gap sort applies the Pell floor only, so it wouldn't show the same colleges.
  },
] as const satisfies readonly MoverListDef[];

export const moverList = (key: MoverListKey): MoverListDef => MOVER_LISTS.find((l) => l.key === key)!;

/** Why a college that cleared the floors still isn't ranked. */
export type MoverExclusion = "for-profit" | "online-first" | "closed-or-merged" | "under-300" | "reporting-jump";
export const MOVER_EXCLUSIONS: readonly MoverExclusion[] = ["closed-or-merged", "under-300", "for-profit", "online-first", "reporting-jump"];

/** One entry of a reviewed exclusion file (data/trends/online-first.json, data/trends/excluded-campuses.json). */
export interface ExclusionEntry {
  unit_id: string;
  /** The college's name when reviewed, for readers of the file. */
  name: string;
  reason: string;
  /** Review date, YYYY-MM-DD. */
  added: string;
}

/**
 * An excluded campus (rule 3, one campus one entry). With neither field, the college is left off every list (closed,
 * or its counts are allocations of a multi-campus total rather than one campus). With `before` (a merger or split
 * that year) or `years` (single years reported for a different set of campuses), it's left off only when a window's
 * endpoint falls on the other side, so a window entirely after a merger still ranks the merged college.
 */
export interface CampusExclusionEntry extends ExclusionEntry {
  /** Counts before this year describe a different set of campuses. */
  before?: number;
  /** These years' counts describe a different set of campuses. */
  years?: number[];
}

/** The reviewed lists, by unit ID. */
export interface MoverExclusionSets {
  onlineFirst: ReadonlySet<string>;
  campuses: ReadonlyMap<string, Pick<CampusExclusionEntry, "before" | "years">>;
}

/** The reviewed files as `MoverExclusionSets`. */
export function exclusionSets(onlineFirst: readonly ExclusionEntry[], campuses: readonly CampusExclusionEntry[]): MoverExclusionSets {
  return {
    onlineFirst: new Set(onlineFirst.map((e) => e.unit_id)),
    campuses: new Map(campuses.map((e) => [e.unit_id, { before: e.before, years: e.years }])),
  };
}

/** True when a campus exclusion applies to a change from `since` to `to`. */
export function campusExcluded(rule: Pick<CampusExclusionEntry, "before" | "years"> | undefined, since: number, to: number): boolean {
  if (!rule) return false;
  if (rule.before === undefined && rule.years === undefined) return true;
  return (rule.before !== undefined && since < rule.before && to >= rule.before) || !!rule.years?.some((y) => y === since || y === to);
}

/** One college to rank: today's snapshot and its history shard (the trend panels' `Member`). */
export interface MoverMember {
  school: School;
  h: SchoolHistory;
}

export interface MoverContext {
  cpi: CpiTable;
  latest: HistoryMeta["latest"];
  exclusions: MoverExclusionSets;
}

/** A college's change on a list: values at the two ends (shares 0–1, counts, or to-year dollars). */
export interface MoverChange {
  /** The first year actually used (the window's start, or up to 2 years later when that year is missing). */
  since: number;
  from: number;
  to: number;
  change: number;
}

export interface MoverEntry extends MoverChange {
  unit_id: string;
  name: string;
  /** Competition rank: tied changes share a rank (1, 2, 2, 4). */
  rank: number;
}

export interface MoverResult {
  key: MoverListKey;
  /** The window's ends in the list's year kind. */
  from: number;
  to: number;
  kind: YearKind;
  /** The floors applied (the registry's, recorded with the result). */
  floors: readonly MoverFloor[];
  /** Colleges ranked: cleared the floors and every exclusion (the median's base). */
  n: number;
  /** The median change over those colleges (null when none). */
  median: number | null;
  /** Colleges that cleared the floors but were left out, by rule (zero counts omitted). */
  excluded: Partial<Record<MoverExclusion, number>>;
  /** Ranked, best first: ranks 1–`MOVERS_KEPT` plus ties with the last. */
  entries: MoverEntry[];
}

/** The window's ends for a list: [newest − years, newest] in its year kind. */
export function moverYears(def: Pick<MoverListDef, "kind">, window: MoverWindow, latest: HistoryMeta["latest"]): [number, number] {
  const to = latest[def.kind];
  return [to - window, to];
}

const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;

function floorValue(h: SchoolHistory, series: MoverFloor["series"], year: number): number | null {
  if (series !== "entering_class") return valueAt(h.series[series], year);
  const parts = ENTERING_CLASS_SERIES.map((k) => valueAt(h.series[k], year));
  return parts.every((v) => v === null) ? null : parts.reduce<number>((a, v) => a + (v ?? 0), 0);
}

/** The change a list measures, with the same endpoint rule as profiles (`changeOver`); null when not measurable. */
export function moverChange(def: MoverListDef, h: SchoolHistory, years: [number, number], cpi: CpiTable): MoverChange | null {
  if (def.key === "pell-gap-closed") {
    // As lib/history.ts pellGapChange, over any window: the window's last class and its first (or up to 2 later).
    const to = pellGapAt(h, years[1]);
    if (to === null) return null;
    for (let y = years[0]; y <= years[0] + 2 && y < years[1]; y++) {
      const from = pellGapAt(h, y);
      if (from !== null) return { since: y, from, to, change: to - from };
    }
    return null;
  }
  const c = changeOver(def.series[0], h.series[def.series[0]], years, cpi);
  return c && { since: c.from.year, from: c.from.value, to: c.to.value, change: c.change };
}

/** True when every floor holds (at the change's first year, and at the last for `at: "both"`). */
export function meetsFloors(def: MoverListDef, h: SchoolHistory, since: number, to: number): boolean {
  return def.floors.every((f) => [since, ...(f.at === "both" ? [to] : [])].every((y) => (floorValue(h, f.series, y) ?? -Infinity) >= f.min));
}

/** Rule 4: `key` in `year` is more than 3× (or under ⅓ of) the year before or after it, as the history build flags. */
export function isEndpointJump(h: SchoolHistory, key: SeriesKey, year: number): boolean {
  const s = h.series[key];
  const v = valueAt(s, year);
  // a → b in consecutive years, the earlier clearing the base (bigJumps' rule).
  const jump = (a: number | null, b: number | null) => !!a && !!b && a >= JUMP_MIN_BASE && (b / a > JUMP_FACTOR || a / b > JUMP_FACTOR);
  return jump(valueAt(s, year - 1), v) || jump(v, valueAt(s, year + 1));
}

/** The newest-fall undergraduate count (history, else today's snapshot). */
export function latestUndergrads(m: MoverMember, latest: HistoryMeta["latest"]): number {
  return valueAt(m.h.series.undergrads, latest.fall) ?? m.school.demographics.undergrad_enrollment;
}

/** The first rule that keeps a college off a list, or null. Order: closed, under 300, for-profit, online, jump. */
export function moverExclusion(def: MoverListDef, m: MoverMember, c: MoverChange, ctx: MoverContext, to: number): MoverExclusion | null {
  const id = m.school.unit_id;
  if (campusExcluded(ctx.exclusions.campuses.get(id), c.since, to)) return "closed-or-merged";
  if (latestUndergrads(m, ctx.latest) < STILL_OPEN_MIN_UNDERGRADS) return "under-300";
  if (def.campusBased && m.school.type === "private-forprofit") return "for-profit";
  if (def.campusBased && ctx.exclusions.onlineFirst.has(id)) return "online-first";
  if (def.jumpKeys.some((k) => isEndpointJump(m.h, k, c.since) || isEndpointJump(m.h, k, to))) return "reporting-jump";
  return null;
}

/** Ascending-sorted median (linear interpolation, as trend panels). */
function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const pos = (s.length - 1) / 2;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
}

/** Display rounding: shares to 4 decimals, counts and dollars to whole numbers; the change to 4 decimals. */
function rounded(def: MoverListDef, c: MoverChange): MoverChange {
  const v = (x: number) => (def.change === "points" ? r4(x) : Math.round(x) || 0);
  return { since: c.since, from: v(c.from), to: v(c.to), change: r4(c.change) };
}

/**
 * Ranks one list over `members` (every college, or a state's or conference's) for one window. Colleges are ranked by
 * the raw change in the list's direction; only those that moved that way are listed. `keep` entries (plus ties with
 * the last) are returned. Deterministic: ties order by unit ID.
 */
export function computeMovers(members: readonly MoverMember[], def: MoverListDef, window: MoverWindow, ctx: MoverContext, keep = MOVERS_KEPT): MoverResult {
  const [from, to] = moverYears(def, window, ctx.latest);
  const excluded: Partial<Record<MoverExclusion, number>> = {};
  const ranked: { m: MoverMember; c: MoverChange }[] = [];
  for (const m of members) {
    if (def.types && !def.types.includes(m.school.type)) continue;
    const c = moverChange(def, m.h, [from, to], ctx.cpi);
    if (!c || !meetsFloors(def, m.h, c.since, to)) continue;
    const why = moverExclusion(def, m, c, ctx, to);
    if (why) {
      excluded[why] = (excluded[why] ?? 0) + 1;
      continue;
    }
    ranked.push({ m, c });
  }
  const sign = def.direction === "up" ? 1 : -1;
  // Ranked on the change at stored precision (4 decimals), so float noise in a difference of two stored shares
  // (0.5598 − 0.9353 vs 0.4592 − 0.8347) can't split a tie.
  const moved = ranked
    .map(({ m, c }) => ({ m, c, key: r4(c.change) }))
    .filter(({ key }) => sign * key > 0)
    .sort((a, b) => sign * (b.key - a.key) || (a.m.school.unit_id < b.m.school.unit_id ? -1 : 1));
  const entries: MoverEntry[] = [];
  for (let i = 0; i < moved.length; i++) {
    const rank = i > 0 && moved[i].key === moved[i - 1].key ? entries[i - 1].rank : i + 1;
    if (rank > keep) break;
    const { m, c } = moved[i];
    entries.push({ unit_id: m.school.unit_id, name: m.school.name, rank, ...rounded(def, c) });
  }
  const order = Object.fromEntries(MOVER_EXCLUSIONS.map((e) => [e, excluded[e]]).filter(([, v]) => v));
  const med = median(ranked.map(({ c }) => c.change));
  return { key: def.key, from, to, kind: def.kind, floors: def.floors, n: ranked.length, median: med === null ? null : r4(med), excluded: order, entries };
}

/** The entries a page shows first: ranks up to `shown` (so a tie at the tenth rank shows every tied college). */
export const shownEntries = (entries: readonly MoverEntry[], shown = MOVERS_SHOWN) => entries.filter((e) => e.rank <= shown);

/* ---- Display (the page and the /trends entry share these) ---- */

const signed = (v: number, text: string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${text}`;

/** Rule 5's precision: one decimal for percent changes ("+710.5%"), whole points for rates ("−46 pts"). */
export function formatMoverChange(def: Pick<MoverListDef, "change">, change: number): string {
  if (def.change === "points") return signed(Math.round(change * 100), `${Math.abs(Math.round(change * 100))} pts`);
  return signed(change, `${Math.abs(change * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
}

/** One end's value: a count, dollars, a rate (whole percent), or the Pell gap (points). */
export function formatMoverValue(def: Pick<MoverListDef, "key" | "series">, v: number): string {
  if (def.key === "pell-gap-closed") return `${v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))} pts`;
  const k = def.series[0];
  if (k === "avg_paid_all") return `$${Math.round(v).toLocaleString("en-US")}`;
  if (k === "applicants" || k === "undergrads") return Math.round(v).toLocaleString("en-US");
  return `${Math.round(v * 100)}%`;
}

/** Why colleges were left out, as the method note says it. */
export const EXCLUSION_LABELS: Record<MoverExclusion, string> = {
  "closed-or-merged": "closed, merged, or reorganized campuses",
  "under-300": "colleges under 300 undergraduates today",
  "for-profit": "for-profit colleges",
  "online-first": "online-first colleges",
  "reporting-jump": "figures that jumped more than threefold in a year at either end",
};

/** Every history series a list reads (measure, floors, the jump check, and today's undergraduates), for citations. */
export function moverSeries(def: MoverListDef): SeriesKey[] {
  const floors = def.floors.flatMap((f) => (f.series === "entering_class" ? [...ENTERING_CLASS_SERIES] : [f.series]));
  return [...new Set<SeriesKey>([...def.series, ...floors, ...def.jumpKeys, "undergrads"])];
}

/** "See all in Explore" for a list (the ten-year sort, same floors), or null when Explore has no such sort. */
export function moverExploreHref(def: MoverListDef, extra: Record<string, string> = {}): string | null {
  if (!def.explore) return null;
  const q = new URLSearchParams({ sortBy: def.explore.sortBy, sortDir: def.explore.sortDir, view: "table", ...(def.explore.params ?? {}), ...extra });
  return `/explore?${q.toString()}`;
}
