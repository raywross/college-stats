/**
 * The set-based read policies and the counselor bundles (supabase/migrations/20261108120000_fast_policies.sql) against
 * real Postgres (PGlite + the auth stub). One world is seeded on the database as it was before the migration, then
 * cloned and migrated, so both copies hold the same rows with the same ids; for every person and every table the
 * migration touches, the readable rows are identical before and after. Then: visible_student_ids() is exactly where
 * can_read_student() is true, household_user_ids() exactly where can_read_list_owner()'s user rule is; viewer_bundle()
 * equals the per-table reads and the old bundle without `student_profiles`; org_caseload_bundle() and
 * org_student_bundle() equal the table reads the pages make, and row-level security decides what they return (an
 * outsider, an ended grant, a deleted organization, and another organization see nothing); the visit-events index
 * exists and serves visit_event_count()'s query. `npm test`.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const MIGRATION = "20261108120000_fast_policies.sql";
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BEFORE = ALL.filter((f) => f < MIGRATION);
const SQL = readFileSync(join(DIR, MIGRATION), "utf8");

/** Every table whose read policy the migration rewrites, with the columns that identify a row. */
const TABLES: Record<string, string> = {
  students: "id",
  student_profiles: "student_id",
  essays: "id",
  lists: "id",
  list_items: "id",
  plan_tasks: "id",
  application_snapshots: "id",
  plan_visits: "id",
  plan_offers: "id",
  plan_letters: "id",
  plan_interest_acts: "id",
  essay_versions: "id",
  essay_links: "essay_id, prompt_ref",
  essay_comments: "id",
  essay_reviews: "id",
  essay_suggestions: "id",
  essay_notes: "id",
  sms_consents: "id",
};

type Opts = { console?: boolean };

/** One statement as `who` (authenticated, aal2), optionally from the admin console (the x-quad-console header). */
async function as<T = Record<string, unknown>>(db: AuthDb, who: string | null, sql: string, params: unknown[] = [], { console = false }: Opts = {}): Promise<T[]> {
  return db.transaction(async (tx) => {
    const role = who ? "authenticated" : "anon";
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who ? { sub: who, role, aal: "aal2" } : { role })]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify(console ? { "x-quad-console": "1" } : {})]);
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql, params)).rows;
  });
}
async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}
const val = async <T,>(db: AuthDb, who: string | null, expr: string, params: unknown[] = [], opts: Opts = {}) => (await one(as<{ v: T }>(db, who, `select ${expr} as v`, params, opts))).v;
const rowsAs = (db: AuthDb, who: string, sql: string, params: unknown[] = []) => val<unknown[]>(db, who, `coalesce((select jsonb_agg(to_jsonb(t)) from (${sql}) t), '[]'::jsonb)`, params);

async function boot(files: string[]): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of files) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

/**
 * The world. The Smiths (Mom edits, Dad views only, Alice has an account, Ben is managed by Mom, Dan was managed by
 * Mom and is deleted, Pat was invited and never accepted); Gran, a guardian of Alice in a deleted household; Uncle, from
 * before the one-household rule, a guardian in his own household (the earlier, with Aunt and Cara) and in the
 * Smiths'; Eve outside with her own student record; Rivera, a counselor with a live grant to Alice; Olga, whose
 * grant from Alice ended; Del, in a deleted organization with a live grant to Alice; Otto, in another organization
 * with a grant to Eve; Quinn, an admin. Rows are written as the superuser with triggers off, so every table gets a
 * row for every case without going through each feature's functions.
 */
