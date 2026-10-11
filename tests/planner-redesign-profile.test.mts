/**
 * The plan's numbers in the student profile (lib/student-profile.ts; specs/planner/redesign/standing.md "The numbers",
 * build-plan.md "Student profile"): the three new test fields and their sanitizing, the one-test reader planTest, and
 * planStudent. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProfile, isTestDateKey, PLANNED_DATES_MAX, planStudent, planTest, sanitizeProfile, type StudentProfileData } from "../lib/student-profile.ts";
import file from "../data/application-cycle.json" with { type: "json" };

const withTests = (t: Partial<StudentProfileData["tests"]>, gpa: number | null = null): StudentProfileData => {
  const p = emptyProfile();
  return { ...p, academics: { ...p.academics, gpa }, tests: { ...p.tests, ...t } };
};

test("the empty profile has no focus, no practice flag, and no picked dates", () => {
  const t = emptyProfile().tests;
  assert.equal(t.focus, null);
  assert.equal(t.practice, false);
  assert.deepEqual(t.plannedDates, []);
});

test("planTest: both scores on file, the focus decides", () => {
  assert.deepEqual(planTest(withTests({ satTotal: 1390, actComposite: 31, focus: "sat" })), { kind: "sat", score: 1390 });
  assert.deepEqual(planTest(withTests({ satTotal: 1390, actComposite: 31, focus: "act" })), { kind: "act", score: 31 });
});

test("planTest: no focus and exactly one score, that one; two scores and no focus, none until they pick", () => {
  assert.deepEqual(planTest(withTests({ satTotal: 1200 })), { kind: "sat", score: 1200 });
  assert.deepEqual(planTest(withTests({ actComposite: 27 })), { kind: "act", score: 27 });
  assert.equal(planTest(withTests({ satTotal: 1200, actComposite: 27 })), null);
  assert.equal(planTest(withTests({})), null);
  assert.equal(planTest(null), null);
});

test('planTest: "Not testing" uses no score, even with scores on file; a focus with no score is none', () => {
  assert.equal(planTest(withTests({ satTotal: 1200, focus: "none" })), null);
  assert.equal(planTest(withTests({ actComposite: 30, focus: "sat" })), null);
});

test("planStudent: GPA through unweightedGpa4, and the one test", () => {
  assert.deepEqual(planStudent(withTests({ satTotal: 1390, focus: "sat" }, 3.82)), { gpa: 3.8, test: { kind: "sat", score: 1390 } });
  const fivePoint = { ...withTests({ focus: "none" }, 4.5), academics: { ...emptyProfile().academics, gpa: 4.5, gpaScale: "5.0" as const } };
  assert.deepEqual(planStudent(fivePoint), { gpa: 3.6, test: null });
  assert.deepEqual(planStudent(null), { gpa: null, test: null });
});

test("sanitize: focus and practice round-trip; anything else is dropped", () => {
  const kept = sanitizeProfile({ tests: { satTotal: 1300, focus: "sat", practice: true } });
  assert.equal(kept.tests.focus, "sat");
  assert.equal(kept.tests.practice, true);
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(kept))), kept);
  const bad = sanitizeProfile({ tests: { focus: "psat", practice: "yes" } });
  assert.equal(bad.tests.focus, null);
  assert.equal(bad.tests.practice, false);
  assert.equal(sanitizeProfile({ tests: { focus: "none" } }).tests.focus, "none");
});

test("sanitize: picked dates keep known test-date keys only, once each, at most six", () => {
  const t = sanitizeProfile({
    tests: { plannedDates: ["sat_2026_10", "act_2026_12", "sat_2026_10", "fafsa_opens", "sat_2026_13", 42, null, "SAT_2026_11", "act_2027_02", "sat_2027_03", "act_2027_04", "sat_2027_05", "sat_2027_06"] },
  }).tests;
  assert.deepEqual(t.plannedDates, ["sat_2026_10", "act_2026_12", "act_2027_02", "sat_2027_03", "act_2027_04", "sat_2027_05"]);
  assert.equal(t.plannedDates.length, PLANNED_DATES_MAX);
  assert.deepEqual(sanitizeProfile({ tests: { plannedDates: "sat_2026_10" } }).tests.plannedDates, []);
});

test("every test date in the cycle file has a key planned dates accept, and nothing else does", () => {
  const entries = (file as { cycles: { entries: { key: string; applies: string }[] }[] }).cycles.flatMap((c) => c.entries);
  const tests = entries.filter((e) => e.applies === "plans_tests");
  assert.ok(tests.length > 0);
  for (const e of tests) assert.ok(isTestDateKey(e.key), `${e.key} isn't a test-date key`);
  for (const e of entries.filter((x) => x.applies !== "plans_tests")) assert.ok(!isTestDateKey(e.key), `${e.key} looks like a test date`);
});
