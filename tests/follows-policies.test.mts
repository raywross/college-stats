/**
 * Row-level security and the publish function for following colleges (supabase/migrations/20261005140000_follows.sql;
 * specs/product/follow-colleges.md), checked against real Postgres (PGlite + a stub of Supabase's auth schema,
 * tests/helpers/pg-auth.mts). Access assertions run as a signed-in user, anon, or service_role (the secret key),
 * never as the superuser. The last tests break a policy on purpose and prove these checks notice. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { followWrite, isUnitId } from "../lib/follow-state.ts";

test("an explicit follow turns a list follow into a manual one and never duplicates; ids are digits only", () => {
  assert.equal(followWrite(null), "insert");
  assert.equal(followWrite("list"), "upgrade");
  assert.equal(followWrite("manual"), "none");
  assert.ok(isUnitId("243744"));
  for (const bad of ["", "24374a", "1 or 1=1", "12345678901", 243744, null]) assert.equal(isUnitId(bad), false, String(bad));
});

const MIGRATIONS = ["20260928000000_dataset.sql", "20261002140000_school_staging.sql", "20261005120000_accounts.sql", "20261005140000_follows.sql", "20261005145000_change_old_source.sql"];

/** Runs one statement with the secret key's role (service_role bypasses RLS), as publish-data and the digest job do. */
async function asService<T = Record<string, unknown>>(db: AuthDb, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql, params)).rows;
  });
}

interface World {
  db: AuthDb;
  alice: string; // student
  mom: string; // guardian of alice, in her household, with edit access
  eve: string; // unrelated user
}

async function world(): Promise<World> {
  const db = await createAuthDb(MIGRATIONS);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student" });
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });

  // Mom's household with Alice in it, built through the API as each user (as in accounts-policies.test.mts).
  await asUser(db, alice, "insert into public.students (user_id) values ($1)", [alice]);
  const [{ id: household }] = await asUser<{ id: string }>(db, mom, "insert into public.households (name) values ('Smiths') returning id");
  await asUser(db, mom, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household, mom]);
  const [{ inv }] = await asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'alice@example.com', 'student') as inv", [household]);
  await asUser(db, alice, "select public.accept_invitation($1)", [inv.token]);
  const [{ can }] = await asUser<{ can: boolean }>(db, mom, "select public.can_read_student((select id from public.students limit 1)) as can");
  assert.equal(can, true, "setup: mom should be alice's guardian");

  await asUser(db, alice, "insert into public.follows (unit_id) values ('243744'), ('166683')");
  await asUser(db, mom, "insert into public.follows (unit_id) values ('190415')");
  return { db, alice, mom, eve };
}

const followsOf = async (db: AuthDb, who: string | null) =>
  (await asUser<{ user_id: string; unit_id: string }>(db, who, "select user_id, unit_id from public.follows order by unit_id")).map((r) => `${r.user_id === null ? "?" : r.user_id.slice(0, 4)}:${r.unit_id}`);

/** The rule a guardian must never break: a student's follows stay the student's. */
async function assertOwnFollowsOnly(db: AuthDb, who: string) {
  const rows = await asUser<{ user_id: string }>(db, who, "select user_id from public.follows");
  assert.ok(rows.every((r) => r.user_id === who), "another user's follows leaked");
}

test("follows: each user reads and changes only their own; a guardian can't see a student's follows", async () => {
  const { db, alice, mom, eve } = await world();
  assert.deepEqual(await followsOf(db, alice), [`${alice.slice(0, 4)}:166683`, `${alice.slice(0, 4)}:243744`]);
  assert.deepEqual(await followsOf(db, mom), [`${mom.slice(0, 4)}:190415`]);
  assert.deepEqual(await followsOf(db, eve), []);
  await assertOwnFollowsOnly(db, mom);
  await assertOwnFollowsOnly(db, eve);

  // Nobody touches someone else's rows.
  assert.equal(await affectedAsUser(db, mom, "delete from public.follows where user_id = $1", [alice]), 0);
  assert.equal(await affectedAsUser(db, mom, "update public.follows set source = 'list' where user_id = $1", [alice]), 0);
  await assert.rejects(asUser(db, mom, "insert into public.follows (user_id, unit_id) values ($1, '110635')", [alice]), /row-level security/);
  // The owner can turn a list follow into a manual one, but can't move it to another user.
  assert.equal(await affectedAsUser(db, alice, "update public.follows set source = 'list' where unit_id = '243744'"), 1);
  await assert.rejects(asUser(db, alice, "update public.follows set user_id = $1", [mom]), /permission denied/);
  assert.equal(await affectedAsUser(db, alice, "delete from public.follows where unit_id = '243744'"), 1);
  // Malformed ids are refused.
  await assert.rejects(asUser(db, alice, "insert into public.follows (unit_id) values ('drop table')"), /check constraint/);
});

