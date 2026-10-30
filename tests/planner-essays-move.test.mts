/**
 * The essays move (lib/planner/generators/essays.ts; specs/product/essays/moves.md): the generator's five states and
 * its one row (key, kind, source, assignee, action with the college anchor), the season stamp (the current season,
 * never carried, so never −10), a junior never sees it (not generated, the application gate, importance 0), the
 * importance by season with the deadline's timing, the cycle's two essay entries at 0, the apply generator without
 * its supplement rows, the card's button, and the store's tick against a fake Supabase client. Each guard is shown
 * failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tickEssaysMove } from "../lib/essays/move-tick.ts";
import { ESSAYS_BUTTON, generate } from "../lib/planner/generators/essays.ts";
import { generate as generateApply } from "../lib/planner/generators/apply.ts";
import { baseImportance, beforeApplicationSeason, essaysImportance, importance, MOVE_IMPORTANCE, type ImportanceFacts } from "../lib/planner/importance.ts";
import { eligibleNow } from "../lib/planner/moves.ts";
import { SEASON_EXPLAINER } from "../lib/planner/moves-catalog.ts";
import { cycleFor, loadCycle } from "../lib/planner/cycle.ts";
import { generateTasks, taskKey } from "../lib/planner/tasks.ts";
import { planHref } from "../lib/planner/plan-tabs.ts";
import { isKindCheckError, upsertTaskRows } from "../lib/planner/read-plan.ts";
import { SEASONS, seasonOf, type Season } from "../lib/planner/seasons.ts";
import type { GeneratedTask, GeneratorInput, PlanTask } from "../lib/planner/types.ts";
import { fakeSupabase } from "./helpers/fake-supabase.mts";
import { DUKE, GRAD, GT, LIST_ID, MICH, STUDENT_ID, YALE, item, workedDrafts, workedItems, workedSchools } from "./helpers/essays-plan.mts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

function input(today: string, on: Parameters<typeof workedDrafts>[0] | null, over: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    list: { id: LIST_ID, student_id: STUDENT_ID } as GeneratorInput["list"],
    items: workedItems(),
    schools: workedSchools(),
    profile: null,
    cycle: loadCycle(cycleFor(GRAD)),
    grade: "senior",
    today,
    visits: [],
    offers: [],
    gradYear: GRAD,
    season: seasonOf(GRAD, today),
    estimates: {},
    allMoves: false,
    essays: on ? workedDrafts(on) : null,
    ...over,
  } as GeneratorInput;
}

const only = (tasks: GeneratedTask[]) => {
  assert.equal(tasks.length, 1, "one move for the whole list, never one per college or prompt");
  return tasks[0];
};

const asTask = (g: GeneratedTask, over: Partial<PlanTask> = {}): PlanTask => ({
  id: "t1",
  list_id: LIST_ID,
  done_at: null,
  done_by: null,
  snoozed_until: null,
  dismissed: false,
  dismissed_at: null,
  dismissed_by: null,
  orphaned: false,
  created_by: null,
  created_at: "2026-07-01T00:00:00Z",
  ...g,
  season: g.season ?? null,
  action: g.action ?? null,
  ...over,
});

const facts = (season: Season, today: string): ImportanceFacts => ({ season, today, gradYear: GRAD, profile: null, cycle: loadCycle(cycleFor(GRAD)), listDeadlines: [] });

/* ------------------------------------------------------------------ */
/* The generator                                                       */
/* ------------------------------------------------------------------ */

test("the one row: key {list}:essays:next, kind essays, source season, the student's, open_tab essays", () => {
  const t = only(generate(input("2026-07-10", "jul10")));
  assert.equal(t.key, taskKey(LIST_ID, "essays", "next"));
  assert.equal(t.key, `${LIST_ID}:essays:next`);
  assert.equal(t.kind, "essays");
  assert.equal(t.source, "season");
  assert.equal(t.assignee, "student");
  assert.equal(t.item_id, null);
  assert.deepEqual(t.action, { kind: "open_tab", tab: "essays" });
});

