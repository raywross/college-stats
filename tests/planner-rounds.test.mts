/**
 * Stage 2, priorities and rounds (lib/planner/rounds.ts, lib/planner/generators/rounds.ts; specs/planner/early-rounds.md):
 * rounds offered and their dates, the priority order, the proposal's six rules over the spec's five fixtures (a Dream
 * that offers ED; a Dream that is REA-only; an ED II due before the ED I decision; no estimates; an import with a round
 * the college dropped), every conflict rule on and off, the checklist, the summary, the decide-rounds step, and the
 * priority attribution trigger (supabase/migrations/20261008133000_planner_rounds.sql) in PGlite. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, affectedAsUser, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import {
  bindingChecklist,
  conflicts,
  cycleLabel,
  earliestEarlyDeadline,
  earlyFor,
  isOffered,
  lastCycleNote,
  priorityOrder,
  proposeRounds,
  redConflictCount,
  resolveMonthDay,
  roundDates,
  roundsOffered,
  roundsSummary,
  standingFor,
  type ConflictKind,
  type MoneyInput,
  type RoundsItem,
  type RoundsSchool,
  type Standing,
} from "../lib/planner/rounds.ts";
import { DECIDE_ROUNDS_LEAD_DAYS, generate } from "../lib/planner/generators/rounds.ts";
import { stageOf } from "../lib/planner/stage.ts";
import type { GeneratorInput, PlanSchool } from "../lib/planner/types.ts";
import type { ReportedAdmissionProfile, ReportedLogistics } from "../lib/types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const START = 2026;
const md = (month: number, day: number) => ({ month, day });

const ED = (over: Partial<NonNullable<ReportedAdmissionProfile["early_decision"]>> = {}): NonNullable<ReportedAdmissionProfile["early_decision"]> => ({
  offered: true,
  first: { closing: md(11, 1), notification: md(12, 15) },
  applicants: null,
  admitted: null,
  ...over,
});
const EA = (restrictive = false, over: Partial<NonNullable<ReportedAdmissionProfile["early_action"]>> = {}) => ({ offered: true, closing: md(11, 1), notification: md(12, 15), restrictive, ...over });
const NO_EA = { offered: false, closing: null, notification: null, restrictive: null };
const NO_ED = { offered: false, applicants: null, admitted: null };

const logistics = (over: Partial<ReportedLogistics> = {}): ReportedLogistics => ({
  cycle: `Fall ${START + 1}`,
  edition: `${START}-${(START + 1) % 100}`,
  fee: null,
  regular_closing: md(1, 1),
  priority_date: null,
  other_terms: null,
  notification: { kind: "by_date", rolling_from: null, by_date: md(4, 1), other_date: null, other_text: null },
  reply: null,
  housing_deposit: null,
  deferred_admission: null,
  ...over,
});

function school(id: string, name: string, profile: ReportedAdmissionProfile | null, over: Partial<RoundsSchool> = {}): RoundsSchool {
  return {
    unit_id: id,
    name,
    profile,
    logistics: logistics(),
    cycleStartYear: START,
    editionIsLastCycle: false,
    cites: {},
    admitRate: 0.3,
    avgCost: 30000,
    links: { website: `https://${id}.edu`, price_calculator: `https://${id}.edu/npc`, admissions: `https://${id}.edu/admissions` },
    type: "private-nonprofit",
    edTotals: null,
    ...over,
  };
}

let n = 0;
function item(unit_id: string, over: Partial<RoundsItem> = {}): RoundsItem {
  n++;
  return { id: `i${n}-${unit_id}`, unit_id, category: "target", status: "considering", outcome: null, round: null, position: n, dream: false, priority: null, ...over };
}

const standingOf = (items: RoundsItem[], schools: Record<string, RoundsSchool>): Record<string, Standing> =>
  Object.fromEntries(items.map((i) => [i.id, standingFor(i, schools[i.unit_id])]));
const by = <T extends { unit_id: string }>(list: T[]) => Object.fromEntries(list.map((s) => [s.unit_id, s]));
const roundOf = (p: ReturnType<typeof proposeRounds>, id: string) => p.lines.find((l) => l.itemId === id)!;

/* ------------------------------------------------------------------ */
/* Offered and dates                                                   */
/* ------------------------------------------------------------------ */

