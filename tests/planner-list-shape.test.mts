/**
 * The list's shape (lib/planner/list-shape.ts; specs/planner/next-steps/list-shape.md): every gap in priority
 * order, each season's shape, the three affordability states, unsorted rows excluded from the counts and given
 * their own move, one move at a time with the next appearing once the first resolves (via mergeTasks orphaning),
 * `balanceLineFor` and `shapeTasks` agreeing. A guard that no balance/move line carries a closeness number or a
 * percentage. The rail these moves used to open became the Build your list guide (plan v3; its ordering, the cost
 * exclusion, and its card's fields are tested in tests/planner-list-guide.test.mts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affordabilityFor,
  countLine,
  dreamAtHighReach,
  LIST_SHAPE,
  listGapTitle,
  shapeFor,
  shapeGaps,
  shapeTasks,
  unsortedLine,
  type Shape,
} from "../lib/planner/list-shape.ts";
import { balanceLineFor } from "../lib/planner/plan-view.ts";
import { gradeOf, type Season } from "../lib/planner/seasons.ts";
import { mergeTasks, applyMerge } from "../lib/planner/tasks.ts";
import { loadCycle, cycleFor } from "../lib/planner/cycle.ts";
import type { GeneratorInput, PlanItem, PlanSchool } from "../lib/planner/types.ts";
import type { EstimateResult, StandingLevel } from "../lib/chances/types.ts";
import type { ListCategory } from "../lib/list-rules.ts";
import { numberProblems } from "./helpers/copy-guard.mts";

const LIST = "list-1";
const G = 2028;

function zeroCounts(): Record<StandingLevel, number> {
  return { high_reach: 0, reach: 0, target: 0, likely: 0, safe: 0 };
}

function counts(partial: Partial<Record<StandingLevel, number>>): Record<StandingLevel, number> {
  return { ...zeroCounts(), ...partial };
}

/* ------------------------------------------------------------------ */
/* shapeFor: by season                                                 */
/* ------------------------------------------------------------------ */

test("shapeFor: no shape for freshman or sophomore; the long list for junior fall/winter; the senior shape from junior spring on", () => {
  assert.equal(shapeFor("freshman"), null);
  assert.equal(shapeFor("sophomore"), null);
  assert.equal(shapeFor("unknown"), null);
  assert.deepEqual(shapeFor("junior_fall"), LIST_SHAPE.junior_fall);
  assert.deepEqual(shapeFor("junior_winter"), LIST_SHAPE.junior_winter);
  for (const s of ["junior_spring", "summer_before_senior", "senior_fall", "senior_winter", "senior_spring"] as const) {
    const shape = shapeFor(s) as Shape;
    assert.deepEqual(shape.total, [12, 15]);
    assert.deepEqual(shape.levels.high_reach, [0, 2]);
    assert.deepEqual(shape.levels.target, [5, 8]);
  }
  const longList = shapeFor("junior_fall") as Shape;
  assert.deepEqual(longList.total, [15, 20]);
  assert.equal(longList.minLikelyOrSafe, 3);
  assert.equal(longList.levels.high_reach, undefined, "no maxima on the upper levels");
});

/* ------------------------------------------------------------------ */
/* countLine                                                           */
/* ------------------------------------------------------------------ */

test("countLine: names the non-zero levels, always names Likely, including the Dream clause", () => {
  assert.equal(countLine(counts({ reach: 3, target: 2 })), "Your list has 3 Reaches, 2 Targets, and no Likely yet.");
  assert.equal(countLine(counts({ likely: 1 })), "Your list has 1 Likely.");
  assert.equal(countLine(counts({ likely: 2 })), "Your list has 2 Likelies.");
  assert.equal(countLine(counts({ high_reach: 1 }), true), "Your list has 1 High reach (including your Dream) and no Likely yet.");
});

/* ------------------------------------------------------------------ */
/* shapeGaps: every gap, in priority order                             */
/* ------------------------------------------------------------------ */

test("shapeGaps: no shape, no gaps (freshman/sophomore)", () => {
  assert.deepEqual(shapeGaps(zeroCounts(), 0, "freshman", "unknown"), []);
});

