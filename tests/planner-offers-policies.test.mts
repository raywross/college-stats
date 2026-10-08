/**
 * The offers unit's schema against real Postgres (PGlite with the auth stub, every migration in order): a shared
 * letter's row (plan_letters, 20261008120000_planner.sql) is readable by its uploader and the list's readers only, and
 * written only by someone who can edit the list; the opt-in to share where the student went
 * (lists.outcome_share_consented_at/by, 20261008141000_planner_offers.sql) is changed only by the student's own account,
 * or by an editing guardian when the student has no account. Guard tests break each rule on purpose and show the check
 * notices. The Storage bucket's own policies (supabase/storage/planner-letters.sql) need Supabase's storage schema and
 * are applied by the owner, so they aren't here. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, affectedAsUser, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";

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

/**
 * The Smiths: Mom (guardian, edits Alice and manages Ben), Dad (guardian, view only), Alice (student with her own
 * account and a list), Ben (a managed student without an account, with a list), and Eve outside the household.
 */
async function world() {
  const db = await boot();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Sam Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve" });
  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  const inviteDad = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, $2, 'guardian', null, false, null, null, null)", [household, "dad@example.com"]);
  await rpc(db, dad, "public.accept_invitation($1)", [inviteDad.token]);
  const inviteAlice = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, $2, 'student', null, false, null, null, null)", [household, "alice@example.com"]);
  await rpc(db, alice, "public.accept_invitation($1)", [inviteAlice.token]);
  const student = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const momMember = (await one(asUser<{ member_id: string }>(db, alice, "select member_id from public.household_roster($1) where user_id = $2", [household, mom]))).member_id;
  await asUser(db, alice, "select public.set_member_can_edit($1, true)", [momMember]);
  const list = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]))).id;
  const item = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position) values ($1, '243744', 0) returning id", [list]))).id;
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2029)", [household]);
  const benList = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [ben]))).id;
  const existing = await asUser<{ id: string }>(db, mom, "select id from public.lists where user_id = $1", [mom]);
  const momList = existing[0]?.id ?? (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (user_id, name, is_default) values ($1, 'Mine', true) returning id", [mom]))).id;
  return { db, mom, dad, alice, eve, household, student, list, item, ben, benList, momList };
}

type World = Awaited<ReturnType<typeof world>>;

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/** A shared letter's row: the uploader and the list's readers read it; an outsider doesn't; a view-only reader can't add one. */
async function assertLetterRows(w: World) {
  const { db, mom, dad, alice, eve, item } = w;
  await asUser(db, mom, "insert into public.plan_letters (item_id, kind, storage_path) values ($1, 'aid', $2)", [item, `${mom}/${item}/abc.pdf`]);
  const row = await one(asUser<{ uploaded_by: string; storage_path: string }>(db, mom, "select uploaded_by, storage_path from public.plan_letters"));
  assert.equal(row.uploaded_by, mom, "the uploader is whoever is signed in, never the request's say-so");
  for (const who of [mom, alice, dad]) assert.equal((await asUser(db, who, "select id from public.plan_letters where item_id = $1", [item])).length, 1, "the uploader and the list's readers");
  assert.deepEqual(await asUser(db, eve, "select id from public.plan_letters"), [], "an outsider never sees the row or its path");
  await assert.rejects(asUser(db, dad, "insert into public.plan_letters (item_id, kind, storage_path) values ($1, 'aid', 'x/y.pdf')", [item]), /row-level security/, "a view-only guardian can't share one");
  await assert.rejects(asUser(db, eve, "insert into public.plan_letters (item_id, kind, storage_path) values ($1, 'aid', 'x/z.pdf')", [item]), /row-level security/);
  assert.equal(await affectedAsUser(db, eve, "delete from public.plan_letters"), 0, "an outsider can't revoke it");
}