test("rounds offered: ED and ED II from C21, EA or REA from C22, rolling and RD from C16/C14; unpublished stays pickable", () => {
  const s = school("1", "A", { early_decision: ED({ other: { closing: md(1, 2), notification: md(2, 15) } }), early_action: NO_EA });
  assert.deepEqual(roundsOffered(s).offered, ["ed", "ed2", "rd"]);
  assert.deepEqual(roundsOffered(s).pickable, ["ed", "ed2", "rd"]);
  const rea = school("2", "B", { early_decision: NO_ED, early_action: EA(true) });
  assert.deepEqual(roundsOffered(rea).offered, ["rea", "rd"]);
  assert.equal(isOffered(rea, "ea"), false, "restrictive is REA, not EA");
  const rolling = school("3", "C", null, { logistics: logistics({ regular_closing: null, notification: { kind: "rolling", rolling_from: md(10, 1), by_date: null, other_date: null, other_text: null } }) });
  assert.deepEqual(roundsOffered(rolling).offered, ["rolling"]);
  assert.equal(isOffered(rolling, "ed"), null, "no C21: unknown, not 'no'");
  assert.deepEqual(roundsOffered(rolling).pickable, ["ed", "ed2", "rea", "ea", "rolling"]);
  const nothing = school("4", "D", null, { logistics: null });
  assert.equal(roundsOffered(nothing).published, false);
  assert.equal(roundsOffered(nothing).pickable.length, 6);
});

test("dates resolve against the student's cycle: fall in the start year, winter in the next; last-cycle editions say so", () => {
  assert.equal(resolveMonthDay(md(11, 1), START), "2026-11-01");
  assert.equal(resolveMonthDay(md(1, 15), START), "2027-01-15");
  assert.equal(resolveMonthDay({ month: null, day: 1 }, START), null);
  const s = school("1", "A", { early_decision: ED({ other: { closing: md(1, 2), notification: md(2, 15) } }) }, {
    cites: { "reported.admission_profile.early_decision.first.closing": { cdsEdition: "2025–26" } },
  });
  const d = roundDates(s, "ed");
  assert.deepEqual(d.closing, { iso: "2026-11-01", field: "reported.admission_profile.early_decision.first.closing" });
  assert.equal(d.notification?.iso, "2026-12-15");
  assert.equal(d.edition, "2025–26");
  assert.equal(d.lastCycle, true, "a 2025–26 edition describes the cycle before 2026–27");
  assert.equal(lastCycleNote(d, START), "2025–26 dates; the college hasn't published 2026–27");
  assert.equal(roundDates(s, "ed2").closing?.iso, "2027-01-02");
  assert.equal(roundDates(s, "rd").closing?.field, "reported.admissions_logistics.regular_closing");
  assert.equal(roundDates(s, "rd").edition, `${START}-${(START + 1) % 100}`, "logistics fields fall back to the block's edition");
  assert.equal(roundDates(s, "rd").lastCycle, false);
  assert.equal(cycleLabel(START), "2026–27");
});

test("priority order: the Dream first, then the student's rank, then category and position", () => {
  const a = item("a", { category: "likely", position: 1 });
  const b = item("b", { category: "reach", position: 2 });
  const c = item("c", { category: "target", position: 3, priority: 1 });
  const d = item("d", { category: "likely", position: 4, dream: true });
  assert.deepEqual(priorityOrder([a, b, c, d]).map((i) => i.unit_id), ["d", "c", "b", "a"]);
});

