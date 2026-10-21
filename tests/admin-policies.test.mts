/**
 * The admin console's database side against real Postgres (PGlite with the auth stub, every migration in order;
 * supabase/migrations/20261012200000_admin.sql, specs/product/admin.md "Model" and "Tests"). An admin is an unrevoked
 * row in admins signed in at aal2; the "Admins read" policies let that admin, in the console (x-quad-console header),
 * read every listed table and change nothing; every admin_*() function refuses anyone else with "admin only" and
 * writes its admin_log row; admin_link keeps the six seats and the one-household rule (moving, never duplicating);
 * admin_unlink refuses the last guardian of a managed student; admin_revoke keeps the last admin; the invitations view
 * never shows a token; an admin's view reads "Quad support" to the student; a paused profile can't be unpaused by its
 * owner. Guard tests break a rule on purpose (drop the is_admin() line, the aal check, the console header, the
 * last-admin rule, the move) and show the checks fail. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const ADMIN_MIGRATION = "20261012200000_admin.sql";
const ADMIN_SQL = readFileSync(join(DIR, ADMIN_MIGRATION), "utf8");

/** Every migration in order; `transform` rewrites the admin migration (guard tests). */
async function boot(transform?: (sql: string) => string): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL) {
    let sql = readFileSync(join(DIR, name), "utf8");
    if (name === ADMIN_MIGRATION && transform) {
      const changed = transform(sql);
      assert.notEqual(changed, sql, "the guard's transform must change the migration");
      sql = changed;
    }
    await db.exec(sql);
  }
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

type Opts = { aal?: "aal1" | "aal2"; console?: boolean };

/** One statement as a signed-in user with an assurance level and, by default, the console's header. */
async function as<T = Record<string, unknown>>(db: AuthDb, who: string, sql: string, params: unknown[] = [], { aal = "aal2", console = true }: Opts = {}): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated", aal })]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify(console ? { "x-quad-console": "1" } : {})]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function asService<T = Record<string, unknown>>(db: AuthDb, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

const rpc = async <T,>(db: AuthDb, who: string, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;
const asAdmin = <T = Record<string, unknown>,>(w: World, sql: string, params: unknown[] = []) => as<T>(w.db, w.quinn, sql, params);
const errorOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "ok";
  } catch (err) {
    return (err as Error).message;
  }
};
const count = async (db: AuthDb, sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0].n);
const logActions = async (db: AuthDb) => (await db.query<{ action: string }>("select action from public.admin_log order by id")).rows.map((r) => r.action);

/**
 * The Smiths (Mom edits, Dad, Alice with her own account, Ben managed by Mom, a pending invitation for Gran), the
 * Joneses (Jane, Joe managed by Jane), Eve on her own, and Quinn the admin. One row in every table the console reads.
 */
async function world(transform?: (sql: string) => string) {
  const db = await boot(transform);
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Sam Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const jane = await createUser(db, { email: "jane@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Jane Jones" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve Evans" });
  const quinn = await createUser(db, { email: "quinn@quad.test", birthYear: 1985, roleHint: "guardian", displayName: "Quinn Admin" });
  await db.query("insert into public.admins (user_id, note) values ($1, 'owner')", [quinn]);

  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  const inviteDad = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, $2, 'guardian', null, false, null, null, null)", [household, "dad@example.com"]);
  await rpc(db, dad, "public.accept_invitation($1)", [inviteDad.token]);
  const inviteAlice = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, $2, 'student', null, false, null, null, null)", [household, "alice@example.com"]);
  await rpc(db, alice, "public.accept_invitation($1)", [inviteAlice.token]);
  const student = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2029)", [household]);
  const gran = await rpc<{ id: string; token: string }>(db, mom, "public.create_invitation($1, $2, 'guardian', null, false, 'Gran', null, null)", [household, "gran@example.com"]);

  const joneses = await rpc<string>(db, jane, "public.create_household('The Joneses', 'guardian')");
  const joe = await rpc<string>(db, jane, "public.add_managed_student($1, 'Joe', 2030)", [joneses]);

  const list = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]))).id;
  const item = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position) values ($1, '243744', 0) returning id", [list]))).id;
  await asUser(db, alice, "insert into public.list_notes (item_id, body, private) values ($1, 'my own thoughts', true)", [item]);
  const courses = { basics: { highSchoolId: "HS1" }, academics: { courses: [{ kind: "ap", key: "ap_calculus_bc" }] } };
  await asUser(db, alice, "insert into public.student_profiles (student_id, data) values ($1, $2)", [student, JSON.stringify(courses)]);
  await asUser(db, mom, "select public.log_access($1, 'lists')", [student]);

  // The tables only jobs and the service role write.
  const publish = (await db.query<{ id: number }>("insert into public.dataset_publishes (school_count) values (1) returning id")).rows[0].id;
  await db.query("insert into public.digests (user_id, publish_id, published_at) values ($1, $2, now())", [alice, publish]);
  await db.query("insert into public.notification_prefs (user_id) values ($1) on conflict do nothing", [alice]);
  const consent = (await db.query<{ id: string }>("insert into public.sms_consents (user_id, phone, consented_by) values ($1, '+16155550100', $1) returning id", [alice])).rows[0].id;
  const task = (await db.query<{ id: string }>("insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', 'Write essay', 'own') returning id", [list])).rows[0].id;
  await db.query("insert into public.sms_sends (consent_id, kind, sent_on) values ($1, 'confirm', current_date)", [consent]);
  await db.query("insert into public.plan_offers (item_id, award_year) values ($1, 2027)", [item]);
  await db.query("insert into public.plan_visits (item_id, kind, on_date) values ($1, 'campus_tour', current_date)", [item]);
  await db.query("insert into public.plan_letters (item_id, kind, storage_path, uploaded_by) values ($1, 'aid', 'x/letter.pdf', $2)", [item, mom]);
  await db.query("insert into public.plan_nudges (task_id, from_user, to_student, channel) values ($1, $2, $3, 'app')", [task, mom, student]);
  await db.query("insert into public.application_snapshots (item_id, list_id, student_id, unit_id, season, applied_on) values ($1, $2, $3, '243744', 2027, current_date)", [item, list, student]);
  await db.query("insert into public.college_data_failures (unit_id, name, reason_code, stage, detail, last_run, first_seen, last_seen) values ('243744', 'Purdue', 'never_read', 'read', 'x', current_date, current_date, current_date)");
  await db.query("insert into public.admin_log (admin_id, action) values ($1, 'ops.dispatch')", [quinn]);

  return { db, mom, dad, alice, jane, eve, quinn, household, student, ben, gran, joneses, joe, list, item };
}

type World = Awaited<ReturnType<typeof world>>;

/** Every table with an "Admins read" policy (admin.md "Model"; invitations go through invitations_admin). */
const ADMIN_READ_TABLES = [
  "admins", "admin_log", "profiles", "households", "household_members", "students", "access_log", "student_profiles",
  "lists", "list_items", "list_notes", "follows", "notification_prefs", "digests", "sms_consents", "sms_sends",
  "plan_tasks", "plan_offers", "plan_visits", "plan_letters", "plan_nudges", "application_snapshots",
  "school_course_counts", "college_data_failures", "dataset_publishes",
];

/**
 * Tables where the console doesn't read every row the way an admin should, or where someone else gains rows from
 * the admin policy. Empty when the policies hold.
 */
