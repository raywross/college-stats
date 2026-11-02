/**
 * The counselor portal's model (supabase/migrations/20261102120000_organizations.sql; specs/product/counselor-portal.md
 * "Model", "How a student joins", "Rules", "Files") against real Postgres (PGlite + the auth stub, every migration in
 * order up to this one). A counselor reads a granted student's record, list, plan, and essays through the same
 * policies a guardian does; never a guardian's finances, the household, private list notes, a nudge's text, or another
 * organization's students; an ended grant stops at once; view-only blocks writes; a code joins; an invitation lives and
 * dies; the access log records the read and names the counselor. The "guard:" tests break one rule each and show the
 * check that protects it fails. `npm test`.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, affectedAsUser, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const MIGRATION = "20261102120000_organizations.sql";
const CHAIN = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f <= MIGRATION).sort();

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}
const rpc = async <T,>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;
const n = async (db: AuthDb, who: string, sql: string, params: unknown[] = []) => (await asUser(db, who, sql, params)).length;

/**
 * The Smiths: Mom (created the household), Dad (edits), Alice (her own account), Ben (managed by Mom). Rivera Advising:
 * Ms. Rivera (owner) and Mr. Lee (counselor, joined by invitation); Alice joined by invitation, Ben by code (Mom for
 * him). Northside High: Mr. Zane (owner); Bob joined by code. Eve is nobody's.
 */
async function build() {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of CHAIN) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");

  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Sam Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const bob = await createUser(db, { email: "bob@example.com", birthYear: 2009, roleHint: "student", displayName: "Bob Jones" });
  const rivera = await createUser(db, { email: "rivera@advising.test", birthYear: 1975, roleHint: "counselor", displayName: "Ms. Rivera" });
  const lee = await createUser(db, { email: "lee@advising.test", birthYear: 1985, roleHint: "counselor", displayName: "Mr. Lee" });
  const zane = await createUser(db, { email: "zane@northside.test", birthYear: 1980, roleHint: "counselor", displayName: "Mr. Zane" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve Evans" });
  const quinn = await createUser(db, { email: "quinn@quad.test", birthYear: 1985, roleHint: "guardian", displayName: "Quinn Admin" });
  await db.query("insert into public.admins (user_id, note) values ($1, 'owner')", [quinn]);

  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  const inviteAlice = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, 'alice@example.com', 'student', null, false, null, null, null)", [household]);
  await rpc(db, alice, "public.accept_invitation($1)", [inviteAlice.token]);
  const aliceS = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const inviteDad = await rpc<{ token: string }>(db, alice, "public.create_invitation($1, 'dad@example.com', 'guardian', null, true, null, null, null)", [household]);
  await rpc(db, dad, "public.accept_invitation($1)", [inviteDad.token]);
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2030)", [household]);
  await asUser(db, mom, "insert into public.household_homes (household_id, lat, lng, label, place) values ($1, 40, -86, '1 Main St, West Lafayette, IN', 'West Lafayette, IN')", [household]);
  const bobS = (await one(asUser<{ id: string }>(db, bob, "insert into public.students (user_id, display_name) values ($1, 'Bob Jones') returning id", [bob]))).id;

  // Alice's things: a list with an item, a private and a shared note, her record, a task Mom nudged with a note, an
  // offer, a visit, and an essay with a version.
  const list = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [aliceS]))).id;
  const item = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position) values ($1, '243780', 0) returning id", [list]))).id;
  await asUser(db, alice, "insert into public.list_notes (item_id, body, private) values ($1, 'secret: my dream school', true)", [item]);
  await asUser(db, alice, "insert into public.list_notes (item_id, body, private) values ($1, 'great engineering', false)", [item]);
  await asUser(db, alice, "insert into public.student_profiles (student_id, data) values ($1, $2)", [aliceS, JSON.stringify({ basics: { gradYear: 2027 } })]);
  const task = (await db.query<{ id: string }>("insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', 'Write essay', 'own') returning id", [list])).rows[0].id;
  await db.query("insert into public.plan_nudges (task_id, from_user, to_student, note, channel) values ($1, $2, $3, 'please do this before dinner', 'app')", [task, mom, aliceS]);
  await db.query("insert into public.plan_offers (item_id, award_year) values ($1, 2027)", [item]);
  await db.query("insert into public.plan_visits (item_id, kind, on_date) values ($1, 'campus_tour', current_date)", [item]);
  const momList = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (user_id, name, is_default) values ($1, 'Mom''s list', true) returning id", [mom]))).id;
  const essay = (await one(asUser<{ id: string }>(db, alice, "insert into public.essays (student_id, prompt_ref, title, body, count) values ($1, 'platform:common_app:main', 'Main', 'My first draft.', 3) returning id", [aliceS]))).id;
  const version = (await one(asUser<{ id: string }>(db, alice, "insert into public.essay_versions (essay_id, body, count, source) values ($1, 'My first draft.', 3, 'typed') returning id", [essay]))).id;

  // A stand-in for the household finances table accounts.md plans (not built yet): owned by the guardian's user, with
  // the owner-only policy the spec requires. No student grant can reach it.
  await db.exec(`
    create table public.household_finances (user_id uuid primary key references auth.users (id), agi integer);
    alter table public.household_finances enable row level security;
    create policy "Finances: owner only" on public.household_finances for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
    grant select, insert, update on public.household_finances to authenticated;`);
  await asUser(db, mom, "insert into public.household_finances (user_id, agi) values ($1, 120000)", [mom]);

  // Rivera Advising, Mr. Lee by invitation, Alice by invitation, Ben by code (Mom for him).
  const org = await rpc<string>(db, rivera, "public.create_organization('Rivera Advising', 'iec', null, 'https://rivera.test')");
  const code = (await db.query<{ join_code: string }>("select join_code from public.organizations where id = $1", [org])).rows[0].join_code;
  const leeInv = await rpc<{ token: string }>(db, rivera, "public.org_invite($1, 'counselor', 'lee@advising.test', 'Mr. Lee', null)", [org]);
  const leeMember = await rpc<string>(db, lee, "public.accept_org_invitation($1)", [leeInv.token]);
  const aliceInv = await rpc<{ token: string }>(db, rivera, "public.org_invite($1, 'student', 'alice@example.com', 'Alice', 2027)", [org]);
  const aliceGrant = await rpc<string>(db, alice, "public.accept_org_invitation($1)", [aliceInv.token]);
  const benGrant = await rpc<string>(db, mom, "public.join_organization($1, $2)", [`quad-${code.toLowerCase()}`, ben]);

  const north = await rpc<string>(db, zane, "public.create_organization('Northside High', 'school', '180000000001', null)");
  const northCode = (await db.query<{ join_code: string }>("select join_code from public.organizations where id = $1", [north])).rows[0].join_code;
  const bobGrant = await rpc<string>(db, bob, "public.join_organization($1)", [northCode]);

  return {
    db, mom, dad, alice, bob, rivera, lee, zane, eve, quinn, household, aliceS, ben, bobS, list, item, task, momList, essay, version,
    org, code, leeMember, aliceInvToken: aliceInv.token, aliceGrant, benGrant, north, northCode, bobGrant,
  };
}

