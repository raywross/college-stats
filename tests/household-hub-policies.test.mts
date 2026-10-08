/**
 * The household hub's schema (supabase/migrations/20261006150000_household_hub.sql; specs/product/household-hub.md),
 * against real Postgres: PGlite with the auth stub from tests/helpers/pg-auth.mts and every migration in
 * supabase/migrations applied in order. Every assertion about access runs as a signed-in user; `db.query` is setup
 * or a stand-in for the service role (the invite Edge Function). The guard tests at the end break a rule on purpose
 * and show the checks notice. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, affectedAsUser, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const HUB = "20261006150000_household_hub.sql";
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** Boots PGlite with the auth stub and applies every migration in order, stopping before `stopBefore` if given. */
async function boot(stopBefore?: string): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL) {
    if (name === stopBefore) break;
    await db.exec(readFileSync(join(DIR, name), "utf8"));
  }
  // Supabase grants this on its own `extensions` schema (the high school search uses pg_trgm); PGlite's is new.
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

const applyHub = (db: AuthDb) => db.exec(readFileSync(join(DIR, HUB), "utf8"));

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

const rpc = async <T,>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;

interface Inv {
  id: string;
  token: string;
  expires_at: string;
  student_id: string | null;
}

const invite = (
  db: AuthDb,
  who: string,
  household: string,
  email: string,
  side: "guardian" | "student",
  opts: { student?: string | null; canEdit?: boolean; name?: string | null; phone?: string | null; gradYear?: number | null } = {},
) =>
  rpc<Inv>(db, who, "public.create_invitation($1, $2, $3, $4, $5, $6, $7, $8)", [
    household,
    email,
    side,
    opts.student ?? null,
    opts.canEdit ?? false,
    opts.name ?? null,
    opts.phone ?? null,
    opts.gradYear ?? null,
  ]);

const accept = (db: AuthDb, who: string, token: string) => rpc<string>(db, who, "public.accept_invitation($1)", [token]);

const follows = async (db: AuthDb, who: string) =>
  (await asUser<{ unit_id: string }>(db, who, "select unit_id from public.follows where user_id = $1 order by unit_id", [who])).map((r) => r.unit_id);

const tokenOf = async (db: AuthDb, invitation: string) =>
  (await db.query<{ token: string | null }>("select token from public.invitations where id = $1", [invitation])).rows[0].token;

/**
 * The Smiths: Mom (guardian, created the household), Dad (guardian, view only), Alice (student with her own account),
 * and Eve, who isn't in it.
 */
async function world() {
  const db = await boot();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Sam Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve" });
  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  await accept(db, dad, (await invite(db, mom, household, "dad@example.com", "guardian")).token);
  await accept(db, alice, (await invite(db, mom, household, "alice@example.com", "student")).token);
  const aliceStudent = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const aliceList = (
    await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [aliceStudent]))
  ).id;
  return { db, mom, dad, alice, eve, household, aliceStudent, aliceList };
}

