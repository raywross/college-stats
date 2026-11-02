/**
 * The caseload's reads against real Postgres (PGlite + the auth stub, every migration through the organizations one):
 * a counselor's own session reads, under row-level security, the same shape lib/orgs.ts caseloadStudents asks
 * PostgREST for (student_profiles, the default list with its items, visits, and steps, essays), and
 * lib/org-caseload.ts turns it into the row the caseload shows. Also: an ask reaches the student's notice in the
 * family's words, an open ask can't be asked again, notes stay the office's, another student reads as nothing, and an
 * ended grant empties the caseload at once. `npm test`.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { askSentence, assembleCaseloadStudents, caseloadCsv, caseloadRows, type CaseloadEssayRow, type CaseloadListRow, type CaseloadProfileRow } from "../lib/org-caseload.ts";
import { orgErrorMessage, type OpenOrgAsk, type OrgRosterRow } from "../lib/org-rules.ts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const MIGRATION = "20261102120000_organizations.sql";
const CHAIN = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f <= MIGRATION).sort();

const iso = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function build() {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of CHAIN) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");

  const rivera = await createUser(db, { email: "rivera@advising.test", birthYear: 1975, roleHint: "counselor", displayName: "Ms. Rivera" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 2009, roleHint: "student", displayName: "Eve Evans" });

  const aliceS = (await asUser<{ id: string }>(db, alice, "insert into public.students (user_id, display_name, grad_year) values ($1, 'Alice Smith', 2027) returning id", [alice]))[0].id;
  const eveS = (await asUser<{ id: string }>(db, eve, "insert into public.students (user_id, display_name, grad_year) values ($1, 'Eve Evans', 2027) returning id", [eve]))[0].id;
  await asUser(db, alice, "insert into public.student_profiles (student_id, data) values ($1, $2)", [aliceS, JSON.stringify({ basics: { gradYear: 2027, highSchool: "Central High" }, academics: { gpa: 3.91 } })]);

  const list = (await asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [aliceS]))[0].id;
  const mich = (await asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position, category, status, round) values ($1, '170976', 0, 'reach', 'applying', 'ed') returning id", [list]))[0].id;
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id, position, category, status, round) values ($1, '204796', 1, 'target', 'applied', 'ea')", [list]);
  await db.query("insert into public.plan_tasks (list_id, item_id, key, kind, title, source, due_on) values ($1, $2, $4, 'submit', 'Submit the application', 'college', $3)", [list, mich, inDays(3), `${mich}:submit`]);
  await db.query("insert into public.plan_visits (item_id, kind, on_date) values ($1, 'campus_tour', current_date)", [mich]);
  await asUser(db, alice, "insert into public.essays (student_id, prompt_ref, title, body, count) values ($1, 'platform:common_app:main', 'Main', 'My first draft.', 3)", [aliceS]);

  const eveList = (await asUser<{ id: string }>(db, eve, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [eveS]))[0].id;
  await asUser(db, eve, "insert into public.list_items (list_id, unit_id, position) values ($1, '243780', 0)", [eveList]);

  const org = (await asUser<{ v: string }>(db, rivera, "select public.create_organization('Rivera Advising', 'iec', null, null) as v"))[0].v;
  const code = (await db.query<{ join_code: string }>("select join_code from public.organizations where id = $1", [org])).rows[0].join_code;
  const grant = (await asUser<{ v: string }>(db, alice, "select public.join_organization($1) as v", [code]))[0].v;
  return { db, rivera, alice, eve, aliceS, eveS, org, grant };
}

let base: ReturnType<typeof build> | null = null;
const opened: AuthDb[] = [];
async function world() {
  base ??= build();
  const b = await base;
  const db = (await b.db.clone()) as AuthDb;
  opened.push(db);
  return { ...b, db };
}
after(async () => {
  for (const db of opened) await db.close();
  if (base) await (await base).db.close();
});

/** The caseload's reads, in the shape PostgREST returns for lib/orgs.ts's selects, run as `who`. */
async function caseloadReads(db: AuthDb, who: string, ids: string[]) {
  const profiles = await asUser<CaseloadProfileRow>(db, who, "select student_id, data from public.student_profiles where student_id = any($1::uuid[])", [ids]);
  const lists = await asUser<CaseloadListRow>(
    db,
    who,
    `select l.id, l.student_id,
       coalesce((select json_agg(json_build_object(
          'id', i.id, 'unit_id', i.unit_id, 'category', i.category, 'status', i.status, 'outcome', i.outcome, 'round', i.round,
          'position', i.position, 'enrolling', i.enrolling, 'visited_on', i.visited_on, 'dream', i.dream, 'added_at', i.added_at,
          'committed_on', i.committed_on, 'withdrawn_on', i.withdrawn_on, 'deadline_date', i.deadline_date, 'deadline_text', i.deadline_text,
          'plan_visits', coalesce((select json_agg(json_build_object('item_id', v.item_id, 'on_date', v.on_date, 'created_at', v.created_at, 'updated_at', v.updated_at))
                                   from public.plan_visits v where v.item_id = i.id), '[]'::json)))
         from public.list_items i where i.list_id = l.id), '[]'::json) as list_items,
       coalesce((select json_agg(json_build_object(
          'id', t.id, 'item_id', t.item_id, 'kind', t.kind, 'title', t.title, 'due_on', t.due_on, 'window_start', t.window_start,
          'window_end', t.window_end, 'done_at', t.done_at, 'dismissed', t.dismissed, 'snoozed_until', t.snoozed_until,
          'orphaned', t.orphaned, 'source', t.source, 'created_at', t.created_at, 'position', t.position))
         from public.plan_tasks t where t.list_id = l.id), '[]'::json) as plan_tasks
     from public.lists l where l.student_id = any($1::uuid[]) and l.is_default`,
    [ids],
  );
  const essays = await asUser<CaseloadEssayRow>(db, who, "select id, student_id, updated::text as updated from public.essays where student_id = any($1::uuid[])", [ids]);
  return { profiles, lists, essays };
}

