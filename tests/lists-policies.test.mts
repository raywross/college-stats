/**
 * Row-level security and the follows trigger for saved lists (supabase/migrations/20261005150000_lists.sql;
 * specs/product/saved-lists.md), checked against real Postgres (PGlite + the auth stub, tests/helpers/pg-auth.mts).
 * Access assertions run as a signed-in user or anon, never as the superuser. The last test breaks a policy on
 * purpose and proves the check notices. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const MIGRATIONS = [
  "20260928000000_dataset.sql",
  "20261002140000_school_staging.sql",
  "20261005120000_accounts.sql",
  "20261005125000_households.sql",
  "20261005140000_follows.sql",
  "20261005150000_lists.sql",
];

interface World {
  db: AuthDb;
  alice: string; // student, own account
  mom: string; // guardian of alice, with edit access
  dad: string; // guardian of alice, view only
  eve: string; // unrelated user
  aliceList: string;
}

async function world(): Promise<World> {
  const db = await createAuthDb(MIGRATIONS);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student" });
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });

  await asUser(db, alice, "insert into public.students (user_id) values ($1)", [alice]);
  const [{ id: household }] = await asUser<{ id: string }>(db, mom, "insert into public.households (name) values ('Smiths') returning id");
  await asUser(db, mom, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household, mom]);

  const [{ inv: invDad }] = await asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'dad@example.com', 'guardian') as inv", [household]);
  await asUser(db, dad, "select public.accept_invitation($1)", [invDad.token]);

  const [{ inv: invMom }] = await asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'alice@example.com', 'student') as inv", [household]);
  await asUser(db, alice, "select public.accept_invitation($1)", [invMom.token]);
  // Mom gets edit access (a student invite defaults can_edit false on the guardian side; grant it directly here,
  // mirroring what set_member_can_edit would do, to keep this setup self-contained).
  const [momMember] = await asUser<{ id: string }>(db, alice, "select id from public.household_members where household_id = $1 and user_id = $2", [household, mom]);
  await asUser(db, alice, "select public.set_member_can_edit($1, true)", [momMember.id]);

  const [aliceId] = await asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]);
  const [check] = await asUser<{ can: boolean }>(db, mom, "select public.can_edit_student($1) as can", [aliceId.id]);
  assert.equal(check.can, true, "setup sanity: mom has edit access to alice's record");
  const [{ id: aliceList }] = await asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [aliceId.id]);
  return { db, alice, mom, dad, eve, aliceList };
}

/* ------------------------------------------------------------------ */
/* Lists and items                                                     */
/* ------------------------------------------------------------------ */

test("lists: the owner reads and edits; a view-only guardian reads but can't edit; an outsider sees nothing", async () => {
  const { db, alice, mom, dad, eve, aliceList } = await world();
  assert.equal((await asUser(db, alice, "select id from public.lists where id = $1", [aliceList])).length, 1);
  assert.equal((await asUser(db, mom, "select id from public.lists where id = $1", [aliceList])).length, 1, "mom has edit access via the household");
  assert.equal((await asUser(db, dad, "select id from public.lists where id = $1", [aliceList])).length, 1, "dad can read as a guardian");
  assert.equal((await asUser(db, eve, "select id from public.lists where id = $1", [aliceList])).length, 0);

  // Mom (can_edit) can add an item; dad (view only) can't.
  assert.equal(await affectedAsUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [aliceList]), 1);
  await assert.rejects(asUser(db, dad, "insert into public.list_items (list_id, unit_id) values ($1, '166683')", [aliceList]), /row-level security/);
  await assert.rejects(asUser(db, eve, "insert into public.list_items (list_id, unit_id) values ($1, '110635')", [aliceList]), /row-level security/);

  const [item] = await asUser<{ id: string }>(db, alice, "select id from public.list_items where unit_id = '243744'");
  assert.equal(await affectedAsUser(db, dad, "update public.list_items set category = 'reach' where id = $1", [item.id]), 0, "view-only guardian can't edit items");
  assert.equal(await affectedAsUser(db, mom, "update public.list_items set category = 'reach' where id = $1", [item.id]), 1);
});

