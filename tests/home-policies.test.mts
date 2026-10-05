/**
 * Row-level security for home addresses (supabase/migrations/20261005160000_home_locations.sql;
 * specs/product/home-and-distance.md), checked against real Postgres (PGlite + the auth stub,
 * tests/helpers/pg-auth.mts). The rule is own-row only: not even a guardian in the student's household reads the
 * student's home, and vice versa. Every access assertion runs as a signed-in user or anon, never as the
 * superuser. The last test breaks the policy on purpose and proves the first test's assertion would catch it. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const MIGRATIONS = ["20261005120000_accounts.sql", "20261005125000_households.sql", "20261005160000_home_locations.sql"];

interface World {
  db: AuthDb;
  alice: string; // student, own account
  mom: string; // guardian of alice, in the same household
  eve: string; // unrelated user
}

async function world(): Promise<World> {
  const db = await createAuthDb(MIGRATIONS);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student" });
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });

  await asUser(db, alice, "insert into public.students (user_id) values ($1)", [alice]);
  const [{ id: household }] = await asUser<{ id: string }>(db, mom, "insert into public.households (name) values ('Smiths') returning id");
  await asUser(db, mom, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household, mom]);
  const [{ inv }] = await asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'alice@example.com', 'student') as inv", [household]);
  await asUser(db, alice, "select public.accept_invitation($1)", [inv.token]);

  const [aliceStudent] = await asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]);
  const [check] = await asUser<{ can: boolean }>(db, mom, "select public.can_read_student($1) as can", [aliceStudent.id]);
  assert.equal(check.can, true, "setup sanity: mom reads alice's student record through the household");
  return { db, alice, mom, eve };
}

const INSERT_HOME = "insert into public.home_locations (user_id, lat, lng, label, place, zip) values ($1, 42.373, -71.109, '1 Main St, Cambridge, MA 02139', 'Cambridge, MA', '02139')";

test("home: own row only — a guardian in the same household, an outsider, and a signed-out visitor see nothing", async () => {
  const { db, alice, mom, eve } = await world();
  assert.equal(await affectedAsUser(db, alice, INSERT_HOME, [alice]), 1);

  assert.equal((await asUser(db, alice, "select label from public.home_locations")).length, 1, "alice reads her own home");
  assert.equal((await asUser(db, mom, "select label from public.home_locations")).length, 0, "mom can read alice's list, but never her home");
  assert.equal((await asUser(db, eve, "select label from public.home_locations")).length, 0);
  await assert.rejects(asUser(db, null, "select label from public.home_locations"), /permission denied/, "anon has no grant at all");

  // And the other way round: a student never sees a guardian's home either.
  assert.equal(await affectedAsUser(db, mom, INSERT_HOME, [mom]), 1);
  const aliceSees = await asUser<{ user_id: string }>(db, alice, "select user_id from public.home_locations");
  assert.deepEqual(
    aliceSees.map((r) => r.user_id),
    [alice],
  );
});

test("home: nobody writes another person's row, and a row can't be handed to someone else", async () => {
  const { db, alice, mom } = await world();
  await assert.rejects(asUser(db, mom, INSERT_HOME, [alice]), /row-level security/, "mom can't create a home for alice");
  assert.equal(await affectedAsUser(db, alice, INSERT_HOME, [alice]), 1);
  await assert.rejects(asUser(db, alice, "update public.home_locations set user_id = $1 where user_id = $2", [mom, alice]), /row-level security/);
  assert.equal(await affectedAsUser(db, mom, "update public.home_locations set label = 'moved' where user_id = $1", [alice]), 0, "mom can't edit alice's home");
  assert.equal(await affectedAsUser(db, mom, "delete from public.home_locations where user_id = $1", [alice]), 0, "mom can't remove alice's home");
  assert.equal((await asUser(db, alice, "select label from public.home_locations")).length, 1);
});

test("home: the owner replaces and removes their home; coordinates, the ZIP, and label lengths are checked", async () => {
  const { db, alice } = await world();
  assert.equal(await affectedAsUser(db, alice, INSERT_HOME, [alice]), 1);
  const upsert =
    "insert into public.home_locations (user_id, lat, lng, label, place, zip) values ($1, 40.713, -74.006, '1 Broadway, New York, NY 10004', 'New York, NY', '10004') " +
    "on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, label = excluded.label, place = excluded.place, zip = excluded.zip, updated_at = now()";
  assert.equal(await affectedAsUser(db, alice, upsert, [alice]), 1);
  const [row] = await asUser<{ place: string; zip: string }>(db, alice, "select place, zip from public.home_locations where user_id = $1", [alice]);
  assert.deepEqual(row, { place: "New York, NY", zip: "10004" });

  await assert.rejects(asUser(db, alice, "update public.home_locations set lat = 100 where user_id = $1", [alice]), /check constraint/);
  await assert.rejects(asUser(db, alice, "update public.home_locations set lng = -181 where user_id = $1", [alice]), /check constraint/);
  await assert.rejects(asUser(db, alice, "update public.home_locations set zip = 'abcde' where user_id = $1", [alice]), /check constraint/);
  await assert.rejects(asUser(db, alice, "update public.home_locations set label = '' where user_id = $1", [alice]), /check constraint/);
  assert.equal(await affectedAsUser(db, alice, "update public.home_locations set zip = null where user_id = $1", [alice]), 1, "a home with no ZIP is allowed");

  assert.equal(await affectedAsUser(db, alice, "delete from public.home_locations where user_id = $1", [alice]), 1);
  assert.equal((await asUser(db, alice, "select label from public.home_locations")).length, 0);
});

test("guard: a read policy open to every signed-in user leaks a home to the household, which the first test's assertion would catch", async () => {
  const { db, alice, mom } = await world();
  assert.equal(await affectedAsUser(db, alice, INSERT_HOME, [alice]), 1);
  await db.exec(`drop policy "Home: read own" on public.home_locations;
    create policy "Home: read any" on public.home_locations for select to authenticated using (true);`);
  assert.equal((await asUser(db, mom, "select label from public.home_locations")).length, 1, "with the policy opened, mom sees alice's home: exactly the leak the own-row test forbids");
});