async function readProblems(w: World): Promise<string[]> {
  const problems: string[] = [];
  for (const table of ADMIN_READ_TABLES) {
    const sql = `select count(*)::int as n from public.${table}`;
    const total = await count(w.db, sql);
    if (total === 0) problems.push(`${table}: no rows to read (seed it)`);
    const admin = Number((await one(as<{ n: number }>(w.db, w.quinn, sql))).n);
    if (admin !== total) problems.push(`${table}: admin read ${admin} of ${total}`);
    const baseline = Number((await one(as<{ n: number }>(w.db, w.quinn, sql, [], { aal: "aal1", console: false }))).n);
    if (baseline >= total) problems.push(`${table}: the admin reads everything without the policy (bad seed)`);
    for (const [label, opts] of [["at aal1", { aal: "aal1" as const }], ["without the console header", { console: false }]] as const) {
      const n = Number((await one(as<{ n: number }>(w.db, w.quinn, sql, [], opts))).n);
      if (n !== baseline) problems.push(`${table}: admin ${label} read ${n}, expected ${baseline}`);
    }
    for (const who of [w.eve, w.mom]) {
      const plain = Number((await one(as<{ n: number }>(w.db, who, sql, [], { console: false }))).n);
      const withHeader = Number((await one(as<{ n: number }>(w.db, who, sql))).n);
      if (withHeader !== plain) problems.push(`${table}: a non-admin with the header read ${withHeader}, expected ${plain}`);
    }
  }
  return problems;
}

/** Each console function, called with real ids so a missing guard would get past the refusal. */
function functionCalls(w: World): [name: string, sql: string, params: unknown[]][] {
  return [
    ["admin_search_people", "select * from public.admin_search_people('smith')", []],
    ["admin_list_people", "select * from public.admin_list_people()", []],
    ["admin_list_households", "select * from public.admin_list_households()", []],
    ["admin_set_email_confirmed", "select public.admin_set_email_confirmed($1, true)", [w.alice]],
    ["admin_user_college_views", "select * from public.admin_user_college_views($1)", [w.alice]],
    ["admin_college_viewers", "select * from public.admin_college_viewers('199847')", []],
    ["admin_college_views_daily", "select * from public.admin_college_views_daily('199847')", []],
    ["admin_college_view_times", "select * from public.admin_college_view_times('199847', $1)", [w.alice]],
    ["admin_top_viewed_colleges", "select * from public.admin_top_viewed_colleges()", []],
    ["admin_user_auth_activity", "select * from public.admin_user_auth_activity($1)", [w.alice]],
    ["admin_selectivity_tier_counts", "select * from public.admin_selectivity_tier_counts('all')", []],
    ["admin_selectivity_movers", "select * from public.admin_selectivity_movers(30)", []],
    ["admin_selectivity_run_changes", "select * from public.admin_selectivity_run_changes(1)", []],
    ["admin_user_auth", "select * from public.admin_user_auth($1)", [w.alice]],
    ["admin_update_profile", "select public.admin_update_profile($1, '{\"display_name\": \"Hacked\"}')", [w.alice]],
    ["admin_update_student", "select public.admin_update_student($1, '{\"display_name\": \"Hacked\"}')", [w.ben]],
    ["admin_update_household", "select public.admin_update_household($1, '{\"name\": \"Hacked\"}')", [w.household]],
    ["admin_link", "select public.admin_link($1, $2)", [w.household, w.joe]],
    ["admin_unlink", "select public.admin_unlink((select id from public.household_members where user_id = $1))", [w.dad]],
    ["admin_revoke_invitation", "select public.admin_revoke_invitation($1)", [w.gran.id]],
    ["admin_claim_student", "select public.admin_claim_student($1, $2)", [w.joe, w.eve]],
    ["admin_delete_account", "select public.admin_delete_account($1)", [w.dad]],
    ["admin_restore_account", "select public.admin_restore_account($1)", [w.dad]],
    ["admin_delete_student", "select public.admin_delete_student($1)", [w.ben]],
    ["admin_close_household", "select public.admin_close_household($1)", [w.joneses]],
    ["admin_export", "select public.admin_export($1)", [w.alice]],
    ["admin_log_access", "select public.admin_log_access($1, 'student page')", [w.student]],
    ["admin_grant", "select public.admin_grant($1)", [w.eve]],
    ["admin_revoke", "select public.admin_revoke($1)", [w.quinn]],
    ["admin_note_ops", "select public.admin_note_ops('ops.dispatch', '{}')", []],
    ["admin_set_setting", "select public.admin_set_setting('planner.all_moves', 'true')", []],
  ];
}

/** Functions that don't refuse with "admin only" for a non-admin at aal2 and for the admin at aal1. Empty when guarded. */
async function refusalProblems(w: World): Promise<string[]> {
  const problems: string[] = [];
  for (const [name, sql, params] of functionCalls(w)) {
    for (const [label, who, opts] of [["a non-admin", w.eve, {}], ["the admin at aal1", w.quinn, { aal: "aal1" as const }]] as const) {
      const message = await errorOf(as(w.db, who, sql, params, opts));
      if (message !== "admin only") problems.push(`${name} for ${label}: ${message}`);
    }
  }
  return problems;
}

test("is_admin: an unrevoked admin at aal2 only; is_admin_any_aal ignores the level; revoked, deleted, and paused admins aren't", async () => {
  const w = await world();
  const check = (who: string, aal: "aal1" | "aal2") => one(as<{ a: boolean; b: boolean }>(w.db, who, "select public.is_admin() as a, public.is_admin_any_aal() as b", [], { aal }));
  assert.deepEqual(await check(w.quinn, "aal2"), { a: true, b: true });
  assert.deepEqual(await check(w.quinn, "aal1"), { a: false, b: true });
  assert.deepEqual(await check(w.eve, "aal2"), { a: false, b: false });
  await w.db.query("update public.profiles set suspended_at = now() where id = $1", [w.quinn]);
  assert.deepEqual(await check(w.quinn, "aal2"), { a: false, b: false });
  await w.db.query("update public.profiles set suspended_at = null, deleted_at = now() where id = $1", [w.quinn]);
  assert.deepEqual(await check(w.quinn, "aal2"), { a: false, b: false });
  await w.db.query("update public.profiles set deleted_at = null where id = $1", [w.quinn]);
  await w.db.query("update public.admins set revoked_at = now() where user_id = $1", [w.quinn]);
  assert.deepEqual(await check(w.quinn, "aal2"), { a: false, b: false });
  // Anyone signed out can't even ask.
  assert.match(await errorOf(asUser(w.db, null, "select public.is_admin()")), /permission denied/);
});

test("Admins read: the admin in the console reads every row of every listed table; at aal1, without the header, or as anyone else, exactly what the policies gave before", async () => {
  const w = await world();
  assert.deepEqual(await readProblems(w), []);
});

test("no admin write path through the tables: updates touch nothing, inserts and deletes are refused", async () => {
  const w = await world();
  const updated = await asAdmin(w, "update public.students set display_name = 'Hacked' returning id");
  assert.equal(updated.length, 0);
  assert.equal((await asAdmin(w, "delete from public.household_members returning id")).length, 0);
  assert.match(await errorOf(asAdmin(w, "insert into public.admin_log (action) values ('profile.update')")), /permission denied/);
  assert.match(await errorOf(asAdmin(w, "insert into public.admins (user_id) values ($1)", [w.eve])), /permission denied/);
  assert.match(await errorOf(asAdmin(w, "update public.admins set revoked_at = now()")), /permission denied/);
});

