/**
 * The parent's view (U8; specs/planner/parents.md): the summary line per stage, the stuck signals on and off,
 * "Your part" grouping, the parent-summary email (titles only), and the nudge rate limit against real Postgres
 * (PGlite, every migration including 20261008142000_planner_parents.sql). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { stageOf, type StageInput } from "../lib/planner/stage.ts";
import { summaryLine, stuckSignals, yourPart, NO_MONEY, type StuckSignalsInput, type YourPartStudent } from "../lib/planner/summary.ts";
import { buildParentSummary } from "../lib/emails/parent-summary.ts";
import type { Cycle } from "../lib/planner/cycle.ts";
import type { PlanTask } from "../lib/planner/types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

type Item = StageInput["items"][number] & { unit_id: string; dream: boolean; committed_on: string | null; added_at?: string | null };

let n = 0;
const item = (over: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  unit_id: "100000",
  category: "target",
  status: "considering",
  outcome: null,
  round: null,
  enrolling: false,
  visited_on: null,
  dream: false,
  committed_on: null,
  ...over,
});

const task = (over: Partial<PlanTask> = {}): PlanTask =>
  ({
    id: `t${++n}`,
    list_id: "list",
    item_id: null,
    key: null,
    kind: "own",
    title: "A step",
    detail: null,
    due_on: null,
    window_start: null,
    window_end: null,
    assignee: "student",
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
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  }) as PlanTask;

const TODAY = "2026-10-08";
const SCHOOLS = { "100000": { name: "Michigan", links: null }, "200000": { name: "Tufts", links: null } };
const CYCLE: Pick<Cycle, "startYear"> = { startYear: 2026 };

function signalsFor(over: Partial<StuckSignalsInput>): ReturnType<typeof stuckSignals> {
  return stuckSignals({
    items: [],
    tasks: [],
    visits: [],
    schools: SCHOOLS,
    money: NO_MONEY,
    cycle: CYCLE,
    grade: "senior_fall",
    today: TODAY,
    ...over,
  });
}

/* ------------------------------------------------------------------ */
/* summaryLine                                                         */
/* ------------------------------------------------------------------ */

test("summaryLine: a junior building the list, with a visit planned and no next task", () => {
  // Fewer than the minimum (3) keeps the List stage current regardless of rounds, so the line is just the stage
  // caption plus the visit fallback (no next dated task).
  const items = [item({ category: "reach" }), item({ category: "target" })];
  const { current, stages } = stageOf({ items, tasks: [], today: TODAY });
  assert.equal(current, 1);
  const line = summaryLine({ current, stages, tasks: [], items, schools: SCHOOLS, visits: [{ on_date: "2026-11-01" }], today: TODAY });
  assert.equal(line, "Building the list · Add 1 more · 1 visit planned");
});

test("summaryLine: applying, with the next dated task and its round, and the Dream", () => {
  const items = [item({ unit_id: "100000", round: "ed", dream: true }), item({ unit_id: "200000", status: "applying" })];
  const tasks = [task({ item_id: items[0].id, kind: "apply", title: "Apply", due_on: "2026-11-01" })];
  const { current, stages } = stageOf({ items, tasks, today: TODAY });
  const line = summaryLine({ current, stages, tasks, items, schools: SCHOOLS, visits: [], today: TODAY });
  assert.match(line, /next: Michigan, Nov 1 \(ED I\)/);
  assert.match(line, /Dream: Michigan/);
  assert.doesNotMatch(line, /\d+%|overdue|standing/i);
});

test("summaryLine: no scores, standing, or overdue counts, even with an overdue task", () => {
  const items = [item()];
  const tasks = [task({ item_id: items[0].id, due_on: "2026-09-01" })];
  const { current, stages } = stageOf({ items, tasks, today: TODAY });
  const line = summaryLine({ current, stages, tasks, items, schools: SCHOOLS, visits: [], today: TODAY });
  assert.doesNotMatch(line, /overdue/i);
});

/* ------------------------------------------------------------------ */
/* stuckSignals: on and off, and the grade gate                        */
/* ------------------------------------------------------------------ */

test("stuckSignals: off entirely before junior spring", () => {
  assert.deepEqual(signalsFor({ grade: "junior_fall", items: [] }), []);
  assert.deepEqual(signalsFor({ grade: "earlier", items: [] }), []);
  assert.deepEqual(signalsFor({ grade: "unknown", items: [] }), []);
});

test("stuckSignals: only the no-Likely one in junior spring", () => {
  const items = [item({ category: "reach" })];
  const on = signalsFor({ grade: "junior_spring", items });
  assert.deepEqual(on.map((s) => s.id), ["no_likely"]);
  const off = signalsFor({ grade: "junior_spring", items: [item({ category: "likely" })] });
  assert.deepEqual(off, []);
});

