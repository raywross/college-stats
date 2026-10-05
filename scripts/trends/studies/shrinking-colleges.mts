/**
 * Study 3: shrinking colleges (specs/trends/shrinking-colleges.md).
 *
 * Panel: colleges with 300+ undergraduates in both the window's first and last fall (the diversity-change floor,
 * lib/history.ts DIVERSITY_MIN_UNDERGRADS — "a few students swing the shares" below it). Share of colleges, not
 * students, except the total-change ("students") view. A second, five-year window (owner assumption 5) gives the
 * page's segmented control the same shape without a second builder.
 */
import { DIVERSITY_MIN_UNDERGRADS, historyYearLabel } from "../../../lib/history.ts";
import { pct } from "../../../lib/format.ts";
import { at, byGroup, fixedPanel, medianBy, nationalRow, reporting, round4, shareBy, totalBy, yearly, type Member } from "../../../lib/trend-panel.ts";
import { studyBySlug, studyWindow, type StudyDef } from "../../../lib/trend-studies.ts";
import type { ShrinkingCollegesFile, ShrinkingValues, ShrinkingWindow } from "../../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "../context.mts";

const SLUG = "shrinking-colleges";
/** Colleges need this many undergrads at both ends of a window to join its panel (same bar as the diversity change). */
export const MIN_UNDERGRADS = DIVERSITY_MIN_UNDERGRADS;
/** "Shrank" / "grew": a change of this much or more, either way. */
export const THRESHOLD = 0.1;
/** The five-year window's length (owner assumption 1: the 10-year window isolated from the pandemic). */
export const FIVE_YEAR_WINDOW = 5;
/** Histogram bin width, in the same units as % change (10 points). */
const BIN_SIZE = 0.1;
const HIST_MIN = -0.6;
const HIST_MAX = 0.6;

/** A college's % change in undergraduates from `from` to `to`; null unless both are reported. */
export function pctChange(m: Member, from: number, to: number): number | null {
  const a = at(m, "undergrads", from);
  const b = at(m, "undergrads", to);
  return a === null || b === null || a === 0 ? null : round4((b - a) / a);
}

const inWindowPanel = (from: number, to: number) => (m: Member, year: number) =>
  (at(m, "undergrads", year) ?? 0) >= MIN_UNDERGRADS && [from, to].every((y) => (at(m, "undergrads", y) ?? 0) >= MIN_UNDERGRADS);

export function shrinkingPanel(members: readonly Member[], from: number, to: number): Member[] {
  return fixedPanel(members, [from, to], inWindowPanel(from, to));
}

/** One group's (or the nation's) measures over a window. */
export function values(ms: readonly Member[], from: number, to: number): ShrinkingValues {
  const change = (m: Member) => pctChange(m, from, to);
  return {
    shrank10: round4(shareBy(ms, (m) => (change(m) ?? 1) <= -THRESHOLD) ?? 0),
    grew10: round4(shareBy(ms, (m) => (change(m) ?? -1) >= THRESHOLD) ?? 0),
    medianChange: round4(medianBy(ms, change) ?? 0),
    totalChange: (() => {
      const thenTotal = totalBy(ms, (m) => at(m, "undergrads", from));
      const nowTotal = totalBy(ms, (m) => at(m, "undergrads", to));
      return thenTotal && nowTotal ? round4((nowTotal - thenTotal) / thenTotal) : 0;
    })(),
  };
}

function buildWindow(ctx: TrendContext, study: StudyDef, from: number, to: number): ShrinkingWindow {
  const panel = shrinkingPanel(ctx.members, from, to);
  const compute = (ms: Member[]) => values(ms, from, to);
  return {
    from,
    to,
    n: panel.length,
    national: nationalRow(panel, compute),
    groupings: study.groupings.map((g) => byGroup(panel, g, compute)),
  };
}