test("shapeGaps: an empty list has no gaps either (nothing to judge)", () => {
  assert.deepEqual(shapeGaps(zeroCounts(), 0, "senior_fall", "unknown"), []);
});

test("shapeGaps: likely_min first (below the combined Likely-or-Safe minimum)", () => {
  const gaps = shapeGaps(counts({ reach: 2, target: 5 }), 0, "senior_fall", "unknown");
  assert.equal(gaps[0].kind, "likely_min");
  assert.equal(gaps[0].level, "likely");
  assert.equal(gaps[0].who, "student");
});

test("shapeGaps: affordable — a parent move while the limit is unset, a student one when it's set and nothing fits", () => {
  const full = counts({ high_reach: 1, reach: 2, target: 5, likely: 2, safe: 3 }); // total 13, in range, no likely_min gap
  const unknownGaps = shapeGaps(full, 0, "senior_fall", "unknown");
  assert.equal(unknownGaps[0].kind, "affordable");
  assert.equal(unknownGaps[0].who, "guardian");
  assert.equal(unknownGaps[0].level, null);
  const noneGaps = shapeGaps(full, 0, "senior_fall", "none");
  assert.equal(noneGaps[0].kind, "affordable");
  assert.equal(noneGaps[0].who, "student");
  assert.equal(noneGaps[0].level, "likely");
  const okGaps = shapeGaps(full, 0, "senior_fall", "ok");
  assert.ok(!okGaps.some((g) => g.kind === "affordable"));
});

test("shapeGaps: target_min, then reach_min (seniors only)", () => {
  const counts1 = counts({ high_reach: 1, reach: 2, target: 2, likely: 2, safe: 2 }); // target below 5
  const gaps1 = shapeGaps(counts1, 0, "senior_fall", "ok");
  assert.equal(gaps1[0].kind, "target_min");

  const counts2 = counts({ high_reach: 1, reach: 0, target: 8, likely: 2, safe: 2 }); // reach below 2, total 13
  const gapsSenior = shapeGaps(counts2, 0, "senior_fall", "ok");
  assert.ok(gapsSenior.some((g) => g.kind === "reach_min"));
  const gapsJunior = shapeGaps(counts2, 0, "junior_spring", "ok"); // reach_min is seniors only
  assert.ok(!gapsJunior.some((g) => g.kind === "reach_min"));
});

test("shapeGaps: over_max (High reach over its maximum), informational", () => {
  const over = counts({ high_reach: 3, reach: 2, target: 5, likely: 2, safe: 2 }); // total 14
  const gaps = shapeGaps(over, 0, "senior_fall", "ok");
  assert.ok(gaps.some((g) => g.kind === "over_max" && g.level === "high_reach"));
});

test("shapeGaps: total_off, the fact line only, when nothing else is off", () => {
  // Every level exactly meets its minimum (so none of the other gaps fire), but the total (10) is under 12.
  const short = counts({ high_reach: 1, reach: 2, target: 5, likely: 1, safe: 1 });
  const gaps = shapeGaps(short, 0, "senior_fall", "ok");
  assert.equal(gaps[0].kind, "total_off");
  assert.ok(gaps[0].line.includes("seven"));
});

test("shapeGaps: unsorted rows add to the total for total_off, but never to any level's count", () => {
  const balanced = counts({ high_reach: 1, reach: 2, target: 5, likely: 2, safe: 2 }); // total 12, in range
  assert.deepEqual(shapeGaps(balanced, 0, "senior_fall", "ok"), []);
  const withUnsorted = shapeGaps(balanced, 10, "senior_fall", "ok");
  assert.ok(withUnsorted.some((g) => g.kind === "total_off"), "12 sorted + 10 unsorted is over the max");
});

test("shapeGaps: the junior long list has no total_off and no over_max — '20 is plenty' is balanceLineFor's own soft line, no gap", () => {
  const big = counts({ high_reach: 5, reach: 5, target: 5, likely: 3, safe: 3 }); // total 21, well past 20
  assert.deepEqual(shapeGaps(big, 0, "junior_fall", "ok"), []);
});

