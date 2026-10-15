/**
 * ED opportunities (lib/planner/ed-opportunities.ts; specs/planner/next-steps/ed-opportunities.md), after the owner's
 * "be more forgiving" and "ED as a currency" (2026-10-15): `helps`, `improves`, and null qualify at Reach or Target
 * (an `elite`-labelled Reach included), `helps` first, then `improves`, then null, then the Dream at High reach where
 * the college's ED rate is above overall; within a verdict the Dream, then the owner's closeness order; the cap of
 * three (the first ED, the rest ED II or `ed_alt` by the date rule); no candidate at `same` / `not_advised` (but the
 * Dream) / Likely, or without ED; the pill and sheet wording by verdict; dismissal; the
 * junior-spring gate; the post-deadline close; the moves (`ed_decide`, `ed2_decide`) and the per-candidate cost
 * check; and a guard that no pill or sheet string carries a number from the estimate, a "×", or "odds". `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ED_CAVEAT, ED_MAX, ED_PILL_TEXT, ED_PILL_TEXT_PLAIN, edDismissedItemIds, edPillText, edMoves, edOpportunities, edSheetFacts, type EdCandidate, type EdSheetFacts } from "../lib/planner/ed-opportunities.ts";
import { generate as roundsGenerate } from "../lib/planner/generators/rounds.ts";
import { loadCycle, cycleFor } from "../lib/planner/cycle.ts";
import { gradeOf, seasonOf } from "../lib/planner/seasons.ts";
import type { EstimateResult, StandingLevel } from "../lib/chances/types.ts";
import type { GeneratorInput, PlanItem, PlanSchool } from "../lib/planner/types.ts";

const LIST = "list-1";
const G = 2028;
const JUNIOR_SPRING = "2027-04-15";
const SUMMER = "2027-07-01";
const md = (month: number, day: number) => ({ month, day });

interface SchoolOpts {
  ed?: boolean;
  ed2?: boolean;
  /** ED II closing month/day (default Jan 1). */
  ed2Closing?: { month: number; day: number } | null;
  /** ED notification (default Dec 15). */
  edNotification?: { month: number; day: number } | null;
  counts?: [number, number] | null;
  totals?: [number, number] | null;
}

function ps(id: string, o: SchoolOpts = {}): PlanSchool {
  const ed = o.ed ?? true;
  return {
    unit_id: id,
    name: `College ${id}`,
    admitRate: 0.3,
    admitRateCite: { year: "2024" },
    profile: {
      early_decision: ed
        ? {
            offered: true,
            first: { closing: md(11, 1), notification: o.edNotification === undefined ? md(12, 15) : o.edNotification },
            other: o.ed2 ? { closing: o.ed2Closing === undefined ? md(1, 1) : o.ed2Closing, notification: md(2, 15) } : undefined,
            applicants: o.counts === null ? null : (o.counts?.[0] ?? 1000),
            admitted: o.counts === null ? null : (o.counts?.[1] ?? 240),
          }
        : { offered: false, applicants: null, admitted: null },
    },
    logistics: null,
    cycleStartYear: 2027,
    editionIsLastCycle: false,
    cites: { "reported.admission_profile.early_decision.admitted": { cdsEdition: "2026–27" }, "reported.admission_profile.early_decision.applicants": { cdsEdition: "2026–27" } },
    edTotals: o.totals === null ? null : { applicants: o.totals?.[0] ?? 10000, admitted: o.totals?.[1] ?? 1000, enrolled: 500 },
    links: { price_calculator: "https://example.edu/npc" },
  } as unknown as PlanSchool;
}

const est = (unitId: string, group: StandingLevel | null, closeness: EstimateResult["closeness"], ed: EstimateResult["ed"] = "helps"): EstimateResult =>
  ({ unitId, group, label: null, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, closeness, ed, modelVersion: "t" }) as EstimateResult;

const item = (id: string, over: Partial<PlanItem> = {}): PlanItem =>
  ({
    id: `item-${id}`,
    list_id: LIST,
    unit_id: id,
    category: "target",
    status: "considering",
    outcome: null,
    round: null,
    round_source: "auto",
    position: Number(id.replace(/\D/g, "")) || 1,
    dream: false,
    withdrawn_on: null,
    decision_date: null,
    ed_dismissed_at: null,
    ed_checks: {},
    ...over,
  }) as unknown as PlanItem;