async function seed(db: AuthDb) {
  const u = async (name: string, roleHint = "guardian") => createUser(db, { email: `${name}@example.com`, birthYear: 1980, roleHint, displayName: name });
  const [mom, dad, alice, eve, rivera, olga, del, otto, gran, uncle, aunt, pat, quinn] = await Promise.all(
    ["mom", "dad", "alice", "eve", "rivera", "olga", "del", "otto", "gran", "uncle", "aunt", "pat", "quinn"].map((n) => u(n, n === "alice" || n === "eve" ? "student" : "guardian")),
  );
  const id = () => randomUUID();
  const S = { alice: id(), ben: id(), dan: id(), eve: id(), cara: id() };
  const H = { smiths: id(), gran: id(), uncle: id(), eve: id() };
  const O = { rivera: id(), olga: id(), del: id(), otto: id() };
  const L = { alice: id(), aliceIdeas: id(), ben: id(), dan: id(), eve: id(), cara: id(), mom: id(), dad: id(), uncle: id(), aunt: id(), gran: id() };
  const I = { alice1: id(), alice2: id(), ben1: id(), dan1: id(), eve1: id(), cara1: id(), mom1: id(), uncle1: id() };
  const E = { alice: id(), ben: id(), dan: id(), eve: id() };
  const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

  await db.exec("set session_replication_role = replica");
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  // Students.
  for (const [sid, user, managed, deleted, name] of [
    [S.alice, alice, null, null, "Alice"],
    [S.ben, null, mom, null, "Ben"],
    [S.dan, null, mom, ago(1), "Dan"],
    [S.eve, eve, null, null, "Eve"],
    [S.cara, null, uncle, null, "Cara"],
  ] as const) {
    await q("insert into public.students (id, user_id, managed_by, deleted_at, display_name, grad_year) values ($1, $2, $3, $4, $5, 2027)", [sid, user, managed, deleted, name]);
  }
  // Households and members.
  await q("insert into public.households (id, name, created_by, created, deleted_at) values ($1, 'Smiths', $2, $3, null), ($4, 'Gran', $5, $3, $6), ($7, 'Uncle', $8, $9, null), ($10, 'Eve', $11, $3, null)", [
    H.smiths, mom, ago(30), H.gran, gran, ago(2), H.uncle, uncle, ago(60), H.eve, eve,
  ]);
  const member = (h: string, role: "guardian" | "student", who: { user?: string; student?: string }, opts: { status?: string; canEdit?: boolean; at?: string } = {}) =>
    q("insert into public.household_members (household_id, user_id, student_id, role, status, can_edit, created, accepted_at) values ($1, $2, $3, $4, $5, $6, $7, $7)", [
      h, who.user ?? null, who.student ?? null, role, opts.status ?? "active", opts.canEdit ?? false, opts.at ?? ago(20),
    ]);
  await member(H.smiths, "guardian", { user: mom }, { canEdit: true });
  await member(H.smiths, "guardian", { user: dad });
  await member(H.smiths, "guardian", { user: uncle }, { at: ago(10) });
  await member(H.smiths, "guardian", { user: pat }, { status: "invited" });
  await member(H.smiths, "student", { student: S.alice });
  await member(H.smiths, "student", { student: S.ben });
  await member(H.smiths, "student", { student: S.dan });
  await member(H.gran, "guardian", { user: gran });
  await member(H.gran, "student", { student: S.alice });
  await member(H.uncle, "guardian", { user: uncle }, { at: ago(50) });
  await member(H.uncle, "guardian", { user: aunt }, { at: ago(50) });
  await member(H.uncle, "student", { student: S.cara }, { at: ago(50) });
  await member(H.eve, "student", { student: S.eve });
  // Organizations: Rivera's (live grant to Alice), Olga's (Alice's grant ended), Del's (deleted, a live grant to
  // Alice), Otto's (a grant to Eve).
  for (const [oid, owner, code, deleted] of [
    [O.rivera, rivera, "RIVERA", null],
    [O.olga, olga, "OLGAA", null],
    [O.del, del, "DELLL", ago(1)],
    [O.otto, otto, "OTTOO", null],
  ] as const) {
    await q("insert into public.organizations (id, name, kind, join_code, created_by, deleted_at) values ($1, $2, 'iec', $3, $4, $5)", [oid, `${code} Advising`, code, owner, deleted]);
    await q("insert into public.org_members (org_id, user_id, role) values ($1, $2, 'owner')", [oid, owner]);
  }
  await q("insert into public.org_students (org_id, student_id, source, can_edit, granted_by, granted_at, ended_at) values ($1, $2, 'code', true, $3, $4, null), ($5, $2, 'code', false, $3, $4, $6), ($7, $2, 'code', false, $3, $4, null), ($8, $9, 'code', false, $10, $4, null)", [
    O.rivera, S.alice, alice, ago(5), O.olga, ago(3), O.del, O.otto, S.eve, eve,
  ]);
  await q("insert into public.org_notes (org_id, student_id, author_id, body, created) values ($1, $2, $3, 'Met Tuesday', $4), ($1, $2, $3, 'Called', $5), ($6, $2, $7, 'Old note', $4)", [O.rivera, S.alice, rivera, ago(4), ago(2), O.olga, olga]);
  await q("insert into public.org_requests (org_id, student_id, kind, section, created_by, created) values ($1, $2, 'record_section', 'test', $3, $4), ($1, $2, 'list', null, $3, $5)", [O.rivera, S.alice, rivera, ago(4), ago(1)]);
  // Profiles.
  for (const [sid, data] of [[S.alice, { basics: { gradYear: 2027 } }], [S.ben, { basics: { gradYear: 2029 } }], [S.dan, {}], [S.eve, { tests: { satTotal: 1400 } }], [S.cara, {}]] as const) {
    await q("insert into public.student_profiles (student_id, data) values ($1, $2)", [sid, JSON.stringify(data)]);
  }
  // Lists: every student's default, Alice's second, and user-keyed lists for Mom, Dad, Uncle, Aunt, Gran.
  for (const [lid, sid, uid, def, name] of [
    [L.alice, S.alice, null, true, "My list"],
    [L.aliceIdeas, S.alice, null, false, "Ideas"],
    [L.ben, S.ben, null, true, "My list"],
    [L.dan, S.dan, null, true, "My list"],
    [L.eve, S.eve, null, true, "My list"],
    [L.cara, S.cara, null, true, "My list"],
    [L.mom, null, mom, true, "Mom's"],
    [L.dad, null, dad, true, "Dad's"],
    [L.uncle, null, uncle, true, "Uncle's"],
    [L.aunt, null, aunt, true, "Aunt's"],
    [L.gran, null, gran, true, "Gran's"],
  ] as const) {
    await q("insert into public.lists (id, student_id, user_id, is_default, name) values ($1, $2, $3, $4, $5)", [lid, sid, uid, def, name]);
  }
  for (const [iid, lid, unit, pos] of [
    [I.alice1, L.alice, "170976", 0],
    [I.alice2, L.alice, "204796", 1],
    [I.ben1, L.ben, "243744", 0],
    [I.dan1, L.dan, "166027", 0],
    [I.eve1, L.eve, "243780", 0],
    [I.cara1, L.cara, "110635", 0],
    [I.mom1, L.mom, "130794", 0],
    [I.uncle1, L.uncle, "186131", 0],
  ] as const) {
    await q("insert into public.list_items (id, list_id, unit_id, position, category, status) values ($1, $2, $3, $4, 'reach', 'applying')", [iid, lid, unit, pos]);
  }
  for (const [lid, iid, due, pos] of [
    [L.alice, I.alice1, "2026-11-01", 1],
    [L.alice, I.alice2, null, 0],
    [L.alice, null, "2026-10-15", 2],
    [L.ben, I.ben1, "2026-12-01", 0],
    [L.dan, I.dan1, null, 0],
    [L.eve, I.eve1, "2026-12-15", 0],
    [L.mom, I.mom1, null, 0],
    [L.uncle, I.uncle1, null, 0],
    [L.cara, I.cara1, null, 0],
  ] as const) {
    await q("insert into public.plan_tasks (list_id, item_id, kind, title, due_on, position, source) values ($1, $2, 'own', 'Step', $3, $4, 'own')", [lid, iid, due, pos]);
  }
  for (const iid of [I.alice1, I.alice2, I.ben1, I.dan1, I.eve1, I.cara1, I.mom1]) {
    await q("insert into public.plan_visits (item_id, kind, on_date) values ($1, 'campus_tour', '2026-10-20')", [iid]);
    await q("insert into public.plan_offers (item_id, award_year) values ($1, 2027)", [iid]);
    await q("insert into public.plan_letters (item_id, kind, storage_path, uploaded_by) values ($1, 'admission', $2, $3)", [iid, `letters/${iid}.pdf`, mom]);
  }
  await q("insert into public.plan_visits (item_id, kind, on_date) values ($1, 'info_session', '2026-09-01')", [I.alice1]);
  for (const [iid, lid, sid] of [[I.alice1, L.alice, S.alice], [I.dan1, L.dan, S.dan], [I.eve1, L.eve, S.eve]] as const) {
    await q("insert into public.application_snapshots (item_id, list_id, student_id, unit_id, season, applied_on) values ($1, $2, $3, '170976', 2026, '2026-10-01')", [iid, lid, sid]);
  }
  for (const [iid, who] of [[I.alice1, alice], [I.alice2, mom], [I.eve1, eve], [null, eve], [null, dad], [I.mom1, mom], [I.dan1, mom]] as const) {
    await q("insert into public.plan_interest_acts (item_id, user_id, act, url) values ($1, $2, 'tour', 'https://example.edu/visit')", [iid, who]);
  }
  for (const [uid, sid] of [[mom, null], [eve, null], [null, S.alice], [null, S.ben], [null, S.dan], [null, S.eve], [rivera, null]] as const) {
    await q("insert into public.sms_consents (user_id, student_id, phone, consented_by) values ($1, $2, '+15555550100', $3)", [uid, sid, uid ?? mom]);
  }
  // Essays with everything that hangs off them.
  for (const [eid, sid] of [[E.alice, S.alice], [E.ben, S.ben], [E.dan, S.dan], [E.eve, S.eve]] as const) {
    await q("insert into public.essays (id, student_id, title, body) values ($1, $2, 'Main', 'A draft.')", [eid, sid]);
    const v = (await q("insert into public.essay_versions (essay_id, body, source) values ($1, 'A draft.', 'typed') returning id", [eid])).rows[0] as { id: string };
    await q("insert into public.essay_links (essay_id, prompt_ref) values ($1, 'platform:common_app:main')", [eid]);
    await q("insert into public.essay_comments (essay_id, version_id, author_id, author_role, body) values ($1, $2, $3, 'guardian', 'Nice')", [eid, v.id, mom]);
    const r = (await q("insert into public.essay_reviews (essay_id, version_id, method, model) values ($1, $2, 'rubric', 'model') returning id", [eid, v.id])).rows[0] as { id: string };
    await q("insert into public.essay_notes (review_id, position, category, observation, why, ask) values ($1, 0, 'voice', 'o', 'w', 'a')", [r.id]);
    await q("insert into public.essay_suggestions (essay_id, base_version_id, author_id, author_role, proposed_body) values ($1, $2, $3, 'guardian', 'Better.')", [eid, v.id, mom]);
  }
  await q("insert into public.admins (user_id, note) values ($1, 'owner')", [quinn]);
  await q("insert into public.app_settings (key, value) values ('planner.today', '\"2026-11-02\"'::jsonb)");
  await db.exec("set session_replication_role = origin");
  return { mom, dad, alice, eve, rivera, olga, del, otto, gran, uncle, aunt, pat, quinn, S, H, O, L, I, E };
}

