/**
 * lib/student-profile.ts: GPA conversion, sanitizing untrusted input, completeness, and the fit predicates
 * (specs/product/student-profile.md). Pure module, no database or server needed. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { School } from "../lib/types.ts";
import {
  completeness,
  completenessScore,
  emptyProfile,
  fitsPreferences,
  fitsScores,
  gpaDisplay,
  sanitizeProfile,
  unweightedGpa4,
  type StudentProfileData,
} from "../lib/student-profile.ts";
// lib/student-profile.ts: only type-only internal imports plus lib/score-bands.ts and lib/majors.ts, both of which
// are themselves type-only internally, so this resolves under plain Node ESM (no bundler) just like those two.

/** A college shaped like data/schools.json, with only what fitsScores/fitsPreferences read. */
function school(
  id: string,
  o: {
    sat?: [number, number] | null;
    act?: [number, number] | null;
    testPolicy?: School["admissions"]["test_policy"];
    enrollment?: number;
    setting?: "city" | "suburb" | "town" | "rural" | null;
    state?: string;
    region?: string;
    type?: School["type"];
    avgPaidAll?: number | null;
  } = {},
): School {
  const sat = o.sat === undefined ? null : o.sat;
  return {
    unit_id: id,
    name: `College ${id}`,
    location: { city: "City", state: o.state ?? "MA", zip: "02138", region: o.region ?? "New England" },
    type: o.type ?? "private-nonprofit",
    admissions: {
      year: 2024,
      applicants: 1000,
      admitted: 500,
      enrolled: 200,
      acceptance_rate: 0.5,
      sat_reading_25_75: sat ? [Math.round(sat[0] / 2), Math.round(sat[1] / 2)] : null,
      sat_math_25_75: sat ? [Math.round(sat[0] / 2), Math.round(sat[1] / 2)] : null,
      act_composite_25_75: o.act === undefined ? null : o.act,
      test_submission_rate_sat: null,
      test_submission_rate_act: null,
      test_policy: o.testPolicy ?? null,
    },
    demographics: { undergrad_enrollment: o.enrollment ?? 7000 },
    campus: o.setting === undefined ? undefined : { setting: o.setting ? { locale: 11, label: "x", group: o.setting } : null },
    cost: { avg_paid_all: o.avgPaidAll === undefined ? null : o.avgPaidAll, cost_of_attendance: null } as School["cost"],
  } as unknown as School;
}

/* ------------------------------------------------------------------ */
/* GPA conversion                                                      */
/* ------------------------------------------------------------------ */

test("unweightedGpa4: 4.0 scale passes through (capped at 4.0), 5.0 scale scales proportionally", () => {
  assert.equal(unweightedGpa4(3.8, "4.0"), 3.8);
  assert.equal(unweightedGpa4(4.3, "4.0"), 4.0);
  assert.equal(unweightedGpa4(4.5, "5.0"), 3.6);
  assert.equal(unweightedGpa4(null, "4.0"), null);
});

test("unweightedGpa4: the 100-point table matches the worked example (93 -> 3.7)", () => {
  assert.equal(unweightedGpa4(93, "100"), 3.7);
  assert.equal(unweightedGpa4(100, "100"), 4.0);
  assert.equal(unweightedGpa4(97, "100"), 4.0);
  assert.equal(unweightedGpa4(64, "100"), 0.0);
  assert.equal(unweightedGpa4(80, "100"), 2.3);
});

test("gpaDisplay shows the conversion only when the scale isn't already 4.0", () => {
  assert.equal(gpaDisplay({ gpa: 3.8, gpaScale: "4.0" }), "3.8 unweighted");
  assert.equal(gpaDisplay({ gpa: 93, gpaScale: "100" }), "about 3.7 unweighted (from 93/100)");
  assert.equal(gpaDisplay({ gpa: 4.5, gpaScale: "5.0" }), "about 3.6 unweighted (from 4.5/5.0)");
  assert.equal(gpaDisplay({ gpa: null, gpaScale: "4.0" }), null);
});

/* ------------------------------------------------------------------ */
/* Sanitizing                                                          */
/* ------------------------------------------------------------------ */

test("sanitizeProfile never throws on garbage and always returns a complete shape", () => {
  assert.deepEqual(sanitizeProfile(null), emptyProfile());
  assert.deepEqual(sanitizeProfile("not an object"), emptyProfile());
  assert.deepEqual(sanitizeProfile([1, 2, 3]), emptyProfile());
  assert.deepEqual(sanitizeProfile({}), emptyProfile());
});

test("sanitizeProfile drops out-of-range and wrongly typed values instead of coercing them to 0", () => {
  const out = sanitizeProfile({
    tests: { satTotal: 9999, actComposite: "32", satMath: 650 },
    academics: { gpa: -1, classRankPercentile: 200 },
    plans: { intendedMajors: ["11", "not-a-family", "52", "11"] },
  });
  assert.equal(out.tests.satTotal, null, "out-of-range SAT dropped, not clamped");
  assert.equal(out.tests.actComposite, 32, "numeric strings are accepted");
  assert.equal(out.tests.satMath, 650);
  assert.equal(out.academics.gpa, null, "negative GPA dropped");
  assert.equal(out.academics.classRankPercentile, null, "percentile over 100 dropped");
  assert.deepEqual(out.plans.intendedMajors, ["11", "52"], "unknown family dropped, duplicate dropped");
});

