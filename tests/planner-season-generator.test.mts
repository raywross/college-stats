/**
 * The season generator (lib/planner/generators/season.ts; seasons.md "What a late joiner sees"): a late joiner in each
 * season sees only that season's entries, next season's, and earlier carried ones; nothing dated before the join is
 * overdue; carries; idempotent on regeneration; `moveApplies` for every vocabulary value; a `has_dream` entry only
 * with a Dream; built cycle entries win; registered last. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { belowTarget, entriesFor, fillTitle, generate, generateFrom, MOVE_APPLIES, moveApplies, type MoveApplies, type MoveFacts } from "../lib/planner/generators/season.ts";
import { GENERATORS } from "../lib/planner/generators/index.ts";
import { MOVE_TEXT, PLAYBOOK, playbookEntryFor, SEASON_EXPLAINER, type PlaybookEntry } from "../lib/planner/moves-catalog.ts";
import { gradeOf, nextSeason, seasonBounds, seasonOf, seasonRank, SEASONS, type Season } from "../lib/planner/seasons.ts";
import { loadCycle, cycleFor } from "../lib/planner/cycle.ts";
import { addDays } from "../lib/planner/stage.ts";
import { applyMerge, generateTasks, mergeTasks, taskDate } from "../lib/planner/tasks.ts";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { GeneratorInput, PlanItem, PlanTask } from "../lib/planner/types.ts";
import { numberProblems } from "./helpers/copy-guard.mts";

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

const FACTS: MoveFacts = { items: [], schools: {}, profile: null, visits: [], estimates: {}, edCandidates: [], shapeGaps: [], interest: [], counts: null };
let recN = 0;
const rec = (status: "thinking" | "asked" | "agreed" | "invited") => ({ id: `r${++recN}`, name: `Teacher ${recN}`, subject: null, courseId: null, years: [11 as const], rank: recN, status, askedOn: null, agreedOn: null, invitedOn: null });

/** Every record section in except story and recommenders. */
function recordFull(p: StudentProfileData): StudentProfileData {
  return {
    ...p,
    basics: { ...p.basics, highSchool: "Central High", stateOfResidence: "OH" },
    academics: {
      ...p.academics,
      gpa: 3.6,
      classStanding: "top25",
      courses: [{ id: "c1" } as never],
      activitiesNone: { sports: true, clubs: true, work: true, other: true, connections: true },
    },
    tests: { ...p.tests, focus: "none" },
    plans: { ...p.plans, intendedMajors: ["14"] },
    preferences: { ...p.preferences, sizes: ["small"] },
  };
}

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
    // Plan v3 (connections.md): an entry or a None answer counts (profile-progress.ts sectionDone("connections")).
    "profile_missing:connections": [
      [{ profile: p }, true],
      [{ profile: { ...p, academics: { ...p.academics, connections: [{ id: "c1", unitId: "100654", family: ["parent"] as const, recruited: "none" as const }] } } }, false],
      [{ profile: { ...p, academics: { ...p.academics, activitiesNone: { ...p.academics.activitiesNone, connections: true } } } }, false],
    ],
    "profile_missing:other": [[{ profile: p }, true]],
    // Your record (review note 6): `state` folded into `basics`; where, story, and recommenders are sections too.
    "profile_missing:basics": [
      [{ profile: p }, true],
      [{ profile: { ...p, basics: { ...p.basics, stateOfResidence: "OH" } } }, false],
      [{ profile: { ...p, basics: { ...p.basics, feeWaiverEligible: false } } }, false],
    ],
    "profile_missing:where": [[{ profile: p }, true], [{ profile: { ...p, preferences: { ...p.preferences, settings: ["town"] } } }, false]],
    "profile_missing:story": [[{ profile: p }, true], [{ profile: { ...p, story: { narrative: "a".repeat(200), updatedAt: null } } }, false]],
    "profile_missing:recommenders": [[{ profile: p }, true], [{ profile: { ...p, recommenders: [rec("thinking")] } }, false]],
    story_missing: [
      [{ profile: p }, true],
      [{ profile: { ...p, story: { narrative: "a".repeat(200), updatedAt: null } } }, false],
      [{ profile: { ...p, story: { narrative: "a".repeat(199), updatedAt: null } } }, true],
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
    // Story and recommenders never hold the profile move open (they have their own moves).
    profile_incomplete: [[{ profile: null }, true], [{ profile: p }, true], [{ profile: recordFull(p) }, false], [{ profile: { ...recordFull(p), plans: { ...p.plans, intendedMajors: [] } } }, true]],
    no_real_score: [
      [{ profile: null }, true],
      [{ profile: p }, true],
      [{ profile: { ...p, tests: { ...p.tests, satTotal: 1200, practice: true } } }, true],
      [{ profile: { ...p, tests: { ...p.tests, satTotal: 1200, practice: false } } }, false],
      [{ profile: { ...p, tests: { ...p.tests, actComposite: 27, practice: false } } }, false],
    ],
    below_target: [
      [{ profile: null }, false],
      [{ profile: { ...p, tests: { ...p.tests, focus: "sat", satTotal: 1200, target: 1400 } } }, true],
      [{ profile: { ...p, tests: { ...p.tests, focus: "sat", satTotal: 1200, practice: true, target: 1400 } } }, true],
      [{ profile: { ...p, tests: { ...p.tests, focus: "sat", satTotal: 1400, target: 1400 } } }, false],
      [{ profile: { ...p, tests: { ...p.tests, focus: "sat", satTotal: null, target: 1400 } } }, false],
      [{ profile: { ...p, tests: { ...p.tests, focus: "act", actComposite: 25, target: 30 } } }, true],
      [{ profile: { ...p, tests: { ...p.tests, focus: "none", satTotal: 1200, target: null } } }, false],
    ],
    recommenders_open: [
      [{ profile: null }, true],
      [{ profile: { ...p, recommenders: [rec("asked"), rec("thinking")] } }, true],
      [{ profile: { ...p, recommenders: [rec("asked"), rec("invited")] } }, false],
    ],
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

/* ------------------------------------------------------------------ */
/* Plan v3: no practice test with a real score; reach_score; recommenders */
/* ------------------------------------------------------------------ */

const PSAT_KEYS = ["freshman_psat_practice", "sophomore_psat_practice", "psat_nmsqt"];
const keysIn = (season: Exclude<Season, "unknown">, profile: StudentProfileData | null) => generate(input(MID[season], { profile })).map((t) => playbookEntryFor(t.key)?.key ?? t.key);
/** The October day of each PSAT season (the entry is dated October; MID is November). */
const OCT: Record<"freshman" | "sophomore" | "junior_fall", string> = { freshman: "2024-10-05", sophomore: "2025-10-05", junior_fall: "2026-10-05" };

test("a student with a real SAT or ACT score gets no PSAT move in any season; a practice-only student does", () => {
  const p = emptyProfile();
  const real: StudentProfileData = { ...p, tests: { ...p.tests, focus: "sat", satTotal: 1250, practice: false } };
  const realAct: StudentProfileData = { ...p, tests: { ...p.tests, focus: "act", actComposite: 28, practice: false } };
  const practice: StudentProfileData = { ...p, tests: { ...p.tests, focus: "sat", satTotal: 1100, practice: true } };
  for (const [season, day] of Object.entries(OCT) as ["freshman" | "sophomore" | "junior_fall", string][]) {
    const want = season === "junior_fall" ? "psat_nmsqt" : `${season}_psat_practice`;
    const gen = (profile: StudentProfileData | null) => generate(input(day, { profile })).map((t) => playbookEntryFor(t.key)?.key);
    assert.ok(gen(practice).includes(want), `${season}: a practice-only student gets ${want}`);
    assert.ok(gen(null).includes(want), `${season}: no profile yet, the move shows`);
    assert.ok(!gen(real).includes(want), `${season}: a real SAT means no ${want}`);
    assert.ok(!gen(realAct).includes(want), `${season}: a real ACT means no ${want}`);
  }
  for (const season of Object.keys(MID) as Exclude<Season, "unknown">[]) {
    assert.ok(!keysIn(season, real).some((k) => PSAT_KEYS.includes(k)), season);
  }
  for (const k of PSAT_KEYS) assert.equal(PLAYBOOK.find((e) => e.key === k)?.applies, "no_real_score", k);
});

test("reach_score: one entry per season junior fall to senior fall; only below the target; the title filled; none without a target", () => {
  const seasons = ["junior_fall", "junior_winter", "junior_spring", "summer_before_senior", "senior_fall"] as const;
  assert.deepEqual(PLAYBOOK.filter((e) => e.key.startsWith("reach_score_")).map((e) => e.key), seasons.map((s) => `reach_score_${s}`));
  const p = emptyProfile();
  const below: StudentProfileData = { ...p, tests: { ...p.tests, focus: "sat", satTotal: 1250, target: 1400 } };
  const atTarget: StudentProfileData = { ...p, tests: { ...p.tests, focus: "sat", satTotal: 1400, target: 1400 } };
  const noTarget: StudentProfileData = { ...p, tests: { ...p.tests, focus: "sat", satTotal: 1250, target: null } };
  for (const s of seasons) {
    const t = generate(input(MID[s], { profile: below })).find((x) => x.key === `${LIST}:playbook:reach_score_${s}`);
    assert.ok(t, `${s}: generated below the target`);
    assert.equal(t.title, "Work toward your 1400", "the student's own target fills the title");
    assert.equal(t.assignee, "student");
    assert.equal(t.action, null, "the guide is the button");
    assert.ok(!generate(input(MID[s], { profile: atTarget })).some((x) => x.key.includes(":reach_score_")), `${s}: not at the target`);
    assert.ok(!generate(input(MID[s], { profile: noTarget })).some((x) => x.key.includes(":reach_score_")), `${s}: not without a target`);
  }
  // Only the current season's entry (it doesn't carry), plus next season's for Coming up.
  const fall = generate(input(MID.junior_fall, { profile: below })).filter((x) => x.key.includes(":reach_score_")).map((x) => x.key);
  assert.deepEqual(fall, [`${LIST}:playbook:reach_score_junior_fall`, `${LIST}:playbook:reach_score_junior_winter`]);
});

test("fillTitle: {target} filled from the profile; a title with an unfilled placeholder is never emitted", () => {
  const p = emptyProfile();
  assert.equal(fillTitle("Work toward your {target}", { tests: { ...p.tests, target: 31 } }), "Work toward your 31");
  assert.equal(fillTitle("Work toward your {target}", { tests: { ...p.tests, target: null } }), null);
  assert.equal(fillTitle("Work toward your {target}", null), null);
  assert.equal(fillTitle("Visit {college}", null), null, "any placeholder left over is refused");
  assert.equal(fillTitle("Pick your recommenders", null), "Pick your recommenders");
  // Planted: an entry whose target placeholder can't be filled is skipped by the generator, not shown with braces.
  const planted: PlaybookEntry = { key: "planted_target", season: "junior_fall", title: "Aim for {target}", why: "A planted entry.", who: "student", carries: false, applies: "always", action: () => null, source: "advisors" };
  const out = generateFrom(input(MID.junior_fall), [...PLAYBOOK, planted]);
  assert.ok(!out.some((t) => t.key.endsWith(":planted_target")));
  assert.ok(!out.some((t) => /\{/.test(t.title)), "no generated title carries a brace");
});

test("belowTarget reads the focus test's score only", () => {
  const p = emptyProfile();
  assert.equal(belowTarget({ tests: { ...p.tests, focus: "act", satTotal: 1000, actComposite: null, target: 30 } }), false, "an SAT score doesn't count when the focus is the ACT");
  assert.equal(belowTarget({ tests: { ...p.tests, focus: "act", actComposite: 29, target: 30 } }), true);
});

test("pick_recommenders: junior spring, carries, not in junior fall; closes at two asked; notice_teachers is gone", () => {
  const entry = PLAYBOOK.find((e) => e.key === "pick_recommenders");
  assert.ok(entry);
  assert.equal(entry.season, "junior_spring");
  assert.equal(entry.carries, true);
  assert.equal(entry.applies, "recommenders_open");
  assert.ok(!PLAYBOOK.some((e) => e.key === "notice_teachers"));
  const key = `${LIST}:playbook:pick_recommenders`;
  const p = emptyProfile();
  // Junior fall: not this season's, not next season's (junior winter), so not generated at all.
  assert.ok(!generate(input(MID.junior_fall)).some((t) => t.key === key), "not in junior fall");
  assert.ok(generate(input(MID.junior_spring)).some((t) => t.key === key), "in junior spring");
  assert.ok(generate(input(MID.senior_fall)).some((t) => t.key === key), "carries into senior fall while open");
  const oneAsked: StudentProfileData = { ...p, recommenders: [rec("asked"), rec("thinking")] };
  const twoAsked: StudentProfileData = { ...p, recommenders: [rec("asked"), rec("agreed")] };
  assert.ok(generate(input(MID.junior_spring, { profile: oneAsked })).some((t) => t.key === key), "one asked: still open");
  assert.ok(!generate(input(MID.junior_spring, { profile: twoAsked })).some((t) => t.key === key), "two asked: closed");
});

test("the story move's why and the junior-fall explainer (plan v3)", () => {
  const story = PLAYBOOK.find((e) => e.key === "story")!;
  assert.equal(story.why, "One page in your own words. The counselor's questionnaire and the essay both start from it.");
  assert.equal(MOVE_TEXT.story.why, story.why);
  assert.doesNotMatch(SEASON_EXPLAINER.junior_fall.paragraph, /Notice the teachers/);
  assert.match(SEASON_EXPLAINER.junior_fall.paragraph, /Write your story while there's no deadline\./);
  assert.match(SEASON_EXPLAINER.junior_spring.paragraph, /asking two teachers before summer/);
});

test("the profile move's title follows the first missing section, not the generic 'Fill in your numbers and courses' (plan-v3-fix-cards)", () => {
  const p = emptyProfile();
  const titleOf = (profile: StudentProfileData) => generate(input(MID.freshman, { profile })).find((t) => t.key === `${LIST}:playbook:profile`)?.title;

  // Nothing entered at all: the first section, high school.
  assert.equal(titleOf(p), "Add your high school");

  // High school in, nothing else: grades (Your record's order, review note 6).
  const withHighSchool: StudentProfileData = { ...p, basics: { ...p.basics, highSchool: "Central High" } };
  assert.equal(titleOf(withHighSchool), "Add your grades");

  // High school and courses in, GPA entered but no class standing yet: the swapped wording, not "Add your grades".
  const withGpaOnly: StudentProfileData = {
    ...withHighSchool,
    academics: { ...withHighSchool.academics, courses: [{ id: "c1", name: "AP Biology", subject: "science", year: 10, kind: "ap" } as never], gpa: 3.8 },
  };
  assert.equal(titleOf(withGpaOnly), "Add your class standing");

  // Your record's new sections name themselves; story and recommenders never do (the move is gone once the rest is in).
  const all = recordFull(p);
  assert.equal(titleOf({ ...all, plans: { ...all.plans, intendedMajors: [] } }), "Add a major");
  assert.equal(titleOf({ ...all, basics: { ...all.basics, stateOfResidence: null } }), "Add a few basics");
  assert.equal(titleOf({ ...all, preferences: { ...all.preferences, sizes: [] } }), "Add where you'd go");
  assert.equal(titleOf(all), undefined, "story and recommenders missing: no profile move");

  // None of the generated titles carry a digit (the catalog's words guard, extended to this dynamic title).
  for (const title of [titleOf(p), titleOf(withHighSchool), titleOf(withGpaOnly)]) {
    assert.ok(title && numberProblems(title).length === 0, title);
  }
});