type Base = Awaited<ReturnType<typeof build>>;
let base: Promise<Base> | null = null;
const opened: AuthDb[] = [];

/** A fresh copy of the world for one test (building it takes seconds; a clone about one). */
async function world(): Promise<Base> {
  base ??= build();
  const b = await base;
  const db = (await b.db.clone()) as typeof b.db;
  opened.push(db);
  return { ...b, db };
}

after(async () => {
  for (const db of opened) await db.close();
  if (base) await (await base).db.close();
});

/** As the admin in the console (aal2, the console header), as in tests/admin-policies.test.mts. */
async function asAdmin<T = Record<string, unknown>>(db: AuthDb, who: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated", aal: "aal2" })]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-quad-console": "1" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/* ------------------------------------------------------------------ */
/* The checks the guard tests rely on                                  */
/* ------------------------------------------------------------------ */

/** What a counselor with a live grant reads of the student: the record, list, plan, and essays. */
async function assertCounselorReads(w: Base, who: string) {
  const { db, aliceS, list, item, essay } = w;
  assert.equal(await n(db, who, "select 1 from public.students where id = $1", [aliceS]), 1, "students");
  assert.equal(await n(db, who, "select 1 from public.student_profiles where student_id = $1", [aliceS]), 1, "student_profiles");
  assert.equal(await n(db, who, "select 1 from public.lists where id = $1", [list]), 1, "lists");
  assert.equal(await n(db, who, "select 1 from public.list_items where list_id = $1", [list]), 1, "list_items");
  assert.equal(await n(db, who, "select 1 from public.plan_tasks where list_id = $1", [list]), 1, "plan_tasks");
  assert.equal(await n(db, who, "select 1 from public.plan_offers where item_id = $1", [item]), 1, "plan_offers");
  assert.equal(await n(db, who, "select 1 from public.plan_visits where item_id = $1", [item]), 1, "plan_visits");
  assert.equal(await n(db, who, "select 1 from public.essays where id = $1", [essay]), 1, "essays");
  assert.equal(await n(db, who, "select 1 from public.essay_versions where essay_id = $1", [essay]), 1, "essay_versions");
}

/** What a counselor never reads, whatever the grant: finances, the household, private notes, a nudge's text. */
async function assertCounselorNeverReads(w: Base, who: string) {
  const { db, household, momList, item, aliceS } = w;
  assert.equal(await n(db, who, "select 1 from public.household_finances"), 0, "finances leaked");
  assert.equal(await n(db, who, "select 1 from public.households where id = $1", [household]), 0, "household leaked");
  assert.equal(await n(db, who, "select 1 from public.household_members where household_id = $1", [household]), 0, "household members leaked");
  assert.equal(await n(db, who, "select 1 from public.household_homes"), 0, "home leaked");
  assert.equal(await n(db, who, "select 1 from public.household_roster($1)", [household]), 0, "roster leaked");
  assert.equal(await n(db, who, "select 1 from public.lists where id = $1", [momList]), 0, "a guardian's own list leaked");
  const notes = await asUser<{ body: string }>(db, who, "select body from public.list_notes where item_id = $1", [item]);
  assert.ok(!notes.some((r) => r.body.startsWith("secret")), "private note leaked");
  assert.equal(await n(db, who, "select 1 from public.plan_nudges"), 0, "nudge leaked");
  const bundle = await rpc<{ nudges: unknown[] }>(db, who, "public.plan_bundle($1, null)", [aliceS]);
  assert.equal(JSON.stringify(bundle).includes("before dinner"), false, "nudge text leaked through the plan bundle");
  assert.equal(await n(db, who, "select 1 from public.profiles where id <> $1", [who]), 0, "other profiles leaked");
}

/** Nothing of the student once the grant has ended (or for anyone without one). */
async function assertReadsNothing(w: Base, who: string) {
  const { db, aliceS, list, essay } = w;
  for (const [table, sql] of [
    ["students", "select 1 from public.students where id = $1"],
    ["student_profiles", "select 1 from public.student_profiles where student_id = $1"],
    ["lists", "select 1 from public.lists where student_id = $1"],
    ["essays", "select 1 from public.essays where student_id = $1"],
  ] as const) {
    assert.equal(await n(db, who, sql, [aliceS]), 0, `${table} still readable`);
  }
  assert.equal(await n(db, who, "select 1 from public.list_items where list_id = $1", [list]), 0, "list_items still readable");
  assert.equal(await n(db, who, "select 1 from public.essay_versions where essay_id = $1", [essay]), 0, "essay_versions still readable");
}

const grantsOf = async (db: AuthDb, who: string) => (await rpc<{ grants: { student_id: string; can_edit: boolean }[] }>(db, who, "public.viewer_bundle()")).grants;

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

test("a counselor with a live grant reads the student's record, list, plan, and essays; so does every member", async () => {
  const w = await world();
  await assertCounselorReads(w, w.rivera);
  await assertCounselorReads(w, w.lee);
  // The shared note is the list's; Ben (granted by Mom, a managed record) opens too.
  const notes = await asUser<{ body: string }>(w.db, w.rivera, "select body from public.list_notes where item_id = $1", [w.item]);
  assert.deepEqual(notes.map((r) => r.body), ["great engineering"]);
  assert.equal(await n(w.db, w.rivera, "select 1 from public.students where id = $1", [w.ben]), 1);
});

test("a counselor never reads a guardian's finances, the household, private notes, or a nudge's text", async () => {
  const w = await world();
  await assertCounselorNeverReads(w, w.rivera);
  await assertCounselorNeverReads(w, w.lee);
  // Mom reads her own finances (the stand-in policy works), and Alice still reads her private note and the nudge.
  assert.equal(await n(w.db, w.mom, "select 1 from public.household_finances"), 1);
  assert.equal(await n(w.db, w.alice, "select 1 from public.plan_nudges"), 1);
});

test("another organization sees nothing of the student, and a counselor sees only their own caseload", async () => {
  const w = await world();
  await assertReadsNothing(w, w.zane);
  await assertReadsNothing(w, w.eve);
  assert.equal(await n(w.db, w.rivera, "select 1 from public.students where id = $1", [w.bobS]), 0);
  assert.equal(await n(w.db, w.zane, "select 1 from public.students where id = $1", [w.bobS]), 1);
  for (const t of ["organizations", "org_members", "org_invitations", "org_students", "org_notes", "org_requests"]) {
    const rows = await asUser<{ org_id?: string; id: string }>(w.db, w.zane, `select ${t === "organizations" ? "id" : "org_id"} from public.${t}`);
    assert.ok(rows.every((r) => (t === "organizations" ? r.id : r.org_id) === w.north), `${t}: Northside read Rivera's rows`);
  }
  assert.deepEqual(await asUser(w.db, w.zane, "select * from public.org_roster($1)", [w.org]), []);
});

test("viewer_bundle keeps its keys and carries the member's live grants; students include the caseload", async () => {
  const w = await world();
  const bundle = await rpc<Record<string, unknown>>(w.db, w.rivera, "public.viewer_bundle()");
  assert.deepEqual(Object.keys(bundle).sort(), ["grants", "home", "households", "members", "profile", "student_profiles", "students"]);
  const grants = await grantsOf(w.db, w.rivera);
  assert.deepEqual(grants.map((g) => g.student_id).sort(), [w.aliceS, w.ben].sort());
  assert.ok(grants.every((g) => g.can_edit === true));
  assert.deepEqual(((bundle.students as { id: string }[]).map((s) => s.id)).sort(), [w.aliceS, w.ben].sort());
  assert.deepEqual(bundle.households, []);
  assert.equal(bundle.home, null);
  // The family's own bundle has no grants (they aren't members), and Mom still sees her household.
  assert.deepEqual(await grantsOf(w.db, w.mom), []);
  assert.equal(((await rpc<{ households: unknown[] }>(w.db, w.mom, "public.viewer_bundle()")).households).length, 1);
});

/* ------------------------------------------------------------------ */
/* Ending, view only, and who decides                                  */
/* ------------------------------------------------------------------ */

test("an ended grant reads nothing at once, for every member, and leaves the bundle", async () => {
  const w = await world();
  await rpc(w.db, w.alice, "public.end_org_access($1)", [w.aliceGrant]);
  await assertReadsNothing(w, w.rivera);
  await assertReadsNothing(w, w.lee);
  assert.deepEqual((await grantsOf(w.db, w.rivera)).map((g) => g.student_id), [w.ben]);
  await assert.rejects(rpc(w.db, w.alice, "public.end_org_access($1)", [w.aliceGrant]), /grant_ended/);
  // Joining again makes a new live grant (one live row per organization and student).
  const again = await rpc<string>(w.db, w.alice, "public.join_organization($1)", [w.code]);
  assert.notEqual(again, w.aliceGrant);
  await assertCounselorReads(w, w.rivera);
});

test("a member may drop a student; outsiders can't end a grant", async () => {
  const w = await world();
  await assert.rejects(rpc(w.db, w.zane, "public.end_org_access($1)", [w.aliceGrant]), /grant_not_found/);
  await assert.rejects(rpc(w.db, w.eve, "public.end_org_access($1)", [w.aliceGrant]), /grant_not_found/);
  await rpc(w.db, w.lee, "public.end_org_access($1)", [w.benGrant]);
  assert.equal(await n(w.db, w.rivera, "select 1 from public.students where id = $1", [w.ben]), 0);
  // A guardian ends one they can see (Dad, for Alice).
  await rpc(w.db, w.dad, "public.end_org_access($1)", [w.aliceGrant]);
  await assertReadsNothing(w, w.rivera);
});

test("view only: the counselor still reads but can't write list items, the profile, or the student", async () => {
  const w = await world();
  await rpc(w.db, w.alice, "public.set_org_student_can_edit($1, false)", [w.aliceGrant]);
  await assertCounselorReads(w, w.rivera);
  await assert.rejects(asUser(w.db, w.rivera, "insert into public.list_items (list_id, unit_id, position) values ($1, '170976', 1)", [w.list]), /row-level security/);
  assert.equal(await affectedAsUser(w.db, w.rivera, "update public.student_profiles set data = '{}' where student_id = $1", [w.aliceS]), 0);
  assert.equal(await affectedAsUser(w.db, w.rivera, "update public.students set grad_year = 2028 where id = $1", [w.aliceS]), 0);
  // Edit back on: the item goes in; and a grade-year change is allowed.
  await rpc(w.db, w.mom, "public.set_org_student_can_edit($1, true)", [w.aliceGrant]);
  await asUser(w.db, w.rivera, "insert into public.list_items (list_id, unit_id, position) values ($1, '170976', 1)", [w.list]);
  assert.equal(await affectedAsUser(w.db, w.rivera, "update public.students set grad_year = 2028 where id = $1", [w.aliceS]), 1);
});

/** A counselor can't soft-delete the student's record or change its phone, even with edit access. */
async function assertCounselorCantDelete(w: Base) {
  await assert.rejects(asUser(w.db, w.rivera, "update public.students set deleted_at = now() where id = $1", [w.aliceS]), /counselor_cannot_change/, "a counselor deleted the record");
  await assert.rejects(asUser(w.db, w.rivera, "update public.students set phone = '+16155550100' where id = $1", [w.aliceS]), /counselor_cannot_change/, "a counselor changed the phone");
}

test("a counselor with edit access never deletes the record or changes its phone; the family still can", async () => {
  const w = await world();
  await assertCounselorCantDelete(w);
  assert.equal(await affectedAsUser(w.db, w.alice, "update public.students set phone = '+16155550100' where id = $1", [w.aliceS]), 1);
  assert.equal(await affectedAsUser(w.db, w.dad, "update public.students set grad_year = 2027 where id = $1", [w.aliceS]), 1);
});

/** Only the family turns editing on or off; members and outsiders are refused. */
async function assertOnlyFamilySetsEdit(w: Base) {
  await assert.rejects(rpc(w.db, w.rivera, "public.set_org_student_can_edit($1, true)", [w.aliceGrant]), /grant_not_found/, "a member changed edit access");
  await assert.rejects(rpc(w.db, w.zane, "public.set_org_student_can_edit($1, false)", [w.aliceGrant]), /grant_not_found/, "an outsider changed edit access");
}

test("set_org_student_can_edit: the student or a guardian decides; the organization never does", async () => {
  const w = await world();
  await assertOnlyFamilySetsEdit(w);
  await rpc(w.db, w.mom, "public.set_org_student_can_edit($1, false)", [w.aliceGrant]);
  assert.deepEqual((await grantsOf(w.db, w.rivera)).find((g) => g.student_id === w.aliceS)?.can_edit, false);
  await rpc(w.db, w.alice, "public.set_org_student_can_edit($1, true)", [w.aliceGrant]);
  assert.deepEqual((await grantsOf(w.db, w.rivera)).find((g) => g.student_id === w.aliceS)?.can_edit, true);
});

test("my_counselor_grants: the student and their guardians see the organization and its counselors; members don't", async () => {
  const w = await world();
  type G = { grant_id: string; org_name: string; counselor_names: string[]; student_id: string; can_edit: boolean };
  const alices = await asUser<G>(w.db, w.alice, "select * from public.my_counselor_grants()");
  assert.deepEqual(alices.map((g) => [g.org_name, g.counselor_names]), [["Rivera Advising", ["Ms. Rivera", "Mr. Lee"]]]);
  const moms = await asUser<G>(w.db, w.mom, "select * from public.my_counselor_grants()");
  assert.deepEqual(moms.map((g) => g.student_id).sort(), [w.aliceS, w.ben].sort());
  assert.deepEqual(await asUser(w.db, w.rivera, "select * from public.my_counselor_grants()"), []);
  // The family reads its grant rows; no one reads the organization table except members.
  assert.equal(await n(w.db, w.alice, "select 1 from public.org_students"), 1);
  assert.equal(await n(w.db, w.alice, "select 1 from public.organizations"), 0);
});

/* ------------------------------------------------------------------ */
/* The access log                                                      */
/* ------------------------------------------------------------------ */

/** A counselor's read is logged, and the student sees it under the counselor's name. */
async function assertCounselorReadLogged(w: Base) {
  await asUser(w.db, w.rivera, "select public.log_access($1, 'lists')", [w.aliceS]);
  const log = await asUser<{ viewer_name: string; viewer_role: string; table_name: string }>(w.db, w.alice, "select * from public.my_access_log(50)");
  const row = log.find((r) => r.viewer_name === "Ms. Rivera");
  assert.ok(row, "the counselor's read wasn't logged");
  assert.equal(row.viewer_role, "counselor");
  assert.equal(row.table_name, "lists");
}

test("log_access records a counselor's read and my_access_log names the counselor; a guardian reads as a guardian", async () => {
  const w = await world();
  await assertCounselorReadLogged(w);
  await asUser(w.db, w.mom, "select public.log_access($1, 'lists')", [w.aliceS]);
  const log = await asUser<{ viewer_name: string; viewer_role: string }>(w.db, w.alice, "select * from public.my_access_log(50)");
  assert.equal(log.find((r) => r.viewer_name === "Tracy Smith")?.viewer_role, "guardian");
  // No grant, no log line.
  await asUser(w.db, w.zane, "select public.log_access($1, 'lists')", [w.aliceS]);
  assert.equal((await asUser(w.db, w.alice, "select * from public.my_access_log(50)")).length, 2);
});

/* ------------------------------------------------------------------ */
/* Joining by code                                                     */
/* ------------------------------------------------------------------ */

test("a code joins: typed any way, the same grant twice, an unknown code refused, a regenerated code ends the old one", async () => {
  const w = await world();
  const zed = await createUser(w.db, { email: "zed@example.com", birthYear: 2009, roleHint: "student", displayName: "Zed" });
  await asUser(w.db, zed, "insert into public.students (user_id, display_name) values ($1, 'Zed')", [zed]);
  const g1 = await rpc<string>(w.db, zed, "public.join_organization($1)", [` QUAD ${w.code.toLowerCase()} `]);
  const g2 = await rpc<string>(w.db, zed, "public.join_organization($1)", [w.code]);
  assert.equal(g1, g2);
  const row = (await w.db.query<{ source: string; can_edit: boolean }>("select source, can_edit from public.org_students where id = $1", [g1])).rows[0];
  assert.deepEqual(row, { source: "code", can_edit: true });
  await assert.rejects(rpc(w.db, zed, "public.join_organization('ZZZZZZ')"), /no_such_code/);

  const preview = await rpc<{ org_name: string; counselor_names: string[] }>(w.db, null, "public.org_code_preview($1)", [`quad-${w.code}`]);
  assert.deepEqual([preview.org_name, preview.counselor_names], ["Rivera Advising", ["Ms. Rivera", "Mr. Lee"]]);
  assert.equal(await rpc(w.db, null, "public.org_code_preview('NOSUCH')"), null);

  await assert.rejects(rpc(w.db, w.lee, "public.regenerate_join_code($1)", [w.org]), /owners_only/);
  const fresh = await rpc<string>(w.db, w.rivera, "public.regenerate_join_code($1)", [w.org]);
  assert.match(fresh, /^[A-Z]{4,6}$/);
  assert.notEqual(fresh, w.code);
  await assert.rejects(rpc(w.db, zed, "public.join_organization($1)", [w.code]), /no_such_code/);
  assert.equal(await rpc(w.db, null, "public.org_code_preview($1)", [w.code]), null);
});

test("who may join: a student for their own record, a guardian for a student they see; a counselor or stranger can't", async () => {
  const w = await world();
  // Mr. Zane has no student record; Mom can't join Bob (not hers); a student without a record can't either.
  await assert.rejects(rpc(w.db, w.zane, "public.join_organization($1)", [w.code]), /not_a_student/);
  await assert.rejects(rpc(w.db, w.mom, "public.join_organization($1)", [w.code]), /not_a_student/);
  await assert.rejects(rpc(w.db, w.mom, "public.join_organization($1, $2)", [w.northCode, w.bobS]), /not_a_student/);
  await assert.rejects(rpc(w.db, w.rivera, "public.join_organization($1, $2)", [w.northCode, w.aliceS]), /not_a_student/, "a counselor granted a caseload student to another office");
  // Dad joins Alice to Northside: two caseloads, two grants.
  await rpc(w.db, w.dad, "public.join_organization($1, $2)", [w.northCode, w.aliceS]);
  assert.equal(await n(w.db, w.alice, "select 1 from public.my_counselor_grants()"), 2);
  await assertCounselorReads(w, w.zane);
  await assert.rejects(rpc(w.db, null, "public.join_organization($1)", [w.code]), /permission denied/);
});

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

/** A used or cancelled invitation keeps no clear token. */
async function assertTokensCleared(db: AuthDb, org: string) {
  const left = (await db.query<{ n: number }>("select count(*)::int as n from public.org_invitations where org_id = $1 and token is not null and (accepted_at is not null or revoked_at is not null or expires_at <= now())", [org])).rows[0].n;
  assert.equal(left, 0, "a used, cancelled, or expired invitation kept its token");
}

test("an invitation's lifecycle: invited, previewed, accepted once; cancelled and expired ones refuse", async () => {
  const w = await world();
  const inv = await rpc<{ id: string; token: string; expires_at: string }>(w.db, w.lee, "public.org_invite($1, 'student', 'Pat@Example.com', 'Pat', 2027)", [w.org]);
  assert.match(inv.token, /^[0-9a-f]{64}$/);
  const days = (new Date(inv.expires_at).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30, `30 days, got ${days}`);
  // Inviting the same email again returns the same link.
  assert.equal((await rpc<{ id: string }>(w.db, w.rivera, "public.org_invite($1, 'student', 'pat@example.com', null, null)", [w.org])).id, inv.id);

  const preview = await rpc<Record<string, unknown>>(w.db, null, "public.org_invitation_preview($1)", [inv.token]);
  assert.deepEqual([preview.org_name, preview.inviter_name, preview.side, preview.display_name, preview.state], ["Rivera Advising", "Mr. Lee", "student", "Pat", "pending"]);
  assert.ok(!JSON.stringify(preview).includes("@"), "the preview must never carry the email");

  type R = { status: string; display_name: string; email: string | null; token: string | null };
  const roster = await asUser<R>(w.db, w.rivera, "select * from public.org_roster($1)", [w.org]);
  assert.deepEqual(roster.map((r) => [r.status, r.display_name]), [["active", "Alice Smith"], ["active", "Ben"], ["invited", "Pat"]]);
  assert.equal(roster.find((r) => r.status === "invited")?.token, inv.token, "Copy link needs the token");
  await assert.rejects(asUser(w.db, w.rivera, "select token from public.org_invitations"), /permission denied/);

  const pat = await createUser(w.db, { email: "pat@example.com", birthYear: 2009, roleHint: "student", displayName: "Pat" });
  await assert.rejects(rpc(w.db, pat, "public.accept_org_invitation($1)", [inv.token]), /not_a_student/);
  await asUser(w.db, pat, "insert into public.students (user_id, display_name) values ($1, 'Pat')", [pat]);
  const grant = await rpc<string>(w.db, pat, "public.accept_org_invitation($1)", [inv.token]);
  assert.equal((await w.db.query<{ source: string }>("select source from public.org_students where id = $1", [grant])).rows[0].source, "invite");
  await assert.rejects(rpc(w.db, pat, "public.accept_org_invitation($1)", [inv.token]), /invitation_used/);
  assert.equal((await rpc<{ state: string }>(w.db, null, "public.org_invitation_preview($1)", [inv.token])).state, "accepted");
  await assert.rejects(rpc(w.db, w.rivera, "public.org_invite($1, 'student', 'pat@example.com', null, null)", [w.org]), /already_on_caseload/);

  const cancelled = await rpc<{ id: string; token: string }>(w.db, w.rivera, "public.org_invite($1, 'student', 'sam@example.com', 'Sam', null)", [w.org]);
  await rpc(w.db, w.lee, "public.cancel_org_invitation($1)", [cancelled.id]);
  await assert.rejects(rpc(w.db, pat, "public.accept_org_invitation($1)", [cancelled.token]), /invitation_revoked/);

  const old = await rpc<{ id: string; token: string }>(w.db, w.rivera, "public.org_invite($1, 'student', 'old@example.com', 'Old', null)", [w.org]);
  await w.db.query("update public.org_invitations set expires_at = now() - interval '1 day' where id = $1", [old.id]);
  await assert.rejects(rpc(w.db, pat, "public.accept_org_invitation($1)", [old.token]), /invitation_expired/);
  const expired = (await asUser<R>(w.db, w.rivera, "select * from public.org_roster($1)", [w.org])).find((r) => r.display_name === "Old");
  assert.deepEqual([expired?.status, expired?.token], ["expired", null]);
  await assertTokensCleared(w.db, w.org);
  await assert.rejects(rpc(w.db, pat, "public.accept_org_invitation('nope')"), /invitation_not_found/);
});

test("counselor invitations: owners only, the invited email only, and nobody already a member", async () => {
  const w = await world();
  await assert.rejects(rpc(w.db, w.lee, "public.org_invite($1, 'counselor', 'kim@advising.test', null, null)", [w.org]), /owners_only/);
  await assert.rejects(rpc(w.db, w.rivera, "public.org_invite($1, 'counselor', 'lee@advising.test', null, null)", [w.org]), /already_a_member/);
  await assert.rejects(rpc(w.db, w.zane, "public.org_invite($1, 'student', 'x@example.com', null, null)", [w.org]), /not_a_member/);
  const inv = await rpc<{ token: string }>(w.db, w.rivera, "public.org_invite($1, 'counselor', 'kim@advising.test', 'Kim', null)", [w.org]);
  await assert.rejects(rpc(w.db, w.eve, "public.accept_org_invitation($1)", [inv.token]), /invitation_wrong_email/);
  const kim = await createUser(w.db, { email: "kim@advising.test", birthYear: 1990, roleHint: "counselor", displayName: "Kim" });
  await rpc(w.db, kim, "public.accept_org_invitation($1)", [inv.token]);
  await assertCounselorReads(w, kim);
});

/* ------------------------------------------------------------------ */
/* One organization, members, roles, deleting                         */
/* ------------------------------------------------------------------ */

/** A person is in one live organization. */
async function assertOneOrganization(w: Base) {
  await assert.rejects(rpc(w.db, w.rivera, "public.create_organization('Second office', 'iec', null, null)"), /already_in_organization/, "a second organization was created");
  const inv = await rpc<{ token: string }>(w.db, w.zane, "public.org_invite($1, 'counselor', 'lee@advising.test', null, null)", [w.north]);
  await assert.rejects(rpc(w.db, w.lee, "public.accept_org_invitation($1)", [inv.token]), /already_in_organization/, "a member joined a second organization");
}

test("one live organization per person; deleting it frees them to start another", async () => {
  const w = await world();
  await assertOneOrganization(w);
  await assert.rejects(rpc(w.db, w.rivera, "public.create_organization('', 'iec', null, null)"), /invalid_name|already_in_organization/);
  await assert.rejects(rpc(w.db, w.eve, "public.create_organization('Eve', 'tutor', null, null)"), /invalid_kind/);
  await rpc(w.db, w.rivera, "public.delete_organization($1)", [w.org]);
  assert.ok(await rpc<string>(w.db, w.rivera, "public.create_organization('Rivera Advising II', 'iec', null, null)"));
});

test("my_organization names the members and roles; owners remove, the last owner stays, a counselor leaves", async () => {
  const w = await world();
  const mine = await rpc<{ name: string; join_code: string; my_role: string; members: { display_name: string; role: string; member_id: string; is_me: boolean }[] }>(w.db, w.lee, "public.my_organization()");
  assert.deepEqual([mine.name, mine.my_role, mine.join_code], ["Rivera Advising", "counselor", w.code]);
  assert.deepEqual(mine.members.map((m) => [m.display_name, m.role, m.is_me]), [["Ms. Rivera", "owner", false], ["Mr. Lee", "counselor", true]]);
  assert.equal(await rpc(w.db, w.alice, "public.my_organization()"), null);

  const riveraMember = mine.members.find((m) => m.role === "owner")!.member_id;
  await assert.rejects(rpc(w.db, w.lee, "public.remove_org_member($1)", [riveraMember]), /owners_only/);
  await assert.rejects(rpc(w.db, w.rivera, "public.remove_org_member($1)", [riveraMember]), /last_owner/);
  await assert.rejects(rpc(w.db, w.rivera, "public.leave_organization()"), /last_owner/);
  await assert.rejects(rpc(w.db, w.rivera, "public.set_org_member_role($1, 'counselor')", [riveraMember]), /last_owner/);
  // Naming another owner lets Ms. Rivera leave; Mr. Lee then reads the caseload as the owner, and Ms. Rivera nothing.
  await rpc(w.db, w.rivera, "public.set_org_member_role($1, 'owner')", [w.leeMember]);
  await rpc(w.db, w.rivera, "public.leave_organization()");
  await assertReadsNothing(w, w.rivera);
  await assertCounselorReads(w, w.lee);
  await assert.rejects(rpc(w.db, w.rivera, "public.leave_organization()"), /not_a_member/);
});

test("removing a member stops their access at once", async () => {
  const w = await world();
  await rpc(w.db, w.rivera, "public.remove_org_member($1)", [w.leeMember]);
  await assertReadsNothing(w, w.lee);
  assert.deepEqual(await grantsOf(w.db, w.lee), []);
});

test("deleting the organization ends every grant, deletes notes and asks, cancels invitations; the student's data stays", async () => {
  const w = await world();
  await asUser(w.db, w.lee, "insert into public.org_notes (org_id, student_id, body) values ($1, $2, 'met Tuesday')", [w.org, w.aliceS]);
  await rpc(w.db, w.rivera, "public.org_ask($1, $2, 'list', null, null)", [w.org, w.aliceS]);
  const pending = await rpc<{ token: string }>(w.db, w.rivera, "public.org_invite($1, 'student', 'pat@example.com', null, null)", [w.org]);
  await assert.rejects(rpc(w.db, w.lee, "public.delete_organization($1)", [w.org]), /owners_only/);
  await rpc(w.db, w.rivera, "public.delete_organization($1)", [w.org]);
  await assertReadsNothing(w, w.rivera);
  await assertReadsNothing(w, w.lee);
  assert.equal((await w.db.query("select 1 from public.org_students where org_id = $1 and ended_at is null", [w.org])).rows.length, 0);
  assert.equal((await w.db.query("select 1 from public.org_notes where org_id = $1", [w.org])).rows.length, 0);
  assert.equal((await w.db.query("select 1 from public.org_requests where org_id = $1", [w.org])).rows.length, 0);
  assert.equal(await rpc(w.db, null, "public.org_invitation_preview($1)", [pending.token]), null);
  assert.equal(await rpc(w.db, w.rivera, "public.my_organization()"), null);
  assert.equal(await n(w.db, w.alice, "select 1 from public.my_counselor_grants()"), 0);
  assert.equal(await n(w.db, w.alice, "select 1 from public.list_items where list_id = $1", [w.list]), 1);
});

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

/** The family never reads the office's notes. */
async function assertNotesStayInTheOffice(w: Base) {
  for (const who of [w.alice, w.mom, w.dad, w.zane]) {
    assert.equal(await n(w.db, who, "select 1 from public.org_notes"), 0, "a note left the office");
  }
}

test("notes: every member reads and writes, the author edits and deletes, the family never sees them", async () => {
  const w = await world();
  const note = (await one(asUser<{ id: string; author_id: string }>(w.db, w.lee, "insert into public.org_notes (org_id, student_id, body, author_id) values ($1, $2, 'met Tuesday', $3) returning id, author_id", [w.org, w.aliceS, w.rivera]))).id;
  assert.equal((await w.db.query<{ author_id: string }>("select author_id from public.org_notes where id = $1", [note])).rows[0].author_id, w.lee, "the author is the caller");
  assert.equal(await n(w.db, w.rivera, "select 1 from public.org_notes where id = $1", [note]), 1);
  await assertNotesStayInTheOffice(w);
  assert.equal(await affectedAsUser(w.db, w.rivera, "update public.org_notes set body = 'changed' where id = $1", [note]), 0);
  assert.equal(await affectedAsUser(w.db, w.rivera, "delete from public.org_notes where id = $1", [note]), 0);
  assert.equal(await affectedAsUser(w.db, w.lee, "update public.org_notes set body = 'met Wednesday' where id = $1", [note]), 1);
  await assert.rejects(asUser(w.db, w.lee, "update public.org_notes set student_id = $2 where id = $1", [note, w.ben]), /permission denied/);
  // No note on a student off the caseload; a note outlives the grant.
  await assert.rejects(asUser(w.db, w.rivera, "insert into public.org_notes (org_id, student_id, body) values ($1, $2, 'x')", [w.org, w.bobS]), /row-level security/);
  await rpc(w.db, w.alice, "public.end_org_access($1)", [w.aliceGrant]);
  assert.equal(await n(w.db, w.rivera, "select 1 from public.org_notes where id = $1", [note]), 1);
  assert.equal(await affectedAsUser(w.db, w.lee, "delete from public.org_notes where id = $1", [note]), 1);
});

/* ------------------------------------------------------------------ */
/* Asks                                                                */
/* ------------------------------------------------------------------ */

/** At most three asks a week per student from one organization. */
async function assertAskLimit(w: Base) {
  await rpc(w.db, w.rivera, "public.org_ask($1, $2, 'custom', null, 'Bring your transcript')", [w.org, w.aliceS]);
  await rpc(w.db, w.rivera, "public.org_ask($1, $2, 'custom', null, 'Send your activity list')", [w.org, w.aliceS]);
  await rpc(w.db, w.lee, "public.org_ask($1, $2, 'list', null, null)", [w.org, w.aliceS]);
  await assert.rejects(rpc(w.db, w.lee, "public.org_ask($1, $2, 'record_section', 'testing', null)", [w.org, w.aliceS]), /ask_limit/, "a fourth ask in a week went through");
}

test("asks: one open per section, three a week, shapes checked, only for the caseload", async () => {
  const w = await world();
  const ask = await one(asUser<{ id: string; kind: string; section: string }>(w.db, w.rivera, "select * from public.org_ask($1, $2, 'record_section', 'testing', null)", [w.org, w.aliceS]));
  assert.deepEqual([ask.kind, ask.section], ["record_section", "testing"]);
  await assert.rejects(rpc(w.db, w.lee, "public.org_ask($1, $2, 'record_section', 'testing', null)", [w.org, w.aliceS]), /ask_open/);
  await assert.rejects(rpc(w.db, w.rivera, "public.org_ask($1, $2, 'custom', null, null)", [w.org, w.aliceS]), /invalid_ask/);
  await assert.rejects(rpc(w.db, w.rivera, "public.org_ask($1, $2, 'record_section', null, null)", [w.org, w.aliceS]), /invalid_ask/);
  await assert.rejects(rpc(w.db, w.rivera, "public.org_ask($1, $2, 'custom', null, $3)", [w.org, w.aliceS, "x".repeat(201)]), /invalid_ask/);
  await assert.rejects(rpc(w.db, w.rivera, "public.org_ask($1, $2, 'list', null, null)", [w.org, w.bobS]), /grant_ended/);
  await assert.rejects(rpc(w.db, w.zane, "public.org_ask($1, $2, 'list', null, null)", [w.org, w.aliceS]), /not_a_member/);
  await rpc(w.db, w.rivera, "public.org_ask_done($1)", [ask.id]);
  await rpc(w.db, w.rivera, "public.org_ask($1, $2, 'record_section', 'testing', null)", [w.org, w.aliceS]);
  await rpc(w.db, w.rivera, "public.org_ask($1, $2, 'list', null, null)", [w.org, w.aliceS]);
  await assert.rejects(rpc(w.db, w.rivera, "public.org_ask($1, $2, 'custom', null, 'one more')", [w.org, w.aliceS]), /ask_limit/);
});

test("ask limit: three asks a week per student", async () => {
  await assertAskLimit(await world());
});

/** The family reads an organization's asks only while its grant is live. */
async function assertAsksLeaveWithTheGrant(w: Base) {
  await rpc(w.db, w.rivera, "public.org_ask($1, $2, 'list', null, null)", [w.org, w.aliceS]);
  assert.equal(await n(w.db, w.alice, "select 1 from public.org_requests"), 1);
  await rpc(w.db, w.alice, "public.end_org_access($1)", [w.aliceGrant]);
  assert.equal(await n(w.db, w.alice, "select 1 from public.org_requests"), 0, "an ended grant's asks still show to the family");
  assert.equal(await n(w.db, w.alice, "select 1 from public.org_open_asks($1)", [w.aliceS]), 0, "an ended grant's asks still show in the notice");
}

test("the family reads asks with who asked, marks them seen and done; ending the grant removes them", async () => {
  const w = await world();
  const ask = await one(asUser<{ id: string }>(w.db, w.lee, "select * from public.org_ask($1, $2, 'record_section', 'testing', null)", [w.org, w.aliceS]));
  type A = { id: string; org_name: string; asked_by_name: string; seen_at: string | null };
  const open = await asUser<A>(w.db, w.alice, "select * from public.org_open_asks($1)", [w.aliceS]);
  assert.deepEqual(open.map((a) => [a.org_name, a.asked_by_name]), [["Rivera Advising", "Mr. Lee"]]);
  assert.equal(await n(w.db, w.mom, "select 1 from public.org_open_asks($1)", [w.aliceS]), 1, "a parent sees it on the student's plan too");
  assert.equal(await n(w.db, w.zane, "select 1 from public.org_open_asks($1)", [w.aliceS]), 0);
  await assert.rejects(rpc(w.db, w.rivera, "public.org_ask_seen($1)", [ask.id]), /request_not_found/);
  await rpc(w.db, w.alice, "public.org_ask_seen($1)", [ask.id]);
  await rpc(w.db, w.alice, "public.org_ask_done($1)", [ask.id]);
  const row = (await asUser<{ done_at: string | null; seen_at: string | null }>(w.db, w.rivera, "select done_at, seen_at from public.org_requests where id = $1", [ask.id]))[0];
  assert.ok(row.done_at && row.seen_at);
  await assert.rejects(rpc(w.db, w.eve, "public.org_ask_done($1)", [ask.id]), /request_not_found/);
  await assertAsksLeaveWithTheGrant(await world());
});

/* ------------------------------------------------------------------ */
/* Essays                                                              */
/* ------------------------------------------------------------------ */

/** A counselor's comment and suggestion carry author_role 'counselor'. */
async function assertCounselorRole(w: Base) {
  const c = await one(asUser<{ author_role: string }>(w.db, w.rivera, "insert into public.essay_comments (essay_id, body) values ($1, 'Strong opening') returning author_role", [w.essay]));
  assert.equal(c.author_role, "counselor", "a counselor's comment isn't marked as a counselor's");
  const s = await one(asUser<{ author_role: string }>(w.db, w.lee, "insert into public.essay_suggestions (essay_id, base_version_id, base_body, proposed_body) values ($1, $2, 'My first draft.', 'My better draft.') returning author_role", [w.essay, w.version]));
  assert.equal(s.author_role, "counselor", "a counselor's suggestion isn't marked as a counselor's");
}

test("essays: a counselor reads and comments as a counselor; the family keeps its roles; an ended grant can't comment", async () => {
  const w = await world();
  await assertCounselorRole(w);
  const roles = async (who: string) => (await one(asUser<{ author_role: string }>(w.db, who, "insert into public.essay_comments (essay_id, body) values ($1, 'x') returning author_role", [w.essay]))).author_role;
  assert.equal(await roles(w.alice), "student");
  assert.equal(await roles(w.mom), "guardian");
  // A second office's counselor, once a guardian grants it, comments as a counselor too.
  await rpc(w.db, w.dad, "public.join_organization($1, $2)", [w.northCode, w.aliceS]);
  assert.equal(await roles(w.zane), "counselor");
  await rpc(w.db, w.alice, "public.end_org_access($1)", [w.aliceGrant]);
  await assert.rejects(asUser(w.db, w.rivera, "insert into public.essay_comments (essay_id, body) values ($1, 'x')", [w.essay]), /row-level security/);
});

/* ------------------------------------------------------------------ */
/* A managed record merged into the student's own keeps its counselors */
/* ------------------------------------------------------------------ */

test("a managed student claimed into their own record keeps the caseload's grant", async () => {
  const w = await world();
  const benUser = await createUser(w.db, { email: "ben@example.com", birthYear: 2010, roleHint: "student", displayName: "Ben Smith" });
  const own = (await one(asUser<{ id: string }>(w.db, benUser, "insert into public.students (user_id, display_name) values ($1, 'Ben Smith') returning id", [benUser]))).id;
  const inv = await rpc<{ token: string }>(w.db, w.mom, "public.create_invitation($1, 'ben@example.com', 'student', $2, false, null, null, null)", [w.household, w.ben]);
  await rpc(w.db, benUser, "public.accept_invitation($1)", [inv.token]);
  assert.equal(await n(w.db, w.rivera, "select 1 from public.students where id = $1", [own]), 1);
  assert.deepEqual((await grantsOf(w.db, w.rivera)).map((g) => g.student_id).sort(), [w.aliceS, own].sort());
});

/* ------------------------------------------------------------------ */
/* Admins and signed-out visitors                                      */
/* ------------------------------------------------------------------ */

test("admins in the console read all six tables, never the tokens; signed-out visitors read nothing", async () => {
  const w = await world();
  await asUser(w.db, w.lee, "insert into public.org_notes (org_id, student_id, body) values ($1, $2, 'met')", [w.org, w.aliceS]);
  await rpc(w.db, w.rivera, "public.org_ask($1, $2, 'list', null, null)", [w.org, w.aliceS]);
  for (const t of ["organizations", "org_members", "org_invitations", "org_students", "org_notes", "org_requests"]) {
    assert.ok((await asAdmin(w.db, w.quinn, `select id from public.${t}`)).length > 0, `admin read nothing from ${t}`);
    assert.equal(await n(w.db, w.quinn, `select id from public.${t}`), 0, `${t}: an admin outside the console read it`);
    assert.equal(await n(w.db, w.eve, `select id from public.${t}`), 0, `${t}: an outsider read it`);
    await assert.rejects(asUser(w.db, null, `select id from public.${t}`), /permission denied/, `${t}: anon read it`);
  }
  await assert.rejects(asAdmin(w.db, w.quinn, "select token from public.org_invitations"), /permission denied/);
  await assert.rejects(asAdmin(w.db, w.quinn, "select token_hash from public.org_invitations"), /permission denied/);
  await assert.rejects(rpc(w.db, null, "public.org_roster($1)", [w.org]), /permission denied/);
  // Writes go through the functions: no direct grant or member insert.
  await assert.rejects(asUser(w.db, w.rivera, "insert into public.org_students (org_id, student_id, source) values ($1, $2, 'code')", [w.org, w.bobS]), /permission denied/);
  await assert.rejects(asUser(w.db, w.eve, "insert into public.org_members (org_id, user_id, role) values ($1, $2, 'owner')", [w.org, w.eve]), /permission denied/);
});

/* ------------------------------------------------------------------ */
/* Guards: break one rule, and the check above fails                   */
/* ------------------------------------------------------------------ */

test("guard: is_counselor_of without the ended_at check keeps an ended grant open, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.is_counselor_of(p_student uuid, p_need_edit boolean) returns boolean
    language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.org_students g join public.org_members m on m.org_id = g.org_id and m.user_id = auth.uid()
        where g.student_id = p_student and (g.can_edit or not p_need_edit)) $$;`);
  await rpc(w.db, w.alice, "public.end_org_access($1)", [w.aliceGrant]);
  await assert.rejects(assertReadsNothing(w, w.rivera), /still readable/);
});

test("guard: can_read_student without the counselor clause shuts the counselor out, and the read check catches it", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.can_read_student(p_student uuid) returns boolean
    language sql stable security definer set search_path = '' as $$
      select auth.uid() is not null and exists (select 1 from public.students s where s.id = p_student and s.deleted_at is null
        and (s.user_id = auth.uid() or s.managed_by = auth.uid() or public.is_guardian_of(s.id, false))) $$;`);
  await assert.rejects(assertCounselorReads(w, w.rivera), /students/);
});

