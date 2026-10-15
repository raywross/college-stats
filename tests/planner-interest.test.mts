/**
 * Interest and visits (lib/planner/interest.ts; specs/planner/next-steps/interest-and-visits.md): each rule, the
 * upper-Target / lower-Reach band, the three-cap and its ordering, a logged act (visit, info request, or follow)
 * closing a move, never for `not_considered` or an unpublished C7, the senior-fall dating, the ED-candidate visit
 * without a C7 answer, a dismissed ED candidate's visit move for the season it was dismissed in only, the
 * season-keyed task so a skipped move returns next season, and a guard that no card string carries a percentage,
 * a multiple, or "odds". `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { interestMoves, interestMoveText, interestTasks, INTEREST_MAX, type InterestMove } from "../lib/planner/interest.ts";
import { edOpportunities } from "../lib/planner/ed-opportunities.ts";
import { MOVE_TEXT } from "../lib/planner/moves-catalog.ts";
import { hooksFromPlan } from "../lib/planner/hooks.ts";
import { loadCycle, cycleFor } from "../lib/planner/cycle.ts";
import { gradeOf, seasonOf } from "../lib/planner/seasons.ts";
import type { EstimateResult, StandingLevel } from "../lib/chances/types.ts";
import type { FactorImportance } from "../lib/types.ts";
import type { GeneratorInput, PlanItem, PlanSchool, PlanVisit } from "../lib/planner/types.ts";

const LIST = "list-1";
const G = 2028;
const JUNIOR_FALL = "2026-10-01";
const JUNIOR_SPRING = "2027-04-15";
const SUMMER = "2027-07-01";
const SENIOR_FALL = "2027-10-10";
const md = (month: number, day: number) => ({ month, day });

interface SchoolOpts {
  ed?: boolean;
  interest?: FactorImportance | null;
  edClosing?: { month: number; day: number };
}

function ps(id: string, o: SchoolOpts = {}): PlanSchool {
  const ed = o.ed ?? true;
  return {
    unit_id: id,
    name: `College ${id}`,
    admitRate: 0.3,
    admitRateCite: { year: "2024" },
    profile: {
      early_decision: ed ? { offered: true, first: { closing: o.edClosing ?? md(11, 1), notification: md(12, 15) }, applicants: 1000, admitted: 240 } : { offered: false, applicants: null, admitted: null },
      factors: o.interest !== undefined ? { interest: o.interest } : undefined,
    },
    logistics: null,
    cycleStartYear: 2027,
    editionIsLastCycle: false,
    cites: { "reported.admission_profile.factors.interest": { cdsEdition: "2026–27" } },
    edTotals: { applicants: 10000, admitted: 1000, enrolled: 500 },
    links: { visit: "https://example.edu/visit", admissions: "https://example.edu/apply" },
    social: null,
  } as unknown as PlanSchool;
}

const est = (unitId: string, group: StandingLevel | null, closeness: EstimateResult["closeness"], ed: EstimateResult["ed"] = "helps", label: EstimateResult["label"] = null): EstimateResult =>
  ({ unitId, group, label, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, closeness, ed, modelVersion: "t" }) as EstimateResult;

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
    visited_on: null,
    info_requested_on: null,
    followed_networks: [],
    ...over,
  }) as unknown as PlanItem;

const by = (schools: PlanSchool[]) => Object.fromEntries(schools.map((s) => [s.unit_id, s]));
const opts = (today = SUMMER) => ({ season: seasonOf(G, today), today });

function input(today: string, items: PlanItem[], schools: Record<string, PlanSchool>, estimates: Record<string, EstimateResult>, visits: PlanVisit[] = []): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: "2026-10-14T00:00:00Z", sort: null, rounds_plan_accepted_at: null },
    items,
    schools,
    profile: null,
    cycle: loadCycle(cycleFor(G)),
    grade: gradeOf(G, today),
    today,
    visits,
    offers: [],
    gradYear: G,
    season: seasonOf(G, today),
    estimates,
  } as GeneratorInput;
}

const ids = (ms: readonly InterestMove[]) => ms.map((m) => m.itemId);

/* ------------------------------------------------------------------ */
/* Rule 1: ED candidates                                               */
/* ------------------------------------------------------------------ */

test("rule 1: every ED candidate gets a visit move, regardless of C7, while no interest is logged", () => {
  const schools = by([ps("1", { interest: "not_considered" })]);
  const e = { "1": est("1", "reach", 3) };
  const items = [item("1")];
  const edCands = edOpportunities(items, e, schools, opts());
  assert.equal(edCands.length, 1, "setup: a candidate");
  const moves = interestMoves(items, e, schools, {}, edCands, opts());
  assert.deepEqual(moves, [{ itemId: "item-1", rule: "visit_ed", kind: "visit_ed" }]);
});

