/**
 * Study 6: the Pell graduation gap (specs/trends/pell-gap.md).
 *
 * Panel: colleges reporting both the Pell and "neither Pell nor subsidized loan" graduation rates, with at least 50
 * students in EACH group, in BOTH the entering class of 2010 and the newest entering class the GR Pell/SSL file
 * covers (2018 today). Groups use today's classification. Colleges view: medians. Students view: each rate summed
 * (graduates ÷ cohort) across the group. A companion uses the 8-year outcome measures (different survey, different
 * students, its own newest year), national and by public/private.
 */
import { pellGapAt } from "../../../lib/history.ts";
import { splitBy } from "../../../lib/trend-groups.ts";
import { at, byGroup, fixedPanel, medianBy, nationalRow, reporting, round4, shareBy, weightedBy, yearly, type Member } from "../../../lib/trend-panel.ts";
import { studyBySlug, studyWindow } from "../../../lib/trend-studies.ts";
import type { PellGapFile, PellGapOm8Row, PellGapValues, ThenNow } from "../../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "../context.mts";

const SLUG = "pell-gap";
/** Students a college needs in both groups, in both years, to join the panel (specs/trends/pell-gap.md). */
export const MIN_COHORT = 50;
/** "10 or more points," the bar for the share-of-colleges measure. */
export const GAP_THRESHOLD = 0.1;

const inPanel = (m: Member, year: number) =>
  pellGapAt(m.h, year) !== null &&
  (at(m, "grad_cohort_pell", year) ?? 0) >= MIN_COHORT &&
  (at(m, "grad_cohort_no_pell_no_loan", year) ?? 0) >= MIN_COHORT;

export function pellGapPanel(members: readonly Member[], [from, to]: [number, number]): Member[] {
  return fixedPanel(members, [from, to], inPanel);
}

/** One group's (or the nation's) values over its panel members. */
export function values(ms: readonly Member[], [from, to]: [number, number], lineFrom: number): PellGapValues {
  const gapAt = (m: Member, y: number) => pellGapAt(m.h, y);
  const pellRateAt = (r: readonly Member[], y: number) => medianBy(r, (m) => at(m, "grad_rate_pell", y));
  const neitherRateAt = (r: readonly Member[], y: number) => medianBy(r, (m) => at(m, "grad_rate_no_pell_no_loan", y));
  const gapMedianAt = (r: readonly Member[], y: number) => medianBy(r, (m) => gapAt(m, y));
  const gap10At = (r: readonly Member[], y: number) => shareBy(r, (m) => (gapAt(m, y) ?? -1) >= GAP_THRESHOLD);
  const overallAt = (r: readonly Member[], y: number) => medianBy(r, (m) => at(m, "grad_rate", y));
  const weightedAt = (r: readonly Member[], y: number, key: "grad_rate_pell" | "grad_rate_no_pell_no_loan", cohort: "grad_cohort_pell" | "grad_cohort_no_pell_no_loan") =>
    weightedBy(r, (m) => at(m, key, y), (m) => at(m, cohort, y));

  const r4 = (v: number | null) => (v === null ? null : round4(v));
  const ends = (f: (r: readonly Member[], y: number) => number | null): ThenNow => [round4(f(ms, from)!), round4(f(ms, to)!)];
  /** A yearly line over the members reporting that year (null under 90% coverage). */
  const line = (ok: (m: Member, y: number) => boolean, f: (r: readonly Member[], y: number) => number | null) =>
    yearly(lineFrom, to, (y) => {
      const r = reporting(ms, (m) => ok(m, y));
      return r ? r4(f(r, y)) : null;
    });
  const hasGap = (m: Member, y: number) => gapAt(m, y) !== null;
  const hasWeight = (m: Member, y: number) =>
    hasGap(m, y) && (at(m, "grad_cohort_pell", y) ?? 0) > 0 && (at(m, "grad_cohort_no_pell_no_loan", y) ?? 0) > 0;
  const hasOverall = (m: Member, y: number) => at(m, "grad_rate", y) !== null;

  const weightedPellRate = ends((r, y) => weightedAt(r, y, "grad_rate_pell", "grad_cohort_pell"));
  const weightedNeitherRate = ends((r, y) => weightedAt(r, y, "grad_rate_no_pell_no_loan", "grad_cohort_no_pell_no_loan"));

  return {
    pellRate: ends(pellRateAt),
    neitherRate: ends(neitherRateAt),
    gap: ends(gapMedianAt),
    gap10Share: ends(gap10At),
    weightedPellRate,
    weightedNeitherRate,
    weightedGap: [round4(weightedNeitherRate[0] - weightedPellRate[0]), round4(weightedNeitherRate[1] - weightedPellRate[1])],
    overallRate: ends(overallAt),
    lines: {
      pellRate: line(hasGap, pellRateAt),
      neitherRate: line(hasGap, neitherRateAt),
      gap: line(hasGap, gapMedianAt),
      weightedGap: line(hasWeight, (r, y) => {
        const pell = weightedAt(r, y, "grad_rate_pell", "grad_cohort_pell");
        const neither = weightedAt(r, y, "grad_rate_no_pell_no_loan", "grad_cohort_no_pell_no_loan");
        return pell === null || neither === null ? null : neither - pell;
      }),
      overallRate: line(hasOverall, overallAt),
    },
  };
}