test("every console function refuses a non-admin and an admin at aal1 with 'admin only'; admin_note_auth_action is the service role's alone", async () => {
  const w = await world();
  assert.deepEqual(await refusalProblems(w), []);
  // Nothing changed and nothing was logged by the refused calls.
  assert.deepEqual(await logActions(w.db), ["ops.dispatch"]);
  assert.equal((await w.db.query<{ name: string }>("select name from public.households where id = $1", [w.household])).rows[0].name, "The Smiths");
  assert.match(await errorOf(as(w.db, w.quinn, "select public.admin_note_auth_action($1, 'auth.sign_out', $2, '{}', 'r1')", [w.quinn, w.eve])), /permission denied/);
  // Every admin_* function in the database is either in the refusal check or one of the deliberate exceptions.
  const covered = new Set(functionCalls(w).map(([name]) => name));
  const exceptions = new Set(["admin_reads", "admin_log_write", "admin_require_user", "admin_note_auth_action", "admin_household_notice"]);
  const all = (await w.db.query<{ proname: string }>("select distinct proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\\_%'")).rows.map((r) => r.proname);
  assert.deepEqual(all.filter((n) => !covered.has(n) && !exceptions.has(n)), []);
  // The internal helpers can't be called through the API at all.
  for (const sql of ["select public.admin_log_write('profile.update', 'user', 'x')", "select public.delete_account_for($1)", "select public.restore_account_for($1)"]) {
    assert.match(await errorOf(as(w.db, w.quinn, sql, sql.includes("$1") ? [w.eve] : [])), /permission denied/, sql);
  }
});

test("each function makes its change and writes one admin_log row, as the admin", async () => {
  const w = await world();
  await asAdmin(w, "select public.admin_update_profile($1, '{\"display_name\": \"Alice S.\", \"phone\": \"+16155550111\"}')", [w.alice]);
  await asAdmin(w, "select public.admin_update_student($1, '{\"grad_year\": 2030}')", [w.ben]);
  await asAdmin(w, "select public.admin_update_household($1, '{\"name\": \"Smith family\"}')", [w.household]);
  const member = (await one(asAdmin<{ v: string }>(w, "select public.admin_link($1, null, $2, false) as v", [w.household, w.eve]))).v;
  await asAdmin(w, "select public.admin_unlink($1)", [member]);
  await asAdmin(w, "select public.admin_revoke_invitation($1)", [w.gran.id]);
  await asAdmin(w, "select public.admin_claim_student($1, $2)", [w.joe, w.eve]);
  await asAdmin(w, "select public.admin_delete_account($1)", [w.dad]);
  await asAdmin(w, "select public.admin_restore_account($1)", [w.dad]);
  await asAdmin(w, "select public.admin_delete_student($1)", [w.ben]);
  const empty = await rpc<string>(w.db, w.dad, "public.create_household('Empty', 'guardian')");
  await asUser(w.db, w.dad, "select public.leave_household($1)", [empty]);
  // leave_household closes a household nobody can act in; reopen it so the admin has an empty one to close.
  await w.db.query("update public.households set deleted_at = null where id = $1", [empty]);
  await asAdmin(w, "select public.admin_close_household($1)", [empty]);
  const exported = (await one(asAdmin<{ v: { student_ids: string[]; own_student_id: string } }>(w, "select public.admin_export($1) as v", [w.alice]))).v;
  assert.deepEqual(exported.student_ids, [w.student]);
  assert.equal(exported.own_student_id, w.student);
  await asAdmin(w, "select public.admin_log_access($1, 'student page')", [w.student]);
  await asAdmin(w, "select public.admin_grant($1, 'support')", [w.mom]);
  await asAdmin(w, "select public.admin_revoke($1)", [w.mom]);
  await asAdmin(w, "select public.admin_note_ops('ops.dispatch', '{\"workflow\": \"verify.yml\"}', 'req-1')");
  assert.match(await errorOf(asAdmin(w, "select public.admin_note_ops('profile.update', '{}')")), /invalid_action/);

  const rows = (await w.db.query<{ admin_id: string; action: string; target_kind: string | null; target_id: string | null; details: Record<string, unknown>; request_id: string | null }>(
    "select admin_id, action, target_kind, target_id, details, request_id from public.admin_log where id > 1 order by id",
  )).rows;
  assert.deepEqual(rows.map((r) => r.action), [
    "profile.update", "student.update", "household.update", "household.link", "household.unlink", "invitation.revoke", "student.claim",
    "account.delete", "account.restore", "student.delete", "household.close", "account.export", "access.view", "admin.grant", "admin.revoke", "ops.dispatch",
  ]);
  assert.ok(rows.every((r) => r.admin_id === w.quinn));
  assert.deepEqual(rows[0].details, { before: { display_name: "Alice Smith", phone: null }, after: { display_name: "Alice S.", phone: "+16155550111" } });
  assert.equal(rows[0].target_id, w.alice);
  assert.deepEqual(rows[1].details, { before: { grad_year: 2029 }, after: { grad_year: 2030 } });
  assert.equal(rows[3].target_kind, "member");
  assert.equal(rows[3].details.member_name, "Eve Evans");
  assert.equal(rows[15].request_id, "req-1");
  // Nothing in the log is a secret: no token, no email outside auth.email rows.
  const text = JSON.stringify(rows);
  assert.ok(!text.includes(w.gran.token) && !/@example\.com/.test(text), text);

  // The changes themselves.
  assert.equal((await w.db.query<{ display_name: string }>("select display_name from public.profiles where id = $1", [w.alice])).rows[0].display_name, "Alice S.");
  assert.equal((await w.db.query<{ name: string }>("select name from public.households where id = $1", [w.household])).rows[0].name, "Smith family");
  assert.equal((await w.db.query<{ user_id: string }>("select user_id from public.students where id = $1", [w.joe])).rows[0].user_id, w.eve);
  assert.ok((await w.db.query<{ deleted_at: string }>("select deleted_at from public.students where id = $1", [w.ben])).rows[0].deleted_at);
  assert.equal((await w.db.query<{ deleted_at: string | null }>("select deleted_at from public.profiles where id = $1", [w.dad])).rows[0].deleted_at, null);
  assert.ok((await w.db.query<{ revoked_at: string }>("select revoked_at from public.invitations where id = $1", [w.gran.id])).rows[0].revoked_at);
  assert.ok((await w.db.query<{ revoked_at: string }>("select revoked_at from public.admins where user_id = $1", [w.mom])).rows[0].revoked_at);
});

test("admin_search_people: emails, names, households, invitations, ids, and typos; statuses marked", async () => {
  const w = await world();
  await w.db.query("update public.profiles set suspended_at = now() where id = $1", [w.dad]);
  await w.db.query("update auth.users set last_sign_in_at = '2026-10-10T12:00:00Z' where id = $1", [w.alice]);
  type Row = { kind: string; id: string; name: string | null; email: string | null; household: string | null; role: string | null; status: string; last_sign_in: string | null };
  const search = (q: string) => asAdmin<Row>(w, "select * from public.admin_search_people($1)", [q]);

  const smith = await search("smith");
  assert.deepEqual(smith.map((r) => [r.kind, r.name ?? r.email, r.status]), [
    ["user", "Alice Smith", "active"],
    ["user", "Sam Smith", "paused"],
    ["user", "Tracy Smith", "active"],
    ["student", "Alice Smith", "active"],
    ["household", "The Smiths", "active"],
  ]);
  const alice = smith[0];
  assert.equal(alice.email, "alice@example.com");
  assert.equal(alice.household, "The Smiths");
  assert.ok(alice.last_sign_in);
  assert.deepEqual((await search("gran")).map((r) => [r.kind, r.name, r.email, r.status, r.role]), [["invitation", "Gran", "gran@example.com", "invited", "guardian"]]);
  assert.deepEqual((await search("joe")).map((r) => [r.kind, r.name, r.household, r.status]), [["student", "Joe", "The Joneses", "managed"]]);
  assert.deepEqual((await search(w.student)).map((r) => [r.kind, r.name]), [["student", "Alice Smith"]]);
  assert.deepEqual((await search("jones")).map((r) => r.kind).sort(), ["household", "user"]);
  assert.ok((await search("evanss")).some((r) => r.name === "Eve Evans"), "a trigram match finds a misspelling");
  assert.deepEqual(await search("   "), []);
  // A % in the query is a character, not a wildcard.
  assert.deepEqual(await search("%"), []);
});

