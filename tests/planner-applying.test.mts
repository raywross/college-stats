/**
 * U5 Applying (specs/planner/next-steps/applying.md): the four new moves' windows — `confirm_complete`
 * (generators/apply.ts), `compare_offers` and `decide_by` (generators/offers.ts) — the `outcome_share` move's
 * once-emitted, dismiss-persists behavior (generators/offers.ts + mergeTasks), a deferral keeping `ed2_conditional`
 * (the built college generator), the Offers tab appearing after the first decision (plan-tabs.ts, already built),
 * and the row's status word showing only from senior fall (list-row.ts + seasons.ts). Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generate as applyGen } from "../lib/planner/generators/apply.ts";
import { generate as offersGen } from "../lib/planner/generators/offers.ts";
import { generate as collegeGen } from "../lib/planner/generators/college.ts";
import { mergeTasks, taskKey } from "../lib/planner/tasks.ts";
import { tabsFor } from "../lib/planner/plan-tabs.ts";
import { seasonRank } from "../lib/planner/seasons.ts";
import { SEASON_STATUS_LABEL } from "../lib/planner/list-row.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool, PlanTask } from "../lib/planner/types.ts";

const LIST = "11111111-1111-4111-8111-111111111111";
const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const NOW = "2027-04-20T12:00:00Z";
const TODAY = "2027-04-20";

const item = (n: number, over: Partial<PlanItem> = {}): PlanItem =>
  ({
    id: ID(n),
    list_id: LIST,
    unit_id: String(100 + n),
    category: "target",
    status: "applied",
    outcome: null,
    round: "rd",
    position: n,
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
    round_source: "auto",
    legacy: false,
    recruited: null,
    ...over,
  }) as PlanItem;

const school = (n: number, name: string, over: Partial<PlanSchool> = {}): PlanSchool =>
  ({
    unit_id: String(100 + n),
    name,
    city: null,
    state: null,
    admitRate: null,
    admitRateCite: null,
    avgCost: null,
    avgCostCite: null,
    sticker: null,
    distanceMiles: null,
    links: null,
    social: null,
    profile: null,
    logistics: { cycle: "Fall 2027", edition: "2026-27", fee: null, regular_closing: null, priority_date: null, other_terms: null, notification: null, reply: null, housing_deposit: null, deferred_admission: null },
    aid: null,
    testPolicy: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    gpaAverage: null,
    standing: {} as PlanSchool["standing"],
    poolSchool: {} as PlanSchool["poolSchool"],
    ...over,
  }) as PlanSchool;

function input(items: PlanItem[], schools: Record<string, PlanSchool>, over: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "List", is_default: true, share_enabled: false, created_by: null, created: NOW, sort: null, rounds_plan_accepted_at: null } as GeneratorInput["list"],
    items,
    schools,
    profile: null,
    cycle: { cycle: "2026-27", startYear: 2026, entries: [] },
    grade: "senior_spring",
    today: TODAY,
    visits: [],
    offers: [],
    gradYear: 2027,
    season: "senior_spring",
    estimates: {},
    ...over,
  };
}

const kinds = (tasks: GeneratedTask[], kind: string) => tasks.filter((t) => t.kind === kind);

/* ------------------------------------------------------------------ */
/* confirm_complete (generators/apply.ts)                              */
/* ------------------------------------------------------------------ */

test("confirm_complete: 7 days after applied_on, while complete_on is null", () => {
  const s = { [school(1, "Michigan").unit_id]: school(1, "Michigan") };
  const applied = item(1, { status: "applied", applied_on: "2027-04-01", complete_on: null });
  const tasks = applyGen(input([applied], s, { today: "2027-04-20" }));
  const move = kinds(tasks, "confirm_complete")[0];
  assert.ok(move, "confirm_complete is generated once applied and not yet complete");
  assert.equal(move.due_on, "2027-04-08");
  assert.match(move.title, /Michigan/);
});

test("confirm_complete: not generated before applied_on, and gone once complete_on is set", () => {
  const s = { [school(1, "Michigan").unit_id]: school(1, "Michigan") };
  const notApplied = item(1, { status: "applying", applied_on: null, complete_on: null });
  assert.equal(kinds(applyGen(input([notApplied], s)), "confirm_complete").length, 0, "not yet applied: no move");

  const applied = item(1, { status: "applied", applied_on: "2027-04-01", complete_on: null });
  assert.equal(kinds(applyGen(input([applied], s)), "confirm_complete").length, 1, "applied, not complete: the move shows");

  const complete = item(1, { status: "applied", applied_on: "2027-04-01", complete_on: "2027-04-10" });
  assert.equal(kinds(applyGen(input([complete], s)), "confirm_complete").length, 0, "complete_on set: the move is gone");
});

