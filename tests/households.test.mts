/**
 * Households, edit access, the access log, and account deletion (supabase/migrations/20261005125000_households.sql;
 * specs/product/accounts.md), against real Postgres (PGlite + the auth stub in tests/helpers/pg-auth.mts). Every
 * access assertion runs as a signed-in user or anon. The "guard:" tests break a policy or function on purpose and
 * prove the checks notice. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

// With invitation links, the one-household rule, and the seat cap applied too: every flow here must still hold under them.
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
  alice: string; // student with her own account
  mom: string; // guardian, created the household
  dad: string; // guardian invited by Alice with edit access
  eve: string; // a guardian in another household
  household: string;
  aliceStudent: string;
  ben: string; // managed student Mom created
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

const rpc = async <T,>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;

async function invite(db: AuthDb, who: string, household: string, email: string, side: "guardian" | "student", student: string | null = null, canEdit = false) {
  return rpc<{ id: string; token: string }>(db, who, "public.create_invitation($1, $2, $3, $4, $5)", [household, email, side, student, canEdit]);
}

/** Built through the API as each user, the way the app does it. */
async function world(): Promise<World> {
  const db = await createAuthDb(MIGRATIONS);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice" });
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Mom" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Dad" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve" });

  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  const { token } = await invite(db, mom, household, "alice@example.com", "student");
  await asUser(db, alice, "select public.accept_invitation($1)", [token]);
  const aliceStudent = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const dadInv = await invite(db, alice, household, "dad@example.com", "guardian", null, true);
  await asUser(db, dad, "select public.accept_invitation($1)", [dadInv.token]);
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2030)", [household]);

  await rpc<string>(db, eve, "public.create_household('Eve''s', 'guardian')");
  return { db, alice, mom, dad, eve, household, aliceStudent, ben };
}

interface RosterRow {
  member_id: string;
  role: string;
  display_name: string | null;
  can_edit: boolean;
  managed: boolean;
  managed_by_me: boolean;
  is_me: boolean;
}

const roster = (db: AuthDb, who: string | null, household: string) => asUser<RosterRow>(db, who, "select * from public.household_roster($1)", [household]);
const names = (rows: RosterRow[]) => rows.map((r) => r.display_name).sort();

/** The checks the guard tests rely on: co-members see names, nobody else does. */
async function assertRosterPrivate(db: AuthDb, outsider: string, household: string) {
  assert.deepEqual(await roster(db, outsider, household), [], "roster leaked to a non-member");
}

