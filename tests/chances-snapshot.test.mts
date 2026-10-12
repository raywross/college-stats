/**
 * Application snapshots (specs/chances/calibration.md "Collecting outcomes" 1): the binned row lib/chances/snapshot.ts
 * builds (GPA to 0.05, scores to 10 SAT / 1 ACT, grades to 0.1; no name, no high school id, no free text), the
 * best-effort write in the applied transition (lib/chances/snapshot-write.ts: never throws, tolerant of the missing
 * table, the estimate injected), and the migrations' text (no identifying column, consent and cleanup in place,
 * writes only through the function, the summary public-read and service-written). Guards break each rule on purpose.
 * Row-level behavior against real Postgres: tests/chances-snapshot-policies.test.mts. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  ABLATION_INPUTS,
  apBand,
  binOdds,
  binCompleteness,
  binGpa,
  binGrade,
  binTest,
  buildSnapshot,
  estimateInputFromProfile,
  lastFinishedSeason,
  SNAPSHOT_COLUMNS,
  snapshotSeason,
  type AppliedEstimate,
} from "../lib/chances/snapshot.ts";
import { cleanupUnconsentedSnapshots, hooksForItem, isMissingSchema, snapshotOnApplied, type SnapshotDeps } from "../lib/chances/snapshot-write.ts";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { CourseEntry, EstimateResult } from "../lib/chances/types.ts";

const SNAPSHOT_SQL = readFileSync(new URL("../supabase/migrations/20261011100000_application_snapshots.sql", import.meta.url), "utf8");
const SUMMARY_SQL = readFileSync(new URL("../supabase/migrations/20261011110000_chances_summary.sql", import.meta.url), "utf8");
const STORE_APPLY = readFileSync(new URL("../lib/planner/store-apply.ts", import.meta.url), "utf8");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const course = (over: Partial<CourseEntry>): CourseEntry => ({
  id: Math.random().toString(36).slice(2),
  kind: "ap",
  key: "ap_calculus_bc",
  name: null,
  subject: "math",
  year: 11,
  status: "taken",
  grades: { s1: null, s2: null, final: "A" },
  exam: 5,
  ...over,
});

function profile(): StudentProfileData {
  const p = emptyProfile();
  p.basics.stateOfResidence = "IN";
  p.basics.highSchool = "Lincoln Memorial High School";
  p.basics.highSchoolId = "180000000123";
  p.basics.gradYear = 2027;
  p.academics.gpa = 3.87;
  p.academics.gpaScale = "4.0";
  p.academics.classRankPercentile = 7;
  p.academics.courses = [
    course({}),
    course({ key: "ap_physics_c_mechanics", subject: "science", grades: { s1: null, s2: null, final: "B+" } }),
    course({ kind: "dual", key: null, name: "Calculus III at Ivy Tech Community College", subject: "math", grades: { s1: null, s2: null, final: "A-" } }),
    course({ kind: "ap", key: "ap_chemistry", subject: "science", year: 12, status: "planned", grades: { s1: null, s2: null, final: null }, exam: null }),
    course({ kind: "honors", key: null, name: "Honors English 10 with Mrs. Alvarez", subject: "english", year: 10, grades: { s1: null, s2: null, final: "A" }, exam: null }),
  ];
  p.tests.satTotal = 1437;
  p.tests.satMath = 746;
  p.tests.focus = "sat";
  p.plans.intendedMajors = ["14", "11"];
  return p;
}

const result = (over: Partial<EstimateResult> = {}): EstimateResult => ({
  unitId: "243780",
  group: "target",
  label: null,
  used: ["gpa", "test", "courses", "state"],
  missing: ["class_rank"],
  facts: ["admissions.acceptance_rate"],
  notes: [
    { key: "rigor.much", values: { taken: 3, offered: 14 } },
    { key: "rigor.grades", values: { a: 2, finished: 3, gpa: "3.77" } },
  ],
  send: "send",
  moveUp: null,
  closeness: null,
  ed: null,
  modelVersion: "2026.10.1",
  ...over,
});

const OFFERING = { apCount: 14, apKeys: null, ib: false, dual: true, source: "crdc" as const, field: "rigor.ap_courses" };

/* ------------------------------------------------------------------ */
/* Binning                                                             */
/* ------------------------------------------------------------------ */

