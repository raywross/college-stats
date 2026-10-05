/**
 * Row-level security for the household's home (supabase/migrations/20261005170000_household_limits_and_home.sql;
 * specs/product/home-and-distance.md), checked against real Postgres (PGlite + the auth stub,
 * tests/helpers/pg-auth.mts). The rule: every active member of the household reads, sets, and removes its one home;
 * nobody outside it can tell it exists. Every access assertion runs as a signed-in user or anon, never as the
 * superuser. The last test opens the policy on purpose and proves the first test's assertion would catch it. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const MIGRATIONS = [
  "20260928000000_dataset.sql",
  "20261002140000_school_staging.sql",
  "20261005120000_accounts.sql",
  "20261005125000_households.sql",
  "20261005130000_student_profiles.sql",
  "20261005140000_follows.sql",
  "20261005150000_lists.sql",
  "20261005160000_invitation_links.sql",
  "20261005170000_household_limits_and_home.sql",
];

interface World {
  db: AuthDb;
  alice: string; // student, own account
  mom: string; // guardian, created the household
  dad: string; // guardian, view only
  eve: string; // a guardian in another household
  household: string;
  evesHousehold: string;
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

const rpc = async <T,>(db: AuthDb, who: string, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;

async function world(): Promise<World> {
  const db = await createAuthDb(MIGRATIONS);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice" });
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Mom" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Dad" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve" });

  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  for (const [who, email, side] of [
    [alice, "alice@example.com", "student"],
    [dad, "dad@example.com", "guardian"],
  ] as const) {
    const inv = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, $2, $3)", [household, email, side]);
    await asUser(db, who, "select public.accept_invitation($1)", [inv.token]);
  }
  const evesHousehold = await rpc<string>(db, eve, "public.create_household('Eve''s', 'guardian')");
  return { db, alice, mom, dad, eve, household, evesHousehold };
}

const SET_HOME =
  "insert into public.household_homes (household_id, lat, lng, label, place, zip, set_by, set_by_name) values ($1, 42.373, -71.109, '1 Main St, Cambridge, MA 02139', 'Cambridge, MA', '02139', $2, $3)";

test("home: every active member reads the household's home; another household, and signed-out visitors, see nothing", async () => {
  const { db, alice, mom, dad, eve, household } = await world();
  assert.equal(await affectedAsUser(db, mom, SET_HOME, [household, mom, "Mom"]), 1);

  for (const who of [mom, dad, alice]) {
    const rows = await asUser<{ label: string; set_by_name: string }>(db, who, "select label, set_by_name from public.household_homes");
    assert.deepEqual(rows, [{ label: "1 Main St, Cambridge, MA 02139", set_by_name: "Mom" }]);
  }
  assert.deepEqual(await asUser(db, eve, "select label from public.household_homes"), [], "another household's guardian sees nothing");
  await assert.rejects(asUser(db, null, "select label from public.household_homes"), /permission denied/, "anon has no grant at all");
});

test("home: any member sets, replaces, or removes it, as themselves; nobody touches a household they're not in", async () => {
  const { db, alice, mom, dad, eve, household, evesHousehold } = await world();
  // A student sets it; a view-only guardian replaces it (the home is household data, not the student's).
  assert.equal(await affectedAsUser(db, alice, SET_HOME, [household, alice, "Alice"]), 1);
  const upsert =
    "insert into public.household_homes (household_id, lat, lng, label, place, zip, set_by, set_by_name) values ($1, 40.713, -74.006, '1 Broadway, New York, NY 10004', 'New York, NY', '10004', $2, $3) " +
    "on conflict (household_id) do update set lat = excluded.lat, lng = excluded.lng, label = excluded.label, place = excluded.place, zip = excluded.zip, set_by = excluded.set_by, set_by_name = excluded.set_by_name, updated_at = now()";
  assert.equal(await affectedAsUser(db, dad, upsert, [household, dad, "Dad"]), 1);
  const [row] = await asUser<{ place: string; set_by_name: string }>(db, alice, "select place, set_by_name from public.household_homes");
  assert.deepEqual(row, { place: "New York, NY", set_by_name: "Dad" });

  // set_by is always the person writing.
  await assert.rejects(asUser(db, alice, "update public.household_homes set set_by = $1 where household_id = $2", [mom, household]), /row-level security/);
  // Eve can't set a home for a household she isn't in, nor read or change the Smiths'.
  await assert.rejects(asUser(db, eve, SET_HOME, [household, eve, "Eve"]), /row-level security/);
  assert.equal(await affectedAsUser(db, eve, "update public.household_homes set label = 'moved' where household_id = $1", [household]), 0);
  assert.equal(await affectedAsUser(db, eve, "delete from public.household_homes where household_id = $1", [household]), 0);
  // Her own household's home is hers to set.
  assert.equal(await affectedAsUser(db, eve, SET_HOME, [evesHousehold, eve, "Eve"]), 1);
  assert.equal((await asUser(db, mom, "select label from public.household_homes")).length, 1, "Mom still sees only the Smiths' home");

  // Any member can remove it.
  assert.equal(await affectedAsUser(db, alice, "delete from public.household_homes where household_id = $1", [household]), 1);
  assert.deepEqual(await asUser(db, mom, "select label from public.household_homes"), []);
});

test("home: a member who leaves loses it at once, and it goes with the household when the household goes", async () => {
  const { db, alice, mom, household } = await world();
  assert.equal(await affectedAsUser(db, mom, SET_HOME, [household, mom, "Mom"]), 1);
  await asUser(db, alice, "select public.leave_household($1)", [household]);
  assert.deepEqual(await asUser(db, alice, "select label from public.household_homes"), []);
  assert.equal((await asUser(db, mom, "select label from public.household_homes")).length, 1);
  await db.query("delete from public.households where id = $1", [household]);
  assert.equal((await db.query("select 1 from public.household_homes where household_id = $1", [household])).rows.length, 0, "cascades with the household");
});

test("home: coordinates, the ZIP, and the labels are checked", async () => {
  const { db, mom, household } = await world();
  assert.equal(await affectedAsUser(db, mom, SET_HOME, [household, mom, "Mom"]), 1);
  await assert.rejects(asUser(db, mom, "update public.household_homes set lat = 100 where household_id = $1", [household]), /check constraint/);
  await assert.rejects(asUser(db, mom, "update public.household_homes set lng = -181 where household_id = $1", [household]), /check constraint/);
  await assert.rejects(asUser(db, mom, "update public.household_homes set zip = 'abcde' where household_id = $1", [household]), /check constraint/);
  await assert.rejects(asUser(db, mom, "update public.household_homes set label = '' where household_id = $1", [household]), /check constraint/);
  assert.equal(await affectedAsUser(db, mom, "update public.household_homes set zip = null, set_by_name = null where household_id = $1", [household]), 1, "a home without a ZIP or a name is allowed");
});

test("guard: a read policy open to every signed-in user leaks a home to another household, which the first test's assertion would catch", async () => {
  const { db, mom, eve, household } = await world();
  assert.equal(await affectedAsUser(db, mom, SET_HOME, [household, mom, "Mom"]), 1);
  await db.exec(`drop policy "Home: members read" on public.household_homes;
    create policy "Home: read any" on public.household_homes for select to authenticated using (true);`);
  assert.equal((await asUser(db, eve, "select label from public.household_homes")).length, 1, "with the policy opened, Eve sees the Smiths' home: exactly the leak the members-only test forbids");
});
