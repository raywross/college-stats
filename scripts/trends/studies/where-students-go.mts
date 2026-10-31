/**
 * Study 7: where the students went (specs/trends/where-students-go.md).
 *
 * The students view of Study 3: each kind of college's share of all campus-based undergraduates, then and now, by
 * fall. Panel: Study 3's ten-year panel (300+ undergraduates in both falls, `shrinkingPanel`), cut to campus-based
 * colleges with `isCampusBased` (lib/movers.ts: not for-profit, not online-first at EITHER end of the window, not a
 * campus that merged or split inside it). The whole panel appears once, by kind, so readers see what the cut removes.
 *
 * Size and selectivity are classified as of the window's first fall (`byGroupThen`, a stated departure from hub rule
 * 3); region, control, setting, and research tier use today's classification. Three periods split the window for the
 * pandemic question: before (`from` → PRE_PANDEMIC_FALL), the pandemic (→ the fall with the lowest campus-based total
 * after it, found here), and after (→ `to`). Money is after inflation (`real()`, CPI-U), in academic years one
 * behind the falls (`fromMoney`/`toMoney`, as Study 4 and the states pages).
 */
import { real, type CpiTable } from "../../../lib/history.ts";
import { pct } from "../../../lib/format.ts";
import { historyYearLabel } from "../../../lib/history.ts";
import { GROUPINGS, STATE_FLOOR, type GroupingKey } from "../../../lib/trend-groups.ts";
import { at, byGroupThen, medianBy, nationalRow, reporting, round4, shareBy, splitByThen, totalBy, yearly, type Member } from "../../../lib/trend-panel.ts";
import { campusExclusionOf, exclusionSets } from "../../../lib/movers.ts";
import { studyBySlug, studyWindow } from "../../../lib/trend-studies.ts";
import type {
  PriceControl,
  PriceFifth,
  StudentsKindRow,
  StudentsPeriod,
  StudentsPeriodKey,
  StudentsStateRow,
  ThenNow,
  WhereStudentsGoFile,
  WhereStudentsGoValues,
} from "../../../lib/trends.ts";
import { PRE_PANDEMIC_FALL } from "../../history/build.mts";
import type { TrendBuilder, TrendContext, TrendOutput } from "../context.mts";
import { contextExclusions } from "../movers.mts";
import { MIN_UNDERGRADS, shrinkingPanel } from "./shrinking-colleges.mts";

const SLUG = "where-students-go";
/** The concentration lines: the biggest campuses, re-ranked each fall. */
export const TOP_N = [50, 100] as const;
/** Cost fifths. */
export const FIFTHS = 5;
/** The applications companion's groupings (spec section 7). */
export const APPLICATION_GROUPINGS: readonly GroupingKey[] = ["size4", "research", "control"];
const CONTROLS: readonly PriceControl[] = ["all", "public", "private-nonprofit"];

const ug = (m: Member, y: number) => at(m, "undergrads", y);
const sum = (ms: readonly Member[], y: number) => totalBy(ms, (m) => ug(m, y)) ?? 0;
const round3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** % change from `a` to `b`, null unless both are reported and `a` > 0. */
const changeOf = (a: number | null, b: number | null): number | null => (a === null || b === null || a <= 0 ? null : (b - a) / a);
const ugChange = (m: Member, a: number, b: number) => changeOf(ug(m, a), ug(m, b));

/** Total undergraduates' % change from `a` to `b` over the members reporting both falls. */
function totalChangeOf(ms: readonly Member[], a: number, b: number): number {
  const both = ms.filter((m) => ug(m, a) !== null && ug(m, b) !== null);
  const then = sum(both, a);
  return then ? round4(sum(both, b) / then - 1) : 0;
}

/** The members reporting undergraduates in `y`, or null under 90% coverage. */
const reportingIn = (ms: readonly Member[], y: number) => reporting(ms, (m) => ug(m, y) !== null);

/** Campus-based total by fall over the reporting members (null under 90% coverage). */
export function totalsByFall(panel: readonly Member[], from: number, to: number): (number | null)[] {
  return yearly(from, to, (y) => {
    const r = reportingIn(panel, y);
    return r ? sum(r, y) : null;
  });
}

/** The pandemic's low point: the fall after `pre` (and before `to`) with the smallest campus-based total. */
export function lowFallOf(totals: readonly (number | null)[], lineFrom: number, pre: number, to: number): number {
  let low: number | null = null;
  for (let y = pre + 1; y < to; y++) {
    const t = totals[y - lineFrom];
    if (t !== null && (low === null || t < totals[low - lineFrom]!)) low = y;
  }
  if (low === null) throw new Error("where-students-go: no fall after the pandemic clears 90% coverage");
  return low;
}