test("binning: GPA to 0.05, grades to 0.1, SAT to 10, ACT to 1, clamped to each scale", () => {
  assert.equal(binGpa(3.87), 3.85);
  assert.equal(binGpa(3.88), 3.9);
  assert.equal(binGpa(3.824), 3.8);
  assert.equal(binGpa(4.3), 4);
  assert.equal(binGpa(null), null);
  assert.equal(binGpa(Number.NaN), null);
  assert.equal(binGrade(3.77), 3.8);
  assert.equal(binGrade(3.333), 3.3);
  assert.deepEqual(binTest({ kind: "sat", score: 1437 }), { test_kind: "sat", test_score: 1440 });
  assert.deepEqual(binTest({ kind: "sat", score: 1604 }), { test_kind: "sat", test_score: 1600 });
  assert.deepEqual(binTest({ kind: "act", score: 31.4 }), { test_kind: "act", test_score: 31 });
  assert.deepEqual(binTest(null), { test_kind: null, test_score: null });
});

test("the high school is a band of what it offers, never the school", () => {
  assert.equal(apBand(null), null);
  assert.equal(apBand(0), "none");
  assert.equal(apBand(5), "1-5");
  assert.equal(apBand(6), "6-10");
  assert.equal(apBand(15), "11-15");
  assert.equal(apBand(38), "16+");
});

test("seasons: applied July or later counts toward the next fall; a season finishes September 1", () => {
  assert.equal(snapshotSeason("2026-06-30"), 2026);
  assert.equal(snapshotSeason("2026-07-01"), 2027);
  assert.equal(snapshotSeason("2027-01-05"), 2027);
  assert.equal(lastFinishedSeason("2026-08-31"), 2025);
  assert.equal(lastFinishedSeason("2026-09-01"), 2026);
  assert.equal(lastFinishedSeason("2026-10-11"), 2026);
});

test("the snapshot: binned inputs, course counts and grades, the estimate's group, label, keys, and version", () => {
  const input = estimateInputFromProfile(profile(), "243780", "ea");
  const row = buildSnapshot({ input, estimate: { result: result() }, offering: OFFERING, admitRate: 0.4987, studentGroup: null });
  assert.equal(row.gpa, 3.9, "the contract's gpa is unweightedGpa4 (one decimal); the range keeps 3.87 to 0.05");
  assert.deepEqual([row.gpa_low, row.gpa_high], [3.85, 3.85]);
  assert.deepEqual([row.test_kind, row.test_score, row.sat_math], ["sat", 1440, 750]);
  assert.equal(row.class_rank_pct, 7);
  assert.equal(row.state, "IN");
  assert.deepEqual(row.majors, ["14", "11"]);
  assert.equal(row.round, "ea");
  assert.equal(row.advanced_courses, 4, "AP, IB, and dual rows, any status");
  assert.equal(row.advanced_planned, 1);
  assert.equal(row.honors_courses, 1);
  assert.equal(row.advanced_gpa, 3.7, "(4.0 + 3.3 + 3.7) / 3 = 3.67, to 0.1");
  assert.equal(row.math_gpa, 3.9, "(4.0 + 3.7) / 2 = 3.85, to 0.1 (no float drift down to 3.8)");
  assert.equal(row.science_gpa, 3.3);
  assert.deepEqual([row.hs_ap_band, row.hs_ib, row.hs_dual], ["11-15", false, true]);
  assert.equal(row.admit_rate, 0.5);
  assert.equal(row.estimate_group, "target");
  assert.equal(row.estimate_label, null);
  assert.deepEqual(row.inputs_used, ["gpa", "test", "courses", "state"]);
  assert.deepEqual(row.note_keys, ["rigor.much", "rigor.grades"]);
  assert.equal(row.model_version, "2026.10.1");
  assert.equal(row.group_changed, false);
});

test("estimateInputFromProfile: class standing, activities, awards, and first generation pass onto EstimateStudent unchanged (depth.md, inputs-beyond-academics.md) — U3 only wires them, never scores them", () => {
  const p = profile();
  p.academics.classStanding = "top10";
  p.academics.firstGeneration = true;
  p.academics.activities = [{ id: "a1", name: "Robotics", kind: "club", years: [11, 12], roles: { 11: "member", 12: "leader" }, hoursPerWeek: 6, recognition: 2, relatedToMajor: true }];
  p.academics.awards = [{ id: "w1", key: "honor_roll", name: "Honor roll", tier: 4, year: 11 }];
  const input = estimateInputFromProfile(p, "243780", null);
  assert.equal(input.student.classStanding, "top10");
  assert.equal(input.student.firstGeneration, true);
  assert.deepEqual(input.student.activities, p.academics.activities);
  assert.deepEqual(input.student.awards, p.academics.awards);
  // A profile with none of the four set still gives EstimateStudent the documented empty/null defaults.
  const bare = estimateInputFromProfile(emptyProfile(), "243780", null);
  assert.deepEqual(bare.student.activities, []);
  assert.deepEqual(bare.student.awards, []);
  assert.equal(bare.student.classStanding, null);
  assert.equal(bare.student.firstGeneration, null);
});

