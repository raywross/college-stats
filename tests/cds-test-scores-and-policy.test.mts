/**
 * CDS test policy and test scores (specs/data-expansion/cds-test-scores-and-policy.md, Tests 1–10): C8 grid reading,
 * agreement, cycle; C9 composite vs sections, number vs share, bands; the newest-everywhere blocks with restore and the
 * guard; ranks untouched; events; the Explore bucket. Fixtures are cut from the real records in data/cds-records/ (the
 * four 2025–26 template workbooks) plus small hand-built documents for the inventory's other cases. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CollegeRecord, DocumentRecord, ItemResult } from "../lib/cds-sections.ts";
import type { DatasetMeta, LineageRecord, ReportedTests, School } from "../lib/types.ts";
import { C8_EXPORT, POLICY_ORDER, headlinePolicy, matchesPolicy, policyBucket, policyEventText, policyFromExport, policyFromText, testPolicyEvents } from "../lib/test-policy.ts";
import {
  BAND_EDGES,
  COMPOSITE_TOLERANCE,
  MIN_SUBMITTERS,
  bandOf,
  bandsAgreeWithPercentiles,
  bandsSentence,
  compositeVsSections,
  normalizeBandColumn,
  satTotal,
  satTotalMedian,
  submittersAgree,
  yourBandSentence,
} from "../lib/score-bands.ts";
import { mergeTestScores, policyCycle, policyFromDocument, reportedTestsFromRecord, testsFromDocument } from "../lib/cds/test-scores.ts";
import { applyNewestTests, restoreFederalTests, validateTests } from "../lib/cds/test-blocks.ts";
import { applyNewest, restoreFederal } from "../lib/newest.ts";
import { validateSchool } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const record = (id: string): CollegeRecord => JSON.parse(readFileSync(join(ROOT, "data", "cds-records", `${id}.json`), "utf8"));
const VU = record("221999");
const CU = record("190415");

/** A document with just these items (each passed, with a cell and a quote). */
function doc(items: Record<string, ItemResult["v"]>, opts: { edition?: string; cycle?: string; fall?: string } = {}): DocumentRecord {
  return {
    sha256: "0".repeat(64),
    edition: opts.edition ?? "2025-26",
    type: "xlsx-template",
    url: "https://example.edu/cds.xlsx",
    retrieved: "2026-10-03",
    reads: {},
    years: { "test-policy-cycle": opts.cycle ?? "Fall 2027 applicants", fall: opts.fall ?? "Fall 2025" },
    items: Object.fromEntries(Object.entries(items).map(([c, v], i) => [c, { v, status: "passed", cell: `CDS-C!AC${i + 1}`, quote: `${c} | ${v}` } satisfies ItemResult])),
  };
}

/* ---- 1. Grid reading ---- */

test("1. grid: each fixture yields its policy; a fillable PDF maps by export value, trimmed", () => {
  assert.equal(policyFromDocument(VU.documents[0])?.policy, "considered", "Vanderbilt's code table");
  assert.equal(policyFromDocument(CU.documents[0])?.policy, "required", "Cornell's code table");
  // Howard's radio export value has a trailing space; widgets are listed REQ, REC, RFS…, so index order would read
  // "recommended" for the third widget. Mapping by export value reads it right.
  assert.equal(policyFromExport("ADMS_CONSIDER "), "considered");
  assert.equal(policyFromExport("ADMS_RFS"), "required-some");
  // Widget index 2 is RFS; reading it as the grid's third column would say "recommended" (break: map by index).
  const widgetOrder = ["ADMS_REQ", "ADMS_REC", "ADMS_RFS", "ADMS_CONSIDER", "ADMS_NOT_USED"];
  assert.equal(POLICY_ORDER[2], "recommended");
  assert.equal(policyFromExport(widgetOrder[2]), "required-some");
  assert.equal(C8_EXPORT[widgetOrder[1]], "recommended");
  // Headline: rows that differ → null (varies by test); rows that agree → that answer.
  assert.equal(headlinePolicy({ uses_tests: true, sat_or_act: null, act_only: "required", sat_only: "considered" }), null);
  assert.equal(headlinePolicy({ uses_tests: true, sat_or_act: null, act_only: "considered", sat_only: "considered" }), "considered");
  assert.equal(headlinePolicy({ uses_tests: false, sat_or_act: null, act_only: null, sat_only: null }), "not-considered");
});

/* ---- 2. C8A / grid / C8F agreement ---- */

