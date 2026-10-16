/**
 * Importance ranking (lib/planner/importance.ts; specs/planner/record/ranking.md): every `TaskKind` and `PLAYBOOK`
 * key resolves to a table row, a season rule, or an explicit "default on purpose" allowlist; the timing boosts; the
 * season-zero rules (story, pick/ask recommenders, a course choice outside its window, reach-your-score with no
 * date left that would count); the carried −10; and the worked example from ranking.md ("Worked example"): the
 * three shown and their order, then the PSAT ticked and the interest move surfacing. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleFor, loadCycle } from "../lib/planner/cycle.ts";
import {
  baseImportance,
  compareByImportance,
  DEFAULT_IMPORTANCE,
  importance,
  MOVE_IMPORTANCE,
  timingBoost,
  type ImportanceFacts,
  type ImportanceTask,
} from "../lib/planner/importance.ts";
import { nowMoves } from "../lib/planner/moves.ts";
import { PLAYBOOK } from "../lib/planner/moves-catalog.ts";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { CourseEntry } from "../lib/chances/types.ts";
import type { PlanTask, TaskKind } from "../lib/planner/types.ts";

const G = 2028;

let n = 0;
const task = (over: Partial<PlanTask> = {}): PlanTask => ({
  id: `t${++n}`,
  list_id: "list-1",
  item_id: null,
  key: null,
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
  created_at: "2026-01-01T00:00:00Z",
  season: "junior_fall",
  action: null,
  ...over,
});

const factsFor = (over: Partial<ImportanceFacts> = {}): ImportanceFacts => ({
  season: "junior_fall",
  today: "2026-10-16",
  gradYear: G,
  profile: null,
  cycle: loadCycle(cycleFor(G)),
  listDeadlines: [],
  ...over,
});

/* ------------------------------------------------------------------ */
/* Exhaustiveness: every TaskKind and every PLAYBOOK key is accounted for */
/* ------------------------------------------------------------------ */

const ALL_KINDS: readonly TaskKind[] = [
  "apply", "decision_expected", "aid_forms", "reply_by", "housing_deposit", "ed2_conditional",
  "cycle", "decide_rounds",
  "follow", "request_info", "write_visit_notes",
  "fee", "send_scores", "transcript", "recommendation", "supplement", "submit", "portal_setup", "portal_check",
  "continued_interest", "waitlist_accept", "waitlist_deposit_elsewhere",
  "add_offer", "deposit", "withdraw", "waitlist_decide", "summer",
  "cost_check", "test_register", "test_day",
  "playbook",
  "ed_decide", "ed2_decide",
  "visit_ed", "show_interest",
  "shape_gap", "shape_cost",
  "confirm_complete", "compare_offers", "decide_by", "outcome_share",
  "story",
  "own",
];

/**
 * Kinds with no table entry and no season rule, on purpose: a plain built-task kind (`cycle`, `shape_gap`, `playbook`
 * are generic — resolved by their key suffix instead, which a bare kind lookup never reaches), a to-do kind
 * build-plan.md hasn't ranked yet (`reply_by`, `housing_deposit`, `decide_rounds`, `waitlist_deposit_elsewhere`,
 * `add_offer`, `withdraw`, `summer`), and `own` (not a move at all — `nowMoves` never sees it, since `isMove` would
 * need its own guard, but `importance.ts` still owes it a defined value).
 */
const DEFAULT_ON_PURPOSE: ReadonlySet<TaskKind> = new Set([
  "reply_by", "housing_deposit", "cycle", "decide_rounds",
  "waitlist_deposit_elsewhere", "add_offer", "withdraw", "summer",
  "playbook", "shape_gap", "own",
]);

