/**
 * Study, the price gap (specs/trends/price-gap.md): the national row must equal data/history/facts.json's
 * `priceGap` exactly (the same fixed panel the Home page's fact 1 uses), and the public colleges' group is
 * recomputed from the committed shards without the shared helpers, with every money figure converted with the
 * stored CPI table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { CpiTable, HistoryMeta, SchoolHistory } from "../lib/history.ts";
import { GROUP_FLOOR } from "../lib/trend-groups.ts";
import type { PriceGapFile, PriceGapValues } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const file = JSON.parse(readFileSync(join(HISTORY, "trends", "price-gap.json"), "utf8")) as PriceGapFile;
const facts = JSON.parse(readFileSync(join(HISTORY, "facts.json"), "utf8")) as { priceGap: { from: number; to: number; n: number; fullPriceChange: number; avgPaidChange: number; fullPriceIndex: (number | null)[]; avgPaidIndex: (number | null)[] } };
const hmeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8")) as HistoryMeta;
const cpi = JSON.parse(readFileSync(join(HISTORY, "cpi.json"), "utf8")) as CpiTable;
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = readdirSync(join(HISTORY, "schools"))
  .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
  .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);

const val = (h: SchoolHistory, k: "full_price" | "avg_paid_all" | "grant_pct" | "grant_avg", y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? s.values[y - s.start] : null;
};
const cpiFor = (y: number): number | null => {
  const i = y - cpi.start;
  return i >= 0 && i < cpi.values.length ? cpi.values[i] : null;
};
const real = (value: number, year: number, base: number): number | null => {
  const from = cpiFor(year);
  const to = cpiFor(base);
  return from && to ? (value * to) / from : null;
};
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
};

const { from, to } = file;
const reports = (h: SchoolHistory, y: number) => val(h, "full_price", y) !== null && val(h, "avg_paid_all", y) !== null;
const panel = shards.filter((h) => [from, to].every((y) => reports(h, y)));

test("the panel is every college reporting both full price and average total cost at both window ends", () => {
  assert.equal(file.n, panel.length);
  assert.ok(file.n > 500, `panel of ${file.n} is implausibly small`);
  assert.equal(file.yearKind, "academic");
  assert.equal(to - from, 10);
  assert.equal(to, hmeta.latest.academic);
});

test("national row equals facts.json's priceGap exactly (same fixed panel, Home fact 1)", () => {
  assert.equal(facts.priceGap.from, from);
  assert.equal(facts.priceGap.to, to);
  assert.equal(facts.priceGap.n, file.n);
  assert.equal(file.national.n, facts.priceGap.n);
  const v = file.national.values!;
  assert.equal(v.fullPriceChange, facts.priceGap.fullPriceChange);
  assert.equal(v.avgPaidChange, facts.priceGap.avgPaidChange);
  assert.deepEqual(v.lines.fullPriceIndex, facts.priceGap.fullPriceIndex);
  assert.deepEqual(v.lines.avgPaidIndex, facts.priceGap.avgPaidIndex);
});

/** Median real (to-year-dollar) value of `key` in `year`, over the colleges that report it (the long way). */
function medianReal(hs: SchoolHistory[], key: "full_price" | "avg_paid_all", y: number): number | null {
  const vals = hs.map((h) => val(h, key, y)).filter((x): x is number => x !== null).map((x) => real(x, y, to)!);
  return vals.length ? median(vals) : null;
}

