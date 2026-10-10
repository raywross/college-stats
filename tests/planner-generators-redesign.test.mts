/**
 * The redesign's two changed generators (U6; specs/planner/redesign/build-plan.md "As built by U1" and "U6";
 * rounds.md "Money"; scores.md "Test dates"): `lib/planner/generators/rounds.ts` drops `decide_rounds` for a
 * `cost_check` task on a binding row, and `lib/planner/generators/cycle.ts` only makes a test-date task once the
 * student picks it. Pure; no I/O. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generate as roundsGen, COST_CHECK_LEAD_DAYS } from "../lib/planner/generators/rounds.ts";
import { generate as cycleGen } from "../lib/planner/generators/cycle.ts";
import { applyMerge, generateTasks, mergeTasks, taskKey } from "../lib/planner/tasks.ts";
import { loadCycle } from "../lib/planner/cycle.ts";
import { emptyProfile } from "../lib/student-profile.ts";
import type { GeneratorInput, PlanItem, PlanSchool } from "../lib/planner/types.ts";
import type { StudentProfileData } from "../lib/student-profile.ts";

const LIST = "11111111-1111-4111-8111-111111111111";
const ITEM_A = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-10-08T12:00:00Z";
const TODAY = "2026-10-08";

function item(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: ITEM_A,
    list_id: LIST,
    unit_id: "100",
    category: "target",
    status: "considering",
    outcome: null,
    round: "ed",
    position: 0,
    added_by: null,
    added_at: NOW,
    decision_date: null,
    deadline_text: null,
    deadline_date: null,
    enrolling: false,
    updates: true,
    visited_on: null,
    follows_social: false,
    dream: false,
    priority: null,
    followed_networks: [],
    info_requested_on: null,
    application_platform: null,
    applied_on: null,
    complete_on: null,
    portal_url: null,
    committed_on: null,
    withdrawn_on: null,
    recommendations_count: null,
    supplements_count: null,
    transcript_shared: true,
    category_source: "auto",
    round_source: "student",
    ...over,
  } as PlanItem;
}

/** A college with a published ED closing date and a net price calculator. */
function school(over: Partial<PlanSchool> = {}): PlanSchool {
  return {
    unit_id: "100",
    name: "Wake Forest",
    city: "Winston-Salem",
    state: "NC",
    admitRate: 0.22,
    admitRateCite: null,
    avgCost: 25000,
    avgCostCite: null,
    sticker: null,
    distanceMiles: null,
    links: { website: "https://wfu.edu", price_calculator: "https://wfu.edu/npc", admissions: "https://wfu.edu/admissions" } as PlanSchool["links"],
    social: null,
    profile: {
      early_decision: { offered: true, first: { closing: { month: 11, day: 15 }, notification: { month: 12, day: 15 } }, applicants: null, admitted: null },
      early_action: { offered: true, closing: { month: 11, day: 1 }, notification: { month: 1, day: 31 }, restrictive: false },
    },
    logistics: {
      cycle: "Fall 2027",
      edition: "2026-27",
      fee: null,
      regular_closing: { month: 1, day: 15 },
      priority_date: null,
      other_terms: null,
      notification: { kind: "by_date", rolling_from: null, by_date: { month: 4, day: 1 }, other_date: null, other_text: null },
      reply: null,
      housing_deposit: null,
      deferred_admission: null,
    },
    aid: null,
    testPolicy: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    gpaAverage: null,
    standing: {} as PlanSchool["standing"],
    ...over,
  } as PlanSchool;
}

const cycle2026 = loadCycle("2026-27");

function input(over: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: NOW, sort: null, rounds_plan_accepted_at: null },
    items: [item()],
    schools: { "100": school() },
    profile: null,
    cycle: cycle2026,
    grade: "senior_fall",
    today: TODAY,
    visits: [],
    offers: [],
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Rounds generator: cost_check, not decide_rounds                     */
/* ------------------------------------------------------------------ */

test("rounds generator no longer emits decide_rounds; it emits cost_check for a binding row", () => {
  const tasks = roundsGen(input());
  assert.ok(!tasks.some((t) => t.kind === "decide_rounds"), "decide_rounds is retired");
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.kind, "cost_check");
  assert.equal(t.key, taskKey(LIST, "cost_check", `${ITEM_A}:ed`));
  assert.equal(t.item_id, ITEM_A);
  assert.equal(t.title, "Check the cost of Wake Forest together before applying ED I");
  assert.equal(t.assignee, "guardian");
  assert.equal(t.source, "stage");
  assert.equal(COST_CHECK_LEAD_DAYS, 21);
  assert.equal(t.due_on, "2026-10-25", "Nov 15 minus 21 days");
  assert.match(t.detail!, /net price calculator/);
  assert.match(t.detail!, /https:\/\/wfu\.edu\/npc/);
});

