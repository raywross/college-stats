/**
 * Study 2: test-optional went mainstream (specs/trends/test-optional.md).
 *
 * Panel: colleges reporting a test policy (IPEDS ADMCON7) in both fall 2019 (PRE_PANDEMIC_FALL, the same baseline
 * Home fact 3 uses) and the newest fall. No applicant floor: test policy is reported whether or not a college
 * reports applicant counts, so the panel here is wider than Study 1's.
 *
 * Copied from scripts/trends/studies/men-and-women.mts (the worked example); see specs/national-trends.md#building-
 * a-study-in-code.
 */
import { PRE_PANDEMIC_FALL } from "../../history/build.mts";
import { TEST_BLIND_FROM, TEST_POLICY_CODES, historyYearLabel } from "../../../lib/history.ts";
import { pct } from "../../../lib/format.ts";
import { POLICY_LABELS } from "../../../lib/test-policy.ts";
import { GROUP_FLOOR } from "../../../lib/trend-groups.ts";
import { at, byGroup, fixedPanel, medianBy, nationalRow, reporting, round4, shareBy, weightedBy, yearly, type Member } from "../../../lib/trend-panel.ts";
import { studyBySlug } from "../../../lib/trend-studies.ts";
import type { ScoreRangeRow, TestOptionalFile, TestOptionalValues } from "../../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "../context.mts";

const SLUG = "test-optional";

const required = (m: Member, y: number) => at(m, "test_policy", y) === TEST_POLICY_CODES.required;
const blind = (m: Member, y: number) => at(m, "test_policy", y) === TEST_POLICY_CODES["not-considered"];
/** "Optional": test scores considered or recommended, but not required and not test-blind. */
const optional = (m: Member, y: number) => {
  const p = at(m, "test_policy", y);
  return p === TEST_POLICY_CODES.recommended || p === TEST_POLICY_CODES.considered;
};
const hasPolicy = (m: Member, y: number) => at(m, "test_policy", y) !== null;

/**
 * Test submission (sat_submit/act_submit) isn't the field the panel is built on, so its yearly coverage of the
 * test-policy panel never reaches MIN_YEAR_COVERAGE (it runs 66–90% even at the panel's own ends): gating its line on
 * 90% of the whole panel would blank every year. A flat floor keeps very thin early years off the line without
 * discarding real, if partial, coverage in the years that matter (hub rule 4's GROUP_FLOOR, applied here as a floor
 * on reporters rather than on panel share).
 */
const reportingAtLeast = (ms: readonly Member[], ok: (m: Member) => boolean, min = GROUP_FLOOR): Member[] | null => {
  const r = ms.filter(ok);
  return r.length >= min ? r : null;
};

export function testOptionalPanel(members: readonly Member[], [from, to]: [number, number]): Member[] {
  return fixedPanel(members, [from, to], hasPolicy);
}

/** One group's (or the nation's) values over its panel members. */
export function values(ms: readonly Member[], [from, to]: [number, number], lineFrom: number): TestOptionalValues {
  const requiredAt = (r: readonly Member[], y: number) => shareBy(r, (m) => required(m, y));
  const blindAt = (r: readonly Member[], y: number) => shareBy(r, (m) => blind(m, y));
  const satSubmitAt = (r: readonly Member[], y: number) => medianBy(r, (m) => at(m, "sat_submit", y));
  const actSubmitAt = (r: readonly Member[], y: number) => medianBy(r, (m) => at(m, "act_submit", y));
  const r4 = (v: number | null) => (v === null ? null : round4(v));
  const ends = (f: (r: readonly Member[], y: number) => number | null): [number, number] => [round4(f(ms, from)!), round4(f(ms, to)!)];
  /** A yearly line over the members reporting that year (null under 90% coverage); `ok` gates which members count. */
  const line = (ok: (m: Member, y: number) => boolean, f: (r: readonly Member[], y: number) => number | null, start = lineFrom) =>
    yearly(start, to, (y) => {
      const r = reporting(ms, (m) => ok(m, y));
      return r ? r4(f(r, y)) : null;
    });
  /** Same shape, but for a series that isn't the panel's defining field (see reportingAtLeast above). */
  const softLine = (ok: (m: Member, y: number) => boolean, f: (r: readonly Member[], y: number) => number | null, start = lineFrom) =>
    yearly(start, to, (y) => {
      const r = reportingAtLeast(ms, (m) => ok(m, y));
      return r ? r4(f(r, y)) : null;
    });
  return {
    required: ends(requiredAt),
    satSubmitMedian: ends(satSubmitAt),
    actSubmitMedian: ends(actSubmitAt),
    lines: {
      required: line(hasPolicy, requiredAt),
      blind: line(hasPolicy, blindAt, TEST_BLIND_FROM),
      satSubmitMedian: softLine((m, y) => at(m, "sat_submit", y) !== null, satSubmitAt),
      actSubmitMedian: softLine((m, y) => at(m, "act_submit", y) !== null, actSubmitAt),
    },
  };
}