test("stuckSignals: overdue 7+ days, on then off once ticked", () => {
  const items = [item({ unit_id: "100000" })];
  const t = task({ item_id: items[0].id, title: "Supplement", due_on: "2026-09-25" }); // 13 days overdue
  const on = signalsFor({ items, tasks: [t] });
  assert.ok(on.find((s) => s.id === "overdue_task"));
  assert.match(on.find((s) => s.id === "overdue_task")!.text, /Michigan's "Supplement" was due Sep 25/);
  const off = signalsFor({ items, tasks: [{ ...t, done_at: "2026-10-01T00:00:00Z" }] });
  assert.ok(!off.find((s) => s.id === "overdue_task"));
});

test("stuckSignals: no activity for 14 days in season, off with recent activity", () => {
  const stale = signalsFor({ items: [item({ category: "likely" })], tasks: [task({ done_at: "2026-09-01T00:00:00Z" })] });
  assert.ok(stale.find((s) => s.id === "no_activity"));
  const fresh = signalsFor({ items: [item({ category: "likely" })], tasks: [task({ done_at: "2026-10-05T00:00:00Z" })] });
  assert.ok(!fresh.find((s) => s.id === "no_activity"));
  // A college added this week is activity too: a brand-new plan isn't "stuck" on day one.
  const justAdded = signalsFor({ items: [item({ category: "likely", added_at: "2026-10-06T12:00:00Z" })], tasks: [] });
  assert.ok(!justAdded.find((s) => s.id === "no_activity"));
  const addedLongAgo = signalsFor({ items: [item({ category: "likely", added_at: "2026-08-01T12:00:00Z" })], tasks: [] });
  assert.ok(addedLongAgo.find((s) => s.id === "no_activity"));
});

test("stuckSignals: an ED college with no shared estimate, off once one's shared", () => {
  const items = [item({ unit_id: "100000", round: "ed", category: "likely" })];
  const on = signalsFor({ items });
  assert.ok(on.find((s) => s.id === "ed_no_estimate"));
  const off = signalsFor({ items, money: { limit: null, estimates: { [items[0].id]: { low: 1, high: 2, sharedBy: "Mom" } } } });
  assert.ok(!off.find((s) => s.id === "ed_no_estimate"));
});

test("stuckSignals: wait-listed with no commitment, only once April 20 of the cycle's second year has passed", () => {
  const items = [item({ outcome: "waitlisted", category: "likely" })];
  const before = signalsFor({ items, today: "2027-04-19" });
  assert.ok(!before.find((s) => s.id === "waitlist_no_commit"));
  const after = signalsFor({ items, today: "2027-04-20" });
  assert.ok(after.find((s) => s.id === "waitlist_no_commit"));
  const committed = signalsFor({ items: [...items, item({ committed_on: "2027-04-01" })], today: "2027-04-20" });
  assert.ok(!committed.find((s) => s.id === "waitlist_no_commit"));
});

test("stuckSignals: a decision-expected date that's passed with nothing recorded", () => {
  const items = [item({ unit_id: "100000", category: "likely" })];
  const t = task({ item_id: items[0].id, kind: "decision_expected", due_on: "2026-10-01" });
  const on = signalsFor({ items, tasks: [t] });
  assert.ok(on.find((s) => s.id === "overdue_decision"));
  const decided = signalsFor({ items: [{ ...items[0], status: "decided" }], tasks: [t] });
  assert.ok(!decided.find((s) => s.id === "overdue_decision"));
});

test("stuckSignals: every one fires from the summer before senior year on", () => {
  for (const grade of ["summer_before_senior", "senior_fall", "senior_winter", "senior_spring", "summer_after"] as const) {
    const items = [item({ unit_id: "100000", round: "ed", category: "likely" }), item({ outcome: "waitlisted" })];
    const tasks = [task({ item_id: items[0].id, title: "x", due_on: "2026-01-01" })];
    const signals = signalsFor({ items, tasks, grade, today: "2027-04-21" });
    assert.ok(signals.length >= 3, `${grade}: ${JSON.stringify(signals)}`);
  }
});

/* ------------------------------------------------------------------ */
/* yourPart                                                             */
/* ------------------------------------------------------------------ */

test("yourPart: groups open guardian/either tasks by student, skipping students with none", () => {
  const alice: YourPartStudent = {
    studentId: "alice",
    name: "Alice",
    tasks: [
      task({ assignee: "guardian", title: "FAFSA", due_on: "2026-11-01" }),
      task({ assignee: "either", title: "Housing deposit", due_on: "2026-12-01" }),
      task({ assignee: "student", title: "Essay" }),
      task({ assignee: "guardian", title: "Done already", done_at: "2026-10-01T00:00:00Z" }),
    ],
  };
  const bob: YourPartStudent = { studentId: "bob", name: "Bob", tasks: [task({ assignee: "student", title: "Essay" })] };
  const groups = yourPart([alice, bob], TODAY);
  assert.equal(groups.length, 1, "Bob has nothing assigned to a guardian, so he's left out");
  assert.equal(groups[0].studentId, "alice");
  assert.deepEqual(groups[0].tasks.map((t) => t.title), ["FAFSA", "Housing deposit"]);
});

/* ------------------------------------------------------------------ */
/* The parent-summary email: titles only                               */
/* ------------------------------------------------------------------ */

test("buildParentSummary: titles only, no notes or profile numbers, one link, unsubscribe", () => {
  const built = buildParentSummary({
    guardianFirstName: "Tracy",
    students: [
      {
        studentId: "alice",
        firstName: "Alice",
        summary: "Applying · 3 of 8 in",
        yourPart: [{ title: "FAFSA", when: "Nov 1" }],
        stuckSignals: ['Michigan\'s "Supplement" was due Oct 1'],
        tickedThisWeek: ["Sent test scores"],
      },
    ],
    siteUrl: "https://example.com",
    unsubscribeToken: "a".repeat(40),
  });
  assert.ok(built);
  assert.match(built!.text, /FAFSA/);
  assert.match(built!.text, /Sent test scores/);
  assert.doesNotMatch(built!.text, /\$\d|GPA|SAT \d|3\.\d{1,2}\b/);
  assert.equal((built!.text.match(/https:\/\//g) ?? []).length, 2, "the plan link and the unsubscribe link, nothing else");
  assert.ok(built!.headers["List-Unsubscribe"]);
});

test("buildParentSummary: null when no student has anything to say", () => {
  assert.equal(
    buildParentSummary({ guardianFirstName: null, students: [{ studentId: "a", firstName: null, summary: "", yourPart: [], stuckSignals: [], tickedThisWeek: [] }], siteUrl: "https://x", unsubscribeToken: "a".repeat(40) }),
    null,
  );
});

/* ------------------------------------------------------------------ */
/* The nudge rate limit, against real Postgres                         */
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

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

const rpc = async <T,>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;
const invite = (db: AuthDb, who: string, household: string, email: string, side: "guardian" | "student") =>
  rpc<{ token: string }>(db, who, "public.create_invitation($1, $2, $3, $4, $5, $6, $7, $8)", [household, email, side, null, false, null, null, null]);
const accept = (db: AuthDb, who: string, token: string) => rpc<string>(db, who, "public.accept_invitation($1)", [token]);

async function world() {
  const db = await boot();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  await accept(db, alice, (await invite(db, mom, household, "alice@example.com", "student")).token);
  const student = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const list = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]))).id;
  const task1 = (
    await one(asUser<{ id: string }>(db, alice, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', 'Essay', 'own') returning id", [list]))
  ).id;
  return { db, mom, alice, household, student, list, task1 };
}

test("nudges: a second nudge on the same task within three days raises nudge_limit", async () => {
  const { db, mom, task1 } = await world();
  await rpc(db, mom, "public.send_nudge($1, null, 'app')", [task1]);
  await assert.rejects(rpc(db, mom, "public.send_nudge($1, null, 'app')", [task1]), /nudge_limit/);
});

test("nudges: the fourth nudge in a week from one guardian to one student raises nudge_limit", async () => {
  const { db, mom, alice, list } = await world();
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    ids.push((await one(asUser<{ id: string }>(db, alice, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', $2, 'own') returning id", [list, `Task ${i}`]))).id);
  }
  await rpc(db, mom, "public.send_nudge($1, null, 'app')", [ids[0]]);
  await rpc(db, mom, "public.send_nudge($1, null, 'app')", [ids[1]]);
  await rpc(db, mom, "public.send_nudge($1, null, 'app')", [ids[2]]);
  await assert.rejects(rpc(db, mom, "public.send_nudge($1, null, 'app')", [ids[3]]), /nudge_limit/);
});

test("nudges: a managed student with no account can't be nudged", async () => {
  const { db, mom, household } = await world();
  const managed = await rpc<string>(db, mom, "public.add_managed_student($1, 'Jordan', 2029)", [household]);
  const mlist = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [managed]))).id;
  const mtask = (
    await one(asUser<{ id: string }>(db, mom, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', 'Visit', 'own') returning id", [mlist]))
  ).id;
  await assert.rejects(rpc(db, mom, "public.send_nudge($1, null, 'app')", [mtask]), /nudge_no_account/);
});

/* ------------------------------------------------------------------ */
/* The parent-summary preferences and the nudge-emails-off lookup       */
/* ------------------------------------------------------------------ */

test("parent_summary and nudge_emails default: off and on, and only a guardian may read nudge_emails_off", async () => {
  const { db, mom, alice, student } = await world();
  const momPrefs = await one(asUser<{ parent_summary: boolean | null; nudge_emails: boolean }>(db, mom, "insert into public.notification_prefs (user_id) values ($1) returning parent_summary, nudge_emails", [mom]));
  assert.equal(momPrefs.parent_summary, null, "off by default");
  assert.equal(momPrefs.nudge_emails, true, "on by default");
  await asUser(db, alice, "insert into public.notification_prefs (user_id, nudge_emails) values ($1, false)", [alice]);
  assert.equal(await rpc<boolean>(db, mom, "public.student_nudge_emails_off($1)", [student]), true);
  await assert.rejects(rpc(db, alice, "public.student_nudge_emails_off($1)", [student]), /not_allowed/, "not even the student reads it this way");
});
