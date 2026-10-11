/**
 * The compare overview's topic cards (specs/compare-redesign.md#overview-page): each card's title and footer, the rows
 * it compares (a bar per college, a middle-50% range per college on one shared axis, or a line of text per college),
 * the field whose year its eyebrow shows, and when a card or a row has nothing to show. Pure (runtime imports only from
 * other pure modules, by extension), so tests load it directly; components/compare/CompareTopicCards.tsx adds the
 * citations and layout, and lib/compare-insights.ts writes each card's sentence.
 */
import type { School } from "./types";
import type { FieldPath } from "./fields";
import type { TermKey } from "./glossary";
import type { TopicKey } from "./profile-topics";
import { METRICS, satTotal } from "./metrics.ts";
import { changeText, indicatorOf, type IndicatorKey } from "./indicators.ts";
import { sinceLabel } from "./profile-cards.ts";
import { readingSummary } from "./chances/reading.ts";
import { compact, moneyCompact, pct, pctSmart } from "./format.ts";

/** A card per profile topic; "All the numbers" has its own link card on the overview. */
export type CardTopic = TopicKey;

/** The card titles, in the mockup's voice: about the colleges side by side, not one college. */
export const CARD_TITLES: Record<CardTopic, string> = {
  admissions: "Who's hardest to get into",
  students: "Who's on each campus",
  academics: "Majors and faculty",
  cost: "What each costs",
  outcomes: "What each pays off",
  history: "How each has changed",
};

/** Footer link text: what the topic page holds beyond the card. */
export const CARD_FOOTERS: Record<CardTopic, string> = {
  admissions: "Applicants, yield, scores, and what each looks at",
  students: "Diversity, first-gen, where they're from, campus life",
  academics: "Top majors, your major's earnings, faculty, spending",
  cost: "Price by family income, grants, sticker prices",
  outcomes: "Debt, retention, 8-year outcomes, by group",
  history: "10-year direction and Then & now charts",
};

/** What a college without a figure shows: never a 0, never a blank. */
export const NOT_REPORTED = "Not reported";

interface RowBase {
  label: string;
  term: TermKey;
  /** The registered field the row shows, for its (i) citation (and the overview's source note). */
  field: FieldPath;
}

/** One bar per college in its slot color (CompareMetric `variant="row"`), the extreme flagged neutrally. */
export interface BarRow extends RowBase {
  kind: "bar";
  get: (s: School) => number | null;
  format: (v: number) => string;
  /** A fixed end for the bars (1 for shares); omitted, the bars run to the largest value. */
  max?: number;
  flag?: { which: "max" | "min"; text: string };
}

/** Each college's middle 50% as a range bar on one shared axis (`rangeAxis`). */
export interface RangeRow extends RowBase {
  kind: "range";
  get: (s: School) => readonly [number, number] | null;
  scale: "sat" | "act";
  /** What a college without the range shows ("Test-blind", "Not reported"). */
  fallback: (s: School) => string;
}

/** A line of text per college beside its slot-color dot, with an optional figure at the end of the line. */
export interface TextRow extends RowBase {
  kind: "text";
  /** The college's line ("Economics", "Growing"); null when it has none. */
  get: (s: School) => string | null;
  /** A short figure at the end of the line, where the bars' values sit ("13%", "+57%"). */
  value?: (s: School) => string | null;
  /** A muted note after the line ("since fall 2016"). */
  note?: (s: School) => string | null;
  /** Leads the line with this trend indicator's direction icon. */
  indicator?: IndicatorKey;
  /** Says what the figure is, on the label's line ("share of graduates"). */
  hint?: string;
  /** What a college without the line shows; "Not reported" by default. */
  fallback?: (s: School) => string;
}

export type CardRow = BarRow | RangeRow | TextRow;

/** "Test-blind" for a college that doesn't consider scores (so it has none to report), else "Not reported". */
export function scoreFallback(s: Pick<School, "admissions">): string {
  return s.admissions.test_policy === "not-considered" ? "Test-blind" : NOT_REPORTED;
}

/** The SAT total each college shows (`derived.sat_total`, as on its profile and the table). */
export const SAT_ROW: RangeRow = {
  kind: "range",
  label: "SAT middle 50%",
  term: "middle-50",
  field: "derived.sat_total",
  get: satTotal,
  scale: "sat",
  fallback: scoreFallback,
};