type Seed = Awaited<ReturnType<typeof seed>>;

let worlds: Promise<{ before: AuthDb; after: AuthDb; w: Seed }> | null = null;
function both() {
  worlds ??= (async () => {
    const before = await boot(BEFORE);
    const w = await seed(before);
    const migrated = (await before.clone()) as AuthDb;
    await migrated.exec(SQL);
    return { before, after: migrated, w };
  })();
  return worlds;
}
after(async () => {
  if (!worlds) return;
  const { before, after: a } = await worlds;
  await before.close();
  await a.close();
});

const people = (w: Seed) => ({
  mom: w.mom, dad: w.dad, alice: w.alice, eve: w.eve, rivera: w.rivera, olga: w.olga, del: w.del, otto: w.otto,
  gran: w.gran, uncle: w.uncle, aunt: w.aunt, pat: w.pat, quinn: w.quinn,
});

/** What `who` reads of `table`: the identifying columns, sorted; or the error, when the read is refused. */
async function readable(db: AuthDb, who: string, table: string, opts: Opts = {}): Promise<string[] | string> {
  const cols = TABLES[table];
  try {
    const rows = await as<Record<string, unknown>>(db, who, `select ${cols} from public.${table}`, [], opts);
    return rows.map((r) => JSON.stringify(r)).sort();
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

/* ------------------------------------------------------------------ */
/* The policies: the same rows before and after                        */
/* ------------------------------------------------------------------ */

test("every person reads the same rows of every rewritten table before and after the migration", async () => {
  const { before, after: a, w } = await both();
  let compared = 0;
  let rows = 0;
  for (const [name, who] of Object.entries(people(w))) {
    for (const table of Object.keys(TABLES)) {
      const was = await readable(before, who, table);
      const is = await readable(a, who, table);
      assert.deepEqual(is, was, `${name} reading ${table}`);
      assert.equal(typeof was, "object", `${name} reading ${table}: ${was}`);
      compared++;
      rows += was.length;
    }
  }
  assert.equal(compared, 13 * Object.keys(TABLES).length);
  assert.ok(rows > 250, `the comparison saw ${rows} rows`);
});

test("an admin in the console reads the same rows before and after (the Admins read policies are kept)", async () => {
  const { before, after: a, w } = await both();
  for (const table of Object.keys(TABLES)) {
    assert.deepEqual(await readable(a, w.quinn, table, { console: true }), await readable(before, w.quinn, table, { console: true }), table);
  }
});

test("the world exercises each rule: who reads what, after the migration", async () => {
  const { after: a, w } = await both();
  const ids = async (who: string, sql: string) => (await as<{ id: string }>(a, who, sql)).map((r) => r.id).sort();
  const students = (who: string) => ids(who, "select id from public.students");
  assert.deepEqual(await students(w.mom), [w.S.alice, w.S.ben, w.S.dan].sort(), "Mom: her household's students, and Dan's deleted record she manages");
  assert.deepEqual(await students(w.dad), [w.S.alice, w.S.ben].sort(), "Dad: no deleted record");
  assert.deepEqual(await students(w.rivera), [w.S.alice], "Rivera: her grant");
  assert.deepEqual(await students(w.uncle), [w.S.alice, w.S.ben, w.S.cara].sort(), "Uncle: both households");
  for (const who of [w.olga, w.del, w.gran, w.pat]) assert.deepEqual(await students(who), [], "an ended grant, a deleted organization, a deleted household, an invitation");
  assert.deepEqual(await students(w.otto), [w.S.eve]);
  const userLists = async (who: string) => (await as<{ name: string }>(a, who, "select name from public.lists where user_id is not null")).map((r) => r.name).sort();
  assert.deepEqual(await userLists(w.mom), ["Dad's", "Mom's"], "Uncle's list follows his first household, not the Smiths");
  assert.deepEqual(await userLists(w.uncle), ["Aunt's", "Dad's", "Mom's", "Uncle's"], "Uncle reads both households' lists");
  assert.deepEqual(await userLists(w.aunt), ["Aunt's", "Uncle's"]);
  assert.deepEqual(await userLists(w.alice), ["Dad's", "Mom's"], "a student member reads the household's lists");
  assert.deepEqual(await userLists(w.gran), ["Gran's"], "a deleted household opens nothing");
  assert.deepEqual(await userLists(w.rivera), [], "a counselor never reads a guardian's own list");
  assert.deepEqual(await ids(w.rivera, "select id from public.essays"), [w.E.alice]);
  assert.equal((await ids(w.eve, "select id from public.plan_interest_acts where item_id is null")).length, 1, "Eve's item-less act, her own");
});

test("visible_student_ids() is exactly where can_read_student() is true, for every person", async () => {
  const { after: a, w } = await both();
  for (const [name, who] of Object.entries(people(w))) {
    const set = (await as<{ id: string }>(a, who, "select public.visible_student_ids() as id")).map((r) => r.id).sort();
    const truth = (await as<{ id: string }>(a, who, "select s.id from (select id from public.students union select $1::uuid) s where public.can_read_student(s.id)", [w.S.dan]))
      .map((r) => r.id)
      .sort();
    assert.deepEqual(set, truth, name);
  }
  await assert.rejects(as(a, null, "select public.visible_student_ids()"), /permission denied/);
  await assert.rejects(as(a, null, "select public.household_user_ids()"), /permission denied/);
});

test("household_user_ids() is exactly where is_household_member(household_of(u)) is true, for every person", async () => {
  const { after: a, w } = await both();
  for (const [name, who] of Object.entries(people(w))) {
    const set = (await as<{ id: string }>(a, who, "select public.household_user_ids() as id")).map((r) => r.id).sort();
    // household_of() is closed to signed-in users, so the truth is computed as the superuser with the same claims.
    const truth = await a.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated" })]);
      return (await tx.query<{ id: string }>("select u.id from auth.users u where public.is_household_member(public.household_of(u.id))")).rows.map((r) => r.id).sort();
    });
    assert.deepEqual(set, truth, name);
  }
});