test("household_roster: co-members see each other's names and roles, and nothing else about them", async () => {
  const { db, alice, mom, dad, household } = await world();
  for (const who of [alice, mom, dad]) assert.deepEqual(names(await roster(db, who, household)), ["Alice", "Ben", "Dad", "Mom"]);

  const rows = await roster(db, mom, household);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["can_edit", "display_name", "is_me", "joined", "managed", "managed_by_me", "member_id", "role", "student_id", "user_id"]);
  const text = JSON.stringify(rows);
  assert.ok(!/@example\.com/.test(text) && !/19(76|78)|2009/.test(text.replace(/"joined":"[^"]*"/g, "")), "roster must not carry emails or birth years");

  const byName = Object.fromEntries(rows.map((r) => [r.display_name, r]));
  assert.equal(byName.Mom.is_me, true);
  assert.equal(byName.Dad.can_edit, true);
  assert.equal(byName.Ben.managed, true);
  assert.equal(byName.Ben.managed_by_me, true);
  assert.equal(byName.Alice.managed, false);
  // Profiles stay own-row only: the names came through the function, not the table.
  assert.deepEqual((await asUser<{ id: string }>(db, mom, "select id from public.profiles")).map((r) => r.id), [mom]);
});

test("household_roster: a non-member sees nothing; signed-out visitors can't call it", async () => {
  const { db, eve, household } = await world();
  await assertRosterPrivate(db, eve, household);
  await assert.rejects(roster(db, null, household), /permission denied/);
});

test("create_household and add_managed_student: atomic, and only guardians add managed students", async () => {
  const { db, alice, eve, household } = await world();
  const zed = await createUser(db, { email: "zed@example.com", birthYear: 2009, roleHint: "student", displayName: "Zed" });
  const solo = await rpc<string>(db, zed, "public.create_household('Zed''s dorm', 'student')");
  const r = await roster(db, zed, solo);
  assert.deepEqual(r.map((m) => [m.role, m.display_name, m.is_me]), [["student", "Zed", true]]);
  // Alice is already in the Smiths: one household per account (tests/household-limits.test.mts has the rest).
  await assert.rejects(rpc(db, alice, "public.create_household('Alice''s dorm', 'student')"), /already_in_household/);
  await assert.rejects(rpc(db, alice, "public.add_managed_student($1, 'Sib')", [household]), /only_guardians_add_students/);
  await assert.rejects(rpc(db, eve, "public.add_managed_student($1, 'Sib')", [household]), /only_guardians_add_students/);
  await assert.rejects(rpc(db, eve, "public.create_household('   ', 'guardian')"), /invalid_name/);
});

test("a guardian removes a member and access stops at once; a student can't remove anyone", async () => {
  const { db, alice, mom, dad, household, aliceStudent } = await world();
  const dadRow = (await roster(db, mom, household)).find((m) => m.display_name === "Dad")!;
  const momRow = (await roster(db, mom, household)).find((m) => m.display_name === "Mom")!;

  assert.equal(await affectedAsUser(db, alice, "delete from public.household_members where id = $1", [momRow.member_id]), 0);
  assert.equal(await affectedAsUser(db, mom, "delete from public.household_members where id = $1", [dadRow.member_id]), 1);
  assert.deepEqual(await asUser(db, dad, "select id from public.students where id = $1", [aliceStudent]), []);
  await assertRosterPrivate(db, dad, household);
  assert.equal(await rpc<boolean>(db, dad, "public.can_read_student($1)", [aliceStudent]), false);
});

test("leaving takes effect at once, and the last person able to act closes the household", async () => {
  const { db, alice, mom, dad, household, aliceStudent, ben } = await world();
  await asUser(db, alice, "select public.leave_household($1)", [household]);
  assert.deepEqual(await asUser(db, mom, "select id from public.students where id = $1", [aliceStudent]), []);
  await assertRosterPrivate(db, alice, household);
  await assert.rejects(asUser(db, alice, "select public.leave_household($1)", [household]), /not_a_member/);

  const pending = await invite(db, mom, household, "aunt@example.com", "guardian");
  await asUser(db, dad, "select public.leave_household($1)", [household]);
  await asUser(db, mom, "select public.leave_household($1)", [household]);
  // Only managed Ben is left: the household is closed and its pending invitation revoked.
  const [h] = (await db.query<{ deleted_at: string | null }>("select deleted_at from public.households where id = $1", [household])).rows;
  assert.ok(h.deleted_at, "household closed");
  const [inv] = (await db.query<{ revoked_at: string | null }>("select revoked_at from public.invitations where id = $1", [pending.id])).rows;
  assert.ok(inv.revoked_at, "pending invitation revoked");
  // Mom still manages Ben herself.
  assert.equal(await rpc<boolean>(db, mom, "public.can_edit_student($1)", [ben]), true);
});

test("set_member_can_edit: the student grants and revokes; a guardian can't grant over a real student; a guardian can drop their own", async () => {
  const { db, alice, mom, dad, household, aliceStudent } = await world();
  const rows = await roster(db, alice, household);
  const momRow = rows.find((m) => m.display_name === "Mom")!;
  const dadRow = rows.find((m) => m.display_name === "Dad")!;

  await assert.rejects(asUser(db, dad, "select public.set_member_can_edit($1, true)", [momRow.member_id]), /only_student_grants_edit/);
  await assert.rejects(asUser(db, mom, "select public.set_member_can_edit($1, true)", [momRow.member_id]), /cannot_grant_self/);
  assert.equal(await affectedAsUser(db, mom, "update public.students set grad_year = 2027 where id = $1", [aliceStudent]), 0);

  await asUser(db, alice, "select public.set_member_can_edit($1, true)", [momRow.member_id]);
  assert.equal(await affectedAsUser(db, mom, "update public.students set grad_year = 2027 where id = $1", [aliceStudent]), 1);
  await asUser(db, alice, "select public.set_member_can_edit($1, false)", [momRow.member_id]);
  assert.equal(await affectedAsUser(db, mom, "update public.students set grad_year = 2028 where id = $1", [aliceStudent]), 0);

  await asUser(db, dad, "select public.set_member_can_edit($1, false)", [dadRow.member_id]);
  assert.equal(await rpc<boolean>(db, dad, "public.can_edit_student($1)", [aliceStudent]), false);
  // The membership table itself stays read-only to the API.
  await assert.rejects(asUser(db, dad, "update public.household_members set can_edit = true where id = $1", [dadRow.member_id]), /permission denied/);
});

test("set_member_can_edit: a guardian grants edit when every student is a managed record they created", async () => {
  const db = await createAuthDb(MIGRATIONS);
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, displayName: "Mom" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, displayName: "Dad" });
  const household = await rpc<string>(db, mom, "public.create_household('Home', 'guardian')");
  // With no students yet, nobody can grant edit (a student joining later must decide).
  const { token } = await invite(db, mom, household, "dad@example.com", "guardian");
  await asUser(db, dad, "select public.accept_invitation($1)", [token]);
  const dadRow = (await roster(db, mom, household)).find((m) => m.display_name === "Dad")!;
  await assert.rejects(asUser(db, mom, "select public.set_member_can_edit($1, true)", [dadRow.member_id]), /only_student_grants_edit/);

  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben')", [household]);
  await asUser(db, mom, "select public.set_member_can_edit($1, true)", [dadRow.member_id]);
  assert.equal(await rpc<boolean>(db, dad, "public.can_edit_student($1)", [ben]), true);
});