test("rule 1 gate: follows the ED pills (junior fall since 2026-10-15); nothing in sophomore year", () => {
  const schools = by([ps("1")]);
  const e = { "1": est("1", "reach", 3) };
  const items = [item("1")];
  const sophomore = { season: "sophomore" as const, today: "2026-07-10" };
  assert.deepEqual(edOpportunities(items, e, schools, sophomore), [], "setup: ED itself not yet shown");
  assert.deepEqual(interestMoves(items, e, schools, {}, [], sophomore), []);
  // Junior fall: the pill exists, so its visit move does too.
  const edCands = edOpportunities(items, e, schools, opts(JUNIOR_FALL));
  assert.equal(edCands.length, 1);
  assert.deepEqual(interestMoves(items, e, schools, {}, edCands, opts(JUNIOR_FALL)).map((m) => m.kind), ["visit_ed"]);
});

/* ------------------------------------------------------------------ */
/* Rule 2: important / very important                                  */
/* ------------------------------------------------------------------ */

test("rule 2: important or very important, at any Reach or Target, from junior fall", () => {
  const schools = by([ps("1", { ed: false, interest: "important" }), ps("2", { ed: false, interest: "very_important" })]);
  const e = { "1": est("1", "reach", 0), "2": est("2", "target", 3) };
  const items = [item("1"), item("2")];
  assert.deepEqual(interestMoves(items, e, schools, {}, [], opts(JUNIOR_FALL)).map((m) => [m.itemId, m.rule, m.kind]).sort(), [
    ["item-1", "important", "show_interest"],
    ["item-2", "important", "show_interest"],
  ]);
  // Not yet in the fall before junior fall (freshman/sophomore have no college-specific moves).
  assert.deepEqual(interestMoves(items, e, schools, {}, [], { season: "sophomore", today: "2025-10-01" }), []);
});

/* ------------------------------------------------------------------ */
/* Rule 3: considered, the upper-Target / lower-Reach band             */
/* ------------------------------------------------------------------ */

test("rule 3: considered only in the band (Reach 3,2 or Target 0,1), from junior spring", () => {
  const schools = by(["1", "2", "3", "4"].map((u) => ps(u, { ed: false, interest: "considered" })));
  const e = { "1": est("1", "reach", 3), "2": est("2", "reach", 1), "3": est("3", "target", 0), "4": est("4", "target", 2) };
  const items = ["1", "2", "3", "4"].map((u) => item(u));
  const moves = interestMoves(items, e, schools, {}, [], opts(JUNIOR_SPRING));
  assert.deepEqual(ids(moves).sort(), ["item-1", "item-3"], "only the band");
  // Rule 3 waits for junior spring even though rule 2's gate (junior fall) has passed.
  const consideredBand = interestMoves(items, e, schools, {}, [], opts(JUNIOR_FALL));
  assert.deepEqual(consideredBand, []);
});

test("never for not_considered, no C7, High reach, Likely, Safe, or an elite label", () => {
  const schools = by([
    ps("1", { ed: false, interest: "not_considered" }),
    ps("2", { ed: false, interest: undefined }),
    ps("3", { ed: false, interest: "very_important" }),
    ps("4", { ed: false, interest: "very_important" }),
    ps("5", { ed: false, interest: "very_important" }),
    ps("6", { ed: false, interest: "very_important" }),
  ]);
  const e = {
    "1": est("1", "reach", 3),
    "2": est("2", "reach", 3),
    "3": est("3", "high_reach", 3),
    "4": est("4", "likely", 3),
    "5": est("5", "safe", 3),
    "6": est("6", "reach", 3, "helps", "elite"),
  };
  const items = ["1", "2", "3", "4", "5", "6"].map((u) => item(u));
  assert.deepEqual(interestMoves(items, e, schools, {}, [], opts(JUNIOR_SPRING)), []);
});

/* ------------------------------------------------------------------ */
/* Closing on a logged act                                             */
/* ------------------------------------------------------------------ */

test("a logged visit, info request, or follow closes the move (hooks.interest, any of the three)", () => {
  const schools = by([ps("1", { ed: false, interest: "important" }), ps("2", { ed: false, interest: "important" }), ps("3", { ed: false, interest: "important" })]);
  const e = { "1": est("1", "reach", 3), "2": est("2", "reach", 3), "3": est("3", "reach", 3) };
  const items = [item("1", { visited_on: "2027-04-01" }), item("2", { info_requested_on: "2027-04-01" }), item("3", { followed_networks: ["instagram"] })];
  const hooks = hooksFromPlan(items, []);
  assert.deepEqual(interestMoves(items, e, schools, hooks, [], opts(JUNIOR_SPRING)), [], "all three close it");
});