/** Mom's own (user-owned) default list, created the way the app will (insert ... returning, as her). */
const momList = async (db: AuthDb, mom: string) =>
  (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (user_id, name, is_default) values ($1, 'My list', true) returning id", [mom]))).id;

/* ------------------------------------------------------------------ */
/* Lists: a guardian's own list                                        */
/* ------------------------------------------------------------------ */

test("a guardian's own list: the household reads it, only the guardian writes it, outsiders see nothing", async () => {
  const { db, mom, dad, alice, eve } = await world();
  const list = await momList(db, mom);
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [list]);
  const item = (await one(asUser<{ id: string }>(db, mom, "select id from public.list_items where list_id = $1", [list]))).id;
  await asUser(db, mom, "insert into public.list_notes (item_id, body) values ($1, 'Loved the campus')", [item]);
  await asUser(db, mom, "insert into public.list_notes (item_id, body, private) values ($1, 'Too pricey?', true)", [item]);

  for (const who of [mom, dad, alice]) {
    assert.equal((await asUser(db, who, "select id from public.lists where id = $1", [list])).length, 1, "household members read the list");
    assert.equal((await asUser(db, who, "select id from public.list_items where list_id = $1", [list])).length, 1, "and its items");
  }
  assert.deepEqual(
    (await asUser<{ body: string }>(db, alice, "select body from public.list_notes where item_id = $1", [item])).map((r) => r.body),
    ["Loved the campus"],
    "the student reads the guardian's public note, never the private one",
  );
  assert.deepEqual(await asUser(db, eve, "select id from public.lists where id = $1", [list]), []);
  assert.deepEqual(await asUser(db, eve, "select id from public.list_items where list_id = $1", [list]), []);
  assert.deepEqual(await asUser(db, eve, "select id from public.list_notes where item_id = $1", [item]), []);

  // Writing: the owner only. Not the other guardian, not the student, not an outsider.
  for (const who of [dad, alice, eve]) {
    await assert.rejects(asUser(db, who, "insert into public.list_items (list_id, unit_id) values ($1, '166683')", [list]), /row-level security/);
    assert.equal(await affectedAsUser(db, who, "update public.list_items set category = 'reach' where id = $1", [item]), 0);
    assert.equal(await affectedAsUser(db, who, "update public.lists set name = 'Mine now' where id = $1", [list]), 0);
    assert.equal(await affectedAsUser(db, who, "delete from public.list_items where id = $1", [item]), 0);
    await assert.rejects(asUser(db, who, "insert into public.list_notes (item_id, body) values ($1, 'hi')", [item]), /row-level security/);
    await assert.rejects(asUser(db, who, "select public.set_list_share($1, true)", [list]), /not_allowed/);
  }
  assert.equal(await affectedAsUser(db, mom, "update public.list_items set category = 'reach', updates = false, visited_on = '2026-09-20', follows_social = true where id = $1", [item]), 1);
  assert.match(await rpc<string>(db, mom, "public.set_list_share($1, true)", [list]), /^[0-9a-f]{64}$/);

  // Nobody creates a list in someone else's name, and the default can't be deleted.
  await assert.rejects(asUser(db, dad, "insert into public.lists (user_id, name) values ($1, 'For Mom')", [mom]), /row-level security/);
  assert.equal(await affectedAsUser(db, mom, "delete from public.lists where id = $1", [list]), 0);
  const extra = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (user_id, name) values ($1, 'Maybe') returning id", [mom]))).id;
  assert.equal(await affectedAsUser(db, mom, "delete from public.lists where id = $1", [extra]), 1);

  // Once the guardian leaves the household, its members stop seeing the list.
  await asUser(db, mom, "select public.leave_household((select public.my_household()))");
  assert.deepEqual(await asUser(db, alice, "select id from public.lists where id = $1", [list]), []);
  assert.equal((await asUser(db, mom, "select id from public.lists where id = $1", [list])).length, 1, "the owner still does");
});

test("a student's list keeps its rules: student and edit-access guardian write, view-only guardian reads, outsider nothing", async () => {
  const { db, mom, dad, alice, eve, household, aliceList } = await world();
  const momMember = (await one(asUser<{ member_id: string }>(db, alice, "select member_id from public.household_roster($1) where user_id = $2", [household, mom]))).member_id;
  await asUser(db, alice, "select public.set_member_can_edit($1, true)", [momMember]);

  assert.equal(await affectedAsUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [aliceList]), 1);
  assert.equal(await affectedAsUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '166683')", [aliceList]), 1);
  await assert.rejects(asUser(db, dad, "insert into public.list_items (list_id, unit_id) values ($1, '110635')", [aliceList]), /row-level security/);
  await assert.rejects(asUser(db, eve, "insert into public.list_items (list_id, unit_id) values ($1, '110635')", [aliceList]), /row-level security/);
  assert.equal((await asUser(db, dad, "select id from public.list_items where list_id = $1", [aliceList])).length, 2);
  assert.deepEqual(await asUser(db, eve, "select id from public.lists where id = $1", [aliceList]), []);
  assert.equal(await affectedAsUser(db, dad, "update public.list_items set updates = false where list_id = $1", [aliceList]), 0);
  assert.equal(await affectedAsUser(db, mom, "update public.list_items set visited_on = '2026-10-01' where list_id = $1", [aliceList]), 2);

  // Nobody moves a list to another owner through the API, even with edit access.
  await assert.rejects(asUser(db, mom, "update public.lists set student_id = null, user_id = $2 where id = $1", [aliceList, mom]), /lists_owner_immutable/);
  await assert.rejects(asUser(db, alice, "update public.lists set student_id = null, user_id = $2 where id = $1", [aliceList, alice]), /lists_owner_immutable/);
});

