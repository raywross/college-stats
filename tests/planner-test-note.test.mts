/**
 * A picked test folds into "Work toward your {target}" (owner, 2026-10-16): the register and test-day moves leave Now
 * while that card is up, and the card's italic line names the soonest test (nextTestNote).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTestDateMove, nextTestNote, nowMoves } from "../lib/planner/moves.ts";
import { loadCycle } from "../lib/planner/cycle.ts";
import type { PlanTask } from "../lib/planner/types.ts";

const base: PlanTask = {
  id: "t", list_id: "l1", item_id: null, key: null, kind: "playbook", title: "", detail: null, due_on: null, window_start: null, window_end: null,
  assignee: "student", source: "season", source_field: null, source_edition: null, date_note: null, done_at: null, done_by: null, snoozed_until: null,
  dismissed: false, orphaned: false, position: 0, created_by: null, created_at: "2026-10-01T00:00:00Z", season: "junior_fall", action: null,
  dismissed_at: null, dismissed_by: null,
} as PlanTask;
const t = (over: Partial<PlanTask>): PlanTask => ({ ...base, ...over });

const reach = t({ id: "reach", key: "l1:playbook:reach_score_junior_fall", title: "Work toward your 1450" });
const regDec = t({ id: "regDec", kind: "test_register", source: "cycle", season: null, key: "l1:test_register:sat_2026_12", title: "Register for the SAT on Dec 5", due_on: "2026-11-20" });
const dayDec = t({ id: "dayDec", kind: "test_day", source: "cycle", season: null, key: "l1:test_day:sat_2026_12", title: "SAT test day", due_on: "2026-12-05" });
const regMar = t({ id: "regMar", kind: "test_register", source: "cycle", season: null, key: "l1:test_register:sat_2027_03", title: "Register for the SAT on Mar 13", due_on: "2027-02-26" });
const dayMar = t({ id: "dayMar", kind: "test_day", source: "cycle", season: null, key: "l1:test_day:sat_2027_03", title: "SAT test day", due_on: "2027-03-13" });

test("nextTestNote: the soonest test, with its register-by date until registered", () => {
  assert.equal(nextTestNote([dayMar, regMar, dayDec, regDec], "2026-10-16"), "Your next test: the SAT on Dec 5. Register by Nov 20.");
  assert.equal(nextTestNote([dayDec, regDec], "2026-10-16", ["sat_2026_12"]), "Your next test: the SAT on Dec 5 (registered).");
  assert.equal(nextTestNote([dayDec, { ...regDec, done_at: "2026-10-10T00:00:00Z" }], "2026-10-16"), "Your next test: the SAT on Dec 5 (registered).");
  assert.equal(nextTestNote([reach], "2026-10-16"), null, "no test picked: no line");
  assert.equal(nextTestNote([dayDec], "2026-12-06"), null, "a past test isn't next");
});

test("with the target card up, the test date moves leave Now; without it they stay", () => {
  const facts = { season: "junior_fall" as const, today: "2026-11-15", gradYear: 2028, profile: null, cycle: loadCycle("2027-28"), listDeadlines: [] };
  const opts = { season: "junior_fall" as const, gradYear: 2028, today: "2026-11-15", viewer: "student" as const, facts };
  const withReach = nowMoves([reach, regDec, dayDec], opts);
  assert.ok(![...withReach.now, ...withReach.more].some(isTestDateMove), "folded into the target card");
  const without = nowMoves([regDec, dayDec], opts);
  assert.ok([...without.now, ...without.more].some(isTestDateMove), "shown on their own without the target card");
});