test("estimateInputFromProfile: weightedGpa and rankExpectation pass onto EstimateStudent unchanged (U11 only wires them, never scores them)", () => {
  const p = profile();
  p.academics.weightedGpa = 4.4;
  p.academics.rankExpectation = "valedictorian";
  const input = estimateInputFromProfile(p, "243780", null);
  assert.equal(input.student.weightedGpa, 4.4);
  assert.equal(input.student.rankExpectation, "valedictorian");
  const bare = estimateInputFromProfile(emptyProfile(), "243780", null);
  assert.equal(bare.student.weightedGpa, null);
  assert.equal(bare.student.rankExpectation, null);
});

test("no name, no high school id, no typed course name, no note text: the row's keys are exactly the columns", () => {
  const p = profile();
  const row = buildSnapshot({ input: estimateInputFromProfile(p, "243780", "rd"), estimate: { result: result() }, offering: OFFERING, admitRate: 0.5, studentGroup: "likely" });
  assert.deepEqual(Object.keys(row).sort(), [...SNAPSHOT_COLUMNS].sort());
  const text = JSON.stringify(row);
  for (const secret of [p.basics.highSchool!, p.basics.highSchoolId!, "Ivy Tech", "Alvarez", "3.77", "ap_calculus_bc"]) {
    assert.ok(!text.includes(secret), `the snapshot must not carry "${secret}"`);
  }
  for (const banned of ["name", "high_school", "school_id", "notes", "email", "text"]) {
    assert.ok(!Object.keys(row).some((k) => k.includes(banned)), `no column like "${banned}"`);
  }
});

test("guard: a row carrying the high school id fails the no-identity check", () => {
  const row = buildSnapshot({ input: estimateInputFromProfile(profile(), "243780", null), estimate: null, offering: null, admitRate: null, studentGroup: null });
  const leaky = { ...row, high_school_id: "180000000123" };
  assert.throws(() => assert.deepEqual(Object.keys(leaky).sort(), [...SNAPSHOT_COLUMNS].sort()));
});

test("the student's own group: recorded when picked, and changed only when it differs from the estimate", () => {
  const input = estimateInputFromProfile(profile(), "243780", null);
  const kept = buildSnapshot({ input, estimate: { result: result() }, offering: null, admitRate: 0.3, studentGroup: "target" });
  assert.deepEqual([kept.student_group, kept.group_changed], ["target", false]);
  const moved = buildSnapshot({ input, estimate: { result: result() }, offering: null, admitRate: 0.3, studentGroup: "reach" });
  assert.deepEqual([moved.student_group, moved.group_changed], ["reach", true]);
  const auto = buildSnapshot({ input, estimate: { result: result() }, offering: null, admitRate: 0.3, studentGroup: null });
  assert.deepEqual([auto.student_group, auto.group_changed], [null, false]);
  const unsorted = buildSnapshot({ input, estimate: { result: result() }, offering: null, admitRate: 0.3, studentGroup: "unsorted" });
  assert.equal(unsorted.student_group, null);
});

test("without an estimate the inputs are still recorded; malformed estimate values become null", () => {
  const input = estimateInputFromProfile(profile(), "243780", null);
  const bare = buildSnapshot({ input, estimate: null, offering: null, admitRate: null, studentGroup: null });
  assert.equal(bare.gpa_low, 3.85);
  assert.deepEqual([bare.estimate_group, bare.model_version, bare.inputs_used, bare.note_keys], [null, null, [], []]);
  const bad = buildSnapshot({
    input,
    estimate: {
      result: result({ group: "maybe" as never, label: "sure-thing" as never, modelVersion: "v 1; drop table", used: ["gpa", "essay" as never], notes: [{ key: "Free Text!", values: {} }] }),
      detail: { position: "middle" as never, baseRateKind: "legacy" as never, rigorReading: "lots" as never, without: { rigor: "likely", rank: "certain" as never } },
    },
    offering: null,
    admitRate: 7,
    studentGroup: null,
  });
  assert.deepEqual([bad.estimate_group, bad.estimate_label, bad.model_version], [null, null, null]);
  assert.deepEqual(bad.inputs_used, ["gpa"]);
  assert.deepEqual(bad.note_keys, []);
  assert.deepEqual([bad.position, bad.base_rate_kind, bad.rigor_reading], [null, null, null]);
  assert.deepEqual([bad.without_rigor, bad.without_rank], ["likely", null]);
  assert.equal(bad.admit_rate, 1, "clamped to 0–1");
});