/** The one-owner rule, as the service role would hit it (RLS can't help here: it's the table's own check). */
async function assertOneOwner(db: AuthDb, mom: string, student: string) {
  await assert.rejects(db.query("insert into public.lists (name) values ('Nobody')"), /lists_one_owner/, "a list with no owner is refused");
  await assert.rejects(
    db.query("insert into public.lists (student_id, user_id, name) values ($1, $2, 'Both')", [student, mom]),
    /lists_one_owner/,
    "a list with two owners is refused",
  );
}

test("every list has exactly one owner, and one default per owner", async () => {
  const { db, mom, aliceStudent } = await world();
  await assertOneOwner(db, mom, aliceStudent);
  await momList(db, mom);
  await assert.rejects(asUser(db, mom, "insert into public.lists (user_id, name, is_default) values ($1, 'Second', true)", [mom]), /lists_one_default_user_idx/);
});

/* ------------------------------------------------------------------ */
/* Follows: maintained from list_items.updates                         */
/* ------------------------------------------------------------------ */

test("follows: a student with an account follows their list's colleges while updates is on", async () => {
  const { db, mom, alice, aliceList, aliceStudent } = await world();
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744'), ($1, '166683')", [aliceList]);
  assert.deepEqual(await follows(db, alice), ["166683", "243744"]);
  assert.deepEqual(await follows(db, mom), [], "the guardian who reads the list follows nothing");

  await asUser(db, alice, "update public.list_items set updates = false where list_id = $1 and unit_id = '243744'", [aliceList]);
  assert.deepEqual(await follows(db, alice), ["166683"], "updates off: unfollowed");
  await asUser(db, alice, "update public.list_items set updates = true where list_id = $1 and unit_id = '243744'", [aliceList]);
  assert.deepEqual(await follows(db, alice), ["166683", "243744"], "updates on again: followed");

  // Another list with the same college: turning updates off on one keeps the follow while the other still has it on.
  const extra = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name) values ($1, 'Extra') returning id", [aliceStudent]))).id;
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [extra]);
  await asUser(db, alice, "update public.list_items set updates = false where list_id = $1 and unit_id = '243744'", [aliceList]);
  assert.deepEqual(await follows(db, alice), ["166683", "243744"], "still on (with updates) in the extra list");
  await asUser(db, alice, "delete from public.list_items where list_id = $1 and unit_id = '243744'", [extra]);
  assert.deepEqual(await follows(db, alice), ["166683"], "the last item with updates on is gone: unfollowed (the other item has updates off)");

  // An item inserted with updates off follows nothing; deleting a list re-syncs too.
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id, updates) values ($1, '110635', false)", [extra]);
  assert.deepEqual(await follows(db, alice), ["166683"]);
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '190415')", [extra]);
  await asUser(db, alice, "delete from public.lists where id = $1", [extra]);
  assert.deepEqual(await follows(db, alice), ["166683"], "deleting the list unfollows what was only on it");

  // Follows are the trigger's alone now.
  await assert.rejects(asUser(db, alice, "insert into public.follows (unit_id) values ('243744')"), /permission denied/);
  await assert.rejects(asUser(db, alice, "delete from public.follows where unit_id = '166683'"), /permission denied/);
});

test("follows: a managed student's list notifies the guardian managing it, until the student claims the record", async () => {
  const { db, mom, household } = await world();
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2029)", [household]);
  const benList = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [ben]))).id;
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '243744'), ($1, '166683')", [benList]);
  assert.deepEqual(await follows(db, mom), ["166683", "243744"], "managed_by is notified");

  // Mom's own list has 166683 too: turning it off on Ben's list keeps her follow (another item, same user, is on).
  const own = await momList(db, mom);
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '166683'), ($1, '110635')", [own]);
  await asUser(db, mom, "update public.list_items set updates = false where list_id = $1 and unit_id = '166683'", [benList]);
  assert.deepEqual(await follows(db, mom), ["110635", "166683", "243744"], "still on through her own list");
  await asUser(db, mom, "delete from public.list_items where list_id = $1 and unit_id = '243744'", [benList]);
  assert.deepEqual(await follows(db, mom), ["110635", "166683"]);
  await asUser(db, mom, "update public.list_items set updates = true where list_id = $1 and unit_id = '166683'", [benList]);
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '190415')", [benList]);
  assert.deepEqual(await follows(db, mom), ["110635", "166683", "190415"]);

  // Ben claims his record: the follows for his list move to him; Mom keeps only what her own list has on.
  const benUser = await createUser(db, { email: "ben@example.com", birthYear: 2010, roleHint: "student" });
  await accept(db, benUser, (await invite(db, mom, household, "ben@example.com", "student", { student: ben })).token);
  assert.deepEqual(await follows(db, benUser), ["166683", "190415"]);
  assert.deepEqual(await follows(db, mom), ["110635", "166683"], "190415 was only on Ben's list");
});

