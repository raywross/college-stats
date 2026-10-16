/**
 * The Reach your score guide's pure logic (lib/planner/test-guide.ts; specs/planner/v3/guides/test-prep.md): the
 * dates a junior and a senior see, the in-time wording per round, the standing counts, the study resources (no
 * promise of a gain), planned/registered state, and `toggleRegisteredDate`'s subset rule (lib/planner/plan-writes.ts).
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  datesFor,
  dayLabel,
  inTimeText,
  plannedState,
  registerByText,
  resourcesFor,
  scoreAt,
  standingCounts,
  type ListDeadline,
} from "../lib/planner/test-guide.ts";
import { toggleRegisteredDate } from "../lib/planner/plan-writes.ts";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { Cycle } from "../lib/planner/cycle.ts";
import { numberProblems } from "./helpers/copy-guard.mts";

const CYCLE: Cycle = {
  cycle: "2026-27",
  startYear: 2026,
  entries: [
    { key: "sat_2026_10", label: "SAT", date: "2026-10-03", register_by: "2026-09-18", applies: "plans_tests", assignee: "student", source: "https://sat.example/dates" },
    { key: "sat_2026_11", label: "SAT", date: "2026-11-07", register_by: "2026-10-23", applies: "plans_tests", assignee: "student", source: "https://sat.example/dates" },
    { key: "sat_2027_03", label: "SAT", date: "2027-03-13", register_by: "2027-02-27", applies: "plans_tests", assignee: "student", source: "https://sat.example/dates" },
    { key: "sat_2027_05", label: "SAT", date: "2027-05-01", register_by: "2027-04-18", applies: "plans_tests", assignee: "student", source: "https://sat.example/dates" },
    // No register_by: a projected date not yet open for registration.
    { key: "sat_2027_12", label: "SAT (projected date)", date: "2027-12-04", applies: "plans_tests", assignee: "student", source: "https://sat.example/dates" },
    { key: "act_2026_10", label: "ACT", date: "2026-10-17", register_by: "2026-09-11", applies: "plans_tests", assignee: "student", source: "https://act.example/dates" },
  ],
};

/* ------------------------------------------------------------------ */
/* datesFor                                                             */
/* ------------------------------------------------------------------ */

test("datesFor: a junior sees the next four dates whether or not a deadline needs them", () => {
  const rows = datesFor("sat", CYCLE, "junior_fall", "2026-09-01", []);
  assert.deepEqual(rows.map((r) => r.key), ["sat_2026_10", "sat_2026_11", "sat_2027_03", "sat_2027_05"]);
  assert.equal(rows[0].projected, false);
});

test("datesFor: the projected date (no register_by) is marked, and registerBy is null for it", () => {
  const rows = datesFor("sat", CYCLE, "junior_fall", "2027-04-01", []);
  const projected = rows.find((r) => r.key === "sat_2027_12");
  assert.ok(projected, "the projected date is within the next four from this date");
  assert.equal(projected!.projected, true);
  assert.equal(projected!.registerBy, null);
});

test("datesFor: a senior only sees dates whose scores would reach a deadline still on the list", () => {
  const deadlines: ListDeadline[] = [{ name: "Wake Forest", round: "ED I", iso: "2026-11-15" }];
  const rows = datesFor("sat", CYCLE, "senior_fall", "2026-09-01", deadlines);
  // sat_2026_10 (+14 = 2026-10-17) and sat_2026_11 (+14 = 2026-11-21, after the deadline) differ.
  assert.deepEqual(rows.map((r) => r.key), ["sat_2026_10"]);
});

test("datesFor: a senior with no deadlines on the list sees no dates", () => {
  assert.deepEqual(datesFor("sat", CYCLE, "senior_fall", "2026-09-01", []), []);
});

test("datesFor: only the student's own test's keys come back", () => {
  const rows = datesFor("act", CYCLE, "junior_fall", "2026-09-01", []);
  assert.deepEqual(rows.map((r) => r.key), ["act_2026_10"]);
});