/* ------------------------------------------------------------------ */
/* compare_offers (generators/offers.ts)                               */
/* ------------------------------------------------------------------ */

test("compare_offers: once two colleges are admitted with an offer entered, from March 1 of the cycle's second year", () => {
  const s = { [school(1, "Michigan").unit_id]: school(1, "Michigan"), [school(2, "Duke").unit_id]: school(2, "Duke") };
  const items = [item(1, { status: "decided", outcome: "admitted" }), item(2, { status: "decided", outcome: "admitted" })];
  const offers = [{ id: "o1", item_id: ID(1) } as never, { id: "o2", item_id: ID(2) } as never];

  // Before March 1: not yet.
  assert.equal(kinds(offersGen(input(items, s, { today: "2027-02-20", offers })), "compare_offers").length, 0);
  // From March 1, with two offers entered: shown.
  const march = offersGen(input(items, s, { today: "2027-03-01", offers }));
  assert.equal(kinds(march, "compare_offers").length, 1);
  // Only one offer entered: not yet (the bad case this rule guards against).
  assert.equal(kinds(offersGen(input(items, s, { today: "2027-03-01", offers: offers.slice(0, 1) })), "compare_offers").length, 0);
});

/* ------------------------------------------------------------------ */
/* decide_by (generators/offers.ts)                                    */
/* ------------------------------------------------------------------ */

test("decide_by: from April 1 while no college is enrolling, due the earliest reply date else May 1", () => {
  const reply1 = { kind: "fixed_date" as const, date: { month: 4, day: 15 }, weeks: null, other_text: null };
  const s = {
    [school(1, "Michigan", { logistics: { cycle: "Fall 2027", edition: "2026-27", fee: null, regular_closing: null, priority_date: null, other_terms: null, notification: null, reply: reply1, housing_deposit: null, deferred_admission: null } }).unit_id]:
      school(1, "Michigan", { logistics: { cycle: "Fall 2027", edition: "2026-27", fee: null, regular_closing: null, priority_date: null, other_terms: null, notification: null, reply: reply1, housing_deposit: null, deferred_admission: null } }),
  };
  const items = [item(1, { status: "decided", outcome: "admitted" })];

  // Before April 1: not yet.
  assert.equal(kinds(offersGen(input(items, s, { today: "2027-03-20" })), "decide_by").length, 0);

  // From April 1, due the admitted college's own reply date.
  const move = kinds(offersGen(input(items, s, { today: "2027-04-01" })), "decide_by")[0];
  assert.ok(move, "decide_by shows from April 1");
  assert.equal(move.due_on, "2027-04-15");
  assert.equal(move.title, "Decide by May 1");

  // No published reply date anywhere: falls back to May 1 of the cycle's second year.
  const noReply = { [school(1, "Michigan").unit_id]: school(1, "Michigan") };
  const fallback = kinds(offersGen(input(items, noReply, { today: "2027-04-01" })), "decide_by")[0];
  assert.equal(fallback.due_on, "2027-05-01");

  // Once a college is enrolling (chosen), the move is gone.
  const chosen = [item(1, { status: "decided", outcome: "admitted", enrolling: true, committed_on: "2027-04-02" })];
  assert.equal(kinds(offersGen(input(chosen, s, { today: "2027-04-10" })), "decide_by").length, 0, "once chosen, decide_by stops");
});

/* ------------------------------------------------------------------ */
/* outcome_share (generators/offers.ts): once, and never again after a dismissal                  */
/* ------------------------------------------------------------------ */

