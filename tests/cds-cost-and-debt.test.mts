/**
 * CDS cost and debt (specs/data-expansion/cds-cost-and-debt.md): record → `school.reported.cost` / `.outcomes`, the
 * checks that hold a block back, the display thresholds, the lineage round trip through the merge, and the guard that
 * keeps next year's price and graduates' debt out of ranks, sorts, percentiles, Compare, Home, and history. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DatasetMeta, ReportedGraduateDebt, ReportedNextYearPrice, School } from "../lib/types";
import type { CollegeRecord } from "../lib/cds-sections.ts";
import type { ReportedFile } from "../lib/reported.ts";
import {
  applyCostAndDebt,
  change,
  checkAnyAtLeastFederal,
  checkClassSize,
  checkColumnAgreement,
  checkPayingMore,
  checkPrincipalVsScorecard,
  checkTuitionVsFederal,
  checkUnionBound,
  columnTotal,
  costAndDebtFromRecord,
  federalMatchingTotal,
  fullEstimate,
  showsPayingMore,
  undergraduateDiffers,
} from "../lib/cds/cost-and-debt.ts";
import { mergeReported, stripReported } from "../lib/reported-merge.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { lineageFor, validateSchool } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const reportedFile: ReportedFile = JSON.parse(readFileSync(join(ROOT, "data", "college-reported.json"), "utf8"));
const record = (id: string): CollegeRecord => JSON.parse(readFileSync(join(ROOT, "data", "cds-records", `${id}.json`), "utf8"));
const school = (id: string): School => structuredClone(schools.find((s) => s.unit_id === id)!);
const VANDERBILT = "221999";
const CORNELL = "190415";
const WM = "231624";
const ILLINOIS = "145637";

/* ---- Real records ---- */

test("Vanderbilt: next year's price, first-year column, from its 2025–26 CDS", () => {
  const { cost, held } = costAndDebtFromRecord(record(VANDERBILT), school(VANDERBILT));
  const ny = cost!.next_year!;
  assert.equal(ny.entering_term, "2026–27");
  assert.deepEqual(ny.first_year, { tuition: { kind: "private", amount: 69822 }, fees: 3384, food_and_housing: 23690, housing_only: 15170, food_only: 8520 });
  assert.equal(ny.undergraduate.food_and_housing, 23602);
  assert.equal(columnTotal(ny.first_year), 69822 + 3384 + 23690);
  assert.deepEqual(held, []);
});

test("William & Mary and Illinois: public tuition by residency; W&M's differential-tuition share", () => {
  const wm = costAndDebtFromRecord(record(WM), school(WM)).cost!;
  assert.deepEqual(wm.next_year!.first_year.tuition, { kind: "public", in_district: 19734, in_state: 19734, out_of_state: 46177, nonresident_international: 46177 });
  assert.equal(wm.next_year_detail!.pct_paying_more, 0.126);
  assert.equal(columnTotal(wm.next_year!.first_year, "out_of_state"), 46177 + 7501 + 17646);
});