test("admin_list_people: every account and managed record, newest first, paged with the full count", async () => {
  const w = await world();
  type Row = { kind: string; id: string; name: string | null; status: string; created: string; total: string };
  const list = (page: number, size: number) => asAdmin<Row>(w, "select * from public.admin_list_people($1, $2)", [page, size]);
  const accounts = Number((await w.db.query<{ n: number }>("select count(*)::int as n from auth.users")).rows[0].n);
  const managed = Number((await w.db.query<{ n: number }>("select count(*)::int as n from public.students where user_id is null")).rows[0].n);
  const all = await list(1, 200);
  assert.equal(all.length, accounts + managed);
  assert.ok(all.every((r) => Number(r.total) === all.length));
  assert.ok(all.every((r, i) => i === 0 || all[i - 1].created >= r.created), "newest first");
  assert.ok(all.some((r) => r.kind === "student" && r.name === "Joe" && r.status === "managed"));
  assert.ok(!all.some((r) => r.kind === "student" && r.name === "Alice Smith"), "a student with an account is listed once, as the account");
  const first = await list(1, 2);
  const second = await list(2, 2);
  assert.deepEqual([...first, ...second].map((r) => r.id), all.slice(0, 4).map((r) => r.id));
  assert.equal(Number(first[0].total), all.length);
  assert.deepEqual(await list(999, 50), []);
});

test("admin_list_households: every household with its members and waiting invitations; search by name, member, email, invitation", async () => {
  const w = await world();
  type Row = { id: string; name: string; status: string; guardians: number; students: number; invitations: number; members: string | null; total: string };
  const list = (q: string | null, page = 1, size = 50) => asAdmin<Row>(w, "select * from public.admin_list_households($1, $2, $3)", [q, page, size]);
  const households = Number((await w.db.query<{ n: number }>("select count(*)::int as n from public.households")).rows[0].n);
  const all = await list(null);
  assert.equal(all.length, households);
  assert.ok(all.every((r) => Number(r.total) === households));
  const smiths = all.find((r) => r.id === w.household)!;
  assert.equal(smiths.name, "The Smiths");
  assert.ok(smiths.guardians >= 1 && smiths.students >= 1);
  assert.equal(smiths.invitations, 1, "Gran's invitation is waiting");
  assert.match(smiths.members ?? "", /Alice Smith/);
  assert.deepEqual((await list("smiths")).map((r) => r.id), [w.household]);
  assert.deepEqual((await list("alice@example.com")).map((r) => r.id), [w.household], "a member's account email");
  assert.deepEqual((await list("gran@example")).map((r) => r.id), [w.household], "a waiting invitation's email");
  assert.deepEqual((await list(w.household)).map((r) => r.id), [w.household]);
  assert.deepEqual((await list("joe")).map((r) => r.id), [w.joneses], "a managed student's name");
  assert.deepEqual(await list("%"), []);
  if (households > 1) assert.equal((await list(null, 2, 1)).length, 1);
  assert.deepEqual(await list(null, 999), []);
});

test("admin_set_email_confirmed: confirms, unconfirms and signs them out, logs both, never unconfirms yourself; People shows the state", async () => {
  const w = await world();
  const confirmedAt = async (id: string) => (await w.db.query<{ at: string | null }>("select email_confirmed_at as at from auth.users where id = $1", [id])).rows[0].at;
  await w.db.query("update auth.users set email_confirmed_at = null where id = $1", [w.alice]);
  type Row = { kind: string; id: string; email_confirmed: boolean | null };
  const listed = async () => await asAdmin<Row>(w, "select * from public.admin_list_people(1, 200)");
  assert.equal((await listed()).find((r) => r.id === w.alice)?.email_confirmed, false);
  assert.equal((await asAdmin<Row>(w, "select * from public.admin_search_people('alice')")).find((r) => r.kind === "user")?.email_confirmed, false);
  assert.ok((await listed()).filter((r) => r.kind === "student").every((r) => r.email_confirmed === null), "managed records have no email to confirm");

  await asAdmin(w, "select public.admin_set_email_confirmed($1, true)", [w.alice]);
  assert.ok(await confirmedAt(w.alice));
  assert.equal((await listed()).find((r) => r.id === w.alice)?.email_confirmed, true);
  await asAdmin(w, "select public.admin_set_email_confirmed($1, true)", [w.alice]); // already confirmed: no change, no log row

  await w.db.query("insert into auth.sessions (user_id) values ($1), ($1)", [w.alice]);
  await asAdmin(w, "select public.admin_set_email_confirmed($1, false)", [w.alice]);
  assert.equal(await confirmedAt(w.alice), null);
  assert.equal(Number((await w.db.query<{ n: number }>("select count(*)::int as n from auth.sessions where user_id = $1", [w.alice])).rows[0].n), 0, "unconfirming signs them out");

  const log = (await w.db.query<{ action: string; details: { sessions_ended?: number } }>("select action, details from public.admin_log where target_id = $1 order by id", [w.alice])).rows;
  assert.deepEqual(log.map((r) => r.action), ["auth.confirm", "auth.unconfirm"]);
  assert.equal(log[1].details.sessions_ended, 2);

  await assert.rejects(asAdmin(w, "select public.admin_set_email_confirmed($1, false)", [w.quinn]), /cannot_change_self/);
  await assert.rejects(asAdmin(w, "select public.admin_set_email_confirmed($1, null)", [w.alice]), /invalid_state/);
});

test("admin_set_setting: known keys and value types only, logged with the old and new value; anyone reads; nobody writes the table", async () => {
  const w = await world();
  const read = async (who: string) => (await as<{ value: unknown }>(w.db, who, "select value from public.app_settings where key = 'planner.all_moves'", [], { console: false }))[0]?.value ?? null;
  assert.equal(await read(w.eve), null, "no row until an admin sets it");
  await asAdmin(w, "select public.admin_set_setting('planner.all_moves', 'true')");
  await asAdmin(w, "select public.admin_set_setting('planner.all_moves', 'false')");
  assert.equal(await read(w.eve), false);
  const log = (await w.db.query<{ action: string; target_id: string; details: { from: unknown; to: unknown } }>("select action, target_id, details from public.admin_log where action = 'setting.set' order by id")).rows;
  assert.deepEqual(log.map((r) => [r.target_id, r.details.from, r.details.to]), [["planner.all_moves", null, true], ["planner.all_moves", true, false]]);
  await assert.rejects(asAdmin(w, "select public.admin_set_setting('planner.nope', 'true')"), /unknown_setting/);
  await assert.rejects(asAdmin(w, "select public.admin_set_setting('planner.all_moves', '\"yes\"')"), /invalid_value/);
  await assert.rejects(as(w.db, w.eve, "update public.app_settings set value = 'true'", [], { console: false }), /permission denied/);
  await assert.rejects(as(w.db, w.quinn, "update public.app_settings set value = 'true'"), /permission denied/, "an admin writes only through the function");
  assert.equal(await read(w.eve), false);
  await assert.rejects(as(w.db, w.eve, "insert into public.app_settings (key, value) values ('planner.other', 'true')", [], { console: false }));
});

