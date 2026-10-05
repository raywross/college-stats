/**
 * One household per account and six seats (supabase/migrations/20261005170000_household_limits_and_home.sql;
 * specs/product/accounts.md "Built: one household, six seats"), against real Postgres (PGlite + the auth stub in
 * tests/helpers/pg-auth.mts). Every assertion about access runs as a signed-in user; `db.query` is setup or a
 * stand-in for the service role. The guard tests break each rule on purpose and show what the checks would miss.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { HOUSEHOLD_MAX_MEMBERS, householdSeats, type PendingInvitation, type RosterMember } from "../lib/household-rules.ts";

// The whole chain the limits sit on, including invitation links (whose accept_invitation this migration replaces).
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

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

const rpc = async <T,>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;

async function invite(db: AuthDb, who: string, household: string, email: string, side: "guardian" | "student", student: string | null = null, canEdit = false) {
  return rpc<{ id: string; token: string }>(db, who, "public.create_invitation($1, $2, $3, $4, $5)", [household, email, side, student, canEdit]);
}

const accept = (db: AuthDb, who: string, token: string) => asUser(db, who, "select public.accept_invitation($1)", [token]);

const names = (db: AuthDb, who: string, household: string) =>
  asUser<{ display_name: string }>(db, who, "select display_name from public.household_roster($1)", [household]).then((r) => r.map((m) => m.display_name).sort());

async function base() {
  const db = await createAuthDb(MIGRATIONS);
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Mom" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Dad" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice" });
  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  return { db, mom, dad, alice, household };
}

const setHome = (db: AuthDb, household: string, who: string, name: string) =>
  asUser(
    db,
    who,
    "insert into public.household_homes (household_id, lat, lng, label, place, zip, set_by, set_by_name) values ($1, 42.373, -71.109, '1 Main St, Cambridge, MA 02139', 'Cambridge, MA', '02139', $2, $3)",
    [household, who, name],
  );

/* ------------------------------------------------------------------ */
/* One household per account                                           */
/* ------------------------------------------------------------------ */

test("one household per account: a member can't start another, and can't accept an invitation elsewhere while others share theirs", async () => {
  const { db, mom, dad, alice, household } = await base();
  await assert.rejects(rpc(db, mom, "public.create_household('Second', 'guardian')"), /already_in_household/);
  assert.equal(await rpc<string | null>(db, mom, "public.my_household()"), household);
  assert.equal(await rpc<string | null>(db, alice, "public.my_household()"), null);

  // Dad starts his own household; both households invite Alice.
  const dads = await rpc<string>(db, dad, "public.create_household('Dad''s place', 'guardian')");
  const fromMom = await invite(db, mom, household, "alice@example.com", "student");
  const fromDad = await invite(db, dad, dads, "alice@example.com", "student");
  await accept(db, alice, fromMom.token);
  // Alice now shares a household with Mom, so Dad's invitation is refused and nothing about her changes.
  await assert.rejects(accept(db, alice, fromDad.token), /already_in_household/);
  assert.equal(await rpc<string | null>(db, alice, "public.my_household()"), household);
  assert.deepEqual(await names(db, dad, dads), ["Dad"]);

  // Dad, alone in his household, can accept Mom's: his is dissolved and he joins.
  const dadInv = await invite(db, mom, household, "dad@example.com", "guardian");
  await accept(db, dad, dadInv.token);
  assert.deepEqual(await names(db, mom, household), ["Alice", "Dad", "Mom"]);
  assert.equal(await rpc<string | null>(db, dad, "public.my_household()"), household);
  const [h] = (await db.query<{ deleted_at: string | null }>("select deleted_at from public.households where id = $1", [dads])).rows;
  assert.ok(h.deleted_at, "the one-person household is closed");
  const [inv] = (await db.query<{ revoked_at: string | null }>("select revoked_at from public.invitations where id = $1", [fromDad.id])).rows;
  assert.ok(inv.revoked_at, "its pending invitation is revoked");
});

test("a one-person household's home comes along when its member joins a household without one; an existing home stays", async () => {
  const { db, mom, dad, alice, household } = await base();
  const solo = await rpc<string>(db, alice, "public.create_household('Alice''s household', 'student')");
  await setHome(db, solo, alice, "Alice");
  await accept(db, alice, (await invite(db, mom, household, "alice@example.com", "student")).token);
  const homes = await asUser<{ household_id: string; place: string; set_by_name: string }>(db, mom, "select household_id, place, set_by_name from public.household_homes");
  assert.deepEqual(homes, [{ household_id: household, place: "Cambridge, MA", set_by_name: "Alice" }], "Mom's household now has Alice's home");
  assert.equal((await db.query("select 1 from public.household_homes where household_id = $1", [solo])).rows.length, 0, "the dissolved household's home row is gone");

  // Dad's one-person household has a home too, but Mom's household already has one: that one stays.
  const dads = await rpc<string>(db, dad, "public.create_household('Dad''s place', 'guardian')");
  await asUser(db, dad, "insert into public.household_homes (household_id, lat, lng, label, place, set_by, set_by_name) values ($1, 40.713, -74.006, '1 Broadway, New York, NY', 'New York, NY', $2, 'Dad')", [dads, dad]);
  await accept(db, dad, (await invite(db, mom, household, "dad@example.com", "guardian")).token);
  const after = await asUser<{ place: string }>(db, dad, "select place from public.household_homes");
  assert.deepEqual(after, [{ place: "Cambridge, MA" }]);
});