/* ------------------------------------------------------------------ */
/* inTimeText                                                           */
/* ------------------------------------------------------------------ */

test("inTimeText: every college in time", () => {
  const rows: ListDeadline[] = [{ name: "Duke", round: "RD", iso: "2027-01-01" }];
  assert.equal(inTimeText("2026-11-07", rows), "in time for every college on your list");
});

test("inTimeText: too late for every college", () => {
  const rows: ListDeadline[] = [{ name: "Duke", round: "ED I", iso: "2026-11-01" }];
  assert.equal(inTimeText("2026-11-07", rows), "scores arrive after these deadlines");
});

test("inTimeText: a mix names which colleges are late and which are in time", () => {
  const rows: ListDeadline[] = [
    { name: "Wake Forest", round: "ED I", iso: "2026-11-15" },
    { name: "Wake Forest", round: "ED II", iso: "2027-01-01" },
  ];
  // sat on 2026-11-07 + 14 days = 2026-11-21: too late for ED I (Nov 15), in time for ED II (Jan 1).
  assert.equal(inTimeText("2026-11-07", rows), "too late for Wake Forest ED I; in time for Wake Forest ED II");
});

test("inTimeText: no colleges to check is empty, not a sentence", () => {
  assert.equal(inTimeText("2026-11-07", []), "");
});

/* ------------------------------------------------------------------ */
/* registerByText, dayLabel                                            */
/* ------------------------------------------------------------------ */

test("registerByText: open, closed, and not-yet-open", () => {
  assert.equal(registerByText("2026-10-23", "2026-10-01"), "Register by Oct 23");
  assert.equal(registerByText("2026-10-23", "2026-11-01"), "Registration closed; late registration may be open");
  assert.equal(registerByText(null, "2026-10-01"), "Registration not open yet");
});

test("dayLabel", () => {
  assert.equal(dayLabel("2026-11-07"), "Nov 7");
});

/* ------------------------------------------------------------------ */
/* scoreAt and standingCounts                                          */
/* ------------------------------------------------------------------ */

const SCHOOL = { sat: [1400, 1550] as [number, number], act: null };
const BLIND_SCHOOL = { sat: null, act: null };

test("scoreAt: in, above, and below the range, and null without a score or a range", () => {
  assert.equal(scoreAt(1480, "sat", SCHOOL)!.position, "in");
  assert.equal(scoreAt(1600, "sat", SCHOOL)!.position, "above");
  assert.equal(scoreAt(1300, "sat", SCHOOL)!.position, "below");
  assert.equal(scoreAt(null, "sat", SCHOOL), null);
  assert.equal(scoreAt(1400, "sat", BLIND_SCHOOL), null);
});

test("scoreAt: an ACT score reads a SAT-only range through the concordance", () => {
  const read = scoreAt(33, "act", SCHOOL);
  assert.ok(read);
  assert.equal(read!.kind, "sat");
  assert.equal(read!.concorded, true);
});

test("standingCounts: the count at the student's score, and a second sentence only when the target changes it", () => {
  const rows = [
    { score: scoreAt(1480, "sat", SCHOOL), target: scoreAt(1480, "sat", SCHOOL), blind: false },
    { score: scoreAt(1300, "sat", SCHOOL), target: scoreAt(1480, "sat", SCHOOL), blind: false },
  ];
  assert.equal(standingCounts(rows, null), "In or above the middle 50% at 1 of 2 colleges.");
  assert.equal(standingCounts(rows, 1480), "In or above the middle 50% at 1 of 2 colleges. A 1480 would be in or above it at 2.");
});

test("standingCounts: test-blind and no-range colleges are left out of both counts", () => {
  const rows = [
    { score: scoreAt(1480, "sat", SCHOOL), target: null, blind: false },
    { score: null, target: null, blind: true },
    { score: scoreAt(1480, "sat", BLIND_SCHOOL), target: null, blind: false },
  ];
  assert.equal(standingCounts(rows, null), "In or above the middle 50% at 1 of 1 colleges.");
});

