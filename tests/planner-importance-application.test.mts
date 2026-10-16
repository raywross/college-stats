/**
 * Application pieces wait for senior fall (owner, 2026-10-16: a junior saw "Ask the high school to send transcripts"
 * and "Pay the application fee"; "she wouldn't apply until the fall of her senior year"). An undated application
 * task is importance 0 before senior fall, so Now never shows it; a dated one follows the season gate as before.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { baseImportance, beforeApplications, type ImportanceFacts } from "../lib/planner/importance.ts";
import { loadCycle } from "../lib/planner/cycle.ts";

const facts = (season: ImportanceFacts["season"]): ImportanceFacts => ({ season, today: "2026-10-16", gradYear: 2028, profile: null, cycle: loadCycle("2027-28"), listDeadlines: [] });
const task = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, key: `list-1:${kind}:item-1`, season: null, due_on: null, window_start: null, window_end: null, source: "college", ...extra }) as never;

test("undated application pieces are 0 before senior fall and keep their row from senior fall on", () => {
  for (const kind of ["fee", "transcript", "recommendation", "supplement", "portal_setup", "decision_expected"]) {
    assert.equal(baseImportance(task(kind), facts("junior_fall")), 0, `${kind} in junior fall`);
    assert.equal(baseImportance(task(kind), facts("summer_before_senior")), 0, `${kind} in the summer`);
    assert.ok(baseImportance(task(kind), facts("senior_fall")) >= 75, `${kind} in senior fall`);
  }
});

test("a dated application piece is left to the season gate (the rule is about undated ones)", () => {
  assert.equal(beforeApplications(task("apply", { due_on: "2027-11-01" }), "junior_fall"), false);
  assert.equal(beforeApplications(task("fee"), "junior_fall"), true);
  assert.equal(beforeApplications(task("fee"), "senior_fall"), false);
  // Any undated college-generated row counts, whatever its kind.
  assert.equal(beforeApplications(task("own", { source: "college" }), "junior_spring"), true);
  assert.equal(beforeApplications(task("playbook", { source: "season" }), "junior_spring"), false);
});
