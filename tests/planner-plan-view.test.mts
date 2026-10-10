/**
 * The redesigned plan's view model (lib/planner/plan-view.ts; specs/planner/redesign/build-plan.md "The view model",
 * standing.md, list.md, rounds.md): the seven standing.md examples end to end through planView, the row order,
 * suggested vs picked groups and rounds, what autoWrites may and may not write, the notices (at most three, in
 * order), the balance lines, the next deadline, and the season status. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoWrites, balanceLineFor, BALANCE_LINES, MAX_NOTICES, planView, type PlanView } from "../lib/planner/plan-view.ts";
import { withBackfillSources } from "../lib/planner/read-plan.ts";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { PlanItem, PlanSchool } from "../lib/planner/types.ts";
import type { ListCategory, ListRound } from "../lib/list-rules.ts";
import type { TestPolicy } from "../lib/types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TODAY = "2026-08-15"; // before the season: the first early deadline (Nov 1) is more than 30 days away
const md = (month: number, day: number) => ({ month, day });

interface SchoolOpts {
  admitRate?: number | null;
  sat?: [number, number] | null;
  act?: [number, number] | null;
  gpaAverage?: number | null;
  testPolicy?: TestPolicy;
  ed?: boolean;
  ed2?: boolean;
  ea?: boolean;
  rea?: boolean;
  type?: "public" | "private-nonprofit";
}

function ps(id: string, name: string, o: SchoolOpts = {}): PlanSchool {
  const admitRate = o.admitRate === undefined ? 0.45 : o.admitRate;
  const profile = {
    early_decision: o.ed
      ? { offered: true, first: { closing: md(11, 1), notification: md(12, 15) }, other: o.ed2 ? { closing: md(1, 1), notification: md(2, 15) } : null, applicants: null, admitted: null }
      : { offered: false, applicants: null, admitted: null },
    early_action: o.ea || o.rea ? { offered: true, restrictive: !!o.rea, closing: md(11, 1), notification: md(12, 15) } : { offered: false, restrictive: null, closing: null, notification: null },
  } as unknown as PlanSchool["profile"];
  const logistics = {
    cycle: "Fall 2027",
    edition: "2026-27",
    fee: null,
    regular_closing: md(1, 1),
    priority_date: null,
    other_terms: null,
    notification: { kind: "by_date", rolling_from: null, by_date: md(4, 1), other_date: null, other_text: null },
    reply: null,
    housing_deposit: null,
    deferred_admission: null,
  } as unknown as PlanSchool["logistics"];
  return {
    unit_id: id,
    name,
    city: null,
    state: null,
    admitRate,
    admitRateCite: null,
    avgCost: null,
    avgCostCite: null,
    sticker: null,
    distanceMiles: null,
    links: null,
    social: null,
    profile,
    logistics,
    aid: null,
    testPolicy: o.testPolicy ?? "considered",
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    type: o.type ?? "private-nonprofit",
    gpaAverage: o.gpaAverage ?? null,
    standing: { admitRate, sat: o.sat ?? null, act: o.act ?? null, gpaAverage: o.gpaAverage ?? null, testPolicy: o.testPolicy === undefined ? "considered" : o.testPolicy },
  };
}

let n = 0;
function item(unit_id: string, over: Partial<PlanItem> = {}): PlanItem {
  n++;
  return {
    id: `item-${unit_id}`,
    list_id: "list",
    unit_id,
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
  };
}

function numbers(o: { gpa?: number | null; sat?: number; act?: number; focus?: "sat" | "act" | "none" | null }): StudentProfileData {
  const p = emptyProfile();
  return {
    ...p,
    academics: { ...p.academics, gpa: o.gpa ?? null },
    tests: { ...p.tests, satTotal: o.sat ?? null, actComposite: o.act ?? null, focus: o.focus ?? null },
  };
}

const by = (schools: PlanSchool[]) => Object.fromEntries(schools.map((s) => [s.unit_id, s]));
const row = (v: PlanView, unit: string) => v.rows.find((r) => r.item.unit_id === unit)!;

/* ------------------------------------------------------------------ */
/* standing.md's seven examples, end to end                            */
/* ------------------------------------------------------------------ */