test("sanitizeProfile caps intended majors at 3 and preferences at their lists", () => {
  const out = sanitizeProfile({ plans: { intendedMajors: ["11", "52", "42", "26"] } });
  assert.deepEqual(out.plans.intendedMajors, ["11", "52", "42"]);
});

/* ------------------------------------------------------------------ */
/* Completeness                                                        */
/* ------------------------------------------------------------------ */

test("completeness lists what's missing per tool, and the score is the met fraction", () => {
  const empty = emptyProfile();
  assert.ok(completeness(empty).every((i) => !i.met));
  assert.equal(completenessScore(empty), 0);

  const withScores: StudentProfileData = { ...empty, tests: { ...empty.tests, satTotal: 1450 } };
  const items = completeness(withScores);
  assert.ok(items.find((i) => i.tool.includes("ScoreChecker"))?.met);
  assert.ok(items.find((i) => i.tool.includes("Fits my scores"))?.met);
  assert.ok(!items.find((i) => i.tool.includes("Chances"))?.met);
  assert.ok(completenessScore(withScores) > 0 && completenessScore(withScores) < 1);
});

/* ------------------------------------------------------------------ */
/* fitsScores                                                          */
/* ------------------------------------------------------------------ */

test("fitsScores: in when the score is within the SAT or ACT range", () => {
  const s = school("a", { sat: [1300, 1500] });
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, satTotal: 1400 } };
  assert.equal(fitsScores(s, profile), "in");
});

test("fitsScores: out when the score is outside every range the college reports", () => {
  const s = school("a", { sat: [1300, 1500] });
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, satTotal: 1100 } };
  assert.equal(fitsScores(s, profile), "out");
});

test("fitsScores: test-blind colleges are always in", () => {
  const s = school("a", { testPolicy: "not-considered" });
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, satTotal: 900 } };
  assert.equal(fitsScores(s, profile), "in");
});

test("fitsScores: a college with no ranges at all is unknown, not out, and not in", () => {
  const s = school("a"); // no sat, no act, no test_policy
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, satTotal: 1400 } };
  assert.equal(fitsScores(s, profile), "unknown");
});

test("fitsScores: with no score on file, a reporting college is still unknown (nothing to compare)", () => {
  const s = school("a", { sat: [1300, 1500] });
  assert.equal(fitsScores(s, emptyProfile()), "unknown");
});

test("fitsScores: ACT alone can also put a student in", () => {
  const s = school("a", { act: [28, 33] });
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, actComposite: 30 } };
  assert.equal(fitsScores(s, profile), "in");
});

/* ------------------------------------------------------------------ */
/* fitsPreferences                                                      */
/* ------------------------------------------------------------------ */

test("fitsPreferences: everything fits when no preference is set", () => {
  const s = school("a");
  assert.equal(fitsPreferences(s, emptyProfile()), "in");
});

test("fitsPreferences: size and type must both match when both are set", () => {
  const s = school("a", { enrollment: 2000, type: "private-nonprofit" });
  const profile = { ...emptyProfile(), preferences: { ...emptyProfile().preferences, sizes: ["small" as const], types: ["private-nonprofit" as const] } };
  assert.equal(fitsPreferences(s, profile), "in");
  const mismatched = { ...profile, preferences: { ...profile.preferences, types: ["public" as const] } };
  assert.equal(fitsPreferences(s, mismatched), "out");
});

test("fitsPreferences: setting unknown (no campus.setting) is unknown, not out, when no other preference fails", () => {
  const s = school("a", { setting: null });
  const profile = { ...emptyProfile(), preferences: { ...emptyProfile().preferences, settings: ["city" as const] } };
  assert.equal(fitsPreferences(s, profile), "unknown");
});

test("fitsPreferences: one definite mismatch outranks an unknown elsewhere", () => {
  const s = school("a", { setting: null, enrollment: 30000 });
  const profile = {
    ...emptyProfile(),
    preferences: { ...emptyProfile().preferences, settings: ["city" as const], sizes: ["small" as const] },
  };
  assert.equal(fitsPreferences(s, profile), "out");
});

test("fitsPreferences: max average cost compares against avg_paid_all", () => {
  const cheap = school("a", { avgPaidAll: 15000 });
  const pricey = school("b", { avgPaidAll: 60000 });
  const profile = { ...emptyProfile(), preferences: { ...emptyProfile().preferences, maxAverageCost: 20000 } };
  assert.equal(fitsPreferences(cheap, profile), "in");
  assert.equal(fitsPreferences(pricey, profile), "out");
});