test("2. agreement: C8A Yes with 'not considered' never publishes; 'not required' never reads as required", () => {
  const ucbLike = doc({ "C.801": true, "C.802": "Not considered for admission, even if submitted" });
  assert.equal(policyFromDocument(ucbLike), null);
  assert.equal(policyFromText("Not required for admission, but considered if submitted"), "considered");
  assert.equal(policyFromText("Required to be considered for admission"), "required");
  assert.equal(policyFromText("Not considered for admission, even if submitted"), "not-considered");
  assert.equal(policyFromText("Required for some"), "required-some");
  // William & Mary's note ("optional") with "considered" publishes, quoted.
  const wm = record("231624");
  const patch = reportedTestsFromRecord(wm, null)!;
  assert.equal(patch.reported.test_policy?.policy, "considered");
  assert.match(patch.reported.test_policy_note ?? "", /optional/);
});

/* ---- 3. Cycle ---- */

test("3. cycle: a 2025–26 document stating Fall 2026 for C8 fails; C9 must be the edition's own fall", () => {
  assert.equal(policyCycle(doc({ "C.802": "Required to be considered for admission" })), 2027);
  assert.equal(policyCycle(doc({ "C.802": "Required to be considered for admission" }, { cycle: "Fall 2026 applicants" })), null);
  assert.equal(policyFromDocument(doc({ "C.802": "Required to be considered for admission" }, { cycle: "Fall 2026 applicants" })), null);
  assert.equal(testsFromDocument(doc({ "C.901": 0.5 }, { fall: "Fall 2024" })), null);
});

/* ---- 4. Composite vs sections ---- */

test("4. composite vs sections: Loyola fails at the 25th (+100), Eau Claire passes at 40", () => {
  const p = (p25: number | null, p50: number | null, p75: number | null) => ({ p25, p50, p75 });
  assert.deepEqual(compositeVsSections(p(1220, null, 1380), p(580, null, 690), p(540, null, 680)), ["p25"], "Loyola");
  assert.deepEqual(compositeVsSections(p(1050, 1140, 1240), p(520, 570, 620), p(490, 550, 620)), [], "Eau Claire within 40");
  assert.equal(COMPOSITE_TOLERANCE, 50, "widening the tolerance (break: 150) lets Loyola pass");
  assert.deepEqual(compositeVsSections(p(1220, null, 1380), p(580, null, 690), p(540, null, 680), 150), []);
  // The real records: Illinois differs by 38 at the 50th and passes.
  const il = testsFromDocument(record("145637").documents[0])!;
  assert.deepEqual(compositeVsSections(il.sat_composite, il.sat_ebrw, il.sat_math), []);
});

/* ---- 5. Number vs share ---- */

test("5. number vs share: Eau Claire's SAT fails, its ACT passes; without a passed C1 the number isn't shown", () => {
  assert.equal(submittersAgree(23, 0, 1742), false, "EC SAT: '0%' stated, 23 of 1,742 = 1.3%");
  assert.equal(submittersAgree(1500, 0.86, 1742), true, "EC ACT");
  const withC1 = doc({ "C.118": 1000, "C.901": 0.4, "C.903": 400, "C.905": 1200, "C.907": 1400 });
  const noC1 = doc({ "C.901": 0.4, "C.903": 400, "C.905": 1200, "C.907": 1400 });
  const bad = doc({ "C.118": 1742, "C.901": 0, "C.903": 23, "C.905": 1050, "C.907": 1240 });
  assert.equal(testsFromDocument(withC1)?.sat_submitters, 400);
  assert.equal(testsFromDocument(noC1)?.sat_submitters, null);
  assert.equal(testsFromDocument(bad)?.sat_submitters, null);
  // The real records all agree within a point.
  for (const id of ["221999", "190415", "231624", "145637"]) {
    const t = testsFromDocument(record(id).documents[0])!;
    assert.ok(t.sat_submitters !== null && t.act_submitters !== null, id);
  }
});

/* ---- 6. Bands ---- */

