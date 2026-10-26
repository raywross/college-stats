/**
 * The all-moves preview (lib/planner/all-moves.ts): with `allMoves` on, the season generator emits every playbook entry
 * of every season and the cycle generator every entry however old; the tab's grouping puts each move under its season.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "../lib/planner/generators/season.ts";
import { generate as cycleGenerate } from "../lib/planner/generators/cycle.ts";
import { PLAYBOOK, MOVE_TEXT } from "../lib/planner/moves-catalog.ts";
import { allMovesBySeason, conditionalMoves, hiddenNote } from "../lib/planner/all-moves.ts";
import { loadCycle, cycleFor } from "../lib/planner/cycle.ts";
import { gradeOf, seasonOf } from "../lib/planner/seasons.ts";
import { applyMerge, generateTasks, mergeTasks } from "../lib/planner/tasks.ts";
import type { GeneratorInput, PlanTask } from "../lib/planner/types.ts";

const LIST = "list-1";
const G = 2027;
// Senior fall for the class of 2027: the freshman-to-junior entries are long past.
const TODAY = "2026-10-20";

function input(over: Partial<GeneratorInput> = {}, gradYear: number | null = G): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: "2026-10-20T12:00:00Z", sort: null, rounds_plan_accepted_at: null },
    items: [],
    schools: {},
    profile: null,
    cycle: loadCycle(gradYear ? cycleFor(gradYear) : "2026-27"),
    grade: gradeOf(gradYear, TODAY),
    today: TODAY,
    visits: [],
    offers: [],
    gradYear,
    season: seasonOf(gradYear, TODAY),
    estimates: {},
    ...over,
  };
}

test("off: a senior gets no freshman entries", () => {
  const keys = generate(input()).map((t) => t.key);
  assert.ok(!keys.includes(`${LIST}:playbook:freshman_psat_practice`));
});

test("on: every playbook entry but the class-year one, whatever applies or replaces", () => {
  const keys = new Set(generate(input({ allMoves: true })).map((t) => t.key));
  for (const e of PLAYBOOK) {
    const key = `${LIST}:playbook:${e.key}`;
    if (e.season === "unknown") assert.ok(!keys.has(key), key);
    else if (!e.builtBy) assert.ok(keys.has(key), key);
  }
  // `walk_away` replaces `money_talk` normally; the preview shows both.
  assert.ok(keys.has(`${LIST}:playbook:money_talk`) && keys.has(`${LIST}:playbook:walk_away`));
  // An unfilled `{target}` reads as words rather than dropping the entry.
  const reach = generate(input({ allMoves: true })).find((t) => t.key.endsWith(":reach_score_junior_fall"));
  assert.equal(reach?.title, "Work toward your target score");
});

test("on: no class year gets the class-year move too", () => {
  const keys = generate(input({ allMoves: true }, null)).map((t) => t.key);
  assert.ok(keys.includes(`${LIST}:playbook:class_year`));
});

test("on: the cycle file's entries whatever applies, but national test dates only once picked", () => {
  const off = cycleGenerate(input());
  const on = cycleGenerate(input({ allMoves: true }));
  assert.ok(on.length > off.length);
  assert.ok(!on.some((t) => t.kind === "test_register" || t.kind === "test_day"));
});

test("turning it off orphans the preview's rows; back on restores them", () => {
  const now = "2026-10-20T12:00:00Z";
  const onTasks = applyMerge(LIST, [], mergeTasks([], generateTasks(input({ allMoves: true }))), now);
  const offMerge = mergeTasks(onTasks, generateTasks(input()));
  assert.ok(offMerge.orphans.length > 0);
  const offTasks = applyMerge(LIST, onTasks, offMerge, now);
  const back = mergeTasks(offTasks, generateTasks(input({ allMoves: true })));
  assert.equal(back.orphans.length, 0);
  assert.equal(back.upserts.length, offMerge.orphans.length);
});

test("grouping: every live move under its own season, calendar order, financial moves noted", () => {
  const now = "2026-10-20T12:00:00Z";
  const tasks: PlanTask[] = applyMerge(LIST, [], mergeTasks([], generateTasks(input({ allMoves: true }))), now);
  const sections = allMovesBySeason(tasks, { season: "senior_fall", gradYear: G, today: TODAY });
  assert.equal(sections[0].season, "freshman");
  const seen = sections.flatMap((s) => s.open).length;
  assert.equal(seen, tasks.length);
  const psat = sections.find((s) => s.season === "freshman")!.open.find((t) => t.key?.endsWith(":freshman_psat_practice"));
  assert.ok(psat);
  const money = tasks.find((t) => t.key?.endsWith(":playbook:money_talk"))!;
  assert.match(hiddenNote(money) ?? "", /financial aid/);
  assert.equal(hiddenNote(psat), null);
});

test("conditional moves: the rule moves this plan has no row for, placeholders in words", () => {
  const list = conditionalMoves([]);
  assert.equal(list.length, Object.keys(MOVE_TEXT).length);
  assert.ok(list.every((m) => !/\{[a-zA-Z]+\}/.test(m.title + m.why)));
  const withStory = conditionalMoves([{ kind: "story", key: `${LIST}:playbook:story`, orphaned: false }]);
  assert.ok(!withStory.some((m) => m.key === "story"));
});
