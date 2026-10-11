/**
 * The family calendar's pure module (lib/planner/calendar.ts; specs/planner/redesign/calendar.md): the school-year
 * range and its stepping, every lane rule ("Lanes" 1–5), the essay-window packing, and the Coming-up events. Pure:
 * PlanContext and PlanView are hand-built fixtures (plan-view.ts's own rules are tested in
 * tests/planner-plan-view.test.mts; this file only has to prove calendar.ts reads those shapes correctly). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarFor,
  comingUp,
  eventsFor,
  monthsOf,
  rangeContains,
  schoolYearOf,
  stepRange,
  xPercent,
  type YearRange,
} from "../lib/planner/calendar.ts";
import type { PlanContext, PlanItem, PlanSchool, PlanTask } from "../lib/planner/types.ts";
import type { PlanRowView, PlanView } from "../lib/planner/plan-view.ts";
import type { Cycle } from "../lib/planner/cycle.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TODAY = "2026-10-10";
/** The cycle the class of 2027 applies in: August 2026 – July 2027. */
const CYCLE_START = 2026;

let n = 0;
function planItem(unitId: string, over: Partial<PlanItem> = {}): PlanItem {
  n++;
  return {
    id: `item-${unitId}-${n}`,
    list_id: "list-1",
    unit_id: unitId,
    category: "unsorted",
    status: "considering",
    outcome: null,
    round: null,
    position: n,
    added_by: null,
    added_at: TODAY,
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
    transcript_shared: false,
    category_source: "auto",
    round_source: "auto",
    ...over,
  } as PlanItem;
}

function planSchool(unitId: string, name: string): PlanSchool {
  return {
    unit_id: unitId,
    name,
    city: null,
    state: null,
    admitRate: 0.4,
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
    testPolicy: "considered",
    cycleStartYear: CYCLE_START,
    editionIsLastCycle: false,
    cites: {},
    gpaAverage: null,
    standing: { admitRate: 0.4, sat: null, act: null, gpaAverage: null, testPolicy: "considered" },
  };
}

function row(unitId: string, name: string, over: Partial<PlanRowView> = {}): PlanRowView {
  return {
    item: planItem(unitId, { unit_id: unitId }),
    school: planSchool(unitId, name),
    dream: false,
    standing: null,
    group: "target",
    groupAuto: true,
    round: "rd",
    roundAuto: true,
    roundWhy: "",
    pickable: ["rd"],
    deadline: null,
    decision: null,
    moveUp: null,
    seasonStatus: null,
    ...over,
  };
}

function view(rows: PlanRowView[], over: Partial<PlanView> = {}): PlanView {
  return {
    student: { gpa: 3.8, test: { kind: "sat", score: 1400 } },
    rows,
    balance: { reach: 0, target: 0, likely: 0 },
    balanceLine: null,
    problems: [],
    edTwo: null,
    retake: null,
    estimates: {},
    next: null,
    inSeason: false,
    notices: [],
    ...over,
  };
}

function task(over: Partial<PlanTask>): PlanTask {
  return {
    id: `task-${Math.random()}`,
    list_id: "list-1",
    item_id: null,
    key: null,
    kind: "own",
    title: "A task",
    detail: null,
    due_on: null,
    window_start: null,
    window_end: null,
    assignee: "guardian",
    source: "own",
    source_field: null,
    source_edition: null,
    date_note: null,
    done_at: null,
    done_by: null,
    snoozed_until: null,
    dismissed: false,
    orphaned: false,
    position: 0,
    created_by: null,
    created_at: TODAY,
    ...over,
  };
}

/** Modeled on data/application-cycle.json's own shape: windows that fall before the application year (spring,
 *  excluded from that year's own lane) and windows that fall inside it (supplements, portal checks, thanking
 *  recommenders — the ones a senior's own calendar should show), plus the money and test dates. */