test("standingCounts: nothing to count is empty", () => {
  assert.equal(standingCounts([], null), "");
  assert.equal(standingCounts([{ score: null, target: null, blind: true }], null), "");
});

/* ------------------------------------------------------------------ */
/* resourcesFor: no promise of a gain                                   */
/* ------------------------------------------------------------------ */

test("resourcesFor: the focus test's own resources only, and no gain is promised", () => {
  const sat = resourcesFor("sat");
  assert.ok(sat.resources.some((r) => /Bluebook/.test(r.label)));
  assert.ok(sat.resources.every((r) => /^https:\/\//.test(r.href)));
  assert.ok(!/\bACT\b/.test(sat.resources.map((r) => r.label).join(" ")));
  const act = resourcesFor("act");
  assert.ok(act.resources.every((r) => /^https:\/\//.test(r.href)));
  // "Most students gain 40-60 points" is exactly the promise the spec forbids; the cadence line never estimates one.
  assert.ok(!/\bgain\b/i.test(sat.cadence));
  assert.deepEqual(numberProblems(sat.cadence), []);
});

/* ------------------------------------------------------------------ */
/* plannedState                                                         */
/* ------------------------------------------------------------------ */

function profileWith(tests: Partial<StudentProfileData["tests"]>): StudentProfileData {
  const p = emptyProfile();
  return { ...p, tests: { ...p.tests, ...tests } };
}

test("plannedState: registered, planned only, and neither", () => {
  const p = profileWith({ plannedDates: ["sat_2026_11"], registeredDates: ["sat_2026_11"] });
  assert.equal(plannedState(p, "sat_2026_11"), "registered");
  const planned = profileWith({ plannedDates: ["sat_2026_11"], registeredDates: [] });
  assert.equal(plannedState(planned, "sat_2026_11"), "planned");
  assert.equal(plannedState(planned, "sat_2027_03"), null);
  assert.equal(plannedState(null, "sat_2026_11"), null);
});

/* ------------------------------------------------------------------ */
/* toggleRegisteredDate: the subset rule                                */
/* ------------------------------------------------------------------ */

test("toggleRegisteredDate: turning registration on plans the date too, if it wasn't already", () => {
  const p = profileWith({ plannedDates: [], registeredDates: [] });
  const out = toggleRegisteredDate(p, "sat_2026_11", true);
  assert.ok(out.ok);
  assert.deepEqual(out.profile.tests.plannedDates, ["sat_2026_11"]);
  assert.deepEqual(out.profile.tests.registeredDates, ["sat_2026_11"]);
});

test("toggleRegisteredDate: turning registration off clears only the registered flag, keeping the planned date", () => {
  const p = profileWith({ plannedDates: ["sat_2026_11"], registeredDates: ["sat_2026_11"] });
  const out = toggleRegisteredDate(p, "sat_2026_11", false);
  assert.ok(out.ok);
  assert.deepEqual(out.profile.tests.plannedDates, ["sat_2026_11"]);
  assert.deepEqual(out.profile.tests.registeredDates, []);
});

test("toggleRegisteredDate: refuses a key that isn't a real test date", () => {
  const p = profileWith({});
  const out = toggleRegisteredDate(p, "sat_9999_99", true);
  assert.equal(out.ok, false);
});

test("toggleRegisteredDate: registeredDates is always a subset of plannedDates", () => {
  const p = profileWith({ plannedDates: ["sat_2026_11", "sat_2027_03"], registeredDates: [] });
  const on1 = toggleRegisteredDate(p, "sat_2026_11", true);
  assert.ok(on1.ok);
  const on2 = toggleRegisteredDate(on1.profile, "sat_2027_03", true);
  assert.ok(on2.ok);
  for (const k of on2.profile.tests.registeredDates) assert.ok(on2.profile.tests.plannedDates.includes(k));
});