test("6. bands: blank column is blank, bare percents scale, a shifted column fails the percentile agreement", () => {
  assert.equal(normalizeBandColumn([null, null, null, null, null, null]), null, "Cornell's ACT English '-' column, total 0");
  assert.deepEqual(normalizeBandColumn([23.8, 50.2, 20, 6, null, null]), [0.238, 0.502, 0.2, 0.06, 0, 0], "Loyola's bare 23.8 is a percent");
  assert.deepEqual(normalizeBandColumn([0.799, 0.1882, 0.0128, null, null, null]), [0.799, 0.1882, 0.0128, 0, 0, 0], "W&M: blanks in a filled column are 0");
  assert.equal(normalizeBandColumn([0.5, 0.2, 0, 0, 0, 0]), null, "doesn't sum to 100%");
  // Eau Claire composite: 25th 1050 in 1000–1199 with 8.7% below and 56.5% through.
  const ec = [0.02, 0.415, 0.478, 0.087, 0, 0] as [number, number, number, number, number, number];
  assert.equal(bandsAgreeWithPercentiles(ec, { p25: 1050, p50: null, p75: 1240 }, "sat_composite"), true);
  const shifted = [0.415, 0.478, 0.087, 0, 0, 0.02] as typeof ec;
  assert.equal(bandsAgreeWithPercentiles(shifted, { p25: 1050, p50: null, p75: 1240 }, "sat_composite"), false, "a column one header left");
  // The real records agree, except William & Mary's SAT total: its 25th is 1390, but its bands put only 20.1% at or
  // below 1399 (outside ±2 points), so that column never reaches the page (break: drop the check, and it's stored).
  for (const id of ["221999", "190415", "231624", "145637"]) {
    const t = testsFromDocument(record(id).documents[0])!;
    if (id === "231624") assert.equal(t.bands.sat_composite, null, id);
    else assert.ok(t.bands.sat_composite && bandsAgreeWithPercentiles(t.bands.sat_composite, t.sat_composite, "sat_composite"), id);
    assert.ok(t.bands.act_composite && bandsAgreeWithPercentiles(t.bands.act_composite, t.act_composite, "act_composite"), id);
  }
  assert.equal(bandOf(1450, "sat_composite"), 0);
  assert.equal(bandOf(5, "act_composite"), 5);
  assert.equal(BAND_EDGES.sat_ebrw.length, 6);
  assert.equal(bandsSentence([0.982, 0.018, 0, 0, 0, 0], "sat_composite"), "Nearly all who sent an SAT (98%) scored 1400 or higher.");
  assert.equal(bandsSentence([0.23, 0.6, 0.17, 0, 0, 0], "sat_composite"), "23% of enrolled first-years who sent an SAT scored 1400 or higher.");
  assert.equal(bandsSentence([0.02, 0.91, 0.07, 0, 0, 0], "sat_composite"), "Nearly all who sent an SAT (91%) scored 1200–1399.");
  assert.equal(
    yourBandSentence(1450, [0.74, 0.22, 0.04, 0, 0, 0], "sat_composite"),
    "Your score is in the 1400–1600 band, where 74% of enrolled first-years who sent an SAT scored. 26% scored below 1400."
  );
});

/* ---- 7. Blocks ---- */

const CDS_REC: LineageRecord = { source: "cds", year: "2024-25", url: "https://example.edu/cds-2024-25.xlsx", retrieved: "2026-09-27" };

/** A federal school with an override-cited SAT/ACT range (like Vanderbilt's), before any merge. */
function federalSchool(): School {
  return {
    unit_id: "999999",
    name: "Example College",
    admissions: {
      year: 2024,
      applicants: 10000,
      admitted: 2000,
      enrolled: 1000,
      acceptance_rate: 0.2,
      sat_reading_25_75: [650, 720],
      sat_math_25_75: [640, 730],
      act_composite_25_75: [29, 33],
      test_submission_rate_sat: 0.5,
      test_submission_rate_act: 0.3,
      test_policy: "considered",
      sat_reading_median: 690,
      sat_math_median: 690,
      act_composite_median: 31,
      act_english_25_75: [29, 34],
      act_math_25_75: [27, 32],
    },
    cds: { edition: "2024-25", url: CDS_REC.url! },
    lineage: { "admissions.sat_reading_25_75": { ...CDS_REC }, "admissions.sat_math_25_75": { ...CDS_REC }, "admissions.test_submission_rate_sat": { ...CDS_REC } },
  } as unknown as School;
}

/** A record for that school: SAT block with a blank 50th (Loyola-like), and an ACT block with too few submitters. */
function exampleRecord(): CollegeRecord {
  return {
    unit_id: "999999",
    documents: [
      doc({
        "C.801": true,
        "C.802": "Required to be considered for admission",
        "C.118": 1000,
        "C.901": 0.55,
        "C.902": 0.04,
        "C.903": 550,
        "C.904": 40,
        "C.905": 1320,
        "C.907": 1450,
        "C.908": 660,
        "C.910": 730,
        "C.911": 650,
        "C.913": 730,
        "C.914": 30,
        "C.916": 34,
      }),
    ],
  };
}