/** The consent is the student's: their own account sets it; an editing guardian can't (the student has an account). */
async function assertConsentIsStudents(w: World) {
  const { db, mom, dad, alice, eve, list } = w;
  await assert.rejects(asUser(db, mom, "update public.lists set outcome_share_consented_at = now(), outcome_share_consented_by = $2 where id = $1", [list, mom]), /outcome_share_not_allowed/, "an editing guardian of a student with an account");
  assert.equal(await affectedAsUser(db, dad, "update public.lists set outcome_share_consented_at = now(), outcome_share_consented_by = $2 where id = $1", [list, dad]), 0, "a view-only guardian can't update the list at all");
  assert.equal(await affectedAsUser(db, eve, "update public.lists set outcome_share_consented_at = now(), outcome_share_consented_by = $2 where id = $1", [list, eve]), 0);
  // The student, even naming someone else as the consenting person: the database records who is signed in.
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = '2000-01-01', outcome_share_consented_by = $2 where id = $1", [list, mom]);
  const row = await one(asUser<{ at: string | null; by: string | null }>(db, alice, "select outcome_share_consented_at::text as at, outcome_share_consented_by as by from public.lists where id = $1", [list]));
  assert.equal(row.by, alice);
  assert.ok(row.at && !row.at.startsWith("2000"), "the time is the database's");
  // Everyone who reads the list sees the flag; only the student withdraws it.
  assert.equal((await one(asUser<{ by: string }>(db, dad, "select outcome_share_consented_by as by from public.lists where id = $1", [list]))).by, alice);
  await assert.rejects(asUser(db, mom, "update public.lists set outcome_share_consented_at = null, outcome_share_consented_by = null where id = $1", [list]), /outcome_share_not_allowed/);
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = null where id = $1", [list]);
  const cleared = await one(asUser<{ at: string | null; by: string | null }>(db, alice, "select outcome_share_consented_at::text as at, outcome_share_consented_by as by from public.lists where id = $1", [list]));
  assert.deepEqual([cleared.at, cleared.by], [null, null], "withdrawing clears both");
  // Other list edits by the guardian still work (the trigger only watches the consent columns).
  assert.equal(await affectedAsUser(db, mom, "update public.lists set name = 'Colleges' where id = $1", [list]), 1);
}

/** A student without an account: a guardian who can edit them consents for them; a view-only one can't. */
async function assertManagedConsent(w: World) {
  const { db, mom, dad, benList, momList } = w;
  await asUser(db, mom, "update public.lists set outcome_share_consented_at = now() where id = $1", [benList]);
  assert.equal((await one(asUser<{ by: string }>(db, mom, "select outcome_share_consented_by as by from public.lists where id = $1", [benList]))).by, mom);
  assert.equal(await affectedAsUser(db, dad, "update public.lists set outcome_share_consented_at = null where id = $1", [benList]), 0, "a view-only guardian");
  await assert.rejects(asUser(db, mom, "update public.lists set outcome_share_consented_at = now() where id = $1", [momList]), /outcome_share_not_allowed/, "a guardian's own list has no consent");
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test("letters: a shared letter's row is readable by its uploader and the list's readers only", async () => {
  await assertLetterRows(await world());
});

test("letters: the uploader takes a letter back; the row goes with the college", async () => {
  const w = await world();
  const { db, mom, alice, item } = w;
  await asUser(db, mom, "insert into public.plan_letters (item_id, kind, storage_path) values ($1, 'admission', $2)", [item, `${mom}/${item}/one.pdf`]);
  assert.equal(await affectedAsUser(db, mom, "delete from public.plan_letters where item_id = $1", [item]), 1);
  await asUser(db, alice, "insert into public.plan_letters (item_id, kind, storage_path) values ($1, 'aid', $2)", [item, `${alice}/${item}/two.pdf`]);
  await asUser(db, alice, "delete from public.list_items where id = $1", [item]);
  assert.deepEqual((await db.query("select id from public.plan_letters")).rows, []);
});

test("outcome share consent: only the student's own account changes it", async () => {
  await assertConsentIsStudents(await world());
});

test("outcome share consent: for a student without an account, an editing guardian may", async () => {
  await assertManagedConsent(await world());
});

test("guard: a letters read policy open to everyone shows the row to an outsider, and the check fails", async () => {
  const w = await world();
  await w.db.exec(`drop policy "Letters: read" on public.plan_letters;
    create policy "Letters: read" on public.plan_letters for select to authenticated using (true);`);
  await assert.rejects(assertLetterRows(w), assert.AssertionError);
});

test("guard: without the consent trigger an editing guardian could consent for a student, and the check fails", async () => {
  const w = await world();
  await w.db.exec("drop trigger lists_outcome_share_rules on public.lists");
  await assert.rejects(assertConsentIsStudents(w), assert.AssertionError);
});

test("guard: a consent rule that ignores the managed case refuses the guardian, and the check fails", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.can_consent_outcome_share(p_student uuid) returns boolean
    language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.students s where s.id = p_student and s.user_id = auth.uid())
    $$;`);
  await assert.rejects(assertManagedConsent(w), /outcome_share_not_allowed/);
});