const EXAMPLES: { name: string; student: StudentProfileData; school: SchoolOpts; group: ListCategory }[] = [
  { name: "SAT 1450 at a 6% college: Reach for everyone", student: numbers({ sat: 1450, focus: "sat" }), school: { admitRate: 0.06, sat: [1500, 1560] }, group: "reach" },
  { name: "SAT 1450, admit 45%, inside 1280–1450: Target", student: numbers({ sat: 1450, focus: "sat" }), school: { admitRate: 0.45, sat: [1280, 1450] }, group: "target" },
  { name: "SAT 1450, admit 78%, above 1100–1300: Likely", student: numbers({ sat: 1450, focus: "sat" }), school: { admitRate: 0.78, sat: [1100, 1300] }, group: "likely" },
  { name: "ACT 24, admit 40%, ACT 28–33, test required: Reach", student: numbers({ act: 24, focus: "act" }), school: { admitRate: 0.4, act: [28, 33], testPolicy: "required" }, group: "reach" },
  { name: "No test, GPA 3.9, admit 35%, average 3.7: Target", student: numbers({ gpa: 3.9, focus: "none" }), school: { admitRate: 0.35, gpaAverage: 3.7 }, group: "target" },
  { name: "SAT 1390, GPA 3.82, admit 63%, SAT 1170–1350, average 3.88: Likely", student: numbers({ sat: 1390, gpa: 3.82, focus: "sat" }), school: { admitRate: 0.63, sat: [1170, 1350], gpaAverage: 3.88 }, group: "likely" },
  { name: "SAT 1200, GPA 3.8, test-optional, admit 45%, SAT 1280–1450, average 3.75: Target", student: numbers({ sat: 1200, gpa: 3.8, focus: "sat" }), school: { admitRate: 0.45, sat: [1280, 1450], gpaAverage: 3.75, testPolicy: "considered" }, group: "target" },
];

for (const ex of EXAMPLES) {
  test(`standing.md: ${ex.name}`, () => {
    const s = ps("100", "Example", ex.school);
    const v = planView({ items: [item("100")], schools: by([s]), profile: ex.student, today: TODAY });
    assert.equal(v.rows[0].group, ex.group);
    assert.equal(v.rows[0].groupAuto, true);
    assert.deepEqual(autoWrites(v), [{ id: "item-100", category: ex.group, round: "rd" }]);
  });
}

test("standing.md: the Reach-for-everyone reason, and the withheld score's advice", () => {
  const reach = planView({ items: [item("1")], schools: by([ps("1", "A", { admitRate: 0.06, sat: [1500, 1560] })]), profile: numbers({ sat: 1450, focus: "sat" }), today: TODAY });
  assert.equal(reach.rows[0].standing?.reachForEveryone, true);
  const optional = planView({ items: [item("1")], schools: by([ps("1", "A", { sat: [1280, 1450], gpaAverage: 3.75 })]), profile: numbers({ sat: 1200, gpa: 3.8, focus: "sat" }), today: TODAY });
  assert.equal(optional.rows[0].standing?.send, "consider-not-sending");
});

/* ------------------------------------------------------------------ */
/* Order                                                               */
/* ------------------------------------------------------------------ */

test("order: the Dream first, then Reach, Target, Likely, unsorted, then the list's own order", () => {
  const schools = by([
    ps("L", "Likely U", { admitRate: 0.8, sat: [1000, 1200] }),
    ps("T", "Target U", { admitRate: 0.45, sat: [1300, 1500] }),
    ps("R", "Reach U", { admitRate: 0.1, sat: [1450, 1550] }),
    ps("N", "No data U", { admitRate: 0.45 }),
    ps("D", "Dream U", { admitRate: 0.8, sat: [1000, 1200] }),
    ps("T2", "Target Two", { admitRate: 0.45, sat: [1300, 1500] }),
  ]);
  const items = [item("L"), item("T"), item("R"), item("N"), item("D", { dream: true }), item("T2")];
  const v = planView({ items, schools, profile: numbers({ sat: 1400, focus: "sat" }), today: TODAY });
  assert.deepEqual(
    v.rows.map((r) => r.item.unit_id),
    ["D", "R", "T", "T2", "L", "N"],
  );
  assert.equal(row(v, "N").group, "unsorted");
});

