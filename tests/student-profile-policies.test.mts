/**
 * Row-level security for student profiles (supabase/migrations/20261005130000_student_profiles.sql;
 * specs/product/student-profile.md), checked against real Postgres (PGlite + the auth stub, tests/helpers/pg-auth.mts).
 * The table adds no rules of its own: it reuses can_read_student/can_edit_student from the accounts migration, so
 * these tests mostly prove that reuse is wired correctly, plus the usual breakage guard. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const MIGRATIONS = ["20261005120000_accounts.sql", "20261005130000_student_profiles.sql"];

interface World {
  db: AuthDb;
  alice: string; // student
  mom: string; // guardian, view only
  dad: string; // guardian, can_edit
  eve: string; // guardian in a different household
  household: string;
  aliceStudent: string;
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

/** Same household shape as tests/accounts-policies.test.mts: Alice (student), Mom (view-only), Dad (can edit), Eve (outsider). */
async function world(): Promise<World> {
  const db = await createAuthDb(MIGRATIONS);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice" });
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Mom" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Dad" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });

  const { id: aliceStudent } = await one(asUser<{ id: string }>(db, alice, "insert into public.students (user_id, display_name) values ($1, 'Alice') returning id", [alice]));

  const { id: household } = await one(asUser<{ id: string }>(db, mom, "insert into public.households (name) values ('The Smiths') returning id"));
  await asUser(db, mom, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household, mom]);

  const momInv = await one(asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'alice@example.com', 'student') as inv", [household]));
  await asUser(db, alice, "select public.accept_invitation($1)", [momInv.inv.token]);

  const dadInv = await one(asUser<{ inv: { token: string } }>(db, alice, "select public.create_invitation($1, 'dad@example.com', 'guardian', null, true) as inv", [household]));
  await asUser(db, dad, "select public.accept_invitation($1)", [dadInv.inv.token]);

  const { id: eveHousehold } = await one(asUser<{ id: string }>(db, eve, "insert into public.households (name) values ('Eve''s') returning id"));
  await asUser(db, eve, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [eveHousehold, eve]);

  return { db, alice, mom, dad, eve, household, aliceStudent };
}

test("the owning student reads and writes their own profile", async () => {
  const { db, alice, aliceStudent } = await world();
  assert.deepEqual(await asUser(db, alice, "select student_id from public.student_profiles where student_id = $1", [aliceStudent]), []);
  await asUser(db, alice, "insert into public.student_profiles (student_id, data, updated_by) values ($1, $2, $3)", [aliceStudent, JSON.stringify({ tests: { satTotal: 1450 } }), alice]);
  const rows = await asUser<{ data: { tests: { satTotal: number } } }>(db, alice, "select data from public.student_profiles where student_id = $1", [aliceStudent]);
  assert.equal(rows[0].data.tests.satTotal, 1450);
  await asUser(db, alice, "update public.student_profiles set data = $2, updated_by = $3 where student_id = $1", [aliceStudent, JSON.stringify({ tests: { satTotal: 1500 } }), alice]);
  const again = await asUser<{ data: { tests: { satTotal: number } } }>(db, alice, "select data from public.student_profiles where student_id = $1", [aliceStudent]);
  assert.equal(again[0].data.tests.satTotal, 1500);
});

test("an active guardian with can_edit reads and writes; a view-only guardian reads but can't write", async () => {
  const { db, alice, mom, dad, aliceStudent } = await world();
  await asUser(db, alice, "insert into public.student_profiles (student_id, data, updated_by) values ($1, '{}', $2)", [aliceStudent, alice]);

  assert.equal((await asUser(db, mom, "select student_id from public.student_profiles where student_id = $1", [aliceStudent])).length, 1);
  assert.equal((await asUser(db, dad, "select student_id from public.student_profiles where student_id = $1", [aliceStudent])).length, 1);

  assert.equal(await affectedAsUser(db, mom, "update public.student_profiles set data = '{\"academics\":{\"gpa\":3.9}}' where student_id = $1", [aliceStudent]), 0);
  assert.equal(await affectedAsUser(db, dad, "update public.student_profiles set data = '{\"academics\":{\"gpa\":3.9}}', updated_by = $2 where student_id = $1", [aliceStudent, dad]), 1);
});