test("no read policy calls a can_read_* function any more, and every auth.uid() in one is wrapped", async () => {
  const { after: a } = await both();
  const policies = (await a.query<{ t: string; n: string; q: string }>("select tablename t, policyname n, qual q from pg_policies where schemaname = 'public' and cmd = 'SELECT'")).rows;
  const rewritten = policies.filter((p) => p.t in TABLES && p.n !== "Admins read");
  assert.equal(rewritten.length, Object.keys(TABLES).length);
  for (const p of rewritten) {
    assert.doesNotMatch(p.q, /can_read_|is_guardian_of|is_counselor_of|is_household_member/, `${p.t}: ${p.n}`);
    assert.doesNotMatch(p.q.replaceAll(/SELECT auth\.uid\(\) AS uid/gi, ""), /auth\.uid\(\)/, `${p.t}: ${p.n} has a bare auth.uid()`);
  }
});

test("the migration re-runs cleanly (create or replace, drop policy if exists, if not exists)", async () => {
  const { after: a } = await both();
  const again = (await a.clone()) as AuthDb;
  await again.exec(SQL);
  await again.close();
});

/* ------------------------------------------------------------------ */
/* viewer_bundle()                                                     */
/* ------------------------------------------------------------------ */

const STUDENT_COLS = "id, user_id, display_name, grad_year, managed_by, created, deleted_at";
const byId = (rows: unknown[]) => [...(rows as { id: string }[])].sort((x, y) => x.id.localeCompare(y.id));