test("the trigger is the backstop: even a direct insert can't put a person in a second household", async () => {
  const { db, mom, alice, household } = await base();
  const other = (await db.query<{ id: string }>("insert into public.households (name) values ('Other') returning id")).rows[0].id;
  await assert.rejects(db.query("insert into public.household_members (household_id, user_id, role, status) values ($1, $2, 'guardian', 'active')", [other, mom]), /already_in_household/);
  await accept(db, alice, (await invite(db, mom, household, "alice@example.com", "student")).token);
  const student = (await db.query<{ id: string }>("select id from public.students where user_id = $1", [alice])).rows[0].id;
  await assert.rejects(db.query("insert into public.household_members (household_id, student_id, role, status) values ($1, $2, 'student', 'active')", [other, student]), /already_in_household/);
});

/* ------------------------------------------------------------------ */
/* Six seats                                                           */
/* ------------------------------------------------------------------ */

test("six seats: members and pending invitations count; cancelled or expired invitations and handovers don't", async () => {
  const { db, mom, household } = await base(); // 1 seat: Mom
  for (const name of ["Ann", "Ben", "Cal", "Dee"]) await rpc(db, mom, "public.add_managed_student($1, $2)", [household, name]); // 5
  const pending = await invite(db, mom, household, "aunt@example.com", "guardian"); // 6
  await assert.rejects(rpc(db, mom, "public.add_managed_student($1, 'Eve')", [household]), /household_full/);
  await assert.rejects(invite(db, mom, household, "uncle@example.com", "guardian"), /household_full/);

  // Handing a managed student over to their own account takes no new seat.
  const ben = (await one(asUser<{ student_id: string }>(db, mom, "select student_id from public.household_roster($1) where display_name = 'Ben'", [household]))).student_id;
  const handover = await invite(db, mom, household, "ben@example.com", "student", ben);
  assert.ok(handover.token);

  // Cancelling the pending invitation frees its seat; an expired one holds none either.
  await asUser(db, mom, "update public.invitations set revoked_at = now() where id = $1", [pending.id]);
  const again = await invite(db, mom, household, "uncle@example.com", "guardian");
  await db.query("update public.invitations set expires_at = now() - interval '1 day' where id = $1", [again.id]);
  await rpc(db, mom, "public.add_managed_student($1, 'Eve')", [household]); // 6 active members
  await assert.rejects(rpc(db, mom, "public.add_managed_student($1, 'Fay')", [household]), /household_full/);

  // At six members the handover still goes through: Ben's account takes the seat his record already holds.
  const benUser = await createUser(db, { email: "ben@example.com", birthYear: 2010, roleHint: "student", displayName: "Ben" });
  await accept(db, benUser, handover.token);
  assert.deepEqual(await names(db, mom, household), ["Ann", "Ben", "Cal", "Dee", "Eve", "Mom"]);
  assert.equal(await rpc<string | null>(db, benUser, "public.my_household()"), household);
  // A seventh active member is refused even on a direct insert.
  const seventh = await createUser(db, { email: "uncle@example.com", birthYear: 1970, roleHint: "guardian" });
  await assert.rejects(db.query("insert into public.household_members (household_id, user_id, role, status) values ($1, $2, 'guardian', 'active')", [household, seventh]), /household_full/);
});

test("a full household: linking a managed student to an account that already has its own record merges the two in one seat", async () => {
  const { db, mom, household } = await base();
  for (const name of ["Ann", "Ben", "Cal", "Dee", "Eve"]) await rpc(db, mom, "public.add_managed_student($1, $2)", [household, name]); // 6 active
  const ben = (await one(asUser<{ student_id: string }>(db, mom, "select student_id from public.household_roster($1) where display_name = 'Ben'", [household]))).student_id;
  const handover = await invite(db, mom, household, "ben@example.com", "student", ben);
  // Ben already has an account and his own record (made the first time he opened /me), in no household.
  const benUser = await createUser(db, { email: "ben@example.com", birthYear: 2010, roleHint: "student", displayName: "Ben" });
  const own = (await one(asUser<{ id: string }>(db, benUser, "insert into public.students (user_id, display_name) values ($1, 'Ben') returning id", [benUser]))).id;
  await accept(db, benUser, handover.token);
  const members = await asUser<{ student_id: string | null; display_name: string }>(db, mom, "select student_id, display_name from public.household_roster($1)", [household]);
  assert.equal(members.length, 6, "a swap, not a seventh member");
  assert.ok(members.some((m) => m.student_id === own), "Ben's own record took the managed record's seat");
  assert.ok(!members.some((m) => m.student_id === ben), "the managed record is gone");
  assert.equal(await rpc<string | null>(db, benUser, "public.my_household()"), household);
});