test("method details: position, base rate, crowding, rigor reading, and each input switched off", () => {
  const estimate: AppliedEstimate = {
    result: result({ group: "safe", label: "guaranteed" }),
    detail: {
      position: "above",
      baseRateKind: "guaranteed",
      baseRate: null,
      crowded: true,
      rigorReading: "most",
      hiddenOdds: 0.7234,
      selectivityTier: "highly_selective",
      without: { residency: "likely", crowding: "target", rigor: "target", rank: "reach", depth: "high_reach", hooks: "safe", interest: "likely" },
    },
  };
  const row = buildSnapshot({ input: estimateInputFromProfile(profile(), "228778", null), estimate, offering: null, admitRate: 0.31, studentGroup: null });
  assert.deepEqual([row.estimate_group, row.estimate_label, row.position, row.base_rate_kind, row.crowded, row.rigor_reading], ["safe", "guaranteed", "above", "guaranteed", true, "most"]);
  assert.deepEqual(ABLATION_INPUTS, ["residency", "crowding", "rigor", "rank", "depth", "hooks", "interest"]);
  assert.deepEqual(
    ABLATION_INPUTS.map((k) => row[`without_${k}` as const]),
    ["likely", "target", "target", "reach", "high_reach", "safe", "likely"],
  );
  assert.equal(row.hidden_odds, 0.725, "binned to 0.005");
  assert.equal(row.selectivity_tier, "highly_selective");
});

test("the five levels: every level and the three labels are stored; a stale or made-up one is null", () => {
  const input = estimateInputFromProfile(profile(), "243780", null);
  for (const g of ["high_reach", "reach", "target", "likely", "safe"] as const) {
    const row = buildSnapshot({ input, estimate: { result: result({ group: g }) }, offering: null, admitRate: 0.3, studentGroup: g });
    assert.deepEqual([row.estimate_group, row.student_group, row.group_changed], [g, g, false]);
  }
  for (const label of ["elite", "guaranteed", "recruited"] as const) assert.equal(buildSnapshot({ input, estimate: { result: result({ label }) }, offering: null, admitRate: 0.3, studentGroup: null }).estimate_label, label);
  const stale = buildSnapshot({ input, estimate: { result: result({ label: "reach-for-everyone" as never, group: "long_shot" as never }), detail: { selectivityTier: "ivy" as never, hiddenOdds: Number.NaN } }, offering: null, admitRate: 0.3, studentGroup: null });
  assert.deepEqual([stale.estimate_label, stale.estimate_group, stale.selectivity_tier, stale.hidden_odds], [null, null, null, null]);
});

test("the hidden odds are binned to 0.005 and clamped to 0–1; inputs_used holds the newer kinds the column's check allows", () => {
  assert.deepEqual([binOdds(0.0024), binOdds(0.0026), binOdds(0.4125), binOdds(0.97), binOdds(1.4), binOdds(-0.1), binOdds(null)], [0, 0.005, 0.415, 0.97, 1, 0, null]);
  const row = buildSnapshot({
    input: estimateInputFromProfile(profile(), "243780", null),
    estimate: { result: result({ used: ["gpa", "activities", "legacy", "class_standing", "essay" as never] }), detail: { hiddenOdds: 0.41234 } },
    offering: null,
    admitRate: 0.3,
    studentGroup: null,
  });
  assert.equal(row.hidden_odds, 0.41);
  assert.deepEqual(row.inputs_used, ["gpa", "activities", "legacy", "class_standing"], "a kind the check doesn't list is dropped");
  const sql = readFileSync(new URL("../supabase/migrations/20261012100000_five_levels.sql", import.meta.url), "utf8");
  for (const k of ["activities", "awards", "work", "legacy", "recruited", "interest", "class_standing"]) assert.ok(sql.includes(`'${k}'`), `the check allows ${k}`);
});

test("Revision 2: completeness is written from the method's detail, binned to 0.05 and clamped to 0–1; absent or malformed reads null", () => {
  assert.deepEqual([binCompleteness(4 / 7), binCompleteness(1 / 7), binCompleteness(0.024), binCompleteness(1), binCompleteness(1.3), binCompleteness(-0.2), binCompleteness(null)], [0.55, 0.15, 0, 1, 1, 0, null]);
  const input = estimateInputFromProfile(profile(), "243780", null);
  const row = buildSnapshot({ input, estimate: { result: result(), detail: { completeness: 6 / 7 } }, offering: null, admitRate: 0.3, studentGroup: null });
  assert.equal(row.completeness, 0.85);
  assert.ok(SNAPSHOT_COLUMNS.includes("completeness"));
  assert.equal(buildSnapshot({ input, estimate: { result: result() }, offering: null, admitRate: 0.3, studentGroup: null }).completeness, null);
  assert.equal(buildSnapshot({ input, estimate: { result: result(), detail: { completeness: Number.NaN } }, offering: null, admitRate: 0.3, studentGroup: null }).completeness, null);
  // Every binned value meets the column's check (a multiple of 0.05 between 0 and 1).
  for (let i = 0; i <= 100; i++) {
    const v = binCompleteness(i / 97)!;
    assert.ok(v >= 0 && v <= 1 && Math.abs(Math.round(v * 100) % 5) === 0, `${i / 97} → ${v}`);
  }
});