test("G0: Illinois marks its costs not final, so G1, G5, and G6 are held back; its tuition policy still publishes", () => {
  const { cost, held } = costAndDebtFromRecord(record(ILLINOIS), school(ILLINOIS));
  assert.equal(cost!.next_year, undefined);
  assert.equal(cost!.next_year_detail!.expenses, null);
  assert.equal(cost!.next_year_detail!.per_credit_hour, null);
  assert.equal(cost!.next_year_detail!.pct_paying_more, 0.7056);
  assert.ok(held.some((h) => h.block === "next_year" && /aren't final/.test(h.reason)), JSON.stringify(held));
  // And the same document with the box unchecked publishes G1.
  const rec = record(ILLINOIS);
  rec.documents[0].items["G.002"] = { status: "blank" };
  assert.ok(costAndDebtFromRecord(rec, school(ILLINOIS)).cost!.next_year);
});

test("graduates: H4 class size and H5 rows from one document, the class from the record's year rule", () => {
  const { outcomes } = costAndDebtFromRecord(record(CORNELL), school(CORNELL));
  assert.deepEqual(outcomes!.graduating_class, { year: 2025, size: 3606 });
  assert.deepEqual(outcomes!.graduate_debt!.rows.any, { number: 1198, share: 0.332, avg_principal: 25655 });
  assert.deepEqual(outcomes!.graduate_debt!.rows.private, { number: 202, share: 0.056, avg_principal: 68894 });
  assert.equal(outcomes!.graduate_debt!.class_year, 2025);
});

test("a non-numeric G5 answer ('varies') publishes as null with its text, never $0, and makes the estimate partial", () => {
  const { cost } = costAndDebtFromRecord(record(VANDERBILT), school(VANDERBILT));
  const d = cost!.next_year_detail!;
  assert.equal(d.expenses!.residents.transportation, null);
  assert.equal(d.expenses!.text!["residents.transportation"], "varies");
  const est = fullEstimate(cost!.next_year!, d)!;
  assert.equal(est.partial, true);
  assert.equal(est.total, null);
  assert.equal(est.parts.find((p) => p.label === "Transportation")!.text, "varies");
  // W&M answers every part with a number, so its estimate totals.
  const wm = costAndDebtFromRecord(record(WM), school(WM)).cost!;
  assert.equal(fullEstimate(wm.next_year!, wm.next_year_detail)!.total, 19734 + 7501 + 17646 + 900 + 785 + 2000);
});

/* ---- Checks 1–7: a good fixture passes, a broken one fails that check ---- */

const col = (over: Partial<ReportedNextYearPrice["first_year"]> = {}): ReportedNextYearPrice["first_year"] => ({
  tuition: { kind: "private", amount: 60000 },
  fees: 2000,
  food_and_housing: 20000,
  housing_only: 12000,
  food_only: 8000,
  ...over,
});
const rows = (over: Partial<ReportedGraduateDebt["rows"]> = {}): ReportedGraduateDebt["rows"] => ({
  any: { number: 300, share: 0.3, avg_principal: 25000 },
  federal: { number: 280, share: 0.28, avg_principal: 18000 },
  institutional: { number: 20, share: 0.02, avg_principal: 4000 },
  state: { number: 0, share: 0, avg_principal: 0 },
  private: { number: 50, share: 0.05, avg_principal: 40000 },
  ...over,
});
const federal = { cost: { tuition_in_state: 60000, tuition_out_of_state: 60000 } } as Pick<School, "cost">;

test("check 1: tuition + fees at least 95% of the federal tuition & fees", () => {
  assert.deepEqual(checkTuitionVsFederal(col(), federal), []);
  assert.equal(checkTuitionVsFederal(col({ tuition: { kind: "private", amount: 50000 } }), federal).length, 1);
  const pub = col({ tuition: { kind: "public", in_district: 12000, in_state: 12000, out_of_state: 20000, nonresident_international: 20000 } });
  assert.equal(checkTuitionVsFederal(pub, { cost: { tuition_in_state: 14000, tuition_out_of_state: 40000 } } as Pick<School, "cost">).length, 1, "out-of-state below the floor");
  // Wired into the merge: a misread tuition holds next year's price back.
  const rec = record(VANDERBILT);
  rec.documents[0].items["G.101"] = { ...rec.documents[0].items["G.101"], v: 6982 };
  const out = costAndDebtFromRecord(rec, school(VANDERBILT));
  assert.equal(out.cost?.next_year, undefined);
  assert.ok(out.held.some((h) => h.block === "next_year"));
});

test("check 2: housing only + food only agree with food and housing", () => {
  assert.deepEqual(checkColumnAgreement(col()), []);
  assert.equal(checkColumnAgreement(col({ food_only: 9000 })).length, 1);
});

test("check 3: the share paying more is 0–100%", () => {
  assert.deepEqual(checkPayingMore(0.706), []);
  assert.equal(checkPayingMore(70.6).length, 1);
});

test("check 4: the graduating class is a positive whole number", () => {
  assert.deepEqual(checkClassSize(1561), []);
  assert.equal(checkClassSize(0).length, 1);
  assert.equal(checkClassSize(15.5).length, 1);
});

test("check 5: any-loan count and share at least the federal row's", () => {
  assert.deepEqual(checkAnyAtLeastFederal(rows()), []);
  assert.equal(checkAnyAtLeastFederal(rows({ any: { number: 200, share: 0.3, avg_principal: 25000 } })).length, 1);
  assert.equal(checkAnyAtLeastFederal(rows({ any: { number: 300, share: 0.2, avg_principal: 25000 } })).length, 1);
});

test("check 6: any-loan at most the four sources summed", () => {
  assert.deepEqual(checkUnionBound(rows()), []);
  assert.equal(checkUnionBound(rows({ any: { number: 400, share: 0.3, avg_principal: 25000 } })).length, 1);
  assert.equal(checkUnionBound(rows({ any: { number: 300, share: 0.5, avg_principal: 25000 } })).length, 1);
});

test("check 7: any-loan average principal within ×0.5–×3 of the federal median debt (Vanderbilt's real ×2.2 passes)", () => {
  assert.deepEqual(checkPrincipalVsScorecard(rows(), 20000), []);
  assert.deepEqual(checkPrincipalVsScorecard(rows({ any: { number: 293, share: 0.19, avg_principal: 30578 } }), 14000), []);
  assert.equal(checkPrincipalVsScorecard(rows({ any: { number: 300, share: 0.3, avg_principal: 250000 } }), 20000).length, 1);
  assert.equal(checkPrincipalVsScorecard(rows({ any: { number: 300, share: 0.3, avg_principal: 2500 } }), 20000).length, 1);
  // Wired into the merge: a misread principal holds the debt block back, but not the class size.
  const rec = record(CORNELL);
  rec.documents[0].items["H.511"] = { ...rec.documents[0].items["H.511"], v: 256550 };
  const out = costAndDebtFromRecord(rec, school(CORNELL));
  assert.equal(out.outcomes?.graduate_debt, undefined);
  assert.ok(out.outcomes?.graduating_class);
});

/* ---- Display thresholds ---- */

test("the continuing-student disclosure shows only above a 1% gap", () => {
  const base = col();
  const price = (ugTuition: number): ReportedNextYearPrice => ({ entering_term: "2026–27", first_year: base, undergraduate: col({ tuition: { kind: "private", amount: ugTuition } }) });
  assert.equal(undergraduateDiffers(price(60000)), false);
  assert.equal(undergraduateDiffers(price(60000 + 0.009 * 82000)), false);
  assert.equal(undergraduateDiffers(price(60000 + 0.011 * 82000)), true);
});

test("the differential-tuition footnote shows at 5% or more", () => {
  const d = (pct: number | null) => ({ credits_per_term: null, tuition_varies_by_year: null, tuition_varies_by_program: true, pct_paying_more: pct, expenses: null, per_credit_hour: null });
  assert.equal(showsPayingMore(d(0.049)), false);
  assert.equal(showsPayingMore(d(0.05)), true);
  assert.equal(showsPayingMore(d(null)), false);
  assert.equal(showsPayingMore(undefined), false);
});

test("the change compares like with like: G1's total against the federal tuition & fees + room & board", () => {
  const vu = school(VANDERBILT);
  assert.equal(federalMatchingTotal(vu), vu.cost!.tuition_fees!.in_state! + vu.cost!.components!.room_board!);
  assert.equal(change(110, 100)!.toFixed(2), "0.10");
  assert.equal(change(null, 100), null);
});

/* ---- Merge and lineage round trip ---- */

test("merge: the four colleges get their blocks with valid lineage; federal cost and debt are untouched", () => {
  const stripped = schools.map(stripReported);
  const records = [VANDERBILT, CORNELL, WM, ILLINOIS].map(record);
  const { schools: merged } = mergeReported(stripped, reportedFile, { records, meta, table: CDS_TEMPLATE });
  for (const id of [VANDERBILT, CORNELL, WM, ILLINOIS]) {
    const before = schools.find((s) => s.unit_id === id)!;
    const s = merged.find((x) => x.unit_id === id)!;
    assert.deepEqual(validateSchool(s, meta), [], id);
    assert.deepEqual(s.cost, before.cost, `${id}: next year's price must never replace cost.*`);
    assert.equal(s.outcomes?.median_debt, before.outcomes?.median_debt);
    assert.ok(s.reported?.outcomes?.graduate_debt, id);
  }
  const vu = merged.find((s) => s.unit_id === VANDERBILT)!;
  const cited = lineageFor("reported.cost.next_year", vu, meta);
  assert.equal(cited.key, "college-site");
  assert.equal(cited.year, "2026–27");
  assert.equal(cited.sourceKind, "cds");
  assert.equal(cited.document, "Common Data Set 2025–26");
  assert.match(cited.quote ?? "", /69822/);
  const debt = lineageFor("reported.outcomes.graduate_debt.rows.any.avg_principal", vu, meta);
  assert.equal(debt.year, "Class of 2025");
  // The computed total cites the college's document, the change cites both it and the federal release.
  assert.equal(lineageFor("derived.next_year_price", vu, meta).year, "2026–27");
  assert.ok((lineageFor("derived.next_year_change", vu, meta).inputs ?? []).length >= 2);
  // The committed dataset carries exactly this merge.
  assert.deepEqual(merged.find((s) => s.unit_id === CORNELL)!.reported, schools.find((s) => s.unit_id === CORNELL)!.reported);
});

test("lineage: a stored block without its record fails validation", () => {
  const s = applyCostAndDebt(stripReported(school(CORNELL)), record(CORNELL));
  assert.deepEqual(validateSchool(s, meta), []);
  const broken = structuredClone(s);
  delete broken.lineage!["reported.outcomes.graduate_debt.rows.any.avg_principal"];
  assert.ok(validateSchool(broken, meta).some((e) => /graduate_debt\.rows\.any\.avg_principal is stored without a lineage record/.test(e)));
});

test("re-merging is idempotent and a college whose record goes away loses its blocks", () => {
  const once = mergeReported(schools, reportedFile, { records: [record(CORNELL)], meta, table: CDS_TEMPLATE }).schools;
  const twice = mergeReported(once, reportedFile, { records: [record(CORNELL)], meta, table: CDS_TEMPLATE }).schools;
  assert.deepEqual(twice.find((s) => s.unit_id === CORNELL), once.find((s) => s.unit_id === CORNELL));
  const gone = mergeReported(once, reportedFile, { records: [], meta, table: CDS_TEMPLATE }).schools.find((s) => s.unit_id === CORNELL)!;
  assert.equal(gone.reported, undefined);
  assert.ok(!Object.keys(gone.lineage ?? {}).some((k) => k.startsWith("reported.")));
});

/* ---- Guard: never in ranks, sorts, percentiles, Compare, Home, or history ---- */

/** Any read of the cost-and-debt blocks or their computed fields. */
const COST_DEBT_REFERENCE = /reported\??\.cost\b|reported\??\.outcomes\??\.(graduating_class|graduate_debt)\b|\bnext_year|\bgraduate_debt\b|\bgraduating_class\b|cds\/cost-and-debt/;

const GUARDED_FILES = [
  "lib/metrics.ts",
  "lib/dataset.ts",
  "lib/compare.ts",
  "lib/field-compare.ts",
  "lib/insights.ts",
  "lib/indicators.ts",
  "lib/params.ts",
  "lib/score-scale.ts",
  "lib/newest.ts",
  "lib/derive.ts",
  "lib/history.ts",
  "lib/history-groups.ts",
  "lib/history-group-store.ts",
  "lib/profile-history.ts",
  // Compare's rows and loaders, which lived in app/compare until the redesign (specs/compare-redesign.md).
  "lib/compare-topics.ts",
  "lib/compare-routes.ts",
  "lib/compare-data.ts",
  // The compare overview's topic cards and their sentences.
  "lib/compare-cards.ts",
  "lib/compare-insights.ts",
  "app/page.tsx",
  "scripts/sync-history.mts",
];
const GUARDED_DIRS = ["app/explore", "app/compare", "components/charts", "components/explore", "components/compare", "components/trends", "components/history", "scripts/history"];

function sourceFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|mts)$/.test(name) ? [p] : [];
  });
}

