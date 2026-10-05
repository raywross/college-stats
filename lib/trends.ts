/**
 * Shapes of the national trend files (specs/national-trends.md): `npm run build-trends` writes one JSON file per unit
 * to data/history/trends/, and pages read them with `getTrendFile(name)` (lib/data.ts). Types only.
 *
 * Every file shares the envelope (`TrendEnvelope`): the years it compares, their kind, and the panel size, so pages
 * print years and panel sizes from data, never from copy. Groups under their floor carry `n` and `tooFew: true` and no
 * values.
 *
 * Adding a unit: add its file interface in its own section below and ONE line to `TrendFiles`.
 */
import type { FormatKind } from "./format";
import type { YearKind } from "./history";
import type { GroupingKey } from "./trend-groups";
import type { MoverResult, MoverWindow } from "./movers";

/* ------------------------------------------------------------------ */
/* Shared envelope                                                     */
/* ------------------------------------------------------------------ */

export interface TrendEnvelope {
  /** The file's name in data/history/trends/ without `.json` (a study's slug, "movers", …). */
  name: string;
  /** data/history/meta.json `built` of the history the file was computed from (so a rebuild is byte-identical). */
  built: string;
  /** How `from` and `to` read: "Fall 2024", "2023–24", "Entered fall 2018" (`historyYearLabel`). */
  yearKind: YearKind;
  /** The window's ends ("then" and "now"). */
  from: number;
  to: number;
  /** Colleges in the national fixed panel. */
  n: number;
}

/** A measure at the window's two ends. */
export type ThenNow = [then: number, now: number];

/** One group's result. Under the floor: `tooFew` and no `values` ("too few colleges to say"). */
export interface GroupRow<V> {
  key: string;
  label: string;
  /** Panel colleges in the group. */
  n: number;
  tooFew?: true;
  values?: V;
}

/** One grouping's groups, in display order. */
export interface GroupingResult<V> {
  grouping: GroupingKey;
  label: string;
  floor: number;
  groups: GroupRow<V>[];
}

/**
 * The common shape of a study file: the national row (key "all") and the same values per group for each grouping the
 * study offers. `lineFrom` is where the yearly lines in `V` start (they end at `to`); it can be earlier than `from`.
 */
export interface StudyFile<V> extends TrendEnvelope {
  slug: string;
  lineFrom: number;
  national: GroupRow<V>;
  groupings: GroupingResult<V>[];
}

/* ------------------------------------------------------------------ */
/* index.json: the /trends cards                                       */
/* ------------------------------------------------------------------ */

export interface TrendCard {
  slug: string;
  title: string;
  /** The big number and what it is ("of colleges admit women at a notably higher rate"). */
  headline: { value: number; format: FormatKind; caption: string };
  /** One hand-written sentence with its numbers templated from the study file. */
  sentence: string;
  spark: { start: number; kind: YearKind; format: FormatKind; series: { name: string; values: (number | null)[] }[] };
  yearKind: YearKind;
  from: number;
  to: number;
  n: number;
}

export interface TrendIndex {
  built: string;
  /** Study cards, in registry order (the page sorts newest first). */
  cards: TrendCard[];
  /** Every file the build wrote besides index.json (sorted), so /trends knows which sections exist. */
  files: string[];
}

/* ------------------------------------------------------------------ */
/* Study 1: men and women in admissions (men-and-women.json)           */
/* ------------------------------------------------------------------ */

export interface MenAndWomenValues {
  /** Share of colleges admitting men at a rate 3+ points higher than women, then and now. */
  menHigher: ThenNow;
  /** Share admitting women 3+ points higher. */
  womenHigher: ThenNow;
  /** Median college's gap, men's rate minus women's (share units: −0.023 = −2.3 points). */
  medianGap: ThenNow;
  /** Students view: men's and women's rates averaged with each college's total applicants as the weight. */
  weightedMen: ThenNow;
  weightedWomen: ThenNow;
  /** Yearly lines from the file's `lineFrom` to `to` (null where under 90% of the group reported). */
  lines: {
    menHigher: (number | null)[];
    womenHigher: (number | null)[];
    medianGap: (number | null)[];
    /** Applicant-weighted men's minus women's rate. */
    weightedGap: (number | null)[];
  };
}

export interface MenAndWomenFile extends StudyFile<MenAndWomenValues> {
  slug: "men-and-women";
  /** "Notably higher": a gap of at least this much (0.03 = 3 points), the profile's bar. */
  threshold: number;
  /** Total applicants a college needs at both ends to join the panel. */
  minApplicants: number;
}

/* ------------------------------------------------------------------ */
/* Study 3: shrinking colleges (shrinking-colleges.json)                */
/* ------------------------------------------------------------------ */

/** One group's (or the nation's) measures over a window, colleges in the panel. */
export interface ShrinkingValues {
  /** Share of panel colleges whose undergraduates fell 10% or more over the window. */
  shrank10: number;
  /** Share whose undergraduates grew 10% or more. */
  grew10: number;
  /** Median college's % change in undergraduates over the window (−0.10 = −10%). */
  medianChange: number;
  /** Total undergraduates' % change over the window, summed across the group (the "students" view). */
  totalChange: number;
}

