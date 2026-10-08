/**
 * The planner's schema (supabase/migrations/20261008120000_planner.sql; specs/planner/model.md "Tables" and "Rules"),
 * against real Postgres: PGlite with the auth stub from tests/helpers/pg-auth.mts and every migration applied in
 * order. Every assertion about access runs as a signed-in user; `db.query` is setup or the service role. Each rule's
 * check is a function, and the guard tests at the end break the rule on purpose and show the check notices.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, affectedAsUser, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

async function boot(): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

const rpc = async <T,>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;

const invite = (db: AuthDb, who: string, household: string, email: string, side: "guardian" | "student") =>
  rpc<{ token: string }>(db, who, "public.create_invitation($1, $2, $3, $4, $5, $6, $7, $8)", [household, email, side, null, false, null, null, null]);

const accept = (db: AuthDb, who: string, token: string) => rpc<string>(db, who, "public.accept_invitation($1)", [token]);

/**
 * The Smiths: Mom (guardian with edit access to Alice), Dad (guardian, view only), Alice (student with an account,
 * a list with two colleges and one task), and Eve, outside the household.
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
  const student = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const momMember = (await one(asUser<{ member_id: string }>(db, alice, "select member_id from public.household_roster($1) where user_id = $2", [household, mom]))).member_id;
  await asUser(db, alice, "select public.set_member_can_edit($1, true)", [momMember]);
  const list = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]))).id;
  const item = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position) values ($1, '243744', 0) returning id", [list]))).id;
  const item2 = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position) values ($1, '166683', 1) returning id", [list]))).id;
  const task = (
    await one(
      asUser<{ id: string }>(
        db,
        alice,
        `insert into public.plan_tasks (list_id, item_id, key, kind, title, due_on, source) values ($1, $2, $3, 'apply', 'Stanford: apply (ED I)', '2026-11-01', 'college') returning id`,
        [list, item, `${item}:apply:ed`],
      ),
    )
  ).id;
  return { db, mom, dad, alice, eve, household, student, list, item, item2, task };
}

type World = Awaited<ReturnType<typeof world>>;

/* ------------------------------------------------------------------ */
/* Checks (each guard test below breaks one and expects it to fail)    */
/* ------------------------------------------------------------------ */

/** The plan's access is the list's: the student and an edit guardian write, a view-only guardian reads, an outsider sees nothing. */
async function assertTaskAccess(w: World) {
  const { db, mom, dad, alice, eve, list, task } = w;
  for (const who of [alice, mom, dad]) assert.equal((await asUser(db, who, "select id from public.plan_tasks where list_id = $1", [list])).length, 1, "the household reads the plan");
  assert.deepEqual(await asUser(db, eve, "select id from public.plan_tasks where list_id = $1", [list]), [], "an outsider sees nothing");
  assert.equal(await affectedAsUser(db, dad, "update public.plan_tasks set done_at = now() where id = $1", [task]), 0, "a view-only guardian can't tick");
  assert.equal(await affectedAsUser(db, eve, "update public.plan_tasks set done_at = now() where id = $1", [task]), 0, "an outsider can't tick");
  await assert.rejects(
    asUser(db, dad, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', 'Mine', 'own')", [list]),
    /row-level security/,
    "a view-only guardian can't add a task",
  );
}

/** One Dream per list: setting a second moves the star. */
async function assertOneDream(w: World) {
  const { db, alice, item, item2, list } = w;
  await asUser(db, alice, "update public.list_items set dream = true where id = $1", [item]);
  await asUser(db, alice, "update public.list_items set dream = true where id = $1", [item2]);
  const dreams = await asUser<{ id: string }>(db, alice, "select id from public.list_items where list_id = $1 and dream", [list]);
  assert.deepEqual(
    dreams.map((d) => d.id),
    [item2],
    "exactly one Dream, the newest",
  );
}

/** One enrolling college per list. */
async function assertOneEnrolling(w: World) {
  const { db, alice, item, item2, list } = w;
  await asUser(db, alice, "update public.list_items set status = 'decided', outcome = 'admitted' where list_id = $1", [list]);
  await asUser(db, alice, "update public.list_items set enrolling = true, committed_on = '2027-04-20' where id = $1", [item]);
  await asUser(db, alice, "update public.list_items set enrolling = true where id = $1", [item2]);
  const rows = await asUser<{ id: string; enrolling: boolean; committed_on: string | null }>(
    db,
    alice,
    "select id, enrolling, committed_on::text from public.list_items where list_id = $1 order by position",
    [list],
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.enrolling, r.committed_on]),
    [
      [item, false, null],
      [item2, true, null],
    ],
    "the new choice is the only one enrolling, and the old one's commit date goes with it",
  );
}