test("a snapshot never holds an activity's, award's, or course's name, even with the Depth readings in the detail", () => {
  const p = profile();
  p.academics.activities = [{ id: "a1", name: "Lincoln Robotics Team 4567", kind: "club", years: [10, 11, 12], roles: { 12: "leader" }, hoursPerWeek: 8, recognition: 2, relatedToMajor: true }];
  p.academics.awards = [{ id: "w1", key: null, name: "Mayor's Youth Award for Jane Doe", tier: 3, year: 11 }];
  const input = estimateInputFromProfile(p, "243780", null);
  const row = buildSnapshot({
    input,
    estimate: { result: result(), detail: { depth: { courseReadings: { math: "deep" }, majorDeep: true, lightExpectedCount: 0, activitiesReading: "building", activitiesCount: 1, topTwoYears: [3], trajectory: true, recognition: 2, workHours: null } } },
    offering: null,
    admitRate: 0.3,
    studentGroup: null,
  });
  const text = JSON.stringify(row);
  for (const secret of ["Robotics", "4567", "Mayor", "Jane", "Doe"]) assert.ok(!text.includes(secret), secret);
});

test("a weighted GPA is kept as its range", () => {
  const p = profile();
  p.academics.gpa = 4.42;
  p.academics.gpaScale = "5.0";
  const row = buildSnapshot({ input: estimateInputFromProfile(p, "1", null), estimate: null, offering: null, admitRate: null, studentGroup: null });
  assert.equal(row.gpa_scale, "5.0");
  assert.ok(row.gpa_low !== null && row.gpa_high !== null && row.gpa_low <= row.gpa_high);
  assert.equal(Math.round(row.gpa_low! * 20), row.gpa_low! * 20);
});

/* ------------------------------------------------------------------ */
/* The write in the applied transition                                 */
/* ------------------------------------------------------------------ */

type Res = { data: unknown; error: { code?: string; message: string } | null };

function fakeDb(tables: Record<string, Res | (() => never)>, rpcResult: Res | (() => never)) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpcCalls,
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const t = tables[table];
          if (typeof t === "function") return t();
          return t ?? { data: null, error: null };
        },
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (typeof rpcResult === "function") return rpcResult();
      return rpcResult;
    },
  };
  return db;
}

const ITEM = "11111111-2222-3333-4444-555555555555";
const tables = (over: Record<string, Res> = {}): Record<string, Res> => ({
  list_items: { data: { list_id: "L", unit_id: "243780", round: "ea", category: "reach", category_source: "student", applied_on: "2026-11-01" }, error: null },
  lists: { data: { student_id: "S" }, error: null },
  student_profiles: { data: { data: profile() }, error: null },
  ...over,
});

function deps(db: ReturnType<typeof fakeDb>, over: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    supabase: db as unknown as SnapshotDeps["supabase"],
    estimate: () => ({ result: result() }),
    offeringFor: () => OFFERING,
    admitRateFor: () => 0.42,
    ...over,
  };
}

test("snapshotOnApplied: records the binned row through record_application_snapshot with the estimate it was given", async () => {
  const db = fakeDb(tables(), { data: "id", error: null });
  const seen: unknown[] = [];
  const outcome = await snapshotOnApplied(ITEM, deps(db, { estimate: (input) => (seen.push(input), { result: result() }) }));
  assert.equal(outcome, "written");
  assert.equal(db.rpcCalls.length, 1);
  assert.equal(db.rpcCalls[0].fn, "record_application_snapshot");
  assert.equal(db.rpcCalls[0].args.p_item, ITEM);
  const row = db.rpcCalls[0].args.p_snapshot as Record<string, unknown>;
  assert.deepEqual([row.gpa_low, row.estimate_group, row.student_group, row.group_changed, row.admit_rate, row.hs_ap_band, row.round], [3.85, "target", "reach", true, 0.42, "11-15", "ea"]);
  assert.equal((seen[0] as { unitId: string }).unitId, "243780", "the estimator gets the same input the snapshot bins");
  assert.ok(!JSON.stringify(row).includes("180000000123"));
});

