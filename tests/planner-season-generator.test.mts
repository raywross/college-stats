/**
 * The season generator (lib/planner/generators/season.ts; seasons.md "What a late joiner sees"): a late joiner in each
 * season sees only that season's entries, next season's, and earlier carried ones; nothing dated before the join is
 * overdue; carries; idempotent on regeneration; `moveApplies` for every vocabulary value; a `has_dream` entry only
 * with a Dream; built cycle entries win; registered last. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { entriesFor, generate, generateFrom, MOVE_APPLIES, moveApplies, type MoveApplies, type MoveFacts } from "../lib/planner/generators/season.ts";
import { GENERATORS } from "../lib/planner/generators/index.ts";
import { PLAYBOOK, playbookEntryFor, type PlaybookEntry } from "../lib/planner/moves-catalog.ts";
import { gradeOf, nextSeason, seasonBounds, seasonOf, seasonRank, SEASONS, type Season } from "../lib/planner/seasons.ts";
import { loadCycle, cycleFor } from "../lib/planner/cycle.ts";
import { addDays } from "../lib/planner/stage.ts";
import { applyMerge, generateTasks, mergeTasks, taskDate } from "../lib/planner/tasks.ts";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { GeneratorInput, PlanItem, PlanTask } from "../lib/planner/types.ts";

const LIST = "list-1";
const G = 2028;
const NOW = "2026-10-14T12:00:00Z";

const item = (over: Partial<PlanItem> = {}): PlanItem =>
  ({ id: "item-1", list_id: LIST, unit_id: "100", category: "target", status: "considering", round: null, position: 1, dream: false, visited_on: null, withdrawn_on: null, legacy: false, recruited: "none", info_requested_on: null, followed_networks: [], ...over }) as unknown as PlanItem;

function input(today: string, over: Partial<GeneratorInput> = {}, gradYear: number | null = G): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: NOW, sort: null, rounds_plan_accepted_at: null },
    items: [],
    schools: {},
    profile: null,
    cycle: loadCycle(gradYear ? cycleFor(gradYear) : "2026-27"),
    grade: gradeOf(gradYear, today),
    today,
    visits: [],
    offers: [],
    gradYear,
    season: seasonOf(gradYear, today),
    estimates: {},
    ...over,
  };
}

/** A day in the middle of each dated season, for the class of 2028. */
const MID: Record<Exclude<Season, "unknown">, string> = {
  freshman: "2024-11-15",
  sophomore: "2025-11-15",
  junior_fall: "2026-11-15",
  junior_winter: "2027-02-10",
  junior_spring: "2027-04-15",
  summer_before_senior: "2027-07-01",
  senior_fall: "2027-11-15",
  senior_winter: "2028-02-10",
  senior_spring: "2028-04-15",
  summer_after: "2028-07-01",
  graduated: "2028-10-01",
};

test("a late joiner in each season sees only this season's, next season's, and earlier carried entries", () => {
  for (const season of SEASONS) {
    const today = season === "unknown" ? "2026-10-14" : MID[season];
    const inp = season === "unknown" ? input(today, {}, null) : input(today);
    assert.equal(inp.season, season);
    const tasks = generate(inp);
    const next = nextSeason(season);
    for (const t of tasks) {
      const entry = playbookEntryFor(t.key)!;
      assert.ok(entry, t.key);
      assert.equal(t.source, "season");
      assert.equal(t.season, entry.season);
      assert.ok(t.key.startsWith(`${LIST}:playbook:`), t.key);
      if (season === "unknown") {
        assert.equal(entry.key, "class_year");
        continue;
      }
      const ok = entry.season === season || entry.season === next || (entry.carries && seasonRank(entry.season) < seasonRank(season));
      assert.ok(ok, `${season}: ${entry.key} (${entry.season}) shouldn't show`);
    }
    if (season === "unknown") assert.deepEqual(tasks.map((t) => t.key), [`${LIST}:playbook:class_year`]);
    if (season === "graduated") assert.deepEqual(tasks, []);
  }
});

test("next season's entries are emitted (Coming up), and a non-carrying entry from last season is not", () => {
  const keys = generate(input(MID.junior_fall)).map((t) => playbookEntryFor(t.key)!.key);
  assert.ok(keys.includes("psat_nmsqt") && keys.includes("summer_program"), "this season's and junior winter's");
  assert.ok(!keys.includes("sophomore_psat_practice") && !keys.includes("freshman_visit_travel"), "last year's PSAT practice doesn't carry");
  assert.ok(keys.includes("long_list") && keys.includes("profile"), "carried while they apply");
});

