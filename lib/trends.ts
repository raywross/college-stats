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
    /** Growth lists leave out colleges where more than this share of undergraduates took every course online at either end of the window (its start or its last fall). */
    onlineFirstShare: number;
    /** Entries in data/trends/excluded-campuses.json. */
    excludedCampuses: number;
  };
  windows: MoversWindow[];
}

/* ------------------------------------------------------------------ */
/* Trends by athletic conference (conferences.json)                    */
/* specs/trends/conferences.md                                         */
/* ------------------------------------------------------------------ */

/** The measures a conference page draws over time (one at a time). */
export type ConferenceMeasureKey = "applicants" | "acceptance_rate" | "undergrads" | "avg_paid_all" | "out_of_state_share";
/** The at-a-glance strip: the over-time measures plus graduation and Pell share. */
export type ConferenceGlanceKey = ConferenceMeasureKey | "grad_rate" | "pell";
/** "today": today's members in every year (default); "atTheTime": whoever was a member that year. */
export type MembershipRule = "today" | "atTheTime";

/** One over-time measure's years and the national context line (shared by every conference). */
export interface ConferenceMeasureMeta {
  key: ConferenceMeasureKey;
  kind: YearKind;
  /** Ten years back from history's newest year of this kind. */
  from: number;
  to: number;
  /** 2 for residence (even falls only); lines connect across the off years. */
  cadence: number;
  /** Money in this school year's dollars (CPI-U); absent for non-money measures. */
  dollarsOf?: number;
  /** Every college's median each year (data/history/national.json), same dollars. */
  national: (number | null)[];
}

/** An at-a-glance measure's year, kind, and the national median that year. */
export interface ConferenceGlanceMeta {
  key: ConferenceGlanceKey;
  /** History year (history measures); for "pell", null: today's snapshot, cited through lineage. */
  year: number | null;
  kind: YearKind | null;
  national: number | null;
}

/** A conference's value of one at-a-glance measure: median member, range, members reporting. */
export interface ConferenceGlance {
  median: number;
  min: number;
  max: number;
  n: number;
}

/** A conference's join or departure (from lib/events.ts conferenceMoves). */
export interface ConferenceMove {
  year: number;
  unit_id: string;
  /** The conference it came from (joined) or went to (left). */
  other: number;
  joined: boolean;
  /** Football alone moved. */
  football: boolean;
}

export interface ConferenceRow {
  code: number;
  name: string;
  slug: string;
  level: string;
  /** Today's members on the site (main conference = this code), by unit ID. */
  members: string[];
  /** Football-only conference (Pioneer, …): no college lists it as its main conference; `footballMembers` play football in it. */
  footballOnly?: true;
  footballMembers?: string[];
  /** Under the 8-member floor (or football only): listed without medians. */
  tooFew?: true;
  /** Members that joined after the conference series' first year: unit ID → the school year they joined. */
  joined: Record<string, number>;
  /** Members whose football conference differs: unit ID → its code. */
  football: Record<string, number>;
  /** Joins and departures since the series' first year, newest first. */
  moves: ConferenceMove[];
  /** At or over the floor only. */
  lines?: Record<ConferenceMeasureKey, Record<MembershipRule, (number | null)[]>>;
  /**
   * Today's members, from → to of each measure: counts and money are the median member's own % change (money after
   * inflation); rates are the median then and now. Null when under 80% of members report both years.
   */
  change?: {
    applicants: number | null;
    undergrads: number | null;
    avg_paid_all: number | null;
    acceptance_rate: ThenNow | null;
    out_of_state_share: ThenNow | null;
  };
  /** Sums over the members reporting both ends of the window (spec rule 2: totals, labeled, for these two only). */
  totals?: Record<"applicants" | "undergrads", { then: number; now: number; n: number } | null>;
  glance?: Partial<Record<ConferenceGlanceKey, ConferenceGlance>>;
  /** Each member's at-a-glance values in the file's `glance` order, null where not reported (the "members compared" bars). */
  values?: Record<string, (number | null)[]>;
}

