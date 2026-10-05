/**
 * Row-level security for accounts and households (supabase/migrations/20261005120000_accounts.sql;
 * specs/product/accounts.md), checked against real Postgres (PGlite + a stub of Supabase's auth schema,
 * tests/helpers/pg-auth.mts). Every access assertion runs as a signed-in user or as anon, never as the superuser.
 * The last tests break a policy on purpose and prove these checks notice. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const MIGRATION = "20261005120000_accounts.sql";

interface World {
  db: AuthDb;
  alice: string; // student
  mom: string; // guardian who created the household (view only)
  dad: string; // guardian invited by alice with edit access
  uncle: string; // guardian with a membership row that's only 'invited'
  eve: string; // a guardian in a different household
  household: string;
  aliceStudent: string;
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

/** Builds a household the way the app will: through the API as each user, not with superuser inserts. */
async function world(): Promise<World> {
  const db = await createAuthDb([MIGRATION]);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice" });
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Mom" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Dad" });
  const uncle = await createUser(db, { email: "uncle@example.com", birthYear: 1970, roleHint: "guardian" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });

  const { id: aliceStudent } = await one(asUser<{ id: string }>(db, alice, "insert into public.students (user_id, display_name) values ($1, 'Alice') returning id", [alice]));

  const { id: household } = await one(asUser<{ id: string }>(db, mom, "insert into public.households (name) values ('The Smiths') returning id"));
  await asUser(db, mom, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household, mom]);

  // Mom invites Alice; Alice accepts with her existing student record.
  const inv = await one(asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'Alice@Example.com', 'student') as inv", [household]));
  await asUser(db, alice, "select public.accept_invitation($1)", [inv.inv.token]);

  // Alice invites Dad with edit access; Dad accepts.
  const dadInv = await one(asUser<{ inv: { token: string } }>(db, alice, "select public.create_invitation($1, 'dad@example.com', 'guardian', null, true) as inv", [household]));
  await asUser(db, dad, "select public.accept_invitation($1)", [dadInv.inv.token]);

  // Uncle has a membership row that was never accepted.
  await db.query("insert into public.household_members (household_id, user_id, role, status, invited_email) values ($1, $2, 'guardian', 'invited', 'uncle@example.com')", [household, uncle]);

  // Eve runs her own household with nobody else in it.
  const { id: eveHousehold } = await one(asUser<{ id: string }>(db, eve, "insert into public.households (name) values ('Eve''s') returning id"));
  await asUser(db, eve, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [eveHousehold, eve]);

  return { db, alice, mom, dad, uncle, eve, household, aliceStudent };
}

/** Everything a guardian could use to learn about a student, which must all come back empty for `who`. */
async function assertSeesNothingAbout(db: AuthDb, who: string, student: string, household: string) {
  assert.deepEqual(await asUser(db, who, "select id from public.students where id = $1", [student]), [], "students row leaked");
  assert.deepEqual(await asUser(db, who, "select id from public.household_members where household_id = $1 and user_id is distinct from $2", [household, who]), [], "household members leaked");
  assert.deepEqual(await asUser(db, who, "select id from public.households where id = $1", [household]), [], "household leaked");
  assert.deepEqual(await asUser(db, who, "select id from public.invitations where household_id = $1", [household]), [], "invitations leaked");
  const [{ can }] = await asUser<{ can: boolean }>(db, who, "select public.can_read_student($1) as can", [student]);
  assert.equal(can, false, "can_read_student said yes");
}

test("a user reads and edits only their own profile; signed-out visitors can't touch profiles", async () => {
  const { db, alice, mom } = await world();
  const rows = await asUser<{ id: string; birth_year: number; role_hint: string; display_name: string }>(db, alice, "select id, birth_year, role_hint, display_name from public.profiles");
  assert.deepEqual(rows.map((r) => r.id), [alice]);
  assert.equal(rows[0].birth_year, 2009);
  assert.equal(rows[0].role_hint, "student");
  assert.equal(rows[0].display_name, "Alice");

  assert.equal(await affectedAsUser(db, alice, "update public.profiles set display_name = 'Hacked' where id = $1", [mom]), 0);
  assert.equal(await affectedAsUser(db, alice, "update public.profiles set display_name = 'Ali' where id = $1", [alice]), 1);
  await assert.rejects(asUser(db, null, "select id from public.profiles"), /permission denied/);
  await assert.rejects(asUser(db, null, "select id from public.students"), /permission denied/);
});