/** Histogram of the ten-year panel's % change, 10-point bins clamped to [HIST_MIN, HIST_MAX], with the median. */
function histogramOf(ms: readonly Member[], from: number, to: number) {
  const changes = ms.map((m) => pctChange(m, from, to)).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const binCount = Math.round((HIST_MAX - HIST_MIN) / BIN_SIZE);
  const counts = new Array(binCount).fill(0) as number[];
  for (const v of changes) {
    const i = Math.min(binCount - 1, Math.max(0, Math.floor((Math.min(HIST_MAX - 1e-9, Math.max(HIST_MIN, v)) - HIST_MIN) / BIN_SIZE)));
    counts[i]++;
  }
  const mid = (changes.length - 1) / 2;
  const median = changes.length ? (changes[Math.floor(mid)] + changes[Math.ceil(mid)]) / 2 : 0;
  return { binSize: BIN_SIZE, min: HIST_MIN, max: HIST_MAX, counts, median: round4(median), n: changes.length };
}

/** Companion: median applicants and enrolled first-years, by fall, over the colleges that shrank 10%+ in the ten-year window. */
function companionOf(panel: readonly Member[], from: number, to: number) {
  const shrunk = panel.filter((m) => (pctChange(m, from, to) ?? 0) <= -THRESHOLD);
  const line = (key: "applicants" | "enrolled") =>
    yearly(from, to, (y) => {
      const r = reporting(shrunk, (m) => at(m, key, y) !== null);
      return r ? round4(medianBy(r, (m) => at(m, key, y))!) : null;
    });
  return { from, to, n: shrunk.length, applicants: line("applicants"), enrolled: line("enrolled") };
}

export function buildShrinkingColleges(ctx: TrendContext): TrendOutput {
  const study = studyBySlug(SLUG)!;
  const [from, to] = studyWindow(study, ctx.hmeta.latest);
  const ten = buildWindow(ctx, study, from, to);
  const five = buildWindow(ctx, study, to - FIVE_YEAR_WINDOW, to);
  const tenPanel = shrinkingPanel(ctx.members, from, to);

  const belowStart = yearly(from, to, (y) => {
    const r = reporting(tenPanel, (m) => at(m, "undergrads", y) !== null);
    if (!r) return null;
    return round4(shareBy(r, (m) => (at(m, "undergrads", y) ?? Infinity) < at(m, "undergrads", from)!) ?? 0);
  });

  const file: ShrinkingCollegesFile = {
    name: SLUG,
    slug: SLUG,
    built: ctx.hmeta.built,
    yearKind: study.yearKind,
    from,
    to,
    n: ten.n,
    lineFrom: from,
    minUndergrads: MIN_UNDERGRADS,
    threshold: THRESHOLD,
    national: ten.national,
    groupings: ten.groupings,
    five,
    belowStart,
    histogram: histogramOf(tenPanel, from, to),
    companion: companionOf(tenPanel, from, to),
  };

  const v = file.national.values!;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  return {
    name: SLUG,
    file,
    card: {
      slug: SLUG,
      title: study.title,
      headline: { value: v.shrank10, format: "pct", caption: "of colleges have at least 10% fewer undergraduates than ten years ago" },
      sentence:
        `Across ${ten.n.toLocaleString("en-US")} colleges, ${pct(v.shrank10)} have at least 10% fewer undergraduates than in ${fall(from)}, ` +
        `while ${pct(v.grew10)} grew that much; the median college's undergraduate count ${v.medianChange < 0 ? "fell" : "rose"} ${pct(Math.abs(v.medianChange))}.`,
      spark: {
        start: from,
        kind: "fall",
        format: "pct",
        series: [{ name: "Smaller than at the window's start", values: belowStart }],
      },
      yearKind: "fall",
      from,
      to,
      n: ten.n,
    },
  };
}

export const shrinkingColleges: TrendBuilder = { name: SLUG, build: buildShrinkingColleges };