/** One window's (ten- or five-year) results: the window's ends, panel size, and the measures. */
export interface ShrinkingWindow {
  from: number;
  to: number;
  n: number;
  national: GroupRow<ShrinkingValues>;
  groupings: GroupingResult<ShrinkingValues>[];
}

/** data/history/trends/shrinking-colleges.json: the ten-year window is the primary StudyFile; `five` is the owner-recommended second window (the segmented control on the page). */
export interface ShrinkingCollegesFile extends StudyFile<ShrinkingValues> {
  slug: "shrinking-colleges";
  /** Colleges needed on both ends of a window to join its panel. */
  minUndergrads: number;
  /** The 10 percentage points that define "shrank" / "grew". */
  threshold: number;
  /** The five-year window (fall `to − 5` to `to`), same shape as the primary ten-year window. */
  five: ShrinkingWindow;
  /** National: share of the ten-year panel smaller than at the window's start, each fall from `from` to `to` (the headline sparkline). */
  belowStart: (number | null)[];
  /** National: ten-year % change across the panel, as a histogram (10-point bins), with the median marked. */
  histogram: { binSize: number; min: number; max: number; counts: number[]; median: number; n: number };
  /** Companion: median applicants and enrolled first-years, by fall, over the colleges that shrank 10%+ (a sub-panel of the ten-year panel). */
  companion: { from: number; to: number; n: number; applicants: (number | null)[]; enrolled: (number | null)[] };
}

/* ------------------------------------------------------------------ */
/* Biggest movers (movers.json; specs/trends/top-10-lists.md)          */
/* ------------------------------------------------------------------ */

/** Every list for one window (10 or 5 years back from each list's newest year). */
export interface MoversWindow {
  years: MoverWindow;
  lists: MoverResult[];
}

/**
 * The envelope's `from`/`to` are the ten-year fall window and `n` the colleges considered; each list carries its own
 * years and kind (cost lists are school years, graduation lists entering classes).
 */
export interface MoversFile extends TrendEnvelope {
  name: "movers";
  /** Entries shown before "Show 25", and kept per list (plus ties). */
  shown: number;
  kept: number;
  rules: {
    /** Every list leaves out colleges under this many undergraduates in the newest fall. */
    stillOpenMinUndergrads: number;
    /** An endpoint this many times the year next to it is a reporting jump. */
    jumpFactor: number;
    /** Entries in data/trends/online-first.json and data/trends/excluded-campuses.json. */
    onlineFirst: number;
    excludedCampuses: number;
  };
  windows: MoversWindow[];
}

/* ------------------------------------------------------------------ */
/* Study 6: the Pell graduation gap (pell-gap.json)                     */
/* ------------------------------------------------------------------ */

export interface PellGapValues {
  /** Median Pell recipients' 6-year graduation rate, then and now. */
  pellRate: ThenNow;
  /** Median rate for students with neither a Pell Grant nor a subsidized loan. */
  neitherRate: ThenNow;
  /** Median gap (share units), neither's rate minus Pell's. */
  gap: ThenNow;
  /** Share of colleges where the gap is 10 or more points. */
  gap10Share: ThenNow;
  /** The "students" view: each rate summed (graduates ÷ cohort) across the group, not averaged per college. */
  weightedPellRate: ThenNow;
  weightedNeitherRate: ThenNow;
  weightedGap: ThenNow;
  /** Median overall graduation rate (all students), same panel, as context. */
  overallRate: ThenNow;
  /** Yearly lines by entering class, from the file's `lineFrom` to `to` (null where under 90% of the group reported). */
  lines: {
    pellRate: (number | null)[];
    neitherRate: (number | null)[];
    gap: (number | null)[];
    weightedGap: (number | null)[];
    overallRate: (number | null)[];
  };
}

/** One group's 8-year outcome-measures figures for the newest entering class (its own, separate year). */
export interface PellGapOm8Row {
  key: string;
  label: string;
  n: number;
  tooFew?: true;
  pell?: number | null;
  nonPell?: number | null;
}

export interface PellGapFile extends StudyFile<PellGapValues> {
  slug: "pell-gap";
  /** Students a college needs in BOTH the Pell and "neither" groups, in both years, to join the panel. */
  minCohort: number;
  /** "10 or more points," the bar for `gap10Share` (0.10 in share units). */
  gapThreshold: number;
  /** The 8-year outcome-measures companion (specs/trends/pell-gap.md "Eight years, everyone"): a different measure,
   * for the newest entering class the Outcome Measures survey covers (often earlier than `to`), with its own year. */
  om8: {
    year: number;
    national: PellGapOm8Row;
    byControl: PellGapOm8Row[];
  };
}

/* ------------------------------------------------------------------ */
/* Every file, by name (one line per unit)                             */
/* ------------------------------------------------------------------ */

export interface TrendFiles {
  index: TrendIndex;
  "men-and-women": MenAndWomenFile;
  "shrinking-colleges": ShrinkingCollegesFile;
  movers: MoversFile;
  "pell-gap": PellGapFile;
}

export type TrendFileName = keyof TrendFiles;