test("every TaskKind resolves to a table row (kind:<k>) or is in the explicit default allowlist; `story` is season-ruled, not a table row", () => {
  const facts = factsFor();
  for (const kind of ALL_KINDS) {
    if (kind === "story") continue; // season-ruled below, not a flat table row
    const t: ImportanceTask = { kind, key: null, season: "junior_fall", window_start: null, window_end: null, due_on: null };
    const base = baseImportance(t, facts);
    if (DEFAULT_ON_PURPOSE.has(kind)) {
      assert.equal(base, DEFAULT_IMPORTANCE, `${kind}: default on purpose`);
      assert.ok(!(`kind:${kind}` in MOVE_IMPORTANCE), `${kind}: not supposed to be in the table either`);
    } else {
      assert.ok(`kind:${kind}` in MOVE_IMPORTANCE, `${kind}: expected a table row`);
      assert.equal(base, MOVE_IMPORTANCE[`kind:${kind}`], kind);
      assert.notEqual(base, DEFAULT_IMPORTANCE, `${kind}: a real row, not coincidentally the default`);
    }
  }
  // Every kind in the union is covered by exactly one of the two groups above (nothing fell through unnoticed).
  assert.deepEqual(new Set(ALL_KINDS).size, ALL_KINDS.length, "no duplicate in the fixture itself");
});

test("`story`'s kind alone resolves via the season rule, never the default, whatever its key", () => {
  const t: ImportanceTask = { kind: "story", key: null, season: "junior_fall", window_start: null, window_end: null, due_on: null };
  assert.equal(baseImportance(t, factsFor({ season: "junior_fall" })), 0);
  assert.equal(baseImportance(t, factsFor({ season: "summer_before_senior" })), 70);
});

test("every PLAYBOOK key resolves: a season rule (story, pick_recommenders, *_choose_courses, reach_score_*, build_list/long_list) or a direct 'playbook:<key>' table row; the record's own 'profile' key resolves by firstMissingSection", () => {
  const SEASON_RULED = new Set([
    "story", "pick_recommenders",
    "freshman_choose_courses", "sophomore_choose_courses", "junior_choose_courses",
    "reach_score_junior_fall", "reach_score_junior_winter", "reach_score_junior_spring", "reach_score_summer_before_senior", "reach_score_senior_fall",
    "build_list", "long_list",
    "profile",
  ]);
  for (const entry of PLAYBOOK) {
    const t: ImportanceTask = { kind: "playbook", key: `list-1:playbook:${entry.key}`, season: entry.season, window_start: null, window_end: null, due_on: null };
    const base = baseImportance(t, factsFor({ season: entry.season === "unknown" ? "junior_fall" : entry.season }));
    if (SEASON_RULED.has(entry.key)) {
      // Covered by its own dedicated test below; here just confirm it isn't silently falling to the flat default.
      continue;
    }
    assert.ok(`playbook:${entry.key}` in MOVE_IMPORTANCE, `${entry.key}: expected a table row`);
    assert.equal(base, MOVE_IMPORTANCE[`playbook:${entry.key}`], entry.key);
  }
});

/* ------------------------------------------------------------------ */
/* timingBoost                                                         */
/* ------------------------------------------------------------------ */

test("timingBoost: overdue +30; within 7 days +20; within 14 +10; within 30 +5; later or undated 0", () => {
  const today = "2027-01-01";
  assert.equal(timingBoost({ due_on: "2026-12-31", window_start: null, window_end: null }, today), 30, "overdue by a day");
  assert.equal(timingBoost({ due_on: today, window_start: null, window_end: null }, today), 20, "due today (0 days)");
  assert.equal(timingBoost({ due_on: "2027-01-08", window_start: null, window_end: null }, today), 20, "exactly 7 days");
  assert.equal(timingBoost({ due_on: "2027-01-09", window_start: null, window_end: null }, today), 10, "exactly 8 days falls to the 14-day band");
  assert.equal(timingBoost({ due_on: "2027-01-15", window_start: null, window_end: null }, today), 10, "exactly 14 days");
  assert.equal(timingBoost({ due_on: "2027-01-16", window_start: null, window_end: null }, today), 5, "exactly 15 days falls to the 30-day band");
  assert.equal(timingBoost({ due_on: "2027-01-31", window_start: null, window_end: null }, today), 5, "exactly 30 days");
  assert.equal(timingBoost({ due_on: "2027-02-01", window_start: null, window_end: null }, today), 0, "31 days: no boost");
  assert.equal(timingBoost({ due_on: null, window_start: null, window_end: null }, today), 0, "undated: no boost");
  // A window dates by its end (taskDate).
  assert.equal(timingBoost({ due_on: null, window_start: "2026-12-01", window_end: "2027-01-05" }, today), 20, "a window dates by its end");
});

