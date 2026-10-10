/**
 * The cost curve (specs/product/cost-by-income.md "The model", "Tests"): published steps to $110K, the calibrated
 * estimate above, the break point, the statuses, promises, the pilot's gate, and the dataset's filters and sort.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BAND_SPREAD,
  DEFAULT_RAMP_START,
  FEDERAL_TOP,
  INCOME_MAX,
  R_MAX,
  R_MIN,
  calibrationAverage,
  costCurve,
  costCurveInput,
  curvePoints,
  estimatesShown,
  priceAt,
  referenceSamples,
  type CostCurve,
  type CostCurveInput,
} from "../lib/cost-curve.ts";
import type { AidPolicy } from "../lib/aid-policies.ts";
import type { School } from "../lib/types.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import pilot from "../data/reference/cost-curve-pilot.json" with { type: "json" };
import reference from "../data/reference/income-above-110k.json" with { type: "json" };

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

/** A rich private college: published steps, a $110K+ band well under the full price, need met unknown. */
const PRIVATE: CostCurveInput = { coa: 88_000, bands: [2_000, 3_000, 6_000, 14_000, 48_000], policy: null, needMet: null, type: "private-nonprofit", tuition: 64_000 };

const policy = (p: Partial<AidPolicy>): AidPolicy => ({
  unit_id: "x",
  as_of: "test",
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

const curve = (input: Partial<CostCurveInput> = {}): CostCurve => {
  const c = costCurve({ ...PRIVATE, ...input });
  assert.ok(c, "has a curve");
  return c;
};

test("published steps: the four federal bands to $110K, a missing band left out, no curve without a full price", () => {
  const c = curve();
  assert.deepEqual(c.published.map((p) => [p.lo, p.hi, p.price]), [
    [0, 30_000, 2_000],
    [30_000, 48_000, 3_000],
    [48_000, 75_000, 6_000],
    [75_000, 110_000, 14_000],
  ]);
  assert.deepEqual(priceAt(c, 50_000, false), { lo: 6_000, hi: 6_000, kind: "published" });
  assert.deepEqual(priceAt(c, FEDERAL_TOP, false), { lo: 14_000, hi: 14_000, kind: "published" }, "$110K is the last band's");
  const gap = curve({ bands: [2_000, null, 6_000, 14_000, 48_000] });
  assert.equal(gap.published.length, 3);
  assert.equal(priceAt(gap, 40_000, true).kind, "unknown");
  assert.ok(Number.isNaN(priceAt(gap, 40_000, true).lo));
  assert.equal(costCurve({ ...PRIVATE, coa: null }), null);
  assert.equal(costCurve({ ...PRIVATE, coa: 0 }), null);
});

test("the estimate joins the published steps without a jump", () => {
  // Including a low last step, where an unconstrained ramp from P = $90K would already be above it at $110K.
  for (const bands of [PRIVATE.bands!, [1_000, 1_500, 2_000, 4_000, 36_000]]) {
    const c = curve({ bands });
    assert.equal(c.status, "break_point");
    const at110 = priceAt(c, FEDERAL_TOP, true).lo;
    const after = priceAt(c, FEDERAL_TOP + 1, true);
    assert.equal(after.kind, "estimate");
    assert.ok(Math.abs(after.lo - at110) < 1 && Math.abs(after.hi - at110) < 1, `joins at ${at110}: ${after.lo}–${after.hi}`);
  }
});

test("the curve rises to the full price and stays there; the range brackets the middle", () => {
  const c = curve();
  const pts = curvePoints(c, true);
  assert.equal(pts[0].income, 0);
  assert.equal(pts[pts.length - 1].income, INCOME_MAX);
  assert.ok(pts.some((p) => p.income === FEDERAL_TOP));
  let last = -Infinity;
  for (const p of pts.filter((q) => q.income > FEDERAL_TOP)) {
    assert.ok(p.mid >= last - 1e-6, `non-decreasing at ${p.income}`);
    assert.ok(p.lo <= p.hi && p.hi <= c.coa);
    last = p.mid;
  }
  assert.deepEqual(priceAt(c, INCOME_MAX, true), { lo: c.coa, hi: c.coa, kind: "full_price" });
  const brk = c.breakIncome!;
  assert.ok(brk.lo <= brk.mid && brk.mid <= brk.hi);
  assert.equal(brk.mid % 10_000, 0, "rounded to $10K");
  assert.equal(priceAt(c, brk.hi + 10_000, true).kind, "full_price");
  assert.equal(priceAt(c, brk.lo - 20_000, true).kind, "estimate");
});

test("calibration reproduces the published $110K+ band within $50, here and at every college that gets an estimate", () => {
  for (const bands of [PRIVATE.bands!, [5_000, 7_000, 12_000, 20_000, 40_000], [1_000, 1_500, 2_000, 4_000, 36_000]]) {
    const c = curve({ bands });
    assert.ok(Math.abs(calibrationAverage(c)! - bands[4]!) <= 50, `${bands[4]}: ${calibrationAverage(c)}`);
  }
  let checked = 0;
  for (const s of schools) {
    const input = costCurveInput(s, null);
    const c = costCurve(input);
    if (c?.status !== "break_point") continue;
    checked++;
    const avg = calibrationAverage(c)!;
    assert.ok(Math.abs(avg - input.bands![4]!) <= 50, `${s.name}: ${avg} vs ${input.bands![4]}`);
    assert.ok(c.ramp!.r >= R_MIN && c.ramp!.r <= R_MAX);
  }
  assert.ok(checked > 300, `${checked} colleges get an estimate`);
});

test("the break point moves the right way with the full price and with r", () => {
  const base = curve();
  // A higher full price, same published figures: more to pay before aid runs out.
  assert.ok(curve({ coa: 95_000 }).breakIncome!.mid > base.breakIncome!.mid);
  // A higher $110K+ band means families pay more of each dollar (higher r), so aid ends sooner.
  const steeper = curve({ bands: [2_000, 3_000, 6_000, 14_000, 52_000] });
  assert.ok(steeper.ramp!.r > base.ramp!.r);
  assert.ok(steeper.breakIncome!.mid < base.breakIncome!.mid);
  // The break point is where the ramp meets the full price.
  const { P, r } = base.ramp!;
  assert.equal(base.breakIncome!.mid, Math.round((P + base.coa / r) / 10_000) * 10_000);
});

test("the range comes from the band's ±$1K and P's ±$10K, and the starting income defaults to the federal protection", () => {
  const c = curve();
  assert.ok(c.ramp!.rLo < c.ramp!.r && c.ramp!.r < c.ramp!.rHi);
  assert.equal(c.ramp!.P, DEFAULT_RAMP_START);
  const tighter = curve({ bands: [2_000, 3_000, 6_000, 14_000, 48_000 + BAND_SPREAD] });
  assert.ok(tighter.ramp!.r <= c.ramp!.rHi + 1e-9, "the band + $1K is inside the range");
  const withLine = curve({ policy: policy({ no_contribution_under: 120_000 }), bands: [2_000, 3_000, 6_000, 14_000, 40_000] });
  assert.equal(withLine.ramp!.P, 120_000, "a published no-contribution line is P");
  assert.deepEqual(withLine.promises.map((p) => p.kind), ["no_contribution"]);
});

test("a free-tuition promise constrains the ramp: the price at its income stays at or under the full price minus tuition", () => {
  const free = policy({ free_tuition_under: 150_000 });
  const figures = { bands: [2_000, 3_000, 6_000, 14_000, 40_000], tuition: 70_000 };
  const cap = PRIVATE.coa! - figures.tuition;
  const pinned = curve({ policy: free, ...figures });
  assert.equal(pinned.status, "break_point");
  assert.deepEqual(pinned.ramp!.pin, { income: 150_000, price: cap }, "the promise pins the ramp");
  assert.ok(pinned.ramp!.P > DEFAULT_RAMP_START, "the ramp starts later");
  for (const income of [120_000, 150_000]) {
    const at = priceAt(pinned, income, true);
    assert.ok(at.hi <= cap + 1, `${income}: ${at.hi} ≤ ${cap}`);
  }
  assert.ok(Math.abs(calibrationAverage(pinned)! - 40_000) <= 50, "still reproduces the band");
  assert.deepEqual(pinned.promises, [{ income: 150_000, kind: "free_tuition", label: "No tuition under $150K" }]);
  // Without the promise the same figures start at P and break the promise.
  const unpinned = curve(figures);
  assert.equal(unpinned.ramp!.pin, undefined);
  assert.ok(priceAt(unpinned, 150_000, true).hi > cap);
  // A promise at or under $110K, or without tuition, doesn't pin anything.
  assert.equal(curve({ policy: policy({ free_tuition_under: 100_000 }), ...figures }).ramp!.pin, undefined);
  assert.equal(curve({ policy: free, ...figures, tuition: null }).ramp!.pin, undefined);
  // A promise the band can't agree with: the estimate is calibrated on the band alone and the promise is flagged.
  const clash = curve({ policy: policy({ free_tuition_under: 250_000 }) });
  assert.equal(clash.status, "break_point");
  assert.equal(clash.ramp!.pin, undefined);
  assert.equal(clash.promises[0].disagrees, true);
});

test("a college that doesn't meet full need gets 'little need-based aid above $110K'", () => {
  assert.equal(curve({ needMet: 0.85 }).status, "little_above_110k");
  assert.equal(curve({ needMet: 0.85 }).ramp, null);
  assert.equal(curve({ needMet: 0.95 }).status, "break_point");
  // Without need-met data, a $110K+ band at 85% of the full price or more.
  assert.equal(curve({ bands: [2_000, 3_000, 6_000, 14_000, 0.86 * 88_000] }).status, "little_above_110k");
  assert.notEqual(curve({ bands: [2_000, 3_000, 6_000, 14_000, 0.86 * 88_000], needMet: 1 }).status, "little_above_110k", "need met known wins");
});

test("out-of-range calibration and a missing band give no estimate ('data_ends')", () => {
  // The band barely above the last step: r would be under the lower bound.
  const flat = curve({ bands: [20_000, 21_000, 22_000, 24_000, 25_000], coa: 60_000 });
  assert.equal(flat.status, "data_ends");
  assert.equal(flat.breakIncome, null);
  assert.equal(priceAt(flat, 200_000, true).kind, "unknown");
  // A band too high for any r up to the bound at a college that meets full need.
  assert.equal(curve({ bands: [2_000, 3_000, 6_000, 14_000, 80_000], needMet: 1 }).status, "data_ends");
  assert.equal(curve({ bands: [2_000, 3_000, 6_000, 14_000, null] }).status, "data_ends");
  assert.equal(curve({ bands: null }).status, "data_ends");
});

test("estimates are gated: hidden in production until the pilot passes, and priceAt then knows nothing above $110K", () => {
  assert.equal(estimatesShown("production"), pilot.passed === true);
  assert.equal(estimatesShown("preview"), true);
  assert.equal(estimatesShown("development"), true);
  assert.equal(estimatesShown(undefined), true, "local dev has no VERCEL_ENV");
  const c = curve();
  for (const income of [120_000, 200_000, INCOME_MAX]) assert.equal(priceAt(c, income, false).kind, "unknown");
  const hidden = curvePoints(c, false);
  assert.ok(hidden.every((p) => p.income <= FEDERAL_TOP || p.kind === "unknown"));
  assert.ok(hidden.some((p) => p.kind === "published"));
  // Shown, the same points include estimates: the guard above isn't vacuous.
  assert.ok(curvePoints(c, true).some((p) => p.kind === "estimate"));
});

test("costCurveInput: in-state full price and tuition at publics, the CDS need met, the published policy", () => {
  const unc = schools.find((s) => s.unit_id === "199120")!;
  const input = costCurveInput(unc, null);
  assert.equal(input.coa, unc.cost!.sticker!.in_state);
  assert.equal(input.tuition, unc.cost!.tuition_fees!.in_state);
  const vandy = schools.find((s) => s.unit_id === "221999")!;
  const v = costCurveInput(vandy, null);
  assert.equal(v.coa, vandy.cost!.breakdown!.full_price);
  assert.equal(v.needMet, vandy.reported!.aid!.first_years!.i);
  assert.deepEqual(v.bands, vandy.cost!.net_price_by_income);
  const p = policy({ unit_id: vandy.unit_id });
  assert.equal(costCurveInput(vandy, p).policy, p);
});

test("the reference distribution is cited and samples only incomes above $110K", () => {
  assert.ok(reference.source.startsWith("https://"));
  assert.ok(reference.table && reference.year && reference.notes.length > 0);
  const total = reference.brackets.reduce((a, b) => a + b.share, 0);
  assert.ok(Math.abs(total - 1) < 0.005, `shares sum to ${total}`);
  const { income, weight } = referenceSamples();
  assert.ok(Math.abs(weight.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(income.every((x) => x > FEDERAL_TOP && x <= reference.cap));
  // A bracket straddling $110K keeps only its part above it: the $100–150K bracket contributes 40/50 of its share.
  const below150 = weight.filter((_, i) => income[i] < 150_000).reduce((a, b) => a + b, 0);
  const share = (0.167 * 40) / 50;
  assert.ok(Math.abs(below150 - share / (share + 0.101 + 0.16)) < 1e-9);
});

test("the pilot template lists the spec's 25 colleges with their calculators", () => {
  assert.equal(pilot.colleges.length, 25);
  const count = (g: string) => pilot.colleges.filter((c) => c.group === g).length;
  assert.deepEqual([count("need_only"), count("merit"), count("public")], [10, 8, 7]);
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  for (const c of pilot.colleges) {
    assert.ok(byId.has(c.unit_id), `${c.name} is in the dataset`);
    assert.equal(c.npc_url, byId.get(c.unit_id)!.links?.price_calculator ?? null);
  }
  for (const name of ["Harvard", "Massachusetts Institute", "Princeton", "Stanford", "Pennsylvania", "Vanderbilt", "Southern California", "Emory", "Tulane", "Wake Forest", "Alabama", "Arizona State", "North Carolina at Chapel Hill", "Michigan-Ann Arbor", "Florida", "Georgia", "Ohio State"])
    assert.ok(pilot.colleges.some((c) => c.name.includes(name)), name);
  assert.deepEqual(pilot.incomes, [125_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000]);
});

test("params: minAidIncome, merit, and income parse; the two filters count as active, income doesn't", () => {
  const f = parseFilters({ minAidIncome: "250000", merit: "1", income: "200000", sortBy: "price_at" });
  assert.equal(f.minAidIncome, 250_000);
  assert.equal(f.merit, true);
  assert.equal(f.income, 200_000);
  assert.equal(f.sortBy, "price_at");
  assert.equal(f.sortDir, "asc", "cheapest first");
  assert.equal(parseFilters({ minAidIncome: "-5", merit: "0", income: "x" }).minAidIncome, undefined);
  assert.equal(parseFilters({ merit: "0" }).merit, undefined);
  assert.equal(parseFilters({ income: "x" }).income, undefined);
  assert.equal(countActiveFilters({ minAidIncome: "250000", merit: "1", income: "200000" }), 2);
});

// lib/dataset.ts and its imports are written for the Next bundler (extensionless relative imports), which plain Node
// can't resolve; map them to files for the dataset tests (as tests/explore-cost.test.mts does).
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

test("dataset: costCurveFor and meritInfoFor are memoized per school", () => {
  const s = data.getSchoolById("221999")!;
  assert.equal(data.costCurveFor(s), data.costCurveFor(s));
  assert.equal(data.meritInfoFor(s), data.meritInfoFor(s));
  assert.equal(data.meritInfoFor(s).cls, "merit_reported");
});

test("dataset: 'need-based aid reaches $X+' keeps break points at or above X, only while estimates are shown", () => {
  const all = data.getSchools({});
  const kept = data.getSchools({ minAidIncome: 250_000, showEstimates: true });
  assert.ok(kept.length > 0 && kept.length < all.length);
  for (const s of kept) {
    const c = data.costCurveFor(s)!;
    assert.equal(c.status, "break_point");
    assert.ok(c.breakIncome!.mid >= 250_000);
  }
  assert.equal(data.getSchools({ minAidIncome: 250_000 }).length, all.length, "gate closed: the estimate filters nothing");
});

test("dataset: 'offers merit aid' and the price-at-income sort (unknowns last)", () => {
  const merit = data.getSchools({ merit: true });
  assert.ok(merit.length > 0);
  assert.ok(merit.every((s) => ["merit_reported", "merit_proxy"].includes(data.meritInfoFor(s).cls)));
  const sorted = data.getSchools({ sortBy: "price_at", income: 200_000, showEstimates: true });
  const mids = sorted.map((s) => {
    const c = data.costCurveFor(s);
    const p = c ? priceAt(c, 200_000, true) : null;
    return p && p.kind !== "unknown" ? (p.lo + p.hi) / 2 : null;
  });
  const firstNull = mids.indexOf(null);
  assert.ok(firstNull > 0, "some colleges have a price at $200K");
  assert.ok(mids.slice(firstNull).every((m) => m === null), "unknowns last");
  const known = mids.slice(0, firstNull) as number[];
  assert.ok(known.every((m, i) => i === 0 || m >= known[i - 1]), "ascending");
  // Gate closed: nothing above $110K is known, so nothing sorts on it; published incomes still sort.
  assert.ok(data.getSchools({ sortBy: "price_at", income: 200_000 }).every((s, i, arr) => i === 0 || s.name.localeCompare(arr[i - 1].name) >= 0));
  const low = data.getSchools({ sortBy: "price_at", income: 60_000 });
  const p = (s: School) => priceAt(data.costCurveFor(s)!, 60_000, false).lo;
  assert.ok(p(low[0]) <= p(low[1]));
});