function cycleFor(startYear: number): Cycle {
  return {
    cycle: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    startYear,
    entries: [
      { key: "ask_recommenders", label: "Ask two teachers for recommendations", window: [`${startYear}-04-15`, `${startYear}-06-10`], applies: "all", assignee: "student", source: "https://example.com/recs" },
      { key: "supplements", label: "Write each college's supplement essays", window: [`${startYear}-08-01`, `${startYear}-10-25`], applies: "all", assignee: "student", source: "https://example.com/supplements" },
      { key: "portal_checks", label: "Check each college's applicant portal", window: [`${startYear}-11-01`, `${startYear + 1}-03-31`], applies: "all", assignee: "student", source: "https://example.com/portal" },
      { key: "thank_recommenders", label: "Thank your recommenders", window: [`${startYear}-11-15`, `${startYear + 1}-01-31`], applies: "all", assignee: "student", source: "https://example.com/thanks" },
      { key: "fafsa_opens", label: "FAFSA opens", date: `${startYear}-10-01`, applies: "all", assignee: "guardian", source: "https://example.com/fafsa" },
      { key: "css_profile_opens", label: "CSS Profile opens", date: `${startYear}-10-01`, applies: "has_css_college", assignee: "guardian", source: "https://example.com/css" },
      { key: "sat_oct", label: "SAT", date: `${startYear}-10-03`, register_by: `${startYear}-09-18`, applies: "plans_tests", assignee: "student", source: "https://example.com/sat" },
      { key: "sat_nov", label: "SAT", date: `${startYear}-11-07`, register_by: `${startYear}-10-23`, applies: "plans_tests", assignee: "student", source: "https://example.com/sat" },
      { key: "act_nov", label: "ACT", date: `${startYear}-11-14`, register_by: `${startYear}-10-30`, applies: "plans_tests", assignee: "student", source: "https://example.com/act" },
      { key: "final_transcript", label: "Final transcript", window: [`${startYear + 1}-05-15`, `${startYear + 1}-06-30`], applies: "committed", assignee: "guardian", source: "https://example.com/transcript" },
    ],
  };
}

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  const items = over.items ?? [];
  const schools = over.schools ?? {};
  return {
    list: { id: "list-1", student_id: "student-1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: TODAY, sort: null, rounds_plan_accepted_at: null },
    items,
    tasks: [],
    visits: [],
    offers: [],
    nudges: [],
    student: { id: "student-1", display_name: "Maya", grad_year: CYCLE_START + 1, user_id: "user-1" },
    profile: null,
    schools,
    home: null,
    viewer: { userId: "user-1", firstName: "Pat", canEdit: true, relation: "guardian", isGuardian: true },
    today: TODAY,
    cycle: cycleFor(CYCLE_START),
    grade: "senior_fall",
    stages: {} as PlanContext["stages"],
    current: 4,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Range and stepping                                                  */
/* ------------------------------------------------------------------ */

test("schoolYearOf: August 1 starts the school year; before it, the previous year is still current", () => {
  assert.deepEqual(schoolYearOf("2026-10-10"), { startYear: 2026, from: "2026-08-01", to: "2027-07-31" });
  assert.deepEqual(schoolYearOf("2026-07-31"), { startYear: 2025, from: "2025-08-01", to: "2026-07-31" });
  assert.deepEqual(schoolYearOf("2026-08-01"), { startYear: 2026, from: "2026-08-01", to: "2027-07-31" });
});

test("stepRange: one year forward or back", () => {
  const r = schoolYearOf(TODAY);
  assert.deepEqual(stepRange(r, 1), { startYear: 2027, from: "2027-08-01", to: "2028-07-31" });
  assert.deepEqual(stepRange(r, -1), { startYear: 2025, from: "2025-08-01", to: "2026-07-31" });
});

test("rangeContains and xPercent", () => {
  const r: YearRange = { startYear: 2026, from: "2026-08-01", to: "2027-07-31" };
  assert.equal(rangeContains(r, "2026-11-01"), true);
  assert.equal(rangeContains(r, "2026-07-31"), false);
  assert.equal(xPercent(r, "2026-08-01"), 0);
  assert.equal(xPercent(r, "2027-07-31"), 100);
  assert.ok(xPercent(r, "2027-02-01") > 40 && xPercent(r, "2027-02-01") < 60);
});

test("monthsOf: twelve months, August through July", () => {
  const months = monthsOf({ startYear: 2026, from: "2026-08-01", to: "2027-07-31" });
  assert.equal(months.length, 12);
  assert.equal(months[0].label, "Aug");
  assert.equal(months[0].iso, "2026-08-01");
  assert.equal(months[11].label, "Jul");
  assert.equal(months[11].iso, "2027-07-01");
});

/* ------------------------------------------------------------------ */
/* Tests lane                                                          */
/* ------------------------------------------------------------------ */

test("tests lane: shown before the application year, hidden during it without a live retake", () => {
  // A junior's cycle starts next year; the cycle file carries their junior-year test dates (this calendar year)
  // too (lib/planner/cycle.ts's validation window reaches back to January of the year before a cycle starts).
  const junior = ctx({ cycle: { cycle: "2027-28", startYear: CYCLE_START + 1, entries: cycleFor(CYCLE_START).entries } });
  const vj = view([]);
  const laneJunior = calendarFor(junior, vj, schoolYearOf(TODAY));
  assert.ok(laneJunior.some((l) => l.key === "tests"), "a junior's view keeps the tests lane");

  const senior = ctx(); // cycle starts this school year: applying now
  const vs = view([row("1", "A", { deadline: { iso: "2026-11-15", field: "x", edition: null, lastCycle: false } })]);
  const laneSenior = calendarFor(senior, vs, schoolYearOf(TODAY));
  assert.ok(!laneSenior.some((l) => l.key === "tests"), "no live retake: the tests lane is gone once applying");
});

test("tests lane: a live retake brings the lane back during the application year", () => {
  const senior = ctx();
  const vs = view([row("1", "A", { deadline: { iso: "2026-11-15", field: "x", edition: null, lastCycle: false } })], {
    retake: { kind: "sat", delta: 60, target: 1460, moves: [{ id: "item-1", from: "target", to: "likely", needed: 60 }] },
  });
  const lanes = calendarFor(senior, vs, schoolYearOf(TODAY));
  const tests = lanes.find((l) => l.key === "tests");
  assert.ok(tests, "the lane is shown");
  assert.equal(tests!.sub, "another test could help");
});

test("tests lane: a senior only sees dates that could still reach a deadline on the list", () => {
  const senior = ctx();
  const vs = view([row("1", "A", { deadline: { iso: "2026-10-20", field: "x", edition: null, lastCycle: false } })], {
    retake: { kind: "sat", delta: 60, target: 1460, moves: [{ id: "item-1", from: "target", to: "likely", needed: 60 }] },
  });
  const lanes = calendarFor(senior, vs, schoolYearOf(TODAY));
  const tests = lanes.find((l) => l.key === "tests")!;
  // sat_oct (Oct 3) is on or before the Oct 20 deadline; sat_nov (Nov 7) is after it and drops out.
  assert.deepEqual(
    tests.marks.filter((m) => m.kind === "test").map((m) => (m.kind === "test" ? m.date : "")),
    ["2026-10-03"],
  );
});

test("tests lane: no test on file means no lane at all", () => {
  const c = ctx({ cycle: cycleFor(CYCLE_START + 1) });
  const v = view([], { student: { gpa: 3.8, test: null } });
  const lanes = calendarFor(c, v, schoolYearOf(TODAY));
  assert.ok(!lanes.some((l) => l.key === "tests"));
});

/* ------------------------------------------------------------------ */
/* Essays & recs packing                                               */
/* ------------------------------------------------------------------ */

test("essays & recs: overlapping windows are packed onto separate rows so labels never collide", () => {
  const c = ctx();
  const lanes = calendarFor(c, view([]), schoolYearOf(TODAY));
  const work = lanes.find((l) => l.key === "work")!;
  assert.ok(work, "the lane is shown when the cycle has windows in range");
  // portal_checks (Nov 1–Mar 31) and thank_recommenders (Nov 15–Jan 31) overlap, so they can't share a row.
  const rows = new Set(work.marks.filter((m) => m.kind === "window").map((m) => (m.kind === "window" ? m.row : -1)));
  assert.equal(rows.size, 2);
  assert.equal(work.rows, 2);
});

test("essays & recs: a window never shown for a student past 'committed'", () => {
  const c = ctx();
  const lanes = calendarFor(c, view([]), schoolYearOf(TODAY));
  const work = lanes.find((l) => l.key === "work")!;
  assert.ok(!work.marks.some((m) => m.kind === "window" && m.label === "Final transcript"));
});

test("essays & recs: a window clips to the displayed range at its edges", () => {
  const c = ctx();
  const lanes = calendarFor(c, view([]), schoolYearOf(TODAY));
  const work = lanes.find((l) => l.key === "work")!;
  for (const m of work.marks) {
    if (m.kind === "window") {
      assert.ok(m.start >= "2026-08-01" && m.end <= "2027-07-31");
    }
  }
});

/* ------------------------------------------------------------------ */
/* Money lane                                                          */
/* ------------------------------------------------------------------ */

test("money lane: only in the child's application year", () => {
  const junior = ctx({ cycle: cycleFor(CYCLE_START + 1) });
  const lanesJunior = calendarFor(junior, view([]), schoolYearOf(TODAY));
  assert.ok(!lanesJunior.some((l) => l.key === "money"));

  const senior = ctx();
  const lanesSenior = calendarFor(senior, view([]), schoolYearOf(TODAY));
  assert.ok(lanesSenior.some((l) => l.key === "money"), "FAFSA opens is a money marker in the application year");
});

test("money lane: includes a cost_check task and labels it 'your part' or 'with a parent' by viewer", () => {
  const guardianCtx = ctx({
    items: [planItem("1", { unit_id: "1" })],
    tasks: [task({ kind: "cost_check", item_id: "item-1-1", due_on: "2026-10-11", title: "Check the cost of A together before applying ED", source_field: "reported.admission_profile.early_decision.first.closing" })],
    viewer: { userId: "user-1", firstName: "Pat", canEdit: true, relation: "guardian", isGuardian: true },
  });
  const lanes = calendarFor(guardianCtx, view([]), schoolYearOf(TODAY));
  const money = lanes.find((l) => l.key === "money")!;
  assert.equal(money.sub, "your part");
  assert.ok(money.marks.some((m) => m.kind === "money" && m.tip.includes("Check the cost of A together")));

  const studentCtx = ctx({ viewer: { userId: "student-1", firstName: "Maya", canEdit: true, relation: "self", isGuardian: false } });
  const lanesStudent = calendarFor(studentCtx, view([]), schoolYearOf(TODAY));
  assert.equal(lanesStudent.find((l) => l.key === "money")!.sub, "with a parent");
});

test("money lane: CSS Profile opening only appears when some college requires it", () => {
  const withoutCss = ctx();
  assert.ok(!calendarFor(withoutCss, view([]), schoolYearOf(TODAY)).find((l) => l.key === "money")!.marks.some((m) => m.kind === "money" && m.tip.startsWith("CSS Profile")));

  const withCss = ctx({
    items: [planItem("1", { unit_id: "1" })],
    schools: { "1": { ...planSchool("1", "A"), aid: { edition: "2025-26", aid_year: null, methodology: null, forms: { fafsa: true, own_form: false, css_profile: true, state_form: false, noncustodial_profile: false, business_farm_supplement: false, other: null }, dates: null, international: null, first_years: null, institutional_grants: null } } },
  });
  const withCssLanes = calendarFor(withCss, view([]), schoolYearOf(TODAY));
  assert.ok(withCssLanes.find((l) => l.key === "money")!.marks.some((m) => m.kind === "money" && m.tip.startsWith("CSS Profile")));
});

/* ------------------------------------------------------------------ */
/* College lanes                                                       */
/* ------------------------------------------------------------------ */

test("college lane: a work bar in the round's color, a deadline diamond, and a decision circle after it", () => {
  const c = ctx();
  const v = view([
    row("1", "Wake Forest", { dream: true, round: "ed", deadline: { iso: "2026-11-01", field: "f", edition: null, lastCycle: false }, decision: { iso: "2026-12-15", field: "g" } }),
  ]);
  const lanes = calendarFor(c, v, schoolYearOf(TODAY));
  const lane = lanes.find((l) => l.key.startsWith("college:"))!;
  assert.equal(lane.label, "Wake Forest");
  assert.equal(lane.sub, "Dream");
  const bar = lane.marks.find((m) => m.kind === "bar")!;
  assert.equal(bar.kind, "bar");
  if (bar.kind === "bar") {
    assert.equal(bar.end, "2026-11-01");
    assert.equal(bar.round, "ed");
    // Six weeks before Nov 1 is Sep 20, inside the range, so the bar isn't clipped.
    assert.equal(bar.start, "2026-09-20");
  }
  assert.ok(lane.marks.some((m) => m.kind === "deadline" && m.date === "2026-11-01"));
  assert.ok(lane.marks.some((m) => m.kind === "decision" && m.date === "2026-12-15"));
});

test("college lane: the bar clips to the start of the displayed range", () => {
  const c = ctx();
  const v = view([row("1", "Early U", { round: "ea", deadline: { iso: "2026-08-10", field: "f", edition: null, lastCycle: false } })]);
  const lanes = calendarFor(c, v, schoolYearOf(TODAY));
  const bar = lanes.find((l) => l.key.startsWith("college:"))!.marks.find((m) => m.kind === "bar")!;
  assert.equal(bar.kind === "bar" && bar.start, "2026-08-01");
});

test("college lane: no decision mark when the decision is before or equal to the deadline, or out of range", () => {
  const c = ctx();
  const v = view([row("1", "A", { deadline: { iso: "2026-11-01", field: "f", edition: null, lastCycle: false }, decision: { iso: "2026-11-01", field: "g" } })]);
  const lanes = calendarFor(c, v, schoolYearOf(TODAY));
  assert.ok(!lanes.find((l) => l.key.startsWith("college:"))!.marks.some((m) => m.kind === "decision"));
});

test("college lane: one lane per college with a deadline in range, ordered by deadline", () => {
  const c = ctx();
  const v = view([
    row("1", "Later U", { deadline: { iso: "2027-01-01", field: "f", edition: null, lastCycle: false } }),
    row("2", "Sooner U", { deadline: { iso: "2026-11-01", field: "f", edition: null, lastCycle: false } }),
  ]);
  const lanes = calendarFor(c, v, schoolYearOf(TODAY)).filter((l) => l.key.startsWith("college:"));
  assert.deepEqual(lanes.map((l) => l.label), ["Sooner U", "Later U"]);
});

/* ------------------------------------------------------------------ */
/* Quiet lines                                                         */
/* ------------------------------------------------------------------ */

test("the quiet applications line, for a child whose deadlines are all next school year", () => {
  const junior = ctx({ cycle: cycleFor(CYCLE_START + 1) });
  const v = view([row("1", "A"), row("2", "B")]);
  const lanes = calendarFor(junior, v, schoolYearOf(TODAY));
  const later = lanes.find((l) => l.key === "later")!;
  assert.match(later.note!, /2 colleges on the list/);
  assert.match(later.note!, /2027/);
});

test("the no-date-on-record line, for a child in season still missing a deadline", () => {
  const c = ctx();
  const v = view([row("1", "Rhodes"), row("2", "Elon"), row("3", "Dated U", { deadline: { iso: "2026-11-01", field: "f", edition: null, lastCycle: false } })]);
  const lanes = calendarFor(c, v, schoolYearOf(TODAY));
  const undated = lanes.find((l) => l.key === "undated")!;
  assert.match(undated.note!, /Rhodes/);
  assert.match(undated.note!, /Elon/);
  assert.ok(!undated.note!.includes("Dated U"));
});

test("never both quiet lines at once", () => {
  const junior = ctx({ cycle: cycleFor(CYCLE_START + 1) });
  const lanes = calendarFor(junior, view([row("1", "A")]), schoolYearOf(TODAY));
  assert.ok(!lanes.some((l) => l.key === "undated"));
});

/* ------------------------------------------------------------------ */
/* Coming up                                                           */
/* ------------------------------------------------------------------ */

test("eventsFor: a college's due date and decision, from today on", () => {
  const c = ctx();
  const v = view([row("1", "A", { round: "ed", deadline: { iso: "2026-11-01", field: "f", edition: null, lastCycle: false }, decision: { iso: "2026-12-15", field: "g" } })]);
  const events = eventsFor(c, v, TODAY, "student-1");
  assert.ok(events.some((e) => e.shape === "bar" && e.text === "A ED I due"));
  assert.ok(events.some((e) => e.shape === "decision" && e.text === "A decision expected"));
});

test("eventsFor: never a past date", () => {
  const c = ctx();
  const v = view([row("1", "A", { deadline: { iso: "2026-09-01", field: "f", edition: null, lastCycle: false } })]); // before TODAY
  const events = eventsFor(c, v, TODAY, "student-1");
  assert.ok(!events.some((e) => e.date < TODAY));
});

test("comingUp: merges every child's events, soonest first, capped at the given max", () => {
  const maya = ctx({ student: { id: "s1", display_name: "Maya", grad_year: CYCLE_START + 1, user_id: "u1" } });
  const theo = ctx({ student: { id: "s2", display_name: "Theo", grad_year: CYCLE_START + 2, user_id: "u1" }, cycle: cycleFor(CYCLE_START + 1) });
  const vMaya = view([
    row("1", "A", { round: "ea", deadline: { iso: "2026-11-01", field: "f", edition: null, lastCycle: false } }),
    row("2", "B", { round: "rd", deadline: { iso: "2027-01-15", field: "f", edition: null, lastCycle: false } }),
  ]);
  const vTheo = view([], { student: { gpa: 3.5, test: { kind: "act", score: 24 } } });
  const events = comingUp(
    [
      { studentId: "s1", ctx: maya, view: vMaya },
      { studentId: "s2", ctx: theo, view: vTheo },
    ],
    TODAY,
    12,
  );
  assert.ok(events.length > 0);
  for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].date <= events[i].date);
  assert.ok(events.every((e) => e.date >= TODAY));
});