test("my_access_log: the student sees who viewed, by name; nobody else sees the student's log", async () => {
  const { db, alice, mom, eve, aliceStudent } = await world();
  await asUser(db, mom, "select public.log_access($1, 'lists')", [aliceStudent]);
  const log = await asUser<{ table_name: string; viewer_name: string }>(db, alice, "select table_name, viewer_name from public.my_access_log()");
  assert.deepEqual(log, [{ table_name: "lists", viewer_name: "Mom" }]);
  assert.deepEqual(await asUser(db, mom, "select * from public.my_access_log()"), []);
  assert.deepEqual(await asUser(db, eve, "select * from public.my_access_log()"), []);
});

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

test("a guardian's delete: the student's own data survives, a shared managed student passes to the other guardian", async () => {
  const { db, alice, mom, dad, household, aliceStudent, ben } = await world();
  const preview = await rpc<{ own_student: boolean; managed: { name: string; kept: boolean; kept_by: string }[] }>(db, mom, "public.account_deletion_preview()");
  assert.deepEqual(preview, { own_student: false, managed: [{ id: ben, name: "Ben", kept: true, kept_by: "Dad" }] });

  const result = await rpc<{ managed_kept: number; managed_deleted: number }>(db, mom, "public.delete_my_account()");
  assert.equal(result.managed_kept, 1);
  assert.equal(result.managed_deleted, 0);

  // Alice's record is untouched; Mom is gone from the household; Dad now manages Ben.
  assert.deepEqual((await asUser<{ id: string }>(db, alice, "select id from public.students where deleted_at is null")).map((r) => r.id), [aliceStudent]);
  assert.deepEqual(names(await roster(db, alice, household)), ["Alice", "Ben", "Dad"]);
  assert.deepEqual(await asUser(db, mom, "select id from public.students"), []);
  const [benRow] = (await db.query<{ managed_by: string; deleted_at: string | null }>("select managed_by, deleted_at from public.students where id = $1", [ben])).rows;
  assert.deepEqual(benRow, { managed_by: dad, deleted_at: null });
  const [p] = (await db.query<{ deleted_at: string | null }>("select deleted_at from public.profiles where id = $1", [mom])).rows;
  assert.ok(p.deleted_at);
  await assert.rejects(rpc(db, mom, "public.delete_my_account()"), /account_deleted/);
});