test("a planned future visit (no past visit) still counts as logged", () => {
  const schools = by([ps("1", { ed: false, interest: "important" })]);
  const e = { "1": est("1", "reach", 3) };
  const items = [item("1")];
  const futureVisit: PlanVisit = { id: "v1", item_id: "item-1", kind: "campus_tour", on_date: "2099-01-01", at_time: null, registered: false, registration_url: null, who: [], rating: null, notes: {}, created_by: null, created_at: "", updated_at: "" };
  const hooks = hooksFromPlan(items, [futureVisit]);
  assert.deepEqual(interestMoves(items, e, schools, hooks, [], opts(JUNIOR_SPRING)), []);
});

/* ------------------------------------------------------------------ */
/* The three-cap and its ordering                                      */
/* ------------------------------------------------------------------ */

test("the three-cap: rule 1 first (its own rank), then rule 2, then rule 3; the rest wait", () => {
  const edSchool = ps("ed1", { interest: "important" });
  const importantSchools = ["i1", "i2"].map((u) => ps(u, { ed: false, interest: "important" }));
  const consideredSchool = ps("c1", { ed: false, interest: "considered" });
  const schools = by([edSchool, ...importantSchools, consideredSchool]);
  const e = {
    ed1: est("ed1", "reach", 3),
    i1: est("i1", "reach", 0),
    i2: est("i2", "target", 0),
    c1: est("c1", "reach", 3),
  };
  const items = ["ed1", "i1", "i2", "c1"].map((u) => item(u));
  const edCands = edOpportunities(items, e, schools, opts());
  const moves = interestMoves(items, e, schools, {}, edCands, opts());
  assert.equal(moves.length, INTEREST_MAX);
  assert.deepEqual(
    moves.map((m) => m.rule),
    ["visit_ed", "important", "important"],
    "the ED candidate first, then the two important colleges; the considered one waits",
  );
});

/* ------------------------------------------------------------------ */
/* The ED-candidate visit without C7, and a dismissed candidate         */
/* ------------------------------------------------------------------ */

test("the ED-candidate visit fires with no C7 answer at all", () => {
  const schools = by([ps("1", { interest: undefined })]);
  const e = { "1": est("1", "target", 0) };
  const items = [item("1")];
  const edCands = edOpportunities(items, e, schools, opts());
  assert.deepEqual(interestMoves(items, e, schools, {}, edCands, opts()).map((m) => m.rule), ["visit_ed"]);
});

test("a dismissed ED candidate's visit move persists for the season it was dismissed in, then stops", () => {
  const schools = by([ps("1")]);
  const e = { "1": est("1", "reach", 3) };
  const dismissedInSummer = item("1", { ed_dismissed_at: "2027-06-15T00:00:00Z" });
  // edOpportunities itself excludes the dismissed row; interestMoves still offers its visit move this season.
  assert.deepEqual(edOpportunities([dismissedInSummer], e, schools, opts(SUMMER)), []);
  const stillSummer = interestMoves([dismissedInSummer], e, schools, {}, [], opts(SUMMER));
  assert.deepEqual(stillSummer, [{ itemId: "item-1", rule: "visit_ed", kind: "visit_ed" }]);
  // Later (senior fall is a different quarter window), the dismissal no longer carries the visit move: nothing
  // from rule 1 — and with no C7 answer, nothing from rules 2 or 3 either.
  const laterSeason = interestMoves([dismissedInSummer], e, schools, {}, [], opts(SENIOR_FALL));
  assert.deepEqual(laterSeason, []);
});

/* ------------------------------------------------------------------ */
/* Tasks: text, citation, season-keyed dismissal, senior-fall dating    */
/* ------------------------------------------------------------------ */

test("interestTasks: title and why from MOVE_TEXT, keyed by item and season, source_field cited for show_interest", () => {
  const schools = by([ps("1", { ed: false, interest: "important" })]);
  const e = { "1": est("1", "reach", 0) };
  const items = [item("1")];
  const moves: InterestMove[] = [{ itemId: "item-1", rule: "important", kind: "show_interest" }];
  const inp = input(JUNIOR_FALL, items, schools, e);
  const tasks = interestTasks(inp, moves);
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.key, `${LIST}:show_interest:item-1:${inp.season}`);
  assert.equal(t.item_id, "item-1");
  assert.equal(t.title, "Show College 1 you're interested");
  assert.equal(t.detail, "College 1 says applicant interest is important.");
  assert.equal(t.source_field, "reported.admission_profile.factors.interest");
  assert.equal(t.source_edition, "2026–27");
  assert.equal(t.assignee, "either");
  assert.deepEqual(t.action, { kind: "open_row", itemId: "item-1", panel: "capture" });
  assert.equal(t.due_on, null, "undated outside senior fall");
});