test("guard: a notes policy that lets the student's readers in leaks notes to the family, and the check catches it", async () => {
  const w = await world();
  await asUser(w.db, w.lee, "insert into public.org_notes (org_id, student_id, body) values ($1, $2, 'met')", [w.org, w.aliceS]);
  await w.db.exec(`create policy "broken" on public.org_notes for select to authenticated using (public.can_read_student(student_id));`);
  await assert.rejects(assertNotesStayInTheOffice(w), /a note left the office/);
});

test("guard: a list_notes policy that ignores private leaks the student's private note, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`create policy "broken" on public.list_notes for select to authenticated
    using (exists (select 1 from public.list_items li where li.id = item_id and public.can_read_list(li.list_id)));`);
  await assert.rejects(assertCounselorNeverReads(w, w.rivera), /private note leaked/);
});

test("guard: a nudges policy open to the student's readers leaks the text, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`create policy "broken" on public.plan_nudges for select to authenticated using (public.can_read_student(to_student));`);
  await assert.rejects(assertCounselorNeverReads(w, w.rivera), /nudge leaked/);
});

test("guard: set_org_student_can_edit open to any reader lets the organization turn editing on, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.set_org_student_can_edit(p_grant uuid, p_can_edit boolean) returns void
    language plpgsql security definer set search_path = '' as $$
    begin
      if not exists (select 1 from public.org_students g where g.id = p_grant and public.can_read_student(g.student_id)) then
        raise exception 'grant_not_found';
      end if;
      update public.org_students set can_edit = p_can_edit where id = p_grant;
    end $$;`);
  await assert.rejects(assertOnlyFamilySetsEdit(w), /a member changed edit access/);
});