/** The three periods, tiling the window: before [from, pre], pandemic [pre, low], after [low, to]. */
export function periodsOf(from: number, pre: number, low: number, to: number): { key: StudentsPeriodKey; from: number; to: number }[] {
  return [
    { key: "before", from, to: pre },
    { key: "pandemic", from: pre, to: low },
    { key: "after", from: low, to },
  ];
}

/** Pace of a share line between two falls, in points per year (from the rounded line values, so a test can recompute it). */
export function paceOf(line: readonly (number | null)[], lineFrom: number, a: number, b: number): number {
  const sa = line[a - lineFrom];
  const sb = line[b - lineFrom];
  if (sa === null || sb === null || sa === undefined || sb === undefined) throw new Error(`where-students-go: no share at ${a} or ${b}`);
  return round3(((sb - sa) * 100) / (b - a));
}

/** A group's measures, as a share of the whole campus-based panel `panel`. */
function valuesOf(ms: readonly Member[], panel: readonly Member[], from: number, to: number, pre: number, low: number): WhereStudentsGoValues {
  const line = yearly(from, to, (y) => {
    const r = reportingIn(panel, y);
    if (!r) return null;
    const ids = new Set(ms.map((m) => m.school.unit_id));
    const all = sum(r, y);
    return all ? round4(sum(r.filter((m) => ids.has(m.school.unit_id)), y) / all) : null;
  });
  const share: ThenNow = [round4(sum(ms, from) / sum(panel, from)), round4(sum(ms, to) / sum(panel, to))];
  const periods: StudentsPeriod[] = periodsOf(from, pre, low, to).map((p) => ({
    ...p,
    studentsChange: totalChangeOf(ms, p.from, p.to),
    pacePerYear: paceOf(line, from, p.from, p.to),
    medianChange: round4(medianBy(ms, (m) => ugChange(m, p.from, p.to)) ?? 0),
    grewShare: round4(shareBy(ms, (m) => {
      const c = ugChange(m, p.from, p.to);
      return c === null ? null : c > 0;
    }) ?? 0),
  }));
  return {
    share,
    points: round4(share[1] - share[0]),
    totalChange: totalChangeOf(ms, from, to),
    medianChange: round4(medianBy(ms, (m) => ugChange(m, from, to)) ?? 0),
    grewShare: round4(shareBy(ms, (m) => (ugChange(m, from, to) ?? 0) > 0) ?? 0),
    n: ms.length,
    line,
    periods,
    backToPrePandemic: round4(shareBy(ms, (m) => {
      const a = ug(m, pre);
      const b = ug(m, to);
      return a === null || b === null ? null : b >= a;
    }) ?? 0),
  };
}

/** The whole 300-floor panel by kind, shares of its undergraduates. */
function byKindOf(all: readonly Member[], kindOf: (m: Member) => StudentsKindRow["key"], from: number, to: number): StudentsKindRow[] {
  const labels: Record<StudentsKindRow["key"], string> = {
    "campus-based": "Campus-based public and private nonprofit",
    "online-first": "Online-first public and nonprofit",
    "for-profit": "For-profit",
    "merged-or-split": "Merged or split campuses",
  };
  return (Object.keys(labels) as StudentsKindRow["key"][]).map((key) => {
    const ms = all.filter((m) => kindOf(m) === key);
    return {
      key,
      label: labels[key],
      n: ms.length,
      share: [round4(sum(ms, from) / sum(all, from)), round4(sum(ms, to) / sum(all, to))],
      totalChange: totalChangeOf(ms, from, to),
    };
  });
}

/** Share of the reporting panel's undergraduates at its `k` biggest campuses, re-ranked each fall. */
function topShareLine(panel: readonly Member[], from: number, to: number, k: number): (number | null)[] {
  return yearly(from, to, (y) => {
    const r = reportingIn(panel, y);
    if (!r) return null;
    const sizes = r.map((m) => ug(m, y)!).sort((a, b) => b - a);
    const all = sizes.reduce((a, b) => a + b, 0);
    return all ? round4(sizes.slice(0, k).reduce((a, b) => a + b, 0) / all) : null;
  });
}

function statesOf(panel: readonly Member[], from: number, to: number): StudentsStateRow[] {
  const groups = splitByThen(panel, "state", from);
  return groups
    .filter((g) => g.items.length >= STATE_FLOOR)
    .map((g) => {
      const share: ThenNow = [round4(sum(g.items, from) / sum(panel, from)), round4(sum(g.items, to) / sum(panel, to))];
      return { postal: g.key, share, points: round4(share[1] - share[0]), totalChange: totalChangeOf(g.items, from, to), n: g.items.length };
    })
    .sort((a, b) => a.postal.localeCompare(b.postal));
}

