/**
 * The Next steps view (lib/planner/moves.ts; seasons.md "The Next steps tab"; plan v3 now.md "Ranking"; R1b
 * specs/planner/record/ranking.md): Now's order is importance desc (`compareByImportance`, tested in depth in
 * tests/planner-importance.test.mts), ties dated before undated then position then title; the cap of three; the
 * season gate (eligibleNow); the More / Coming up / Done / Skipped partition; a guardian's Your part; and taskSeason
 * for a dated task without a season. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleFor, loadCycle } from "../lib/planner/cycle.ts";
import type { ImportanceFacts } from "../lib/planner/importance.ts";
import { comingUpRows, eligibleNow, isFinancialMove, NOW_MAX, nowMoves, parentSafeTitle, seasonRows, SOON_DAYS, taskSeason, topMove, yourPartMoves } from "../lib/planner/moves.ts";
import type { Season } from "../lib/planner/seasons.ts";
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
  dismissed_at: null,
  dismissed_by: null,
  orphaned: false,
  position: 0,
  created_by: null,
  created_at: "2027-01-01T00:00:00Z",
  season: "junior_spring",
  action: null,
  ...over,
});

/** A neutral facts fixture: no profile (so `profile:*` entries fall back to their "high_school" default), a real
 *  cycle for the class of `G` (unused by these generic test tasks), and no list deadlines. */
const factsFor = (season: Season, today: string, gradYear: number | null = G): ImportanceFacts => ({ season, today, gradYear, profile: null, cycle: loadCycle(cycleFor(gradYear ?? G)), listDeadlines: [] });

const opts = { season: "junior_spring" as const, gradYear: G, today: TODAY, viewer: "student" as const, facts: factsFor("junior_spring", TODAY) };

test("Now's order: importance desc (base importance, then timing), ties dated before undated then position then title", () => {
  // Senior fall (Sep 1, 2027 for the class of 2028): an application piece is only a move from then on (eligibleNow).
  const seniorFall = { ...opts, season: "senior_fall" as const, today: "2027-09-01", facts: factsFor("senior_fall", "2027-09-01") };
  // kind:apply is base 100 (ranking.md's table); +20 timing (due in 5 days) clamps at 100.
  const applyEd = task({ title: "Apply ED", kind: "apply", source: "college", season: null, key: "item-1:apply:ed", due_on: "2027-09-06" });
  // kind:ed_decide is base 95, no timing boost this far out, -10 carried from junior spring: 85.
  const edDecide = task({ title: "Decide on ED", kind: "ed_decide", source: "stage", season: "junior_spring", window_start: "2027-04-01", window_end: "2027-10-15" });
  // No table entry for this kind/key: DEFAULT_IMPORTANCE (50), -10 carried, tied on position.
  const playbookLate = task({ title: "Playbook second", position: 20 });
  const playbookEarly = task({ title: "Playbook first", position: 10 });
  const g = nowMoves([playbookLate, edDecide, playbookEarly, applyEd], { ...seniorFall, max: 6 });
  assert.deepEqual(g.now.map((t) => t.title), ["Apply ED", "Decide on ED", "Playbook first", "Playbook second"]);
  assert.equal(topMove(g)?.title, "Apply ED");
});