const by = (schools: PlanSchool[]) => Object.fromEntries(schools.map((s) => [s.unit_id, s]));
const opts = (today = SUMMER) => ({ season: seasonOf(G, today), today });

function input(today: string, items: PlanItem[], schools: Record<string, PlanSchool>, estimates: Record<string, EstimateResult>): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: "2026-10-14T00:00:00Z", sort: null, rounds_plan_accepted_at: null },
    items,
    schools,
    profile: null,
    cycle: loadCycle(cycleFor(G)),
    grade: gradeOf(G, today),
    today,
    visits: [],
    offers: [],
    gradYear: G,
    season: seasonOf(G, today),
    estimates,
  } as GeneratorInput;
}

const ids = (cs: EdCandidate[]) => cs.map((c) => c.unitId);

test("the Dream first, then the owner's closeness order (Reach 3, 2; Target 0, 1; Reach 1, 0; Target 2, 3; no closeness last)", () => {
  const units = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const schools = by(units.map((u) => ps(u)));
  const items = units.map((u) => item(u, { dream: u === "10" }));
  const estimates = {
    "1": est("1", "target", 3),
    "2": est("2", "reach", 0),
    "3": est("3", "target", 2),
    "4": est("4", "reach", 1),
    "5": est("5", "target", 1),
    "6": est("6", "target", 0),
    "7": est("7", "reach", 2),
    "8": est("8", "reach", 3),
    "9": est("9", "reach", null),
    "10": est("10", "target", 3),
  };
  // The cap of three hides the tail, so the order is read in slices: take the pills, drop those rows, ask again.
  const order: string[] = [];
  let left = items;
  for (let i = 0; i < 4; i++) {
    const got = edOpportunities(left, estimates, schools, opts());
    if (got.length === 0) break;
    assert.ok(got.length <= ED_MAX);
    assert.deepEqual(got.map((c) => c.rank), got.map((_, j) => j + 1));
    assert.ok(got.every((c) => c.verdict === "helps"));
    order.push(...ids(got));
    const taken = new Set(ids(got));
    left = left.filter((it) => !taken.has(it.unit_id));
  }
  assert.deepEqual(order, ["10", "8", "7", "6", "5", "4", "2", "3", "1", "9"]);
  assert.ok(edOpportunities(items, estimates, schools, opts())[0].dream, "the Dream first");
});

test("improves and null qualify, ranked after helps (improves before null), each in the owner's order", () => {
  const units = ["1", "2", "3", "4", "5", "6"];
  const schools = by(units.map((u) => (u === "6" ? ps(u, { counts: null }) : ps(u))));
  const items = units.map((u) => item(u, { dream: u === "2" }));
  const estimates = {
    "1": est("1", "reach", 3, null),
    "2": est("2", "target", 1, "improves"),
    "3": est("3", "target", 3, "helps"),
    "4": est("4", "reach", 3, "improves"),
    "5": est("5", "target", 0, "helps"),
    "6": est("6", "reach", 2, null),
  };
  const got = edOpportunities(items, estimates, schools, opts());
  // helps: Target 0 before Target 3; then improves: the Dream first. The cap of three (owner, 2026-10-15) ends it
  // there; Reach 3 improves, Reach 3 null, Reach 2 null would follow in that order.
  assert.deepEqual(ids(got), ["5", "3", "2"]);
  assert.deepEqual(got.map((c) => c.verdict), ["helps", "helps", "improves"]);
  assert.deepEqual(got.map((c) => c.rank), [1, 2, 3], "ranks renumbered after the cap");
  const rest = edOpportunities(items.filter((i) => !["5", "3", "2"].includes(i.unit_id)), estimates, schools, opts());
  assert.deepEqual(ids(rest), ["4", "1", "6"], "improves before null");
  // The owner's case: one college at Reach or Target offers ED, and early decision improves the chance there.
  const one = edOpportunities([item("4")], { "4": est("4", "reach", 3, "improves") }, schools, opts());
  assert.deepEqual(one.map((c) => [c.unitId, c.round, c.verdict]), [["4", "ed", "improves"]]);
});