test("a guardian outside the household reads nothing about the student", async () => {
  const { db, eve, aliceStudent, household } = await world();
  await assertSeesNothingAbout(db, eve, aliceStudent, household);
  assert.equal(await affectedAsUser(db, eve, "update public.students set display_name = 'x' where id = $1", [aliceStudent]), 0);
});

test("an active guardian reads the student; an invited guardian who hasn't accepted doesn't", async () => {
  const { db, mom, uncle, aliceStudent, household } = await world();
  assert.deepEqual((await asUser<{ id: string }>(db, mom, "select id from public.students")).map((r) => r.id), [aliceStudent]);
  const members = await asUser(db, mom, "select role from public.household_members where household_id = $1 order by role", [household]);
  assert.ok(members.length >= 3, "co-members are visible to an active member");
  await assertSeesNothingAbout(db, uncle, aliceStudent, household);
});

test("leaving or deactivating a membership stops access at once", async () => {
  const { db, mom, dad, aliceStudent, household } = await world();
  assert.equal(await affectedAsUser(db, mom, "delete from public.household_members where household_id = $1 and user_id = $2", [household, mom]), 1);
  await assertSeesNothingAbout(db, mom, aliceStudent, household);

  // A student-side revoke (e.g. a future status change) is just as immediate.
  await db.query("update public.household_members set status = 'invited' where household_id = $1 and user_id = $2", [household, dad]);
  await assertSeesNothingAbout(db, dad, aliceStudent, household);
});

test("the student leaving the household cuts off every guardian", async () => {
  const { db, alice, mom, aliceStudent } = await world();
  assert.equal(await affectedAsUser(db, alice, "delete from public.household_members where student_id = $1", [aliceStudent]), 1);
  assert.deepEqual(await asUser(db, mom, "select id from public.students where id = $1", [aliceStudent]), []);
});

test("can_edit gates writes: a view-only guardian can't edit, an editing guardian can, nobody can take over the record", async () => {
  const { db, alice, mom, dad, eve, aliceStudent } = await world();
  assert.equal(await affectedAsUser(db, mom, "update public.students set grad_year = 2027 where id = $1", [aliceStudent]), 0);
  assert.equal(await affectedAsUser(db, dad, "update public.students set grad_year = 2027 where id = $1", [aliceStudent]), 1);
  assert.equal(await affectedAsUser(db, alice, "update public.students set grad_year = 2028 where id = $1", [aliceStudent]), 1);

  const canEdit = async (who: string) => (await one(asUser<{ v: boolean }>(db, who, "select public.can_edit_student($1) as v", [aliceStudent]))).v;
  assert.deepEqual([await canEdit(alice), await canEdit(mom), await canEdit(dad), await canEdit(eve)], [true, false, true, false]);

  await assert.rejects(asUser(db, dad, "update public.students set user_id = $2 where id = $1", [aliceStudent, dad]), /students_owner_immutable/);
  await assert.rejects(asUser(db, dad, "update public.students set managed_by = $2 where id = $1", [aliceStudent, dad]), /students_owner_immutable/);
  // A user can't create a record that claims someone else.
  await assert.rejects(asUser(db, eve, "insert into public.students (user_id) values ($1)", [alice]), /row-level security/);
});

test("nobody joins a household without an invitation", async () => {
  const { db, eve, household } = await world();
  await assert.rejects(
    asUser(db, eve, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household, eve]),
    /row-level security/,
  );
  await assert.rejects(asUser(db, eve, "select public.create_invitation($1, 'eve2@example.com', 'guardian')", [household]), /not_a_member/);
});