test("signed-out visitors can't read or write follows, prefs, or digests", async () => {
  const { db } = await world();
  await assert.rejects(asUser(db, null, "select * from public.follows"), /permission denied/);
  await assert.rejects(asUser(db, null, "select * from public.notification_prefs"), /permission denied/);
  await assert.rejects(asUser(db, null, "select * from public.digests"), /permission denied/);
  await assert.rejects(asUser(db, null, "insert into public.follows (user_id, unit_id) values (gen_random_uuid(), '243744')"), /permission denied/);
});

test("notification prefs: created with the first follow, own row only, and one-click unsubscribe by token", async () => {
  const { db, alice, mom, eve } = await world();
  const [prefs] = await asUser<{ user_id: string; email_updates: boolean; unsubscribe_token: string }>(db, alice, "select user_id, email_updates, unsubscribe_token from public.notification_prefs");
  assert.equal(prefs.user_id, alice);
  assert.equal(prefs.email_updates, true);
  assert.match(prefs.unsubscribe_token, /^[0-9a-f]{64}$/);
  assert.deepEqual(await asUser(db, eve, "select user_id from public.notification_prefs"), [], "eve has no follows, so no prefs yet");
  assert.equal((await asUser(db, mom, "select user_id from public.notification_prefs")).length, 1);

  // The token can't be rewritten through the API, and another user's switch can't be flipped.
  await assert.rejects(asUser(db, alice, "update public.notification_prefs set unsubscribe_token = 'x'"), /permission denied/);
  assert.equal(await affectedAsUser(db, mom, "update public.notification_prefs set email_updates = false where user_id = $1", [alice]), 0);

  const [{ ok: wrong }] = await asUser<{ ok: boolean }>(db, null, "select public.unsubscribe_by_token($1) as ok", ["0".repeat(64)]);
  assert.equal(wrong, false);
  const [{ ok }] = await asUser<{ ok: boolean }>(db, null, "select public.unsubscribe_by_token($1) as ok", [prefs.unsubscribe_token]);
  assert.equal(ok, true);
  const [after] = await asUser<{ email_updates: boolean }>(db, alice, "select email_updates from public.notification_prefs");
  assert.equal(after.email_updates, false);
  const [momPrefs] = await asUser<{ email_updates: boolean }>(db, mom, "select email_updates from public.notification_prefs");
  assert.equal(momPrefs.email_updates, true, "only the token's owner is unsubscribed");
});

/** One publish through the functions publish-data calls, as service_role. Returns the function's result. */
async function publish(db: AuthDb, changes: unknown[], { expectedChanges = changes.length } = {}) {
  const schools = [
    { unit_id: "243744", name: "Stanford University", location: { state: "CA" } },
    { unit_id: "166683", name: "Massachusetts Institute of Technology", location: { state: "MA" } },
  ];
  await asService(db, "select public.stage_schools($1::json, 0, true)", [JSON.stringify(schools)]);
  await asService(db, "select public.stage_dataset_changes($1::json, true)", [JSON.stringify(changes)]);
  const [{ r }] = await asService<{ r: { schools: number; publish_id: number; changes: number } }>(
    db,
    "select public.publish_schools_staged_with_changes($1::json, $2::json, 2, $3, 'abc', 'test') as r",
    [JSON.stringify({ retrieved: "2026-10-05" }), JSON.stringify({ releases: [] }), expectedChanges],
  );
  return r;
}

const CHANGE = {
  unit_id: "243744",
  field: "admissions.acceptance_rate",
  kind: "new_year",
  old_value: 0.0368,
  new_value: 0.0391,
  old_year: "Fall 2024",
  new_year: "Fall 2025",
  source: "IPEDS Admissions",
  release: "IPEDS winter release (provisional)",
};