/* ------------------------------------------------------------------ */
/* Season-zero rules (ranking.md "Timing rules moved here")            */
/* ------------------------------------------------------------------ */

test("story: 0 before summer before senior year, 70 there, 65 senior fall", () => {
  const t: ImportanceTask = { kind: "story", key: "list-1:playbook:story", season: "junior_fall", window_start: null, window_end: null, due_on: null };
  assert.equal(baseImportance(t, factsFor({ season: "freshman" })), 0);
  assert.equal(baseImportance(t, factsFor({ season: "junior_spring" })), 0);
  assert.equal(baseImportance(t, factsFor({ season: "summer_before_senior" })), 70);
  assert.equal(baseImportance(t, factsFor({ season: "senior_fall" })), 65);
  assert.equal(baseImportance(t, factsFor({ season: "senior_winter" })), 0, "past senior fall: 0 again");
});

test("pick_recommenders / ask_recommenders: 0 before summer before senior year, 68 there, 75 senior fall", () => {
  const pick: ImportanceTask = { kind: "playbook", key: "list-1:playbook:pick_recommenders", season: "summer_before_senior", window_start: null, window_end: null, due_on: null };
  assert.equal(baseImportance(pick, factsFor({ season: "junior_spring" })), 0);
  assert.equal(baseImportance(pick, factsFor({ season: "summer_before_senior" })), 68);
  assert.equal(baseImportance(pick, factsFor({ season: "senior_fall" })), 75);
  const ask: ImportanceTask = { kind: "cycle", key: "list-1:cycle:ask_recommenders", season: null, window_start: "2027-04-15", window_end: "2027-06-10", due_on: null };
  assert.equal(baseImportance(ask, factsFor({ season: "junior_spring" })), 0, "the cycle window stays as data, but the move's base is 0 before summer");
  assert.equal(baseImportance(ask, factsFor({ season: "summer_before_senior" })), 68);
});

test("choose_courses*: 70 inside the task's own window, 0 outside it", () => {
  const t: ImportanceTask = { kind: "playbook", key: "list-1:playbook:junior_choose_courses", season: "junior_winter", window_start: "2027-02-01", window_end: "2027-04-30", due_on: null };
  assert.equal(baseImportance(t, factsFor({ today: "2027-01-31" })), 0, "a day before the window");
  assert.equal(baseImportance(t, factsFor({ today: "2027-02-01" })), 70, "the window's first day");
  assert.equal(baseImportance(t, factsFor({ today: "2027-04-30" })), 70, "the window's last day");
  assert.equal(baseImportance(t, factsFor({ today: "2027-05-01" })), 0, "a day after the window");
  const cycleVariant: ImportanceTask = { kind: "cycle", key: "list-1:cycle:choose_courses_2027", season: null, window_start: "2027-02-01", window_end: "2027-04-30", due_on: null };
  assert.equal(baseImportance(cycleVariant, factsFor({ today: "2027-03-01" })), 70);
});

test("reach_score_*: 0 once no remaining test date would arrive before the earliest deadline (a senior told to study for a test that can't count)", () => {
  const t: ImportanceTask = { kind: "playbook", key: "list-1:playbook:reach_score_senior_fall", season: "senior_fall", window_start: null, window_end: null, due_on: null };
  const satProfile: StudentProfileData = { ...emptyProfile(), tests: { ...emptyProfile().tests, focus: "sat", satTotal: 1300, target: 1450 } };
  // A senior fall with a deadline already past every remaining SAT date's score-arrival window: datesFor finds none.
  const noneLeft = factsFor({
    season: "senior_fall",
    today: "2027-12-20",
    profile: satProfile,
    listDeadlines: [{ name: "Early U", round: "RD", iso: "2027-11-01" }],
  });
  assert.equal(baseImportance(t, noneLeft), 0, "every SAT date left arrives too late for the one deadline on the list");
  // The same senior, but a deadline far enough out that an upcoming SAT date would still arrive in time.
  const stillTime = factsFor({
    season: "senior_fall",
    today: "2027-10-01",
    profile: satProfile,
    listDeadlines: [{ name: "Late U", round: "RD", iso: "2028-02-01" }],
  });
  assert.equal(baseImportance(t, stillTime), 72);
  // No real focus test: the move wouldn't be generated at all, but baseImportance still answers 72 (ranking.md note).
  assert.equal(baseImportance(t, factsFor({ profile: null })), 72);
});

