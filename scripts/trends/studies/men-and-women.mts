/**
 * Study 1: men and women in admissions (specs/national-trends.md#study-1-men-and-women-in-admissions).
 *
 * Panel: colleges reporting both men's and women's acceptance rates, with 1,000+ total applicants, in both the
 * window's first and last fall (history has no applicants by sex yet, so the college pages' 200-per-sex rule can't be
 * used; the hub notes it). Share of colleges, not students, except the applicant-weighted companion.
 *
 * The worked example for Studies 2–6: copy this file, change the measure in `values()`, keep the shape.
 */
import { historyYearLabel } from "../../../lib/history.ts";
import { pct } from "../../../lib/format.ts";
import { at, byGroup, fixedPanel, medianBy, nationalRow, reporting, round4, shareBy, weightedBy, yearly, type Member } from "../../../lib/trend-panel.ts";
import { studyBySlug, studyWindow } from "../../../lib/trend-studies.ts";
import type { MenAndWomenFile, MenAndWomenValues, ThenNow } from "../../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "../context.mts";

const SLUG = "men-and-women";
/** "Notably higher": 3+ points, the same bar the college pages use (lib/insights.ts BY_SEX_NOTABLE_GAP). */
export const NOTABLE_GAP = 0.03;
/** Total applicants at both ends of the window. */
export const MIN_APPLICANTS = 1000;

/** Men's minus women's acceptance rate in `year`, to 4 decimals; null unless both are reported. */
export function admitGap(m: Member, year: number): number | null {
  const men = at(m, "admit_rate_men", year);
  const women = at(m, "admit_rate_women", year);
  return men === null || women === null ? null : round4(men - women);
}

const inPanel = (m: Member, year: number) => admitGap(m, year) !== null && (at(m, "applicants", year) ?? 0) >= MIN_APPLICANTS;

export function menAndWomenPanel(members: readonly Member[], [from, to]: [number, number]): Member[] {
  return fixedPanel(members, [from, to], inPanel);
}

/** One group's (or the nation's) values over its panel members. */
export function values(ms: readonly Member[], [from, to]: [number, number], lineFrom: number): MenAndWomenValues {
  const menHigherAt = (r: readonly Member[], y: number) => shareBy(r, (m) => (admitGap(m, y) ?? -1) >= NOTABLE_GAP);
  const womenHigherAt = (r: readonly Member[], y: number) => shareBy(r, (m) => (admitGap(m, y) ?? 1) <= -NOTABLE_GAP);
  const medianAt = (r: readonly Member[], y: number) => medianBy(r, (m) => admitGap(m, y));
  const weightedAt = (r: readonly Member[], y: number, key: "admit_rate_men" | "admit_rate_women") =>
    weightedBy(r, (m) => at(m, key, y), (m) => at(m, "applicants", y));
  const r4 = (v: number | null) => (v === null ? null : round4(v));
  const ends = (f: (r: readonly Member[], y: number) => number | null): ThenNow => [round4(f(ms, from)!), round4(f(ms, to)!)];
  /** A yearly line over the members reporting that year (null under 90% coverage). */
  const line = (ok: (m: Member, y: number) => boolean, f: (r: readonly Member[], y: number) => number | null) =>
    yearly(lineFrom, to, (y) => {
      const r = reporting(ms, (m) => ok(m, y));
      return r ? r4(f(r, y)) : null;
    });
  const hasGap = (m: Member, y: number) => admitGap(m, y) !== null;
  const hasWeight = (m: Member, y: number) => hasGap(m, y) && (at(m, "applicants", y) ?? 0) > 0;
  return {
    menHigher: ends(menHigherAt),
    womenHigher: ends(womenHigherAt),
    medianGap: ends(medianAt),
    weightedMen: ends((r, y) => weightedAt(r, y, "admit_rate_men")),
    weightedWomen: ends((r, y) => weightedAt(r, y, "admit_rate_women")),
    lines: {
      menHigher: line(hasGap, menHigherAt),
      womenHigher: line(hasGap, womenHigherAt),
      medianGap: line(hasGap, medianAt),
      weightedGap: line(hasWeight, (r, y) => {
        const men = weightedAt(r, y, "admit_rate_men");
        const women = weightedAt(r, y, "admit_rate_women");
        return men === null || women === null ? null : men - women;
      }),
    },
  };
}

export function buildMenAndWomen(ctx: TrendContext): TrendOutput {
  const study = studyBySlug(SLUG)!;
  const window = studyWindow(study, ctx.hmeta.latest);
  const [from, to] = window;
  // Lines start at the first fall either rate exists in history.
  const lineFrom = Math.min(...ctx.members.flatMap((m) => (m.h.series.admit_rate_men ? [m.h.series.admit_rate_men.start] : [])));
  const panel = menAndWomenPanel(ctx.members, window);
  const compute = (ms: Member[]) => values(ms, window, lineFrom);
  const file: MenAndWomenFile = {
    name: SLUG,
    slug: SLUG,
    built: ctx.hmeta.built,
    yearKind: study.yearKind,
    from,
    to,
    n: panel.length,
    lineFrom,
    threshold: NOTABLE_GAP,
    minApplicants: MIN_APPLICANTS,
    national: nationalRow(panel, compute),
    groupings: study.groupings.map((g) => byGroup(panel, g, compute)),
  };
  const v = file.national.values!;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  return {
    name: SLUG,
    file,
    card: {
      slug: SLUG,
      title: study.title,
      headline: { value: v.womenHigher[1], format: "pct", caption: "of colleges admit women at a notably higher rate than men" },
      sentence:
        `In ${fall(from)}, ${pct(v.menHigher[0])} of colleges admitted men at a rate 3 or more points higher than women; ` +
        `in ${fall(to)}, ${pct(v.menHigher[1])} did, while ${pct(v.womenHigher[1])} favored women by as much.`,
      spark: {
        start: lineFrom,
        kind: "fall",
        format: "pct",
        series: [
          { name: "Women admitted at a higher rate", values: v.lines.womenHigher },
          { name: "Men admitted at a higher rate", values: v.lines.menHigher },
        ],
      },
      yearKind: "fall",
      from,
      to,
      n: panel.length,
    },
  };
}

export const menAndWomen: TrendBuilder = { name: SLUG, build: buildMenAndWomen };