test("follows: a guardian's own list notifies the guardian; turning updates off unfollows", async () => {
  const { db, mom, dad } = await world();
  const list = await momList(db, mom);
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [list]);
  assert.deepEqual(await follows(db, mom), ["243744"]);
  assert.deepEqual(await follows(db, dad), [], "reading the list follows nothing");
  await asUser(db, mom, "update public.list_items set updates = false where list_id = $1", [list]);
  assert.deepEqual(await follows(db, mom), []);
  await asUser(db, mom, "update public.list_items set updates = true where list_id = $1", [list]);
  assert.deepEqual(await follows(db, mom), ["243744"]);
  await asUser(db, mom, "delete from public.list_items where list_id = $1", [list]);
  assert.deepEqual(await follows(db, mom), []);
});

test("migration: manual follows move into each user's default list, and every follow becomes a list follow", async () => {
  const db = await boot(HUB);
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student" });
  const zoe = await createUser(db, { email: "zoe@example.com", birthYear: 2009, roleHint: "student" });
  const household = await rpc<string>(db, mom, "public.create_household('Smiths', 'guardian')");
  // Alice has her own record and a list with 110635 on it; Zoe has a record and no list; Mom has no record at all.
  const aliceStudent = (await one(asUser<{ id: string }>(db, alice, "insert into public.students (user_id) values ($1) returning id", [alice]))).id;
  const aliceList = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'Dream schools', true) returning id", [aliceStudent]))).id;
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '110635')", [aliceList]);
  await asUser(db, zoe, "insert into public.students (user_id) values ($1)", [zoe]);
  // Mom manages Ben, whose list has 190415: before this migration nobody was notified about it.
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2029)", [household]);
  const benList = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [ben]))).id;
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '190415')", [benList]);
  // Manual follows: the Follow button's, and one upgraded from a list follow.
  await asUser(db, alice, "insert into public.follows (unit_id, source) values ('243744', 'manual')");
  await asUser(db, alice, "update public.follows set source = 'manual' where unit_id = '110635'");
  await asUser(db, zoe, "insert into public.follows (unit_id, source) values ('166683', 'manual')");
  await asUser(db, mom, "insert into public.follows (unit_id, source) values ('243744', 'manual'), ('166027', 'manual')");

  await applyHub(db);

  const items = async (who: string) =>
    asUser<{ owner: string; list: string; is_default: boolean; unit_id: string; category: string; updates: boolean; added_by: string }>(
      db,
      who,
      `select coalesce(l.user_id, l.student_id)::text as owner, l.name as list, l.is_default, li.unit_id, li.category, li.updates, li.added_by::text as added_by
       from public.lists l join public.list_items li on li.list_id = l.id
       where l.user_id = $1 or l.student_id in (select id from public.students where user_id = $1)
       order by li.unit_id`,
      [who],
    );
  assert.deepEqual(
    (await items(alice)).map((r) => [r.list, r.unit_id, r.category, r.updates, r.added_by]),
    [
      ["Dream schools", "110635", "unsorted", true, alice],
      ["Dream schools", "243744", "unsorted", true, alice],
    ],
    "into Alice's existing default list; 110635 was already there and isn't added twice",
  );
  const zoeItems = await items(zoe);
  assert.deepEqual(
    zoeItems.map((r) => [r.list, r.is_default, r.unit_id]),
    [["My list", true, "166683"]],
    "Zoe's default list is created for her own student record",
  );
  const momItems = await items(mom);
  assert.deepEqual(
    momItems.map((r) => [r.owner, r.list, r.is_default, r.unit_id, r.added_by]),
    [
      [mom, "My list", true, "166027", mom],
      [mom, "My list", true, "243744", mom],
    ],
    "Mom has no student record, so she gets a list of her own",
  );

  assert.deepEqual(await follows(db, alice), ["110635", "243744"], "nobody lost a follow");
  assert.deepEqual(await follows(db, zoe), ["166683"]);
  assert.deepEqual(await follows(db, mom), ["166027", "190415", "243744"], "and Mom now follows her managed student's colleges");
  assert.deepEqual((await db.query("select distinct source from public.follows")).rows, [{ source: "list" }]);
  await assert.rejects(db.query("insert into public.follows (user_id, unit_id, source) values ($1, '100654', 'manual')", [mom]), /follows_source_check/);
});