/* ------------------------------------------------------------------ */
/* Suggested until changed                                             */
/* ------------------------------------------------------------------ */

test("a group the student picked is kept and never written; Use the suggestion (auto) follows the model", () => {
  const s = ps("1", "A", { admitRate: 0.1, sat: [1450, 1550] });
  const mine = planView({ items: [item("1", { category: "likely", category_source: "student" })], schools: by([s]), profile: numbers({ sat: 1400, focus: "sat" }), today: TODAY });
  assert.equal(mine.rows[0].group, "likely");
  assert.equal(mine.rows[0].groupAuto, false);
  assert.ok(autoWrites(mine).every((w) => w.category === undefined));

  const auto = planView({ items: [item("1", { category: "likely", category_source: "auto" })], schools: by([s]), profile: numbers({ sat: 1400, focus: "sat" }), today: TODAY });
  assert.equal(auto.rows[0].group, "reach");
  assert.equal(auto.rows[0].groupAuto, true);
  assert.equal(autoWrites(auto)[0].category, "reach");
});

test("an auto group with no numbers goes back to unsorted (Add a number)", () => {
  const v = planView({ items: [item("1", { category: "target" })], schools: by([ps("1", "A", { sat: [1200, 1400] })]), profile: null, today: TODAY });
  assert.equal(v.rows[0].group, "unsorted");
  assert.equal(autoWrites(v)[0].category, "unsorted");
});

test("starting rounds: the Dream offering ED starts in ED; others take EA; a picked round is kept", () => {
  const schools = by([ps("D", "Dream U", { ed: true, ea: false }), ps("E", "EA U", { ea: true }), ps("P", "Picked U", { ea: true })]);
  const items = [item("D", { dream: true }), item("E"), item("P", { round: "rd", round_source: "student" })];
  const v = planView({ items, schools, profile: null, today: TODAY });
  assert.equal(row(v, "D").round, "ed");
  assert.equal(row(v, "D").roundAuto, true);
  assert.equal(row(v, "E").round, "ea");
  assert.equal(row(v, "P").round, "rd");
  assert.equal(row(v, "P").roundAuto, false);
  const writes = autoWrites(v);
  assert.deepEqual(
    writes.filter((w) => w.round).map((w) => [w.id, w.round]),
    [
      ["item-D", "ed"],
      ["item-E", "ea"],
    ],
  );
  assert.ok(!writes.some((w) => w.id === "item-P" && w.round));
});

test("the pre-migration fallback shows suggestions for unsorted rows and keeps chosen ones (the backfill's rule)", () => {
  const schools = by([ps("1", "A", { ea: true, admitRate: 0.8, sat: [1000, 1200] }), ps("2", "B", { ed: true }), ps("3", "C", { ea: true, admitRate: 0.8, sat: [1000, 1200] })]);
  // Rows as read before the migration: no source columns at all.
  const bare = [item("1"), item("2", { dream: true }), item("3", { category: "reach", round: "rd" })].map((i) => {
    const copy: Partial<PlanItem> = { ...i };
    delete copy.category_source;
    delete copy.round_source;
    return copy as Omit<PlanItem, "category_source" | "round_source">;
  });
  const rows = withBackfillSources(bare);
  const v = planView({ items: rows, schools, profile: numbers({ sat: 1400, focus: "sat" }), today: TODAY });
  // An unsorted row shows the model's group as a suggestion (browser QA 2026-10-10: it used to read "Add a number").
  assert.equal(row(v, "1").group, "likely");
  assert.equal(row(v, "1").groupAuto, true);
  // A group and round the student stored stay theirs.
  assert.equal(row(v, "3").group, "reach");
  assert.equal(row(v, "3").groupAuto, false);
  assert.equal(row(v, "3").round, "rd");
  assert.equal(row(v, "3").roundAuto, false);
  // autoWrites never lists the student's rows; load.ts and store-plan.ts skip writing entirely while sources are missing.
  assert.ok(!autoWrites(v).some((w) => w.id === "3"));
});