test("college views: anyone records a view under their own session; repeats fold; only admins and the person read them", async () => {
  const w = await world();
  const view = (who: string | null, unit: string, page = "overview") =>
    asUser<{ v: boolean }>(w.db, who, "select public.record_college_view($1, $2) as v", [unit, page]).then((r) => r[0].v);
  const count = async () => Number((await w.db.query<{ n: number }>("select count(*)::int as n from public.college_views")).rows[0].n);

  assert.equal(await view(null, "199847"), true, "a signed-out visitor records a view");
  assert.equal(await view(null, "199847"), true, "signed-out repeats can't be told apart, so they count");
  assert.equal(await view(w.alice, "199847"), true);
  assert.equal(await view(w.alice, "199847"), false, "the same person, page, and college within 10 minutes is one view");
  assert.equal(await view(w.alice, "199847", "cost"), true, "another page is another view");
  assert.equal(await view(w.alice, "199120"), true);
  assert.equal(await view(w.mom, "199847"), true);
  assert.equal(await count(), 6);
  const stored = (await w.db.query<{ user_id: string | null }>("select user_id from public.college_views order by id")).rows.map((r) => r.user_id);
  assert.deepEqual(stored, [null, null, w.alice, w.alice, w.alice, w.mom], "the user comes from the session");
  await assert.rejects(view(w.alice, "12345"), /invalid_view/);
  await assert.rejects(view(w.alice, "199847", "secret"), /invalid_view/);

  // Nobody writes the table directly; a person reads only their own rows; a signed-out visitor reads nothing.
  await assert.rejects(asUser(w.db, w.alice, "insert into public.college_views (unit_id, user_id) values ('199847', $1)", [w.mom]));
  assert.equal((await asUser(w.db, w.alice, "select * from public.college_views")).length, 3);
  assert.equal((await asUser(w.db, w.dad, "select * from public.college_views")).length, 0);
  await assert.rejects(asUser(w.db, null, "select * from public.college_views"));

  type Viewer = { user_id: string | null; views: string };
  const viewers = await asAdmin<Viewer>(w, "select * from public.admin_college_viewers('199847')");
  assert.deepEqual(viewers.map((r) => [r.user_id, Number(r.views)]), [[w.alice, 2], [w.mom, 1], [null, 2]], "most views first, signed-out views last as one row");
  const mine = await asAdmin<{ unit_id: string; views: string }>(w, "select * from public.admin_user_college_views($1)", [w.alice]);
  assert.deepEqual(mine.map((r) => [r.unit_id, Number(r.views)]), [["199847", 2], ["199120", 1]]);
  const daily = await asAdmin<{ signed_in: string; signed_out: string }>(w, "select * from public.admin_college_views_daily('199847', null, 7)");
  assert.equal(daily.length, 7, "every day present, zeros included");
  assert.deepEqual([daily.reduce((n, d) => n + Number(d.signed_in), 0), daily.reduce((n, d) => n + Number(d.signed_out), 0)], [3, 2]);
  assert.equal((await asAdmin(w, "select * from public.admin_college_view_times('199847', $1)", [w.alice])).length, 2);
  assert.equal((await asAdmin(w, "select * from public.admin_college_view_times('199847', null, true)")).length, 2);
  await assert.rejects(asAdmin(w, "select * from public.admin_college_view_times('199847')"), /invalid_view/);

  // A purged account's views stay, as signed-out views.
  await w.db.query("delete from auth.users where id = $1", [w.mom]);
  assert.equal(await count(), 6);
  assert.equal(Number((await w.db.query<{ n: number }>("select count(*)::int as n from public.college_views where user_id is null")).rows[0].n), 3);
});

test("selectivity history: one row per college with its three pools; nothing recorded for an empty publish; only an admin in the console reads", async () => {
  const w = await world();
  const run = (commit: string, at: string, method: string, cause: string, rows: unknown[]) =>
    asService<{ v: number | null }>(w.db, "select public.record_selectivity_run($1::jsonb, $2::jsonb) as v", [
      JSON.stringify({ git_commit: commit, published_at: at, method, elite_index: 80, counts: { elite: 29 }, elite_any_pool: 29, rated: 2, cause }),
      JSON.stringify(rows),
    ]).then((r) => r[0].v);
  type Pools = { all?: [number, string]; in_state?: [number, string]; out_of_state?: [number, string] };
  const row = (unit: string, pools: Pools, cause: string) => ({
    unit_id: unit,
    rank: 58,
    tier_year: "Fall 2025",
    band: null,
    ...Object.fromEntries((["all", "in_state", "out_of_state"] as const).flatMap((p) => [[`score_${p}`, pools[p]?.[0] ?? null], [`tier_${p}`, pools[p]?.[1] ?? null], [`held_${p}`, false]])),
    cause,
    inputs: { admit_rate: { v: 0.2222, year: "Fall 2025", source: "college-site" } },
  });

  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const first = await run("1bbc2596", ago(40), "2026.10.12.3", "backfill", [row("228778", { all: [70.92, "highly_selective"] }, "backfill"), row("166027", { all: [91.65, "elite"] }, "backfill")]);
  assert.ok(first);
  assert.equal(await run("1bbc2596", ago(40), "2026.10.12.3", "backfill", [row("228778", { all: [70.92, "highly_selective"] }, "backfill")]), null, "a recorded commit writes nothing");
  assert.equal(await run("e330a588", ago(20), "2026.10.12.3", "data", []), null, "a publish that changed no college writes nothing");
  assert.equal((await asService(w.db, "select * from public.selectivity_publishes")).length, 1, "not even its run");
  const second = await run("3c5b4280", ago(1), "2026.10.12.3", "data", [
    row("228778", { all: [72.45, "highly_selective"], out_of_state: [80.49, "elite"] }, "data"),
    row("166027", { all: [79.5, "highly_selective"] }, "data"),
  ]);
  // A score without its tier (or the reverse) is refused.
  await assert.rejects(asService(w.db, "insert into public.selectivity_history (run_id, published_at, unit_id, score_all, cause) values ($1, now(), '100654', 50, 'data')", [second]));

  // Nobody else writes; only an admin in the console reads.
  await assert.rejects(asUser(w.db, w.quinn, "select public.record_selectivity_run('{}'::jsonb, '[]'::jsonb)"));
  await assert.rejects(asUser(w.db, w.quinn, "insert into public.selectivity_history (run_id, published_at, unit_id, cause) values ($1, now(), '228778', 'data')", [second]));
  assert.equal((await asUser(w.db, w.alice, "select * from public.selectivity_history")).length, 0);
  await assert.rejects(asUser(w.db, null, "select * from public.selectivity_history"));
  assert.equal((await as(w.db, w.quinn, "select * from public.selectivity_history", [], { console: false })).length, 0, "the console header is needed");
  assert.equal((await asAdmin(w, "select * from public.selectivity_history")).length, 4, "one row per college per publish");
  type Latest = { unit_id: string; score_all: string; score_out_of_state: string | null };
  const latest = await asService<Latest>(w.db, "select * from public.selectivity_latest_rows()");
  assert.deepEqual(latest.map((l) => [l.unit_id, Number(l.score_all), l.score_out_of_state === null ? null : Number(l.score_out_of_state)]), [["166027", 79.5, null], ["228778", 72.45, 80.49]]);

  type Change = { unit_id: string; tier_all: string; prev_tier_all: string | null; tier_out_of_state: string | null; prev_tier_out_of_state: string | null };
  const changes = await asAdmin<Change>(w, "select * from public.admin_selectivity_run_changes($1)", [second]);
  assert.deepEqual(changes.map((c) => [c.unit_id, c.prev_tier_all, c.tier_all, c.prev_tier_out_of_state, c.tier_out_of_state]), [
    ["166027", "elite", "highly_selective", null, null],
    ["228778", "highly_selective", "highly_selective", null, "elite"],
  ]);
  type Mover = { unit_id: string; pool: string; delta: string | null };
  const moved = await asAdmin<Mover>(w, "select * from public.admin_selectivity_movers(30)");
  assert.deepEqual(moved.map((m) => [m.unit_id, m.pool, m.delta === null ? null : Number(m.delta)]), [
    ["166027", "all", -12.15],
    ["228778", "all", 1.53],
    ["228778", "out_of_state", null],
  ]);
  const outOnly = await asAdmin<Mover>(w, "select * from public.admin_selectivity_movers(30, 'out_of_state')");
  assert.deepEqual(outOnly.map((m) => [m.unit_id, m.pool]), [["228778", "out_of_state"]]);
  type Count = { cause: string; counts: Record<string, number> };
  const counts = await asAdmin<Count>(w, "select * from public.admin_selectivity_tier_counts('all')");
  assert.deepEqual(counts.map((c) => c.counts), [{ elite: 1, highly_selective: 1 }, { highly_selective: 2 }]);
  const outCounts = await asAdmin<Count>(w, "select * from public.admin_selectivity_tier_counts('out_of_state')");
  assert.deepEqual(outCounts.map((c) => c.counts), [{}, { elite: 1 }]);
});