test("snapshotOnApplied: the estimator gets the list row's legacy and recruited inputs and whether interest is logged", async () => {
  const db = fakeDb(
    tables({
      list_items: { data: { list_id: "L", unit_id: "243780", round: "ed", category: "reach", category_source: "auto", applied_on: "2026-11-01", legacy: true, recruited: "contact", legacy_sibling: true }, error: null },
      plan_visits: { data: { id: "v1" }, error: null },
    }),
    { data: "id", error: null },
  );
  const seen: { hooks?: unknown }[] = [];
  assert.equal(await snapshotOnApplied(ITEM, deps(db, { estimate: (input) => (seen.push(input), { result: result() }) })), "written");
  assert.deepEqual(seen[0].hooks, { legacy: true, sibling: true, recruited: "contact", interest: true });
  const row = db.rpcCalls[0].args.p_snapshot as Record<string, unknown>;
  assert.ok(!("legacy" in row) && !("recruited" in row) && !("interest" in row), "the toggles themselves aren't columns");
});

test("hooksForItem: best-effort; a database without the columns, or a failing read, reads as nothing marked", async () => {
  const missing = fakeDb({ list_items: { data: null, error: { code: "42703", message: "column list_items.legacy does not exist" } } }, { data: null, error: null });
  assert.deepEqual(await hooksForItem(missing as never, ITEM), { legacy: false, sibling: false, recruited: "none", interest: false });
  const throwing = fakeDb({ list_items: () => { throw new Error("down"); }, plan_visits: () => { throw new Error("down"); }, plan_tasks: () => { throw new Error("down"); } }, { data: null, error: null });
  assert.deepEqual(await hooksForItem(throwing as never, ITEM), { legacy: false, sibling: false, recruited: "none", interest: false });
  const junk = fakeDb({ list_items: { data: { legacy: "yes", recruited: "signed" }, error: null }, plan_tasks: { data: { id: "t1" }, error: null } }, { data: null, error: null });
  assert.deepEqual(await hooksForItem(junk as never, ITEM), { legacy: false, sibling: false, recruited: "none", interest: true }, "a completed information request is interest");
});

test("snapshotOnApplied: an estimator that throws, or none at all, still records the inputs", async () => {
  for (const estimate of [
    () => {
      throw new Error("model down");
    },
    async () => Promise.reject(new Error("timeout")),
    null,
  ]) {
    const db = fakeDb(tables(), { data: "id", error: null });
    assert.equal(await snapshotOnApplied(ITEM, deps(db, { estimate })), "written");
    const row = db.rpcCalls[0].args.p_snapshot as Record<string, unknown>;
    assert.deepEqual([row.gpa_low, row.estimate_group, row.model_version], [3.85, null, null]);
  }
});

test("snapshotOnApplied: a missing table or function reads as unavailable, never an error", async () => {
  const missingFn = fakeDb(tables(), { data: null, error: { code: "PGRST202", message: "Could not find the function public.record_application_snapshot" } });
  assert.equal(await snapshotOnApplied(ITEM, deps(missingFn)), "unavailable");
  const missingCol = fakeDb(tables({ list_items: { data: null, error: { code: "42703", message: "column list_items.category_source does not exist" } } }), { data: null, error: null });
  assert.equal(await snapshotOnApplied(ITEM, deps(missingCol)), "unavailable");
  assert.equal(missingCol.rpcCalls.length, 0);
});

test("snapshotOnApplied: never throws (a failing client, a refused write); nothing to record is skipped", async () => {
  const throwing = fakeDb({ list_items: () => { throw new Error("network"); } }, { data: null, error: null });
  assert.equal(await snapshotOnApplied(ITEM, deps(throwing)), "failed");
  const refused = fakeDb(tables(), { data: null, error: { code: "42501", message: "not_allowed" } });
  assert.equal(await snapshotOnApplied(ITEM, deps(refused)), "failed");
  const guardianList = fakeDb(tables({ lists: { data: { student_id: null }, error: null } }), { data: null, error: null });
  assert.equal(await snapshotOnApplied(ITEM, deps(guardianList)), "skipped");
  assert.equal(guardianList.rpcCalls.length, 0);
  const notApplied = fakeDb(tables({ list_items: { data: { list_id: "L", unit_id: "1", round: null, category: "unsorted", category_source: "auto", applied_on: null }, error: null } }), { data: null, error: null });
  assert.equal(await snapshotOnApplied(ITEM, deps(notApplied)), "skipped");
  const noProfile = fakeDb(tables({ student_profiles: { data: null, error: null } }), { data: "id", error: null });
  assert.equal(await snapshotOnApplied(ITEM, deps(noProfile)), "written");
});

