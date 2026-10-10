/**
 * Compare and Explore for cost by income (specs/product/cost-by-income.md "Compare", "Explore", "Wording"): the three
 * Compare rows' values, the price at an income and its wording (gate open and closed), Explore's chips, sort option
 * and merit count, and the guards that a modeled figure carries the word "estimate". `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { costCurve, costCurveInput, INCOME_MAX, type CostCurveInput } from "../lib/cost-curve.ts";
import type { AidPolicy } from "../lib/aid-policies.ts";
import { aidPolicyFor } from "../lib/aid-policies.ts";
import { FIELDS } from "../lib/fields.ts";
import {
  BREAK_POINT_LABEL,
  COST_BY_INCOME_FIELDS,
  MERIT_LABEL,
  PROMISE_LABEL,
  costByIncomeRows,
} from "../lib/compare-cost-rows.ts";
import {
  DATA_END_MESSAGE,
  LITTLE_AID_MESSAGE,
  TABLE_INCOMES,
  breakPointText,
  dollarsK,
  incomeLabel,
  meritNote,
  meritText,
  priceLine,
  priceText,
  promiseText,
} from "../lib/cost-at-income.ts";
import { costFilterChips, priceAtSortOption } from "../lib/cost-explore.ts";
import { COMPARE_TOPIC_FIELDS, TABLE_GROUPS } from "../lib/compare-topics.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import type { MeritInfo } from "../lib/merit.ts";
import type { School } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;
const HARVARD = "166027";
const VANDERBILT = "221999";
const MICHIGAN = "170976";

const label = (rows: ReturnType<typeof costByIncomeRows>, name: string) => rows.find((r) => r[0] === name)!;
const cell = (showEstimates: boolean, name: string, id: string, opts?: { withYear?: boolean }) => label(costByIncomeRows(showEstimates, opts), name)[3](byId(id));

/** A rich private college: published steps, a $110K+ band well under the full price, need met unknown. */
const PRIVATE: CostCurveInput = { coa: 88_000, bands: [2_000, 3_000, 6_000, 14_000, 48_000], policy: null, needMet: null, type: "private-nonprofit", tuition: 64_000 };
const curve = (input: Partial<CostCurveInput> = {}) => {
  const c = costCurve({ ...PRIVATE, ...input });
  assert.ok(c, "has a curve");
  return c;
};
const policy = (p: Partial<AidPolicy>): AidPolicy => ({
  unit_id: "x",
  as_of: "2025-26",
  free_tuition_under: null,
  no_contribution_under: null,
  meets_full_need: null,
  no_loans: null,
  need_only: null,
  home_equity: null,
  siblings: null,
  siblings_note: null,
  source: "https://example.edu/aid",
  checked: "2026-10-10",
  verified_via: "page",
  ...p,
});
const merit = (m: Partial<MeritInfo>): MeritInfo => ({ cls: "unknown", share: null, avg: null, source: null, ...m });

/* ------------------------------------------------------------------ */
/* Compare rows                                                        */
/* ------------------------------------------------------------------ */

test("the three rows are registered, cited, and on the Cost & aid page's and the table's field lists", () => {
  const rows = costByIncomeRows(true);
  assert.deepEqual(rows.map((r) => r[0]), [BREAK_POINT_LABEL, MERIT_LABEL, PROMISE_LABEL]);
  for (const f of COST_BY_INCOME_FIELDS) assert.ok(f in FIELDS, `${f} is registered`);
  for (const r of rows) {
    assert.ok(r[2] in FIELDS, `${r[0]} cites a registered field`);
    assert.ok(COMPARE_TOPIC_FIELDS.cost.includes(r[2]), `${r[0]}: the topic page cites ${r[2]}`);
    assert.ok(COMPARE_TOPIC_FIELDS.table.includes(r[2]), `${r[0]}: the table cites ${r[2]}`);
  }
  // They are appended to the table's Cost & aid group at render time (they take the gate), so no static group has them.
  const staticLabels = TABLE_GROUPS.flatMap((g) => g.rows.map((r) => r[0]));
  for (const r of rows) assert.ok(!staticLabels.includes(r[0]), `${r[0]} isn't a static row`);
});

