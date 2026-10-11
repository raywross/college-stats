/**
 * U3's pure helpers for the list the plan shows (lib/planner/list-row.ts; specs/planner/redesign/list.md,
 * rounds.md): the header counts line, the sort menu that survives ranking's removal, the group chip's cycle, the
 * round chip's "EA · Nov 1" label, the deadline strike-through rule, and the drawer's score line. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anySuggested,
  dayLabel,
  headerCountsLine,
  isPastDeadline,
  nextGroup,
  roundOptionLabel,
  scoreDrawerLine,
  SEASON_STATUS_LABEL,
  sortRows,
  type RowSort,
} from "../lib/planner/list-row.ts";
import type { PlanRowView } from "../lib/planner/plan-view.ts";
import type { PlanItem, PlanSchool } from "../lib/planner/types.ts";
import type { ListCategory } from "../lib/list-rules.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function school(id: string, name: string, over: Partial<PlanSchool> = {}): PlanSchool {
  return {
    unit_id: id,
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
    logistics: null,
    aid: null,
    testPolicy: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    gpaAverage: null,
    standing: { admitRate: null, sat: null, act: null, gpaAverage: null, testPolicy: null },
    ...over,
  } as unknown as PlanSchool;
}

let n = 0;
function row(id: string, over: Partial<PlanRowView> = {}): PlanRowView {
  n++;
  const item = { id, unit_id: id, category: "unsorted", position: n, dream: false } as unknown as PlanItem;
  return {
    item,
    school: school(id, id),
    dream: false,
    standing: null,
    group: "unsorted" as ListCategory,
    groupAuto: true,
    round: "rd",
    roundAuto: true,
    roundWhy: "",
    pickable: ["rd", "rolling"],
    deadline: null,
    decision: null,
    moveUp: null,
    seasonStatus: null,
    ...over,
  } as PlanRowView;
}

/* ------------------------------------------------------------------ */
/* headerCountsLine / anySuggested                                     */
/* ------------------------------------------------------------------ */

test("headerCountsLine counts each group, in Reach/Target/Likely order, skipping empty and unsorted groups", () => {
  const rows = [row("a", { group: "reach" }), row("b", { group: "reach" }), row("c", { group: "likely" }), row("d", { group: "unsorted" })];
  assert.equal(headerCountsLine(rows), "4 colleges · 2 Reach · 1 Likely");
});

test("headerCountsLine singular for one college", () => {
  assert.equal(headerCountsLine([row("a")]), "1 college");
});

test("anySuggested is true while any row's group or round is still the model's", () => {
  assert.equal(anySuggested([row("a", { groupAuto: false, roundAuto: false })]), false);
  assert.equal(anySuggested([row("a", { groupAuto: false, roundAuto: false }), row("b", { groupAuto: true })]), true);
  assert.equal(anySuggested([row("a", { groupAuto: false, roundAuto: true })]), true);
});

/* ------------------------------------------------------------------ */
/* nextGroup                                                           */
/* ------------------------------------------------------------------ */

test("nextGroup cycles Reach -> Target -> Likely -> Reach, and Unsorted starts at Reach", () => {
  assert.equal(nextGroup("reach"), "target");
  assert.equal(nextGroup("target"), "likely");
  assert.equal(nextGroup("likely"), "reach");
  assert.equal(nextGroup("unsorted"), "reach");
});

/* ------------------------------------------------------------------ */
/* sortRows                                                             */
/* ------------------------------------------------------------------ */

test("sortRows 'default' orders Dream first, then Reach/Target/Likely/Unsorted, then list position", () => {
  const rows = [
    row("likely1", { group: "likely" }),
    row("reach1", { group: "reach" }),
    row("dream", { group: "target", dream: true }),
    row("target1", { group: "target" }),
  ];
  const ids = sortRows(rows, "default").map((r) => r.item.id);
  assert.deepEqual(ids, ["dream", "reach1", "target1", "likely1"]);
});

test("sortRows 'deadline' sorts by closing date, undated rows last", () => {
  const rows = [
    row("none"),
    row("later", { deadline: { iso: "2026-12-01", field: "f", edition: null, lastCycle: false } }),
    row("sooner", { deadline: { iso: "2026-11-01", field: "f", edition: null, lastCycle: false } }),
  ];
  const ids = sortRows(rows, "deadline").map((r) => r.item.id);
  assert.deepEqual(ids, ["sooner", "later", "none"]);
});

test("sortRows 'avg_cost' and 'distance' sort by the school's own field, missing values last", () => {
  const byCost = [row("a", { school: school("a", "A", { avgCost: 40000 }) }), row("b", { school: school("b", "B", { avgCost: 20000 }) }), row("c", { school: school("c", "C", { avgCost: null }) })];
  assert.deepEqual(sortRows(byCost, "avg_cost").map((r) => r.item.id), ["b", "a", "c"]);

  const byDistance = [row("a", { school: school("a", "A", { distanceMiles: 300 }) }), row("b", { school: school("b", "B", { distanceMiles: 10 }) })];
  assert.deepEqual(sortRows(byDistance, "distance").map((r) => r.item.id), ["b", "a"]);
});

test("sortRows never mutates its input array", () => {
  const rows = [row("a", { group: "likely" }), row("b", { group: "reach" })];
  const copy = [...rows];
  sortRows(rows, "default" as RowSort);
  assert.deepEqual(rows, copy);
});

/* ------------------------------------------------------------------ */
/* dayLabel / roundOptionLabel / isPastDeadline                        */
/* ------------------------------------------------------------------ */

test("dayLabel reads a yyyy-mm-dd as 'Nov 1'", () => {
  assert.equal(dayLabel("2026-11-01"), "Nov 1");
  assert.equal(dayLabel("2027-01-15"), "Jan 15");
});

test("roundOptionLabel is 'EA · Nov 1' with a date, else just the round's short name", () => {
  assert.equal(roundOptionLabel("ea", "2026-11-01"), "EA · Nov 1");
  assert.equal(roundOptionLabel("rd", null), "RD");
});

test("isPastDeadline strikes a date before today, never a null date", () => {
  assert.equal(isPastDeadline("2026-10-01", "2026-10-10"), true);
  assert.equal(isPastDeadline("2026-10-10", "2026-10-10"), false);
  assert.equal(isPastDeadline("2026-11-01", "2026-10-10"), false);
  assert.equal(isPastDeadline(null, "2026-10-10"), false);
});

/* ------------------------------------------------------------------ */
/* SEASON_STATUS_LABEL / scoreDrawerLine                                */
/* ------------------------------------------------------------------ */

test("SEASON_STATUS_LABEL relabels the built status/outcome values (list.md 'The row')", () => {
  assert.equal(SEASON_STATUS_LABEL.not_started, "Not started");
  assert.equal(SEASON_STATUS_LABEL.working, "Working on it");
  assert.equal(SEASON_STATUS_LABEL.submitted, "Submitted");
  assert.equal(SEASON_STATUS_LABEL.decision, "Decision");
});

test("scoreDrawerLine reports a score move when there is one", () => {
  const r = row("a", { moveUp: { score: 1420, delta: 30, from: "target", to: "likely" } });
  assert.equal(scoreDrawerLine(r), "A 1420 would make this a Likely.");
});

test("scoreDrawerLine falls back to the optional-score advice, else null", () => {
  const withheld = row("a", { standing: { fit: "target", reachForEveryone: false, label: null, test: null, gpaNote: null, send: "consider-not-sending", reasons: [] } });
  assert.equal(scoreDrawerLine(withheld), "Optional here: consider not sending.");
  assert.equal(scoreDrawerLine(row("a")), null);
});