test("ED as a currency (owner, 2026-10-15): an Ultra selective (elite) Reach with improves gets a pill; same never does", () => {
  const schools = by([ps("1"), ps("2")]);
  // Vanderbilt's case: the tier caps the level at Reach (no closeness), ED admits a larger share.
  const vandy = { ...est("1", "reach", null, "improves"), label: "elite" } as EstimateResult;
  const got = edOpportunities([item("1")], { "1": vandy }, schools, opts());
  assert.deepEqual(got.map((c) => [c.unitId, c.round, c.verdict]), [["1", "ed", "improves"]]);
  assert.equal(edPillText(got[0].round, got[0].verdict).full, "ED opportunity");
  // same: the college's ED rate is at or below its overall rate. Never a pill, at any level or as the Dream.
  for (const [level, closeness] of [["reach", 3], ["reach", null], ["target", 0], ["target", 1]] as const) {
    assert.deepEqual(edOpportunities([item("2", { dream: true })], { "2": est("2", level, closeness, "same") }, schools, opts()), [], `same at ${level} ${closeness}`);
    assert.deepEqual(edOpportunities([item("2")], { "2": { ...est("2", level, closeness, "same"), label: "elite" } as EstimateResult }, schools, opts()), []);
  }
});

test("the Dream at High reach: a candidate only where the college's ED rate is above overall, ranked after every Reach and Target", () => {
  // ps defaults: ED 24% (240 of 1,000) against 10% overall (the same document's totals).
  const schools = by([ps("1"), ps("2"), ps("3"), ps("4", { counts: [1000, 80] }), ps("5", { counts: null })]);
  const dream = (u: string) => item(u, { dream: true });
  const hr = (u: string) => est(u, "high_reach", null, "not_advised");
  // Alone, it gets the pill, and the round is ED.
  const alone = edOpportunities([dream("1")], { "1": hr("1") }, schools, opts());
  assert.deepEqual(alone.map((c) => [c.unitId, c.round, c.level, c.verdict, c.dream]), [["1", "ed", "high_reach", "not_advised", true]]);
  assert.equal(edPillText(alone[0].round, alone[0].verdict).full, "ED opportunity");
  // Behind every Reach and Target candidate, null included, so the cap pushes it out when three are better.
  const e = { "1": hr("1"), "2": est("2", "reach", 0, null), "3": est("3", "target", 1, "improves") };
  assert.deepEqual(ids(edOpportunities([dream("1"), item("2"), item("3")], e, schools, opts())), ["3", "2", "1"]);
  const full = { ...e, "4": est("4", "reach", 3, "helps") };
  assert.deepEqual(ids(edOpportunities([dream("1"), item("2"), item("3"), item("4")], full, schools, opts())), ["4", "3", "2"], "past the cap");
  // M_ed is 1 (8% ED against 10% overall) or unknown (no counts): out. Not the Dream: out.
  assert.deepEqual(edOpportunities([dream("4")], { "4": hr("4") }, schools, opts()), []);
  assert.deepEqual(edOpportunities([dream("5")], { "5": hr("5") }, schools, opts()), []);
  assert.deepEqual(edOpportunities([item("1")], { "1": hr("1") }, schools, opts()), []);
});

test("where ED wouldn't move the level the hint is for Reach or the top of Target (closeness 0 or 1), or the Dream (owner, 2026-10-15)", () => {
  const schools = by([ps("1"), ps("2"), ps("3"), ps("4"), ps("5")]);
  const e = {
    "1": est("1", "target", 3, "improves"), // lower Target, not the Dream: out
    "2": est("2", "target", 2, null), // lower Target, no counts: out
    "3": est("3", "target", 1, "improves"), // top of Target: in
    "4": est("4", "reach", 0, "improves"), // any Reach: in
    "5": est("5", "target", 3, "helps"), // helps qualifies anywhere
  };
  const got = edOpportunities(["1", "2", "3", "4", "5"].map((u) => item(u)), e, schools, opts());
  assert.deepEqual(ids(got), ["5", "3", "4"]);
  // The Dream at the bottom of Target with an improves verdict still gets the hint.
  const dream = edOpportunities([item("1", { dream: true })], { "1": est("1", "target", 3, "improves") }, schools, opts());
  assert.deepEqual(ids(dream), ["1"]);
});