/** Code with comments removed, so documentation doesn't trip the guard. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function costDebtOffenders(read: (file: string) => string = (f) => readFileSync(f, "utf8")): string[] {
  const files = [...GUARDED_FILES.map((f) => join(ROOT, f)).filter((f) => statSync(f, { throwIfNoEntry: false })), ...GUARDED_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)))];
  const out: string[] = [];
  for (const f of files) {
    code(read(f))
      .split("\n")
      .forEach((line, i) => {
        if (COST_DEBT_REFERENCE.test(line)) out.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

test("next year's price and graduates' debt never reach ranks, sorts, percentiles, Compare, Home, or history", () => {
  assert.deepEqual(costDebtOffenders(), []);
});

test("the guard catches a read added to a guarded file (and ignores comments)", () => {
  const injected = (line: string) => (f: string) => (f.endsWith("lib/metrics.ts") ? `${readFileSync(f, "utf8")}\n${line}\n` : readFileSync(f, "utf8"));
  for (const line of [
    "const p = s.reported?.cost?.next_year;",
    "sort((a, b) => a.reported.outcomes.graduate_debt.rows.any.share - b.x);",
    'const f = citeField("derived.next_year_price", s);',
    'import { columnTotal } from "./cds/cost-and-debt";',
  ]) {
    assert.equal(costDebtOffenders(injected(line)).length, 1, line);
  }
  assert.deepEqual(costDebtOffenders(injected("// reported.cost.next_year is never ranked")), []);
});