test("cleanup helper: returns the count, or null when the function isn't there yet", async () => {
  assert.equal(await cleanupUnconsentedSnapshots({ rpc: async () => ({ data: 12, error: null }) } as never), 12);
  assert.equal(await cleanupUnconsentedSnapshots({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) } as never), null);
  assert.equal(await cleanupUnconsentedSnapshots({ rpc: async () => { throw new Error("down"); } } as never), null);
  assert.ok(isMissingSchema({ code: "42P01", message: "relation does not exist" }));
  assert.ok(!isMissingSchema({ code: "42501", message: "not_allowed" }));
});

test("markApplied records the snapshot after the response, through the injectable deps", () => {
  assert.match(STORE_APPLY, /import \{ after \} from "next\/server";/);
  assert.match(STORE_APPLY, /after\(\(\) => snapshotOnApplied\(itemId, snapshotDeps\(supabase\)\)\)/);
  // Still a valid "use server" module: every export is an async function.
  for (const m of STORE_APPLY.matchAll(/^export (?!type |interface )(\w+)/gm)) assert.equal(m[1], "async", `store-apply.ts exports only async functions, found "export ${m[1]}"`);
});

/* ------------------------------------------------------------------ */
/* The migrations' text                                                */
/* ------------------------------------------------------------------ */

/** The SQL without comments and with whitespace collapsed, lower case. */
const body = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();

/** The column names of `create table public.<table> (...)`. */
function columns(sql: string, table: string): string[] {
  const b = body(sql);
  const start = b.indexOf(`create table public.${table} (`);
  assert.ok(start >= 0, `create table public.${table}`);
  let depth = 0;
  let end = start;
  for (let i = b.indexOf("(", start); i < b.length; i++) {
    if (b[i] === "(") depth++;
    if (b[i] === ")" && --depth === 0) {
      end = i;
      break;
    }
  }
  const inner = b.slice(b.indexOf("(", start) + 1, end);
  const parts: string[] = [];
  let cur = "";
  depth = 0;
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts.filter((p) => p && !p.startsWith("constraint ")).map((p) => p.split(" ")[0]);
}