/** Calendar tokens are readable by their creator only; the feed's lookup works without a session. */
async function assertTokensPrivate(w: World, hash: string) {
  const { db, mom, dad, alice, eve, list } = w;
  assert.equal((await asUser(db, alice, "select id from public.plan_calendar_tokens")).length, 1, "the creator reads their token");
  for (const who of [mom, dad, eve]) assert.deepEqual(await asUser(db, who, "select id from public.plan_calendar_tokens"), [], "nobody else reads it");
  assert.equal(await rpc<string>(db, null, "public.plan_for_calendar_token($1)", [hash]), list, "the feed finds the list by the token's hash");
}

/** Nudges: one per task per three days, three a week per student from one guardian. */
async function assertNudgeLimits(w: World) {
  const { db, dad, alice, list, task } = w;
  await rpc(db, dad, "public.send_nudge($1, $2, $3)", [task, "The essay first?", "app"]);
  await assert.rejects(rpc(db, dad, "public.send_nudge($1, null, 'email')", [task]), /nudge_limit/, "a second nudge on the same task within three days");
  const more: string[] = [];
  for (let i = 0; i < 3; i++) {
    more.push(
      (
        await one(
          asUser<{ id: string }>(db, alice, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', $2, 'own') returning id", [list, `Task ${i}`]),
        )
      ).id,
    );
  }
  await rpc(db, dad, "public.send_nudge($1, null, 'app')", [more[0]]);
  await rpc(db, dad, "public.send_nudge($1, null, 'app')", [more[1]]);
  await assert.rejects(rpc(db, dad, "public.send_nudge($1, null, 'app')", [more[2]]), /nudge_limit/, "the fourth nudge in a week");
}

/** A letter's storage path is readable only through the item it belongs to. */
async function assertLettersPrivate(w: World) {
  const { db, mom, dad, alice, eve, item } = w;
  await asUser(db, alice, "insert into public.plan_letters (item_id, kind, storage_path) values ($1, 'aid', 'letters/a.pdf')", [item]);
  for (const who of [alice, mom, dad]) assert.equal((await asUser(db, who, "select storage_path from public.plan_letters")).length, 1, "the household reads it through the item");
  assert.deepEqual(await asUser(db, eve, "select storage_path from public.plan_letters"), [], "an outsider never sees the path");
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

test("tasks: the list's access decides; an edit guardian's tick is attributed to them", async () => {
  const w = await world();
  await assertTaskAccess(w);
  const { db, mom, alice, task } = w;
  assert.equal(await affectedAsUser(db, mom, "update public.plan_tasks set done_at = now() where id = $1", [task]), 1, "an edit guardian ticks");
  const row = await one(asUser<{ done_by: string; created_by: string }>(db, alice, "select done_by, created_by from public.plan_tasks where id = $1", [task]));
  assert.equal(row.done_by, mom, "done_by is the guardian who ticked");
  assert.equal(row.created_by, alice);
  // Unticking clears it; a spoofed done_by is replaced with the signed-in user.
  await asUser(db, alice, "update public.plan_tasks set done_at = null where id = $1", [task]);
  assert.equal((await one(asUser<{ done_by: string | null }>(db, alice, "select done_by from public.plan_tasks where id = $1", [task]))).done_by, null);
  await asUser(db, alice, "update public.plan_tasks set done_at = now(), done_by = $2 where id = $1", [task, mom]);
  assert.equal((await one(asUser<{ done_by: string }>(db, alice, "select done_by from public.plan_tasks where id = $1", [task]))).done_by, alice);
  const own = await one(
    asUser<{ created_by: string }>(db, mom, "insert into public.plan_tasks (list_id, kind, title, source, created_by) values ($1, 'own', 'Book the tour', 'own', $2) returning created_by", [
      w.list,
      alice,
    ]),
  );
  assert.equal(own.created_by, mom, "created_by can't be claimed for someone else");
});

test("tasks: one per key per list, own tasks have no key, the item must be on the task's list, and the list never changes", async () => {
  const { db, alice, list, item } = await world();
  await assert.rejects(
    asUser(db, alice, `insert into public.plan_tasks (list_id, item_id, key, kind, title, source) values ($1, $2, $3, 'apply', 'Again', 'college')`, [list, item, `${item}:apply:ed`]),
    /plan_tasks_key_unique/,
  );
  await assert.rejects(asUser(db, alice, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'apply', 'No key', 'college')", [list]), /plan_tasks_own_has_no_key/);
  await assert.rejects(asUser(db, alice, "insert into public.plan_tasks (list_id, key, kind, title, source) values ($1, 'x', 'own', 'Keyed own', 'own')", [list]), /plan_tasks_own_has_no_key/);
  await assert.rejects(asUser(db, alice, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'made_up', 'Bad kind', 'own')", [list]), /check constraint/);
  await assert.rejects(
    asUser(db, alice, "insert into public.plan_tasks (list_id, kind, title, source, window_start, window_end) values ($1, 'own', 'Bad window', 'own', '2026-12-01', '2026-11-01')", [list]),
    /plan_tasks_window_shape/,
  );
  const other = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name) values ((select student_id from public.lists where id = $1), 'Reaches') returning id", [list]))).id;
  await assert.rejects(asUser(db, alice, "insert into public.plan_tasks (list_id, item_id, kind, title, source) values ($1, $2, 'own', 'Wrong list', 'own')", [other, item]), /plan_task_item_not_on_list/);
  await assert.rejects(asUser(db, alice, "update public.plan_tasks set list_id = $1 where list_id = $2", [other, list]), /plan_task_list_immutable/);
});

test("tasks: removing a college takes its tasks with it; a student-wide task stays", async () => {
  const { db, alice, list, item } = await world();
  await asUser(db, alice, "insert into public.plan_tasks (list_id, key, kind, title, source, due_on) values ($1, $2, 'cycle', 'FAFSA opens', 'cycle', '2026-10-01')", [list, `${list}:cycle:fafsa_opens`]);
  await asUser(db, alice, "delete from public.list_items where id = $1", [item]);
  assert.deepEqual(
    (await asUser<{ title: string }>(db, alice, "select title from public.plan_tasks where list_id = $1", [list])).map((r) => r.title),
    ["FAFSA opens"],
  );
});

test("a guardian's own list gets college and stage tasks and visits, but no cycle tasks and no offers", async () => {
  const { db, mom, alice } = await world();
  const list = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (user_id, name, is_default) values ($1, 'My list', true) returning id", [mom]))).id;
  const item = (await one(asUser<{ id: string }>(db, mom, "insert into public.list_items (list_id, unit_id) values ($1, '243744') returning id", [list]))).id;
  assert.equal(await affectedAsUser(db, mom, `insert into public.plan_tasks (list_id, item_id, key, kind, title, source) values ($1, $2, $3, 'follow', 'Follow', 'stage')`, [list, item, `${item}:follow:-`]), 1);
  assert.equal(await affectedAsUser(db, mom, "insert into public.plan_visits (item_id, kind, on_date) values ($1, 'campus_tour', '2026-10-20')", [item]), 1);
  await assert.rejects(
    asUser(db, mom, "insert into public.plan_tasks (list_id, key, kind, title, source) values ($1, 'k', 'cycle', 'FAFSA', 'cycle')", [list]),
    /plan_cycle_tasks_students_only/,
  );
  await assert.rejects(asUser(db, mom, "insert into public.plan_offers (item_id, award_year) values ($1, 2027)", [item]), /row-level security/);
  // The household reads the guardian's visit; only the guardian writes it.
  assert.equal((await asUser(db, alice, "select id from public.plan_visits where item_id = $1", [item])).length, 1);
  assert.equal(await affectedAsUser(db, alice, "update public.plan_visits set rating = 5 where item_id = $1", [item]), 0);
});

test("visits and offers follow the item's list; created_by is the signed-in user", async () => {
  const { db, mom, dad, alice, eve, item } = await world();
  const visit = await one(
    asUser<{ id: string; created_by: string }>(db, mom, "insert into public.plan_visits (item_id, kind, on_date, notes, created_by) values ($1, 'campus_tour', '2026-10-20', '{\"stood_out\": \"the quad\"}', $2) returning id, created_by", [
      item,
      alice,
    ]),
  );
  assert.equal(visit.created_by, mom);
  assert.equal((await asUser(db, dad, "select notes from public.plan_visits where id = $1", [visit.id])).length, 1, "a visit's notes are a family's, never private");
  assert.deepEqual(await asUser(db, eve, "select id from public.plan_visits where id = $1", [visit.id]), []);
  assert.equal(await affectedAsUser(db, dad, "update public.plan_visits set rating = 4 where id = $1", [visit.id]), 0);
  assert.equal(await affectedAsUser(db, alice, "update public.plan_visits set rating = 4 where id = $1", [visit.id]), 1);
  await assert.rejects(asUser(db, alice, "update public.plan_visits set rating = 6 where id = $1", [visit.id]), /check constraint/);

  assert.equal(await affectedAsUser(db, alice, `insert into public.plan_offers (item_id, award_year, coa, gift) values ($1, 2027, '{"total": 90000}', '[]')`, [item]), 1);
  assert.equal((await asUser(db, dad, "select id from public.plan_offers where item_id = $1", [item])).length, 1);
  assert.deepEqual(await asUser(db, eve, "select id from public.plan_offers where item_id = $1", [item]), []);
  await assert.rejects(asUser(db, dad, "insert into public.plan_offers (item_id, award_year) values ($1, 2027)", [item]), /row-level security/);
});

test("letters: the storage path is readable only through the owning item, and goes with it", async () => {
  const w = await world();
  await assertLettersPrivate(w);
  const { db, dad, alice, item } = w;
  await assert.rejects(asUser(db, dad, "insert into public.plan_letters (item_id, kind, storage_path) values ($1, 'aid', 'letters/b.pdf')", [item]), /row-level security/);
  assert.equal((await one(asUser<{ uploaded_by: string }>(db, alice, "select uploaded_by from public.plan_letters"))).uploaded_by, alice);
  await asUser(db, alice, "delete from public.list_items where id = $1", [item]);
  assert.deepEqual((await db.query("select id from public.plan_letters")).rows, [], "deleting the college deletes its letters");
});

/* ------------------------------------------------------------------ */
/* Rules on list_items                                                 */
/* ------------------------------------------------------------------ */

test("the Dream: one per list; marking another moves it", async () => {
  await assertOneDream(await world());
});

test("applied_on and status move together", async () => {
  const { db, alice, item } = await world();
  const read = () => one(asUser<{ status: string; applied_on: string | null; complete_on: string | null }>(db, alice, "select status, applied_on::text, complete_on::text from public.list_items where id = $1", [item]));
  await asUser(db, alice, "update public.list_items set applied_on = '2026-10-30', complete_on = '2026-11-10' where id = $1", [item]);
  assert.deepEqual(await read(), { status: "applied", applied_on: "2026-10-30", complete_on: "2026-11-10" }, "setting applied_on applies");
  await asUser(db, alice, "update public.list_items set status = 'applying' where id = $1", [item]);
  assert.deepEqual(await read(), { status: "applying", applied_on: null, complete_on: null }, "setting the status back clears the dates");
  await asUser(db, alice, "update public.list_items set applied_on = '2026-11-01' where id = $1", [item]);
  await asUser(db, alice, "update public.list_items set status = 'decided', outcome = 'admitted' where id = $1", [item]);
  assert.deepEqual(await read(), { status: "decided", applied_on: "2026-11-01", complete_on: null }, "a decision keeps the applied date");
});

test("committed_on requires enrolling, and one college per list is enrolling", async () => {
  const w = await world();
  // The trigger clears a commit date on a college that isn't enrolling…
  await asUser(w.db, w.alice, "update public.list_items set committed_on = '2027-04-01' where id = $1", [w.item]);
  assert.equal((await one(asUser<{ committed_on: string | null }>(w.db, w.alice, "select committed_on from public.list_items where id = $1", [w.item]))).committed_on, null);
  // …and the check stands behind it when the trigger is off (the service role, a script).
  await w.db.exec("alter table public.list_items disable trigger list_items_plan_rules");
  await assert.rejects(w.db.query("update public.list_items set committed_on = '2027-04-01' where id = $1", [w.item]), /list_items_committed_needs_enrolling/);
  await w.db.exec("alter table public.list_items enable trigger list_items_plan_rules");
  await assertOneEnrolling(w);
});

test("the planner columns check their values", async () => {
  const { db, alice, item } = await world();
  await assert.rejects(asUser(db, alice, "update public.list_items set followed_networks = '{myspace}' where id = $1", [item]), /check constraint/);
  await assert.rejects(asUser(db, alice, "update public.list_items set portal_url = 'javascript:alert(1)' where id = $1", [item]), /check constraint/);
  await assert.rejects(asUser(db, alice, "update public.list_items set application_platform = 'fax' where id = $1", [item]), /check constraint/);
  await assert.rejects(asUser(db, alice, "update public.lists set sort = 'vibes' where student_id is not null"), /check constraint/);
  assert.equal(
    await affectedAsUser(db, alice, "update public.list_items set followed_networks = '{instagram,x}', priority = 1, application_platform = 'common_app', portal_url = 'https://apply.example.edu' where id = $1", [item]),
    1,
  );
});

/* ------------------------------------------------------------------ */
/* Nudges                                                              */
/* ------------------------------------------------------------------ */

test("nudges: a guardian nudges within the limits; the sender and the student read it; the student replies once", async () => {
  const w = await world();
  await assertNudgeLimits(w);
  const { db, mom, dad, alice, eve, task } = w;
  assert.equal((await asUser(db, alice, "select id from public.plan_nudges where task_id = $1", [task])).length, 1, "the student reads it");
  assert.equal((await asUser(db, dad, "select id from public.plan_nudges where task_id = $1", [task])).length, 1, "the sender reads it");
  assert.deepEqual(await asUser(db, mom, "select note from public.plan_nudges"), [], "another guardian never reads its text");
  assert.deepEqual(await asUser(db, eve, "select note from public.plan_nudges"), []);
  await assert.rejects(asUser(db, dad, "insert into public.plan_nudges (task_id, from_user, to_student, channel) values ($1, $2, $3, 'app')", [task, dad, w.student]), /permission denied/);
  assert.equal(await affectedAsUser(db, dad, "update public.plan_nudges set reply = 'ok' where task_id = $1", [task]), 0, "only the student replies");
  assert.equal(await affectedAsUser(db, alice, "update public.plan_nudges set reply = 'On it' where task_id = $1", [task]), 1);
  const replied = await one(asUser<{ reply: string; replied_at: string | null }>(db, dad, "select reply, replied_at from public.plan_nudges where task_id = $1", [task]));
  assert.equal(replied.reply, "On it");
  assert.ok(replied.replied_at, "the server stamps the reply");
  await assert.rejects(asUser(db, alice, "update public.plan_nudges set reply = 'Changed my mind' where task_id = $1", [task]), /nudge_already_answered/);
  await assert.rejects(asUser(db, alice, "update public.plan_nudges set note = 'edited' where task_id = $1", [task]), /permission denied/);
});

test("nudges: only a guardian of the student, never on a closed task, never to a managed student", async () => {
  const { db, mom, alice, eve, household, list, task } = await world();
  await assert.rejects(rpc(db, alice, "public.send_nudge($1, null, 'app')", [task]), /not_allowed/, "a student doesn't nudge themselves");
  await assert.rejects(rpc(db, eve, "public.send_nudge($1, null, 'app')", [task]), /not_allowed/);
  await assert.rejects(rpc(db, mom, "public.send_nudge($1, null, 'carrier_pigeon')", [task]), /invalid_channel/);
  await assert.rejects(rpc(db, mom, "public.send_nudge($1, $2, 'app')", [task, "x".repeat(201)]), /invalid_note/);
  await asUser(db, alice, "update public.plan_tasks set done_at = now() where id = $1", [task]);
  await assert.rejects(rpc(db, mom, "public.send_nudge($1, null, 'app')", [task]), /task_closed/);
  void list;

  const managed = await rpc<string>(db, mom, "public.add_managed_student($1, 'Jordan', 2029)", [household]);
  const mlist = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [managed]))).id;
  const mtask = (await one(asUser<{ id: string }>(db, mom, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', 'Visit', 'own') returning id", [mlist]))).id;
  await assert.rejects(rpc(db, mom, "public.send_nudge($1, null, 'app')", [mtask]), /nudge_no_account/);
});

/* ------------------------------------------------------------------ */
/* Calendar tokens and text consents                                   */
/* ------------------------------------------------------------------ */

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

test("calendar tokens: the creator only; the feed's lookup finds a live token and nothing once revoked", async () => {
  const w = await world();
  const { db, alice, eve, list } = w;
  const hash = sha("secret-token");
  await asUser(db, alice, "insert into public.plan_calendar_tokens (list_id, token_hash) values ($1, $2)", [list, hash]);
  await assertTokensPrivate(w, hash);
  await assert.rejects(asUser(db, eve, "insert into public.plan_calendar_tokens (list_id, token_hash) values ($1, $2)", [list, sha("eve")]), /row-level security/);
  assert.equal(await rpc<string | null>(db, null, "public.plan_for_calendar_token($1)", [sha("wrong")]), null);
  assert.equal(await affectedAsUser(db, alice, "update public.plan_calendar_tokens set revoked_at = now() where list_id = $1", [list]), 1);
  assert.equal(await rpc<string | null>(db, null, "public.plan_for_calendar_token($1)", [hash]), null, "a revoked token finds nothing");
});

test("text consents: a guardian consents for a student; the student and guardians read it; only the webhook records a STOP", async () => {
  const { db, mom, dad, alice, eve, student } = await world();
  assert.equal(await affectedAsUser(db, mom, "insert into public.sms_consents (student_id, phone) values ($1, '+16155550100')", [student]), 1);
  const row = await one(asUser<{ consented_by: string }>(db, alice, "select consented_by from public.sms_consents where student_id = $1", [student]));
  assert.equal(row.consented_by, mom, "the student sees who turned it on");
  assert.equal((await asUser(db, dad, "select id from public.sms_consents")).length, 1);
  assert.deepEqual(await asUser(db, eve, "select id from public.sms_consents"), []);
  await assert.rejects(asUser(db, eve, "insert into public.sms_consents (student_id, phone) values ($1, '+16155550101')", [student]), /row-level security/);
  await assert.rejects(asUser(db, mom, "insert into public.sms_consents (student_id, phone) values ($1, '+16155550102')", [student]), /sms_consents_active_student_idx/, "one active consent per person");
  await assert.rejects(asUser(db, alice, "update public.sms_consents set provider_opt_out_at = now() where student_id = $1", [student]), /permission denied/);
  assert.equal(await affectedAsUser(db, alice, "update public.sms_consents set revoked_at = now() where student_id = $1", [student]), 1, "the student turns it off");
  assert.equal(await affectedAsUser(db, eve, "insert into public.sms_consents (user_id, phone) values ($1, '+16155550109')", [eve]), 1, "an adult consents for themselves");
  await assert.rejects(asUser(db, eve, "insert into public.sms_consents (user_id, phone) values ($1, '+16155550108')", [mom]), /row-level security/);
});

/* ------------------------------------------------------------------ */
/* Guards: break a rule on purpose and show the check notices          */
/* ------------------------------------------------------------------ */

test("guard: without the Dream trigger and index a list can have two Dreams, and assertOneDream fails", async () => {
  const w = await world();
  await w.db.exec("drop trigger list_items_plan_rules on public.list_items; drop index public.list_items_one_dream_idx;");
  await assert.rejects(assertOneDream(w), assert.AssertionError);
});

test("guard: a task policy that lets any reader write lets a view-only guardian tick, and assertTaskAccess fails", async () => {
  const w = await world();
  await w.db.exec(`drop policy "Tasks: update" on public.plan_tasks;
    create policy "Tasks: update" on public.plan_tasks for update to authenticated using (public.can_read_list(list_id)) with check (true);`);
  await assert.rejects(assertTaskAccess(w), assert.AssertionError);
});

test("guard: without the one-enrolling part of the trigger two colleges are chosen, and assertOneEnrolling fails", async () => {
  const w = await world();
  await w.db.exec(`drop index public.list_items_one_enrolling_idx;
    create or replace function public.list_items_plan_rules() returns trigger language plpgsql set search_path = '' as $$
    begin if not new.enrolling then new.committed_on := null; end if; return new; end $$;`);
  await assert.rejects(assertOneEnrolling(w), assert.AssertionError);
});

test("guard: a token policy open to the household shows the token to others, and assertTokensPrivate fails", async () => {
  const w = await world();
  const hash = sha("secret-token");
  await asUser(w.db, w.alice, "insert into public.plan_calendar_tokens (list_id, token_hash) values ($1, $2)", [w.list, hash]);
  await w.db.exec(`drop policy "Calendar tokens: creator reads" on public.plan_calendar_tokens;
    create policy "Calendar tokens: creator reads" on public.plan_calendar_tokens for select to authenticated using (public.can_read_list(list_id));`);
  await assert.rejects(assertTokensPrivate(w, hash), assert.AssertionError);
});

test("guard: send_nudge without its limits lets a fourth nudge through, and assertNudgeLimits fails", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.send_nudge(p_task uuid, p_note text, p_channel text) returns public.plan_nudges
    language plpgsql security definer set search_path = '' as $$
    declare v_row public.plan_nudges; v_student uuid;
    begin
      select l.student_id into v_student from public.plan_tasks t join public.lists l on l.id = t.list_id where t.id = p_task;
      insert into public.plan_nudges (task_id, from_user, to_student, note, channel) values (p_task, auth.uid(), v_student, p_note, p_channel) returning * into v_row;
      return v_row;
    end $$;`);
  await assert.rejects(assertNudgeLimits(w), assert.AssertionError);
});

test("guard: a letters policy that reads past the item shows the path to an outsider, and assertLettersPrivate fails", async () => {
  const w = await world();
  await w.db.exec(`drop policy "Letters: read" on public.plan_letters;
    create policy "Letters: read" on public.plan_letters for select to authenticated using (true);`);
  await assert.rejects(assertLettersPrivate(w), assert.AssertionError);
});