/** The Getting in card's score row when no compared college reports SAT scores. */
export const ACT_ROW: RangeRow = {
  kind: "range",
  label: "ACT middle 50%",
  term: "act",
  field: "admissions.act_composite_25_75",
  get: (s) => s.admissions.act_composite_25_75,
  scale: "act",
  fallback: scoreFallback,
};

/**
 * Applications over the ten-year window, from `school.trends` (the history build): the direction word and the signed
 * change (`indicatorOf`, which leaves out colleges with under 200 applicants at either end). `since` is the card's start
 * fall; a college whose history starts later says so.
 */
export function applicationsRow(since: number | null): TextRow {
  const of = (s: School) => indicatorOf(s, "applications");
  return {
    kind: "text",
    label: METRICS.applicantsChange.label,
    term: "trend-direction",
    field: "trends",
    indicator: "applications",
    get: (s) => {
      const i = of(s);
      return i ? i.def.words[i.direction] : null;
    },
    value: (s) => {
      const i = of(s);
      return i ? changeText(i) : null;
    },
    note: (s) => {
      const i = of(s);
      return i && since !== null && i.trend.since > since ? sinceLabel(i.trend.since, "fall") : null;
    },
    // A history too small to measure isn't the same as no history.
    fallback: (s) => (s.trends?.applicants ? "Not enough data" : NOT_REPORTED),
  };
}

/** The most popular major (the largest program by first-major bachelor's) and its share. */
const MAJOR_ROW: TextRow = {
  kind: "text",
  label: "Most popular major",
  term: "first-major",
  field: "academics.majors_top",
  get: (s) => s.academics?.majors_top?.[0]?.title ?? null,
  value: (s) => {
    const m = s.academics?.majors_top?.[0];
    return m ? pct(m.share) : null;
  },
  hint: "share of graduates",
};

/**
 * "How they read a record" (specs/chances/how-colleges-read.md): what the college says matters most, in a few words,
 * and the share of first-years at a 3.75 or higher (`derived.gpa_top_share`); a weighted reporter says so instead of a
 * share. The sentences are on the Getting in page; this is the glance.
 */
export const READING_ROW: TextRow = {
  kind: "text",
  label: "How they read a record",
  term: "gpa-crowding",
  field: "derived.gpa_top_share",
  get: (s) => {
    const r = readingSummary(s);
    return r ? (r.emphasis ?? (r.weighted ? "Weighted GPAs reported" : "Emphasis not reported")) : null;
  },
  value: (s) => {
    const r = readingSummary(s);
    return r?.topShare != null ? pct(r.topShare) : null;
  },
  note: (s) => {
    const r = readingSummary(s);
    return r?.weighted && r.emphasis ? "weighted GPAs" : null;
  },
  hint: "first-years at 3.75+",
};

/** Every card's rows, before `cardRows` fits them to the colleges compared. Same labels, terms, and bars as the topic pages. */
export const CARD_ROWS: Record<CardTopic, readonly CardRow[]> = {
  admissions: [
    { kind: "bar", label: "Acceptance rate", term: "acceptance-rate", field: "admissions.acceptance_rate", get: METRICS.acceptance.get, format: pctSmart, flag: { which: "min", text: "Most selective" } },
    SAT_ROW,
    READING_ROW,
  ],
  students: [
    { kind: "bar", label: "Undergrads", term: "undergrad-enrollment", field: "demographics.undergrad_enrollment", get: METRICS.enrollment.get, format: compact, flag: { which: "max", text: "Largest" } },
    { kind: "bar", label: "Pell Grant share", term: "pell-grant", field: "demographics.pell_grant_percent", get: METRICS.pell.get, format: (v) => pct(v), max: 1, flag: { which: "max", text: "Highest" } },
  ],
  academics: [
    { kind: "bar", label: "Students per faculty member", term: "student-faculty-ratio", field: "academics.student_faculty_ratio", get: METRICS.studentFaculty.get, format: METRICS.studentFaculty.format, flag: { which: "min", text: "Fewest" } },
    MAJOR_ROW,
  ],
  cost: [
    { kind: "bar", label: "Average cost, all students", term: "average-cost", field: "cost.avg_paid_all", get: METRICS.avgCost.get, format: moneyCompact, max: 80000, flag: { which: "min", text: "Lowest" } },
    { kind: "bar", label: "Aid generosity", term: "aid-generosity", field: "derived.aid_generosity", get: METRICS.aidGenerosity.get, format: (v) => pct(v), max: 1, flag: { which: "max", text: "Most" } },
  ],
  outcomes: [
    { kind: "bar", label: "Median earnings, 10 years", term: "median-earnings", field: "outcomes.median_earnings_10yr", get: METRICS.earnings.get, format: moneyCompact, flag: { which: "max", text: "Highest" } },
    { kind: "bar", label: "Graduation rate", term: "graduation-rate", field: "outcomes.graduation_rate", get: METRICS.gradRate.get, format: (v) => pct(v), max: 1, flag: { which: "max", text: "Highest" } },
  ],
  history: [applicationsRow(null)],
};

