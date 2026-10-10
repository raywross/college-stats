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
  conflicts,
  cycleLabel,
  earliestEarlyDeadline,
  earlyFor,
  isOffered,
  lastCycleNote,
  priorityOrder,
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
import { COST_CHECK_LEAD_DAYS, generate } from "../lib/planner/generators/rounds.ts";
import { applyMerge, mergeTasks, taskKey } from "../lib/planner/tasks.ts";
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

/* ------------------------------------------------------------------ */

test("standing: under 20% admitted is a Reach for everyone; otherwise the list's category", () => {
  assert.equal(standingFor({ category: "target" }, { admitRate: 0.19 }).label, "Reach for everyone");
  assert.equal(standingFor({ category: "target" }, { admitRate: 0.2 }).label, "Target");
  assert.equal(standingFor({ category: "unsorted" }, { admitRate: null }).label, "Not sorted");
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

/* ------------------------------------------------------------------ */
/* The cost_check step (redesign U6; specs/planner/redesign/rounds.md "Money")                        */
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

test("earliestEarlyDeadline still finds the earliest early closing date across the list", () => {
  const schools = by([
    school("a", "A", { early_decision: ED({ first: { closing: md(11, 15), notification: md(12, 15) } }), early_action: NO_EA }),
    school("b", "Bee", { early_decision: NO_ED, early_action: EA(false, { closing: md(11, 1) }) }, { editionIsLastCycle: true }),
  ]);
  assert.equal(earliestEarlyDeadline([item("a"), item("b")], schools)?.date.iso, "2026-11-01");
});

test("cost_check: 21 days before the ED closing date, guardian-assigned, with the deadline's lineage and the net price calculator", () => {
  const schools = by([school("a", "A", { early_decision: ED({ first: { closing: md(11, 15), notification: md(12, 15) } }), early_action: NO_EA }, { editionIsLastCycle: true })]);
  const i = item("a", { round: "ed" });
  const tasks = generate(genInput([i], schools));
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.key, taskKey("list-1", "cost_check", `${i.id}:ed`));
  assert.equal(t.kind, "cost_check");
  assert.equal(t.item_id, i.id);
  assert.equal(COST_CHECK_LEAD_DAYS, 21);
  assert.equal(t.due_on, "2026-10-25", "Nov 15 minus 21 days");
  assert.equal(t.title, "Check the cost of A together before applying ED I");
  assert.equal(t.assignee, "guardian");
  assert.equal(t.source, "stage");
  assert.equal(t.source_field, "reported.admission_profile.early_decision.first.closing");
  assert.equal(t.date_note, "last_cycle");
  assert.match(t.detail!, /net price calculator.*https:\/\/a\.edu\/npc/);
});

test("cost_check: ED II gets its own key and title", () => {
  const schools = by([school("a", "A", { early_decision: ED({ other: { closing: md(1, 5), notification: md(2, 15) } }), early_action: NO_EA })]);
  const i = item("a", { round: "ed2" });
  const t = generate(genInput([i], schools))[0];
  assert.equal(t.key, taskKey("list-1", "cost_check", `${i.id}:ed2`));
  assert.equal(t.title, "Check the cost of A together before applying ED II");
});

test("cost_check: nothing without a published closing date, without a link, without a binding round, once applied or withdrawn, or on a guardian's own list", () => {
  const noLink = school("a", "A", { early_decision: ED(), early_action: NO_EA }, { links: { website: "https://a.edu", price_calculator: null, admissions: "https://a.edu/admissions" } });
  const noDate = school("n", "N", { early_decision: NO_ED, early_action: NO_EA });
  const schools = by([noLink, noDate]);
  assert.doesNotMatch(generate(genInput([item("a", { round: "ed" })], schools))[0].detail!, /https:\/\//, "no calculator link: no URL in the detail");
  assert.deepEqual(generate(genInput([item("n", { round: "ed" })], schools)), [], "no closing date on record");
  assert.deepEqual(generate(genInput([item("a", { round: "ea" })], schools)), [], "not a binding round");
  assert.deepEqual(generate(genInput([item("a", { round: "ed", status: "applied" })], schools)), [], "already applied");
  assert.deepEqual(generate(genInput([item("a", { round: "ed", status: "decided", outcome: "admitted" })], schools)), [], "already decided");
  assert.deepEqual(generate(genInput([{ ...item("a", { round: "ed" }), withdrawn_on: "2026-09-01" } as RoundsItem], schools)), [], "withdrawn");
  const guardianList = { ...genInput([item("a", { round: "ed" })], schools), list: { ...genInput([], schools).list, student_id: null } };
  assert.deepEqual(generate(guardianList), [], "a guardian's own list gets no cost checks");
});

test("cost_check: moving the round off ED orphans the task through mergeTasks", () => {
  const schools = by([school("a", "A", { early_decision: ED({ first: { closing: md(11, 15), notification: md(12, 15) } }), early_action: EA() })]);
  const i = item("a", { round: "ed" });
  const edInput = genInput([i], schools);
  const first = generate(edInput);
  const stored = applyMerge("list-1", [], mergeTasks([], first), "2026-08-15T12:00:00Z", (k) => `id:${k}`);
  const key = taskKey("list-1", "cost_check", `${i.id}:ed`);
  assert.ok(stored.some((t) => t.key === key && !t.orphaned));

  const eaInput = genInput([{ ...i, round: "ea" }], schools);
  const second = generate(eaInput);
  assert.ok(!second.some((t) => t.key === key), "an EA row generates no cost_check");
  const merge = mergeTasks(stored, second);
  assert.ok(merge.orphans.includes(stored.find((t) => t.key === key)!.id));
  const after = applyMerge("list-1", stored, merge, "2026-08-15T12:00:00Z");
  assert.equal(after.find((t) => t.key === key)!.orphaned, true);
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
