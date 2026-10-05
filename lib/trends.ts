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
/* Study 5: public colleges and out-of-state students (out-of-state.json) */
/* ------------------------------------------------------------------ */

export interface OutOfStateValues {
  /** Median public's out-of-state share of first-years, then and now. */
  medianShare: ThenNow;
  /** Share of public colleges 30%+ out-of-state, then and now. */
  share30: ThenNow;
  /** Students view: out-of-state share averaged with each college's first-years as the weight. */
  weightedShare: ThenNow;
  /** Yearly lines from the file's `lineFrom` to `to`, even years only (odd years null: `seriesStep`). */
  lines: {
    medianShare: (number | null)[];
    share30: (number | null)[];
    weightedShare: (number | null)[];
  };
}

export interface OutOfStateFile extends StudyFile<OutOfStateValues> {
  slug: "out-of-state";
  /** Public colleges need this many enrolled first-years in the window's first fall to join the panel. */
  minEnrolled: number;
  /** "30%+ out-of-state" bar. */
  threshold: number;
  /** Context, not a fixed panel: private nonprofits' median out-of-state share, as a line (even years) and then/now. */
  private: {
    median: ThenNow;
    line: (number | null)[];
  };
  /** Companion: the panel's median international share of first-years, then and now. */
  internationalMedian: ThenNow;
  /**
   * The out-of-state premium: median public's full-price gap (out-of-state minus in-state), after inflation. Prices
   * are an academic-year series (`lib/history.ts` kind "academic") and lag the fall residence data by a year, so this
   * has its own `from`/`to` (both in `to`-year dollars via `real()`).
   */
  premium: {
    from: number;
    to: number;
    lineFrom: number;
    /** Median premium each academic year, in `to`-year dollars; null under 90% coverage. */
    line: (number | null)[];
    /** Then/now median premium, in `to`-year dollars. */
    median: ThenNow;
    /** Share of publics where the premium (in `to`-year dollars) exceeds $20,000, then and now. */
    over20k: ThenNow;
  };
  /** Where out-of-state first-years at public colleges come from, summed from `detail.residence` in the newest even fall. */
  sendingStates: {
    year: number;
    /** USPS code → out-of-state first-years from that state, across public colleges reporting the detail table. */
    totals: Record<string, number>;
    /** Public colleges summed (not the fixed panel: every public college with a home-states detail table). */
    n: number;
  };
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
/* Trends by state (states.json; specs/trends/states.md)               */
/* ------------------------------------------------------------------ */

/** One state's measures over the window, over its fixed panel (or a group within it). */
export interface StateMeasures {
  /** Median college's % change in undergraduates. */
  undergradsMedianChange: number;
  /** Total undergraduates at each end of the panel. */
  undergradsTotal: ThenNow;
  /** Total undergraduates' % change ("students" view). */
  undergradsTotalChange: number;
  /** Median college's % change in applicants. */
  applicantsMedianChange: number;
  /** Median college's points change in acceptance rate. */
  acceptanceRateMedianChange: number;
  /** Median college's % change in average total cost, after inflation. */
  avgPaidMedianChange: number;
}

/**
 * Yearly medians from a state's (or the nation's) reporting colleges, for a stat tile's sparkline.
 * `undergrads`/`applicants`/`acceptanceRate` span the file's `from` to `to` (fall); `avgPaid` is an academic-year
 * series one year behind fall, so it spans `fromMoney` to `toMoney` instead (same length, different years).
 */
export interface StateSparkLines {
  undergrads: (number | null)[];
  applicants: (number | null)[];
  acceptanceRate: (number | null)[];
  avgPaid: (number | null)[];
}

export interface StateOutOfStateSide {
  n: number;
  /** Even-year median out-of-state share, `lineFrom` to `to`. */
  line: (number | null)[];
  thenNow: ThenNow;
}

export interface StateOutOfState {
  from: number;
  to: number;
  lineFrom: number;
  public: StateOutOfStateSide | null;
  privateNonprofit: StateOutOfStateSide | null;
}

/** A top sending state to this state's colleges, aggregated from the residence detail. */
export interface StateTopSendingState {
  state: string;
  count: number;
  share: number;
}

export interface StateResearchUni {
  unit_id: string;
  name: string;
  tier: "R1" | "R2";
  from: number;
  to: number;
  /** % change in undergraduates over the window; null when either end isn't reported. */
  change: number | null;
}

/** The index map's measure choices (specs/trends/states.md): null when the state is under the floor. */
export interface StateMapMeasures {
  undergradChange: number | null;
  acceptanceRate: number | null;
  avgCost: number | null;
  outOfState: number | null;
  testOptionalShare: number | null;
}

export interface StateEntry {
  postal: string;
  name: string;
  territory: boolean;
  /** Colleges on the site, by control (regardless of the panel). */
  onSite: { total: number; public: number; privateNonprofit: number; privateForprofit: number };
  /** Every on-site college, name order (the member list a tooFew state's page shows). */
  members: { unit_id: string; name: string }[];
  /** The fixed panel (300+ undergraduates both ends, as Study 3's floor). */
  panel: { n: number; ids: string[] };
  /** Under STATE_FLOOR on-site colleges: every field below except `movers` is omitted. */
  tooFew?: true;
  map: StateMapMeasures;
  all?: GroupRow<StateMeasures>;
  control?: GroupingResult<StateMeasures>;
  sparkLines?: StateSparkLines;
  outOfState?: StateOutOfState;
  topSendingStates: StateTopSendingState[];
  researchUnis: StateResearchUni[];
  movers: MoversWindow[];
}

export interface StatesFile extends TrendEnvelope {
  name: "states";
  /** STATE_FLOOR: on-site colleges needed for a full page. */
  floor: number;
  lineFrom: number;
  /** The window `avgPaid` sparklines use instead of `from`/`to` (academic year, one behind fall's latest). */
  fromMoney: number;
  toMoney: number;
  /** National context lines, for every state page's "vs national" sparklines. */
  national: {
    sparkLines: StateSparkLines;
    outOfStatePublicLine: (number | null)[];
  };
  states: StateEntry[];
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
  "shrinking-colleges": ShrinkingCollegesFile;
  "out-of-state": OutOfStateFile;
  movers: MoversFile;
  states: StatesFile;
  "pell-gap": PellGapFile;
  "price-gap": PriceGapFile;
}

export type TrendFileName = keyof TrendFiles;