/** The 8-year outcome-measures companion row for one set of members, at `year` (specs/trends/pell-gap.md "Eight years, everyone"). */
function om8Row(key: string, label: string, ms: readonly Member[], year: number, floor: number): PellGapOm8Row {
  const has = ms.filter((m) => at(m, "om_award_pell", year) !== null && at(m, "om_award_non_pell", year) !== null);
  if (has.length < floor) return { key, label, n: has.length, tooFew: true };
  return {
    key,
    label,
    n: has.length,
    pell: round4(medianBy(has, (m) => at(m, "om_award_pell", year))!),
    nonPell: round4(medianBy(has, (m) => at(m, "om_award_non_pell", year))!),
  };
}

export function buildPellGap(ctx: TrendContext): TrendOutput {
  const study = studyBySlug(SLUG)!;
  const window = studyWindow(study, ctx.hmeta.latest);
  const [from, to] = window;
  const lineFrom = from;
  const panel = pellGapPanel(ctx.members, window);
  const compute = (ms: Member[]) => values(ms, window, lineFrom);

  // The 8-year outcome measures are their own survey with their own newest entering class (often earlier than `to`):
  // the latest year any member has both om_award_pell and om_award_non_pell.
  const omYear = Math.max(
    ...ctx.members.flatMap((m) => {
      const s = m.h.series.om_award_pell;
      return s ? [s.start + s.values.length - 1] : [];
    })
  );
  const omMembers = ctx.members.filter((m) => at(m, "om_award_pell", omYear) !== null && at(m, "om_award_non_pell", omYear) !== null);
  const byControl = splitBy(omMembers, "control", (m) => m.school).map((g) => om8Row(g.key, g.label, g.items, omYear, 30));

  const file: PellGapFile = {
    name: SLUG,
    slug: SLUG,
    built: ctx.hmeta.built,
    yearKind: study.yearKind,
    from,
    to,
    n: panel.length,
    lineFrom,
    minCohort: MIN_COHORT,
    gapThreshold: GAP_THRESHOLD,
    national: nationalRow(panel, compute),
    groupings: study.groupings.map((g) => byGroup(panel, g, compute)),
    om8: {
      year: omYear,
      national: om8Row("all", "All colleges", omMembers, omYear, 30),
      byControl,
    },
  };

  const v = file.national.values!;
  const fall = (y: number) => `class entering fall ${y}`;
  return {
    name: SLUG,
    file,
    card: {
      slug: SLUG,
      title: study.title,
      headline: { value: v.gap[1], format: "pts", caption: "point gap between Pell recipients and students with neither, at the median college" },
      sentence:
        `At the median college, Pell recipients from the ${fall(from)} graduated within six years ${Math.round(v.gap[0] * 100)} points less often than students ` +
        `with neither a Pell Grant nor a subsidized loan; for the ${fall(to)} the gap was ${Math.round(v.gap[1] * 100)} points.`,
      spark: {
        start: lineFrom,
        kind: "cohort",
        format: "pts",
        series: [{ name: "Median gap, points", values: v.lines.gap }],
      },
      yearKind: "cohort",
      from,
      to,
      n: panel.length,
    },
  };
}

export const pellGap: TrendBuilder = { name: SLUG, build: buildPellGap };
