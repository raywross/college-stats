/**
 * U3's pure helpers for the list the plan shows (lib/planner/list-row.ts; specs/planner/redesign/list.md): the
 * group sections (Reach/Target/Likely/Not sorted yet — groups are Quad's only now, no chip to cycle and no sort
 * menu), the header line, the round chip's "EA · Nov 1" label, the deadline strike-through and urgency rules,
 * whether a student has picked rounds yet (decision 12), and the drawer's score line. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anySuggestedRound,
  dayLabel,
  GROUP_HEADING,
  groupedRows,
  headerCountsLine,
  isPastDeadline,
  isUrgentDeadline,
  roundOptionLabel,
  roundsPicked,
  scoreDrawerLine,
  SEASON_STATUS_LABEL,
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
/* groupedRows                                                         */
/* ------------------------------------------------------------------ */

test("groupedRows splits into Reach/Target/Likely/Not-sorted sections, in that order, skipping empty ones", () => {
  const rows = [row("r1", { group: "reach" }), row("l1", { group: "likely" }), row("r2", { group: "reach" }), row("u1", { group: "unsorted" })];
  const groups = groupedRows(rows);
  assert.deepEqual(
    groups.map((g) => g.group),
    ["reach", "likely", "unsorted"],
  );
  assert.deepEqual(
    groups.find((g) => g.group === "reach")!.rows.map((r) => r.item.id),
    ["r1", "r2"],
  );
});

test("groupedRows keeps each section's incoming order, so a Dream that's already first stays first within its group", () => {
  const rows = [row("dream", { group: "reach", dream: true }), row("other", { group: "reach" })];
  const groups = groupedRows(rows);
  assert.deepEqual(
    groups[0].rows.map((r) => r.item.id),
    ["dream", "other"],
  );
});

test("groupedRows is empty for an empty list", () => {
  assert.deepEqual(groupedRows([]), []);
});

test("GROUP_HEADING: Reach/Target/Likely keep their labels; unsorted reads 'Not sorted yet'", () => {
  assert.equal(GROUP_HEADING.reach, "Reach");
  assert.equal(GROUP_HEADING.target, "Target");
  assert.equal(GROUP_HEADING.likely, "Likely");
  assert.equal(GROUP_HEADING.unsorted, "Not sorted yet");
});

/* ------------------------------------------------------------------ */
/* headerCountsLine / anySuggestedRound                                */
/* ------------------------------------------------------------------ */

test("headerCountsLine is just the count now (group counts moved to each section's own heading)", () => {
  const rows = [row("a", { group: "reach" }), row("b", { group: "reach" }), row("c", { group: "likely" }), row("d", { group: "unsorted" })];
  assert.equal(headerCountsLine(rows), "4 colleges");
});

test("headerCountsLine singular for one college", () => {
  assert.equal(headerCountsLine([row("a")]), "1 college");
});

test("anySuggestedRound is true while any row's round is still the starting one (groups are never a suggestion anymore)", () => {
  assert.equal(anySuggestedRound([row("a", { roundAuto: false })]), false);
  assert.equal(anySuggestedRound([row("a", { roundAuto: false }), row("b", { roundAuto: true })]), true);
});

/* ------------------------------------------------------------------ */
/* roundsPicked (decision 12)                                          */
/* ------------------------------------------------------------------ */

test("roundsPicked is false before senior year, true from senior fall on", () => {
  assert.equal(roundsPicked("earlier"), false);
  assert.equal(roundsPicked("junior_fall"), false);
  assert.equal(roundsPicked("junior_spring"), false);
  assert.equal(roundsPicked("summer_before_senior"), false);
  assert.equal(roundsPicked("senior_fall"), true);
  assert.equal(roundsPicked("senior_winter"), true);
  assert.equal(roundsPicked("senior_spring"), true);
  assert.equal(roundsPicked("summer_after"), true);
  assert.equal(roundsPicked("graduated"), true);
});

/* ------------------------------------------------------------------ */
/* dayLabel / roundOptionLabel / isPastDeadline / isUrgentDeadline     */
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

test("isUrgentDeadline is true from today through 7 days out, false before, after, past, or null", () => {
  assert.equal(isUrgentDeadline("2026-10-10", "2026-10-10"), true);
  assert.equal(isUrgentDeadline("2026-10-17", "2026-10-10"), true);
  assert.equal(isUrgentDeadline("2026-10-18", "2026-10-10"), false);
  assert.equal(isUrgentDeadline("2026-10-09", "2026-10-10"), false);
  assert.equal(isUrgentDeadline(null, "2026-10-10"), false);
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
