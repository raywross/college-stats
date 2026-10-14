/**
 * The Next steps view (lib/planner/moves.ts; seasons.md "The Next steps tab"): the Now order (overdue dated, dated
 * within 14 days, ED decide in window, playbook order), the cap of six, the More / Coming up / Done partition, a
 * guardian's Your part, and taskSeason for a dated task without a season. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nowMoves, taskSeason, topMove, yourPartMoves } from "../lib/planner/moves.ts";
import type { PlanTask } from "../lib/planner/types.ts";

const G = 2028;
const TODAY = "2027-04-15"; // junior spring for the class of 2028

let n = 0;
const task = (over: Partial<PlanTask>): PlanTask => ({
  id: `t${++n}`,
  list_id: "list-1",
  item_id: null,
  key: `list-1:playbook:k${n}`,
  kind: "playbook",
  title: `Move ${n}`,
  detail: null,
  due_on: null,
  window_start: null,
  window_end: null,
  assignee: "student",
  source: "season",
  source_field: null,
  source_edition: null,
  date_note: null,
  done_at: null,
  done_by: null,
  snoozed_until: null,
  dismissed: false,
  orphaned: false,
  position: 0,
  created_by: null,
  created_at: "2027-01-01T00:00:00Z",
  season: "junior_spring",
  action: null,
  ...over,
});

const opts = { season: "junior_spring" as const, gradYear: G, today: TODAY, viewer: "student" as const };

test("Now's order: overdue dated, dated within 14 days, ED decide in its window, then the playbook's order", () => {
  const playbookLate = task({ title: "Playbook second", position: 20 });
  const playbookEarly = task({ title: "Playbook first", position: 10 });
  const ed = task({ title: "Decide on ED", kind: "ed_decide", source: "stage", season: null, window_start: "2027-04-01", window_end: "2027-10-15" });
  const soon = task({ title: "Due soon", kind: "cycle", source: "cycle", season: null, due_on: "2027-04-25" });
  const overdue = task({ title: "Overdue", kind: "cycle", source: "cycle", season: null, due_on: "2027-04-10" });
  const g = nowMoves([playbookLate, ed, playbookEarly, soon, overdue], opts);
  assert.deepEqual(g.now.map((t) => t.title), ["Overdue", "Due soon", "Decide on ED", "Playbook first", "Playbook second"]);
  assert.equal(topMove(g)?.title, "Overdue");
  // An ED decide move whose window hasn't opened sits with the rest.
  const later = task({ title: "ED not yet", kind: "ed_decide", source: "stage", season: "junior_spring", window_start: "2027-06-01", window_end: "2027-10-15" });
  assert.equal(nowMoves([later, playbookEarly], opts).now[0].title, "Playbook first");
});

test("the cap of six; the rest of the season folds into More; skipped, snoozed and orphaned moves show nowhere", () => {
  const many = Array.from({ length: 8 }, (_, i) => task({ title: `P${i}`, position: i }));
  const skipped = task({ title: "Skipped", dismissed: true });
  const snoozed = task({ title: "Snoozed", snoozed_until: "2027-05-01" });
  const orphan = task({ title: "Orphan", orphaned: true });
  const g = nowMoves([...many, skipped, snoozed, orphan], opts);
  assert.equal(g.now.length, 6);
  assert.deepEqual(g.more.map((t) => t.title), ["P6", "P7"]);
  const everywhere = [...g.now, ...g.more, ...g.done].map((t) => t.title);
  for (const t of ["Skipped", "Snoozed", "Orphan"]) assert.ok(!everywhere.includes(t), t);
  assert.equal(nowMoves(many, { ...opts, max: 3 }).now.length, 3);
});

test("Coming up is next season's open moves (titles and dates); Done is this season's done moves", () => {
  const next = task({ title: "Draft the essay", season: null, kind: "cycle", source: "cycle", window_start: "2027-06-15", window_end: "2027-08-31" });
  const nextPlaybook = task({ title: "Review the list's cost", season: "summer_before_senior" });
  const later = task({ title: "Senior fall thing", season: "senior_fall" });
  const done = task({ title: "Done one", done_at: "2027-04-01T00:00:00Z" });
  const doneLastSeason = task({ title: "Done before", season: "junior_winter", done_at: "2027-02-01T00:00:00Z" });
  const g = nowMoves([next, nextPlaybook, later, done, doneLastSeason], opts);
  assert.deepEqual(g.comingUp, [
    { title: "Draft the essay", date: "2027-08-31" },
    { title: "Review the list's cost", date: null },
  ]);
  assert.deepEqual(g.done.map((t) => t.title), ["Done one"]);
  assert.deepEqual([...g.now, ...g.more].map((t) => t.title), []);
  assert.equal(g.season, "junior_spring");
  assert.equal(topMove(g), null, "nothing to do this season");
});

test("a guardian: their own moves are Your part (first, open, by date), not repeated in Now", () => {
  const mine = task({ title: "Check the cost", assignee: "guardian", due_on: "2027-05-10" });
  const either = task({ title: "Visit together", assignee: "either" });
  const theirs = task({ title: "Ask two teachers" });
  const doneMine = task({ title: "Done", assignee: "guardian", done_at: "2027-04-01T00:00:00Z" });
  const tasks = [theirs, either, mine, doneMine];
  assert.deepEqual(yourPartMoves(tasks, TODAY).map((t) => t.title), ["Check the cost", "Visit together"]);
  assert.deepEqual(nowMoves(tasks, { ...opts, viewer: "guardian" }).now.map((t) => t.title), ["Ask two teachers"]);
  assert.deepEqual(nowMoves(tasks, opts).now.map((t) => t.title), ["Check the cost", "Ask two teachers", "Visit together"], "the student sees them all");
});

test("taskSeason: its own season, else its date's (a window by its start), else the current season", () => {
  assert.equal(taskSeason(task({ season: "senior_fall" }), G, "junior_spring"), "senior_fall");
  assert.equal(taskSeason(task({ season: null, due_on: "2027-11-01" }), G, "junior_spring"), "senior_fall");
  assert.equal(taskSeason(task({ season: null, window_start: "2027-02-01", window_end: "2027-04-30" }), G, "junior_spring"), "junior_winter");
  assert.equal(taskSeason(task({ season: null }), G, "junior_spring"), "junior_spring", "undated: the current season");
  assert.equal(taskSeason(task({ season: null, due_on: "2027-11-01" }), null, "unknown"), "unknown", "no class year");
});
