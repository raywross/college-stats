/**
 * The plan v3 migration (supabase/migrations/20261016120000_plan_v3.sql; specs/planner/v3/build-plan.md "Database"):
 * the skip record's two task columns, plan_interest_acts with its check lists equal to lib/planner/interest-acts-types.ts,
 * its row-level security and grants, and plan_bundle() selecting the two new task columns. Reads the SQL, then boots
 * every migration in PGlite and checks who can read and write an act. Guard tests break a rule and show the check fail.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { ACT_RESOLVED_VIA, ACT_STATUSES, INTEREST_ACTS } from "../lib/planner/interest-acts-types.ts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const FILE = "20261016120000_plan_v3.sql";
const SQL = readFileSync(join(DIR, FILE), "utf8");
/** The SQL without comments, so a column named only in the header doesn't pass. */
const CODE = SQL.replace(/--.*$/gm, "");

/** The quoted values of `<column> text … check (<column> in (…))` in `code`. */
function checkList(code: string, column: string): string[] {
  const m = new RegExp(`\\b${column}\\s+text[^,]*?check \\(${column} in \\(([^)]*)\\)\\)`).exec(code);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
}

test("plan_tasks gains dismissed_at and dismissed_by (set null when the account goes)", () => {
  assert.match(CODE, /alter table public\.plan_tasks add column dismissed_at timestamptz;/);
  assert.match(CODE, /alter table public\.plan_tasks add column dismissed_by uuid references auth\.users on delete set null;/);
});

test("plan_interest_acts: act, status, and resolved_via checks equal the TypeScript unions", () => {
  assert.match(CODE, /create table public\.plan_interest_acts \(/);
  assert.deepEqual(checkList(CODE, "act"), [...INTEREST_ACTS]);
  assert.deepEqual(checkList(CODE, "status"), [...ACT_STATUSES]);
  assert.deepEqual(checkList(CODE, "resolved_via"), [...ACT_RESOLVED_VIA]);
  // Guard: an act missing from the SQL fails.
  assert.notDeepEqual(checkList(CODE.replace("'test_register'", ""), "act"), [...INTEREST_ACTS]);
});

test("plan_interest_acts: every column of the contract, item_id nullable, a unique confirm token, two indexes", () => {
  const body = /create table public\.plan_interest_acts \(([\s\S]*?)\n\);/.exec(CODE)?.[1] ?? "";
  const cols = body.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  assert.deepEqual(cols, [
    "id", "item_id", "user_id", "act", "network", "url", "event_id", "event_starts_at", "event_place", "event_title",
    "clicked_at", "prompted_at", "emailed_at", "status", "resolved_at", "resolved_via", "visit_id", "confirm_token",
  ]);
  assert.match(body, /item_id\s+uuid references public\.list_items on delete cascade,/, "nullable: a test registration has no college");
  assert.match(body, /user_id\s+uuid not null references auth\.users on delete cascade,/);
  assert.match(body, /visit_id\s+uuid references public\.plan_visits on delete set null,/);
  assert.match(body, /confirm_token\s+text not null unique default /);
  assert.match(CODE, /create index \S+ on public\.plan_interest_acts \(user_id, status\);/);
  assert.match(CODE, /create index \S+ on public\.plan_interest_acts \(status, emailed_at\);/);
});

test("plan_interest_acts: RLS on; read by the actor or the item's list readers; insert/update own; grants", () => {
  assert.match(CODE, /alter table public\.plan_interest_acts enable row level security;/);
  assert.match(CODE, /on public\.plan_interest_acts for select to authenticated\s+using \(user_id = auth\.uid\(\) or \(item_id is not null and public\.can_read_item\(item_id\)\)\);/);
  assert.match(CODE, /on public\.plan_interest_acts for insert to authenticated\s+with check \(user_id = auth\.uid\(\)\);/);
  assert.match(CODE, /on public\.plan_interest_acts for update to authenticated\s+using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\);/);
  assert.doesNotMatch(CODE, /on public\.plan_interest_acts for delete/, "no delete policy: acts expire, they aren't deleted");
  assert.match(CODE, /revoke all on public\.plan_interest_acts from anon, authenticated;/);
  assert.match(CODE, /grant select, insert, update on public\.plan_interest_acts to authenticated;/);
  assert.match(CODE, /grant all on public\.plan_interest_acts to service_role;/);
});