test("an applied or decided college's round is never rewritten", () => {
  const schools = by([ps("A", "Applied U", { ea: true }), ps("B", "Decided U", { ea: true }), ps("C", "No round U", { ea: true })]);
  const items = [
    item("A", { status: "applied", round: "rd" }),
    item("B", { status: "decided", outcome: "admitted", round: "rd" }),
    item("C", { status: "applied", round: null }),
  ];
  const v = planView({ items, schools, profile: null, today: TODAY });
  assert.equal(row(v, "A").round, "rd");
  assert.equal(row(v, "A").roundAuto, false);
  assert.equal(row(v, "B").round, "rd");
  assert.ok(autoWrites(v).every((w) => w.round === undefined));
});

test("a college no longer in the dataset is shown unsorted and never written", () => {
  const v = planView({ items: [item("gone", { category: "reach" })], schools: {}, profile: numbers({ sat: 1400, focus: "sat" }), today: TODAY });
  assert.equal(v.rows[0].school, null);
  assert.equal(v.rows[0].group, "unsorted");
  assert.deepEqual(autoWrites(v), []);
});

test("deadline and decision follow the row's round, with the field to cite and its edition", () => {
  const v = planView({ items: [item("D", { dream: true })], schools: by([ps("D", "Dream U", { ed: true })]), profile: null, today: TODAY });
  assert.deepEqual(v.rows[0].deadline, { iso: "2026-11-01", field: "reported.admission_profile.early_decision.first.closing", edition: null, lastCycle: false });
  assert.deepEqual(v.rows[0].decision, { iso: "2026-12-15", field: "reported.admission_profile.early_decision.first.notification" });
  assert.ok(v.rows[0].pickable.includes("ed"));
});

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

test("notices: at most three, in list.md's order (problems, ED II, balance, retake); the fourth waits", () => {
  // Two EDs (a problem), a Dream in ED with a college offering ED II (the offer), three colleges (balance), and a
  // score 20 points under a range at a 45% college (a retake would move it up).
  const schools = by([
    ps("D", "Dream U", { ed: true, admitRate: 0.1 }),
    ps("X", "Second ED U", { ed: true, admitRate: 0.45, sat: [1300, 1450] }),
    ps("Y", "ED II U", { ed: true, ed2: true, admitRate: 0.45, sat: [1300, 1450] }),
  ]);
  const items = [item("D", { dream: true }), item("X", { round: "ed", round_source: "student" }), item("Y")];
  const v = planView({ items, schools, profile: numbers({ sat: 1280, focus: "sat" }), today: TODAY });
  assert.ok(v.problems.length > 0);
  assert.equal(v.edTwo?.itemId, "item-Y");
  assert.equal(v.edTwo?.due, "2027-01-01");
  assert.ok(v.balanceLine);
  assert.ok(v.retake);
  assert.equal(MAX_NOTICES, 3);
  assert.deepEqual(v.notices, ["problems", "edTwo", "balance"]);
});

test("notices: only the ones that are true, in order", () => {
  const schools = by([ps("1", "A", { admitRate: 0.45, sat: [1300, 1450] })]);
  const v = planView({ items: [item("1")], schools, profile: numbers({ sat: 1280, focus: "sat" }), today: TODAY });
  assert.deepEqual(v.notices, ["balance", "retake"]);
  const none = planView({ items: [], schools: {}, profile: null, today: TODAY });
  assert.deepEqual(none.notices, []);
});

test("problems: two EDs, and REA beside a private college's EA, each as one sentence", () => {
  const schools = by([ps("A", "Alpha", { ed: true }), ps("B", "Beta", { ed: true }), ps("C", "Gamma", { rea: true }), ps("E", "Delta", { ea: true })]);
  const items = [
    item("A", { round: "ed", round_source: "student" }),
    item("B", { round: "ed", round_source: "student" }),
    item("C", { round: "rea", round_source: "student" }),
    item("E", { round: "ea", round_source: "student" }),
  ];
  const v = planView({ items, schools, profile: null, today: TODAY });
  assert.ok(v.problems.some((p) => p.startsWith("Early decision is binding") && p.includes("Alpha and Beta")));
  assert.ok(v.problems.some((p) => p.includes("Restrictive early action at Gamma") && p.includes("Delta")));
  // A decided college that said no no longer binds.
  const done = planView({ items: [items[0], { ...items[1], status: "decided", outcome: "denied" }], schools, profile: null, today: TODAY });
  assert.deepEqual(done.problems, []);
});