test("shapeGaps: balanced and affordable, no gaps at all", () => {
  const balanced = counts({ high_reach: 1, reach: 2, target: 5, likely: 2, safe: 2 });
  assert.deepEqual(shapeGaps(balanced, 0, "senior_fall", "ok"), []);
});

/* ------------------------------------------------------------------ */
/* affordabilityFor                                                    */
/* ------------------------------------------------------------------ */

test("affordabilityFor: unknown with no limit; ok when a Likely or Safe fits; none when the limit is set and nothing does", () => {
  const items: Pick<PlanItem, "unit_id">[] = [{ unit_id: "A" }, { unit_id: "B" }];
  const schools: Record<string, Pick<PlanSchool, "avgCost">> = { A: { avgCost: 20000 }, B: { avgCost: 60000 } };
  const estimates: Record<string, Pick<EstimateResult, "group">> = { A: { group: "likely" }, B: { group: "reach" } };
  assert.equal(affordabilityFor(items, schools, null, estimates), "unknown");
  assert.equal(affordabilityFor(items, schools, { preferences: { maxAverageCost: 30000 } }, estimates), "ok");
  assert.equal(affordabilityFor(items, schools, { preferences: { maxAverageCost: 10000 } }, estimates), "none");
});

test("dreamAtHighReach: true only when a Dream's own estimate sits at High reach", () => {
  const items: Pick<PlanItem, "unit_id" | "dream">[] = [{ unit_id: "D", dream: true }, { unit_id: "X", dream: false }];
  const estimates: Record<string, Pick<EstimateResult, "group">> = { D: { group: "high_reach" }, X: { group: "high_reach" } };
  assert.equal(dreamAtHighReach(items, estimates), true);
  assert.equal(dreamAtHighReach([{ unit_id: "D", dream: true }], { D: { group: "target" } }), false);
});

/* ------------------------------------------------------------------ */
/* shapeTasks: one move at a time                                      */
/* ------------------------------------------------------------------ */

const NOW = "2026-10-14T12:00:00Z";

const item = (over: Partial<PlanItem> = {}): PlanItem =>
  ({
    id: "item-1",
    list_id: LIST,
    unit_id: "100",
    category: "target",
    status: "considering",
    round: null,
    position: 1,
    dream: false,
    visited_on: null,
    withdrawn_on: null,
    legacy: false,
    recruited: "none",
    info_requested_on: null,
    followed_networks: [],
    ...over,
  }) as unknown as PlanItem;

function genInput(over: Partial<GeneratorInput> = {}, season: Season = "senior_fall", gradYear: number | null = G): GeneratorInput {
  const today = "2027-11-15";
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
    season,
    estimates: {},
    ...over,
  };
}

test("shapeTasks: the unsorted move comes first, before any level gap, with open_intake", () => {
  const items = [item({ id: "a", unit_id: "A" }), item({ id: "b", unit_id: "B" })];
  const inp = genInput({ items, estimates: {} }); // no estimates at all: both unsorted
  const tasks = shapeTasks(inp, shapeGaps(zeroCounts(), 2, inp.season, "unknown"));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].kind, "shape_gap");
  assert.deepEqual(tasks[0].action, { kind: "open_intake", step: 0 });
  assert.ok(tasks[0].title.includes("2"));
});

test("shapeTasks: exactly one task; kind shape_cost for the parent's affordability move, assigned to the guardian", () => {
  const inp = genInput({ items: [] });
  const full = counts({ high_reach: 1, reach: 2, target: 5, likely: 2, safe: 3 }); // no likely_min gap, so affordable leads
  const gaps = shapeGaps(full, 0, inp.season, "unknown");
  assert.equal(gaps[0].kind, "affordable");
  const tasks = shapeTasks(inp, gaps);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].kind, "shape_cost");
  assert.equal(tasks[0].assignee, "guardian");
  assert.equal(tasks[0].detail, "A college you'd get into is only a safe choice if the family can pay for it.");
});