test("viewer_bundle() has no student_profiles, and is otherwise the old bundle and the per-table reads, for every person", async () => {
  const { before, after: a, w } = await both();
  for (const [name, who] of Object.entries(people(w))) {
    const now = await val<Record<string, unknown>>(a, who, "public.viewer_bundle()");
    const was = await val<Record<string, unknown>>(before, who, "public.viewer_bundle()");
    assert.ok(!("student_profiles" in now), `${name}: student_profiles is gone`);
    assert.ok("student_profiles" in was);
    delete was.student_profiles;
    assert.deepEqual(now, was, name);
    const students = await rowsAs(a, who, `select ${STUDENT_COLS} from public.students where deleted_at is null`);
    assert.deepEqual(byId(now.students as unknown[]), byId(students), `${name}: students`);
  }
  await assert.rejects(as(a, null, "select public.viewer_bundle()"), /permission denied/);
});

test("viewer_bundle() in the admin console: the admin's own students only, not every student", async () => {
  const { after: a, w } = await both();
  const b = await val<{ students: unknown[] }>(a, w.quinn, "public.viewer_bundle()", [], { console: true });
  assert.deepEqual(b.students, []);
  assert.ok((await as(a, w.quinn, "select id from public.students", [], { console: true })).length >= 5, "the table read still opens every student to the console");
});