test("nothing dated before the join is overdue: every dated move ends within the 30-day staleness window", () => {
  for (const season of SEASONS) {
    if (season === "unknown") continue;
    const today = MID[season];
    for (const t of generate(input(today))) {
      const d = taskDate(t as unknown as PlanTask);
      if (d !== null) assert.ok(d >= addDays(today, -30), `${season}: ${t.key} dated ${d}`);
    }
  }
  // A senior who joins in November doesn't get junior winter's FSA ID window (it carries, but its dates are long past).
  assert.ok(!generate(input(MID.senior_fall)).some((t) => t.key.endsWith(":fsa_ids")));
  // In junior winter it's dated by the season's bounds.
  const fsa = generate(input(MID.junior_winter)).find((t) => t.key.endsWith(":fsa_ids"))!;
  assert.deepEqual([fsa.window_start, fsa.window_end], [seasonBounds("junior_winter", G)!.start, seasonBounds("junior_winter", G)!.end]);
});

test("carries: a carried entry stays while it applies and goes when it doesn't; a later entry replaces an earlier one", () => {
  const empty = generate(input(MID.senior_fall)).map((t) => t.key);
  assert.ok(empty.includes(`${LIST}:playbook:profile`), "no profile in senior fall: the freshman move carries");
  assert.ok(empty.includes(`${LIST}:playbook:long_list`), "an empty list carries");
  const withList = generate(input(MID.senior_fall, { items: [item()] })).map((t) => t.key);
  assert.ok(!withList.includes(`${LIST}:playbook:long_list`), "a list with a college: the long-list move goes");
  // The walk-away number replaces the money talk once both apply.
  const winter = generate(input(MID.junior_winter)).map((t) => t.key);
  assert.ok(winter.includes(`${LIST}:playbook:walk_away`) && !winter.includes(`${LIST}:playbook:money_talk`));
  assert.ok(generate(input(MID.freshman)).some((t) => t.key.endsWith(":money_talk")));
  const limit: StudentProfileData = { ...emptyProfile(), preferences: { ...emptyProfile().preferences, maxAverageCost: 30_000 } };
  assert.ok(!generate(input(MID.junior_winter, { profile: limit })).some((t) => t.key.endsWith(":walk_away") || t.key.endsWith(":money_talk")));
});

test("built cycle entries win: the course choice isn't generated where the student's cycle has choose_courses_*", () => {
  // Class of 2028 (cycle 2027-28 has choose_courses_2027): junior winter's course choice is the cycle task.
  assert.ok(!generate(input(MID.junior_winter)).some((t) => t.key.endsWith(":junior_choose_courses")));
  // Class of 2030 (cycle 2029-30, not in the file yet): a freshman gets the playbook's.
  const freshman = generate(input("2026-11-15", {}, 2030));
  assert.equal(freshman.find((t) => t.key.endsWith(":freshman_choose_courses"))?.window_start, "2027-02-01");
});

test("idempotent: merging the regenerated moves a second time writes nothing (action compared by content)", () => {
  const inp = input(MID.junior_fall, { items: [item()], schools: { "100": { links: { price_calculator: "https://npc.example.edu", visit: "https://visit.example.edu" }, distanceMiles: 12 } as never } });
  const first = generateTasks(inp);
  const stored = applyMerge(LIST, [], mergeTasks([], first), NOW, (k) => `id:${k}`);
  // jsonb reorders keys: a stored action with its keys in another order is the same action.
  const reordered = stored.map((t) => (t.action ? { ...t, action: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(t.action).reverse()))) } : t));
  const again = mergeTasks(reordered, generateTasks(inp));
  assert.deepEqual(again, { upserts: [], orphans: [] });
  assert.ok(first.some((t) => t.action?.kind === "href"), "the net price move links the calculator");
});

test("student lists only; registered last so a built generator's key wins", () => {
  const guardian = input(MID.junior_fall, { list: { ...input(MID.junior_fall).list, student_id: null, user_id: "u1" } });
  assert.deepEqual(generate(guardian), []);
  assert.equal(GENERATORS.at(-1)?.name, "season");
});

const FACTS: MoveFacts = { items: [], schools: {}, profile: null, visits: [], estimates: {}, edCandidates: [], shapeGaps: [], interest: [] };