test("the cap of three: six candidates give three pills, the first ED, the rest ED II or ed_alt by the date rule", () => {
  const schools = by([
    ps("1"),
    ps("2", { ed2: true }),
    ps("3", { ed2: true, ed2Closing: md(12, 1) }),
    ps("4"),
    ps("5", { ed2: true, ed2Closing: md(1, 15) }),
    ps("6", { ed2: true, counts: null }),
  ]);
  const items = ["1", "2", "3", "4", "5", "6"].map((u) => item(u));
  const e = {
    "1": est("1", "reach", 3),
    "2": est("2", "reach", 2),
    "3": est("3", "target", 0, "improves"),
    "4": est("4", "target", 1, "improves"),
    "5": est("5", "reach", 1, "improves"),
    "6": est("6", "target", 2, null),
  };
  const got = edOpportunities(items, e, schools, opts());
  assert.equal(got.length, ED_MAX);
  assert.deepEqual(
    got.map((c) => [c.unitId, c.round]),
    [
      ["1", "ed"],
      ["2", "ed2"],
      ["3", "ed_alt"],
    ],
    "helps first (1, 2), then the top-of-Target improves; ED II due Dec 1 is before the Dec 15 notification",
  );
  assert.equal(got.filter((c) => c.round === "ed").length, 1, "never two plain ED");
  // Without the cap the next would be 4 (Target 1, improves) then 5 (Reach 1, improves); 6 (lower Target, no counts) is out of the band.
  const rest = edOpportunities(items.filter((i) => !["1", "2", "3"].includes(i.unit_id)), e, schools, opts());
  assert.deepEqual(ids(rest), ["4", "5"]);
});

test("ties go by the student's own order", () => {
  const schools = by([ps("1"), ps("2")]);
  const items = [item("1", { position: 5 }), item("2", { position: 2 })];
  assert.deepEqual(ids(edOpportunities(items, { "1": est("1", "reach", 3), "2": est("2", "reach", 3) }, schools, opts())), ["2", "1"]);
});

test("no candidate at not_advised, High reach (not the Dream) / Likely / no level, without ED, a same verdict, or decided / withdrawn", () => {
  const units = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const schools = by(
    units.map((u) => (u === "7" ? ps(u, { ed: false }) : u === "3" ? ps(u, { counts: [1000, 50] }) : u === "10" ? ps(u, { counts: [1000, 100] }) : ps(u))),
  );
  const items = units.map((u) => item(u));
  items[7] = item("8", { status: "decided", outcome: "admitted" });
  items[8] = item("9", { withdrawn_on: "2027-05-01" });
  const estimates = {
    "1": est("1", "reach", 3, "same"),
    "2": est("2", "reach", 3, "not_advised"),
    // Reversed (5% ED against 10% overall) and level (10% against 10%): early decision changes nothing there.
    "3": est("3", "reach", 3, "same"),
    "4": est("4", "high_reach", 3, "not_advised"),
    "5": est("5", "likely", 3, "same"),
    "6": est("6", null, null, null),
    "7": est("7", "reach", 3, null),
    "8": est("8", "reach", 3),
    "9": est("9", "reach", 3),
    "10": est("10", "target", 0, "same"),
  };
  assert.deepEqual(edOpportunities(items, estimates, schools, opts()), []);
  // The planted control: the same rows qualify once the reason is gone.
  assert.equal(edOpportunities([item("1")], { "1": est("1", "reach", 3, "improves") }, schools, opts()).length, 1, "improves, not same");
  assert.equal(edOpportunities([item("1")], { "1": { ...est("1", "reach", 3, "improves"), label: "elite" } as EstimateResult }, schools, opts()).length, 1, "elite is no longer out");
  assert.equal(edOpportunities([item("4", { dream: true })], { "4": est("4", "high_reach", 3, "not_advised") }, schools, opts()).length, 1, "the Dream at High reach");
});