/* ------------------------------------------------------------------ */
/* The counselor's bundles                                             */
/* ------------------------------------------------------------------ */

const ITEM_JSON = `jsonb_build_object('id', i.id, 'unit_id', i.unit_id, 'category', i.category, 'status', i.status, 'outcome', i.outcome, 'round', i.round,
  'position', i.position, 'enrolling', i.enrolling, 'visited_on', i.visited_on, 'dream', i.dream, 'added_at', i.added_at,
  'committed_on', i.committed_on, 'withdrawn_on', i.withdrawn_on, 'deadline_date', i.deadline_date, 'deadline_text', i.deadline_text`;
const TASK_JSON = `jsonb_build_object('id', t.id, 'item_id', t.item_id, 'kind', t.kind, 'title', t.title, 'due_on', t.due_on, 'window_start', t.window_start,
  'window_end', t.window_end, 'done_at', t.done_at, 'dismissed', t.dismissed, 'snoozed_until', t.snoozed_until,
  'orphaned', t.orphaned, 'source', t.source, 'created_at', t.created_at, 'position', t.position)`;

/** lib/orgs.ts's reads, table by table, as `who` (each embed read on its own, as PostgREST does under RLS). */
async function listByTables(db: AuthDb, who: string, listId: string, studentId: string) {
  const items = (await rowsAs(db, who, `select ${ITEM_JSON}) j, i.id from public.list_items i where i.list_id = $1 order by i.position, i.id`, [listId])) as { j: Record<string, unknown>; id: string }[];
  const withVisits = [];
  for (const i of items) {
    const visits = (await rowsAs(db, who, "select item_id, on_date, created_at, updated_at from public.plan_visits where item_id = $1 order by on_date, id", [i.id])) as unknown[];
    withVisits.push({ ...i.j, plan_visits: visits });
  }
  const tasks = ((await rowsAs(db, who, `select ${TASK_JSON} j from public.plan_tasks t where t.list_id = $1 order by t.due_on asc nulls last, t.position, t.id`, [listId])) as { j: unknown }[]).map((t) => t.j);
  return { id: listId, student_id: studentId, list_items: withVisits, plan_tasks: tasks };
}

async function caseloadByTables(db: AuthDb, who: string) {
  const org = await val<{ id: string } | null>(db, who, "public.my_organization()");
  if (!org) return null;
  const roster = (await rowsAs(db, who, "select * from public.org_roster($1)", [org.id])) as { status: string; student_id: string | null }[];
  const ids = roster.filter((r) => r.status === "active" && r.student_id).map((r) => r.student_id!);
  const today = await val<unknown>(db, who, "(select value from public.app_settings where key = 'planner.today')");
  const profiles = await rowsAs(db, who, "select student_id, data from public.student_profiles where student_id = any($1::uuid[]) order by student_id", [ids]);
  const listRows = (await rowsAs(db, who, "select id, student_id from public.lists where student_id = any($1::uuid[]) and is_default order by id", [ids])) as { id: string; student_id: string }[];
  const lists = [];
  for (const l of listRows) lists.push(await listByTables(db, who, l.id, l.student_id));
  const essays = await rowsAs(db, who, "select id, student_id, updated from public.essays where student_id = any($1::uuid[]) order by id", [ids]);
  return { org, roster, today, profiles, lists, essays };
}

async function studentByTables(db: AuthDb, who: string, studentId: string) {
  const org = await val<{ id: string } | null>(db, who, "public.my_organization()");
  if (!org) return null;
  const today = await val<unknown>(db, who, "(select value from public.app_settings where key = 'planner.today')");
  const entry = ((await rowsAs(db, who, "select * from public.org_roster($1) where status = 'active' and student_id = $2", [org.id, studentId])) as unknown[])[0] ?? null;
  if (!entry) return { org, today, entry: null, profile: null, list: null, essays: [], notes: [], asks: [] };
  const profile = ((await rowsAs(db, who, "select student_id, data from public.student_profiles where student_id = $1", [studentId])) as unknown[])[0] ?? null;
  const listRow = ((await rowsAs(db, who, "select id from public.lists where student_id = $1 and is_default order by id limit 1", [studentId])) as { id: string }[])[0];
  const list = listRow ? await listByTables(db, who, listRow.id, studentId) : null;
  const essays = await rowsAs(db, who, "select id, student_id, updated from public.essays where student_id = $1 order by id", [studentId]);
  const notes = await rowsAs(db, who, "select id, org_id, student_id, author_id, body, created, updated from public.org_notes where org_id = $1 and student_id = $2 order by created desc, id", [org.id, studentId]);
  const asks = await rowsAs(db, who, "select id, org_id, student_id, kind, section, note, created_by, created, done_at, seen_at from public.org_requests where org_id = $1 and student_id = $2 order by created desc, id", [org.id, studentId]);
  return { org, today, entry, profile, list, essays, notes, asks };
}