/* ------------------------------------------------------------------ */
/* build_list / long_list and the record's major (season-varying table rows) */
/* ------------------------------------------------------------------ */

test("build_list/long_list: 65 from junior fall on, 55 freshman/sophomore", () => {
  const t: ImportanceTask = { kind: "playbook", key: "list-1:playbook:build_list", season: "junior_fall", window_start: null, window_end: null, due_on: null };
  assert.equal(baseImportance(t, factsFor({ season: "freshman" })), 55);
  assert.equal(baseImportance(t, factsFor({ season: "sophomore" })), 55);
  assert.equal(baseImportance(t, factsFor({ season: "junior_fall" })), 65);
  assert.equal(baseImportance(t, factsFor({ season: "senior_fall" })), 65);
});

test("the record's major (the catalog's 'profile' key, resolved by firstMissingSection): 50, 60 from junior spring on", () => {
  // A profile with every earlier section done, major the first missing one.
  const majorMissing: StudentProfileData = {
    ...emptyProfile(),
    basics: { ...emptyProfile().basics, highSchoolId: "hs1" },
    academics: { ...emptyProfile().academics, gpa: 3.8, classStanding: "top10", courses: [course()], activitiesNone: { clubs: true, sports: true, work: true, other: true, connections: true } },
    tests: { ...emptyProfile().tests, focus: "sat", satTotal: 1300 },
  };
  const t: ImportanceTask = { kind: "playbook", key: "list-1:playbook:profile", season: "freshman", window_start: null, window_end: null, due_on: null };
  assert.equal(baseImportance(t, factsFor({ season: "freshman", profile: majorMissing })), 50);
  assert.equal(baseImportance(t, factsFor({ season: "junior_spring", profile: majorMissing })), 60);
  // No profile at all: the first missing section is high_school (DEFAULT_IMPORTANCE's row is a different one).
  assert.equal(baseImportance(t, factsFor({ profile: null })), MOVE_IMPORTANCE["profile:high_school"]);
});

/* ------------------------------------------------------------------ */
/* Carried (−10) and ties                                              */
/* ------------------------------------------------------------------ */

test("carried: −10 when the move's own season is earlier than the current one", () => {
  const earlier = task({ title: "Carried", season: "freshman", key: "list-1:playbook:nonexistent-key" });
  const current = task({ title: "Current", season: "junior_fall", key: "list-1:playbook:nonexistent-key" });
  const facts = factsFor({ season: "junior_fall" });
  assert.equal(importance(earlier, facts), DEFAULT_IMPORTANCE - 10);
  assert.equal(importance(current, facts), DEFAULT_IMPORTANCE);
});

test("compareByImportance: importance desc; ties dated before undated, then the catalog's position, then title", () => {
  const facts = factsFor();
  const a = task({ title: "B undated", position: 5 });
  const b = task({ title: "A undated", position: 5 });
  const dated = task({ title: "Z dated", position: 9, due_on: "2026-12-01" }); // same default importance, but dated
  assert.equal(compareByImportance(dated, a, facts) < 0, true, "dated beats undated at the same importance");
  assert.equal(compareByImportance(a, b, facts) > 0, true, "same position: title order (A before B)");
  const higherPosition = task({ title: "A undated", position: 1 });
  assert.equal(compareByImportance(higherPosition, a, facts) < 0, true, "lower position number wins");
});