/* ------------------------------------------------------------------ */
/* The roster                                                          */
/* ------------------------------------------------------------------ */

interface RosterRow {
  member_id: string | null;
  role: string;
  user_id: string | null;
  student_id: string | null;
  display_name: string | null;
  is_me: boolean;
  status: string;
  invitation_id: string | null;
  expires_at: string | null;
  grad_year: number | null;
  phone: string | null;
  email: string | null;
}

const roster = (db: AuthDb, who: string, household: string) => asUser<RosterRow>(db, who, "select * from public.household_roster($1)", [household]);

test("roster: everyone by name with a status; emails only on invitations the viewer sent", async () => {
  const { db, mom, dad, alice, eve, household } = await world();
  await asUser(db, alice, "update public.students set grad_year = 2027, phone = '+16155550101' where user_id = $1", [alice]);
  await asUser(db, mom, "update public.profiles set phone = '+16155550100' where id = $1", [mom]);
  // An expired invitation (Alice's) and a revoked one hold no seat, so the six seats still fit the rest.
  const uncle = await invite(db, alice, household, "uncle@example.com", "guardian", { name: "Uncle Joe" });
  await db.query("update public.invitations set expires_at = now() - interval '1 day' where id = $1", [uncle.id]);
  // Revoked and accepted invitations never show.
  const gone = await invite(db, mom, household, "gone@example.com", "guardian", { name: "Gone" });
  await asUser(db, mom, "update public.invitations set revoked_at = now() where id = $1", [gone.id]);
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2029)", [household]);
  const cara = await invite(db, mom, household, "cara@example.com", "student", { name: "Cara", gradYear: 2028, phone: "+16155550102" });
  const gran = await invite(db, mom, household, "gran@example.com", "guardian", { name: "Gran", phone: "+447700900123" });

  const rows = await roster(db, mom, household);
  const summary = rows.map((r) => [r.display_name, r.role, r.status, r.member_id === null, r.email]);
  assert.deepEqual(
    summary,
    [
      ["Alice Smith", "student", "active", false, null],
      ["Ben", "student", "managed", false, null],
      ["Cara", "student", "invited", false, "cara@example.com"],
      ["Tracy Smith", "guardian", "active", false, null],
      ["Sam Smith", "guardian", "active", false, null],
      ["Uncle Joe", "guardian", "expired", true, null],
      ["Gran", "guardian", "invited", true, "gran@example.com"],
    ],
    "students first, then guardians, each by when they joined or were invited; emails only for Mom's own invitations",
  );
  const byName = new Map(rows.map((r) => [r.display_name, r]));
  assert.equal(byName.get("Cara")!.student_id, cara.student_id, "Cara's hand-over is on her managed record's row, not a row of its own");
  assert.equal(byName.get("Cara")!.invitation_id, cara.id);
  assert.ok(byName.get("Cara")!.expires_at);
  assert.equal(byName.get("Cara")!.grad_year, 2028);
  assert.equal(byName.get("Cara")!.phone, "+16155550102");
  assert.equal(byName.get("Ben")!.student_id, ben);
  assert.equal(byName.get("Ben")!.invitation_id, null);
  assert.equal(byName.get("Alice Smith")!.grad_year, 2027);
  assert.equal(byName.get("Alice Smith")!.phone, "+16155550101");
  assert.equal(byName.get("Tracy Smith")!.phone, "+16155550100");
  assert.equal(byName.get("Tracy Smith")!.is_me, true);
  assert.equal(byName.get("Gran")!.invitation_id, gran.id);
  assert.equal(byName.get("Gran")!.phone, "+447700900123");
  assert.equal(rows.some((r) => r.display_name === "Gone"), false);

  // Alice sees the same people; the only email she gets is on the invitation she sent.
  const asAlice = await roster(db, alice, household);
  assert.deepEqual(
    asAlice.map((r) => [r.display_name, r.email]),
    summary.map(([name]) => [name, name === "Uncle Joe" ? "uncle@example.com" : null]),
  );
  assert.equal(asAlice.find((r) => r.display_name === "Alice Smith")!.is_me, true);
  assert.deepEqual(await roster(db, dad, household).then((r) => r.filter((x) => x.email !== null)), [], "Dad sent nothing, sees no emails");
  assert.deepEqual(await roster(db, eve, household), [], "an outsider gets nothing");

  // Accepting turns the invited row into an active member, by the invited name.
  const granUser = await createUser(db, { email: "gran@example.com", birthYear: 1950 });
  await accept(db, granUser, gran.token);
  const after = (await roster(db, mom, household)).find((r) => r.user_id === granUser)!;
  assert.deepEqual([after.display_name, after.status, after.invitation_id, after.phone], ["Gran", "active", null, "+447700900123"]);
});

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