test("household_max_members() is six, and lib/household-rules.ts says the same", async () => {
  const { db, mom } = await base();
  assert.equal(await rpc<number>(db, mom, "public.household_max_members()"), HOUSEHOLD_MAX_MEMBERS);
  assert.equal(HOUSEHOLD_MAX_MEMBERS, 6);
  const sql = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "20261005170000_household_limits_and_home.sql"), "utf8");
  assert.match(sql, /create function public\.household_max_members\(\) returns integer\s+language sql\s+immutable\s+as \$\$ select 6 \$\$/);
});

test("householdSeats counts members and pending invitations against the cap, but not hand-overs of managed students", () => {
  const m = (n: number) => Array.from({ length: n }, (_, i) => ({ member_id: String(i) }) as RosterMember);
  const inv = (n: number, student: string | null = null) => Array.from({ length: n }, (_, i) => ({ id: String(i), student_id: student }) as PendingInvitation);
  assert.deepEqual(householdSeats({ members: m(2), invitations: [] }), { taken: 2, max: 6, full: false });
  assert.deepEqual(householdSeats({ members: m(4), invitations: inv(2) }), { taken: 6, max: 6, full: true });
  assert.deepEqual(householdSeats({ members: m(6), invitations: inv(1, "managed-record") }), { taken: 6, max: 6, full: true });
  assert.deepEqual(householdSeats({ members: m(5), invitations: [...inv(1, "managed-record"), ...inv(1)] }), { taken: 6, max: 6, full: true });
  assert.deepEqual(householdSeats({ members: m(0), invitations: inv(0) }), { taken: 0, max: 6, full: false });
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

test("guard: without the trigger, a seventh member and a second household both slip in through direct inserts", async () => {
  const { db, mom, household } = await base();
  for (const name of ["Ann", "Ben", "Cal", "Dee", "Eve"]) await rpc(db, mom, "public.add_managed_student($1, $2)", [household, name]);
  await db.exec("drop trigger household_members_check_limits on public.household_members");
  const seventh = await createUser(db, { email: "uncle@example.com", birthYear: 1970, roleHint: "guardian" });
  assert.equal((await db.query("insert into public.household_members (household_id, user_id, role, status) values ($1, $2, 'guardian', 'active')", [household, seventh])).affectedRows, 1);
  const other = (await db.query<{ id: string }>("insert into public.households (name) values ('Other') returning id")).rows[0].id;
  assert.equal((await db.query("insert into public.household_members (household_id, user_id, role, status) values ($1, $2, 'guardian', 'active')", [other, mom])).affectedRows, 1);
});

test("guard: a seat count that ignores pending invitations lets a seventh person be invited, which the seats test forbids", async () => {
  const { db, mom, household } = await base();
  for (const name of ["Ann", "Ben", "Cal", "Dee"]) await rpc(db, mom, "public.add_managed_student($1, $2)", [household, name]);
  await invite(db, mom, household, "aunt@example.com", "guardian"); // six seats taken
  await db.exec(`create or replace function public.household_seats_taken(p_household uuid) returns integer
    language sql stable security definer set search_path = '' as $$
      select (select count(*) from public.household_members m where m.household_id = p_household and m.status = 'active')::integer
    $$;`);
  const extra = await invite(db, mom, household, "uncle@example.com", "guardian");
  assert.ok(extra.token, "with invitations uncounted, the seventh invitation goes out");
});

test("guard: accept_invitation without the one-household check puts a person in two households (and the first test's assertion would catch it)", async () => {
  const { db, mom, dad, alice, household } = await base();
  const dads = await rpc<string>(db, dad, "public.create_household('Dad''s place', 'guardian')");
  await accept(db, alice, (await invite(db, mom, household, "alice@example.com", "student")).token);
  const fromDad = await invite(db, dad, dads, "alice@example.com", "student");
  // Back to the pre-limits behavior: the function no longer finds a current household, and the trigger is gone.
  await db.exec("drop trigger household_members_check_limits on public.household_members");
  await db.exec(`create or replace function public.household_of(p_user uuid) returns uuid
    language sql stable security definer set search_path = '' as $$ select null::uuid $$;`);
  await accept(db, alice, fromDad.token);
  const memberships = (await db.query<{ household_id: string }>("select m.household_id from public.household_members m join public.students s on s.id = m.student_id where s.user_id = $1 and m.status = 'active'", [alice])).rows;
  assert.deepEqual(memberships.map((m) => m.household_id).sort(), [household, dads].sort(), "Alice is active in both households: the state the rule forbids");
  assert.equal((await asUser(db, alice, "select 1 from public.household_roster($1)", [dads])).length, 2, "and she reads Dad's household too");
});