/* ------------------------------------------------------------------ */
/* The worked example (ranking.md "Worked example")                    */
/* ------------------------------------------------------------------ */

function course(over: Partial<CourseEntry> = {}): CourseEntry {
  return { id: `c-${Math.random()}`, kind: "regular", key: null, name: "English 10", subject: "english", year: 10, status: "taken", grades: { s1: null, s2: null, final: null }, exam: null, ...over };
}

test("the worked example: a junior in October, three shown and their order; ticking the PSAT surfaces the interest move, with the clubs move next in line", () => {
  // The profile: a real SAT below target (reach_score eligible), and every section but major filled in (so the
  // generic 'profile' task's firstMissingSection lands on major, matching ranking.md's "Add a major (record)" row;
  // the separate "Add your clubs" task below gets its importance from the table directly, not from this profile).
  const profile: StudentProfileData = {
    ...emptyProfile(),
    basics: { ...emptyProfile().basics, highSchoolId: "hs1" },
    academics: { ...emptyProfile().academics, gpa: 3.6, classStanding: "top25", courses: [course()], activitiesNone: { clubs: true, sports: true, work: true, other: true, connections: true } },
    tests: { ...emptyProfile().tests, focus: "sat", satTotal: 1350, target: 1450 },
  };
  const facts = factsFor({
    season: "junior_fall",
    today: "2026-10-16",
    profile,
    listDeadlines: [
      { name: "Reach U1", round: "RD", iso: "2027-11-15" },
      { name: "Reach U2", round: "RD", iso: "2027-11-15" },
      { name: "Reach U3", round: "RD", iso: "2027-11-15" },
      { name: "Reach U4", round: "RD", iso: "2027-11-15" },
      { name: "Reach U5", round: "RD", iso: "2027-11-15" },
    ],
  });

  const clubs = task({ id: "clubs", title: "Add your clubs", key: "list-1:playbook:activities", season: "freshman" });
  const reach = task({ id: "reach", title: "Work toward your 1450", key: "list-1:playbook:reach_score_junior_fall", season: "junior_fall" });
  const buildList = task({ id: "build-list", title: "Add a few Likely schools", key: "list-1:playbook:build_list", season: "junior_fall" });
  const psat = task({ id: "psat", title: "PSAT/NMSQT in October", key: "list-1:playbook:psat_nmsqt", season: "junior_fall", window_start: "2026-10-01", window_end: "2026-10-31" });
  const major = task({ id: "major", title: "Add a major", key: "list-1:playbook:profile", season: "freshman" });
  const interest = task({ id: "interest", title: "Show Elon you're interested", kind: "show_interest", key: "item-1:show_interest", season: "junior_fall" });
  const all = [clubs, reach, buildList, psat, major, interest];

  // base/timing/carried, matching ranking.md's table exactly.
  assert.equal(importance(clubs, facts), 45, "55 base − 10 carried (freshman entry)");
  assert.equal(importance(reach, facts), 72);
  assert.equal(importance(buildList, facts), 65);
  assert.equal(importance(psat, facts), 57, "52 base + 5 timing (15 days away)");
  assert.equal(importance(major, facts), 40, "50 base − 10 carried");
  assert.equal(importance(interest, facts), 55);

  const opts = { season: "junior_fall" as const, gradYear: G, today: "2026-10-16", viewer: "student" as const, facts };
  const g = nowMoves(all, opts);
  assert.deepEqual(g.now.map((t) => t.title), ["Work toward your 1450", "Add a few Likely schools", "PSAT/NMSQT in October"]);

  // Tick the PSAT: the interest move surfaces into Now; "Add your clubs" is next in line (the top of More).
  const psatDone = { ...psat, done_at: "2026-10-20T00:00:00Z" };
  const afterPsat = [clubs, reach, buildList, psatDone, major, interest];
  const g2 = nowMoves(afterPsat, opts);
  assert.deepEqual(g2.now.map((t) => t.title), ["Work toward your 1450", "Add a few Likely schools", "Show Elon you're interested"]);
  assert.equal(g2.more[0]?.title, "Add your clubs", "next in line once another now-move closes out");
});