/**
 * The applications companion's falls: the period boundaries (from, the last pre-pandemic fall, the low, to), each one
 * under 90% coverage of applicants replaced by the nearest earlier fall that clears it (after the previous boundary).
 */
export function applicationFalls(panel: readonly Member[], bounds: readonly number[]): number[] {
  const out: number[] = [];
  for (const b of bounds) {
    const floor = out.length ? out[out.length - 1] : -Infinity;
    for (let y = b; y > floor; y--) {
      if (reporting(panel, (m) => at(m, "applicants", y) !== null)) {
        out.push(y);
        break;
      }
    }
  }
  return out;
}

function applicationsOf(panel: readonly Member[], from: number, bounds: readonly number[]): WhereStudentsGoFile["applications"] {
  const falls = applicationFalls(panel, bounds);
  const sub = panel.filter((m) => falls.every((y) => at(m, "applicants", y) !== null));
  const apps = (ms: readonly Member[], y: number) => totalBy(ms, (m) => at(m, "applicants", y)) ?? 0;
  return {
    falls,
    n: sub.length,
    byGrouping: APPLICATION_GROUPINGS.map((grouping) => ({
      grouping,
      groups: splitByThen(sub, grouping, from)
        .filter((g) => g.items.length >= GROUPINGS[grouping].floor)
        .map((g) => ({ key: g.key, label: g.label, n: g.items.length, shares: falls.map((y) => round4(apps(g.items, y) / apps(sub, y))) })),
    })),
  };
}

/** Spearman rank correlation (average ranks for ties). */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const ranks = (v: readonly number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/** Split `items` (already ordered) into `k` fifths: fifth i holds [⌊i·n/k⌋, ⌊(i+1)·n/k⌋), so sizes differ by at most one. */
export function fifthsOf<T>(items: readonly T[], k = FIFTHS): T[][] {
  return Array.from({ length: k }, (_, i) => items.slice(Math.floor((i * items.length) / k), Math.floor(((i + 1) * items.length) / k)));
}

const controlMatch = (c: PriceControl) => (m: Member) => c === "all" || m.school.type === c;

function costOf(panel: readonly Member[], from: number, to: number, fromMoney: number, toMoney: number, periods: { key: StudentsPeriodKey; from: number; to: number }[], cpi: CpiTable): WhereStudentsGoFile["cost"] {
  const paid = (m: Member, y: number) => {
    const v = at(m, "avg_paid_all", y);
    return v === null ? null : real(v, y, cpi, toMoney);
  };
  const priceChange = (m: Member, a: number, b: number) => changeOf(paid(m, a), paid(m, b));
  const costPanel = panel.filter((m) => paid(m, fromMoney) !== null && paid(m, toMoney) !== null);

  const fifthRow = (ms: readonly Member[], measure: (m: Member) => number, money: boolean): PriceFifth => {
    const vals = ms.map(measure);
    const r = (v: number) => (money ? Math.round(v) : round4(v));
    return {
      lo: r(Math.min(...vals)),
      hi: r(Math.max(...vals)),
      medianChange: round4(medianBy(ms, (m) => ugChange(m, from, to)) ?? 0),
      totalChange: totalChangeOf(ms, from, to),
      grewShare: round4(shareBy(ms, (m) => (ugChange(m, from, to) ?? 0) > 0) ?? 0),
      n: ms.length,
    };
  };
  const fifthsBy = (measure: (m: Member) => number, money: boolean) =>
    CONTROLS.map((control) => {
      const ordered = costPanel.filter(controlMatch(control)).sort((a, b) => measure(a) - measure(b) || a.school.unit_id.localeCompare(b.school.unit_id));
      return { control, fifths: fifthsOf(ordered).map((f) => fifthRow(f, measure, money)) };
    });

  const correlations: WhereStudentsGoFile["cost"]["correlations"] = [];
  const windows = [{ key: "decade" as const, from, to }, ...periods];
  for (const w of windows) {
    // Price years run one behind the falls (an academic year starts the fall before the next fall's count).
    const [pa, pb] = w.key === "decade" ? [fromMoney, toMoney] : [w.from - (to - toMoney), w.to - (to - toMoney)];
    for (const control of CONTROLS) {
      const pairs = panel
        .filter(controlMatch(control))
        .map((m) => [priceChange(m, pa, pb), ugChange(m, w.from, w.to)] as const)
        .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
      const prices = pairs.map((p) => p[0]).sort((a, b) => a - b);
      correlations.push({
        period: w.key,
        control,
        rho: round3(spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1]))),
        medianPriceChange: round4(prices.length ? (prices[Math.floor((prices.length - 1) / 2)] + prices[Math.ceil((prices.length - 1) / 2)]) / 2 : 0),
        n: pairs.length,
      });
    }
  }

  const students = (["public", "private-nonprofit"] as const).map((control) => {
    const ms = costPanel.filter(controlMatch(control));
    return {
      control,
      line: yearly(fromMoney, toMoney, (y) => {
        // Academic year y is paid by the students counted in fall y (the fall it starts).
        const r = reporting(ms, (m) => paid(m, y) !== null && ug(m, y) !== null);
        if (!r) return null;
        let num = 0;
        let den = 0;
        for (const m of r) {
          num += paid(m, y)! * ug(m, y)!;
          den += ug(m, y)!;
        }
        return den ? Math.round(num / den) : null;
      }),
    };
  });

  return {
    fromMoney,
    toMoney,
    n: costPanel.length,
    byChange: fifthsBy((m) => priceChange(m, fromMoney, toMoney)!, false),
    byLevel: fifthsBy((m) => paid(m, fromMoney)!, true),
    correlations,
    students,
  };
}

