/**
 * Study: the price gap, by who is discounting (specs/trends/price-gap.md).
 *
 * Panel: colleges reporting both full price and average total cost in the window's first and last academic year
 * (the same fixed panel Home fact 1 uses, `priceGap()` in scripts/history/build.mts — reused verbatim here so the
 * national row is byte-identical to data/history/facts.json's `priceGap`). Money is always in the window's last
 * year's dollars (`real()`/`cpiFor()`, lib/history.ts).
 */
import { at, byGroup, fixedPanel, medianBy, nationalRow, round4, yearly, type Member } from "../../../lib/trend-panel.ts";
import { real, type CpiTable, type SeriesKey } from "../../../lib/history.ts";
import { priceGap as computePriceGap } from "../../history/build.mts";
import { studyBySlug, studyWindow } from "../../../lib/trend-studies.ts";
import type { PriceGapFile, PriceGapReset, PriceGapValues, ThenNow } from "../../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "../context.mts";

const SLUG = "price-gap";
/** A single year's drop in full price, after inflation, at or below this counts as a "tuition reset" (10%). */
export const RESET_THRESHOLD = -0.1;
/** How many resets the file lists, biggest drop first. */
export const RESET_CAP = 10;
const BANDS: readonly SeriesKey[] = ["net_price_income_1", "net_price_income_2", "net_price_income_3", "net_price_income_4", "net_price_income_5"];

/** `key`'s value in `year`, in `base`-year dollars; null unless the college reports it. */
const realAt = (m: Member, key: SeriesKey, year: number, cpi: CpiTable, base: number): number | null => {
  const v = at(m, key, year);
  return v === null ? null : real(v, year, cpi, base);
};

/** A college's discount in `year`: 1 − average paid ÷ full price. Null unless both are reported (inflation cancels, so nominal works). */
function discountAt(m: Member, year: number): number | null {
  const full = at(m, "full_price", year);
  const paid = at(m, "avg_paid_all", year);
  return full === null || paid === null || full <= 0 ? null : round4(1 - paid / full);
}

export const inPanel = (m: Member, year: number): boolean => at(m, "full_price", year) !== null && at(m, "avg_paid_all", year) !== null;

export function priceGapPanel(members: readonly Member[], [from, to]: [number, number]): Member[] {
  return fixedPanel(members, [from, to], inPanel);
}

/** One group's (or the nation's) values, reusing the history build's `priceGap()` for the indexed lines. */
export function values(ms: readonly Member[], [from, to]: [number, number], cpi: CpiTable): PriceGapValues {
  // ms is already the fixed panel (or a today's-classification subset of it), so priceGap()'s own internal filter
  // is a no-op here: this is exactly how facts.priceGap is computed, so the national row matches it exactly.
  const g = computePriceGap(ms.map((m) => m.h), [from, to], cpi)!;
  const bandThenNow = (key: SeriesKey): ThenNow => [medianBy(ms, (m) => realAt(m, key, from, cpi, to)) ?? 0, medianBy(ms, (m) => realAt(m, key, to, cpi, to)) ?? 0];
  return {
    fullPriceChange: g.fullPriceChange,
    avgPaidChange: g.avgPaidChange,
    discount: [medianBy(ms, (m) => discountAt(m, from)) ?? 0, medianBy(ms, (m) => discountAt(m, to)) ?? 0],
    paidNow: Math.round(medianBy(ms, (m) => at(m, "avg_paid_all", to)) ?? 0),
    grantPct: [round4(medianBy(ms, (m) => at(m, "grant_pct", from)) ?? 0), round4(medianBy(ms, (m) => at(m, "grant_pct", to)) ?? 0)],
    grantAvg: [Math.round(medianBy(ms, (m) => realAt(m, "grant_avg", from, cpi, to)) ?? 0), Math.round(medianBy(ms, (m) => realAt(m, "grant_avg", to, cpi, to)) ?? 0)],
    netPriceByBand: BANDS.map((k) => {
      const [then, now] = bandThenNow(k);
      return [Math.round(then), Math.round(now)] as ThenNow;
    }),
    lines: {
      fullPriceIndex: g.fullPriceIndex,
      avgPaidIndex: g.avgPaidIndex,
      discount: yearly(from, to, (y) => {
        const v = medianBy(ms, (m) => discountAt(m, y));
        return v === null ? null : round4(v);
      }),
    },
  };
}

/** Colleges whose full price fell `RESET_THRESHOLD` or more, after inflation, in a single year within the window. */
export function tuitionResets(panel: readonly Member[], [from, to]: [number, number], cpi: CpiTable): PriceGapReset[] {
  const out: PriceGapReset[] = [];
  for (const m of panel) {
    let best: { year: number; drop: number } | null = null;
    for (let y = from; y < to; y++) {
      const a = at(m, "full_price", y);
      const b = at(m, "full_price", y + 1);
      if (a === null || b === null || a <= 0) continue;
      const ra = real(a, y, cpi, to);
      const rb = real(b, y + 1, cpi, to);
      if (ra === null || rb === null) continue;
      const drop = round4(rb / ra - 1);
      if (drop <= RESET_THRESHOLD && (!best || drop < best.drop)) best = { year: y, drop };
    }
    if (best) out.push({ unitId: m.school.unit_id, name: m.school.name, year: best.year, drop: best.drop });
  }
  return out.sort((a, b) => a.drop - b.drop).slice(0, RESET_CAP);
}

export function buildPriceGap(ctx: TrendContext): TrendOutput {
  const study = studyBySlug(SLUG)!;
  const window = studyWindow(study, ctx.hmeta.latest);
  const [from, to] = window;
  const panel = priceGapPanel(ctx.members, window);
  const compute = (ms: Member[]) => values(ms, window, ctx.cpi);
  const file: PriceGapFile = {
    name: SLUG,
    slug: SLUG,
    built: ctx.hmeta.built,
    yearKind: study.yearKind,
    from,
    to,
    n: panel.length,
    lineFrom: from,
    resetThreshold: RESET_THRESHOLD,
    resets: tuitionResets(panel, window, ctx.cpi),
    national: nationalRow(panel, compute),
    groupings: study.groupings.map((g) => byGroup(panel, g, compute)),
  };
  const v = file.national.values!;
  return {
    name: SLUG,
    file,
    card: {
      slug: SLUG,
      title: study.title,
      headline: { value: v.avgPaidChange, format: "pct", caption: "change in what students pay on average, after inflation" },
      sentence:
        `At the median college, full price ${v.fullPriceChange >= 0 ? "rose" : "fell"} ${Math.abs(Math.round(v.fullPriceChange * 100))}% after inflation over ${to - from} years, ` +
        `while what students actually paid fell ${Math.abs(Math.round(v.avgPaidChange * 100))}%, and the discount off the sticker price grew.`,
      spark: {
        start: from,
        kind: study.yearKind,
        format: "num",
        series: [
          { name: "Full price, indexed", values: v.lines.fullPriceIndex },
          { name: "Average paid, indexed", values: v.lines.avgPaidIndex },
        ],
      },
      yearKind: study.yearKind,
      from,
      to,
      n: panel.length,
    },
  };
}

export const priceGap: TrendBuilder = { name: SLUG, build: buildPriceGap };