/* ------------------------------------------------------------------ */
/* The five fixtures                                                   */
/* ------------------------------------------------------------------ */

test("fixture 1: a Dream that offers ED gets ED I; EA goes to every college that offers it; the rest RD; each line says why", () => {
  const schools = by([
    school("dream", "Dream U", { early_decision: ED(), early_action: NO_EA, factors: {} }),
    school("ea", "EA College", { early_decision: NO_ED, early_action: EA(), factors: { interest: "considered" } }),
    school("ed-too", "Other ED", { early_decision: ED(), early_action: NO_EA }),
    school("rd", "Regular U", { early_decision: NO_ED, early_action: NO_EA }),
  ]);
  const items = [item("ea", { priority: 2 }), item("rd", { priority: 4 }), item("ed-too", { priority: 3 }), item("dream", { dream: true, priority: 1 })];
  const p = proposeRounds(items, schools, standingOf(items, schools));
  assert.deepEqual(p.order.map((id) => id.split("-").slice(1).join("-")), ["dream", "ea", "ed-too", "rd"]);
  assert.equal(roundOf(p, items[3].id).round, "ed");
  assert.match(roundOf(p, items[3].id).reason, /^ED I goes to Dream U because it's your Dream/);
  assert.equal(roundOf(p, items[0].id).round, "ea");
  assert.match(roundOf(p, items[0].id).reason, /considers interest/);
  assert.equal(roundOf(p, items[2].id).round, "rd", "only one ED I; Other ED has no other early round");
  assert.equal(roundOf(p, items[1].id).round, "rd");
  assert.equal(p.note, null, "the list is ranked");
  for (const l of p.lines) assert.doesNotMatch(l.reason, /recommend|should|odds/i);
  assert.deepEqual(conflicts(items.map((i) => ({ ...i, round: roundOf(p, i.id).round })), schools), []);
});

test("fixture 2: a Dream that is REA-only gets REA and no ED goes anywhere; private EA is flagged, public EA stays", () => {
  const schools = by([
    school("harv", "Harvard-ish", { early_decision: NO_ED, early_action: EA(true) }),
    school("ed", "ED College", { early_decision: ED(), early_action: NO_EA }),
    school("priv", "Private EA", { early_decision: NO_ED, early_action: EA() }),
    school("pub", "State U", { early_decision: NO_ED, early_action: EA() }, { type: "public" }),
  ]);
  const items = [item("harv", { dream: true }), item("ed"), item("priv"), item("pub")];
  const p = proposeRounds(items, schools, standingOf(items, schools));
  assert.equal(roundOf(p, items[0].id).round, "rea");
  assert.match(roundOf(p, items[0].id).reason, /no ED goes anywhere/);
  assert.equal(roundOf(p, items[1].id).round, "rd");
  assert.equal(roundOf(p, items[2].id).round, "ea");
  assert.match(roundOf(p, items[2].id).flag!, /check whether Harvard-ish's restrictive early action allows this/i);
  assert.equal(roundOf(p, items[3].id).round, "ea");
  assert.equal(roundOf(p, items[3].id).flag, null, "a public university's EA stays");
  assert.match(p.note!, /until you rank the list/);
  const kinds = conflicts(items.map((i) => ({ ...i, round: roundOf(p, i.id).round })), schools).map((c) => c.kind);
  assert.deepEqual(kinds, ["rea_with_private_ea"]);
});

test("fixture 3: an ED II due before the ED I decision isn't proposed, and choosing it is an amber conflict", () => {
  const ed2 = (closing: { month: number; day: number }) => ED({ other: { closing, notification: md(2, 15) } });
  const schools = by([
    school("first", "First Choice", { early_decision: ED({ first: { closing: md(11, 1), notification: md(12, 20) } }), early_action: NO_EA }),
    school("early2", "Early Two", { early_decision: ed2(md(12, 1)), early_action: NO_EA }),
    school("late2", "Late Two", { early_decision: ed2(md(1, 5)), early_action: NO_EA }),
  ]);
  const items = [item("first", { priority: 1 }), item("early2", { priority: 2 }), item("late2", { priority: 3 })];
  const p = proposeRounds(items, schools, standingOf(items, schools));
  assert.equal(roundOf(p, items[0].id).round, "ed");
  assert.equal(roundOf(p, items[1].id).round, "rd");
  assert.match(roundOf(p, items[1].id).reason, /ED II doesn't go to Early Two because its deadline \(Dec 1\) comes before First Choice decides \(Dec 20\)/);
  assert.equal(roundOf(p, items[2].id).round, "ed2");
  assert.match(roundOf(p, items[2].id).reason, /as the fallback if First Choice says no or defers/);
  const chosen = [{ ...items[0], round: "ed" as const }, { ...items[1], round: "ed2" as const }, { ...items[2], round: "rd" as const }];
  const found = conflicts(chosen, schools);
  assert.deepEqual(found.map((c) => [c.kind, c.severity]), [["ed2_before_ed_decision", "amber"]]);
  assert.match(found[0].text, /you'd have to decide before you hear from First Choice/);
});

test("fixture 4: no estimates: the money question is red with the calculator; over the family's limit is an amber conflict", () => {
  const schools = by([school("ed", "Pricey ED", { early_decision: ED(), early_action: NO_EA }, { avgCost: 52000 })]);
  const items = [item("ed", { round: "ed" })];
  const money: MoneyInput = { limit: 30000, estimates: {} };
  const found = conflicts(items, schools, money);
  assert.deepEqual(found.map((c) => [c.kind, c.severity]), [["ed_over_limit", "amber"]]);
  assert.equal(found[0].link, "https://ed.edu/npc");
  assert.match(found[0].text, /\$52,000.*\$30,000/);
  const lines = bindingChecklist(items[0], schools.ed, standingFor(items[0], schools.ed), money, found);
  assert.deepEqual(lines.map((l) => l.question), ["advantage", "money", "options"]);
  assert.equal(lines[0].text, "ED offered; counts not published");
  assert.equal(lines[1].state, "red");
  assert.equal(lines[1].text, "ED is binding; get an estimate or run the calculator before you decide");
  assert.equal(lines[1].link, "https://ed.edu/npc");
  assert.equal(lines[2].state, "amber");
  // With a shared estimate inside the limit: green, and no conflict.
  const shared: MoneyInput = { limit: 30000, estimates: { [items[0].id]: { low: 24000, high: 28000, sharedBy: "Mom" } } };
  assert.deepEqual(conflicts(items, schools, shared), []);
  const green = bindingChecklist(items[0], schools.ed, null, shared, []);
  assert.equal(green[1].state, "green");
  assert.equal(green[1].text, "Estimate $24K–$28K/yr, shared by Mom, inside your limit");
  assert.equal(bindingChecklist(items[0], schools.ed, null, { limit: 20000, estimates: shared.estimates }, [])[1].state, "amber");
});

test("fixture 5: an import with a round the college dropped is a red conflict, and the strip counts it", () => {
  const schools = by([school("x", "No ED Anymore", { early_decision: NO_ED, early_action: EA() }), school("y", "Fine", { early_decision: NO_ED, early_action: EA() })]);
  const items = [item("x", { round: "ed" }), item("y", { round: "ea" })];
  const found = conflicts(items, schools);
  assert.deepEqual(found.map((c) => [c.kind, c.severity]), [["not_offered", "red"]]);
  assert.match(found[0].text, /No ED Anymore doesn't offer early decision/);
  assert.equal(redConflictCount(items, schools), 1);
  const stage = stageOf({ items: items.map((i) => ({ ...i, enrolling: false, visited_on: null })), tasks: [], today: "2026-10-08", conflicts: redConflictCount(items, schools) });
  assert.deepEqual(stage.stages[2], { state: "open", count: "1 conflict" });
  // The proposal moves it to a round the college offers.
  const p = proposeRounds(items, schools, standingOf(items, schools));
  assert.equal(roundOf(p, items[0].id).round, "ea");
});

/* ------------------------------------------------------------------ */
/* Rule 1's Reach caveat                                               */
/* ------------------------------------------------------------------ */

test("ED I at a Reach for everyone: skipped when a higher-ranked college isn't one; allowed at the top with the caveat", () => {
  const schools = by([
    school("top", "Top Target", { early_decision: NO_ED, early_action: NO_EA }, { admitRate: 0.4 }),
    school("ivy", "Ivy", { early_decision: ED(), early_action: NO_EA }, { admitRate: 0.05 }),
    school("ok", "Okay ED", { early_decision: ED(), early_action: NO_EA }, { admitRate: 0.35 }),
  ]);
  const items = [item("top", { priority: 1 }), item("ivy", { priority: 2 }), item("ok", { priority: 3 })];
  const p = proposeRounds(items, schools, standingOf(items, schools));
  assert.equal(roundOf(p, items[1].id).round, "rd");
  assert.match(roundOf(p, items[1].id).reason, /ED I doesn't go to Ivy because it's a Reach for everyone and you rank Top Target above it/);
  assert.equal(roundOf(p, items[2].id).round, "ed");

  const top = [item("ivy", { priority: 1 }), item("ok", { priority: 2 })];
  const q = proposeRounds(top, schools, standingOf(top, schools));
  assert.equal(roundOf(q, top[0].id).round, "ed");
  assert.match(roundOf(q, top[0].id).reason, /an early application doesn't turn a Reach into a Target/);
});

test("standing: under 20% admitted is a Reach for everyone; otherwise the list's category", () => {
  assert.equal(standingFor({ category: "target" }, { admitRate: 0.19 }).label, "Reach for everyone");
  assert.equal(standingFor({ category: "target" }, { admitRate: 0.2 }).label, "Target");
  assert.equal(standingFor({ category: "unsorted" }, { admitRate: null }).label, "Not sorted");
});

test("rolling colleges: apply early in the fall, with the priority date", () => {
  const schools = by([
    school("r", "Rolling State", { early_decision: NO_ED, early_action: NO_EA }, { logistics: logistics({ priority_date: md(12, 1), regular_closing: null, notification: { kind: "rolling", rolling_from: md(10, 15), by_date: null, other_date: null, other_text: null } }) }),
  ]);
  const items = [item("r")];
  const p = proposeRounds(items, schools, standingOf(items, schools));
  assert.equal(p.lines[0].round, "rolling");
  assert.equal(p.lines[0].reason, "Rolling at Rolling State: apply early in the fall (priority date Dec 1)");
});

test("applied and decided colleges keep their round", () => {
  const schools = by([school("a", "A", { early_decision: ED(), early_action: NO_EA })]);
  const items = [item("a", { status: "applied", round: "rd" })];
  assert.deepEqual(proposeRounds(items, schools, standingOf(items, schools)).lines[0], { itemId: items[0].id, round: "rd", reason: "Already applied", flag: null });
});

/* ------------------------------------------------------------------ */
/* Every conflict rule, on and off                                     */
/* ------------------------------------------------------------------ */

const kinds = (items: RoundsItem[], schools: Record<string, RoundsSchool>, money?: MoneyInput): ConflictKind[] => conflicts(items, schools, money).map((c) => c.kind);

test("conflict: two EDs (red), on and off", () => {
  const schools = by([school("a", "A", { early_decision: ED(), early_action: NO_EA }), school("b", "B", { early_decision: ED(), early_action: NO_EA })]);
  const on = conflicts([item("a", { round: "ed" }), item("b", { round: "ed" })], schools);
  assert.deepEqual(on.map((c) => [c.kind, c.severity]), [["ed_twice", "red"]]);
  assert.deepEqual(kinds([item("a", { round: "ed" }), item("b", { round: "rd" })], schools), []);
  assert.deepEqual(kinds([item("a", { round: "ed", status: "decided", outcome: "denied" }), item("b", { round: "ed" })], schools), [], "a denied ED no longer binds");
});

test("conflict: two ED IIs (red), on and off", () => {
  const e2 = ED({ other: { closing: md(1, 5), notification: md(2, 15) } });
  const schools = by([school("a", "A", { early_decision: e2, early_action: NO_EA }), school("b", "B", { early_decision: e2, early_action: NO_EA })]);
  assert.deepEqual(conflicts([item("a", { round: "ed2" }), item("b", { round: "ed2" })], schools).map((c) => [c.kind, c.severity]), [["ed2_twice", "red"]]);
  assert.deepEqual(kinds([item("a", { round: "ed2" }), item("b", { round: "ed" })], schools), []);
});

test("conflict: ED with REA (red), on and off", () => {
  const schools = by([school("a", "A", { early_decision: ED(), early_action: NO_EA }), school("b", "B", { early_decision: NO_ED, early_action: EA(true) })]);
  assert.deepEqual(conflicts([item("a", { round: "ed" }), item("b", { round: "rea" })], schools).map((c) => [c.kind, c.severity]), [["ed_with_rea", "red"]]);
  assert.deepEqual(kinds([item("a", { round: "ed" }), item("b", { round: "rd" })], schools), []);
});

test("conflict: REA with a private college's EA (amber), off for a public university", () => {
  const schools = by([
    school("r", "R", { early_decision: NO_ED, early_action: EA(true) }),
    school("p", "P", { early_decision: NO_ED, early_action: EA() }),
    school("u", "U", { early_decision: NO_ED, early_action: EA() }, { type: "public" }),
  ]);
  const on = conflicts([item("r", { round: "rea" }), item("p", { round: "ea" })], schools);
  assert.deepEqual(on.map((c) => [c.kind, c.severity]), [["rea_with_private_ea", "amber"]]);
  assert.equal(on[0].link, "https://r.edu/admissions");
  assert.deepEqual(kinds([item("r", { round: "rea" }), item("u", { round: "ea" })], schools), []);
  assert.deepEqual(kinds([item("r", { round: "rd" }), item("p", { round: "ea" })], schools), []);
});

test("conflict: ED II due before the ED college decides (amber), off when it's after", () => {
  const schools = by([
    school("a", "A", { early_decision: ED({ first: { closing: md(11, 1), notification: md(12, 15) } }), early_action: NO_EA }),
    school("early", "Early", { early_decision: ED({ other: { closing: md(12, 1), notification: md(2, 1) } }), early_action: NO_EA }),
    school("late", "Late", { early_decision: ED({ other: { closing: md(1, 2), notification: md(2, 15) } }), early_action: NO_EA }),
  ]);
  assert.deepEqual(kinds([item("a", { round: "ed" }), item("early", { round: "ed2" })], schools), ["ed2_before_ed_decision"]);
  assert.deepEqual(kinds([item("a", { round: "ed" }), item("late", { round: "ed2" })], schools), []);
});

test("conflict: a round the college doesn't offer (red), off when offered or unpublished", () => {
  const schools = by([school("a", "A", { early_decision: NO_ED, early_action: EA() }), school("b", "B", null, { logistics: null })]);
  assert.deepEqual(kinds([item("a", { round: "rea" })], schools), ["not_offered"]);
  assert.deepEqual(kinds([item("a", { round: "ea" })], schools), []);
  assert.deepEqual(kinds([item("b", { round: "ed" })], schools), [], "unpublished rounds aren't a conflict");
});

test("conflict: an ED college with no estimate above the family's limit (amber), off with an estimate, under the limit, or no limit", () => {
  const schools = by([school("a", "A", { early_decision: ED(), early_action: NO_EA }, { avgCost: 40000 })]);
  const ed = item("a", { round: "ed" });
  assert.deepEqual(kinds([ed], schools, { limit: 30000, estimates: {} }), ["ed_over_limit"]);
  assert.deepEqual(kinds([ed], schools, { limit: 50000, estimates: {} }), []);
  assert.deepEqual(kinds([ed], schools, { limit: null, estimates: {} }), []);
  assert.deepEqual(kinds([ed], schools, { limit: 30000, estimates: { [ed.id]: { low: 1, high: 2, sharedBy: null } } }), []);
});

test("only red conflicts count on the strip", () => {
  const schools = by([school("r", "R", { early_decision: NO_ED, early_action: EA(true) }), school("p", "P", { early_decision: NO_ED, early_action: EA() })]);
  assert.equal(redConflictCount([item("r", { round: "rea" }), item("p", { round: "ea" })], schools), 0);
});

/* ------------------------------------------------------------------ */
/* Advantage in the table, summary                                     */
/* ------------------------------------------------------------------ */

test("the table's advantage line uses the same document's totals and the counts' edition", () => {
  const s = school("a", "A", { early_decision: ED({ applicants: 1000, admitted: 240 }), early_action: EA() }, {
    edTotals: { applicants: 11000, admitted: 1140, enrolled: 500 },
    cites: { "reported.admission_profile.early_decision.applicants": { cdsEdition: "2025–26" } },
  });
  const e = earlyFor(s);
  assert.equal(e.line, "ED admitted 24% vs 9% non-ED (CDS 2025–26) · 2.7× the non-ED rate");
  assert.equal(e.share, "about 46% of the class (if 95% of ED admits enroll)");
  assert.equal(e.field, "reported.admission_profile.early_decision.admitted");
  assert.equal(earlyFor(school("b", "B", { early_decision: NO_ED })).line, null);
});

test("summary line: ED I and ED II by name, EA and RD counted", () => {
  const schools = by([school("m", "Michigan", null), school("t", "Tufts", null), school("e1", "E1", null), school("e2", "E2", null), school("r", "R", null)]);
  const items = [item("m", { round: "ed" }), item("t", { round: "ed2" }), item("e1", { round: "ea" }), item("e2", { round: "ea" }), item("r", { round: "rd" })];
  assert.equal(roundsSummary(items, schools), "ED I Michigan · ED II Tufts (if needed) · EA at 2 · RD at 1");
  assert.equal(roundsSummary([item("m")], schools), null);
});

/* ------------------------------------------------------------------ */
/* The decide-rounds step                                              */
/* ------------------------------------------------------------------ */

function genInput(items: RoundsItem[], schools: Record<string, RoundsSchool>, grade: GeneratorInput["grade"] = "senior_fall"): GeneratorInput {
  return {
    list: { id: "list-1", student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: "2026-01-01", sort: null, rounds_plan_accepted_at: null },
    items: items as unknown as GeneratorInput["items"],
    schools: schools as Record<string, PlanSchool>,
    profile: null,
    cycle: { cycle: "2026-27", startYear: START, entries: [] },
    grade,
    today: "2026-08-15",
    visits: [],
    offers: [],
  };
}

test("decide_rounds: six weeks before the earliest early deadline, student-assigned, with the deadline's lineage", () => {
  const schools = by([
    school("a", "A", { early_decision: ED({ first: { closing: md(11, 15), notification: md(12, 15) } }), early_action: NO_EA }),
    school("b", "Bee", { early_decision: NO_ED, early_action: EA(false, { closing: md(11, 1) }) }, { editionIsLastCycle: true }),
  ]);
  const tasks = generate(genInput([item("a"), item("b")], schools));
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.key, "list-1:decide_rounds:-");
  assert.equal(t.kind, "decide_rounds");
  assert.equal(t.item_id, null);
  assert.equal(DECIDE_ROUNDS_LEAD_DAYS, 42);
  assert.equal(t.due_on, "2026-09-20", "Nov 1 minus 42 days");
  assert.equal(t.assignee, "student");
  assert.equal(t.source, "stage");
  assert.equal(t.source_field, "reported.admission_profile.early_action.closing");
  assert.equal(t.date_note, "last_cycle");
  assert.match(t.detail!, /Bee EA, Nov 1/);
  assert.equal(earliestEarlyDeadline([item("a"), item("b")], schools)?.date.iso, "2026-11-01");
});

test("decide_rounds: nothing out of season, and nothing without an early round", () => {
  const schools = by([school("a", "A", { early_decision: ED(), early_action: NO_EA }), school("r", "R", { early_decision: NO_ED, early_action: NO_EA })]);
  assert.deepEqual(generate(genInput([item("a")], schools, "earlier")), []);
  assert.deepEqual(generate(genInput([item("a")], schools, "graduated")), []);
  assert.deepEqual(generate(genInput([item("r")], schools)), []);
  assert.deepEqual(generate(genInput([item("a", { status: "decided", outcome: "admitted" })], schools)), [], "a decided college's deadline doesn't count");
});

/* ------------------------------------------------------------------ */
/* Priority attribution (PGlite)                                       */
/* ------------------------------------------------------------------ */

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

async function boot(): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

async function first<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1);
  return r[0];
}

async function family() {
  const db = await boot();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Sam Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const rpc = async <T,>(who: string, sql: string, params: unknown[] = []) => (await first(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;
  const household = await rpc<string>(mom, "public.create_household('The Smiths', 'guardian')");
  for (const [who, email, side] of [
    [dad, "dad@example.com", "guardian"],
    [alice, "alice@example.com", "student"],
  ] as const) {
    const { token } = await rpc<{ token: string }>(mom, "public.create_invitation($1, $2, $3, $4, $5, $6, $7, $8)", [household, email, side, null, false, null, null, null]);
    await rpc<string>(who, "public.accept_invitation($1)", [token]);
  }
  const student = (await first(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const momMember = (await first(asUser<{ member_id: string }>(db, alice, "select member_id from public.household_roster($1) where user_id = $2", [household, mom]))).member_id;
  await asUser(db, alice, "select public.set_member_can_edit($1, true)", [momMember]);
  const list = (await first(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]))).id;
  return { db, mom, dad, alice, list };
}

/** Who reordered is the session's user, whatever the request says; a view-only guardian can't reorder. */
async function assertAttribution(w: Awaited<ReturnType<typeof family>>) {
  const { db, mom, dad, alice, list } = w;
  const by = async () => (await first(db.query<{ priority_by: string | null }>("select priority_by from public.lists where id = $1", [list]).then((r) => r.rows))).priority_by;
  await asUser(db, mom, `update public.lists set priority_at = now(), priority_previous = '[]'::jsonb where id = $1`, [list]);
  assert.equal(await by(), mom, "the trigger records the editor");
  await asUser(db, mom, "update public.lists set priority_by = $2 where id = $1", [list, alice]);
  assert.equal(await by(), mom, "nobody can name someone else");
  await asUser(db, alice, `update public.lists set priority_at = now() + interval '1 second', priority_by = $2 where id = $1`, [list, mom]);
  assert.equal(await by(), alice, "the student putting it back is recorded as the student");
  assert.equal(await affectedAsUser(db, dad, "update public.lists set priority_at = now() where id = $1", [list]), 0, "a view-only guardian can't reorder");
}

test("priority attribution: the trigger records who reordered, from the session", async () => {
  await assertAttribution(await family());
});

test("guard: without the trigger, the attribution check fails", async () => {
  const w = await family();
  await w.db.exec("drop trigger lists_priority_by on public.lists");
  await assert.rejects(assertAttribution(w));
});