test("the cap of three; the rest of the season folds into More; skipped is its own group; snoozed and orphaned moves show nowhere", () => {
  assert.equal(NOW_MAX, 3);
  assert.equal(SOON_DAYS, 14);
  const many = Array.from({ length: 5 }, (_, i) => task({ title: `P${i}`, position: i }));
  const skipped = task({ title: "Skipped", dismissed: true });
  const snoozed = task({ title: "Snoozed", snoozed_until: "2027-05-01" });
  const orphan = task({ title: "Orphan", orphaned: true });
  const g = nowMoves([...many, skipped, snoozed, orphan], opts);
  assert.deepEqual(g.now.map((t) => t.title), ["P0", "P1", "P2"]);
  assert.deepEqual(g.more.map((t) => t.title), ["P3", "P4"]);
  assert.deepEqual(g.skipped.map((t) => t.title), ["Skipped"]);
  const everywhere = [...g.now, ...g.more, ...g.done].map((t) => t.title);
  for (const t of ["Skipped", "Snoozed", "Orphan"]) assert.ok(!everywhere.includes(t), t);
  assert.ok(![...g.skipped].some((t) => t.title === "Snoozed" || t.title === "Orphan"));
  assert.equal(nowMoves(many, { ...opts, max: 6 }).now.length, 5);
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

test("the old stage-3 to-dos (follow, request_info, write_visit_notes) are not moves: left out of Now, More, and Your part", () => {
  const follow = task({ id: "f", kind: "follow", source: "stage", title: "Follow Emory", season: "senior_fall" });
  const info = task({ id: "i", kind: "request_info", source: "stage", title: "Request information from Emory", season: "senior_fall", assignee: "either" });
  const notes = task({ id: "n", kind: "write_visit_notes", source: "stage", title: "Write up the visit", season: "senior_fall" });
  const real = task({ id: "r", kind: "playbook", source: "season", title: "A real move", season: "senior_fall" });
  const groups = nowMoves([follow, info, notes, real], { season: "senior_fall", gradYear: 2027, today: "2026-10-14", viewer: "student", facts: factsFor("senior_fall", "2026-10-14", 2027) });
  assert.deepEqual([...groups.now, ...groups.more].map((t) => t.id), ["r"]);
  const theirs = task({ id: "p", kind: "playbook", source: "season", title: "Theirs", season: "senior_fall", assignee: "guardian" });
  assert.deepEqual(yourPartMoves([info, theirs], "2026-10-14").map((t) => t.id), ["p"]);
});

test("financial aid is set aside (owner 2026-10-15): aid forms, cost checks, the FAFSA/CSS/aid-offer entries, the money playbook entries, and the affordability gap are not moves", () => {
  const L = "11111111-1111-1111-1111-111111111111";
  const aid = task({ id: "a", kind: "aid_forms", source: "college", title: "Aid forms: FAFSA", season: "senior_fall", assignee: "guardian", key: `item:aid_forms:-` });
  const cost = task({ id: "c", kind: "cost_check", source: "stage", title: "Check the cost", season: "senior_fall", assignee: "guardian", key: `${L}:cost_check:x:candidate` });
  const fafsa = task({ id: "f", kind: "cycle", source: "cycle", title: "FAFSA opens", season: "senior_fall", assignee: "guardian", key: `${L}:cycle:fafsa_opens` });
  const money = task({ id: "m", kind: "playbook", source: "season", title: "Talk about what you can pay", season: "senior_fall", assignee: "guardian", key: `${L}:playbook:money_talk` });
  const afford = task({ id: "g", kind: "shape_gap", source: "season", title: "Add a Likely within your limit", season: "senior_fall", key: `${L}:shape_gap:affordable` });
  const shapeCost = task({ id: "s", kind: "shape_cost", source: "season", title: "Check the cost of a Likely", season: "senior_fall", assignee: "guardian", key: `${L}:shape_gap:affordable` });
  const real = task({ id: "r", kind: "playbook", source: "season", title: "Ask two teachers", season: "senior_fall", key: `${L}:playbook:ask_teachers` });
  const likely = task({ id: "l", kind: "shape_gap", source: "season", title: "Add a Likely", season: "senior_fall", key: `${L}:shape_gap:likely_min` });
  const all = [aid, cost, fafsa, money, afford, shapeCost, real, likely];
  for (const t of [aid, cost, fafsa, money, afford, shapeCost]) assert.equal(isFinancialMove(t), true, t.id);
  for (const t of [real, likely]) assert.equal(isFinancialMove(t), false, t.id);
  const groups = nowMoves(all, { season: "senior_fall", gradYear: 2027, today: "2026-10-14", viewer: "student", facts: factsFor("senior_fall", "2026-10-14", 2027) });
  assert.deepEqual([...groups.now, ...groups.more].map((t) => t.id).sort(), ["l", "r"]);
  assert.deepEqual(yourPartMoves(all, "2026-10-14").map((t) => t.id), []);
});

/* ------------------------------------------------------------------ */
/* Plan v3: the season gate, skipped, three at a time                  */
/* ------------------------------------------------------------------ */

test("the season gate: a junior's cycle apply and decision_expected tasks (senior fall by date) are invisible", () => {
  // A junior in junior spring whose list already has a college with deadlines next fall.
  const apply = task({ title: "Duke: apply", kind: "apply", source: "college", season: null, key: "item-1:apply:rd", due_on: "2028-01-02" });
  const earlyApply = task({ title: "Duke: apply ED", kind: "apply", source: "college", season: null, key: "item-1:apply:ed", due_on: "2027-11-01" });
  const decision = task({ title: "Duke: decision expected", kind: "decision_expected", source: "college", season: null, key: "item-1:decision_expected", due_on: "2027-12-15" });
  const real = task({ title: "Pick your recommenders" });
  const g = nowMoves([apply, earlyApply, decision, real], opts);
  assert.deepEqual(g.now.map((t) => t.title), ["Pick your recommenders"]);
  assert.deepEqual(g.more, []);
  assert.deepEqual(g.skipped, []);
  assert.deepEqual(g.done, []);
  for (const t of [apply, earlyApply, decision]) assert.equal(eligibleNow(t, opts), false, t.title);
  // Planted: the old rule (this season, or overdue) agrees here, but a gate that let any open move through would not.
  const leaky = [apply, earlyApply, decision, real].filter((t) => t.done_at === null);
  assert.notDeepEqual(leaky.map((t) => t.title), g.now.map((t) => t.title));
});

test("the season gate: a carried freshman entry shows in junior fall; a later season's playbook entry does not", () => {
  const juniorFall = { season: "junior_fall" as const, gradYear: G, today: "2026-11-15", viewer: "student" as const, facts: factsFor("junior_fall", "2026-11-15") };
  const carried = task({ title: "Fill in your numbers and courses", season: "freshman", key: "list-1:playbook:profile" });
  const nextSeason = task({ title: "Register for a spring SAT or ACT", season: "junior_winter", key: "list-1:playbook:register_spring_test" });
  const g = nowMoves([carried, nextSeason], juniorFall);
  assert.deepEqual(g.now.map((t) => t.title), ["Fill in your numbers and courses"]);
  assert.deepEqual(g.more, [], "next season's move is not in More either");
  assert.deepEqual(g.comingUp.map((m) => m.title), ["Register for a spring SAT or ACT"], "it stays in Coming up (the parent's view)");
});

test("the 14-day lead: 'Common App opens Aug 1' shows on Jul 20 and not on Jul 10", () => {
  const commonApp = task({ title: "Common App opens", kind: "cycle", source: "cycle", season: null, key: "list-1:cycle:common_app_opens", due_on: "2027-08-01" });
  const summer = (today: string) => ({ season: "summer_before_senior" as const, gradYear: G, today, viewer: "student" as const, facts: factsFor("summer_before_senior", today) });
  assert.equal(taskSeason(commonApp, G, "summer_before_senior"), "senior_fall", "dated in senior fall");
  assert.deepEqual(nowMoves([commonApp], summer("2027-07-20")).now.map((t) => t.title), ["Common App opens"]);
  assert.deepEqual(nowMoves([commonApp], summer("2027-07-10")).now, []);
  assert.equal(eligibleNow(commonApp, summer("2027-07-18")), true, "exactly fourteen days ahead");
  assert.equal(eligibleNow(commonApp, summer("2027-07-17")), false, "fifteen days ahead");
});

test("the 14-day lead never admits a piece of an application before senior fall, whatever its date (a junior's three 'Apply' cards, 2026-10-29)", () => {
  // Junior fall, Oct 29, 2026: apply tasks that landed on the current seniors' dates (the grid's cycle, before the fix).
  const juniorFall = { season: "junior_fall" as const, gradYear: G, today: "2026-10-29", viewer: "student" as const, facts: factsFor("junior_fall", "2026-10-29") };
  const applyEa = task({ title: "Apply (EA)", kind: "apply", source: "college", season: null, key: "item-1:apply:-", due_on: "2026-11-01" });
  const applyEd = task({ title: "Apply (ED I)", kind: "apply", source: "college", season: null, key: "item-2:apply:-", due_on: "2026-11-01" });
  const fee = task({ title: "Pay the application fee", kind: "fee", source: "college", season: null, key: "item-1:fee:-", due_on: "2026-11-01" });
  const real = task({ title: "Take a practice PSAT", season: "junior_fall" });
  const g = nowMoves([applyEa, applyEd, fee, real], juniorFall);
  assert.deepEqual(g.now.map((t) => t.title), ["Take a practice PSAT"]);
  assert.deepEqual(g.more, []);
  for (const t of [applyEa, applyEd, fee]) assert.equal(eligibleNow(t, juniorFall), false, t.title);
  // The lead still serves the cycle's own moves (a PSAT-week registration deadline, say) in the same week.
  const cycleMove = task({ title: "Register for the December SAT", kind: "cycle", source: "cycle", season: null, key: "list-1:cycle:sat_dec_register", due_on: "2026-11-06" });
  assert.equal(eligibleNow(cycleMove, juniorFall), true);
  // A senior the same week: the lead admits the apply task as before (its season is the current one anyway).
  const senior = { season: "senior_fall" as const, gradYear: 2027, today: "2026-10-29", viewer: "student" as const, facts: factsFor("senior_fall", "2026-10-29", 2027) };
  assert.equal(eligibleNow(applyEa, senior), true);
  assert.deepEqual(nowMoves([applyEa, applyEd, fee], senior).now.map((t) => t.title), ["Apply (EA)", "Apply (ED I)", "Pay the application fee"]);
  // Summer before senior year, two weeks before an Aug 15 deadline: still gated; the move belongs to senior fall.
  const summer = { season: "summer_before_senior" as const, gradYear: G, today: "2027-08-01", viewer: "student" as const, facts: factsFor("summer_before_senior", "2027-08-01") };
  assert.equal(eligibleNow(task({ title: "Apply (rolling)", kind: "apply", source: "college", season: null, key: "item-3:apply:-", due_on: "2027-08-15" }), summer), false);
});

test("a skipped move is in skipped, not now; brought back (undismissed), it returns to now", () => {
  const a = task({ title: "A", position: 1 });
  const b = task({ title: "B", position: 2, dismissed: true, dismissed_at: "2027-04-12T15:00:00Z", dismissed_by: "u1" });
  const g = nowMoves([a, b], opts);
  assert.deepEqual(g.now.map((t) => t.title), ["A"]);
  assert.deepEqual(g.skipped.map((t) => t.title), ["B"]);
  const back = { ...b, dismissed: false, dismissed_at: null, dismissed_by: null };
  const g2 = nowMoves([a, back], opts);
  assert.deepEqual(g2.now.map((t) => t.title), ["A", "B"]);
  assert.deepEqual(g2.skipped, []);
});

test("skipped: this season's; a carried move skipped this season counts by its skip date; last season's skip does not", () => {
  const carried = task({ title: "Carried", season: "freshman", dismissed: true, dismissed_at: "2027-04-02T10:00:00Z" });
  const oldSkip = task({ title: "Old skip", season: "junior_winter", dismissed: true, dismissed_at: "2027-02-02T10:00:00Z" });
  const legacy = task({ title: "Skipped before the record", season: "junior_spring", dismissed: true });
  assert.deepEqual(nowMoves([carried, oldSkip, legacy], opts).skipped.map((t) => t.title).sort(), ["Carried", "Skipped before the record"]);
});

/* ------------------------------------------------------------------ */
/* Plan v3 U9: the parent's season rows, Coming up, and the target-free title */
/* ------------------------------------------------------------------ */

test("seasonRows: now and next states in Now's order, done and skipped with their dates; the guardian's own moves (Your part) are left out", () => {
  const now1 = task({ title: "Build your list", position: 1 });
  const now2 = task({ title: "Show interest", position: 2 });
  const now3 = task({ title: "Pick your recommenders", position: 3 });
  const later = task({ title: "In More", position: 4 }); // the fourth eligible move: `next`
  const done = task({ title: "Visit over spring break", done_at: "2027-04-01T12:00:00Z" });
  const skipped = task({ title: "Write your story", dismissed: true, dismissed_at: "2027-04-02T10:00:00Z", dismissed_by: "u1" });
  const mine = task({ title: "Run the calculator", assignee: "guardian", position: 5 });
  const rows = seasonRows([now1, now2, now3, later, done, skipped, mine], opts);
  assert.deepEqual(
    rows.map((r) => [r.task.title, r.state]),
    [
      ["Build your list", "now"],
      ["Show interest", "now"],
      ["Pick your recommenders", "now"],
      ["In More", "next"],
      ["Visit over spring break", "done"],
      ["Write your story", "skipped"],
    ],
  );
  assert.ok(!rows.some((r) => r.task.title === "Run the calculator"), "a guardian's own move is Your part, not a season row");
  const skippedRow = rows.find((r) => r.state === "skipped")!;
  assert.equal(skippedRow.when, "2027-04-02T10:00:00Z");
  const doneRow = rows.find((r) => r.state === "done")!;
  assert.equal(doneRow.when, "2027-04-01T12:00:00Z");
});

test("seasonRows: a skipped move is 'skipped', never 'now', even though the student's own tab hides it entirely", () => {
  const a = task({ title: "A", position: 1 });
  const b = task({ title: "B", position: 2, dismissed: true, dismissed_at: "2027-04-12T15:00:00Z" });
  const rows = seasonRows([a, b], opts);
  assert.deepEqual(rows.map((r) => r.state), ["now", "skipped"]);
  assert.deepEqual(nowMoves([a, b], opts).now.map((t) => t.title), ["A"], "the student's now never shows a skipped move");
});

test("comingUpRows: next season's open moves only, reusing nowMoves's comingUp; never a row in this season's list", () => {
  const thisSeason = task({ title: "This season", position: 1 });
  const nextOne = task({ title: "Next season's move", season: "summer_before_senior", due_on: "2027-07-01" });
  const laterStill = task({ title: "Senior fall thing", season: "senior_fall" });
  const rows = seasonRows([thisSeason, nextOne, laterStill], opts);
  assert.ok(!rows.some((r) => r.task.title === "Next season's move"), "a later season's move is never a season row");
  assert.deepEqual(comingUpRows([thisSeason, nextOne, laterStill], opts), [{ title: "Next season's move", date: "2027-07-01" }]);
});

test("parentSafeTitle: a reach_score move's title never carries the student's own target; every other title passes through", () => {
  const reach = task({ title: "Work toward your 1400", key: "list-1:playbook:reach_score_junior_spring" });
  assert.equal(parentSafeTitle(reach), "Work toward the target score");
  assert.doesNotMatch(parentSafeTitle(reach), /\d/);
  const other = task({ title: "Pick your recommenders", key: "list-1:playbook:pick_recommenders" });
  assert.equal(parentSafeTitle(other), "Pick your recommenders");
  const untitled = task({ title: "Work toward your 1400", key: null });
  assert.equal(parentSafeTitle(untitled), "Work toward your 1400", "no key: passes through (the catalog guard covers the real entries)");
});

test("three cards; when one is ticked the fourth surfaces", () => {
  const four = [1, 2, 3, 4].map((i) => task({ title: `M${i}`, position: i }));
  assert.deepEqual(nowMoves(four, opts).now.map((t) => t.title), ["M1", "M2", "M3"]);
  const ticked = four.map((t) => (t.title === "M2" ? { ...t, done_at: "2027-04-15T12:00:00Z" } : t));
  const g = nowMoves(ticked, opts);
  assert.deepEqual(g.now.map((t) => t.title), ["M1", "M3", "M4"]);
  assert.deepEqual(g.done.map((t) => t.title), ["M2"]);
});