test("org_caseload_bundle() equals the caseload's table reads, for every person", async () => {
  const { after: a, w } = await both();
  for (const [name, who] of Object.entries(people(w))) {
    assert.deepEqual(await val(a, who, "public.org_caseload_bundle()"), await caseloadByTables(a, who), name);
  }
  const b = await val<{ roster: { student_id: string }[]; profiles: unknown[]; lists: { id: string; list_items: { plan_visits: unknown[] }[]; plan_tasks: { due_on: string | null }[] }[]; essays: unknown[]; today: unknown }>(a, w.rivera, "public.org_caseload_bundle()");
  assert.deepEqual(b.roster.map((r) => r.student_id), [w.S.alice]);
  assert.equal(b.today, "2026-11-02");
  assert.equal(b.profiles.length, 1);
  assert.deepEqual(b.lists.map((l) => l.id), [w.L.alice], "the default list only");
  assert.equal(b.lists[0].list_items.length, 2);
  assert.equal(b.lists[0].list_items[0].plan_visits.length, 2);
  assert.deepEqual(b.lists[0].plan_tasks.map((t) => t.due_on), ["2026-10-15", "2026-11-01", null], "dated by due date, undated last");
  assert.equal(b.essays.length, 1);
  await assert.rejects(as(a, null, "select public.org_caseload_bundle()"), /permission denied/);
});

test("org_caseload_bundle(): null without an organization; nothing of a student whose grant ended or whose organization is deleted", async () => {
  const { after: a, w } = await both();
  for (const who of [w.mom, w.alice, w.eve, w.gran, w.del]) assert.equal(await val(a, who, "public.org_caseload_bundle()"), null);
  const olga = await val<Record<string, unknown[]>>(a, w.olga, "public.org_caseload_bundle()");
  assert.deepEqual([olga.roster, olga.profiles, olga.lists, olga.essays], [[], [], [], []]);
  const otto = JSON.stringify(await val(a, w.otto, "public.org_caseload_bundle()"));
  for (const id of [w.S.alice, w.S.ben, w.L.alice, w.E.alice]) assert.ok(!otto.includes(id), `another organization's bundle mentions ${id}`);
});

test("org_student_bundle() equals the student page's table reads, for every person and student", async () => {
  const { after: a, w } = await both();
  for (const [name, who] of Object.entries(people(w))) {
    for (const sid of [w.S.alice, w.S.ben, w.S.eve, w.S.dan]) {
      assert.deepEqual(await val(a, who, "public.org_student_bundle($1)", [sid]), await studentByTables(a, who, sid), `${name} on ${sid}`);
    }
  }
  const b = await val<{ entry: { student_id: string }; notes: { body: string }[]; asks: { kind: string }[]; list: { id: string } }>(a, w.rivera, "public.org_student_bundle($1)", [w.S.alice]);
  assert.equal(b.entry.student_id, w.S.alice);
  assert.deepEqual(b.notes.map((n) => n.body), ["Called", "Met Tuesday"], "newest first, the office's own only");
  assert.deepEqual(b.asks.map((x) => x.kind), ["list", "record_section"]);
  assert.equal(b.list.id, w.L.alice);
  await assert.rejects(as(a, null, "select public.org_student_bundle($1)", [w.S.alice]), /permission denied/);
});

test("org_student_bundle(): entry null for a student not on the caseload; null without an organization", async () => {
  const { after: a, w } = await both();
  const empty = (b: unknown) => assert.deepEqual(
    { ...(b as Record<string, unknown>), org: undefined, today: undefined },
    { org: undefined, today: undefined, entry: null, profile: null, list: null, essays: [], notes: [], asks: [] },
  );
  empty(await val(a, w.rivera, "public.org_student_bundle($1)", [w.S.eve]));
  empty(await val(a, w.olga, "public.org_student_bundle($1)", [w.S.alice]));
  empty(await val(a, w.otto, "public.org_student_bundle($1)", [w.S.alice]));
  for (const who of [w.mom, w.alice, w.del]) assert.equal(await val(a, who, "public.org_student_bundle($1)", [w.S.alice]), null);
});