test("accept_invitation refuses unknown, expired, revoked, used, own, and wrong-email tokens", async () => {
  const { db, mom, eve, household } = await world();
  const invite = async (email: string) =>
    (await one(asUser<{ inv: { id: string; token: string } }>(db, mom, "select public.create_invitation($1, $2, 'guardian') as inv", [household, email]))).inv;
  const accept = (who: string, token: string) => asUser(db, who, "select public.accept_invitation($1)", [token]);

  await assert.rejects(accept(eve, "not-a-token"), /invitation_not_found/);

  const expired = await invite("eve@example.com");
  await db.query("update public.invitations set expires_at = now() - interval '1 minute' where id = $1", [expired.id]);
  await assert.rejects(accept(eve, expired.token), /invitation_expired/);

  const wrong = await invite("someone-else@example.com");
  await assert.rejects(accept(eve, wrong.token), /invitation_wrong_email/);

  const own = await invite("mom@example.com");
  await assert.rejects(accept(mom, own.token), /invitation_own/);

  const revoked = await invite("eve@example.com");
  assert.equal(await affectedAsUser(db, mom, "update public.invitations set revoked_at = now() where id = $1", [revoked.id]), 1);
  await assert.rejects(accept(eve, revoked.token), /invitation_revoked/);

  const good = await invite("EVE@example.com");
  await accept(eve, good.token);
  await assert.rejects(accept(eve, good.token), /invitation_used/);
  // A refused token left nothing behind; the good one made Eve a view-only guardian.
  const rows = await db.query<{ status: string; can_edit: boolean }>("select status, can_edit from public.household_members where household_id = $1 and user_id = $2", [household, eve]);
  assert.deepEqual(rows.rows, [{ status: "active", can_edit: false }]);
  // Only the hash is stored.
  const stored = await db.query<{ token_hash: string }>("select token_hash from public.invitations where id = $1", [good.id]);
  assert.notEqual(stored.rows[0].token_hash, good.token);
  // Signed-out visitors can preview a link, without the invited email.
  const preview = await one(asUser<{ p: Record<string, unknown> }>(db, null, "select public.invitation_preview($1) as p", [good.token]));
  assert.deepEqual(Object.keys(preview.p).sort(), ["expires_at", "household_name", "inviter_name", "side", "state"]);
  assert.equal(preview.p.state, "used");
  assert.equal(preview.p.inviter_name, "Mom");
});

test("a guardian's managed student is claimed by the child on accepting, and the guardian keeps household access", async () => {
  const { db, mom, household } = await world();
  const { id: managed } = await one(asUser<{ id: string }>(db, mom, "insert into public.students (managed_by, display_name) values ($1, 'Ben') returning id", [mom]));
  await asUser(db, mom, "insert into public.household_members (household_id, student_id, role) values ($1, $2, 'student')", [household, managed]);
  const { inv } = await one(asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'ben@example.com', 'student', $2) as inv", [household, managed]));

  const ben = await createUser(db, { email: "ben@example.com", birthYear: 2010 });
  await asUser(db, ben, "select public.accept_invitation($1)", [inv.token]);
  const row = await one(asUser<{ id: string; user_id: string; managed_by: string | null }>(db, ben, "select id, user_id, managed_by from public.students where user_id = $1", [ben]));
  assert.deepEqual(row, { id: managed, user_id: ben, managed_by: null });
  assert.deepEqual((await asUser<{ id: string }>(db, mom, "select id from public.students where id = $1", [managed])).map((r) => r.id), [managed]);
  // The guardian lost the managed-by edit right with the claim (mom's membership is view-only).
  assert.equal(await affectedAsUser(db, mom, "update public.students set grad_year = 2028 where id = $1", [managed]), 0);
});