test("7. blocks: a CDS SAT block replaces all five fields, blanks become null, and restore is byte-identical", () => {
  const before = federalSchool();
  const merged = mergeTestScores(before, exampleRecord(), 2024);
  const s = applyNewest(merged);
  const a = s.admissions;
  assert.equal(a.test_policy, "required");
  assert.deepEqual(a.sat_reading_25_75, [660, 730]);
  assert.deepEqual(a.sat_math_25_75, [650, 730]);
  assert.equal(a.sat_reading_median, null, "a blank 50th is null, never the federal median");
  assert.equal(a.sat_math_median, null);
  assert.equal(a.test_submission_rate_sat, 0.55);
  assert.equal(s.lineage!["admissions.sat_reading_median"]?.source, "college-site");
  // The previous block, kept with each value's own record.
  assert.equal(a.federal_tests?.sat?.sat_reading_median, 690);
  assert.deepEqual(a.federal_tests?.sat?.records?.sat_reading_25_75, CDS_REC);
  assert.equal(a.federal_tests?.sat?.records?.sat_reading_median, undefined, "the federal median had no record");
  // ACT: 40 submitters < MIN_SUBMITTERS, so the federal ACT block stays whole.
  assert.ok(40 < MIN_SUBMITTERS);
  assert.deepEqual(a.act_composite_25_75, [29, 33]);
  assert.equal(a.federal_tests?.act, undefined);
  assert.deepEqual(validateSchool(s, meta), []);
  // Restored exactly, and idempotent.
  assert.equal(JSON.stringify(restoreFederal(s)), JSON.stringify(merged));
  assert.equal(JSON.stringify(restoreFederalTests(applyNewestTests(merged))), JSON.stringify(merged));
  assert.strictEqual(applyNewestTests(s), s, "already applied");
  assert.strictEqual(restoreFederalTests(before), before, "nothing to undo");
});

test("7. guard: a federal median inside a replaced block, a block without federal_tests, and a federal 'required-some' all fail", () => {
  const s = applyNewest(mergeTestScores(federalSchool(), exampleRecord(), 2024));
  const where = "Example College (999999)";
  assert.deepEqual(validateTests(s, where), []);
  const mixed = structuredClone(s);
  mixed.admissions.sat_reading_median = 690;
  delete mixed.lineage!["admissions.sat_reading_median"];
  assert.match(validateTests(mixed, where).join("\n"), /sat_reading_median is inside a replaced sat block/);
  const unkept = structuredClone(s);
  delete unkept.admissions.federal_tests!.sat;
  assert.match(validateTests(unkept, where).join("\n"), /doesn't keep the block it replaced/);
  const fake = structuredClone(federalSchool());
  fake.admissions.test_policy = "required-some";
  assert.match(validateTests(fake, where).join("\n"), /required-some/);
  const stale = structuredClone(s);
  stale.reported!.test_policy!.cycle = 2023;
  stale.admissions.federal_tests!.policy!.year = 2024;
  assert.match(validateTests(stale, where).join("\n"), /isn't after the federal policy's fall/);
});

test("7. the committed dataset: the four colleges carry their CDS blocks and pass the guard", () => {
  const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
  const by = (id: string) => schools.find((s) => s.unit_id === id)!;
  assert.equal(by("190415").admissions.test_policy, "required", "Cornell requires tests for fall 2027 applicants");
  assert.equal(by("190415").admissions.federal_tests?.policy?.test_policy, "considered");
  assert.deepEqual(by("221999").admissions.sat_math_25_75, [770, 790], "Vanderbilt's fall 2025 class");
  assert.equal(by("145637").admissions.act_composite_median, 32.3, "Illinois prints an averaged 50th");
  for (const id of ["221999", "190415", "231624", "145637"]) {
    assert.ok(by(id).reported?.tests, id);
    assert.deepEqual(validateSchool(by(id), meta), [], id);
  }
});

/* ---- 8. Ranks ---- */

/** Code with comments removed. */
const code = (rel: string) =>
  readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("8. ranks: the SAT metric is the sum of sections for every college; the college's own total and the bands never rank", () => {
  // Behavior: a reported composite changes the shown total, never the sections the rank adds.
  const s = applyNewest(mergeTestScores(federalSchool(), exampleRecord(), 2024));
  const t: ReportedTests = { ...s.reported!.tests!, sat_composite: { p25: 1300, p50: 1390, p75: 1470 } };
  const withTotal = { ...s, reported: { ...s.reported, tests: t } } as School;
  assert.deepEqual(satTotal(withTotal), [1300, 1470], "shown: the college's own total");
  assert.equal(satTotalMedian(withTotal), 1390);
  const sum = [withTotal.admissions.sat_reading_25_75![0] + withTotal.admissions.sat_math_25_75![0], withTotal.admissions.sat_reading_25_75![1] + withTotal.admissions.sat_math_25_75![1]];
  assert.deepEqual(sum, [1310, 1460], "ranked: the sections' sum, unchanged");
  assert.deepEqual(satTotal(federalSchool()), [1290, 1450], "a federal block shows the sum");
  // Source: satComposite and satMid (the `sat` metric, its rank, median, sort, filters, similar schools) add sections.
  const metrics = code("lib/metrics.ts");
  const satMidBody = /export function satMid[\s\S]*?\n}/.exec(metrics)![0];
  assert.match(satMidBody, /satComposite\(s\)/);
  assert.doesNotMatch(satMidBody, /satTotal|sat_total|reported/, "break: read satTotal in satMid");
  const satCompositeBody = /export function satComposite[\s\S]*?\n}/.exec(metrics)![0];
  assert.doesNotMatch(satCompositeBody, /satTotal|reported/);
  // Nothing in ranks, medians, sorts, filters, Home, indicators, or Compare's key differences reads the new values.
  const BANNED = /reported\??\.(tests|test_policy)|sat_total|satTotal|bands\./;
  for (const f of ["lib/dataset.ts", "lib/indicators.ts", "lib/compare.ts", "app/page.tsx"]) assert.doesNotMatch(code(f), BANNED, f);
  // METRICS (every ranked metric) never names a C9-only field.
  const registry = metrics.slice(metrics.indexOf("export const METRICS"));
  assert.doesNotMatch(registry, /reported\.tests|sat_total|submitters|bands/);
  // insights.ts: the radar, key differences, and similar schools never read them (only the scores takeaway may).
  const insights = code("lib/insights.ts");
  for (const fn of ["keyDifferences", "radarProfile", "similarSchools"]) {
    const body = new RegExp(`export function ${fn}[\\s\\S]*?\\n}`).exec(insights)?.[0] ?? "";
    assert.doesNotMatch(body, BANNED, fn);
  }
});

