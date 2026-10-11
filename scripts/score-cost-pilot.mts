/**
 * Scores the cost curve against the colleges' own net price calculators (specs/product/cost-by-income.md "The accuracy
 * pilot"; how to run it: specs/product/cost-by-income-pilot.md). Reads the prices recorded by hand in
 * data/reference/cost-curve-pilot.json, compares each with the model's estimate at the same income, and prints a
 * table and pass/fail against the bar in that file. Not part of `npm run verify`.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/score-cost-pilot.mts
 *
 * Exits 0 when the bar is met, 1 when it isn't, 2 when no results are recorded yet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { costCurve, costCurveInput, priceAt } from "../lib/cost-curve.ts";
import type { School } from "../lib/types.ts";

interface Results {
  checked?: string;
  prices?: Record<string, number | null>;
  zero_aid_income?: number | null;
  notes?: string;
}
interface PilotFile {
  passed: boolean;
  bar: { break_point_within: number; break_point_share: number; price_within: number; price_share: number };
  incomes: number[];
  colleges: { unit_id: string; name: string; group: string; npc_url: string | null; results: Results }[];
}

const ROOT = join(import.meta.dirname, "..");
const pilot: PilotFile = JSON.parse(readFileSync(join(ROOT, "data", "reference", "cost-curve-pilot.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const k = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? "–" : `$${Math.round(x / 1000)}K`);

/** The calculator's zero-aid income: recorded, else the first sampled income where it charges (about) the full price. */
function zeroAidIncome(r: Results, coa: number): number | null {
  if (r.zero_aid_income) return r.zero_aid_income;
  for (const income of pilot.incomes) {
    const p = r.prices?.[String(income)];
    if (p != null && p >= 0.98 * coa) return income;
  }
  return null;
}

let breakHits = 0;
let breakScored = 0;
let pointHits = 0;
let pointsScored = 0;
let filled = 0;
const rows: Record<string, string>[] = [];

for (const c of pilot.colleges) {
  const prices = c.results?.prices ?? {};
  if (!Object.values(prices).some((p) => p != null)) continue;
  filled++;
  const school = byId.get(c.unit_id);
  const curve = school ? costCurve(costCurveInput(school)) : null;
  if (!school || !curve) {
    rows.push({ college: c.name, status: "no curve", break: "–", calculator: "–", points: "–" });
    continue;
  }
  // Break point: within the bar of the calculator's zero-aid income. No model break point counts as a miss.
  const zero = zeroAidIncome(c.results, curve.coa);
  let breakCell = "not found in the calculator";
  if (zero !== null) {
    breakScored++;
    const hit = curve.breakIncome !== null && Math.abs(curve.breakIncome.mid - zero) <= pilot.bar.break_point_within;
    if (hit) breakHits++;
    breakCell = `${hit ? "ok" : "MISS"} (${k(zero)})`;
  }
  // Points: the middle of the model's range within the bar of the calculator's price. Merit colleges are scored on
  // need aid only: record the calculator's need-based price for them.
  let ok = 0;
  let n = 0;
  for (const income of pilot.incomes) {
    const want = prices[String(income)];
    if (want == null) continue;
    n++;
    const p = priceAt(curve, income, true);
    if (p.kind !== "unknown" && Math.abs((p.lo + p.hi) / 2 - want) <= pilot.bar.price_within) ok++;
  }
  pointHits += ok;
  pointsScored += n;
  rows.push({ college: c.name, status: curve.status, break: curve.breakIncome ? `${k(curve.breakIncome.mid)} (${k(curve.breakIncome.lo)}–${k(curve.breakIncome.hi)})` : "–", calculator: breakCell, points: `${ok}/${n}` });
}

if (!filled) {
  console.log("No calculator results recorded yet in data/reference/cost-curve-pilot.json (see specs/product/cost-by-income-pilot.md).");
  process.exit(2);
}
console.table(rows);
const breakShare = breakScored ? breakHits / breakScored : 0;
const pointShare = pointsScored ? pointHits / pointsScored : 0;
const breakOk = breakShare >= pilot.bar.break_point_share;
const pointsOk = pointShare >= pilot.bar.price_share;
console.log(`${filled} of ${pilot.colleges.length} colleges recorded.`);
console.log(`Break point within ±${k(pilot.bar.break_point_within)}: ${breakHits}/${breakScored} (${Math.round(breakShare * 100)}%, bar ${pilot.bar.break_point_share * 100}%) ${breakOk ? "PASS" : "FAIL"}`);
console.log(`Price within ±${k(pilot.bar.price_within)}: ${pointHits}/${pointsScored} (${Math.round(pointShare * 100)}%, bar ${pilot.bar.price_share * 100}%) ${pointsOk ? "PASS" : "FAIL"}`);
if (filled < pilot.colleges.length) console.log("Not every college is recorded: the result is provisional.");
const pass = breakOk && pointsOk && filled === pilot.colleges.length;
console.log(pass ? 'Pilot PASSED: set "passed": true in the pilot file to show estimates in production.' : "Pilot not passed.");
process.exit(pass ? 0 : 1);