test("dataset_changes: written with the publish in one transaction, readable by anyone, writable by no user", async () => {
  const { db, alice } = await world();
  const r = await publish(db, [CHANGE, { ...CHANGE, field: "admissions.applicants", old_value: null, new_value: 57326, kind: "appeared", old_year: null }]);
  assert.equal(r.schools, 2);
  assert.equal(r.changes, 2);

  const [pub] = (await db.query<{ id: number; published_at: Date }>("select id, published_at from public.dataset_publishes")).rows;
  assert.equal(Number(r.publish_id), Number(pub.id));
  const [meta] = (await db.query<{ published_at: Date }>("select published_at from public.dataset_files where name = 'meta'")).rows;

  const anonRows = await asUser<{ publish_id: number; published_at: Date; field: string; old_value: unknown; new_value: unknown }>(
    db,
    null,
    "select publish_id, published_at, field, old_value, new_value from public.dataset_changes order by field",
  );
  assert.equal(anonRows.length, 2);
  assert.equal(Number(anonRows[0].publish_id), Number(pub.id));
  assert.equal(anonRows[0].published_at.getTime(), meta.published_at.getTime(), "a change's time is the dataset version the app reads");
  assert.equal(anonRows[1].old_value, null, "a JSON null is stored as SQL null");
  assert.equal(anonRows[0].new_value, 0.0391);
  assert.equal((await asUser(db, alice, "select id from public.dataset_changes")).length, 2);
  assert.deepEqual(await db.query("select * from public.dataset_change_staging").then((x) => x.rows), [], "staging is emptied");

  for (const who of [null, alice]) {
    await assert.rejects(asUser(db, who, "insert into public.dataset_changes (publish_id, published_at, unit_id, field, kind) values ($1, now(), '1', 'name', 'revised')", [pub.id]), /permission denied/);
    await assert.rejects(asUser(db, who, "delete from public.dataset_changes"), /permission denied/);
    await assert.rejects(asUser(db, who, "select public.stage_dataset_changes('[]'::json, true)"), /permission denied/);
    await assert.rejects(asUser(db, who, "select public.publish_schools_staged_with_changes('{}'::json, '{}'::json, 0, 0)"), /permission denied/);
    await assert.rejects(asUser(db, who, "select * from public.dataset_change_staging"), /permission denied/);
  }
});

test("a publish whose staged changes don't match the expected count writes nothing", async () => {
  const { db } = await world();
  await assert.rejects(publish(db, [CHANGE], { expectedChanges: 2 }), /1 changes staged, expected 2/);
  assert.equal((await db.query("select id from public.dataset_publishes")).rows.length, 0);
  assert.equal((await db.query("select id from public.dataset_changes")).rows.length, 0);
  // Staging resets on the next publish's first call, so a failed run's rows never leak into the next one.
  const r = await publish(db, []);
  assert.equal(r.changes, 0);
});

test("digests: one per user per publish, written by the digest job, read by their owner only", async () => {
  const { db, alice, mom } = await world();
  const { publish_id } = await publish(db, [CHANGE]);
  await asService(db, "insert into public.digests (user_id, publish_id, published_at, unit_ids, college_count, change_count) values ($1, $2, now(), '{243744}', 1, 1)", [alice, publish_id]);
  await assert.rejects(asService(db, "insert into public.digests (user_id, publish_id, published_at) values ($1, $2, now())", [alice, publish_id]), /digests_once/);
  assert.equal((await asUser(db, alice, "select id from public.digests")).length, 1);
  assert.deepEqual(await asUser(db, mom, "select id from public.digests"), []);
  await assert.rejects(asUser(db, alice, "insert into public.digests (user_id, publish_id, published_at) values ($1, $2, now())", [alice, publish_id]), /permission denied/);
});

/* ------------------------------------------------------------------ */
/* The checks above must fail when a policy is broken                  */
/* ------------------------------------------------------------------ */

test("guard: a follows policy that drops the owner check lets the guardian read the student's follows, and the check catches it", async () => {
  const { db, mom } = await world();
  await db.exec(`drop policy "Follows: read own" on public.follows; create policy "broken" on public.follows for select to authenticated using (true);`);
  await assert.rejects(assertOwnFollowsOnly(db, mom), /another user's follows leaked/);
});

test("guard: a write grant on dataset_changes for anon is caught by the no-user-writes check", async () => {
  const { db } = await world();
  const { publish_id } = await publish(db, []);
  await db.exec(`grant insert on public.dataset_changes to anon; create policy "broken" on public.dataset_changes for insert to anon with check (true);`);
  await assert.doesNotReject(
    asUser(db, null, "insert into public.dataset_changes (publish_id, published_at, unit_id, field, kind) values ($1, now(), '1', 'name', 'revised')", [publish_id]),
    "with the grant, the insert the policy test expects to be refused goes through",
  );
});