test("a managed student with no other guardian goes with its guardian; restore brings both back", async () => {
  const db = await createAuthDb(MIGRATIONS);
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, displayName: "Mom" });
  const household = await rpc<string>(db, mom, "public.create_household('Home', 'guardian')");
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben')", [household]);
  const pending = await invite(db, mom, household, "ben@example.com", "student", ben);

  const result = await rpc<{ managed_deleted: number; deleted_at: string }>(db, mom, "public.delete_my_account()");
  assert.equal(result.managed_deleted, 1);
  const [benRow] = (await db.query<{ deleted_at: string | null }>("select deleted_at from public.students where id = $1", [ben])).rows;
  assert.ok(benRow.deleted_at, "Ben deleted with Mom");
  const [h] = (await db.query<{ deleted_at: string | null }>("select deleted_at from public.households where id = $1", [household])).rows;
  assert.ok(h.deleted_at, "empty household closed");
  const [inv] = (await db.query<{ revoked_at: string | null }>("select revoked_at from public.invitations where id = $1", [pending.id])).rows;
  assert.ok(inv.revoked_at, "Mom's pending invitation revoked");

  await asUser(db, mom, "select public.restore_my_account()");
  const [after] = (await db.query<{ deleted_at: string | null }>("select deleted_at from public.students where id = $1", [ben])).rows;
  assert.equal(after.deleted_at, null);
  const [p] = (await db.query<{ deleted_at: string | null }>("select deleted_at from public.profiles where id = $1", [mom])).rows;
  assert.equal(p.deleted_at, null);
});

test("a student's delete removes their record from every guardian's view and leaves the household to the guardians", async () => {
  const { db, alice, mom, dad, household, aliceStudent } = await world();
  await asUser(db, alice, "select public.delete_my_account()");
  for (const who of [mom, dad]) assert.deepEqual(await asUser(db, who, "select id from public.students where id = $1", [aliceStudent]), []);
  assert.deepEqual(names(await roster(db, mom, household)), ["Ben", "Dad", "Mom"]);
  assert.deepEqual(await asUser(db, alice, "select * from public.my_access_log()"), []);
});

test("delete and restore are signed-in only", async () => {
  const { db } = await world();
  await assert.rejects(asUser(db, null, "select public.delete_my_account()"), /permission denied/);
  await assert.rejects(asUser(db, null, "select public.restore_my_account()"), /permission denied/);
  await assert.rejects(asUser(db, null, "select public.account_deletion_preview()"), /permission denied/);
});

/* ------------------------------------------------------------------ */
/* The checks above must fail when a policy is broken                  */
/* ------------------------------------------------------------------ */

test("guard: a roster without the membership check leaks names to a non-member, and the check catches it", async () => {
  const { db, eve, household } = await world();
  await db.exec(`
    create or replace function public.household_roster(p_household uuid)
    returns table (member_id uuid, role text, user_id uuid, student_id uuid, display_name text, can_edit boolean,
      managed boolean, managed_by_me boolean, is_me boolean, joined timestamptz)
    language sql stable security definer set search_path = '' as $$
      select m.id, m.role, m.user_id, m.student_id, p.display_name, m.can_edit, false, false, false, m.created
      from public.household_members m left join public.profiles p on p.id = m.user_id
      where m.household_id = p_household
    $$;`);
  await assert.rejects(assertRosterPrivate(db, eve, household), /roster leaked/);
});

test("guard: without the guardians-remove policy, a guardian can't remove anyone (the remove test would fail)", async () => {
  const { db, mom, household } = await world();
  await db.exec(`drop policy "Members: guardians remove" on public.household_members`);
  const dadRow = (await roster(db, mom, household)).find((m) => m.display_name === "Dad")!;
  assert.equal(await affectedAsUser(db, mom, "delete from public.household_members where id = $1", [dadRow.member_id]), 0);
});

test("guard: a remove policy open to any member lets a student remove a guardian, which the remove test forbids", async () => {
  const { db, alice, mom, household } = await world();
  await db.exec(`drop policy "Members: guardians remove" on public.household_members;
    create policy "broken" on public.household_members for delete to authenticated using (public.is_household_member(household_id));`);
  const momRow = (await roster(db, mom, household)).find((m) => m.display_name === "Mom")!;
  assert.equal(await affectedAsUser(db, alice, "delete from public.household_members where id = $1", [momRow.member_id]), 1);
});