export interface ConferencesFile extends TrendEnvelope {
  name: "conferences";
  /** Members needed for medians. */
  floor: number;
  /** Share of members that must report a year for its median to be shown. */
  coverage: number;
  /** The conference series' years (school years): membership "at the time" exists for these only. */
  membership: { from: number; to: number };
  measures: ConferenceMeasureMeta[];
  glance: ConferenceGlanceMeta[];
  /** Every league with a member on the site today, plus football-only leagues, ordered by level then name. */
  conferences: ConferenceRow[];
  /** Independents, ECAC, "Other": not leagues (spec rule 5). */
  unaffiliated: { code: number; name: string; members: number }[];
  /** Conference moves per school year, every college on the site (main conference only). */
  movesPerYear: { year: number; moves: number }[];
}

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

/* Study 2: test-optional (test-optional.json)                         */
/* ------------------------------------------------------------------ */

export interface TestOptionalValues {
  /** Share of colleges requiring the SAT or ACT, then (fall 2019) and now. */
  required: ThenNow;
  /** Median college's share of enrolled first-years submitting an SAT, then and now. */
  satSubmitMedian: ThenNow;
  /** Median college's ACT submission share, then and now (the Midwest's ACT pattern). */
  actSubmitMedian: ThenNow;
  /** Yearly lines from the file's `lineFrom` to `to` (null where under 90% of the group reported). */
  lines: {
    required: (number | null)[];
    /** Share test-blind ("not considered"); only from `blindFrom` on (TEST_BLIND_FROM), null before. */
    blind: (number | null)[];
    satSubmitMedian: (number | null)[];
    actSubmitMedian: (number | null)[];
  };
}

/** One policy group's published SAT range, then and now. Under the floor (or the "went back" group): no values. */
export interface ScoreRangeRow {
  key: "required-both" | "dropped" | "optional-both";
  label: string;
  n: number;
  tooFew?: true;
  p25?: ThenNow;
  p75?: ThenNow;
}

export interface TestOptionalFile extends StudyFile<TestOptionalValues> {
  slug: "test-optional";
  /** Fall colleges' policy stopped meaning "not required or recommended" and started meaning "not considered". */
  blindFrom: number;
  /** Students view: SAT submission share averaged with each college's enrolled first-years as the weight. */
  weightedSatSubmit: ThenNow;
  /** The dumbbell: published SAT 25th/75th percentile, fall 2019 → newest, per policy group. */
  scoreRanges: ScoreRangeRow[];
  /** Colleges that required tests again by the newest fall after being optional or blind in fall 2022. */
  wentBackToRequiring: { id: string; name: string; policyNow: string }[];
}

/* ------------------------------------------------------------------ */
/* Study 7: where the students went (where-students-go.json)           */
/* specs/trends/where-students-go.md                                   */
/* ------------------------------------------------------------------ */

/** The three periods inside the ten-year window: before the pandemic, the pandemic (to the low point), and after. */
export type StudentsPeriodKey = "before" | "pandemic" | "after";

/** One group's change over one period (falls `from` → `to`). */
export interface StudentsPeriod {
  key: StudentsPeriodKey;
  from: number;
  to: number;
  /** Total undergraduates' % change over the period, colleges reporting both falls. */
  studentsChange: number;
  /** Change in the group's share of all campus-based undergraduates, in percentage points per year: (share at `to` − share at `from`) × 100 ÷ (`to` − `from`). */
  pacePerYear: number;
  /** Median college's % change in undergraduates over the period. */
  medianChange: number;
  /** Share of the group's colleges that grew at all over the period. */
  grewShare: number;
}

/** One group's (or the nation's) measures, students view: its share of the campus-based panel's undergraduates. */
export interface WhereStudentsGoValues {
  /** Share of all campus-based undergraduates in the panel, then and now. */
  share: ThenNow;
  /** Now − then, in share units (0.042 = 4.2 points). */
  points: number;
  /** Total undergraduates' % change in the group. */
  totalChange: number;
  /** Median college's % change. */
  medianChange: number;
  /** Share of the group's colleges that grew at all. */
  grewShare: number;
  n: number;
  /** Yearly share of all campus-based undergraduates, `lineFrom` to `to` (null under 90% coverage). */
  line: (number | null)[];
  periods: StudentsPeriod[];
  /** Share of the group's colleges at or above their `prePandemicFall` size in the newest fall. */
  backToPrePandemic: number;
}

