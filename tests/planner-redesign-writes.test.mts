/**
 * The pure halves of the redesigned plan's Server Actions (lib/planner/plan-writes.ts behind lib/planner/store-plan.ts;
 * build-plan.md "Server actions"): argument validation, the patch each action writes, the batched suggestion writes,
 * and that store-plan.ts stays a valid "use server" module (async exports only). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyNumbers, autoWriteBatches, parseNumbers, roundPatch, togglePlannedDate } from "../lib/planner/plan-writes.ts";
import { emptyProfile } from "../lib/student-profile.ts";

test("setPlanRound: a picked round becomes the student's; null goes back to the starting round", () => {
  assert.deepEqual(roundPatch("ed2"), { round: "ed2", round_source: "student" });
  assert.deepEqual(roundPatch(null), { round_source: "auto" });
  for (const bad of ["ED", "early", undefined, 0]) assert.equal(roundPatch(bad), null);
});

test("autoWriteBatches: one update per distinct value; a group write sets the source back to auto and isn't filtered on it", () => {
  const batches = autoWriteBatches([
    { id: "a", category: "reach", round: "ea" },
    { id: "b", category: "reach" },
    { id: "c", category: "likely", round: "ea" },
    { id: "d", round: "ed" },
  ]);
  assert.deepEqual(batches, [
    { sourceColumn: "category_source", onlyAuto: false, patch: { category: "reach", category_source: "auto" }, ids: ["a", "b"] },
    { sourceColumn: "category_source", onlyAuto: false, patch: { category: "likely", category_source: "auto" }, ids: ["c"] },
    { sourceColumn: "round_source", onlyAuto: true, patch: { round: "ea" }, ids: ["a", "c"] },
    { sourceColumn: "round_source", onlyAuto: true, patch: { round: "ed" }, ids: ["d"] },
  ]);
  assert.deepEqual(autoWriteBatches([]), []);
});

test("parseNumbers: in-range values pass; anything out of range refuses the whole form", () => {
  assert.deepEqual(parseNumbers({ gpa: 3.82, gpaScale: "4.0", focus: "sat", score: 1390, practice: true }), { gpa: 3.82, gpaScale: "4.0", focus: "sat", score: 1390, practice: true });
  assert.deepEqual(parseNumbers({ gpa: "92", gpaScale: "100", focus: "act", score: "31", practice: false }), { gpa: 92, gpaScale: "100", focus: "act", score: 31, practice: false });
  assert.deepEqual(parseNumbers({ gpa: null, focus: "none", score: 1500 }), { gpa: null, gpaScale: "4.0", focus: "none", score: null, practice: false });
  assert.equal(parseNumbers({ gpa: 5.3, gpaScale: "4.0", focus: "sat", score: 1300 }), null);
  // Above 4.0 on the 4.0 scale is a weighted GPA, kept and read by the plan as a range (gpa.md "The design" 3).
  assert.equal(parseNumbers({ gpa: 4.3, gpaScale: "4.0", focus: "sat", score: 1300 })?.gpa, 4.3);
  assert.equal(parseNumbers({ gpa: 3.5, focus: "sat", score: 1700 }), null);
  assert.equal(parseNumbers({ gpa: 3.5, focus: "act", score: 40 }), null);
  assert.equal(parseNumbers({ gpa: 3.5, focus: "psat", score: 1000 }), null);
  assert.equal(parseNumbers({ gpa: 3.5, gpaScale: "6.0" }), null);
  // A 100-point GPA may run to 120 (weighted honors and AP courses; intake.md "Grades").
  assert.equal(parseNumbers({ gpa: 108, gpaScale: "100", focus: "none" })?.gpa, 108);
  assert.equal(parseNumbers({ gpa: 121, gpaScale: "100", focus: "none" }), null);
  assert.equal(parseNumbers(null), null);
});

test("applyNumbers: writes the focus test's score only, keeps the other test's score, and the practice flag", () => {
  const start = emptyProfile();
  start.tests.actComposite = 29;
  const out = applyNumbers(start, { gpa: 3.7, gpaScale: "4.0", focus: "sat", score: 1350, practice: true });
  assert.equal(out.academics.gpa, 3.7);
  assert.equal(out.tests.satTotal, 1350);
  assert.equal(out.tests.actComposite, 29);
  assert.equal(out.tests.focus, "sat");
  assert.equal(out.tests.practice, true);
  const none = applyNumbers(out, { gpa: 3.7, gpaScale: "4.0", focus: "none", score: null, practice: false });
  assert.equal(none.tests.satTotal, 1350, "switching to Not testing keeps the stored scores");
  assert.equal(none.tests.focus, "none");
});

test("applyNumbers: the target score stays with its test and clears when the focus test changes", () => {
  const start = emptyProfile();
  start.tests.focus = "sat";
  start.tests.satTotal = 1300;
  start.tests.target = 1450;
  const same = applyNumbers(start, { gpa: 3.7, gpaScale: "4.0", focus: "sat", score: 1350, practice: false });
  assert.equal(same.tests.target, 1450);
  const act = applyNumbers(start, { gpa: 3.7, gpaScale: "4.0", focus: "act", score: 30, practice: false });
  assert.equal(act.tests.target, null);
  const none = applyNumbers(start, { gpa: 3.7, gpaScale: "4.0", focus: "none", score: null, practice: false });
  assert.equal(none.tests.target, null);
});

test("togglePlannedDate: adds once, removes, refuses unknown keys and a seventh date", () => {
  const p = emptyProfile();
  const on = togglePlannedDate(p, "sat_2026_10", true);
  assert.ok(on.ok);
  assert.deepEqual(on.ok && on.profile.tests.plannedDates, ["sat_2026_10"]);
  const twice = on.ok ? togglePlannedDate(on.profile, "sat_2026_10", true) : on;
  assert.deepEqual(twice.ok && twice.profile.tests.plannedDates, ["sat_2026_10"]);
  const off = on.ok ? togglePlannedDate(on.profile, "sat_2026_10", false) : on;
  assert.deepEqual(off.ok && off.profile.tests.plannedDates, []);
  assert.equal(togglePlannedDate(p, "fafsa_opens", true).ok, false);
  const full = { ...p, tests: { ...p.tests, plannedDates: ["sat_2026_10", "sat_2026_11", "sat_2026_12", "act_2026_10", "act_2026_12", "act_2027_02"] } };
  assert.equal(togglePlannedDate(full, "sat_2027_03", true).ok, false);
  assert.equal(togglePlannedDate(full, "sat_2026_10", false).ok, true);
});

test('store-plan.ts is a "use server" module that exports only async functions (and types)', () => {
  const src = readFileSync(new URL("../lib/planner/store-plan.ts", import.meta.url), "utf8");
  assert.match(src, /^"use server";/);
  const exports = [...src.matchAll(/^export\s+(?!type\b|interface\b)(\w+(?:\s+\w+)?)/gm)].map((m) => m[1]);
  assert.ok(exports.length >= 6);
  for (const e of exports) assert.equal(e, "async function", `store-plan.ts exports a non-async "${e}"`);
  for (const name of ["syncAuto", "setPlanRound", "setPlanDream", "setNumbers", "saveIntake", "setPlannedDate"]) {
    assert.match(src, new RegExp(`export async function ${name}\\(`), `${name} is missing`);
  }
  // Groups are Quad's only (intake.md "Groups"): no action picks one.
  assert.doesNotMatch(src, /export async function setGroup\(/);
});