/* ---- 9. Events ---- */

test("9. events: federal considered → CDS required is one; considered → recommended isn't; A → B → A is a slip", () => {
  const e = testPolicyEvents([{ cycle: 2027, policy: "required" }], { policy: "considered", year: 2024 });
  assert.deepEqual(e, [{ cycle: 2027, from: "considered", to: "required", from_source: "ipeds-adm", from_year: 2024 }]);
  assert.equal(policyEventText(e[0]), "Requires the SAT or ACT again, for students entering in fall 2027");
  assert.deepEqual(testPolicyEvents([{ cycle: 2027, policy: "recommended" }], { policy: "considered", year: 2024 }), []);
  assert.deepEqual(
    testPolicyEvents(
      [
        { cycle: 2025, policy: "considered" },
        { cycle: 2026, policy: "required" },
        { cycle: 2027, policy: "considered" },
      ],
      { policy: "considered", year: 2022 }
    ),
    []
  );
  assert.equal(
    testPolicyEvents(
      [
        { cycle: 2025, policy: "considered" },
        { cycle: 2026, policy: "required" },
        { cycle: 2027, policy: "required" },
      ],
      null
    ).length,
    1
  );
  // Cornell's real record gives its one event.
  const cu = reportedTestsFromRecord(CU, { policy: "considered", year: 2024 })!;
  assert.deepEqual(cu.reported.test_policy_events?.map((x) => [x.from, x.to, x.cycle]), [["considered", "required", 2027]]);
});

/* ---- 10. Explore ---- */

test("10. Explore: optional includes required-some; colleges without a policy are excluded", () => {
  const s = (p: School["admissions"]["test_policy"]) => ({ admissions: { test_policy: p } }) as School;
  assert.equal(policyBucket("required-some"), "optional");
  assert.equal(policyBucket("recommended"), "optional");
  assert.ok(matchesPolicy(s("required-some"), ["optional"]));
  assert.ok(matchesPolicy(s("not-considered"), ["blind"]));
  assert.ok(!matchesPolicy(s(null), ["required", "optional", "blind"]));
  assert.ok(!matchesPolicy(s(undefined), ["optional"]));
});