test("outcome_share: generated once a college is enrolling; a dismissal (No thanks) survives regeneration", () => {
  const s = { [school(1, "Michigan").unit_id]: school(1, "Michigan") };
  const notChosen = [item(1, { status: "decided", outcome: "admitted" })];
  assert.equal(kinds(offersGen(input(notChosen, s)), "outcome_share").length, 0, "not generated before a choice");

  const chosen = [item(1, { status: "decided", outcome: "admitted", enrolling: true, committed_on: "2027-04-02" })];
  const generated = offersGen(input(chosen, s));
  const move = kinds(generated, "outcome_share")[0];
  assert.ok(move, "generated once chosen");
  assert.equal(move.key, taskKey(LIST, "outcome_share"));

  // First merge: a fresh row.
  const firstMerge = mergeTasks([], generated);
  const stored: PlanTask[] = firstMerge.upserts.map((u) => ({
    ...u,
    season: u.season ?? null,
    action: u.action ?? null,
    id: `new:${u.key}`,
    list_id: LIST,
    done_at: null,
    done_by: null,
    snoozed_until: null,
    dismissed: false,
    created_by: null,
    created_at: NOW,
  }));

  // "No thanks" dismisses it directly (store.ts dismiss), not through regeneration.
  const dismissedKey = taskKey(LIST, "outcome_share");
  const afterDismiss = stored.map((t) => (t.key === dismissedKey ? { ...t, dismissed: true } : t));

  // Regenerating (the choice is unchanged) proposes the same move again; mergeTasks must not touch the dismissed row.
  const regenerated = offersGen(input(chosen, s));
  const secondMerge = mergeTasks(afterDismiss, regenerated);
  assert.equal(secondMerge.upserts.find((u) => u.key === dismissedKey), undefined, "a dismissed outcome_share isn't re-upserted (dismissed would be reset)");
});

/* ------------------------------------------------------------------ */
/* ed2_conditional carries through a deferral (built: generators/college.ts)                       */
/* ------------------------------------------------------------------ */

test("ed2_conditional: a deferral from ED keeps the ED II line, while an ED II candidate exists on the list", () => {
  const edSchool = school(1, "Early U", {
    profile: { factors: null, early_decision: { offered: true, first: { closing: { month: 11, day: 1 }, notification: { month: 12, day: 15 } }, other: null, applicants: null, admitted: null }, early_action: null } as never,
  });
  const ed2School = school(2, "Second Choice", {
    profile: { factors: null, early_decision: { offered: true, first: null, other: { closing: { month: 1, day: 5 }, notification: { month: 2, day: 15 } }, applicants: null, admitted: null }, early_action: null } as never,
  });
  const edItem = item(1, { round: "ed", outcome: "deferred", status: "applied" });
  const ed2Item = item(2, { round: "ed2", status: "considering" });
  const s = { [edSchool.unit_id]: edSchool, [ed2School.unit_id]: ed2School };
  const tasks = collegeGen(input([edItem, ed2Item], s, { today: "2026-11-15" }));
  const ed2 = kinds(tasks, "ed2_conditional")[0];
  assert.ok(ed2, "ED II at the second college is generated once ED I is deferred");
  assert.equal(ed2.item_id, ed2Item.id);
  assert.match(ed2.title, /Apply ED II/);
  assert.match(ed2.detail ?? "", /didn't say yes, so this one is on/);
});

/* ------------------------------------------------------------------ */
/* The Offers tab appears after the first decision (built: plan-tabs.ts)                            */
/* ------------------------------------------------------------------ */

test("tabsFor: the Offers tab appears only once a decision is recorded", () => {
  assert.deepEqual(tabsFor({ everyone: false, hasDecision: false }), ["next", "colleges", "calendar"]);
  assert.deepEqual(tabsFor({ everyone: false, hasDecision: true }), ["next", "colleges", "calendar", "offers"]);
});

/* ------------------------------------------------------------------ */
/* The row's status word shows only from senior fall on (list-row.ts + seasons.ts)                 */
/* ------------------------------------------------------------------ */

test("the status word's season gate: senior fall and every later season, never earlier", () => {
  const seniorFall = seasonRank("senior_fall");
  const earlier: readonly string[] = ["freshman", "sophomore", "junior_fall", "junior_winter", "junior_spring", "summer_before_senior"];
  const fromSeniorFall: readonly string[] = ["senior_fall", "senior_winter", "senior_spring", "summer_after", "graduated"];
  for (const s of earlier) assert.ok(seasonRank(s as never) < seniorFall, `${s} is before senior fall`);
  for (const s of fromSeniorFall) assert.ok(seasonRank(s as never) >= seniorFall, `${s} shows the status word`);
  // The label set PlanList.tsx reads from (list-row.ts), sanity-checked here too.
  assert.equal(SEASON_STATUS_LABEL.submitted, "Submitted");
});