test("the five states (moves.md 'What it says, by state'), each with its date and anchor", () => {
  const states: [string, Parameters<typeof workedDrafts>[0], string, string | null, string | null][] = [
    ["2026-07-10", "jul10", "Write your essays", null, null],
    ["2026-07-28", "jul28", "Finish your personal essay", null, null],
    ["2026-08-20", "aug20", "Finish Georgia Tech's essays", "2026-10-15", GT],
    ["2026-11-03", "nov3", "Check what Yale asks you to write", "2027-01-02", YALE],
    ["2026-11-20", "nov20", "Your essays are ready", null, null],
  ];
  for (const [today, on, title, due, college] of states) {
    const t = only(generate(input(today, on)));
    assert.equal(t.title, title, today);
    assert.equal(t.due_on, due, `${today} date`);
    assert.deepEqual(t.action, college ? { kind: "open_tab", tab: "essays", college } : { kind: "open_tab", tab: "essays" }, `${today} action`);
    assert.doesNotMatch(`${t.title} ${t.detail}`, /A prompt\./, "no essay text on the card");
  }
});

test("the button opens the Essays tab at the named college's card; Write it with work left, See them when all is ready", () => {
  const t = only(generate(input("2026-08-20", "aug20")));
  const action = t.action as { kind: "open_tab"; tab: "essays"; college?: string };
  assert.equal(planHref({ tab: action.tab, college: action.college }), `/advisor?tab=essays#college-${GT}`);
  assert.deepEqual(ESSAYS_BUTTON, { work: "Write it", ready: "See them" });
  const card = read("components", "planner", "moves", "MoveCard.tsx");
  assert.match(card, /task\.kind === "essays"/);
  assert.match(card, /essaysButton\(essayProgress\(/);
  assert.match(card, /college: action\.college \?\? null/);
});


test("the season stamp is the current season on each regeneration, so the move never pays the −10 of a carried one", () => {
  const fall = only(generate(input("2026-10-03", "oct3")));
  assert.equal(fall.season, "senior_fall");
  const winter = only(generate(input("2027-01-10", "nov20")));
  assert.equal(winter.season, "senior_winter", "re-stamped, not left at senior fall");
  const now = facts("senior_winter", "2027-01-10");
  assert.equal(importance(asTask(winter), now), 85);
  // Broken rule: a row left stamped with the season it was first made in would read as carried and lose 10.
  assert.equal(importance(asTask(winter, { season: "senior_fall" }), now), 75);
});

test("generated only from summer before senior year through senior winter: nothing before or after", () => {
  const on: Record<string, string> = {
    freshman: "2023-10-01",
    sophomore: "2024-10-01",
    junior_fall: "2025-10-01",
    junior_winter: "2026-01-15",
    junior_spring: "2026-04-01",
    summer_before_senior: "2026-07-01",
    senior_fall: "2026-10-01",
    senior_winter: "2027-01-15",
    senior_spring: "2027-04-01",
    summer_after: "2027-07-01",
    graduated: "2027-09-01",
  };
  for (const [season, today] of Object.entries(on)) {
    assert.equal(seasonOf(GRAD, today), season, today);
    const tasks = generate(input(today, "jul28"));
    const want = season === "summer_before_senior" || season === "senior_fall" || season === "senior_winter";
    assert.equal(tasks.length, want ? 1 : 0, season);
    if (want) assert.equal(tasks[0].season, season);
  }
  assert.deepEqual(generate(input("2026-10-01", null, { season: "unknown", gradYear: null })), [], "no class year, no move");
});

test("a junior never sees it: not generated, and a stray row is gated out (application gate) and worth 0", () => {
  const junior = input("2026-04-01", "jul28");
  assert.equal(junior.season, "junior_spring");
  assert.deepEqual(generate(junior), []);
  assert.ok(!generateTasks(junior).some((t) => t.kind === "essays"), "nor through the registry");
  // A row stamped for senior fall, dated within two weeks: the season gate alone would let a dated move through.
  const stray = asTask(only(generate(input("2026-10-03", "oct3"))), { due_on: "2026-04-10" });
  assert.equal(eligibleNow(stray, { season: "junior_spring", gradYear: GRAD, today: "2026-04-01" }), false);
  // Broken rule: the same row as a kind outside the application gate passes on its date alone.
  assert.equal(eligibleNow({ ...stray, kind: "playbook" }, { season: "junior_spring", gradYear: GRAD, today: "2026-04-01" }), true);
  assert.equal(beforeApplicationSeason(stray, "junior_spring"), true);
  assert.equal(baseImportance({ ...stray, due_on: null }, facts("junior_spring", "2026-04-01")), 0);
  assert.equal(essaysImportance("junior_spring"), 0);
  // The gate opens a season early for this move only: in the summer it is eligible, while a fee row still waits.
  const summer = asTask(only(generate(input("2026-07-10", "jul10"))));
  assert.equal(eligibleNow(summer, { season: "summer_before_senior", gradYear: GRAD, today: "2026-07-10" }), true);
  assert.equal(beforeApplicationSeason({ kind: "fee", source: "stage" }, "summer_before_senior"), true);
  // Broken rule: with the gate at senior fall for every piece (as before), the summer's move would be gated out.
  assert.equal(beforeApplicationSeason({ kind: "submit", source: "stage" }, "summer_before_senior"), true);
});

test("importance by season: 72 summer, 85 senior fall and winter, 0 otherwise; plus the deadline's timing", () => {
  for (const s of SEASONS) {
    const want = s === "summer_before_senior" ? 72 : s === "senior_fall" || s === "senior_winter" ? 85 : 0;
    assert.equal(essaysImportance(s), want, s);
  }
  const base = { kind: "essays" as const, key: `${LIST_ID}:essays:next`, window_start: null, window_end: null, source: "season" as const };
  const at = (today: string, due: string | null) => importance({ ...base, season: "senior_fall", due_on: due }, facts("senior_fall", today));
  assert.equal(at("2026-08-20", "2026-10-15"), 85, "56 days out");
  assert.equal(at("2026-10-03", "2026-11-01"), 90, "29 days: +5");
  assert.equal(at("2026-10-20", "2026-11-01"), 95, "12 days: +10");
  assert.equal(at("2026-10-27", "2026-11-01"), 100, "5 days: +20, clamped");
  assert.equal(at("2026-10-03", null), 85, "undated");
  assert.equal(MOVE_IMPORTANCE["kind:essays"], 85, "the table's resting value");
});

test("the cycle's personal-essay and supplements entries stay on the calendar at importance 0", () => {
  const f = facts("summer_before_senior", "2026-07-10");
  for (const key of ["personal_essay_draft", "supplements"]) {
    assert.equal(MOVE_IMPORTANCE[`cycle:${key}`], 0, key);
    const t = { kind: "cycle" as const, key: `${LIST_ID}:cycle:${key}`, season: null, due_on: null, window_start: "2026-06-15", window_end: "2026-08-31" };
    assert.equal(importance(t, f), 0, key);
  }
  // The cycle generator still writes them (the calendar), with the summer one's button as built.
  const cycle = generateTasks(input("2026-07-10", "jul10")).filter((t) => t.kind === "cycle").map((t) => t.key);
  assert.ok(cycle.includes(`${LIST_ID}:cycle:personal_essay_draft`));
});

test("the season explainer names the essays move for the summer and senior fall", () => {
  assert.match(SEASON_EXPLAINER.summer_before_senior.paragraph, /the summer is for the personal essay; the fall for each college's supplements, earliest deadline first/);
  assert.match(SEASON_EXPLAINER.senior_fall.paragraph, /each college's supplements, earliest deadline first/);
});

test("the apply generator no longer emits essay rows; supplements_count stays on the item", () => {
  const items = [item(DUKE, 0, "ed", { application_platform: "common_app", supplements_count: 3 }), item(MICH, 1, "ea", { supplements_count: 2 })];
  const tasks = generateApply(input("2026-10-03", null, { items }));
  assert.ok(tasks.length > 0, "the other pieces are still there");
  assert.equal(tasks.filter((t) => t.kind === "supplement").length, 0);
  assert.ok(!tasks.some((t) => t.key.endsWith(":supplement:essay")));
  assert.equal(items[0].supplements_count, 3);
});

/* ------------------------------------------------------------------ */
/* The store's tick (lib/essays/move-tick.ts), against a fake client   */
/* ------------------------------------------------------------------ */

/** The tables the tick reads, with the worked example's list and the move's row open. */
function db(on: Parameters<typeof workedDrafts>[0], move: Partial<PlanTask> | null = {}) {
  const drafts = workedDrafts(on);
  return fakeSupabase({
    lists: [{ id: LIST_ID, student_id: STUDENT_ID, is_default: true, created: "2026-06-01" }],
    list_items: workedItems() as unknown as Record<string, unknown>[],
    essays: drafts.rows as unknown as Record<string, unknown>[],
    // The links' student filter is the join's (`essays.student_id`); the fake reads it as a column.
    essay_links: drafts.links.map((l) => ({ ...l, "essays.student_id": STUDENT_ID })),
    plan_tasks: move ? [{ id: "move-1", list_id: LIST_ID, key: `${LIST_ID}:essays:next`, kind: "essays", done_at: null, ...move }] : [],
  });
}
const deps = { schools: async () => workedSchools(), now: () => "2026-11-20T12:00:00.000Z" };

test("store tick: when every essay is ready it ticks {list}:essays:next, once", async () => {
  const client = db("nov20");
  const result = await tickEssaysMove(client as unknown as SupabaseClient, STUDENT_ID, deps);
  assert.deepEqual(result, { ticked: true, remaining: 0 });
  assert.equal(client.tables.plan_tasks[0].done_at, "2026-11-20T12:00:00.000Z");
  const writes = client.writes.filter((w) => w.table === "plan_tasks");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].ids, ["move-1"]);
  const again = await tickEssaysMove(client as unknown as SupabaseClient, STUDENT_ID, deps);
  assert.deepEqual(again, { ticked: false, reason: "already-done", remaining: null });
});

test("store tick: work left, or a college still not on file, leaves the move open", async () => {
  const left = db("oct25");
  assert.deepEqual(await tickEssaysMove(left as unknown as SupabaseClient, STUDENT_ID, deps), { ticked: false, reason: "work-left", remaining: 1 });
  const yale = db("nov3");
  assert.deepEqual(await tickEssaysMove(yale as unknown as SupabaseClient, STUDENT_ID, deps), { ticked: false, reason: "work-left", remaining: 0 });
  for (const c of [left, yale]) assert.equal(c.writes.length, 0, "nothing written");
});

test("store tick: no move row (not generated yet, or a junior) and no list write nothing", async () => {
  const none = db("nov20", null);
  assert.deepEqual(await tickEssaysMove(none as unknown as SupabaseClient, STUDENT_ID, deps), { ticked: false, reason: "no-move", remaining: null });
  const noList = fakeSupabase({ lists: [] });
  assert.deepEqual(await tickEssaysMove(noList as unknown as SupabaseClient, STUDENT_ID, deps), { ticked: false, reason: "no-list", remaining: null });
  assert.equal(none.writes.length + noList.writes.length, 0);
});

test("the store calls the tick after every write that can finish the essays, and never exports it as an action", () => {
  const store = read("lib", "essays", "store.ts");
  for (const fn of ["createEssay", "setEssayStatus", "linkEssay", "unlinkEssay", "deleteEssay"]) {
    const body = store.slice(store.indexOf(`export async function ${fn}(`));
    const end = body.indexOf("\nexport async function ", 10);
    assert.match(end > 0 ? body.slice(0, end) : body, /await afterEssayWrite\(/, fn);
  }
  assert.doesNotMatch(store, /export async function (afterEssayWrite|tickEssaysMove)/, "a use-server export is callable from the browser");
  assert.match(store, /trackServer\("essays_move_done", \{ by: "store" \}/);
  // The hand tick sends the same event from the Next steps card, beside plan_move_done.
  for (const f of ["NextSteps.tsx", "ParentNextSteps.tsx"]) assert.match(read("components", "planner", f), /track\("essays_move_done", \{ by: "hand" \}\)/, f);
});

test("a database without the essays kind yet: the other generated rows still go in, the move waits", async () => {
  const calls: Record<string, unknown>[][] = [];
  const client = {
    from: () => ({
      upsert: (rows: Record<string, unknown>[]) => {
        calls.push(rows);
        const bad = rows.some((r) => r.kind === "essays");
        return Promise.resolve({ error: bad ? { code: "23514", message: 'new row for relation "plan_tasks" violates check constraint "plan_tasks_kind_check"' } : null });
      },
    }),
  } as unknown as SupabaseClient;
  const error = await upsertTaskRows(client, [{ key: "a", kind: "fee" }, { key: "b", kind: "essays" }]);
  assert.equal(error, null);
  assert.deepEqual(calls[1].map((r) => r.key), ["a"]);
  assert.equal(isKindCheckError({ code: "23514", message: "violates check constraint \"plan_tasks_source_check\"" }), false, "another check isn't retried");
});