test("rounds: the first is ED; a later one is ED II only when offered and its deadline is after the first's ED notification; else ed_alt", () => {
  const schools = by([ps("1"), ps("2", { ed2: true }), ps("3", { ed2: true, ed2Closing: md(12, 1) }), ps("4")]);
  const items = ["1", "2", "3", "4"].map((u) => item(u));
  const e = { "1": est("1", "reach", 3), "2": est("2", "reach", 2), "3": est("3", "target", 0), "4": est("4", "target", 1) };
  const got = edOpportunities(items, e, schools, opts());
  assert.deepEqual(got.map((c) => [c.unitId, c.round]), [["1", "ed"], ["2", "ed2"], ["3", "ed_alt"]], "ED II due Dec 1 is before the Dec 15 notification; the fourth is past the cap");
  // No published notification at the ED college: ED II can't be shown to come after, so it's an alternative.
  const noNote = by([ps("1", { edNotification: null }), ps("2", { ed2: true })]);
  assert.deepEqual(edOpportunities([item("1"), item("2")], e, noNote, opts()).map((c) => c.round), ["ed", "ed_alt"]);
});

test("a row the student set in ED is the ED college and stays a candidate (confirmation); the others read against it", () => {
  const schools = by([ps("1", { ed2: true }), ps("2", { ed2: true })]);
  const e = { "1": est("1", "reach", 3), "2": est("2", "target", 0) };
  const got = edOpportunities([item("1"), item("2", { round: "ed", round_source: "student" })], e, schools, opts());
  assert.deepEqual(got.map((c) => [c.unitId, c.round]), [["1", "ed2"], ["2", "ed"]]);
});

test("dismissal removes the college and the next one moves up", () => {
  const schools = by(["1", "2", "3", "4"].map((u) => ps(u)));
  const e = { "1": est("1", "reach", 3), "2": est("2", "reach", 2), "3": est("3", "target", 0), "4": est("4", "target", 1) };
  const items = ["1", "2", "3", "4"].map((u) => item(u, { ed_dismissed_at: u === "1" ? "2027-06-01T00:00:00Z" : null }));
  const got = edOpportunities(items, e, schools, opts());
  assert.deepEqual(ids(got), ["2", "3", "4"]);
  assert.equal(got[0].round, "ed");
  assert.deepEqual(edDismissedItemIds(items), ["item-1"]);
});

test("the junior-fall gate (junior spring until 2026-10-15): nothing in sophomore year, pills from junior fall, nothing without a class year", () => {
  const schools = by([ps("1")]);
  const e = { "1": est("1", "reach", 3) };
  // Sophomore year for the class of G (the summer before junior year is still "sophomore"): nothing.
  assert.equal(seasonOf(G, `${G - 2}-07-10`), "sophomore");
  assert.deepEqual(edOpportunities([item("1")], e, schools, { season: seasonOf(G, `${G - 2}-07-10`), today: `${G - 2}-07-10` }), []);
  // Junior fall and winter: the pill.
  assert.equal(seasonOf(G, `${G - 2}-10-15`), "junior_fall");
  assert.equal(edOpportunities([item("1")], e, schools, { season: "junior_fall", today: `${G - 2}-10-15` }).length, 1);
  assert.equal(edOpportunities([item("1")], e, schools, { season: seasonOf(G, "2027-02-10"), today: "2027-02-10" }).length, 1);
  assert.equal(edOpportunities([item("1")], e, schools, opts(JUNIOR_SPRING)).length, 1);
  assert.deepEqual(edOpportunities([item("1")], e, schools, { season: "unknown", today: SUMMER }), []);
});

test("the post-deadline close: ED pills go after the ED deadline, ED II after the ED II deadline, then nothing", () => {
  const schools = by([ps("1"), ps("2", { ed2: true })]);
  const e = { "1": est("1", "reach", 3), "2": est("2", "reach", 2) };
  const items = [item("1"), item("2")];
  assert.deepEqual(edOpportunities(items, e, schools, opts("2027-10-31")).map((c) => c.round), ["ed", "ed2"]);
  assert.deepEqual(edOpportunities(items, e, schools, opts("2027-11-02")).map((c) => [c.unitId, c.round]), [["2", "ed2"]]);
  assert.deepEqual(edOpportunities(items, e, schools, opts("2028-01-02")), []);
});

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