test("guard: without the one-organization trigger a person runs two offices, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`drop trigger org_members_one_org on public.org_members;
    create or replace function public.my_org_id() returns uuid language sql stable as $$ select null::uuid $$;`);
  await assert.rejects(assertOneOrganization(w), /was created|second organization/);
});

test("guard: without the token-clearing trigger an accepted invitation keeps its link, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`drop trigger org_invitations_clear_token on public.org_invitations;`);
  const inv = await rpc<{ token: string }>(w.db, w.rivera, "public.org_invite($1, 'student', 'bob@example.com', null, null)", [w.org]);
  await rpc(w.db, w.bob, "public.accept_org_invitation($1)", [inv.token]);
  await assert.rejects(assertTokensCleared(w.db, w.org), /kept its token/);
});

test("guard: org_ask without the weekly limit lets a fourth ask through, and the check catches it", async () => {
  const w = await world();
  const sql = readFileSync(join(DIR, MIGRATION), "utf8");
  const start = sql.indexOf("create function public.org_ask(");
  const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("as $$", start)) + 3);
  const broken = body.replace("create function", "create or replace function").replace(/>= 3 then/, ">= 1000 then");
  assert.notEqual(broken, body);
  await w.db.exec(broken);
  await assert.rejects(assertAskLimit(w), /a fourth ask/);
});

test("guard: a family policy on asks without the live-grant check shows an ended grant's asks, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`create policy "broken" on public.org_requests for select to authenticated using (public.is_family_of(student_id));`);
  await assert.rejects(assertAsksLeaveWithTheGrant(w), /still show to the family/);
});

test("guard: log_access for guardians only drops a counselor's read, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.log_access(p_student uuid, p_table text) returns void
    language plpgsql security definer set search_path = '' as $$
    begin
      if not public.is_guardian_of(p_student, false) then return; end if;
      insert into public.access_log (viewer_id, student_id, table_name) values (auth.uid(), p_student, p_table);
    end $$;`);
  await assert.rejects(assertCounselorReadLogged(w), /wasn't logged/);
});

test("guard: the essays author trigger from before the portal marks a counselor as a guardian, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.essay_comments_set_author() returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      new.author_id := auth.uid();
      new.author_role := case when public.is_own_essay(new.essay_id) then 'student' else 'guardian' end;
      return new;
    end $$;`);
  await assert.rejects(assertCounselorRole(w), /comment isn't marked/);
});

test("guard: without students_guard_counselor a counselor soft-deletes the record, and the check catches it", async () => {
  const w = await world();
  await w.db.exec(`drop trigger students_guard_counselor on public.students;`);
  await assert.rejects(assertCounselorCantDelete(w), /deleted the record/);
});
