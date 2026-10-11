/**
 * The Scores tab's pure logic (lib/planner/scores.ts; specs/planner/redesign/scores.md "Score timing", "Test
 * dates"): which upcoming dates a senior vs. a junior sees, the "in time" sentence's three cases, and the
 * registration text. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { datesFor, inTimeText, registerByText, targetMoves, type InTimeRow } from "../lib/planner/scores.ts";
import type { Cycle, CycleEntry } from "../lib/planner/cycle.ts";
import type { MoveUp } from "../lib/chances/baseline.ts";
import type { PlanItem, PlanSchool } from "../lib/planner/types.ts";
import type { PlanRowView } from "../lib/planner/plan-view.ts";

const entry = (key: string, date: string, registerBy: string): CycleEntry => ({
  key,
  label: key.startsWith("sat") ? "SAT" : "ACT",
  date,
  register_by: registerBy,
  applies: "plans_tests",
  assignee: "student",
  source: key.startsWith("sat") ? "https://satsuite.collegeboard.org/sat/dates-deadlines" : "https://www.act.org/content/act/en/products-and-services/the-act/registration/test-dates.html",
});

const CYCLE: Cycle = {
  cycle: "2026-27",
  startYear: 2026,
  entries: [
    entry("sat_2026_10", "2026-10-03", "2026-09-18"),
    entry("sat_2026_11", "2026-11-07", "2026-10-23"),
    entry("sat_2026_12", "2026-12-05", "2026-11-20"),
    entry("act_2026_12", "2026-12-12", "2026-11-06"),
    entry("sat_2027_03", "2027-03-06", "2027-02-19"),
    entry("sat_2027_05", "2027-05-01", "2027-04-16"),
  ],
};

const TODAY = "2026-09-01";

/* ------------------------------------------------------------------ */
/* datesFor: junior sees the next four, whether or not a deadline needs them */
/* ------------------------------------------------------------------ */

test("datesFor: a junior sees the next four SAT dates, not the ACT ones", () => {
  const dates = datesFor("sat", CYCLE, "junior_fall", TODAY, []);
  assert.deepEqual(dates.map((d) => d.key), ["sat_2026_10", "sat_2026_11", "sat_2026_12", "sat_2027_03"]);
});

test("datesFor: a sophomore or earlier also sees the next four (not yet a senior)", () => {
  const dates = datesFor("sat", CYCLE, "earlier", TODAY, []);
  assert.equal(dates.length, 4);
});

/* ------------------------------------------------------------------ */
/* datesFor: a senior sees at most three dates whose scores could still reach an open deadline */
/* ------------------------------------------------------------------ */

test("datesFor: a senior sees only dates whose scores reach a deadline still on the list", () => {
  // Only a Nov 1 deadline is open: a Nov 7 test (scores Nov 21) misses it; the Oct 3 test (scores Oct 17) makes it.
  const dates = datesFor("sat", CYCLE, "senior_fall", TODAY, [{ deadline: { iso: "2026-11-01", field: "x", edition: null, lastCycle: false } }]);
  assert.deepEqual(dates.map((d) => d.key), ["sat_2026_10"]);
});

test("datesFor: a senior's dates are capped at three even when every date would reach the deadline", () => {
  const dates = datesFor("sat", CYCLE, "senior_fall", TODAY, [{ deadline: { iso: "2027-06-01", field: "x", edition: null, lastCycle: false } }]);
  assert.equal(dates.length, 3);
  assert.deepEqual(dates.map((d) => d.key), ["sat_2026_10", "sat_2026_11", "sat_2026_12"]);
});

test("datesFor: a senior with no open deadline on the list sees no dates", () => {
  const dates = datesFor("sat", CYCLE, "senior_winter", TODAY, []);
  assert.deepEqual(dates, []);
});

/* ------------------------------------------------------------------ */
/* inTimeText: the three sentences (scores.md "Score timing") */
/* ------------------------------------------------------------------ */

