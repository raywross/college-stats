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
/* Study: the price gap (price-gap.json)                               */
/* ------------------------------------------------------------------ */

export interface PriceGapValues {
  /** Panel median's change in full price, after inflation (the same median-of-year method as facts.priceGap). */
  fullPriceChange: number;
  avgPaidChange: number;
  /** Median college's discount (1 − average paid ÷ full price), then and now. */
  discount: ThenNow;
  /** Median college's average total cost `to`, in `to`-year dollars (same-year, so no deflation needed). */
  paidNow: number;
  /** Median college's share of first-years with a grant, then and now. */
  grantPct: ThenNow;
  /** Median college's average grant, after inflation, then and now (`to`-year dollars). */
  grantAvg: ThenNow;
  /** Median net price by family income band ($0–30K … $110K+), after inflation, then and now. */
  netPriceByBand: ThenNow[];
  /** Yearly lines from `from` to `to` (the file's `lineFrom` equals `from`: both indexed to 100 there). */
  lines: {
    fullPriceIndex: (number | null)[];
    avgPaidIndex: (number | null)[];
    /** Median per-college discount, each year. */
    discount: (number | null)[];
  };
}

/** One college whose full price fell at least `resetThreshold` after inflation in a single year. */
export interface PriceGapReset {
  unitId: string;
  name: string;
  /** The year full price fell: `year` to `year + 1`. */
  year: number;
  /** The drop, after inflation (negative, e.g. −0.12). */
  drop: number;
}

export interface PriceGapFile extends StudyFile<PriceGapValues> {
  slug: "price-gap";
  /** A college counts as a "tuition reset" when a single year's drop is at or below this (−0.10 = 10%). */
  resetThreshold: number;
  /** Panel colleges with a reset, biggest drop first (capped). */
  resets: PriceGapReset[];
}

/* ------------------------------------------------------------------ */
/* Every file, by name (one line per unit)                             */
/* ------------------------------------------------------------------ */

export interface TrendFiles {
  index: TrendIndex;
  "men-and-women": MenAndWomenFile;
  "price-gap": PriceGapFile;
}

export type TrendFileName = keyof TrendFiles;