test("ed_decide: from the summer before senior year, due the ED college's closing, cited, opening its sheet; gone once a binding round is the student's", () => {
  const schools = by([ps("1"), ps("2")]);
  const e = { "1": est("1", "reach", 3), "2": est("2", "target", 0) };
  const items = [item("1"), item("2")];
  const spring = input(JUNIOR_SPRING, items, schools, e);
  assert.deepEqual(edMoves(spring, edOpportunities(items, e, schools, opts(JUNIOR_SPRING))), [], "not in junior spring");
  const inp = input(SUMMER, items, schools, e);
  const moves = edMoves(inp, edOpportunities(items, e, schools, opts()));
  assert.equal(moves.length, 1);
  const m = moves[0];
  assert.equal(m.key, `${LIST}:ed_decide:-`);
  assert.equal(m.title, "Decide on ED (due Nov 1)");
  assert.equal(m.due_on, "2027-11-01");
  assert.equal(m.source_field, "reported.admission_profile.early_decision.first.closing");
  assert.equal(m.assignee, "either");
  assert.deepEqual(m.action, { kind: "open_row", itemId: "item-1", panel: "ed" });
  const chosen = [item("1"), item("2", { round: "ed2", round_source: "student" })];
  assert.deepEqual(edMoves(input(SUMMER, chosen, schools, e), edOpportunities(chosen, e, schools, opts())), [], "ticked by no longer being emitted");
});

test("ed2_decide: once the ED college defers or denies, for an ED II candidate, due its ED II closing", () => {
  const schools = by([ps("1"), ps("2", { ed2: true }), ps("3")]);
  const e = { "1": est("1", "reach", 3), "2": est("2", "reach", 2), "3": est("3", "target", 0) };
  const today = "2027-12-16";
  for (const ed of [
    item("1", { round: "ed", round_source: "student", status: "decided", outcome: "denied", decision_date: "2027-12-15" }),
    item("1", { round: "ed", round_source: "student", status: "applied", outcome: null, decision_date: "2027-12-15" }),
  ]) {
    const items = [ed, item("2"), item("3")];
    const moves = edMoves(input(today, items, schools, e), edOpportunities(items, e, schools, opts(today)));
    assert.deepEqual(moves.map((m) => m.key), [`${LIST}:ed2_decide:item-2`]);
    assert.equal(moves[0].title, "College 1 said no. ED II at College 2 is due Jan 1.");
    assert.equal(moves[0].due_on, "2028-01-01");
  }
  const waiting = [item("1", { round: "ed", round_source: "student", status: "applied" }), item("2"), item("3")];
  assert.deepEqual(edMoves(input(today, waiting, schools, e), edOpportunities(waiting, e, schools, opts(today))), [], "nothing while ED is undecided");
});

test("cost_check per candidate from the summer before senior year, keyed :candidate, assigned to a guardian, replacing the round-keyed one", () => {
  const schools = by([ps("1"), ps("2")]);
  const e = { "1": est("1", "reach", 3), "2": est("2", "target", 0) };
  const items = [item("1", { round: "ed", round_source: "student" }), item("2")];
  const tasks = roundsGenerate(input(SUMMER, items, schools, e));
  assert.deepEqual(tasks.map((t) => t.key).sort(), [`${LIST}:cost_check:item-1:candidate`, `${LIST}:cost_check:item-2:candidate`]);
  assert.ok(tasks.every((t) => t.assignee === "guardian" && t.due_on === "2027-10-11"));
  // Junior spring: only the built round-keyed check for the row in ED.
  assert.deepEqual(roundsGenerate(input(JUNIOR_SPRING, items, schools, e)).map((t) => t.key), [`${LIST}:cost_check:item-1:ed`]);
});

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