test("comingUp: caps at max even when more events exist", () => {
  const c = ctx();
  const rows = Array.from({ length: 20 }, (_, i) => row(`u${i}`, `College ${i}`, { deadline: { iso: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`, field: "f", edition: null, lastCycle: false } }));
  const events = comingUp([{ studentId: "s1", ctx: c, view: view(rows) }], TODAY, 12);
  assert.equal(events.length, 12);
});

/* ------------------------------------------------------------------ */
/* Citations                                                            */
/* ------------------------------------------------------------------ */

test("every mark and event carries a citation when the source data has one", () => {
  const c = ctx();
  const v = view([row("1", "A", { round: "ed", deadline: { iso: "2026-11-01", field: "the.field", edition: null, lastCycle: false } })]);
  const lanes = calendarFor(c, v, schoolYearOf(TODAY));
  const deadline = lanes.find((l) => l.key.startsWith("college:"))!.marks.find((m) => m.kind === "deadline")!;
  assert.deepEqual(deadline.cite, { kind: "field", unitId: "1", field: "the.field" });

  const money = lanes.find((l) => l.key === "money")!;
  const fafsa = money.marks.find((m) => m.tip.startsWith("FAFSA"))!;
  assert.deepEqual(fafsa.cite, { kind: "link", url: "https://example.com/fafsa" });
});
