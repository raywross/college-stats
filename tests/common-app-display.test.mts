/**
 * "What it takes to apply" (common-app-build/brief.md "U2"; lib/common-app/display.ts): the pure sentences and lines
 * the card renders — rounds, fee and fee-waiver, materials, recommendations, test policy, the cycle label, and the
 * grid/CDS reconciliation for the regular round — plus a guard that the component types no cycle year and no
 * commonapp.org path. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchoolApply } from "../lib/common-app/types.ts";
import {
  cycleLabel,
  feeSentence,
  materialsLines,
  newestRegularDeadline,
  recommendationsSentence,
  roundLines,
  testPolicySentence,
} from "../lib/common-app/display.ts";

const ROOT = join(import.meta.dirname, "..");

/** A full member fixture (every kind of value, like Vanderbilt 221999), overridable per test. */
function apply(overrides: Partial<SchoolApply> = {}): SchoolApply {
  return {
    common_app: { member: true, member_id: "277", slug: "vanderbilt-university", cycle: "2026-27", updated: "2026-09-25" },
    deadlines: { ed: "2026-11-01", ed2: "2027-01-01", ea: null, ea2: null, rea: null, regular: "2027-01-01" },
    fee: { us: 50, international: 50 },
    fee_waiver: "accepted",
    essay_required: true,
    courses_grades_required: false,
    writing_supplement: false,
    portfolio: null,
    test_policy: { code: "N", tests_used: "See website", english_tests: [] },
    recommendations: { teacher: 2, other: 0, counselor: true, mid_year_report: true },
    school_type: "coed",
    saves_forms: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* roundLines                                                          */
/* ------------------------------------------------------------------ */

test("roundLines: every round offered, in grid order, with month/day text", () => {
  const a = apply({ deadlines: { ed: "2026-11-01", ed2: "2027-01-01", ea: "2026-11-01", ea2: "2027-01-01", rea: "2026-11-01", regular: "2027-01-05" } });
  assert.deepEqual(roundLines(a), [
    { key: "ed", label: "Early Decision", dateText: "November 1" },
    { key: "ed2", label: "Early Decision II", dateText: "January 1" },
    { key: "ea", label: "Early Action", dateText: "November 1" },
    { key: "ea2", label: "Early Action II", dateText: "January 1" },
    { key: "rea", label: "Restrictive Early Action", dateText: "November 1" },
    { key: "regular", label: "Regular Decision", dateText: "January 5" },
  ]);
});

test("roundLines: rolling regular round", () => {
  const a = apply({ deadlines: { ed: null, ed2: null, ea: null, ea2: null, rea: null, regular: "rolling" } });
  assert.deepEqual(roundLines(a), [{ key: "regular", label: "Rolling", dateText: "Rolling admission" }]);
});

test("roundLines: no grid row (deadlines null) is empty", () => {
  assert.deepEqual(roundLines(apply({ deadlines: null })), []);
});

/* ------------------------------------------------------------------ */
/* feeSentence                                                         */
/* ------------------------------------------------------------------ */

test("feeSentence: no fee", () => {
  assert.equal(feeSentence(apply({ fee: { us: 0, international: 0 }, fee_waiver: null })), "No application fee.");
});

test("feeSentence: fee with waiver accepted", () => {
  assert.equal(feeSentence(apply({ fee: { us: 50, international: 50 }, fee_waiver: "accepted" })), "$50 application fee; takes the Common App fee waiver.");
});

test("feeSentence: fee with waiver U.S. only", () => {
  assert.equal(
    feeSentence(apply({ fee: { us: 50, international: 50 }, fee_waiver: "us_only" })),
    "$50 application fee; takes the Common App fee waiver for U.S. applicants only."
  );
});

test("feeSentence: fee, waiver not accepted", () => {
  assert.equal(feeSentence(apply({ fee: { us: 85, international: 85 }, fee_waiver: "not_accepted" })), "$85 application fee; doesn't take the Common App fee waiver.");
});

test("feeSentence: fee with no waiver answer", () => {
  assert.equal(feeSentence(apply({ fee: { us: 50, international: null }, fee_waiver: null })), "$50 application fee.");
});

test("feeSentence: null without a fee", () => {
  assert.equal(feeSentence(apply({ fee: null })), null);
});

/* ------------------------------------------------------------------ */
/* materialsLines                                                       */
/* ------------------------------------------------------------------ */

test("materialsLines: essay required, no writing supplement, no Courses & Grades, no portfolio", () => {
  const lines = materialsLines(apply({ essay_required: true, writing_supplement: false, courses_grades_required: false, portfolio: null }));
  assert.deepEqual(lines, [{ key: "essay", text: "Requires the Common App personal essay" }]);
});

test("materialsLines: essay not required", () => {
  const lines = materialsLines(apply({ essay_required: false }));
  assert.deepEqual(lines[0], { key: "essay", text: "Doesn't require the personal essay" });
});

test("materialsLines: writing supplement and Courses & Grades shown only when true, with their glossary terms", () => {
  const lines = materialsLines(apply({ essay_required: true, writing_supplement: true, courses_grades_required: true, portfolio: null }));
  assert.deepEqual(lines, [
    { key: "essay", text: "Requires the Common App personal essay" },
    { key: "writing_supplement", text: "Requires a writing supplement", term: "writing-supplement" },
    { key: "courses_grades", text: "Requires the Courses & Grades section", term: "courses-and-grades" },
  ]);
});

test("materialsLines: portfolio through SlideRoom or the college's own system", () => {
  assert.equal(materialsLines(apply({ portfolio: "slideroom" })).find((l) => l.key === "portfolio")?.text, "Portfolio through SlideRoom");
  assert.equal(materialsLines(apply({ portfolio: "own" })).find((l) => l.key === "portfolio")?.text, "Portfolio through the college's own system");
});

/* ------------------------------------------------------------------ */
/* recommendationsSentence                                             */
/* ------------------------------------------------------------------ */

test("recommendationsSentence: teacher, counselor, and mid-year report (Vanderbilt)", () => {
  assert.equal(
    recommendationsSentence(apply({ recommendations: { teacher: 2, other: 0, counselor: true, mid_year_report: true } })),
    "Two teacher evaluations, a counselor recommendation, and a mid-year report."
  );
});

test("recommendationsSentence: zero recommendations", () => {
  assert.equal(recommendationsSentence(apply({ recommendations: { teacher: 0, other: 0, counselor: false, mid_year_report: false } })), "No recommendations required.");
});

test("recommendationsSentence: one of each, counting words up to ten, singular", () => {
  assert.equal(recommendationsSentence(apply({ recommendations: { teacher: 1, other: 1, counselor: false, mid_year_report: false } })), "One teacher evaluation and one other evaluation.");
});

/* ------------------------------------------------------------------ */
/* testPolicySentence                                                  */
/* ------------------------------------------------------------------ */

test("testPolicySentence: tests_used shown when it isn't 'See website'", () => {
  assert.equal(
    testPolicySentence(apply({ test_policy: { code: "A", tests_used: "SAT without essay or ACT with science", english_tests: [] } }), "Test scores required"),
    "Test scores required; tests used: SAT without essay or ACT with science."
  );
});

test("testPolicySentence: 'See website' is hidden", () => {
  assert.equal(testPolicySentence(apply({ test_policy: { code: "N", tests_used: "See website", english_tests: [] } }), "Test-optional"), "Test-optional.");
});

test("testPolicySentence: null tests_used is hidden", () => {
  assert.equal(testPolicySentence(apply({ test_policy: { code: "I", tests_used: null, english_tests: [] } }), "Test-blind"), "Test-blind.");
});

test("testPolicySentence: code F adds the flexible wording", () => {
  assert.equal(
    testPolicySentence(apply({ test_policy: { code: "F", tests_used: "See website", english_tests: [] } }), "Test scores required"),
    "Test scores required; flexible: the college chooses among the tests listed."
  );
});

test("testPolicySentence: code S adds 'for some applicants' when the headline doesn't already say so", () => {
  assert.equal(
    testPolicySentence(apply({ test_policy: { code: "S", tests_used: "See website", english_tests: [] } }), "Test-optional"),
    "Test-optional; for some applicants."
  );
});

test("testPolicySentence: code S doesn't repeat 'some applicants' when the headline already says it", () => {
  assert.equal(
    testPolicySentence(apply({ test_policy: { code: "S", tests_used: "See website", english_tests: [] } }), "Required for some applicants"),
    "Required for some applicants."
  );
});

test("testPolicySentence: null without a test policy", () => {
  assert.equal(testPolicySentence(apply({ test_policy: null }), "Test-optional"), null);
});

/* ------------------------------------------------------------------ */
/* cycleLabel                                                           */
/* ------------------------------------------------------------------ */

test("cycleLabel: this cycle through August 31 of the cycle's second year", () => {
  assert.equal(cycleLabel("2026-27", "2027-08-31"), "this cycle");
  assert.equal(cycleLabel("2026-27", "2026-10-25"), "this cycle");
});

test("cycleLabel: last cycle the day after", () => {
  assert.equal(cycleLabel("2026-27", "2027-09-01"), "last cycle");
});

test("cycleLabel: null without a cycle", () => {
  assert.equal(cycleLabel(null, "2027-01-01"), null);
});

/* ------------------------------------------------------------------ */
/* newestRegularDeadline                                               */
/* ------------------------------------------------------------------ */

test("newestRegularDeadline: the grid wins when its 'updated' stamp is later than the CDS edition's as-of date (January 1 of its second year)", () => {
  const a = apply({ common_app: { member: true, member_id: "1", slug: "x", cycle: "2026-27", updated: "2026-09-25" }, deadlines: { ed: null, ed2: null, ea: null, ea2: null, rea: null, regular: "2027-01-01" } });
  // A 2025–26 edition is as of 2026-01-01, before the grid's 2026-09-25 stamp: the grid wins, whenever Quad read the CDS.
  const result = newestRegularDeadline(a, { regular_closing: { month: 11, day: 1 }, edition: "2025-26" });
  assert.deepEqual(result, { winner: "grid", loserText: "November 1" });
  // The en-dash spelling of an edition reads the same.
  assert.deepEqual(newestRegularDeadline(a, { regular_closing: { month: 11, day: 1 }, edition: "2025–26" }), result);
});

test("newestRegularDeadline: the CDS wins when its edition is as of a date after the grid's update", () => {
  const a = apply({ common_app: { member: true, member_id: "1", slug: "x", cycle: "2026-27", updated: "2026-09-25" }, deadlines: { ed: null, ed2: null, ea: null, ea2: null, rea: null, regular: "2026-11-01" } });
  // A 2026–27 edition is as of 2027-01-01, after the grid's stamp.
  const result = newestRegularDeadline(a, { regular_closing: { month: 1, day: 5 }, edition: "2026-27" });
  assert.deepEqual(result, { winner: "cds", loserText: "November 1" });
});

test("newestRegularDeadline: null for a rolling regular round (nothing to reconcile)", () => {
  const a = apply({ deadlines: { ed: null, ed2: null, ea: null, ea2: null, rea: null, regular: "rolling" } });
  assert.equal(newestRegularDeadline(a, { regular_closing: { month: 1, day: 5 }, edition: "2025-26" }), null);
});

test("newestRegularDeadline: null without a CDS closing date, or without an edition to date it", () => {
  const a = apply({ deadlines: { ed: null, ed2: null, ea: null, ea2: null, rea: null, regular: "2027-01-01" } });
  assert.equal(newestRegularDeadline(a, { regular_closing: null, edition: "2025-26" }), null);
  assert.equal(newestRegularDeadline(a, undefined), null);
  assert.equal(newestRegularDeadline(a, { regular_closing: { month: 1, day: 5 }, edition: "unknown" }), null);
});

/* ------------------------------------------------------------------ */
/* Guard: the component types no cycle year and no commonapp.org path  */
/* ------------------------------------------------------------------ */

const CYCLE = /["'`]20\d\d[-–]\d\d["'`]/;
const COMMONAPP_PATH = /commonapp\.org\//;

test("components/school/WhatItTakes.tsx has no quoted cycle literal and no commonapp.org path", () => {
  const text = readFileSync(join(ROOT, "components/school/WhatItTakes.tsx"), "utf8");
  assert.equal(CYCLE.test(text), false, "a cycle literal like \"2026-27\" must not appear");
  assert.equal(COMMONAPP_PATH.test(text), false, "a commonapp.org path (beyond the bare homepage) must not appear");
});

test("the guard's patterns do fail on a bad fixture (proving they aren't vacuous)", () => {
  assert.equal(CYCLE.test('const label = "2026-27";'), true);
  assert.equal(COMMONAPP_PATH.test('<a href="https://www.commonapp.org/explore/x">'), true);
});