test("the sheet: Quad's read per round, the college's own counts cited, together, the caveat, three questions, dates, the profile link", () => {
  const school = ps("1", { ed2: true, counts: [1690, 412], totals: [20000, 2000] });
  const ed = edSheetFacts(item("1"), school, est("1", "reach", 3), "ed")!;
  assert.equal(ed.read, "Early decision would move this toward Target; it's binding, so check the cost first.");
  assert.equal(ed.reported, "ED admitted 412 of 1,690 (24%) against 10% overall");
  assert.equal(ed.lineage, "same document");
  assert.equal(ed.edition, "2026–27");
  assert.ok(ed.together);
  assert.equal(ed.closing?.label, "Nov 1");
  assert.equal(ed.questions.length, 3);
  assert.equal(ed.questions[2].text, "Can the application be ready by mid-October?");
  assert.equal(ed.profileHref, "/schools/1/admissions#early");
  assert.equal(ed.onPlan, false);
  const ed2 = edSheetFacts(item("1"), school, est("1", "reach", 3), "ed2")!;
  assert.match(ed2.read, /Early decision II too, though less: College 1 reports its ED rounds together/);
  assert.equal(ed2.questions[2].text, "Can the application be ready by Jan 1?");
  const alt = edSheetFacts(item("1"), school, est("1", "target", 0), "ed_alt")!;
  assert.match(alt.read, /toward Likely/);
  assert.match(alt.read, /binding at one college only/);
  // Overall rate from another release when the totals aren't from the counts' document.
  const other = edSheetFacts(item("1"), ps("1", { totals: null }), est("1", "reach", 3))!;
  assert.equal(other.lineage, "overall rate from 2024");
  assert.equal(edSheetFacts(item("1", { round: "ed" }), school, est("1", "reach", 3))!.onPlan, true, "Keep ED");
  assert.equal(ed.readBasis, null, "helps rests on the estimate's own sentence");
});

test("the sheet's read by verdict: improves cites the college's ED rate line; null says the counts aren't published; the High-reach Dream spends the chip", () => {
  const school = ps("1", { ed2: true, counts: [1690, 412], totals: [20000, 2000] });
  const improves = edSheetFacts(item("1"), school, est("1", "reach", 3, "improves"), "ed")!;
  assert.equal(improves.read, "Early decision improves your chance here without changing where it stands for you; it's binding, so check the cost first.");
  assert.match(improves.readBasis ?? "", /^ED admitted 24% vs \d+(\.\d+)?% \w+ \(CDS 2026–27\)$/);
  assert.equal(improves.countsField, "reported.admission_profile.early_decision.admitted", "cited by the counts' field");
  assert.match(edSheetFacts(item("1"), school, est("1", "reach", 3, "improves"), "ed2")!.read, /check the cost first\. Early decision II too, though less/);
  const hr = edSheetFacts(item("1", { dream: true }), school, est("1", "high_reach", null, "not_advised"), "ed")!;
  assert.equal(
    hr.read,
    "Early decision is binding and helps most where you're already in range; this college isn't one of them yet. If College 1 is where you'd go regardless, early decision is still your one binding chip to spend.",
  );
  assert.equal(hr.levelLabel, "High reach");
  // The owner's framing under the read, for every verdict.
  for (const v of ["helps", "improves", null, "not_advised"] as const)
    assert.equal(edSheetFacts(item("1"), school, est("1", "reach", 3, v), "ed")!.framing, "Early decision is one binding application; it's free to use once.");
  const none = edSheetFacts(item("1"), ps("1", { ed2: true, counts: null }), est("1", "reach", 3, null), "ed")!;
  assert.equal(none.read, "College 1 offers early decision but hasn't published how its early applicants fare; a binding application still says you'd come. Check the cost first.");
  assert.equal(none.readBasis, null);
  assert.equal(none.noCounts, "ED offered; College 1 hasn't published its ED counts");
  assert.match(edSheetFacts(item("1"), ps("1", { ed2: true, counts: null }), est("1", "reach", 3, null), "ed2")!.read, /fare; .* Early decision II is binding too\.$/);
  assert.match(edSheetFacts(item("1"), school, est("1", "target", 0, "improves"), "ed_alt")!.read, /binding at one college only/);
});

test("the pill's words by verdict: Good at helps, plain at improves, null, and the High-reach Dream; ED / ED II on a phone", () => {
  assert.equal(edPillText("ed", "helps").full, "Good ED opportunity");
  assert.equal(edPillText("ed2", "helps").full, "Good ED II opportunity");
  assert.equal(edPillText("ed_alt", "helps").full, "Good ED opportunity");
  for (const v of ["improves", null, "not_advised"] as const) {
    assert.equal(edPillText("ed", v).full, "ED opportunity");
    assert.equal(edPillText("ed2", v).full, "ED II opportunity");
    assert.equal(edPillText("ed_alt", v).full, "ED opportunity");
  }
  assert.deepEqual([edPillText("ed", "improves").short, edPillText("ed2", null).short, edPillText("ed2", "helps").short], ["ED", "ED II", "ED II"]);
});