test("soft delete: a student can mark their own record deleted, after which guardians lose it", async () => {
  const { db, alice, dad, aliceStudent } = await world();
  assert.equal(await affectedAsUser(db, alice, "update public.students set deleted_at = now() where id = $1", [aliceStudent]), 1);
  assert.deepEqual(await asUser(db, dad, "select id from public.students where id = $1", [aliceStudent]), []);
  // The owner still sees it (to restore within 30 days); app reads filter deleted_at.
  assert.deepEqual(await asUser(db, alice, "select id from public.students where id = $1 and deleted_at is null", [aliceStudent]), []);
  assert.equal((await asUser(db, alice, "select id from public.students where id = $1", [aliceStudent])).length, 1);
  assert.equal(await affectedAsUser(db, dad, "update public.students set deleted_at = null where id = $1", [aliceStudent]), 0);
});

test("access_log: guardian reads are logged and visible to the student, a student's own reads aren't", async () => {
  const { db, alice, mom, eve, aliceStudent } = await world();
  await asUser(db, mom, "select public.log_access($1, 'lists')", [aliceStudent]);
  await asUser(db, alice, "select public.log_access($1, 'lists')", [aliceStudent]);
  await asUser(db, eve, "select public.log_access($1, 'lists')", [aliceStudent]);
  const log = await asUser<{ viewer_id: string; table_name: string }>(db, alice, "select viewer_id, table_name from public.access_log");
  assert.deepEqual(log, [{ viewer_id: mom, table_name: "lists" }]);
  assert.deepEqual(await asUser(db, eve, "select id from public.access_log"), []);
  await assert.rejects(asUser(db, mom, "insert into public.access_log (viewer_id, student_id, table_name) values ($1, $2, 'x')", [mom, aliceStudent]), /permission denied/);
});

test("the 13+ rule holds in the database: under-13 sign-ups and profile edits are refused", async () => {
  const db = await createAuthDb([MIGRATION]);
  const year = new Date().getFullYear();
  await assert.rejects(createUser(db, { email: "kid@example.com", birthYear: year - 13 }), /birth_year_not_allowed/);
  const ok = await createUser(db, { email: "teen@example.com", birthYear: year - 14 });
  await assert.rejects(asUser(db, ok, "update public.profiles set birth_year = $2 where id = $1", [ok, year - 10]), /birth_year_not_allowed/);
  // Malformed metadata is dropped, never fatal.
  const odd = await createUser(db, { email: "odd@example.com", roleHint: "admin" });
  const [p] = (await db.query<{ birth_year: number | null; role_hint: string | null }>("select birth_year, role_hint from public.profiles where id = $1", [odd])).rows;
  assert.deepEqual(p, { birth_year: null, role_hint: null });
});

/* ------------------------------------------------------------------ */
/* The checks above must fail when a policy is broken                  */
/* ------------------------------------------------------------------ */

test("guard: with row-level security off on students, the outsider check catches the leak", async () => {
  const { db, eve, aliceStudent, household } = await world();
  await db.exec("alter table public.students disable row level security");
  await assert.rejects(assertSeesNothingAbout(db, eve, aliceStudent, household), /students row leaked/);
});

test("guard: a can_read_student that ignores membership status lets the invited guardian in, and the check catches it", async () => {
  const { db, uncle, aliceStudent, household } = await world();
  await db.exec(`
    create or replace function public.is_guardian_of(p_student uuid, p_need_edit boolean) returns boolean
    language sql stable security definer set search_path = '' as $$
      select exists (
        select 1 from public.household_members g
        join public.household_members m on m.household_id = g.household_id
        where g.user_id = auth.uid() and g.role = 'guardian' and (g.can_edit or not p_need_edit)
          and m.student_id = p_student and m.role = 'student' and m.status = 'active')
    $$;`);
  await assert.rejects(assertSeesNothingAbout(db, uncle, aliceStudent, household), /students row leaked/);
});

test("guard: a profiles policy that drops the owner check leaks other users' profiles", async () => {
  const { db, alice } = await world();
  await db.exec(`drop policy "Profiles: read own" on public.profiles; create policy "broken" on public.profiles for select to authenticated using (true);`);
  const ids = (await asUser<{ id: string }>(db, alice, "select id from public.profiles")).map((r) => r.id);
  assert.notDeepEqual(ids, [alice], "the own-profile assertion would now fail");
});