export function buildWhereStudentsGo(ctx: TrendContext): TrendOutput {
  const study = studyBySlug(SLUG)!;
  const [from, to] = studyWindow(study, ctx.hmeta.latest);
  const toMoney = ctx.hmeta.latest.academic;
  const fromMoney = toMoney - study.window;
  const pre = PRE_PANDEMIC_FALL;
  const { campuses } = exclusionSets(contextExclusions(ctx));

  const all = shrinkingPanel(ctx.members, from, to);
  const kindOf = (m: Member): StudentsKindRow["key"] => {
    const why = campusExclusionOf(m, from, to, campuses);
    return why === null ? "campus-based" : why === "closed-or-merged" ? "merged-or-split" : why;
  };
  const panel = all.filter((m) => kindOf(m) === "campus-based");

  const totals = totalsByFall(panel, from, to);
  const low = lowFallOf(totals, from, pre, to);
  const periods = periodsOf(from, pre, low, to);
  const compute = (ms: Member[]) => valuesOf(ms, panel, from, to, pre, low);
  const preTotal = totals[pre - from];

  const xlNow = (ms: readonly Member[]) => ms.filter((m) => GROUPINGS.size4.of(m.school)[0] === "xl");

  const file: WhereStudentsGoFile = {
    name: SLUG,
    slug: SLUG,
    built: ctx.hmeta.built,
    yearKind: study.yearKind,
    from,
    to,
    n: panel.length,
    lineFrom: from,
    minUndergrads: MIN_UNDERGRADS,
    allN: all.length,
    prePandemicFall: pre,
    lowFall: low,
    national: nationalRow(panel, compute),
    groupings: study.groupings.map((g) => byGroupThen(panel, g, from, compute)),
    campusBased: {
      n: panel.length,
      totalByFall: totals,
      indexToPrePandemic: totals.map((t) => (t === null || !preTotal ? null : round4(t / preTotal - 1))),
    },
    byKind: byKindOf(all, kindOf, from, to),
    concentration: { top50: topShareLine(panel, from, to, TOP_N[0]), top100: topShareLine(panel, from, to, TOP_N[1]) },
    todayClassified: { xlShare: [round4(sum(xlNow(panel), from) / sum(panel, from)), round4(sum(xlNow(panel), to) / sum(panel, to))] },
    stateFloor: STATE_FLOOR,
    states: statesOf(panel, from, to),
    applications: applicationsOf(panel, from, [from, pre, low, to]),
    cost: costOf(panel, from, to, fromMoney, toMoney, periods, ctx.cpi),
  };

  const xl = file.groupings.find((g) => g.grouping === "size4")!.groups.find((r) => r.key === "xl")!.values!;
  const r1 = file.groupings.find((g) => g.grouping === "research")!.groups.find((r) => r.key === "R1")!.values!;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  return {
    name: SLUG,
    file,
    card: {
      slug: SLUG,
      title: study.title,
      headline: { value: xl.share[1], format: "pct", caption: "of campus-based undergraduates attend a college with 20,000 or more students" },
      sentence:
        `Across ${panel.length.toLocaleString("en-US")} campus-based colleges, the share of undergraduates at colleges with 20,000 or more students in ${fall(from)} ` +
        `rose from ${pct(xl.share[0])} to ${pct(xl.share[1])}, and R1 research universities went from ${pct(r1.share[0])} to ${pct(r1.share[1])} of students.`,
      spark: { start: from, kind: "fall", format: "pct", series: [{ name: "At colleges with 20,000+ students", values: xl.line }] },
      yearKind: "fall",
      from,
      to,
      n: panel.length,
    },
  };
}

export const whereStudentsGo: TrendBuilder = { name: SLUG, build: buildWhereStudentsGo };