/** Problems with the snapshot migration's privacy rules; [] when it keeps them. */
function snapshotSchemaProblems(sql: string): string[] {
  const b = body(sql);
  const problems: string[] = [];
  const cols = columns(sql, "application_snapshots");
  for (const c of cols) if (/name|high_school_id|hs_id|school_id|email|phone|note_text|free|comment/.test(c)) problems.push(`identifying column ${c}`);
  for (const c of cols) {
    const def = b.match(new RegExp(`\\b${c} text\\b[^,]*`))?.[0];
    if (def && !/check \(/.test(def) && !/references/.test(def)) problems.push(`unchecked text column ${c}`);
  }
  if (!/alter table public\.application_snapshots enable row level security;/.test(b)) problems.push("rls off");
  if (!/revoke all on public\.application_snapshots from public, anon, authenticated;/.test(b)) problems.push("default grants kept");
  if (/grant [^;]*\b(insert|update|all)\b[^;]* on public\.application_snapshots to [^;]*authenticated/.test(b)) problems.push("users can write rows directly");
  if (/grant [^;]* on public\.application_snapshots to [^;]*\banon\b/.test(b)) problems.push("anon has access");
  if (!/create policy "snapshots: read" on public\.application_snapshots for select to authenticated using \(public\.can_read_list\(list_id\)\);/.test(b)) problems.push("read policy isn't the list's");
  if (!/after update of outcome_share_consented_at, student_id on public\.lists/.test(b)) problems.push("consent isn't kept in step");
  if (!/delete from public\.application_snapshots where not consented and season <= coalesce\(p_season, v_last\);/.test(b)) problems.push("cleanup doesn't delete unconsented finished seasons");
  if (!/raise exception 'season_not_finished'/.test(b)) problems.push("cleanup accepts an unfinished season");
  if (!/grant execute on function public\.delete_unconsented_snapshots\(integer\) to service_role;/.test(b) || /grant execute on function public\.delete_unconsented_snapshots\(integer\) to [^;]*authenticated/.test(b)) problems.push("cleanup isn't service-role only");
  if (!/having count\(\*\) >= 50 and count\(\*\) filter \(where li\.outcome = 'admitted'\) >= 10 and count\(\*\) filter \(where li\.outcome <> 'admitted'\) >= 10/.test(b)) problems.push("like-you suppression missing");
  if (!/- 'student_id'/.test(b) || !/- 'item_id'/.test(b) || !/- 'list_id'/.test(b)) problems.push("outcome rows carry ids");
  return problems;
}

/**
 * The columns the five-levels migration adds (decision 6 of the chances build, written by the planner unit as
 * supabase/migrations/20261012100000_five_levels.sql): snapshot code writes exactly these names.
 */
const FIVE_LEVEL_COLUMNS = ["hidden_odds", "selectivity_tier", "without_depth", "without_hooks", "without_interest"];

test("snapshot migration: no identifying column, every text column checked, RLS like list_items, consent synced, cleanup, suppression", () => {
  assert.deepEqual(snapshotSchemaProblems(SNAPSHOT_SQL), []);
  const cols = columns(SNAPSHOT_SQL, "application_snapshots");
  for (const c of ["item_id", "student_id", "model_version", "estimate_group", "estimate_label", "group_changed", "consented", "created_at"]) assert.ok(cols.includes(c), c);
  // Columns later migrations add to the table count too.
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const later = readdirSync(dir)
    .filter((f) => f > "20261011100000_application_snapshots.sql" && f.endsWith(".sql"))
    .map((f) => body(readFileSync(new URL(f, dir), "utf8")))
    .filter((b) => b.includes("application_snapshots"))
    .join(" ");
  const added = [...later.matchAll(/add column (?:if not exists )?([a-z_]+)/g)].map((m) => m[1]);
  for (const c of SNAPSHOT_COLUMNS) {
    assert.ok(cols.includes(c) || added.includes(c) || FIVE_LEVEL_COLUMNS.includes(c), `the table has every column buildSnapshot writes (${c})`);
  }
  // Once the five-levels migration is on the branch, it adds exactly the names snapshot code writes.
  if (readdirSync(dir).some((f) => f.endsWith("_five_levels.sql"))) for (const c of FIVE_LEVEL_COLUMNS) assert.ok(added.includes(c), `the five-levels migration adds ${c}`);
  // Guard: a column the snapshot writes that no migration names fails.
  assert.ok(!["made_up_column"].every((c) => cols.includes(c) || added.includes(c) || FIVE_LEVEL_COLUMNS.includes(c)));
});

test("guard: each broken privacy rule in the snapshot migration is caught", () => {
  const breaks: [string, string, string][] = [
    ["identifying column", "  round             text", "  high_school_id    text,\n  round             text"],
    ["unchecked text column", "  gpa_scale         text check (gpa_scale in ('4.0', '5.0', '100')),", "  gpa_scale         text,"],
    ["rls off", "alter table public.application_snapshots enable row level security;", ""],
    ["users can write rows directly", "grant select, delete on public.application_snapshots to authenticated;", "grant select, insert, delete on public.application_snapshots to authenticated;"],
    ["read policy isn't the list's", "using (public.can_read_list(list_id));", "using (true);"],
    ["consent isn't kept in step", "after update of outcome_share_consented_at, student_id on public.lists", "after update of student_id on public.lists"],
    ["cleanup doesn't delete unconsented finished seasons", "where not consented and season <= coalesce(p_season, v_last);", "where season <= coalesce(p_season, v_last);"],
    ["cleanup isn't service-role only", "grant execute on function public.delete_unconsented_snapshots(integer) to service_role;", "grant execute on function public.delete_unconsented_snapshots(integer) to authenticated, service_role;"],
    ["like-you suppression missing", "having count(*) >= 50", "having count(*) >= 5"],
    ["outcome rows carry ids", "- 'student_id'", ""],
  ];
  for (const [problem, from, to] of breaks) {
    assert.ok(SNAPSHOT_SQL.includes(from), `fixture text present: ${from}`);
    const broken = SNAPSHOT_SQL.replace(from, to);
    assert.ok(snapshotSchemaProblems(broken).some((p) => p.startsWith(problem)), `caught: ${problem}`);
  }
});

test("summary migration: public read, service-role write, aggregates only", () => {
  const b = body(SUMMARY_SQL);
  const cols = columns(SUMMARY_SQL, "chances_summary");
  for (const c of ["season", "model_version", "estimate_group", "rate_band", "n", "admitted", "interval_low", "interval_high", "sharers_mix", "created_at"]) assert.ok(cols.includes(c), c);
  for (const c of cols) assert.ok(!/student|item|list|unit_id|state|user/.test(c), `no row-level column (${c})`);
  assert.match(b, /alter table public\.chances_summary enable row level security;/);
  assert.match(b, /create policy "chances summary is public" on public\.chances_summary for select to anon, authenticated using \(true\);/);
  assert.match(b, /revoke all on public\.chances_summary from public, anon, authenticated;/);
  assert.match(b, /grant select on public\.chances_summary to anon, authenticated;/);
  assert.doesNotMatch(b, /grant [^;]*(insert|update|delete|all)[^;]* on public\.chances_summary to [^;]*(anon|authenticated)/);
  assert.doesNotMatch(b, /for (insert|update|delete|all) to/);
});