test("create_invitation with a name: a student invited by email is a managed record plus a hand-over, one seat", async () => {
  const { db, mom, alice, household } = await world();
  const seats = () => db.query<{ n: number }>("select public.household_seats_taken($1) as n", [household]).then((r) => r.rows[0].n);
  const before = await seats();
  const cara = await invite(db, mom, household, "cara@example.com", "student", { name: " Cara ", gradYear: 2028, phone: "+16155550102" });
  assert.ok(cara.student_id, "a managed record was created");
  assert.equal(await seats(), before + 1, "one seat, not two");
  const record = (await db.query<{ managed_by: string; user_id: string | null; display_name: string; grad_year: number; phone: string }>(
    "select managed_by, user_id, display_name, grad_year, phone from public.students where id = $1",
    [cara.student_id],
  )).rows[0];
  assert.deepEqual(record, { managed_by: mom, user_id: null, display_name: "Cara", grad_year: 2028, phone: "+16155550102" });
  const inv = (await db.query("select display_name, phone, grad_year, token, student_id from public.invitations where id = $1", [cara.id])).rows[0];
  assert.deepEqual(inv, { display_name: "Cara", phone: "+16155550102", grad_year: 2028, token: cara.token, student_id: cara.student_id });

  // The parent can start Cara's list right away; when she accepts, the record (and its name) is hers.
  const list = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [cara.student_id]))).id;
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [list]);
  const caraUser = await createUser(db, { email: "cara@example.com", birthYear: 2010, displayName: "CJ" });
  await accept(db, caraUser, cara.token);
  const claimed = (await db.query<{ user_id: string; display_name: string }>("select user_id, display_name from public.students where id = $1", [cara.student_id])).rows[0];
  assert.deepEqual(claimed, { user_id: caraUser, display_name: "Cara" }, "the claimed record keeps its name");
  assert.deepEqual(await follows(db, caraUser), ["243744"]);

  // Refusals: a bad phone, your own email, a student invited by a student.
  await assert.rejects(invite(db, mom, household, "x@example.com", "guardian", { phone: "615-555-0100" }), /invalid_phone/);
  await assert.rejects(invite(db, mom, household, "MOM@example.com", "guardian"), /invite_self/);
  await assert.rejects(invite(db, alice, household, "y@example.com", "student", { name: "Y" }), /only_guardians_invite_students/);
  // The old five-argument call still works (a plain invitation, no record created).
  const plain = await rpc<Inv>(db, mom, "public.create_invitation($1, 'z@example.com', 'student')", [household]);
  assert.equal((await db.query<{ student_id: string | null }>("select student_id from public.invitations where id = $1", [plain.id])).rows[0].student_id, null);
  assert.equal(await tokenOf(db, plain.id), plain.token, "it stores the token too");
});