test("shapeTasks: a show_rail action for a student-level gap, carrying the gap's own level and kind, no closeness", () => {
  const items = [item({ id: "a", unit_id: "A" })];
  const inp = genInput({ items, estimates: { A: { unitId: "A", group: "target", label: null, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, closeness: null, ed: null, modelVersion: "t" } } });
  const gaps = shapeGaps(counts({ target: 1 }), 0, inp.season, "ok");
  const [task] = shapeTasks(inp, gaps);
  assert.deepEqual(task.action, { kind: "show_rail", level: gaps[0].level, gap: gaps[0].kind });
});

test("shapeTasks: gentle 'by summer's end' wording in junior spring / the summer before senior year, undated", () => {
  const inp = genInput({ items: [] }, "junior_spring");
  const gaps = shapeGaps(counts({ reach: 2, target: 5 }), 0, "junior_spring", "unknown");
  const [task] = shapeTasks(inp, gaps);
  assert.ok(task.title.includes("by summer's end"), task.title);
  assert.equal(task.due_on, null);
});

test("shapeTasks: dated from senior fall, the earliest open deadline minus 30 days, citing its field", () => {
  const school: PlanSchool = {
    unit_id: "A",
    name: "Alpha",
    city: null,
    state: "CA",
    admitRate: null,
    admitRateCite: null,
    avgCost: null,
    avgCostCite: null,
    sticker: null,
    distanceMiles: null,
    links: null,
    social: null,
    profile: null,
    logistics: { regular_closing: { month: 1, day: 1 } } as unknown as PlanSchool["logistics"],
    aid: null,
    testPolicy: null,
    cycleStartYear: 2027,
    editionIsLastCycle: false,
    cites: {},
    gpaAverage: null,
    standing: {} as PlanSchool["standing"],
    poolSchool: {} as PlanSchool["poolSchool"],
  };
  const items = [item({ id: "a", unit_id: "A", round: "rd" })];
  const estimates: Record<string, EstimateResult> = { A: { unitId: "A", group: "reach", label: null, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, closeness: null, ed: null, modelVersion: "t" } };
  const inp = genInput({ items, schools: { A: school }, estimates }, "senior_fall");
  const gaps = shapeGaps(counts({ reach: 2, target: 5 }), 0, "senior_fall", "unknown");
  const [task] = shapeTasks(inp, gaps);
  assert.equal(task.due_on, "2027-12-02"); // Jan 1, 2028 (cycleStartYear 2027, a Jan date falls in the next calendar year) minus 30 days
  assert.equal(task.source_field, "reported.admissions_logistics.regular_closing");
});

test("shapeTasks: nothing when there's no gap and no unsorted row", () => {
  assert.deepEqual(shapeTasks(genInput({ items: [] }), []), []);
});

/* ------------------------------------------------------------------ */
/* balanceLineFor and shapeTasks agree                                 */
/* ------------------------------------------------------------------ */

test("balanceLineFor: the first gap's line, matching the move's own why (the student moves)", () => {
  const groups: ListCategory[] = [...Array(2).fill("reach"), ...Array(5).fill("target")] as ListCategory[];
  const line = balanceLineFor(groups, "senior_fall", "unknown");
  const gaps = shapeGaps(counts({ reach: 2, target: 5 }), 0, "senior_fall", "unknown");
  assert.equal(gaps[0].kind, "likely_min");
  assert.equal(line, gaps[0].line);
  const [task] = shapeTasks(genInput({ items: [] }, "senior_fall"), gaps);
  assert.equal(task.detail, gaps[0].line);
});

test("balanceLineFor: the parent's affordability move has its own fixed why, not the count line, but the notice still shows the count line", () => {
  const groups: ListCategory[] = [...Array(1).fill("high_reach"), ...Array(2).fill("reach"), ...Array(5).fill("target"), ...Array(2).fill("likely"), ...Array(3).fill("safe")] as ListCategory[];
  const full = counts({ high_reach: 1, reach: 2, target: 5, likely: 2, safe: 3 });
  const gaps = shapeGaps(full, 0, "senior_fall", "unknown");
  assert.equal(gaps[0].kind, "affordable");
  const line = balanceLineFor(groups, "senior_fall", "unknown");
  assert.equal(line, gaps[0].line, "the notice still reads the count line");
  const [task] = shapeTasks(genInput({ items: [] }, "senior_fall"), gaps);
  assert.equal(task.kind, "shape_cost");
  assert.notEqual(task.detail, line, "the parent's card has its own fixed why, not the count line");
});

