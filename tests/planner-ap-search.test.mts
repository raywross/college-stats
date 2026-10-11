/**
 * The intake's AP picker finds a course by the name students actually type (lib/planner/intake.ts searchAp; owner
 * 2026-10-11: "Lit should give you the English Literature, you shouldn't have to go searching for the full word"):
 * nicknames first, then word starts, never the middle of a word. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchAp } from "../lib/planner/intake.ts";

const keys = (q: string, ex: string[] = []) => searchAp(q, ex).map((c) => c.key);
const first = (q: string) => keys(q)[0];

test("a nickname puts its course first", () => {
  const cases: [string, string][] = [
    ["lit", "ap_english_literature"],
    ["Lit", "ap_english_literature"],
    ["eng lit", "ap_english_literature"],
    ["lang", "ap_english_language"],
    ["bio", "ap_biology"],
    ["AP Bio", "ap_biology"],
    ["chem", "ap_chemistry"],
    ["psych", "ap_psychology"],
    ["stats", "ap_statistics"],
    ["precalc", "ap_precalculus"],
    ["apush", "ap_us_history"],
    ["e&m", "ap_physics_c_electricity_and_magnetism"],
    ["Physics C: E&M", "ap_physics_c_electricity_and_magnetism"],
    ["mech", "ap_physics_c_mechanics"],
    ["macro", "ap_macroeconomics"],
    ["micro", "ap_microeconomics"],
    ["comp gov", "ap_comparative_government"],
    ["human geo", "ap_human_geography"],
    ["span lit", "ap_spanish_literature"],
    ["mandarin", "ap_chinese"],
  ];
  for (const [q, key] of cases) assert.equal(first(q), key, q);
});

test("a match is the start of a word, never the middle of one", () => {
  // "lit" is inside "Politics": the two government courses must not appear for it.
  assert.ok(!keys("lit").includes("ap_us_government"));
  assert.ok(!keys("lit").includes("ap_comparative_government"));
  assert.deepEqual(keys("lit"), ["ap_english_literature", "ap_spanish_literature"]);
});

test("a shared nickname lists every course it names, popular ones first", () => {
  assert.deepEqual(keys("calc").slice(0, 2), ["ap_calculus_ab", "ap_calculus_bc"]);
  assert.deepEqual(keys("econ"), ["ap_macroeconomics", "ap_microeconomics"]);
  const physics = keys("physics");
  for (const k of ["ap_physics_1", "ap_physics_2", "ap_physics_c_mechanics", "ap_physics_c_electricity_and_magnetism"]) assert.ok(physics.includes(k), k);
});

test("typing part of a nickname or a name already narrows the list", () => {
  assert.equal(first("psy"), "ap_psychology");
  assert.equal(first("chemi"), "ap_chemistry");
  assert.ok(keys("cal").includes("ap_calculus_ab"));
});