test("moveApplies: every vocabulary value", () => {
  const p = emptyProfile();
  const dream = item({ dream: true });
  const cases: Record<MoveApplies, [Partial<MoveFacts>, boolean][]> = {
    always: [[{}, true]],
    has_dream: [[{}, false], [{ items: [dream] }, true]],
    no_dream: [[{}, true], [{ items: [dream] }, false]],
    list_empty: [[{}, true], [{ items: [item()] }, false]],
    list_nonempty: [[{}, false], [{ items: [item()] }, true]],
    "profile_missing:high_school": [[{ profile: p }, true], [{ profile: { ...p, basics: { ...p.basics, highSchool: "Central High" } } }, false]],
    "profile_missing:courses": [[{ profile: p }, true]],
    "profile_missing:grades": [[{ profile: p }, true]],
    "profile_missing:test": [[{ profile: p }, true], [{ profile: { ...p, tests: { ...p.tests, focus: "none" } } }, false]],
    "profile_missing:clubs": [[{ profile: p }, true]],
    "profile_missing:sports": [[{ profile: p }, true]],
    "profile_missing:major": [[{ profile: p }, true], [{ profile: { ...p, plans: { ...p.plans, intendedMajors: ["14"] as never } } }, false]],
    "profile_missing:work": [[{ profile: p }, true]],
    "profile_missing:other": [[{ profile: p }, true]],
    "profile_missing:state": [[{ profile: p }, true], [{ profile: { ...p, basics: { ...p.basics, stateOfResidence: "OH" } } }, false]],
    story_missing: [
      [{ profile: p }, true],
      [{ profile: { ...p, story: { about: "a", thread: "b", majorWhy: "", updatedAt: null } } }, false],
      [{ profile: { ...p, plans: { ...p.plans, intendedMajors: ["14"] as never }, story: { about: "a", thread: "b", majorWhy: "", updatedAt: null } } }, true],
    ],
    no_visit_logged: [[{}, true], [{ items: [item({ visited_on: "2027-03-01" })] }, false]],
    tests_focus_null: [[{ profile: p }, true], [{ profile: { ...p, tests: { ...p.tests, focus: "sat" } } }, false]],
    test_unplanned: [
      [{ profile: p }, false],
      [{ profile: { ...p, tests: { ...p.tests, focus: "sat" } } }, true],
      [{ profile: { ...p, tests: { ...p.tests, focus: "sat", plannedDates: ["sat_2027_03"] } } }, false],
    ],
    ed_candidate: [[{}, false], [{ edCandidates: [{ itemId: "i", unitId: "1", round: "ed", rank: 1, level: "reach", dream: false, dismissed: false }] }, true]],
    interest_candidate: [[{}, false], [{ interest: [{ itemId: "i", rule: "important", kind: "show_interest" }] }, true]],
    shape_gap: [[{}, false], [{ shapeGaps: [{ kind: "likely_min", level: "likely", who: "student", line: "x" }] }, true]],
    cost_limit_unset: [[{ profile: p }, true], [{ profile: { ...p, preferences: { ...p.preferences, maxAverageCost: 20_000 } } }, false]],
    profile_incomplete: [[{ profile: null }, true], [{ profile: p }, true]],
  };
  assert.deepEqual(Object.keys(cases).sort(), [...MOVE_APPLIES].sort(), "every value is tested");
  for (const [a, rows] of Object.entries(cases) as [MoveApplies, [Partial<MoveFacts>, boolean][]][]) {
    for (const [facts, want] of rows) assert.equal(moveApplies(a, { ...FACTS, ...facts }), want, `${a} ${JSON.stringify(facts).slice(0, 80)}`);
  }
});

test("a has_dream entry appears only with a Dream", () => {
  const planted: PlaybookEntry = { key: "dream_visit", season: "junior_fall", title: "Visit your Dream", why: "A visit.", who: "student", carries: false, applies: "has_dream", action: () => null, source: "list" };
  const book = [...PLAYBOOK, planted];
  const has = (items: PlanItem[]) => generateFrom(input(MID.junior_fall, { items }), book).some((t) => t.key.endsWith(":dream_visit"));
  assert.equal(has([item()]), false);
  assert.equal(has([item({ dream: true })]), true);
  assert.equal(has([item({ dream: true, withdrawn_on: "2026-10-01" })]), false, "a withdrawn Dream doesn't count");
  assert.ok(entriesFor("junior_fall", book).includes(planted));
});