test("balanceLineFor: null with no colleges, null with no shape, the soft '20 is plenty' line for the junior long list over 20", () => {
  assert.equal(balanceLineFor([], "senior_fall", "ok"), null);
  assert.equal(balanceLineFor(["reach"] as ListCategory[], "freshman", "unknown"), null);
  // Big (21), but otherwise fine (the combined Likely-or-Safe minimum met, affordable): no real gap, so the soft
  // size line shows instead.
  const big: ListCategory[] = [...Array(16).fill("target"), ...Array(3).fill("likely"), ...Array(2).fill("safe")] as ListCategory[];
  assert.equal(balanceLineFor(big, "junior_fall", "ok"), "20 is plenty to visit.");
});

test("balanceLineFor: unsorted rows show the unsorted line, agreeing with shapeTasks's own unsorted move", () => {
  const groups: ListCategory[] = ["unsorted", "unsorted", "reach"] as ListCategory[];
  assert.equal(balanceLineFor(groups, "senior_fall", "unknown"), unsortedLine(2));
});

/* ------------------------------------------------------------------ */
/* One move at a time: mergeTasks orphans a resolved gap                */
/* ------------------------------------------------------------------ */

test("one gap move at a time: resolving the first lets the next regenerate in its place", () => {
  const a = item({ id: "a", unit_id: "A" });
  const estA = (group: StandingLevel): EstimateResult => ({ unitId: "A", group, label: null, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, closeness: null, ed: null, modelVersion: "t" });
  // Round 1: a target-only list, missing its Likely/Safe minimum.
  const input1 = genInput({ items: [a], estimates: { A: estA("target") } }, "senior_fall");
  const gaps1 = shapeGaps(counts({ target: 1 }), 0, "senior_fall", "unknown");
  const generated1 = shapeTasks(input1, gaps1);
  const merge1 = mergeTasks([], generated1);
  const stored1 = applyMerge(LIST, [], merge1, NOW);
  assert.equal(stored1.length, 1);
  assert.equal(stored1[0].key, `${LIST}:shape_gap:${gaps1[0].kind}`);

  // Round 2: two Likelies join, resolving likely_min (2 meets the minimum); the next gap (affordable, the limit's
  // still unset) takes its place — a different key, so the first move orphans and the second is a fresh insert.
  const b = item({ id: "b", unit_id: "B" });
  const c = item({ id: "c", unit_id: "C" });
  const input2 = genInput({ items: [a, b, c], estimates: { A: estA("target"), B: estA("likely"), C: estA("likely") } }, "senior_fall");
  const gaps2 = shapeGaps(counts({ target: 1, likely: 2 }), 0, "senior_fall", "unknown");
  assert.notEqual(gaps2[0].kind, gaps1[0].kind, "likely_min resolved; a different gap leads now");
  const generated2 = shapeTasks(input2, gaps2);
  const merge2 = mergeTasks(stored1, generated2);
  assert.ok(merge2.orphans.includes(stored1[0].id), "the resolved gap's task orphans");
  assert.equal(merge2.upserts.length, 1);
  assert.equal(merge2.upserts[0].key, `${LIST}:shape_gap:${gaps2[0].kind}`);
  const stored2 = applyMerge(LIST, stored1, merge2, NOW);
  const open2 = stored2.filter((t) => !t.orphaned && t.kind.startsWith("shape_"));
  assert.equal(open2.length, 1, "never more than one shape move open at once");
});

/* ------------------------------------------------------------------ */
/* Guard: no closeness, no percentage, anywhere a shape gap or card shows text */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* listGapTitle: the level with the thinnest list, against the senior shape's minimums (plan-v3-fix-cards)    */
/* ------------------------------------------------------------------ */