test("lists: the default list can't be deleted; an extra list can", async () => {
  const { db, alice, aliceList } = await world();
  assert.equal(await affectedAsUser(db, alice, "delete from public.lists where id = $1", [aliceList]), 0);
  const [{ id: extra }] = await asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name) select student_id, 'Nursing' from public.lists where id = $1 returning id", [aliceList]);
  assert.equal(await affectedAsUser(db, alice, "delete from public.lists where id = $1", [extra]), 1);
});

/* ------------------------------------------------------------------ */
/* Notes: private is author-only, including hidden from a guardian     */
/* ------------------------------------------------------------------ */

test("notes: a non-private note is readable by anyone who can read the student; a private note is author-only", async () => {
  const { db, alice, mom, dad, eve, aliceList } = await world();
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [aliceList]);
  const [item] = await asUser<{ id: string }>(db, alice, "select id from public.list_items where unit_id = '243744'");

  await asUser(db, alice, "insert into public.list_notes (item_id, body, private) values ($1, 'Public note', false)", [item.id]);
  await asUser(db, alice, "insert into public.list_notes (item_id, body, private) values ($1, 'My private thought', true)", [item.id]);
  await asUser(db, mom, "insert into public.list_notes (item_id, body, private) values ($1, 'Guardian note', false)", [item.id]);

  const bodiesAsMom = (await asUser<{ body: string }>(db, mom, "select body from public.list_notes where item_id = $1 order by body", [item.id])).map((r) => r.body);
  assert.deepEqual(bodiesAsMom, ["Guardian note", "Public note"], "mom (a guardian, not the author) never sees alice's private note");

  const bodiesAsAlice = (await asUser<{ body: string }>(db, alice, "select body from public.list_notes where item_id = $1 order by body", [item.id])).map((r) => r.body);
  assert.deepEqual(bodiesAsAlice, ["Guardian note", "My private thought", "Public note"], "alice sees her own private note plus everyone's public ones");

  assert.deepEqual(await asUser(db, dad, "select body from public.list_notes where item_id = $1 order by body", [item.id]), [
    { body: "Guardian note" },
    { body: "Public note" },
  ]);
  assert.deepEqual(await asUser(db, eve, "select id from public.list_notes where item_id = $1", [item.id]), []);

  // Only the author may write or delete their own note; a view-only guardian can't add one at all.
  await assert.rejects(asUser(db, dad, "insert into public.list_notes (item_id, body) values ($1, 'nope')", [item.id]), /row-level security/);
  assert.equal(await affectedAsUser(db, mom, "delete from public.list_notes where body = 'My private thought'"), 0, "mom can't delete alice's note");
});

/* ------------------------------------------------------------------ */
/* Follow trigger                                                      */
/* ------------------------------------------------------------------ */

const followOf = async (db: AuthDb, who: string, unitId: string) =>
  (await asUser<{ source: string }>(db, who, "select source from public.follows where user_id = $1 and unit_id = $2", [who, unitId]))[0]?.source ?? null;

test("follow trigger: adding to a list follows it for the student (not the guardian who added it)", async () => {
  const { db, alice, mom, aliceList } = await world();
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [aliceList]);
  assert.equal(await followOf(db, alice, "243744"), "list");
  assert.equal(await followOf(db, mom, "243744"), null, "a guardian adding to a student's list doesn't make the guardian follow it");
});

test("follow trigger: removing the last list that has a college unfollows it, but a manual follow survives", async () => {
  const { db, alice, aliceList } = await world();
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744'), ($1, '166683')", [aliceList]);
  assert.equal(await followOf(db, alice, "243744"), "list");

  // A second list with the same college: removing it from one list doesn't unfollow while the other still has it.
  const [{ id: extra }] = await asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name) select student_id, 'Extra' from public.lists where id = $1 returning id", [aliceList]);
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [extra]);
  await asUser(db, alice, "delete from public.list_items where list_id = $1 and unit_id = '243744'", [aliceList]);
  assert.equal(await followOf(db, alice, "243744"), "list", "still on the extra list");
  await asUser(db, alice, "delete from public.list_items where list_id = $1 and unit_id = '243744'", [extra]);
  assert.equal(await followOf(db, alice, "243744"), null, "removed from every list: unfollowed");

  // 166683: upgrade to a manual follow, then remove it from the list — manual survives.
  await asUser(db, alice, "update public.follows set source = 'manual' where unit_id = '166683'");
  await asUser(db, alice, "delete from public.list_items where list_id = $1 and unit_id = '166683'", [aliceList]);
  assert.equal(await followOf(db, alice, "166683"), "manual", "a manual follow is never removed by the trigger");
});