/**
 * Fields the cards show besides their rows': the test policy behind "Test-blind", and yield, which the Getting in
 * sentence names. Selectivity's direction (Over time's sentence) is `trends`, the history row's own field.
 */
export const CARD_EXTRA_FIELDS: readonly FieldPath[] = [
  "admissions.test_policy",
  "derived.yield",
  // The reading row's emphasis phrase (the college's C7 rating, else the federal factors) and a weighted reporter's average.
  "reported.admission_profile.factors.rigor",
  "admissions.factors",
  "reported.admission_profile.gpa.average",
];

/** Every field a card can show (each row, the ACT fallback, and CARD_EXTRA_FIELDS): the overview cites them all. */
export function cardFields(): FieldPath[] {
  return [...new Set([...Object.values(CARD_ROWS).flatMap((rows) => rows.map((r) => r.field)), ACT_ROW.field, ...CARD_EXTRA_FIELDS])];
}

/** The field whose release year the card's eyebrow names (dataset-wide, from lineage). Over time names its start fall instead. */
const YEAR_FIELDS: Record<CardTopic, FieldPath> = {
  admissions: "admissions.acceptance_rate",
  students: "demographics.undergrad_enrollment",
  academics: "academics.student_faculty_ratio",
  cost: "cost.avg_paid_all",
  outcomes: "outcomes.median_earnings_10yr",
  history: "trends",
};

export function cardYearField(topic: CardTopic): FieldPath {
  return YEAR_FIELDS[topic];
}

/** The first fall of the compared colleges' application trends (the Over time eyebrow's "since"), or null without any. */
export function applicationsSince(schools: readonly School[]): number | null {
  const starts = schools.flatMap((s) => {
    const i = indicatorOf(s, "applications");
    return i ? [i.trend.since] : [];
  });
  return starts.length ? Math.min(...starts) : null;
}

/** True when this college has the row's figure. */
export function hasValue(row: CardRow, s: School): boolean {
  return row.get(s) !== null;
}

/**
 * The rows a card shows for these colleges, or none when no compared college has any of its figures (the card is
 * hidden: owner assumption 8). The SAT row becomes the ACT row when no college reports SAT scores but one reports ACT;
 * a row no college reports drops out, except a score row while a college is test-blind (that is worth saying).
 */
export function cardRows(topic: CardTopic, schools: readonly School[]): CardRow[] {
  const rows = CARD_ROWS[topic].map((row): CardRow => {
    if (row === SAT_ROW && !schools.some((s) => hasValue(SAT_ROW, s)) && schools.some((s) => hasValue(ACT_ROW, s))) return ACT_ROW;
    if (topic === "history") return applicationsRow(applicationsSince(schools));
    return row;
  });
  if (!rows.some((row) => schools.some((s) => hasValue(row, s)))) return [];
  return rows.filter((row) => schools.some((s) => hasValue(row, s) || (row.kind === "range" && row.fallback(s) !== NOT_REPORTED)));
}

/**
 * The shared axis for a score row (ScoreCompare's rule): SAT from the hundred below the lowest 25th percentile less 60,
 * to 1600; ACT from four below it (never under 1), to 36. Null when no college has a range.
 */
export function rangeAxis(scale: RangeRow["scale"], ranges: readonly (readonly [number, number] | null)[]): [number, number] | null {
  const lows = ranges.flatMap((r) => (r ? [r[0]] : []));
  if (!lows.length) return null;
  const low = Math.min(...lows);
  return scale === "sat" ? [Math.floor((low - 60) / 100) * 100, 1600] : [Math.max(1, low - 4), 36];
}
