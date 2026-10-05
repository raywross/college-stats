/**
 * Sending an invitation link again, and claiming a managed student into an account that already has its own student
 * record (supabase/migrations/20261005160000_invitation_links.sql; specs/product/accounts.md). Real Postgres (PGlite)
 * with the auth stub; every statement runs as a signed-in user.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const BEFORE = [
  "20260928000000_dataset.sql",
  "20261002140000_school_staging.sql",
  "20261005120000_accounts.sql",
  "20261005125000_households.sql",
  "20261005130000_student_profiles.sql",
  "20261005140000_follows.sql",
  "20261005150000_lists.sql",
];
const MIGRATIONS = [...BEFORE, "20261005160000_invitation_links.sql"];

const rejects = async (p: Promise<unknown>, code: RegExp) => assert.rejects(p, code);

/** Mom's household with a managed student "Alice" who already has a list (two colleges) and a profile. */
async function world(migrations = MIGRATIONS) {
  const db = await createAuthDb(migrations);
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });
  const [{ hh }] = await asUser<{ hh: string }>(db, mom, "select public.create_household('Smiths', 'guardian') as hh");
  const [{ m }] = await asUser<{ m: string }>(db, mom, "select public.add_managed_student($1, 'Alice', 2027) as m", [hh]);
  const [{ id: momList }] = await asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [m]);
  await asUser(db, mom, "insert into public.list_items (list_id, unit_id, category) values ($1, '243744', 'reach'), ($1, '166027', 'reach')", [momList]);
  await asUser(db, mom, `insert into public.student_profiles (student_id, data) values ($1, '{"tests": {"sat": 1400}, "basics": {"state": "VA"}}')`, [m]);
  return { db, mom, alice, eve, hh, managed: m };
}

async function aliceHasOwnRecord(db: AuthDb, alice: string) {
  const [{ id }] = await asUser<{ id: string }>(db, alice, "insert into public.students (user_id) values ($1) returning id", [alice]);
  const [{ id: list }] = await asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [id]);
  await asUser(db, alice, "insert into public.list_items (list_id, unit_id) values ($1, '110635')", [list]);
  await asUser(db, alice, `insert into public.student_profiles (student_id, data) values ($1, '{"tests": {"sat": 1500}}')`, [id]);
  return id;
}

const invite = async (db: AuthDb, who: string, hh: string, email: string, side: string, student: string | null = null) =>
  (await asUser<{ inv: { id: string; token: string } }>(db, who, "select public.create_invitation($1, $2, $3, $4) as inv", [hh, email, side, student]))[0].inv;

test("claiming a managed student when the student already has a record merges it: lists, profile, household", async () => {
  const { db, mom, alice, hh, managed } = await world();
  const own = await aliceHasOwnRecord(db, alice);
  const inv = await invite(db, mom, hh, "alice@example.com", "student", managed);
  await asUser(db, alice, "select public.accept_invitation($1)", [inv.token]);

  const lists = await asUser<{ name: string; is_default: boolean; n: number }>(
    db, alice,
    "select l.name, l.is_default, (select count(*)::int from public.list_items li where li.list_id = l.id) as n from public.lists l where l.student_id = $1 order by l.is_default desc",
    [own],
  );
  assert.equal(lists.length, 2, "the list Mom started came over");
  assert.deepEqual(lists.map((l) => [l.is_default, l.n]), [[true, 1], [false, 2]], "Alice's own list stays the default; Mom's comes over as an extra list");

  const [profile] = await asUser<{ data: { tests: { sat: number }; basics?: { state: string } } }>(db, alice, "select data from public.student_profiles where student_id = $1", [own]);
  assert.equal(profile.data.tests.sat, 1500, "Alice's own values win");
  assert.equal(profile.data.basics?.state, "VA", "values only Mom entered come over");

  const follows = await asUser<{ unit_id: string }>(db, alice, "select unit_id from public.follows order by unit_id");
  assert.ok(follows.some((f) => f.unit_id === "243744"), "colleges on the moved list are followed");

  const members = await asUser<{ student_id: string }>(db, mom, "select student_id from public.household_members where household_id = $1 and role = 'student'", [hh]);
  assert.deepEqual(members.map((m) => m.student_id), [own], "Alice's own record replaces the managed one in the household");
  const [{ can }] = await asUser<{ can: boolean }>(db, mom, "select public.can_read_student($1) as can", [own]);
  assert.equal(can, true, "Mom still sees Alice's list, now on Alice's own record");
  assert.equal((await asUser(db, mom, "select id from public.students where id = $1 and deleted_at is null", [managed])).length, 0, "the managed record is retired");
});

test("guard: before this migration the same acceptance left Mom's list and Alice's numbers behind", async () => {
  const { db, mom, alice, hh, managed } = await world(BEFORE);
  const own = await aliceHasOwnRecord(db, alice);
  const inv = await invite(db, mom, hh, "alice@example.com", "student", managed);
  await asUser(db, alice, "select public.accept_invitation($1)", [inv.token]);
  const lists = await asUser(db, alice, "select id from public.lists where student_id = $1", [own]);
  assert.equal(lists.length, 1, "the bug this migration fixes: the merge test above would fail on the old function");
});

test("claiming a managed student with no record of their own hands the record over, as before", async () => {
  const { db, mom, alice, hh, managed } = await world();
  const inv = await invite(db, mom, hh, "alice@example.com", "student", managed);
  await asUser(db, alice, "select public.accept_invitation($1)", [inv.token]);
  const [rec] = await asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]);
  assert.equal(rec.id, managed);
  assert.equal((await asUser(db, alice, "select id from public.lists where student_id = $1", [managed])).length, 1);
});

test("a new link replaces the old one: old token refused, new one accepted, fresh expiry", async () => {
  const { db, mom, alice, hh } = await world();
  const inv = await invite(db, mom, hh, "alice@example.com", "student");
  const [{ re }] = await asUser<{ re: { token: string; expires_at: string; email: string } }>(db, mom, "select public.reissue_invitation($1) as re", [inv.id]);
  assert.notEqual(re.token, inv.token);
  assert.equal(re.email, "alice@example.com");
  assert.ok(new Date(re.expires_at).getTime() > Date.now() + 6.9 * 864e5);
  await rejects(asUser(db, alice, "select public.accept_invitation($1)", [inv.token]), /invitation_not_found/);
  await asUser(db, alice, "select public.accept_invitation($1)", [re.token]);
  await rejects(asUser(db, mom, "select public.reissue_invitation($1)", [inv.id]), /invitation_used/);
});

test("only the household's members can make a new link, and not for a cancelled invitation", async () => {
  const { db, mom, eve, hh } = await world();
  const inv = await invite(db, mom, hh, "dad@example.com", "guardian");
  await rejects(asUser(db, eve, "select public.reissue_invitation($1)", [inv.id]), /invitation_not_found/);
  await rejects(asUser(db, null, "select public.reissue_invitation($1)", [inv.id]), /permission denied|not_signed_in/);
  await asUser(db, mom, "update public.invitations set revoked_at = now() where id = $1", [inv.id]);
  await rejects(asUser(db, mom, "select public.reissue_invitation($1)", [inv.id]), /invitation_revoked/);
});
