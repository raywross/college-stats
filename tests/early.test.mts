/**
 * Early decision measures (lib/early.ts; specs/product/early-decision-strategy.md "Data"): the ED rate, the non-ED
 * rate, the advantage multiple, the share of the class with the stated 0.95 yield, the checks, the lines the rounds
 * table shows, and which C1 totals count as the same document's. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADVANTAGE_REVIEW_MULTIPLE,
  ED_YIELD_ASSUMED,
  advantageLine,
  classShareLine,
  earlyChecks,
  earlyMeasures,
  multipleLabel,
  sameDocumentTotals,
  type EarlyCounts,
} from "../lib/early.ts";

const counts = (over: Partial<EarlyCounts> = {}): EarlyCounts => ({
  edApplicants: 1000,
  edAdmitted: 240,
  totalApplicants: 11000,
  totalAdmitted: 1140,
  enrolled: 500,
  hasEarlyAction: false,
  ...over,
});

test("the measures: ED rate, non-ED rate, advantage, share of class", () => {
  const m = earlyMeasures(counts());
  assert.equal(m.edRate, 0.24);
  assert.equal(m.nonEdRate, 0.09, "(1140 − 240) ÷ (11000 − 1000)");
  assert.ok(Math.abs(m.advantage! - 0.24 / 0.09) < 1e-9);
  assert.equal(m.classShare, (240 * ED_YIELD_ASSUMED) / 500);
  assert.equal(ED_YIELD_ASSUMED, 0.95);
  assert.deepEqual(m.checks, []);
});

test("the non-ED pool is labeled non-ED when the college has EA, regular when it doesn't", () => {
  assert.equal(earlyMeasures(counts({ hasEarlyAction: true })).nonEdLabel, "non-ED");
  assert.equal(earlyMeasures(counts()).nonEdLabel, "regular");
  assert.match(advantageLine(true, earlyMeasures(counts({ hasEarlyAction: true })), "2025–26")!, /vs 9% non-ED \(CDS 2025–26\) · 2\.7× the non-ED rate$/);
});

test("the advantage line: a multiple, never odds; ED offered without counts says so; no ED, no line", () => {
  const line = advantageLine(true, earlyMeasures(counts()), "2025–26")!;
  assert.equal(line, "ED admitted 24% vs 9% regular (CDS 2025–26) · 2.7× the regular rate");
  assert.doesNotMatch(line, /odds|chance/i);
  const none = earlyMeasures(counts({ edApplicants: null, edAdmitted: null }));
  assert.equal(advantageLine(true, none, null), "ED offered; counts not published");
  assert.equal(advantageLine(false, earlyMeasures(counts()), null), null);
  assert.equal(advantageLine(null, null, null), null);
  // No same-document totals: the ED rate alone.
  assert.equal(advantageLine(true, earlyMeasures(counts({ totalApplicants: null, totalAdmitted: null })), null), "ED admitted 24%");
  assert.equal(multipleLabel(2.66), "2.7×");
});

test("checks: ED admitted ≤ ED applicants ≤ total applicants; ED admitted ≤ total admitted; each failure blanks the measures", () => {
  assert.deepEqual(earlyChecks(counts()), []);
  const over = earlyMeasures(counts({ edAdmitted: 1200 }));
  assert.ok(over.checks.includes("ed_admitted_over_applicants"));
  assert.equal(over.edRate, null);
  assert.equal(over.advantage, null);
  assert.ok(earlyChecks(counts({ edApplicants: 12000, edAdmitted: 100 })).includes("ed_applicants_over_total"));
  assert.ok(earlyChecks(counts({ edAdmitted: 900, totalAdmitted: 800 })).includes("ed_admitted_over_total_admitted"));
  assert.match(advantageLine(true, over, null)!, /don't add up/);
});

test(`an advantage over ${ADVANTAGE_REVIEW_MULTIPLE}× is held for review: the rates show, the multiple doesn't`, () => {
  // ED 50%, non-ED (1000 − 500) ÷ (101000 − 1000) = 0.5%: 100×.
  const m = earlyMeasures(counts({ edApplicants: 1000, edAdmitted: 500, totalApplicants: 101000, totalAdmitted: 1000 }));
  assert.ok(m.checks.includes("advantage_over_review"));
  assert.equal(m.advantage, null);
  assert.ok(m.edRate !== null && m.nonEdRate !== null);
  assert.match(advantageLine(true, m, null)!, /multiple held for review$/);
  // Just under the line is shown.
  const ok = earlyMeasures(counts({ edApplicants: 100, edAdmitted: 70, totalApplicants: 10100, totalAdmitted: 970 }));
  assert.ok(ok.advantage !== null && ok.advantage < ADVANTAGE_REVIEW_MULTIPLE);
});

test("share of class: the yield assumption is stated, and it never passes 100%", () => {
  assert.equal(classShareLine(earlyMeasures(counts())), "about 46% of the class (if 95% of ED admits enroll)");
  assert.equal(earlyMeasures(counts({ edAdmitted: 900, totalAdmitted: 1900, enrolled: 600 })).classShare, 1);
  assert.equal(classShareLine(earlyMeasures(counts({ enrolled: null }))), null);
});

test("same-document totals: the funnel when it's from the ED counts' file; the residency grid of the same edition; else none", () => {
  const url = "https://example.edu/cds-2025-26.pdf";
  const base = {
    admissions: { applicants: 8822, admitted: 1000, enrolled: 500 },
    reported: { admissions_by_residency: { edition: "2025-26", total: { applicants: 8800, admitted: 990, enrolled: 498 } } },
  };
  const ed = { url, edition: "2025–26" };
  assert.deepEqual(
    sameDocumentTotals({ ...base, lineage: { "reported.admission_profile.early_decision.applicants": ed, "admissions.applicants": { url }, "admissions.admitted": { url }, "admissions.enrolled": { url } } }),
    { applicants: 8822, admitted: 1000, enrolled: 500 },
  );
  assert.deepEqual(
    sameDocumentTotals({ ...base, lineage: { "reported.admission_profile.early_decision.applicants": ed, "admissions.applicants": { url }, "admissions.admitted": { url }, "admissions.enrolled": { url: "other" } } }),
    { applicants: 8822, admitted: 1000, enrolled: null },
    "enrolled from another document isn't used",
  );
  assert.deepEqual(
    sameDocumentTotals({ ...base, lineage: { "reported.admission_profile.early_decision.applicants": ed, "admissions.applicants": { url: "federal" }, "admissions.admitted": { url: "federal" } } }),
    { applicants: 8800, admitted: 990, enrolled: 498 },
    "the residency grid of the same edition (en dash or hyphen)",
  );
  assert.equal(
    sameDocumentTotals({ admissions: base.admissions, reported: { admissions_by_residency: { edition: "2024-25", total: base.reported.admissions_by_residency.total } }, lineage: { "reported.admission_profile.early_decision.applicants": ed } }),
    null,
  );
  assert.equal(sameDocumentTotals({ ...base, lineage: {} }), null, "no ED counts, no totals");
});