test("a guardian outside the household sees and writes nothing, even after the row exists", async () => {
  const { db, alice, eve, aliceStudent } = await world();
  await asUser(db, alice, "insert into public.student_profiles (student_id, data, updated_by) values ($1, '{}', $2)", [aliceStudent, alice]);
  assert.deepEqual(await asUser(db, eve, "select student_id from public.student_profiles where student_id = $1", [aliceStudent]), []);
  assert.equal(await affectedAsUser(db, eve, "update public.student_profiles set data = '{}' where student_id = $1", [aliceStudent]), 0);
  await assert.rejects(asUser(db, eve, "insert into public.student_profiles (student_id, data, updated_by) values ($1, '{}', $2)", [aliceStudent, eve]), /row-level security/);
});

test("leaving the household cuts a guardian off from the profile at once, same as the student record", async () => {
  const { db, alice, mom, dad, aliceStudent, household } = await world();
  await asUser(db, alice, "insert into public.student_profiles (student_id, data, updated_by) values ($1, '{}', $2)", [aliceStudent, alice]);
  assert.equal((await asUser(db, mom, "select student_id from public.student_profiles where student_id = $1", [aliceStudent])).length, 1, "mom can read before leaving");
  assert.equal(await affectedAsUser(db, mom, "delete from public.household_members where household_id = $1 and user_id = $2", [household, mom]), 1);
  assert.deepEqual(await asUser(db, mom, "select student_id from public.student_profiles where student_id = $1", [aliceStudent]), []);
  // Dad, still active, is unaffected.
  assert.equal((await asUser(db, dad, "select student_id from public.student_profiles where student_id = $1", [aliceStudent])).length, 1);
});

test("deleting the student record removes the profile with it (cascade)", async () => {
  const { db, alice, aliceStudent } = await world();
  await asUser(db, alice, "insert into public.student_profiles (student_id, data, updated_by) values ($1, '{}', $2)", [aliceStudent, alice]);
  // A hard delete is what the purge script runs with the secret key (superuser here, bypassing RLS the same
  // way); the app itself only ever soft-deletes (sets deleted_at). The cascade is what this test checks.
  await db.query("delete from public.students where id = $1", [aliceStudent]);
  assert.deepEqual(await asUser(db, alice, "select student_id from public.student_profiles where student_id = $1", [aliceStudent]), []);
});

/* ------------------------------------------------------------------ */
/* The checks above must fail when a policy is broken                  */
/* ------------------------------------------------------------------ */

test("guard: with row-level security off, the outsider check catches the leak", async () => {
  const { db, alice, eve, aliceStudent } = await world();
  await asUser(db, alice, "insert into public.student_profiles (student_id, data, updated_by) values ($1, '{}', $2)", [aliceStudent, alice]);
  await db.exec("alter table public.student_profiles disable row level security");
  const leaked = await asUser(db, eve, "select student_id from public.student_profiles where student_id = $1", [aliceStudent]);
  assert.notDeepEqual(leaked, [], "the outsider assertion would now fail because the row leaked");
});

test("guard: a read policy that drops can_read_student lets the view-only guardian write too, if update also used it", async () => {
  const { db, alice, mom, aliceStudent } = await world();
  await asUser(db, alice, "insert into public.student_profiles (student_id, data, updated_by) values ($1, '{}', $2)", [aliceStudent, alice]);
  await db.exec(`
    drop policy "Student profile: update" on public.student_profiles;
    create policy "broken" on public.student_profiles for update to authenticated using (public.can_read_student(student_id)) with check (public.can_read_student(student_id));
  `);
  const affected = await affectedAsUser(db, mom, "update public.student_profiles set data = '{\"academics\":{\"gpa\":4.0}}' where student_id = $1", [aliceStudent]);
  assert.notEqual(affected, 0, "the view-only-guardian-can't-write assertion would now fail");
});