test("Need-based aid up to: a range with 'estimate' while estimates are shown, 'Published data end at $110K' when not", () => {
  assert.equal(cell(true, BREAK_POINT_LABEL, HARVARD), "About $240K (estimate, $240K–$250K)");
  assert.equal(cell(true, BREAK_POINT_LABEL, VANDERBILT), "About $300K (estimate, $280K–$330K)");
  assert.equal(cell(true, BREAK_POINT_LABEL, MICHIGAN), "About $190K (estimate, $160K–$220K)");
  for (const id of [HARVARD, VANDERBILT, MICHIGAN]) assert.equal(cell(false, BREAK_POINT_LABEL, id), DATA_END_MESSAGE);
  assert.equal(DATA_END_MESSAGE, "Published data end at $110K");
});

test("break point wording: little aid, data ends, a single value, and beyond the chart's edge", () => {
  assert.equal(breakPointText(null, true), null);
  assert.equal(breakPointText(curve({ needMet: 0.7 }), true), LITTLE_AID_MESSAGE);
  assert.equal(breakPointText(curve({ needMet: 0.7 }), false), LITTLE_AID_MESSAGE, "from published data, so not gated");
  assert.equal(LITTLE_AID_MESSAGE, "Little need-based aid above $110K");
  assert.equal(breakPointText(curve({ bands: [2_000, 3_000, 6_000, 14_000, null] }), true), DATA_END_MESSAGE);
  const c = curve();
  assert.equal(c.status, "break_point");
  const b = c.breakIncome!;
  assert.match(breakPointText(c, true)!, /\(estimate/);
  const same = { ...c, breakIncome: { mid: 300_000, lo: 300_000, hi: 300_000 } };
  assert.equal(breakPointText(same, true), "About $300K (estimate)");
  const edge = { ...c, breakIncome: { mid: 430_000, lo: 390_000, hi: 470_000 } };
  assert.equal(breakPointText(edge, true), "$390K to above $400K (estimate)");
  const past = { ...c, breakIncome: { mid: 520_000, lo: 430_000, hi: 600_000 } };
  assert.equal(breakPointText(past, true), "Above $400K (estimate)");
  assert.ok(b.lo <= b.mid && b.mid <= b.hi);
});

test("Merit for students without need: need-only, reported, proxy (labeled), and unknown", () => {
  assert.equal(cell(true, MERIT_LABEL, HARVARD), "No merit aid");
  assert.equal(cell(true, MERIT_LABEL, VANDERBILT), "8.2% got merit aid, averaging $33K");
  assert.equal(cell(true, MERIT_LABEL, MICHIGAN), null, "unknown prints a dash, not a claim");
  assert.equal(meritText(merit({ cls: "merit_reported", share: 0.18, avg: 22_400 })), "18% got merit aid, averaging $22K");
  assert.equal(meritText(merit({ cls: "merit_reported", share: null, avg: 22_400 })), "Offers merit aid, averaging $22K");
  assert.equal(meritText(merit({ cls: "merit_reported", share: 0.18, avg: null })), "18% got merit aid");
  assert.equal(meritText(merit({ cls: "merit_proxy", share: 0.12, avg: 15_000 })), "12% got a grant without federal aid, averaging $15K (proxy)");
  assert.equal(meritText(merit({ cls: "merit_proxy", share: null, avg: null })), "Grants without federal aid (proxy)");
  assert.equal(meritText(merit({ cls: "need_only" })), "No merit aid");
  assert.equal(meritText(merit({})), null);
});

test("Published promise: the college's income lines, '(in-state)' where they apply to residents, with the award year on the topic page", () => {
  assert.equal(cell(true, PROMISE_LABEL, HARVARD), "Families pay nothing toward cost under $100K; No tuition under $200K · 2025–26");
  assert.equal(cell(true, PROMISE_LABEL, MICHIGAN), "No tuition under $125K (in-state) · 2026–27");
  assert.equal(aidPolicyFor(MICHIGAN)?.applies_to, "in_state");
  // The table adds a cell's own year beside the value, so its rows leave it out of the text.
  assert.equal(cell(true, PROMISE_LABEL, MICHIGAN, { withYear: false }), "No tuition under $125K (in-state)");
  assert.equal(cell(true, PROMISE_LABEL, "100654"), null, "a college with no entry has no promise to show");
  const c = curve({ policy: policy({ free_tuition_under: 200_000, no_contribution_under: 100_000 }) });
  assert.equal(promiseText(c), "Families pay nothing toward cost under $100K; No tuition under $200K");
  assert.equal(promiseText(curve()), null);
  assert.equal(promiseText(null), null);
});

test("promises don't depend on the gate; the gate changes only the estimate", () => {
  for (const id of [HARVARD, VANDERBILT, MICHIGAN]) {
    assert.equal(cell(true, PROMISE_LABEL, id), cell(false, PROMISE_LABEL, id));
    assert.equal(cell(true, MERIT_LABEL, id), cell(false, MERIT_LABEL, id));
  }
});

/* ------------------------------------------------------------------ */
/* Price at an income                                                  */
/* ------------------------------------------------------------------ */

test("price at an income: published to $110K, an estimate range above, full price past the break point", () => {
  const c = curve();
  const published = priceText(c, 60_000, true);
  assert.deepEqual([published.kind, published.estimate, published.value], ["published", false, "$6K"]);
  const mid = priceText(c, 200_000, true);
  assert.equal(mid.kind, "estimate");
  assert.equal(mid.estimate, true);
  assert.match(mid.value!, /^\$\d+K(–\$\d+K)?$/);
  assert.ok(mid.lo! >= 14_000 && mid.hi! <= 88_000 && mid.lo! <= mid.hi!, "between the last published step and the full price");
  const full = priceText(c, INCOME_MAX, true);
  assert.deepEqual([full.kind, full.estimate, full.value, full.lo, full.hi], ["full_price", true, "$88K", 88_000, 88_000]);
  // Never NaN: a price that can't be given has no value and says why.
  const gap = priceText(curve({ bands: [2_000, null, 6_000, 14_000, 48_000] }), 40_000, true);
  assert.deepEqual([gap.kind, gap.value, gap.message, gap.lo], ["unknown", null, "Not reported", null]);
  const none = priceText(null, 150_000, true);
  assert.deepEqual([none.kind, none.value, none.message], ["none", null, "No full price reported"]);
});

test("price at an income with estimates hidden: published incomes keep their prices, higher ones say the data end", () => {
  const c = curve();
  assert.equal(priceText(c, 100_000, false).value, "$14K");
  assert.equal(priceText(c, 110_000, false).value, "$14K", "$110K is the last band's");
  for (const income of [125_000, 150_000, 250_000, INCOME_MAX]) {
    const t = priceText(c, income, false);
    assert.deepEqual([t.kind, t.value, t.estimate, t.message], ["unknown", null, false, DATA_END_MESSAGE], String(income));
  }
  // A college with little need-based aid says so instead, gate or not.
  const little = curve({ needMet: 0.7 });
  assert.equal(priceText(little, 150_000, true).message, LITTLE_AID_MESSAGE);
  assert.equal(priceText(little, 150_000, false).message, LITTLE_AID_MESSAGE);
  assert.equal(priceText(little, 60_000, true).value, "$6K", "the published part stands");
});

test("an estimated or full-price figure is flagged as an estimate; a published one isn't (every income, both gates)", () => {
  for (const gate of [true, false]) {
    for (const row of TABLE_INCOMES) {
      const t = priceText(curve(), row.income, gate);
      assert.equal(t.estimate, t.kind === "estimate" || t.kind === "full_price", `${row.label} gate ${gate}`);
      if (t.kind === "published") assert.equal(t.estimate, false);
    }
  }
});

test("the card and row line: 'About $41K at $200K', 'estimate' flagged, why when there's no price", () => {
  const c = curve();
  const pub = priceLine(c, 60_000, true);
  assert.deepEqual(pub, { text: "About $6K at $60K", estimate: false, kind: "published" });
  const est = priceLine(c, 200_000, true);
  assert.match(est.text, /^About \$\d+K(–\$\d+K)? at \$200K$/);
  assert.equal(est.estimate, true);
  assert.equal(priceLine(c, 400_000, true).text, "Full price, $88K, at $400K or more");
  assert.deepEqual(priceLine(c, 200_000, false), { text: DATA_END_MESSAGE, estimate: false, kind: "unknown" });
  assert.equal(priceLine(null, 200_000, true).text, "No full price reported");
  // Real colleges: published at $60K whatever the gate; estimated at $150K only with it.
  const h = costCurve(costCurveInput(byId(HARVARD)));
  assert.equal(priceLine(h, 150_000, true).text, "About $28K at $150K");
  assert.equal(priceLine(h, 150_000, false).text, DATA_END_MESSAGE);
  assert.equal(priceLine(h, 250_000, true).text, "Full price, $87K, at $250K");
});

test("the incomes: rounded to $1K, '$400K or more' at the chart's edge; the table lists the bands then the pilot's incomes", () => {
  assert.equal(dollarsK(41_240), "$41K");
  assert.equal(dollarsK(41_600), "$42K");
  assert.equal(incomeLabel(200_000), "$200K");
  assert.equal(incomeLabel(INCOME_MAX), "$400K or more");
  assert.deepEqual(
    TABLE_INCOMES.map((r) => r.income),
    [0, 30_000, 48_000, 75_000, 125_000, 150_000, 200_000, 250_000, 300_000, 350_000, INCOME_MAX],
  );
  assert.deepEqual(TABLE_INCOMES.slice(0, 4).map((r) => r.label), ["$0–30K", "$30–48K", "$48–75K", "$75–110K"]);
});

test("merit note under a bar: merit possible above $110K where offered, no merit past the break point where not", () => {
  const reported = merit({ cls: "merit_reported", share: 0.18, avg: 22_000 });
  assert.equal(meritNote(reported, "estimate", 200_000), "Merit possible; averaging $22K");
  assert.equal(meritNote(reported, "published", 60_000), null, "below $110K the published prices stand alone");
  assert.equal(meritNote(merit({ cls: "merit_proxy", share: 0.1, avg: 15_000 }), "full_price", 300_000), "Merit possible (proxy); averaging $15K");
  assert.equal(meritNote(merit({ cls: "need_only" }), "full_price", 300_000), "No merit aid: everyone pays the full price");
  assert.equal(meritNote(merit({ cls: "need_only" }), "estimate", 200_000), null, "aid still reaches this income");
  assert.equal(meritNote(merit({}), "full_price", 300_000), null);
});

/* ------------------------------------------------------------------ */
/* Explore                                                             */
/* ------------------------------------------------------------------ */

test("chips: the break-point filter (only while estimates are shown), merit, and the income with its sort", () => {
  const url = (q: Record<string, string>) => (k: string) => q[k] ?? null;
  assert.deepEqual(costFilterChips(url({}), true), []);
  assert.deepEqual(costFilterChips(url({ minAidIncome: "250000" }), true), [
    { key: "minAidIncome", label: "Need-based aid reaches $250K+ (estimate)", clears: ["minAidIncome"] },
  ]);
  assert.deepEqual(costFilterChips(url({ minAidIncome: "250000" }), false), [], "no chip for a filter that does nothing");
  assert.deepEqual(costFilterChips(url({ merit: "1" }), false), [{ key: "merit", label: "Offers merit aid", clears: ["merit"] }]);
  assert.deepEqual(costFilterChips(url({ merit: "0" }), true), []);
  assert.deepEqual(costFilterChips(url({ income: "200000" }), true), [{ key: "income", label: "Prices at $200K income", clears: ["income"] }]);
  assert.deepEqual(costFilterChips(url({ income: "0" }), true).map((c) => c.label), ["Prices at $0K income"]);
  // Removing the income also drops a price sort, which has nothing to price without it.
  assert.deepEqual(costFilterChips(url({ income: "200000", sortBy: "price_at" }), true)[0].clears, ["income", "sortBy", "sortDir"]);
  assert.deepEqual(costFilterChips(url({ income: "x", minAidIncome: "-1" }), true), []);
  assert.deepEqual(
    costFilterChips(url({ minAidIncome: "300000", merit: "1", income: "150000" }), true).map((c) => c.key),
    ["minAidIncome", "merit", "income"],
  );
});

test("sort: 'Price at income' is offered only while an income is set", () => {
  assert.equal(priceAtSortOption(null), null);
  assert.equal(priceAtSortOption(""), null);
  assert.equal(priceAtSortOption("abc"), null);
  assert.deepEqual(priceAtSortOption("200000"), { value: "price_at", label: "Price at $200K income (lowest)", dir: "asc" });
});

test("URL params: the new filters parse and count as active, the income doesn't", () => {
  const f = parseFilters({ minAidIncome: "250000", sortBy: "price_at", income: "200000", merit: "1" });
  assert.deepEqual([f.minAidIncome, f.sortBy, f.income, f.merit], [250_000, "price_at", 200_000, true]);
  assert.equal(parseFilters({ income: "0" }).income, 0, "an income of $0 is an income");
  assert.equal(countActiveFilters({ minAidIncome: "250000", merit: "1", income: "200000", sortBy: "price_at" }), 2);
});

// lib/dataset.ts and its imports are written for the Next bundler (extensionless relative imports), which plain Node
// can't resolve; map them to files for the dataset test (as tests/cost-curve.test.mts does).
type ResolveResult = { url: string; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: NextResolve): ResolveResult }): void;
};
function asFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  return null;
}
registerHooks({
  resolve(specifier, context, next) {
    let base: string | null = null;
    if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:"))
      base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = base && !/\.tsx?$/.test(base) ? asFile(base) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { createDataset } = await import("../lib/dataset.ts");
const read = (file: string) => JSON.parse(readFileSync(join(ROOT, "data", file), "utf8"));
const data = createDataset({ schools, meta: read("meta.json"), releaseCalendar: read("release-calendar.json") });

test("the filter panel's merit count is the number of colleges the filter keeps", () => {
  assert.equal(data.facets().merit, data.getSchools({ merit: true }).length);
  assert.ok(data.facets().merit > 0);
});

test("Explore's lines read the dataset's memoized curves, and the sort matches the line's price", () => {
  const sorted = data.getSchools({ sortBy: "price_at", income: 60_000, showEstimates: false }).slice(0, 5);
  const mids = sorted.map((s) => {
    const t = priceText(data.costCurveFor(s), 60_000, false);
    return (t.lo! + t.hi!) / 2;
  });
  assert.deepEqual(mids, [...mids].sort((a, b) => a - b));
  const h = data.getSchoolById(HARVARD)!;
  assert.equal(priceLine(data.costCurveFor(h), 150_000, true).text, "About $28K at $150K");
});

/* ------------------------------------------------------------------ */
/* Guards in the components                                            */
/* ------------------------------------------------------------------ */

const source = (file: string) => readFileSync(join(ROOT, file), "utf8");

test("every component that shows a modeled price renders the word 'estimate' when the figure is modeled", () => {
  for (const file of ["components/compare/NetPriceAtIncome.tsx", "components/school/SchoolCard.tsx", "components/school/SchoolRow.tsx"]) {
    const src = source(file);
    assert.match(src, /\.estimate\b[^\n]*(&&|\?)[^\n]*estimate|estimated && /, `${file} must render "estimate" beside a modeled figure`);
  }
  assert.match(source("components/compare/NetPriceAtIncome.tsx"), /showEstimates/, "the chart takes the pilot's gate as a prop");
});

test("the pages decide the gate on the server and pass it down", () => {
  assert.match(source("app/explore/page.tsx"), /showEstimates = estimatesShown\(\)/);
  assert.match(source("app/explore/page.tsx"), /filters\.showEstimates = showEstimates/);
  assert.match(source("app/compare/cost/page.tsx"), /showEstimates = estimatesShown\(\)/);
  assert.match(source("app/compare/table/page.tsx"), /costByIncomeRows\(estimatesShown\(\)/);
  assert.doesNotMatch(source("components/compare/NetPriceAtIncome.tsx"), /estimatesShown\(/, "the browser can't read the deployment's environment");
});