test("admin_user_auth_activity: sessions, the account's dates, its audit log (no token refreshes), and support's actions; never an address", async () => {
  const w = await world();
  await w.db.query("update auth.users set created_at = now() - interval '3 days', confirmation_sent_at = now() - interval '3 days', email_confirmed_at = now() - interval '3 days', recovery_sent_at = now() - interval '1 hour' where id = $1", [w.alice]);
  await w.db.query("insert into auth.sessions (user_id, created_at, aal, user_agent, ip, updated_at) values ($1, now() - interval '50 minutes', 'aal1', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1', '203.0.113.9', now() - interval '5 minutes')", [w.alice]);
  for (const [action, ago] of [["login", "50 minutes"], ["token_refreshed", "20 minutes"], ["user_updated_password", "45 minutes"]] as const) {
    await w.db.query("insert into auth.audit_log_entries (payload, created_at, ip_address) values ($1::json, now() - $2::interval, '203.0.113.9')", [JSON.stringify({ action, actor_id: w.alice, log_type: "account" }), ago]);
  }
  await w.db.query("insert into auth.audit_log_entries (payload) values ($1::json)", [JSON.stringify({ action: "login", actor_id: w.mom })]);
  type Row = { at: string; kind: string; detail: string | null; source: string };
  const rows = await asAdmin<Row>(w, "select * from public.admin_user_auth_activity($1)", [w.alice]);
  const kinds = rows.map((r) => r.kind);
  assert.ok(kinds.includes("login") && kinds.includes("user_updated_password"), kinds.join(", "));
  assert.ok(!kinds.includes("token_refreshed"), "token refreshes are noise");
  assert.ok(kinds.includes("session_started") && kinds.includes("session_active") && kinds.includes("recovery_sent") && kinds.includes("account_created"));
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].at >= r.at), "newest first");
  assert.ok(!JSON.stringify(rows).includes("203.0.113.9"), "no IP address in any row");
  assert.equal(rows.filter((r) => r.source === "audit").length, 2, "only this account's audit rows");
});

test("admin_top_viewed_colleges: most views first, people and signed-out views split, the window narrows", async () => {
  const w = await world();
  const add = (unit: string, user: string | null, ago: string) =>
    w.db.query("insert into public.college_views (unit_id, user_id, viewed_at) values ($1, $2, now() - $3::interval)", [unit, user, ago]);
  for (const [unit, user, ago] of [
    ["199847", w.alice, "1 day"], ["199847", w.mom, "2 days"], ["199847", null, "3 days"], ["199847", w.alice, "40 days"],
    ["199120", w.alice, "1 day"], ["199120", null, "1 day"],
    ["166027", null, "60 days"],
  ] as const) await add(unit, user, ago);
  type Row = { unit_id: string; views: string; people: string; signed_out: string };
  const month = await asAdmin<Row>(w, "select * from public.admin_top_viewed_colleges(30)");
  assert.deepEqual(month.map((r) => [r.unit_id, Number(r.views), Number(r.people), Number(r.signed_out)]), [["199847", 3, 2, 1], ["199120", 2, 1, 1]]);
  const all = await asAdmin<Row>(w, "select * from public.admin_top_viewed_colleges(null)");
  assert.deepEqual(all.map((r) => [r.unit_id, Number(r.views)]), [["199847", 4], ["199120", 2], ["166027", 1]]);
  assert.equal((await asAdmin(w, "select * from public.admin_top_viewed_colleges(null, 1)")).length, 1);
});

test("admin_link: six seats counting invitations, one household per person (moved, never duplicated), the household left behind closed", async () => {
  const w = await world();
  // Move Joe (managed by Jane) from the Joneses to the Smiths: the Smiths have Mom, Dad, Alice, Ben, and Gran's invitation.
  const member = (await one(asAdmin<{ v: string }>(w, "select public.admin_link($1, $2) as v", [w.household, w.joe]))).v;
  const joeRows = (await w.db.query<{ household_id: string }>("select household_id from public.household_members where student_id = $1", [w.joe])).rows;
  assert.deepEqual(joeRows.map((r) => r.household_id), [w.household]);
  assert.equal((await w.db.query<{ id: string }>("select id from public.household_members where student_id = $1", [w.joe])).rows[0].id, member);
  const log = (await w.db.query<{ details: { moved_from: string[] } }>("select details from public.admin_log where action = 'household.link'")).rows[0];
  assert.deepEqual(log.details.moved_from, [w.joneses]);
  // Six seats now (five members and Gran's invitation): a seventh is refused.
  assert.match(await errorOf(asAdmin(w, "select public.admin_link($1, null, $2)", [w.household, w.eve])), /household_full/);
  await asAdmin(w, "select public.admin_revoke_invitation($1)", [w.gran.id]);
  // Jane moves too; the Joneses are left with nobody and close.
  await asAdmin(w, "select public.admin_link($1, null, $2)", [w.household, w.jane]);
  assert.equal((await w.db.query<{ n: number }>("select count(*)::int as n from public.household_members where user_id = $1", [w.jane])).rows[0].n, 1);
  assert.ok((await w.db.query<{ deleted_at: string }>("select deleted_at from public.households where id = $1", [w.joneses])).rows[0].deleted_at);
  assert.match(await errorOf(asAdmin(w, "select public.admin_link($1, null, $2)", [w.household, w.jane])), /already_member/);
  assert.match(await errorOf(asAdmin(w, "select public.admin_link($1, $2, $3)", [w.household, w.joe, w.jane])), /invalid_link/);
  assert.match(await errorOf(asAdmin(w, "select public.admin_link($1, null, $2)", [w.joneses, w.eve])), /household_not_found/);
});