test("follow trigger: deleting a whole extra list unfollows the colleges that were only on it", async () => {
  const { db, alice, aliceList } = await world();
  const [{ id: extra }] = await asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name) select student_id, 'Extra' from public.lists where id = $1 returning id", [aliceList]);
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744'), ($1, '166683')", [extra]);
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '166683')", [aliceList]);
  assert.equal(await followOf(db, alice, "243744"), "list");
  // The items go by cascade, after the list row itself: the trigger must still find whose list it was.
  await asUser(db, alice, "delete from public.lists where id = $1", [extra]);
  assert.equal(await followOf(db, alice, "243744"), null, "only on the deleted list: unfollowed");
  assert.equal(await followOf(db, alice, "166683"), "list", "still on the default list: still followed");
});

test("follow trigger: a manual follow already in place is never downgraded by adding the college to a list", async () => {
  const { db, alice, aliceList } = await world();
  await asUser(db, alice, "insert into public.follows (unit_id, source) values ('190415', 'manual')");
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '190415')", [aliceList]);
  assert.equal(await followOf(db, alice, "190415"), "manual");
});

test("follow trigger: a managed student (no user account) creates no follows", async () => {
  const { db, mom } = await world();
  const [{ id: household2 }] = await asUser<{ id: string }>(db, mom, "insert into public.households (name) values ('Smiths 2') returning id");
  await asUser(db, mom, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household2, mom]);
  const [{ id: managed }] = await asUser<{ id: string }>(db, mom, "insert into public.students (managed_by) values ($1) returning id", [mom]);
  await asUser(db, mom, "insert into public.household_members (household_id, student_id, role) values ($1, $2, 'student')", [household2, managed]);
  const [{ id: list }] = await asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [managed]);
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [list]);
  assert.deepEqual(await asUser(db, mom, "select user_id from public.follows where unit_id = '243744'"), [], "nobody follows on a managed student's behalf");
});

/* ------------------------------------------------------------------ */
/* Share link                                                          */
/* ------------------------------------------------------------------ */

test("share: an anon visitor with the token sees colleges and category/round only — no notes, status, or outcome", async () => {
  const { db, alice, dad, aliceList } = await world();
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id, category, status, outcome, round) values ($1, '243744', 'reach', 'decided', 'admitted', 'rea')", [aliceList]);
  await asUser(db, alice, "insert into public.list_notes (item_id, body) select id, 'secret' from public.list_items where unit_id = '243744'");

  const [{ token }] = await asUser<{ token: string }>(db, alice, "select public.set_list_share($1, true) as token", [aliceList]);
  assert.match(token, /^[0-9a-f]{64}$/);

  const [preview] = await asUser<{ preview: { list_name: string; items: { unit_id: string; category: string; round: string }[] } }>(
    db,
    null,
    "select public.list_share_preview($1) as preview",
    [token],
  );
  assert.equal(preview.preview.list_name, "My list");
  assert.deepEqual(preview.preview.items, [{ unit_id: "243744", category: "reach", round: "rea" }]);
  assert.equal(JSON.stringify(preview.preview).includes("secret"), false);
  assert.equal(JSON.stringify(preview.preview).includes("admitted"), false);
  assert.equal(JSON.stringify(preview.preview).includes("decided"), false);

  // Turning sharing off invalidates the token at once.
  await asUser(db, alice, "select public.set_list_share($1, false)", [aliceList]);
  const [after] = await asUser<{ preview: unknown }>(db, null, "select public.list_share_preview($1) as preview", [token]);
  assert.equal(after.preview, null);

  // A view-only guardian can't turn sharing on; an outsider can't guess a working token.
  await assert.rejects(asUser(db, dad, "select public.set_list_share($1, true)", [aliceList]), /not_allowed/);
  const [bad] = await asUser<{ preview: unknown }>(db, null, "select public.list_share_preview($1) as preview", ["0".repeat(64)]);
  assert.equal(bad.preview, null);
});