const SENIOR = LIST_SHAPE.senior_fall as Shape;

test("listGapTitle: null with no counts yet (no estimates), or no shortfall at all", () => {
  assert.equal(listGapTitle(null, SENIOR), null);
  const full = counts({ high_reach: 2, reach: 3, target: 8, likely: 3, safe: 3 });
  assert.equal(listGapTitle(full, SENIOR), null);
});

test("listGapTitle: each level, singular at a shortfall of one, 'a few' at two or more", () => {
  // Reach min 2, Target min 5, Likely min 2, Safe min 2 (High reach has no minimum).
  assert.equal(listGapTitle(counts({ reach: 1, target: 5, likely: 2, safe: 2 }), SENIOR), "Add a Reach school");
  assert.equal(listGapTitle(counts({ reach: 0, target: 5, likely: 2, safe: 2 }), SENIOR), "Add a few Reach schools");
  assert.equal(listGapTitle(counts({ reach: 2, target: 3, likely: 2, safe: 2 }), SENIOR), "Add a few Target schools");
  assert.equal(listGapTitle(counts({ reach: 2, target: 5, likely: 1, safe: 2 }), SENIOR), "Add a Likely school");
  assert.equal(listGapTitle(counts({ reach: 2, target: 5, likely: 0, safe: 2 }), SENIOR), "Add a few Likely schools");
  assert.equal(listGapTitle(counts({ reach: 2, target: 5, likely: 2, safe: 1 }), SENIOR), "Add a Safe school");
  assert.equal(listGapTitle(counts({ reach: 2, target: 5, likely: 2, safe: 0 }), SENIOR), "Add a few Safe schools");
});

test("listGapTitle: the largest shortfall wins; ties break Likely, Target, Reach, Safe", () => {
  // Reach short by 2, Likely short by 1: Reach's shortfall is larger.
  assert.equal(listGapTitle(counts({ reach: 0, target: 5, likely: 1, safe: 2 }), SENIOR), "Add a few Reach schools");
  // Likely and Target tie (both short by 2): Likely comes first in the tie order.
  assert.equal(listGapTitle(counts({ reach: 2, target: 3, likely: 0, safe: 2 }), SENIOR), "Add a few Likely schools");
  // Target and Reach tie (both short by 2): Target wins over Reach.
  assert.equal(listGapTitle(counts({ reach: 0, target: 3, likely: 2, safe: 2 }), SENIOR), "Add a few Target schools");
  // Reach and Safe tie (both short by 1): Reach wins over Safe.
  assert.equal(listGapTitle(counts({ reach: 1, target: 5, likely: 2, safe: 1 }), SENIOR), "Add a Reach school");
});

test("listGapTitle: no title carries a digit (the catalog's words guard)", () => {
  const titles = [
    listGapTitle(counts({ reach: 0 }), SENIOR),
    listGapTitle(counts({ target: 0 }), SENIOR),
    listGapTitle(counts({ likely: 0 }), SENIOR),
    listGapTitle(counts({ safe: 0 }), SENIOR),
  ];
  for (const t of titles) assert.ok(t !== null && numberProblems(t).length === 0, t ?? "null");
});

test("guard: no gap's line and no shape_gap/shape_cost task text carries a percentage or the word 'closeness'", () => {
  const texts: string[] = [];
  for (const season of ["senior_fall", "junior_fall", "junior_spring"] as const) {
    for (const affordability of ["ok", "none", "unknown"] as const) {
      const gaps = shapeGaps(counts({ reach: 1, target: 3, likely: 1 }), 1, season, affordability);
      for (const g of gaps) texts.push(g.line);
      const tasks = shapeTasks(genInput({ items: [] }, season), gaps);
      for (const t of tasks) {
        texts.push(t.title, t.detail ?? "");
      }
    }
  }
  for (const t of texts) {
    assert.ok(!/%|percent/i.test(t), t);
    assert.ok(!/closeness/i.test(t), t);
    assert.ok(!/\bodds\b/i.test(t), t);
  }
});