test("admin_unlink refuses the last guardian of a managed student and passes managed records to the guardian who stays", async () => {
  const w = await world();
  const memberOf = async (user: string) => (await w.db.query<{ id: string }>("select id from public.household_members where user_id = $1", [user])).rows[0].id;
  // Mom manages Ben; Dad stays, so Mom can go and Ben passes to Dad.
  await asAdmin(w, "select public.admin_unlink($1)", [await memberOf(w.mom)]);
  assert.equal((await w.db.query<{ managed_by: string }>("select managed_by from public.students where id = $1", [w.ben])).rows[0].managed_by, w.dad);
  // Dad is now the only guardian with a managed student in the household.
  const refusal = await errorOf(asAdmin(w, "select public.admin_unlink($1)", [await memberOf(w.dad)]));
  assert.match(refusal, /last_guardian_of_managed/);
  // Jane is the only guardian of Joe too.
  assert.match(await errorOf(asAdmin(w, "select public.admin_unlink($1)", [await memberOf(w.jane)])), /last_guardian_of_managed/);
  // A student's membership goes; the record stays.
  const aliceMember = (await w.db.query<{ id: string }>("select id from public.household_members where student_id = $1", [w.student])).rows[0].id;
  await asAdmin(w, "select public.admin_unlink($1)", [aliceMember]);
  assert.equal((await w.db.query<{ deleted_at: string | null }>("select deleted_at from public.students where id = $1", [w.student])).rows[0].deleted_at, null);
});

test("admin_revoke: never yourself, never the last admin", async () => {
  const w = await world();
  assert.match(await errorOf(asAdmin(w, "select public.admin_revoke($1)", [w.quinn])), /cannot_revoke_self/);
  assert.match(await errorOf(asAdmin(w, "select public.admin_revoke($1)", [w.eve])), /not_admin/);
  await asAdmin(w, "select public.admin_grant($1)", [w.jane]);
  assert.match(await errorOf(asAdmin(w, "select public.admin_grant($1)", [w.jane])), /already_admin/);
  // Jane revokes Quinn; Jane is the last admin and can't go.
  await as(w.db, w.jane, "select public.admin_revoke($1)", [w.quinn]);
  assert.equal(await lastAdminProblem(w, w.jane), null);
  assert.equal(await count(w.db, "select count(*)::int as n from public.admins where revoked_at is null"), 1);
  assert.equal(await errorOf(asAdmin(w, "select public.admin_revoke($1)", [w.jane])), "admin only");
});

/**
 * Null when the only admin can't be revoked. The self rule answers first; the last-admin rule stands behind it (the
 * guard test removes the self rule to reach it).
 */
async function lastAdminProblem(w: World, only: string): Promise<string | null> {
  const message = await errorOf(as(w.db, only, "select public.admin_revoke($1)", [only]));
  return /cannot_revoke_self|last_admin/.test(message) ? null : `the last admin was revoked (${message})`;
}

test("invitations_admin never exposes a token; household_homes_admin never the street; both empty for anyone else", async () => {
  const w = await world();
  const rows = await asAdmin<Record<string, unknown>>(w, "select * from public.invitations_admin");
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    assert.ok(!("token" in row) && !("token_hash" in row), Object.keys(row).join(", "));
    assert.ok(!Object.values(row).some((v) => v === w.gran.token));
  }
  assert.deepEqual(await as(w.db, w.mom, "select * from public.invitations_admin"), []);
  assert.deepEqual(await asAdmin(w, "select * from public.invitations_admin", []).then(() => as(w.db, w.quinn, "select * from public.invitations_admin", [], { aal: "aal1" })), []);
  await asUser(w.db, w.mom, "insert into public.household_homes (household_id, lat, lng, label, place, set_by) values ($1, 36.1, -86.8, '12 Elm St, Nashville, TN 37201', 'Nashville, TN', $2)", [w.household, w.mom]);
  const homes = await asAdmin<Record<string, unknown>>(w, "select * from public.household_homes_admin");
  assert.deepEqual(homes.map((h) => h.place), ["Nashville, TN"]);
  assert.ok(!JSON.stringify(homes).includes("Elm") && !("label" in homes[0]) && !("lat" in homes[0]));
  assert.deepEqual(await as(w.db, w.eve, "select * from public.household_homes_admin"), []);
  // The admin still can't read the home table itself, or invitations' tokens through the table.
  assert.deepEqual(await asAdmin(w, "select * from public.household_homes"), []);
  assert.deepEqual(await asAdmin(w, "select token from public.invitations"), []);
});

test("an admin's view reads 'Quad support' to the student, with no id; the student's direct read hides it; a guardian can't log under that label", async () => {
  const w = await world();
  await asAdmin(w, "select public.admin_log_access($1, 'student page')", [w.student]);
  const log = await asUser<{ table_name: string; viewer_id: string | null; viewer_name: string | null }>(w.db, w.alice, "select table_name, viewer_id, viewer_name from public.my_access_log()");
  assert.deepEqual(log.map((r) => [r.table_name, r.viewer_name]), [["admin", "Quad support"], ["lists", "Tracy Smith"]]);
  assert.equal(log[0].viewer_id, null);
  assert.ok(!JSON.stringify(log).includes(w.quinn) && !JSON.stringify(log).includes("Quinn"));
  const direct = await asUser<{ viewer_id: string }>(w.db, w.alice, "select viewer_id from public.access_log");
  assert.ok(!direct.some((r) => r.viewer_id === w.quinn));
  // A guardian logging a view as 'admin' is recorded as an ordinary view under their own name.
  await asUser(w.db, w.mom, "select public.log_access($1, 'admin')", [w.student]);
  const after = await asUser<{ table_name: string; viewer_name: string }>(w.db, w.alice, "select table_name, viewer_name from public.my_access_log() where viewer_name = 'Tracy Smith'");
  assert.ok(after.some((r) => r.table_name === "information"));
  assert.ok(!after.some((r) => r.table_name === "admin"));
});

test("a paused account: the owner can neither lift nor set the pause; admin_note_auth_action does both, as the service role", async () => {
  const w = await world();
  await asService(w.db, "select public.admin_note_auth_action($1, 'account.suspend', $2, $3, 'req-9')", [w.quinn, w.alice, JSON.stringify({ reason: "Asked by the family" })]);
  const paused = (await w.db.query<{ suspended_at: string | null; suspended_reason: string | null }>("select suspended_at, suspended_reason from public.profiles where id = $1", [w.alice])).rows[0];
  assert.ok(paused.suspended_at);
  assert.equal(paused.suspended_reason, "Asked by the family");
  assert.match(await errorOf(asUser(w.db, w.alice, "update public.profiles set suspended_at = null where id = $1", [w.alice])), /profiles_suspension_immutable/);
  assert.match(await errorOf(asUser(w.db, w.eve, "update public.profiles set suspended_reason = 'x' where id = $1", [w.eve])), /profiles_suspension_immutable/);
  // Other profile edits still work for the owner.
  await asUser(w.db, w.eve, "update public.profiles set display_name = 'Eve E.' where id = $1", [w.eve]);
  await asService(w.db, "select public.admin_note_auth_action($1, 'account.unsuspend', $2, '{}', 'req-10')", [w.quinn, w.alice]);
  assert.equal((await w.db.query<{ suspended_at: string | null }>("select suspended_at from public.profiles where id = $1", [w.alice])).rows[0].suspended_at, null);
  const rows = (await w.db.query<{ admin_id: string; action: string; request_id: string }>("select admin_id, action, request_id from public.admin_log where request_id like 'req-%' order by id")).rows;
  assert.deepEqual(rows, [{ admin_id: w.quinn, action: "account.suspend", request_id: "req-9" }, { admin_id: w.quinn, action: "account.unsuspend", request_id: "req-10" }]);
  assert.match(await errorOf(asService(w.db, "select public.admin_note_auth_action($1, 'profile.update', $2, '{}', 'x')", [w.quinn, w.alice])), /invalid_action/);
  assert.match(await errorOf(asService(w.db, "select public.admin_note_auth_action($1, 'auth.sign_out', $2, '{}', 'x')", [w.eve, w.alice])), /admin only/);
});

