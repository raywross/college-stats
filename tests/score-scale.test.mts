/**
 * Score-bar axes (specs/charts.md, RangeBar): each bar takes the tightest fixed tier that holds its 25th percentile
 * and the reader's own score. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreScale } from "../lib/score-scale.ts";

test("selective SAT ranges get the 1000–1600 axis; lower ranges widen to 800 and 400", () => {
  assert.deepEqual(scoreScale("sat", 1500).scale, [1000, 1600]);
  assert.deepEqual(scoreScale("sat", 940).scale, [800, 1600]);
  assert.deepEqual(scoreScale("sat", 820).scale, [400, 1600]);
});

test("a typed-in score below the range widens the axis so the You marker stays on it", () => {
  assert.deepEqual(scoreScale("sat", 1500, 900).scale, [800, 1600]);
  assert.deepEqual(scoreScale("act", 34, 15).scale, [12, 36]);
});

test("ACT and SAT section tiers, and missing values fall back to the full range", () => {
  assert.deepEqual(scoreScale("act", 19).scale, [18, 36]);
  assert.deepEqual(scoreScale("act", 18).scale, [12, 36]);
  assert.deepEqual(scoreScale("sat-section", 730, 480).scale, [400, 800]);
  assert.deepEqual(scoreScale("sat", null).scale, [400, 1600]);
});

test("every tier holds the national median midpoints (about 1175 SAT, 24 ACT)", () => {
  for (const v of [1500, 1000, 700]) assert.ok(scoreScale("sat", v).scale[0] <= 1175);
  for (const v of [34, 20, 10]) assert.ok(scoreScale("act", v).scale[0] <= 24);
});