const SCHOOLS = { "170976": { name: "Michigan" }, "204796": { name: "Ohio State" }, "243780": { name: "Penn State" } };

test("a counselor's session reads the caseload, and the row is the planner's facts", async () => {
  const w = await world();
  const roster = await asUser<OrgRosterRow>(w.db, w.rivera, "select * from public.org_roster($1)", [w.org]);
  assert.deepEqual(roster.map((r) => [r.status, r.student_id, r.display_name]), [["active", w.aliceS, "Alice Smith"]]);
  const reads = await caseloadReads(w.db, w.rivera, [w.aliceS]);
  assert.equal(reads.lists.length, 1);
  const students = assembleCaseloadStudents(roster, reads);
  const [row] = caseloadRows({ students, schools: SCHOOLS, status: { [w.aliceS]: "preview" }, today: TODAY });
  assert.equal(row.name, "Alice Smith");
  assert.equal(row.classOf, "Class of 2027");
  assert.equal(row.record.line, "1 of 14");
  assert.equal(row.list.count, 2);
  assert.match(row.list.line, /^2 colleges/);
  assert.equal(row.applications, "1 of 2 in");
  assert.match(row.nextDeadline?.label ?? "", /^Michigan, \w{3} \d+(, \d{4})? \(ED I\)$/);
  assert.equal(row.dueThisWeek, 1);
  assert.equal(students[0].essays.length, 1);
  assert.equal(students[0].visits.length, 1);
  // The CSV from the same reads: two colleges, never the GPA.
  const csv = caseloadCsv(students, SCHOOLS, TODAY);
  assert.equal(csv.split("\n").length, 3);
  assert.ok(!csv.includes("3.91"));
});

test("another student's rows read as nothing, even when their id is asked for", async () => {
  const w = await world();
  const reads = await caseloadReads(w.db, w.rivera, [w.aliceS, w.eveS]);
  assert.deepEqual(new Set(reads.lists.map((l) => l.student_id)), new Set([w.aliceS]));
  assert.ok(reads.profiles.every((p) => p.student_id === w.aliceS));
});

test("an ask reaches the student's notice in the family's words; the same open ask can't be sent twice", async () => {
  const w = await world();
  await asUser(w.db, w.rivera, "select * from public.org_ask($1, $2, 'record_section', 'test', null)", [w.org, w.aliceS]);
  const asks = await asUser<OpenOrgAsk>(w.db, w.alice, "select * from public.org_open_asks($1)", [w.aliceS]);
  assert.equal(asks.length, 1);
  assert.equal(askSentence(asks[0]), "Ms. Rivera asked you to add a test score or target.");
  await assert.rejects(
    asUser(w.db, w.rivera, "select * from public.org_ask($1, $2, 'record_section', 'test', null)", [w.org, w.aliceS]),
    (err: Error) => orgErrorMessage(err.message) === "You already asked for this, and it isn't done yet.",
  );
  // The student closes it (as the notice does once the section is filled).
  await asUser(w.db, w.alice, "select public.org_ask_done($1)", [asks[0].id]);
  assert.equal((await asUser(w.db, w.alice, "select * from public.org_open_asks($1)", [w.aliceS])).length, 0);
});

test("notes stay the office's: the student reads none", async () => {
  const w = await world();
  await asUser(w.db, w.rivera, "insert into public.org_notes (org_id, student_id, body) values ($1, $2, 'Met Tuesday')", [w.org, w.aliceS]);
  assert.equal((await asUser(w.db, w.rivera, "select 1 from public.org_notes where student_id = $1", [w.aliceS])).length, 1);
  assert.equal((await asUser(w.db, w.alice, "select 1 from public.org_notes where student_id = $1", [w.aliceS])).length, 0);
});

test("an ended grant empties the caseload at once", async () => {
  const w = await world();
  await asUser(w.db, w.alice, "select public.end_org_access($1)", [w.grant]);
  const roster = await asUser<OrgRosterRow>(w.db, w.rivera, "select * from public.org_roster($1)", [w.org]);
  assert.equal(roster.filter((r) => r.status === "active").length, 0);
  const reads = await caseloadReads(w.db, w.rivera, [w.aliceS]);
  assert.deepEqual([reads.profiles.length, reads.lists.length, reads.essays.length], [0, 0, 0]);
  assert.deepEqual(assembleCaseloadStudents(roster, reads), []);
});