test("visit_ed's why is the binding round, not interest, and carries no citation", () => {
  const schools = by([ps("1")]);
  const text = interestMoveText({ kind: "visit_ed" }, schools["1"]);
  assert.equal(text.title, "Visit College 1 before you decide on a binding round");
  assert.match(text.why, /binding/);
  assert.equal(text.sourceField, null);
});

test("the season-keyed task: a skipped move returns next season while the condition holds", () => {
  const schools = by([ps("1", { ed: false, interest: "important" })]);
  const e = { "1": est("1", "reach", 0) };
  const items = [item("1")];
  const moves: InterestMove[] = [{ itemId: "item-1", rule: "important", kind: "show_interest" }];
  const fall = interestTasks(input(JUNIOR_FALL, items, schools, e), moves);
  const winter = interestTasks(input("2027-01-15", items, schools, e), moves);
  assert.notEqual(fall[0].key, winter[0].key, "a different season, a different key");
});

test("senior-fall dating: due 14 days before the chosen round's deadline, cited; closed once it's passed", () => {
  const schools = by([ps("1", { ed: false, interest: "important", edClosing: md(11, 1) })]);
  schools["1"].logistics = { regular_closing: md(11, 1), notification: { kind: "by_date", by_date: md(1, 15) }, edition: "2026–27" } as unknown as PlanSchool["logistics"];
  const e = { "1": est("1", "reach", 0) };
  const items = [item("1", { round: "rd" })];
  const moves: InterestMove[] = [{ itemId: "item-1", rule: "important", kind: "show_interest" }];
  const beforeDeadline = interestTasks(input(SENIOR_FALL, items, schools, e), moves);
  assert.equal(beforeDeadline.length, 1);
  assert.equal(beforeDeadline[0].due_on, "2027-10-18", "14 days before Nov 1");
  assert.equal(beforeDeadline[0].source_field, "reported.admissions_logistics.regular_closing");
  const afterDeadline = interestTasks(input("2027-11-05", items, schools, e), moves);
  assert.deepEqual(afterDeadline, [], "closed after the deadline");
});

/* ------------------------------------------------------------------ */
/* The guard: no number from the estimate in any card string            */
/* ------------------------------------------------------------------ */

function numberProblems(text: string): string[] {
  const problems: string[] = [];
  if (/%|percent/i.test(text)) problems.push("a percentage");
  if (/×|\b\d+x\b/i.test(text)) problems.push("a multiple");
  if (/\bodds\b/i.test(text)) problems.push("odds");
  if (/\bchances?\b/i.test(text)) problems.push("chance");
  return problems;
}

test("guard: no interest.ts card string carries a percentage, a multiple, odds, or chance", () => {
  const schools = by([ps("1", { ed: false, interest: "very_important" }), ps("2", { ed: false, interest: "considered" })]);
  const strings = [
    MOVE_TEXT.visit_ed.title,
    MOVE_TEXT.visit_ed.why,
    MOVE_TEXT.show_interest.title,
    MOVE_TEXT.show_interest.why,
    interestMoveText({ kind: "visit_ed" }, schools["1"]).why,
    interestMoveText({ kind: "show_interest" }, schools["1"]).why,
    interestMoveText({ kind: "show_interest" }, schools["2"]).why,
    "A registered visit or information session counts most; then contact or an information request; then opening its email; follows last.",
  ];
  const bad = strings.flatMap((s) => numberProblems(s).map((p) => `${p}: ${s}`));
  assert.deepEqual(bad, []);
});

test("the guard fails on a planted bad string", () => {
  assert.ok(numberProblems("A 40% chance this visit helps").length > 0);
  assert.ok(numberProblems("Your odds improve 2× with a visit").length > 0);
});

test("the list's interest pill is the open move itself (interest-and-visits.md 'The pill'), never a second computation of the rule", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(import.meta.dirname, "..", "components", "planner", "PlanList.tsx"), "utf8");
  assert.match(src, /ctx\.tasks\.filter\(\(t\) => \(t\.kind === "show_interest" \|\| t\.kind === "visit_ed"\)/, "the pill reads the open show_interest / visit_ed rows");
  assert.doesNotMatch(src, /interestMoves\(/, "PlanList no longer recomputes the rule (QA 2026-10-15: it drifted from the generated set)");
});