test("admin_delete_account follows delete_my_account's rules (one body): managed students pass on, memberships go; restore brings it back; an admin's account is refused", async () => {
  const w = await world();
  await asAdmin(w, "select public.admin_delete_account($1)", [w.mom]);
  assert.equal((await w.db.query<{ managed_by: string }>("select managed_by from public.students where id = $1", [w.ben])).rows[0].managed_by, w.dad);
  assert.equal(await count(w.db, "select count(*)::int as n from public.household_members where user_id = $1", [w.mom]), 0);
  const deleted = (await w.db.query<{ details: Record<string, unknown> }>("select details from public.admin_log where action = 'account.delete'")).rows[0].details;
  assert.equal(deleted.managed_kept, 1);
  assert.match(await errorOf(asAdmin(w, "select public.admin_delete_account($1)", [w.mom])), /account_deleted/);
  await asAdmin(w, "select public.admin_restore_account($1)", [w.mom]);
  assert.match(await errorOf(asAdmin(w, "select public.admin_restore_account($1)", [w.mom])), /not_deleted/);
  assert.match(await errorOf(asAdmin(w, "select public.admin_delete_account($1)", [w.quinn])), /revoke_admin_first/);
  // The person's own delete still works the same way (Jane manages Joe alone: Joe goes with her).
  const own = await rpc<{ managed_deleted: number }>(w.db, w.jane, "public.delete_my_account()");
  assert.equal(own.managed_deleted, 1);
  await asUser(w.db, w.jane, "select public.restore_my_account()");
  assert.equal((await w.db.query<{ deleted_at: string | null }>("select deleted_at from public.students where id = $1", [w.joe])).rows[0].deleted_at, null);
});

test("admin_claim_student and admin_delete_student keep the record rules", async () => {
  const w = await world();
  assert.match(await errorOf(asAdmin(w, "select public.admin_claim_student($1, $2)", [w.ben, w.alice])), /user_has_student/);
  assert.match(await errorOf(asAdmin(w, "select public.admin_claim_student($1, $2)", [w.student, w.eve])), /student_has_account/);
  assert.match(await errorOf(asAdmin(w, "select public.admin_claim_student($1, $2)", [w.ben, w.jane])), /already_in_household/);
  assert.match(await errorOf(asAdmin(w, "select public.admin_delete_student($1)", [w.student])), /student_has_account/);
  await asAdmin(w, "select public.admin_claim_student($1, $2)", [w.ben, w.eve]);
  // Eve now reads Ben's record as her own, and the Smiths keep him.
  assert.deepEqual((await asUser<{ id: string }>(w.db, w.eve, "select id from public.students where user_id = $1", [w.eve])).map((r) => r.id), [w.ben]);
  assert.equal(await count(w.db, "select count(*)::int as n from public.household_members where student_id = $1 and household_id = $2", [w.ben, w.household]), 1);
});

test("admin_household_notice: the household's members see who support added or removed in the last 30 days; nobody else does; never the admin", async () => {
  const w = await world();
  await asAdmin(w, "select public.admin_revoke_invitation($1)", [w.gran.id]);
  const member = (await one(asAdmin<{ v: string }>(w, "select public.admin_link($1, null, $2) as v", [w.household, w.eve]))).v;
  await asAdmin(w, "select public.admin_unlink($1)", [member]);
  await w.db.query("insert into public.admin_log (admin_id, action, details, at) values ($1, 'household.link', $2, now() - interval '31 days')", [w.quinn, JSON.stringify({ household_id: w.household, member_name: "Old news" })]);
  const notice = await asUser<{ action: string; member_name: string }>(w.db, w.alice, "select action, member_name from public.admin_household_notice($1)", [w.household]);
  assert.deepEqual(notice.map((r) => [r.action, r.member_name]), [["household.unlink", "Eve Evans"], ["household.link", "Eve Evans"]]);
  assert.ok(!JSON.stringify(notice).includes(w.quinn));
  assert.deepEqual(await asUser(w.db, w.jane, "select * from public.admin_household_notice($1)", [w.household]), []);
});

/* ------------------------------------------------------------------ */
/* Guards: break one rule, watch the check above fail                  */
/* ------------------------------------------------------------------ */

test("guard: dropping the is_admin() line from one function is caught by the refusal check", async () => {
  const marker = "create function public.admin_update_household(";
  const w = await world((sql) => {
    const start = sql.indexOf(marker);
    const guard = "  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;\n";
    const at = sql.indexOf(guard, start);
    return sql.slice(0, at) + sql.slice(at + guard.length);
  });
  const problems = await refusalProblems(w);
  assert.deepEqual(problems.map((p) => p.split(" for ")[0]), ["admin_update_household", "admin_update_household"]);
});

test("guard: is_admin() without the aal2 check is caught (the admin at aal1 gets through)", async () => {
  const w = await world((sql) => sql.replace("select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' and public.is_admin_any_aal()", "select public.is_admin_any_aal()"));
  assert.ok((await readProblems(w)).some((p) => p.includes("at aal1")));
  assert.ok((await refusalProblems(w)).some((p) => p.includes("the admin at aal1")));
});

test("guard: Admins read without the console header is caught (the admin's ordinary queries would read everyone)", async () => {
  const w = await world((sql) => sql.replace("select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-quad-console', '') = '1'\n     and public.is_admin()", "select public.is_admin()"));
  assert.ok((await readProblems(w)).some((p) => p.includes("without the console header")));
});

test("guard: the last-admin rule holds on its own, and without it (and the self rule) the only admin is revoked", async () => {
  const noSelf = (sql: string) => sql.replace("raise exception 'cannot_revoke_self' using errcode = '42501';", "null;");
  const w = await world(noSelf);
  assert.equal(await lastAdminProblem(w, w.quinn), null);
  assert.match(await errorOf(asAdmin(w, "select public.admin_revoke($1)", [w.quinn])), /last_admin/);
  const broken = await world((sql) => noSelf(sql).replace("raise exception 'last_admin' using errcode = '23514';", "null;"));
  assert.notEqual(await lastAdminProblem(broken, broken.quinn), null);
});

test("guard: admin_link without the move duplicates a managed student across households (the main test's count catches it; the trigger catches a person)", async () => {
  const w = await world((sql) => sql.replace(
    "  delete from public.household_members m\n  where m.household_id = any(v_from)",
    "  delete from public.household_members m\n  where false and m.household_id = any(v_from)",
  ));
  await asAdmin(w, "select public.admin_link($1, $2)", [w.household, w.joe]);
  assert.equal(await count(w.db, "select count(*)::int as n from public.household_members where student_id = $1", [w.joe]), 2);
  await asAdmin(w, "select public.admin_revoke_invitation($1)", [w.gran.id]);
  assert.match(await errorOf(asAdmin(w, "select public.admin_link($1, null, $2)", [w.household, w.jane])), /already_in_household/);
});

test("the 'Quad support' label in SQL matches SUPPORT_VIEWER_NAME", async () => {
  const { SUPPORT_VIEWER_NAME } = await import("../lib/admin/constants.ts");
  assert.ok(ADMIN_SQL.includes(`then '${SUPPORT_VIEWER_NAME}'`));
});