test("accept_invitation writes the invited name and phone to an empty profile, keeps a name already set, and clears the token", async () => {
  const { db, mom, household } = await world();
  const gran = await invite(db, mom, household, "gran@example.com", "guardian", { name: "Gran", phone: "+16155550103" });
  assert.equal(await tokenOf(db, gran.id), gran.token, "the token is stored while pending");
  const granUser = await createUser(db, { email: "gran@example.com", birthYear: 1950 });
  await accept(db, granUser, gran.token);
  assert.deepEqual(
    await one(asUser(db, granUser, "select display_name, phone from public.profiles where id = $1", [granUser])),
    { display_name: "Gran", phone: "+16155550103" },
  );
  assert.equal(await tokenOf(db, gran.id), null, "cleared on accept");

  const pop = await invite(db, mom, household, "pop@example.com", "guardian", { name: "Pop", phone: "+16155550104" });
  const popUser = await createUser(db, { email: "pop@example.com", birthYear: 1948, displayName: "Robert" });
  await accept(db, popUser, pop.token);
  assert.deepEqual(
    await one(asUser(db, popUser, "select display_name, phone from public.profiles where id = $1", [popUser])),
    { display_name: "Robert", phone: "+16155550104" },
    "their own name wins",
  );

  const revoked = await invite(db, mom, household, "nope@example.com", "guardian", { name: "Nope" });
  await asUser(db, mom, "update public.invitations set revoked_at = now() where id = $1", [revoked.id]);
  assert.equal(await tokenOf(db, revoked.id), null, "cleared on revoke");

  // Send again stores the new token; the old one stops working.
  const again = await invite(db, mom, household, "again@example.com", "guardian", { name: "Again" });
  const fresh = await rpc<{ token: string }>(db, mom, "public.reissue_invitation($1)", [again.id]);
  assert.equal(await tokenOf(db, again.id), fresh.token);
  assert.notEqual(fresh.token, again.token);
});

test("accept_invitation_by_id: only the user the Edge Function recorded may accept, and they may read their invitation first", async () => {
  const { db, mom, eve, household } = await world();
  const gina = await invite(db, mom, household, "gina@example.com", "guardian", { name: "Gina" });
  // What the Edge Function does with the secret key: create the user (metadata copied to the profile) and record them.
  const ginaUser = await createUser(db, { email: "gina@example.com", displayName: "Gina", roleHint: "guardian" });
  await db.query("update public.invitations set accepted_by = $2 where id = $1", [gina.id, ginaUser]);

  await assertInvitedUserReadsOwn(db, ginaUser, eve, gina.id, household);

  await assert.rejects(asUser(db, eve, "select public.accept_invitation_by_id($1)", [gina.id]), /invitation_not_found/, "a different user is refused");
  await assert.rejects(asUser(db, null, "select public.accept_invitation_by_id($1)", [gina.id]), /permission denied/, "signed out: no access at all");
  // An invitation the function never touched can't be accepted by id, even by the right email.
  const other = await invite(db, mom, household, "olly@example.com", "guardian", { name: "Olly" });
  const olly = await createUser(db, { email: "olly@example.com" });
  await assert.rejects(asUser(db, olly, "select public.accept_invitation_by_id($1)", [other.id]), /invitation_not_found/);

  assert.equal(await rpc<string>(db, ginaUser, "public.accept_invitation_by_id($1)", [gina.id]), household);
  assert.equal(await tokenOf(db, gina.id), null);
  const row = (await roster(db, mom, household)).find((r) => r.user_id === ginaUser)!;
  assert.deepEqual([row.display_name, row.status], ["Gina", "active"]);
  await assert.rejects(asUser(db, ginaUser, "select public.accept_invitation_by_id($1)", [gina.id]), /invitation_used/);

  // Expired: refused even for the right user.
  const late = await invite(db, mom, household, "late@example.com", "guardian", { name: "Late" });
  const lateUser = await createUser(db, { email: "late@example.com" });
  await db.query("update public.invitations set accepted_by = $2, expires_at = now() - interval '1 minute' where id = $1", [late.id, lateUser]);
  await assert.rejects(asUser(db, lateUser, "select public.accept_invitation_by_id($1)", [late.id]), /invitation_expired/);
});

/** The invited user (not yet a member) reads their own invitation row; nobody outside the household does. */
async function assertInvitedUserReadsOwn(db: AuthDb, invited: string, outsider: string, invitation: string, household: string) {
  assert.deepEqual(
    await asUser(db, invited, "select household_id, display_name from public.invitations where id = $1", [invitation]),
    [{ household_id: household, display_name: "Gina" }],
    "the invited user reads their invitation before accepting",
  );
  assert.deepEqual(await asUser(db, outsider, "select id from public.invitations where id = $1", [invitation]), []);
}