test("plan_bundle is recreated in place with dismissed_at, dismissed_by in the tasks select", () => {
  assert.match(CODE, /create or replace function public\.plan_bundle\(p_student uuid default null, p_list uuid default null\) returns jsonb/);
  assert.match(CODE, /created_by, created_at, season, action, dismissed_at, dismissed_by\s+from public\.plan_tasks/);
  assert.match(CODE, /security invoker/);
  // The rest of the body is the next-steps migration's, unchanged.
  const fn = (sql: string) => /create or replace function public\.plan_bundle[\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
  const before = fn(readFileSync(join(DIR, "20261014120000_next_steps.sql"), "utf8"));
  assert.equal(fn(SQL).replace(", dismissed_at, dismissed_by", ""), before);
});

/* ------------------------------------------------------------------ */
/* Against real Postgres                                               */
/* ------------------------------------------------------------------ */

async function boot(): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}
const rpc = async <T,>(db: AuthDb, who: string, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;

test("real Postgres: the student records and reads their acts; their guardian reads the college's; an outsider reads and writes nothing", async () => {
  const db = await boot();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve" });
  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  const invite = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, $2, 'student', null, false, null, null, null)", [household, "alice@example.com"]);
  await rpc(db, alice, "public.accept_invitation($1)", [invite.token]);
  const student = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const list = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]))).id;
  const item = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position) values ($1, '198419', 0) returning id", [list]))).id;

  const tour = await one(asUser<{ id: string; status: string; confirm_token: string }>(db, alice, "insert into public.plan_interest_acts (item_id, user_id, act, url) values ($1, $2, 'tour', 'https://example.edu/tour') returning id, status, confirm_token", [item, alice]));
  assert.equal(tour.status, "pending");
  assert.match(tour.confirm_token, /^[0-9a-f]{64}$/, "an unguessable token by default");
  await asUser(db, alice, "insert into public.plan_interest_acts (item_id, user_id, act, url) values (null, $1, 'test_register', 'https://satsuite.collegeboard.org')", [alice]);

  assert.equal((await asUser(db, alice, "select id from public.plan_interest_acts")).length, 2, "the actor reads both");
  const momSees = await asUser<{ act: string }>(db, mom, "select act from public.plan_interest_acts");
  assert.deepEqual(momSees.map((r) => r.act), ["tour"], "the guardian reads the college's act, not the item-less one");
  assert.equal((await asUser(db, eve, "select id from public.plan_interest_acts")).length, 0, "an outsider reads nothing");

  // Writes: only the actor, only as themselves.
  await assert.rejects(asUser(db, eve, "insert into public.plan_interest_acts (item_id, user_id, act, url) values ($1, $2, 'tour', 'x')", [item, alice]), /row-level security/);
  await assert.rejects(asUser(db, mom, "insert into public.plan_interest_acts (item_id, user_id, act, url) values ($1, $2, 'tour', 'x')", [item, alice]), /row-level security/);
  const momUpdate = await asUser(db, mom, "update public.plan_interest_acts set status = 'confirmed' where id = $1 returning id", [tour.id]);
  assert.equal(momUpdate.length, 0, "the guardian can't resolve the student's act");
  const aliceUpdate = await asUser(db, alice, "update public.plan_interest_acts set status = 'confirmed', resolved_at = now(), resolved_via = 'prompt' where id = $1 returning id", [tour.id]);
  assert.equal(aliceUpdate.length, 1);
  await assert.rejects(asUser(db, alice, "update public.plan_interest_acts set status = 'maybe' where id = $1", [tour.id]), /check constraint/);
  await assert.rejects(asUser(db, alice, "delete from public.plan_interest_acts where id = $1", [tour.id]), /permission denied/);

  // The skip record: the student stamps a skip on their own task, and plan_bundle returns it.
  const task = (await one(asUser<{ id: string }>(db, alice, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', 'Undated', 'own') returning id", [list]))).id;
  await asUser(db, alice, "update public.plan_tasks set dismissed = true, dismissed_at = '2026-10-12T15:00:00Z', dismissed_by = $2 where id = $1", [task, alice]);
  const bundle = await rpc<{ tasks: { id: string; dismissed_at: string; dismissed_by: string }[] }>(db, alice, "public.plan_bundle($1, null)", [student]);
  const t = bundle.tasks.find((x) => x.id === task);
  assert.equal(t?.dismissed_by, alice);
  assert.equal(Date.parse(t?.dismissed_at ?? ""), Date.parse("2026-10-12T15:00:00Z"));
});