test("cost_check: nothing for EA/RD rows, applied/decided rows, withdrawn rows, or without a published closing date", () => {
  assert.deepEqual(roundsGen(input({ items: [item({ round: "ea" })] })), [], "EA isn't binding");
  assert.deepEqual(roundsGen(input({ items: [item({ status: "applied" })] })), [], "already applied");
  assert.deepEqual(roundsGen(input({ items: [item({ status: "decided", outcome: "admitted" })] })), [], "already decided");
  assert.deepEqual(roundsGen(input({ items: [item({ withdrawn_on: "2026-09-01" })] })), [], "withdrawn");
  const noDate = school({ profile: { early_decision: { offered: true, applicants: null, admitted: null } } });
  assert.deepEqual(roundsGen(input({ schools: { "100": noDate } })), [], "no published ED closing date");
  assert.deepEqual(roundsGen(input({ list: { ...input().list, student_id: null } })), [], "a guardian's own list");
});

test("cost_check: moving the item's round from ED to EA orphans it through mergeTasks", () => {
  const edInput = input({ items: [item({ round: "ed" })] });
  const firstGenerated = generateTasks(edInput);
  const costCheckKey = taskKey(LIST, "cost_check", `${ITEM_A}:ed`);
  assert.ok(firstGenerated.some((t) => t.key === costCheckKey), "the ED row starts with a cost_check");

  const firstMerge = mergeTasks([], firstGenerated);
  const stored = applyMerge(LIST, [], firstMerge, NOW, (k) => `id:${k}`);
  assert.ok(stored.some((t) => t.key === costCheckKey && !t.orphaned));

  // The family moves the row to EA.
  const eaInput = input({ items: [item({ round: "ea" })] });
  const secondGenerated = generateTasks(eaInput);
  assert.ok(!secondGenerated.some((t) => t.key === costCheckKey), "an EA row generates no cost_check");

  const secondMerge = mergeTasks(stored, secondGenerated);
  const orphanedId = stored.find((t) => t.key === costCheckKey)!.id;
  assert.ok(secondMerge.orphans.includes(orphanedId), "the stored cost_check is orphaned, not deleted");

  const after = applyMerge(LIST, stored, secondMerge, NOW);
  const row = after.find((t) => t.key === costCheckKey)!;
  assert.equal(row.orphaned, true);
  assert.equal(mergeTasks(after, secondGenerated).upserts.length, 0, "running the EA generation again changes nothing further");
});

/* ------------------------------------------------------------------ */
/* Cycle generator: picked test dates only                             */
/* ------------------------------------------------------------------ */

const withPlanned = (dates: string[], extraTests: Partial<StudentProfileData["tests"]> = {}): StudentProfileData => {
  const p = emptyProfile();
  return { ...p, tests: { ...p.tests, plannedDates: dates, ...extraTests } };
};

test("cycle generator: an untapped test date produces nothing — no register task, no test-day task, no task at all", () => {
  const tasks = cycleGen(input({ profile: null }));
  assert.ok(!tasks.some((t) => /:(sat|act)_/.test(t.key)), "no profile, no planned dates: no test-date tasks");

  const withOtherDatePlanned = cycleGen(input({ profile: withPlanned(["act_2026_10"]) }));
  assert.ok(!withOtherDatePlanned.some((t) => t.key.endsWith(":sat_2026_11")), "sat_2026_11 wasn't picked");
  assert.ok(withOtherDatePlanned.some((t) => t.key === taskKey(LIST, "test_register", "act_2026_10")), "act_2026_10 was picked");
});

test("cycle generator: 'I'll take it' makes a register task and a test-day task, keyed distinctly, due on their own dates", () => {
  const profile = withPlanned(["sat_2026_11"]);
  const tasks = cycleGen(input({ profile }));
  const register = tasks.find((t) => t.key === taskKey(LIST, "test_register", "sat_2026_11"))!;
  assert.ok(register, "a register task exists");
  assert.equal(register.kind, "test_register");
  assert.equal(register.title, "Register for the SAT on Nov 7");
  assert.equal(register.due_on, "2026-10-23");
  const day = tasks.find((t) => t.key === taskKey(LIST, "test_day", "sat_2026_11"))!;
  assert.ok(day, "a test-day task exists");
  assert.equal(day.kind, "test_day");
  assert.equal(day.title, "SAT test day");
  assert.equal(day.due_on, "2026-11-07");
  assert.notEqual(register.key, day.key, "distinct keys per kind");
});

test("cycle generator: test-optional drops every test date even when one was picked", () => {
  const profile = withPlanned(["sat_2026_11"], { plansTestOptional: true });
  const tasks = cycleGen(input({ profile }));
  assert.ok(!tasks.some((t) => /:(sat|act)_/.test(t.key)));
});