/** The public colleges' group, recomputed from the shards without lib/trend-panel.ts. */
function recomputePublic(): Pick<PriceGapValues, "fullPriceChange" | "avgPaidChange" | "discount" | "paidNow" | "grantPct"> {
  const hs = panel.filter((h) => byId.get(h.unit_id)!.type === "public");
  const base = { full: medianReal(hs, "full_price", from)!, paid: medianReal(hs, "avg_paid_all", from)! };
  const indexAt = (key: "full_price" | "avg_paid_all", y: number, base0: number) => Math.round((medianReal(hs, key, y)! / base0) * 1000) / 10;
  const round4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;
  // Each college's discount is rounded to 4 decimals first (as the builder does); the median of those isn't
  // rounded again, so an even-sized group can land on a 5th decimal (the average of two rounded values).
  const discountAt = (y: number) => median(hs.map((h) => round4(1 - val(h, "avg_paid_all", y)! / val(h, "full_price", y)!)));
  const grantPctAt = (y: number) => median(hs.map((h) => val(h, "grant_pct", y)).filter((x): x is number => x !== null));
  return {
    fullPriceChange: Math.round((indexAt("full_price", to, base.full) / 100 - 1) * 10_000) / 10_000,
    avgPaidChange: Math.round((indexAt("avg_paid_all", to, base.paid) / 100 - 1) * 10_000) / 10_000,
    discount: [discountAt(from), discountAt(to)],
    paidNow: Math.round(medianReal(hs, "avg_paid_all", to)!),
    grantPct: [Math.round(grantPctAt(from) * 10_000) / 10_000, Math.round(grantPctAt(to) * 10_000) / 10_000],
  };
}

test("public colleges recomputed from the shards: full price, average paid, discount, paid now, grant share", () => {
  const row = file.groupings.find((g) => g.grouping === "control")!.groups.find((r) => r.key === "public")!;
  const hs = panel.filter((h) => byId.get(h.unit_id)!.type === "public");
  assert.equal(row.n, hs.length);
  const want = recomputePublic();
  const v = row.values!;
  assert.equal(v.fullPriceChange, want.fullPriceChange);
  assert.equal(v.avgPaidChange, want.avgPaidChange);
  assert.deepEqual(v.discount, want.discount);
  assert.equal(v.paidNow, want.paidNow);
  assert.deepEqual(v.grantPct, want.grantPct);
});

test("every money figure is converted with the stored CPI table, in the newest year's dollars", () => {
  const v = file.national.values!;
  // The indexed lines are unitless (base 100), but paidNow and grantAvg must be plausible nominal dollars for the
  // panel's newest year: the median college pays a five-figure amount, and grants average a few thousand.
  assert.ok(v.paidNow > 5_000 && v.paidNow < 100_000, `paidNow ${v.paidNow}`);
  assert.ok(v.grantAvg[1] > 1_000 && v.grantAvg[1] < 60_000, `grantAvg ${v.grantAvg[1]}`);
  // A spot check: the newest year's dollars need no conversion, so avg_paid_all's raw value at `to` for one panel
  // college should already equal its real(…, to) value.
  const sample = panel.find((h) => val(h, "avg_paid_all", to) !== null)!;
  const raw = val(sample, "avg_paid_all", to)!;
  assert.equal(real(raw, to, to), raw);
});

test("groups under 30 colleges have no values; resets are within the panel and at or below the threshold", () => {
  let tooFew = 0;
  for (const g of file.groupings)
    for (const r of g.groups) {
      if (r.n < GROUP_FLOOR) {
        tooFew++;
        assert.equal(r.values, undefined, `${g.grouping}/${r.key}`);
      }
    }
  assert.ok(tooFew > 0, "today's panel has small groups (for-profits, territories), so the floor is exercised");
  const panelIds = new Set(panel.map((h) => h.unit_id));
  for (const r of file.resets) {
    assert.ok(panelIds.has(r.unitId), `${r.name} (${r.unitId}) isn't in the panel`);
    assert.ok(r.drop <= file.resetThreshold, `${r.name}: ${r.drop} isn't at or below the threshold`);
    assert.ok(r.year >= from && r.year < to, `${r.name}: ${r.year} is outside the window`);
  }
  assert.deepEqual(
    [...file.resets].sort((a, b) => a.drop - b.drop),
    file.resets,
    "resets are sorted biggest drop first"
  );
});