test("inTimeText: in time for the round chosen", () => {
  const rows: InTimeRow[] = [{ name: "Wake Forest", round: "ed", deadline: "2026-11-21", alternates: [] }];
  assert.equal(inTimeText("2026-11-07", rows), "Scores in time for Wake Forest ED I.");
});

test("inTimeText: too late for the round chosen, but in time for a later round the college offers", () => {
  const rows: InTimeRow[] = [{ name: "Wake Forest", round: "ed", deadline: "2026-11-01", alternates: [{ round: "ed2", iso: "2027-01-01" }] }];
  assert.equal(inTimeText("2026-12-05", rows), "Too late for the round you picked; in time for Wake Forest ED II (Jan 1).");
});

test("inTimeText: scores arrive after every deadline the college offers", () => {
  const rows: InTimeRow[] = [{ name: "A College", round: "ed", deadline: "2026-11-01", alternates: [] }];
  assert.equal(inTimeText("2026-12-05", rows), "Scores arrive after these deadlines.");
});

test("inTimeText: nothing to say when there are no colleges to check", () => {
  assert.equal(inTimeText("2026-12-05", []), "");
});

/* ------------------------------------------------------------------ */
/* registerByText (scores.md "Test dates") */
/* ------------------------------------------------------------------ */

test("registerByText: open registration gives the deadline", () => {
  assert.equal(registerByText("2026-10-23", "2026-09-01"), "Register by Oct 23");
});

test("registerByText: closed registration says so without implying the date still applies", () => {
  assert.equal(registerByText("2026-09-18", "2026-10-01"), "Registration closed; late registration may be open");
});

test("registerByText: no registration date on file yet", () => {
  assert.equal(registerByText(null, "2026-09-01"), "Registration not open yet");
});

/* ------------------------------------------------------------------ */
/* targetMoves (scores.md "Target score"; decision 5, owner 2026-10-11) */
/* ------------------------------------------------------------------ */

/** Just the fields `targetMoves` reads (`Pick<PlanRowView, "item" | "school" | "moveUp">`). */
function targetRow(id: string, name: string, moveUp: MoveUp | null): Pick<PlanRowView, "item" | "school" | "moveUp"> {
  return {
    item: { id } as PlanItem,
    school: name ? ({ name } as PlanSchool) : null,
    moveUp,
  };
}

test("targetMoves: null target moves nothing", () => {
  assert.deepEqual(targetMoves(null, [targetRow("1", "A", { score: 1420, delta: 30, from: "reach", to: "target" })]), []);
});

test("targetMoves: only rows whose move-up needs no more than the target", () => {
  const rows = [
    targetRow("1", "Needs 1420", { score: 1420, delta: 30, from: "reach", to: "target" }),
    targetRow("2", "Needs 1500", { score: 1500, delta: 110, from: "reach", to: "target" }),
    targetRow("3", "No move-up", null),
  ];
  const moves = targetMoves(1420, rows);
  assert.deepEqual(
    moves.map((m) => m.id),
    ["1"],
  );
  assert.equal(moves[0].name, "Needs 1420");
  assert.equal(moves[0].from, "reach");
  assert.equal(moves[0].to, "target");
  assert.equal(moves[0].needed, 1420);
});

test("targetMoves: a target at or above every move-up's score moves all of them", () => {
  const rows = [
    targetRow("1", "A", { score: 1420, delta: 30, from: "reach", to: "target" }),
    targetRow("2", "B", { score: 1420, delta: 30, from: "target", to: "likely" }),
  ];
  assert.equal(targetMoves(1600, rows).length, 2);
});

test("targetMoves: falls back to 'A college' when the school isn't in the dataset", () => {
  const moves = targetMoves(1420, [targetRow("1", "", { score: 1400, delta: 10, from: "reach", to: "target" })]);
  assert.equal(moves[0].name, "A college");
});