/** A kind of college in the whole 300-floor panel (the by-kind bar): campus-based, online-first, for-profit, merged or split. */
export interface StudentsKindRow {
  key: "campus-based" | "online-first" | "for-profit" | "merged-or-split";
  label: string;
  n: number;
  /** Share of the whole panel's undergraduates, then and now. */
  share: ThenNow;
  totalChange: number;
}

/** One state's share of campus-based undergraduates (today's state), at or over STATE_FLOOR panel colleges. */
export interface StudentsStateRow {
  postal: string;
  share: ThenNow;
  points: number;
  totalChange: number;
  n: number;
}

/** One fifth of colleges, ordered by real price change (`byChange`, share units) or by price level (`byLevel`, dollars). */
export interface PriceFifth {
  /** The fifth's range of the ordering measure: % change after inflation, or `fromMoney` price in `toMoney` dollars. */
  lo: number;
  hi: number;
  /** Median college's % change in undergraduates (fall `from` → `to`). */
  medianChange: number;
  /** Total undergraduates' % change. */
  totalChange: number;
  grewShare: number;
  n: number;
}

export type PriceControl = "all" | "public" | "private-nonprofit";

export interface WhereStudentsGoFile extends StudyFile<WhereStudentsGoValues> {
  slug: "where-students-go";
  /** Undergraduates a college needs in both falls (Study 3's floor). */
  minUndergrads: number;
  /** Colleges in the whole 300-floor panel, before the campus-based cut. */
  allN: number;
  /** The last fall before the pandemic (scripts/history/build.mts PRE_PANDEMIC_FALL): the before/pandemic boundary. */
  prePandemicFall: number;
  /** The fall after it with the smallest campus-based total (over falls clearing 90% coverage): the pandemic/after boundary. */
  lowFall: number;
  /** The campus-based panel's totals by fall (`lineFrom` → `to`) and each fall against `prePandemicFall` (0.01 = 1% above). */
  campusBased: { n: number; totalByFall: (number | null)[]; indexToPrePandemic: (number | null)[] };
  /** The whole panel, by kind: why the rest of the page is campus-based. */
  byKind: StudentsKindRow[];
  /** Share of campus-based undergraduates at the 50 and 100 biggest campuses, re-ranked each fall. */
  concentration: { top50: (number | null)[]; top100: (number | null)[] };
  /** The method note's comparison: the 20,000+ share with today's classification instead of the window start's. */
  todayClassified: { xlShare: ThenNow };
  /** States with at least `stateFloor` campus-based panel colleges (today's state). */
  stateFloor: number;
  states: StudentsStateRow[];
  /** Share of all applications at the period boundaries that clear 90% coverage, over colleges reporting in every one of those falls. */
  applications: {
    falls: number[];
    n: number;
    byGrouping: { grouping: GroupingKey; groups: { key: string; label: string; n: number; shares: number[] }[] }[];
  };
  /**
   * Price moved with enrollment: average cost paid (`avg_paid_all`, academic years `fromMoney` → `toMoney`, one behind
   * the falls, in `toMoney` dollars) against the fall `from` → `to` change in undergraduates.
   */
  cost: {
    fromMoney: number;
    toMoney: number;
    /** Campus-based colleges reporting average cost paid in both academic years. */
    n: number;
    byChange: { control: PriceControl; fifths: PriceFifth[] }[];
    byLevel: { control: PriceControl; fifths: PriceFifth[] }[];
    /** Spearman rank correlation of real price change and enrollment change, over the decade and within each period (price years one behind the falls), with the median college's real price change. */
    correlations: { period: "decade" | StudentsPeriodKey; control: PriceControl; rho: number; medianPriceChange: number; n: number }[];
    /** Students view: enrollment-weighted average paid each academic year `fromMoney` → `toMoney`, in `toMoney` dollars, over the `n` colleges (null under 90% coverage). */
    students: { control: Exclude<PriceControl, "all">; line: (number | null)[] }[];
  };
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
  conferences: ConferencesFile;
  states: StatesFile;
  "pell-gap": PellGapFile;
  "price-gap": PriceGapFile;
  "test-optional": TestOptionalFile;
  "where-students-go": WhereStudentsGoFile;
}

export type TrendFileName = keyof TrendFiles;