/** The dumbbell: published SAT 25th/75th percentile, fall `from` → `to`, per policy group (hub rule 4: GROUP_FLOOR). */
function scoreRanges(panel: readonly Member[], from: number, to: number): ScoreRangeRow[] {
  const hasScores = (m: Member) => at(m, "sat_25", from) !== null && at(m, "sat_25", to) !== null && at(m, "sat_75", from) !== null && at(m, "sat_75", to) !== null;
  const groups: { key: ScoreRangeRow["key"]; label: string; test: (m: Member) => boolean }[] = [
    { key: "dropped", label: "Dropped the requirement", test: (m) => required(m, from) && !required(m, to) },
    { key: "required-both", label: "Kept the requirement", test: (m) => required(m, from) && required(m, to) },
    { key: "optional-both", label: "Optional both years", test: (m) => optional(m, from) && optional(m, to) },
  ];
  return groups.map(({ key, label, test }) => {
    const ms = panel.filter((m) => test(m) && hasScores(m));
    if (ms.length < GROUP_FLOOR) return { key, label, n: ms.length, tooFew: true };
    const end = (k: "sat_25" | "sat_75", y: number) => medianBy(ms, (m) => at(m, k, y));
    return {
      key,
      label,
      n: ms.length,
      p25: [Math.round(end("sat_25", from)!), Math.round(end("sat_25", to)!)] as [number, number],
      p75: [Math.round(end("sat_75", from)!), Math.round(end("sat_75", to)!)] as [number, number],
    };
  });
}

/** Colleges not requiring tests in fall `blindFrom` (fall 2022) that require them again by `to` (hub rule: too few to chart, named instead). */
function wentBackToRequiring(panel: readonly Member[], blindFrom: number, to: number): TestOptionalFile["wentBackToRequiring"] {
  return panel
    .filter((m) => at(m, "test_policy", blindFrom) !== null && !required(m, blindFrom) && required(m, to))
    .map((m) => ({ id: m.school.unit_id, name: m.school.name, policyNow: m.school.admissions.test_policy ? POLICY_LABELS[m.school.admissions.test_policy] : "Test scores required" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildTestOptional(ctx: TrendContext): TrendOutput {
  const study = studyBySlug(SLUG)!;
  const from = PRE_PANDEMIC_FALL;
  const to = ctx.hmeta.latest.fall;
  const window: [number, number] = [from, to];
  // Lines start at the first fall either policy or submission series exists (fall 2001 for most colleges).
  const lineFrom = Math.min(...ctx.members.flatMap((m) => (m.h.series.test_policy ? [m.h.series.test_policy.start] : [])));
  const panel = testOptionalPanel(ctx.members, window);
  const compute = (ms: Member[]) => values(ms, window, lineFrom);
  const weightedSatSubmit: [number, number] = [
    round4(weightedBy(panel, (m) => at(m, "sat_submit", from), (m) => at(m, "enrolled", from))!),
    round4(weightedBy(panel, (m) => at(m, "sat_submit", to), (m) => at(m, "enrolled", to))!),
  ];
  const file: TestOptionalFile = {
    name: SLUG,
    slug: SLUG,
    built: ctx.hmeta.built,
    yearKind: study.yearKind,
    from,
    to,
    n: panel.length,
    lineFrom,
    blindFrom: TEST_BLIND_FROM,
    weightedSatSubmit,
    national: nationalRow(panel, compute),
    groupings: study.groupings.map((g) => byGroup(panel, g, compute)),
    scoreRanges: scoreRanges(panel, from, to),
    wentBackToRequiring: wentBackToRequiring(panel, TEST_BLIND_FROM, to),
  };
  const v = file.national.values!;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  return {
    name: SLUG,
    file,
    card: {
      slug: SLUG,
      title: study.title,
      headline: { value: v.required[1], format: "pct", caption: "of colleges still require the SAT or ACT" },
      sentence:
        `In ${fall(from)}, ${pct(v.required[0])} of colleges required the SAT or ACT; in ${fall(to)}, ${pct(v.required[1])} did, ` +
        `while the median college's SAT submission share fell from ${pct(v.satSubmitMedian[0])} to ${pct(v.satSubmitMedian[1])}.`,
      spark: {
        start: lineFrom,
        kind: "fall",
        format: "pct",
        series: [{ name: "Share of colleges requiring the SAT or ACT", values: v.lines.required }],
      },
      yearKind: "fall",
      from,
      to,
      n: panel.length,
    },
  };
}

export const testOptional: TrendBuilder = { name: SLUG, build: buildTestOptional };