test("balance lines: too few Likely first, then the list's size, then too many Reaches; none when balanced", () => {
  const g = (r: number, t: number, l: number, u = 0): ListCategory[] => [...Array(r).fill("reach"), ...Array(t).fill("target"), ...Array(l).fill("likely"), ...Array(u).fill("unsorted")];
  assert.equal(balanceLineFor([]), null);
  assert.equal(balanceLineFor(g(3, 3, 1)), BALANCE_LINES.likely);
  assert.equal(balanceLineFor(g(1, 1, 2)), BALANCE_LINES.size);
  assert.equal(balanceLineFor(g(4, 5, 4)), BALANCE_LINES.size);
  assert.equal(balanceLineFor(g(5, 1, 2)), BALANCE_LINES.reach);
  assert.equal(balanceLineFor(g(2, 4, 2)), null);
  // Nothing sorted yet (no numbers): only the size line can apply.
  assert.equal(balanceLineFor(g(0, 0, 0, 3)), BALANCE_LINES.size);
  assert.equal(balanceLineFor(g(0, 0, 0, 8)), null);
});

/* ------------------------------------------------------------------ */
/* Next up and the season                                              */
/* ------------------------------------------------------------------ */

test("next: the nearest deadline still to meet; applied colleges and past deadlines skipped", () => {
  const schools = by([ps("E", "Early U", { ea: true }), ps("R", "Regular U"), ps("A", "Applied U", { ea: true })]);
  const items = [item("R"), item("E"), item("A", { status: "applied", round: "ea" })];
  const v = planView({ items, schools, profile: null, today: TODAY });
  assert.equal(v.next?.item.unit_id, "E");
  const later = planView({ items, schools, profile: null, today: "2026-12-01" });
  assert.equal(later.next?.item.unit_id, "R");
});

test("next: once every deadline has passed, the nearest decision still to hear", () => {
  const schools = by([ps("A", "Applied U", { ea: true }), ps("B", "Applied RD")]);
  const items = [item("A", { status: "applied", round: "ea" }), item("B", { status: "applied", round: "rd" })];
  const v = planView({ items, schools, profile: null, today: "2027-01-10" });
  assert.equal(v.next?.item.unit_id, "B");
  assert.equal(v.next?.decision?.iso, "2027-04-01");
});

test("season: no status chip before; within 30 days of the first deadline, statuses map to the chip", () => {
  const schools = by([ps("1", "A", { ea: true }), ps("2", "B"), ps("3", "C"), ps("4", "D")]);
  const items = [item("1"), item("2", { status: "applying" }), item("3", { status: "applied", round: "rd" }), item("4", { status: "decided", outcome: "admitted", round: "rd" })];
  const quiet = planView({ items: [items[0]], schools, profile: null, today: TODAY });
  assert.equal(quiet.inSeason, false);
  assert.equal(quiet.rows[0].seasonStatus, null);
  const close = planView({ items: [items[0]], schools, profile: null, today: "2026-10-05" });
  assert.equal(close.inSeason, true);
  assert.equal(close.rows[0].seasonStatus, "not_started");
  const busy = planView({ items, schools, profile: null, today: TODAY });
  assert.equal(busy.inSeason, true);
  assert.deepEqual(
    ["1", "2", "3", "4"].map((u) => row(busy, u).seasonStatus),
    ["not_started", "working", "submitted", "decision"],
  );
});

test("the view's student comes from the profile through planStudent (one test, GPA on 4.0)", () => {
  const v = planView({ items: [], schools: {}, profile: numbers({ sat: 1390, act: 30, gpa: 3.82, focus: "act" }), today: TODAY });
  // gpa.md "The design" 3: the GPA also travels as the range the plan compares and the label its sentences show.
  assert.deepEqual(v.student, { gpa: 3.8, gpaRange: [3.82, 3.82], gpaLabel: "3.82", test: { kind: "act", score: 30 } });
  const rounds: ListRound[] = v.rows.map((r) => r.round);
  assert.deepEqual(rounds, []);
});