/* ------------------------------------------------------------------ */
/* Guard: the checks above must fail when a policy is removed          */
/* ------------------------------------------------------------------ */

test("guard: a list_notes policy that drops the private check lets a guardian read the student's private note, and the test catches it", async () => {
  const { db, alice, mom, aliceList } = await world();
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [aliceList]);
  const [item] = await asUser<{ id: string }>(db, alice, "select id from public.list_items where unit_id = '243744'");
  await asUser(db, alice, "insert into public.list_notes (item_id, body, private) values ($1, 'secret plan', true)", [item.id]);

  assert.deepEqual(await asUser(db, mom, "select body from public.list_notes where item_id = $1", [item.id]), [], "sanity: mom can't see it before the policy is broken");

  await db.exec(`drop policy "Notes: read" on public.list_notes; create policy "broken" on public.list_notes for select to authenticated using (true);`);
  const leaked = await asUser<{ body: string }>(db, mom, "select body from public.list_notes where item_id = $1", [item.id]);
  assert.deepEqual(leaked, [{ body: "secret plan" }], "with the policy dropped, the leak the test above is guarding against actually happens");
});

/* ------------------------------------------------------------------ */
/* The tracking columns (20261006150000_household_hub.sql)             */
/* ------------------------------------------------------------------ */

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");

/** PGlite with the auth stub and every migration, in order (as tests/household-hub-policies.test.mts boots it). */
async function bootAll(): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

test("tracking columns: defaults on a new item; the student and an edit-access guardian set them, a view-only guardian can't", async () => {
  const db = await bootAll();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student" });
  const [{ household }] = await asUser<{ household: string }>(db, mom, "select public.create_household('The Smiths', 'guardian') as household");
  for (const [who, email, side] of [[dad, "dad@example.com", "guardian"], [alice, "alice@example.com", "student"]] as const) {
    const [{ inv }] = await asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, $2, $3) as inv", [household, email, side]);
    await asUser(db, who, "select public.accept_invitation($1)", [inv.token]);
  }
  const [momMember] = await asUser<{ id: string }>(db, alice, "select id from public.household_members where household_id = $1 and user_id = $2", [household, mom]);
  await asUser(db, alice, "select public.set_member_can_edit($1, true)", [momMember.id]);
  const [{ id: student }] = await asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]);
  const [{ id: list }] = await asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]);
  const [item] = await asUser<{ id: string; updates: boolean; visited_on: string | null; follows_social: boolean }>(
    db,
    alice,
    "insert into public.list_items (list_id, unit_id) values ($1, '243744') returning id, updates, visited_on, follows_social",
    [list],
  );
  assert.deepEqual({ updates: item.updates, visited_on: item.visited_on, follows_social: item.follows_social }, { updates: true, visited_on: null, follows_social: false });

  const set = "update public.list_items set updates = false, visited_on = '2026-09-20', follows_social = true where id = $1";
  assert.equal(await affectedAsUser(db, dad, set, [item.id]), 0, "a view-only guardian can't change the tracking row");
  assert.equal(await affectedAsUser(db, mom, set, [item.id]), 1, "an edit-access guardian can");
  assert.equal(await affectedAsUser(db, alice, "update public.list_items set visited_on = null, follows_social = false where id = $1", [item.id]), 1, "and so can the student");
  const [after] = await asUser<{ updates: boolean; visited_on: string | null; follows_social: boolean }>(db, dad, "select updates, visited_on, follows_social from public.list_items where id = $1", [item.id]);
  assert.deepEqual({ ...after }, { updates: false, visited_on: null, follows_social: false }, "the view-only guardian still reads the row");
  await assert.rejects(asUser(db, alice, "update public.list_items set visited_on = 'last spring' where id = $1", [item.id]), /invalid input syntax for type date/);
});