test("the bundles are security invoker, closed to anon; the set functions are security definer", async () => {
  const { after: a } = await both();
  const rows = (await a.query<{ name: string; definer: boolean; anon: boolean; auth: boolean }>(
    `select p.proname as name, p.prosecdef as definer, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('viewer_bundle', 'org_caseload_bundle', 'org_student_bundle', 'org_list_json', 'visible_student_ids', 'household_user_ids')
     order by 1`,
  )).rows;
  assert.deepEqual(rows, [
    { name: "household_user_ids", definer: true, anon: false, auth: true },
    { name: "org_caseload_bundle", definer: false, anon: false, auth: true },
    { name: "org_list_json", definer: false, anon: false, auth: true },
    { name: "org_student_bundle", definer: false, anon: false, auth: true },
    { name: "viewer_bundle", definer: false, anon: false, auth: true },
    { name: "visible_student_ids", definer: true, anon: false, auth: true },
  ]);
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

test("guard: a definer org_caseload_bundle() would show an ended grant's student, and the comparison catches it", async () => {
  const { after: a, w } = await both();
  const db = (await a.clone()) as AuthDb;
  // A broken bundle: definer, and reading every live student instead of the roster's.
  const broken = SQL.slice(SQL.indexOf("create or replace function public.org_caseload_bundle()"), SQL.indexOf("-- One student's page in one call"))
    .replace("security invoker", "security definer")
    .replace("where sp.student_id = any(v_ids)", "where true");
  await db.exec(broken);
  assert.notDeepEqual(await val(db, w.olga, "public.org_caseload_bundle()"), await caseloadByTables(db, w.olga));
  await db.close();
});

test("guard: a visible_student_ids() that forgets deleted records changes what Mom reads, and the comparison catches it", async () => {
  const { before, after: a, w } = await both();
  const db = (await a.clone()) as AuthDb;
  const fn = SQL.slice(SQL.indexOf("create or replace function public.visible_student_ids()"), SQL.indexOf("-- The users whose own (user-keyed) lists"));
  await db.exec(fn.replace("where s.deleted_at is null\n    and (s.user_id", "where (s.user_id"));
  assert.notDeepEqual(await readable(db, w.mom, "student_profiles"), await readable(before, w.mom, "student_profiles"));
  await db.close();
});

test("guard: household_user_ids() without the household_of() rule opens Uncle's list to the Smiths", async () => {
  const { before, after: a, w } = await both();
  const db = (await a.clone()) as AuthDb;
  const fn = SQL.slice(SQL.indexOf("create or replace function public.household_user_ids()"), SQL.indexOf("revoke execute on function public.visible_student_ids()"));
  await db.exec(fn.replace("where public.household_of(c.u) in (select household_id from mine)", ""));
  assert.notDeepEqual(await readable(db, w.mom, "lists"), await readable(before, w.mom, "lists"));
  await db.close();
});

/* ------------------------------------------------------------------ */
/* Visit events                                                        */
/* ------------------------------------------------------------------ */

test("visit_events_count_idx exists and serves visit_event_count()'s query", async () => {
  const { after: a } = await both();
  const def = (await a.query<{ d: string }>("select indexdef d from pg_indexes where indexname = 'visit_events_count_idx'")).rows[0]?.d;
  assert.match(def ?? "", /ON public\.visit_events USING btree \(unit_id, starts_at\) INCLUDE \(kind\) WHERE \(removed_at IS NULL\)/);
  const plan = await a.transaction(async (tx) => {
    await tx.exec("set local enable_seqscan = off");
    const r = await tx.query<{ "QUERY PLAN": string }>(
      "explain select count(*) from public.visit_events where unit_id = '170976' and removed_at is null and kind <> 'staff' and starts_at >= now() - interval '1 day'",
    );
    return r.rows.map((x) => x["QUERY PLAN"]).join("\n");
  });
  assert.match(plan, /visit_events_count_idx/);
  assert.equal(await val(a, null, "public.visit_event_count('170976')"), 0);
});

/* ------------------------------------------------------------------ */
/* The app side                                                        */
/* ------------------------------------------------------------------ */

test("the profile store reads the table when the bundle has no student_profiles; the types say so", () => {
  const root = join(import.meta.dirname, "..");
  const store = readFileSync(join(root, "lib", "student-profile-store.ts"), "utf8");
  assert.match(store, /if \(bundle\?\.student_profiles\) return new Map\(bundle\.student_profiles\.map/);
  assert.match(store, /supabase\.from\("student_profiles"\)\.select\("student_id, data"\)/, "the table read stays as the fallback");
  const types = readFileSync(join(root, "lib", "bundle-read.ts"), "utf8");
  assert.match(types, /student_profiles\?: \{ student_id: string; data: unknown \}\[\];/);
  assert.match(types, /"org_caseload_bundle" \| "org_student_bundle"/);
  for (const name of ["OrgCaseloadBundle", "OrgStudentBundle"]) assert.match(types, new RegExp(`export interface ${name} \\{`));
});