test("invitation_preview never returns the token or the email", async () => {
  const { db, mom, household } = await world();
  const inv = await invite(db, mom, household, "gran@example.com", "guardian", { name: "Gran" });
  const preview = await rpc<Record<string, unknown>>(db, null, "public.invitation_preview($1)", [inv.token]);
  assert.deepEqual(Object.keys(preview).sort(), ["expires_at", "household_name", "inviter_name", "side", "state"]);
  assert.equal(JSON.stringify(preview).includes(inv.token), false);
});

/* ------------------------------------------------------------------ */
/* Guards: break a rule on purpose and show the checks notice          */
/* ------------------------------------------------------------------ */

test("guard: without the one-owner check a list can have two owners, and assertOneOwner fails", async () => {
  const { db, mom, aliceStudent } = await world();
  await db.exec("alter table public.lists drop constraint lists_one_owner");
  await db.query("insert into public.lists (student_id, user_id, name) values ($1, $2, 'Both')", [aliceStudent, mom]);
  await assert.rejects(assertOneOwner(db, mom, aliceStudent), assert.AssertionError);
});

test("guard: without the invited user's select policy the welcome page can't read the invitation, and the check fails", async () => {
  const { db, mom, eve, household } = await world();
  const gina = await invite(db, mom, household, "gina@example.com", "guardian", { name: "Gina" });
  const ginaUser = await createUser(db, { email: "gina@example.com" });
  await db.query("update public.invitations set accepted_by = $2 where id = $1", [gina.id, ginaUser]);
  await db.exec(`drop policy "Invitations: invited user reads own" on public.invitations`);
  await assert.rejects(assertInvitedUserReadsOwn(db, ginaUser, eve, gina.id, household), assert.AssertionError);
});

test("guard: a follows trigger that ignores updates keeps following, and the check notices", async () => {
  const { db, alice, aliceList } = await world();
  await db.exec(`
    create or replace function public.list_items_sync_follows() returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      if tg_op = 'INSERT' then perform public.sync_follow(public.list_notify_user(new.list_id), new.unit_id); return new; end if;
      return coalesce(new, old);
    end $$;`);
  await db.exec(`create or replace function public.wants_updates(p_user uuid, p_unit text) returns boolean language sql stable security definer set search_path = '' as $$ select true $$`);
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '243744')", [aliceList]);
  await asUser(db, alice, "update public.list_items set updates = false where list_id = $1", [aliceList]);
  assert.deepEqual(await follows(db, alice), ["243744"], "broken: the follow stays after updates is turned off");
});

test("parents edit by default (20261008150000): the creator and an invited guardian can edit; the student's switch turns it off and back on", async () => {
  const { db, mom, alice, eve, household, aliceStudent } = await world();
  const canEdit = async (who: string) => (await one(asUser<{ v: boolean }>(db, who, "select public.can_edit_student($1) as v", [aliceStudent]))).v;
  // Mom created the household: an editor from the start.
  assert.equal(await canEdit(mom), true);
  // Eve, invited by a guardian with no explicit choice (the short signature), joins as an editor too.
  await accept(db, eve, (await rpc<Inv>(db, mom, "public.create_invitation($1, 'eve@example.com', 'guardian')", [household])).token);
  assert.equal(await canEdit(eve), true);
  // The student's switch: off for every guardian, then on again (what setParentsCanEdit does per guardian).
  const guardians = await asUser<{ id: string }>(db, alice, "select id from public.household_members where household_id = $1 and role = 'guardian' and status = 'active'", [household]);
  for (const g of guardians) await asUser(db, alice, "select public.set_member_can_edit($1, false)", [g.id]);
  assert.equal(await canEdit(mom), false);
  assert.equal(await canEdit(eve), false);
  for (const g of guardians) await asUser(db, alice, "select public.set_member_can_edit($1, true)", [g.id]);
  assert.equal(await canEdit(mom), true);
  // Guard: the migration is what makes the creator an editor; without it, Mom would start view-only.
  const before = await boot("20261008150000_parents_edit_by_default.sql");
  const m2 = await createUser(before, { email: "m2@example.com", birthYear: 1978, roleHint: "guardian" });
  const h2 = await rpc<string>(before, m2, "public.create_household('Before', 'guardian')");
  const row = await one(asUser<{ can_edit: boolean }>(before, m2, "select can_edit from public.household_members where household_id = $1 and user_id = $2", [h2, m2]));
  assert.equal(row.can_edit, false);
});