/** Every string a pill or sheet shows. */
function sheetStrings(f: EdSheetFacts): string[] {
  return [f.read, f.readBasis, f.framing, f.reported, f.lineage, f.share, f.noCounts, ...f.questions.map((q) => q.text), f.closing?.label, f.notification?.label, f.dateNote, f.profileLabel, f.levelLabel].filter(
    (x): x is string => typeof x === "string",
  );
}

/** The guard: no "×", no "odds", and no percentage except the college's own cited rates (the reported line and share). */
function badStrings(strings: string[], allowedPercents: string[]): string[] {
  return strings.filter((s) => /×|\bodds\b/i.test(s) || [...s.matchAll(/\d+(\.\d+)?%/g)].some((m) => !allowedPercents.includes(m[0])));
}

/** The college's own rates a sheet may show: ED 24%, overall 10%, the share line's, and the non-ED rate in the read's basis. */
function ownRates(f: EdSheetFacts): string[] {
  const own = (x: string | null) => [...(x ?? "").matchAll(/\d+(\.\d+)?%/g)].map((m) => m[0]);
  return ["24%", "10%", ...own(f.share), ...own(f.readBasis?.replace(/^ED admitted 24%/, "") ?? null)];
}

test("guard: no pill or sheet string carries a number from the estimate, a ×, or 'odds'", () => {
  const pill = [...Object.values(ED_PILL_TEXT), ...Object.values(ED_PILL_TEXT_PLAIN)].flatMap((t) => [t.full, t.short]);
  assert.deepEqual(badStrings(pill, []), []);
  assert.ok(pill.every((t) => !/\d/.test(t)), "a pill carries no number at all");
  assert.deepEqual(badStrings([ED_CAVEAT.before + ED_CAVEAT.term + ED_CAVEAT.after], []), []);
  for (const verdict of ["helps", "improves", "same", null, "not_advised"] as const) {
    for (const round of ["ed", "ed2", "ed_alt"] as const) {
      const level = verdict === "not_advised" ? "high_reach" : "reach";
      const f = edSheetFacts(item("1"), ps("1", { ed2: true, counts: verdict === null ? null : [1690, 412], totals: [20000, 2000] }), est("1", level, 3, verdict), round)!;
      const allowed = ownRates(f);
      assert.deepEqual(badStrings(sheetStrings(f), allowed), [], `${verdict} ${round}`);
    }
  }
});

test("the guard fails on a planted bad string", () => {
  assert.equal(badStrings(["Your odds are good"], []).length, 1);
  assert.equal(badStrings(["2.7× the rate"], []).length, 1);
  assert.equal(badStrings(["A 63% chance"], ["24%"]).length, 1);
  // Planted into a real sheet: a read that leaks the estimate's number is caught.
  const f = edSheetFacts(item("1"), ps("1", { counts: [1690, 412], totals: [20000, 2000] }), est("1", "reach", 3, "improves"), "ed")!;
  assert.deepEqual(badStrings(sheetStrings(f), ownRates(f)), []);
  assert.equal(badStrings(sheetStrings({ ...f, read: `${f.read} Your chance rises to 41%.` }), ownRates(f)).length, 1);
  // The new sentences: an improves read or a framing line that names the multiple or the odds is caught.
  assert.equal(badStrings(sheetStrings({ ...f, read: `${f.read} About 1.4× better odds.` }), ownRates(f)).length, 1);
  assert.equal(badStrings(sheetStrings({ ...f, framing: `${f.framing} It lifts you to 12%.` }), ownRates(f)).length, 1);
  const hr = edSheetFacts(item("1", { dream: true }), ps("1", { counts: [1690, 412], totals: [20000, 2000] }), est("1", "high_reach", null, "not_advised"), "ed")!;
  assert.deepEqual(badStrings(sheetStrings(hr), ownRates(hr)), []);
  assert.equal(badStrings(sheetStrings({ ...hr, read: `${hr.read} Still under 3%.` }), ownRates(hr)).length, 1);
});
