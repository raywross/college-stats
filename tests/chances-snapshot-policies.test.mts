/**
 * Application snapshots and the accuracy summary against real Postgres (PGlite with the auth stub, every migration in
 * order; 20261011100000_application_snapshots.sql, 20261011110000_chances_summary.sql). A snapshot is written only
 * through record_application_snapshot() by someone who can edit the list, for an applied item on a student's list;
 * it is read by the list's readers only and deleted by the student; its consent follows the list's; the season-end
 * cleanup deletes only unconsented rows of finished seasons and only the service role runs it; the measurements' read
 * carries no ids; the "students like you" function returns nothing for a thin cell; the summary is public to read and
 * written only by the service role. Guard tests break a rule on purpose and show the check fail. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/** Runs a statement as the service role (scripts, the weekly cron). */
async function asService<T = Record<string, unknown>>(db: AuthDb, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const SNAP = JSON.stringify({ gpa: 3.85, test_kind: "sat", test_score: 1440, state: "IN", majors: ["14"], estimate_group: "target", model_version: "2026.1", note_keys: ["rigor.much"], position: "in", base_rate_kind: "overall" });

/** The Smiths, as in tests/planner-offers-policies.test.mts: Mom (edits Alice, manages Ben), Dad (view only), Alice (own account), Ben (managed), Eve outside. */
async function world() {
  const db = await boot();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Sam Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve" });
  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  const inviteDad = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, $2, 'guardian', null, false, null, null, null)", [household, "dad@example.com"]);
  await rpc(db, dad, "public.accept_invitation($1)", [inviteDad.token]);
  const inviteAlice = await rpc<{ token: string }>(db, mom, "public.create_invitation($1, $2, 'student', null, false, null, null, null)", [household, "alice@example.com"]);
  await rpc(db, alice, "public.accept_invitation($1)", [inviteAlice.token]);
  const student = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const momMember = (await one(asUser<{ member_id: string }>(db, alice, "select member_id from public.household_roster($1) where user_id = $2", [household, mom]))).member_id;
  await asUser(db, alice, "select public.set_member_can_edit($1, true)", [momMember]);
  const list = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]))).id;
  const item = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position, category, category_source) values ($1, '243744', 0, 'reach', 'student') returning id", [list]))).id;
  const item2 = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position) values ($1, '166027', 1) returning id", [list]))).id;
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2029)", [household]);
  const benList = (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [ben]))).id;
  const benItem = (await one(asUser<{ id: string }>(db, mom, "insert into public.list_items (list_id, unit_id, position) values ($1, '243744', 0) returning id", [benList]))).id;
  const existing = await asUser<{ id: string }>(db, mom, "select id from public.lists where user_id = $1", [mom]);
  const momList = existing[0]?.id ?? (await one(asUser<{ id: string }>(db, mom, "insert into public.lists (user_id, name, is_default) values ($1, 'Mine', true) returning id", [mom]))).id;
  const momItem = (await one(asUser<{ id: string }>(db, mom, "insert into public.list_items (list_id, unit_id, position) values ($1, '243744', 0) returning id", [momList]))).id;
  // Applied in November: the season of the class entering next fall.
  for (const [who, id] of [[alice, item], [alice, item2], [mom, benItem], [mom, momItem]] as const) {
    await asUser(db, who, "update public.list_items set applied_on = '2026-11-01' where id = $1", [id]);
  }
  return { db, mom, dad, alice, eve, household, student, list, item, item2, ben, benList, benItem, momList, momItem };
}

type World = Awaited<ReturnType<typeof world>>;

const record = (w: World, who: string, item: string, snap = SNAP) => rpc<string>(w.db, who, "public.record_application_snapshot($1, $2::jsonb)", [item, snap]);

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/** Writes go through the function, by an editor, for an applied item on a student's list; the database sets who, when, and the season. */
async function assertWriteRules(w: World) {
  const { db, mom, dad, alice, eve, item, momItem, list, student } = w;
  await record(w, alice, item, JSON.stringify({ ...JSON.parse(SNAP), student_id: eve, list_id: w.benList, season: 1999, consented: true, unit_id: "1" }));
  const row = await one(asUser<{ student_id: string; list_id: string; unit_id: string; season: number; consented: boolean; applied_on: string; gpa: string; majors: string[] }>(
    db, alice, "select student_id, list_id, unit_id, season, consented, applied_on::text, gpa::text, majors from public.application_snapshots where item_id = $1", [item],
  ));
  assert.deepEqual([row.student_id, row.list_id, row.unit_id, row.season, row.consented, row.applied_on], [student, list, "243744", 2027, false, "2026-11-01"], "identity, season, and consent come from the database");
  assert.deepEqual([row.gpa, row.majors], ["3.85", ["14"]]);
  // Re-recording replaces the row (one per item).
  await record(w, mom, item, JSON.stringify({ ...JSON.parse(SNAP), gpa: 3.9 }));
  assert.equal((await asUser(db, alice, "select id from public.application_snapshots where item_id = $1", [item])).length, 1);
  assert.equal((await one(asUser<{ gpa: string }>(db, alice, "select gpa::text from public.application_snapshots where item_id = $1", [item]))).gpa, "3.90");
  await assert.rejects(record(w, dad, item), /not_allowed/, "a view-only guardian can't write one");
  await assert.rejects(record(w, eve, item), /not_allowed/, "an outsider can't");
  await assert.rejects(record(w, mom, momItem), /not_allowed/, "a guardian's own list has no snapshots");
  await asUser(db, alice, "update public.list_items set applied_on = null, status = 'applying' where id = $1", [w.item2]);
  await assert.rejects(record(w, alice, w.item2), /not_applied/, "only an applied item");
  await assert.rejects(asUser(db, alice, "insert into public.application_snapshots (item_id, list_id, student_id, unit_id, season, applied_on) values ($1, $2, $3, '1', 2027, '2026-11-01')", [w.item2, list, student]), /permission denied/, "no direct insert");
  await assert.rejects(asUser(db, alice, "update public.application_snapshots set estimate_group = 'likely' where item_id = $1", [item]), /permission denied/, "no direct update");
  await assert.rejects(record(w, alice, item, JSON.stringify({ gpa: 3.87 })), /check constraint/, "an unbinned GPA is refused");
  await assert.rejects(record(w, alice, item, JSON.stringify({ state: "Lincoln High" })), /check constraint/, "free text is refused");
  await assert.rejects(record(w, alice, item, JSON.stringify({ test_kind: "sat", test_score: 1437 })), /check constraint/, "an unbinned score is refused");
}

/** Read by the list's readers (the student, both guardians) only; deleted by the student only. */
async function assertReadAndDelete(w: World) {
  const { db, mom, dad, alice, eve, item, benItem } = w;
  await record(w, alice, item);
  await record(w, mom, benItem);
  for (const who of [alice, mom, dad]) assert.equal((await asUser(db, who, "select id from public.application_snapshots where item_id = $1", [item])).length, 1, "the student and the guardians who read the list");
  assert.deepEqual(await asUser(db, eve, "select id from public.application_snapshots"), [], "an outsider sees nothing");
  assert.deepEqual(await asUser(db, null, "select 1 from public.application_snapshots").catch(() => "denied"), "denied", "signed out: no access at all");
  assert.equal(await affectedAsUser(db, mom, "delete from public.application_snapshots where item_id = $1", [item]), 0, "a guardian can't delete a student-with-account's rows");
  assert.equal(await affectedAsUser(db, dad, "delete from public.application_snapshots where item_id = $1", [benItem]), 0, "a view-only guardian can't delete a managed student's");
  assert.equal(await affectedAsUser(db, mom, "delete from public.application_snapshots where item_id = $1", [benItem]), 1, "an editing guardian of a managed student can");
  assert.equal(await affectedAsUser(db, alice, "delete from public.application_snapshots where item_id = $1", [item]), 1, "the student deletes their own");
}

/** The consent flag follows the list's; removing the college removes the snapshot. */
async function assertConsentFollowsList(w: World) {
  const { db, alice, item, list } = w;
  await record(w, alice, item);
  const flag = async () => (await one(asUser<{ consented: boolean }>(db, alice, "select consented from public.application_snapshots where item_id = $1", [item]))).consented;
  assert.equal(await flag(), false);
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = now() where id = $1", [list]);
  assert.equal(await flag(), true, "a later consent covers the snapshot already taken");
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = null where id = $1", [list]);
  assert.equal(await flag(), false, "revoking takes it out of every future use");
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = now() where id = $1", [list]);
  await record(w, alice, item);
  assert.equal(await flag(), true, "a snapshot written after consent is consented");
  await asUser(db, alice, "delete from public.list_items where id = $1", [item]);
  assert.deepEqual((await db.query("select id from public.application_snapshots")).rows, [], "the snapshot goes with the college");
}

/** The season-end cleanup: unconsented rows of finished seasons only, service role only. */
async function assertCleanup(w: World) {
  const { db, alice, mom, item, item2, benItem, list } = w;
  await record(w, alice, item);
  await asUser(db, alice, "update public.list_items set applied_on = '2026-12-01' where id = $1", [item2]);
  await record(w, alice, item2);
  await record(w, mom, benItem);
  // Alice consents; Ben's guardian doesn't. Push Alice's first and Ben's snapshot into a finished season.
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = now() where id = $1", [list]);
  const last = (await one(db.query<{ s: number }>("select public.last_finished_season() as s").then((r) => r.rows))).s;
  await db.query("update public.application_snapshots set season = $1 where item_id in ($2, $3)", [last, item, benItem]);
  await db.query("update public.application_snapshots set season = $1 where item_id = $2", [last + 1, item2]);
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = null where id = $1", [list]);
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = now() where id = $1", [list]);
  await db.query("update public.application_snapshots set consented = false where item_id = $1", [item2]);

  await assert.rejects(asUser(db, alice, "select public.delete_unconsented_snapshots()"), /permission denied/, "users can't run it");
  await assert.rejects(asService(db, "select public.delete_unconsented_snapshots($1)", [last + 1]), /season_not_finished/, "an unfinished season is refused");
  const [{ n }] = await asService<{ n: number }>(db, "select public.delete_unconsented_snapshots() as n");
  assert.equal(n, 1, "only Ben's unconsented, finished-season row");
  const left = (await db.query<{ item_id: string }>("select item_id from public.application_snapshots order by item_id")).rows.map((r) => r.item_id).sort();
  assert.deepEqual(left, [item, item2].sort(), "consented rows stay; the season in progress stays even unconsented");
}

/** The measurements' read: consented rows only, no ids; service role only. */
async function assertOutcomeRows(w: World) {
  const { db, alice, mom, item, benItem, list } = w;
  await record(w, alice, item);
  await record(w, mom, benItem);
  await asUser(db, alice, "update public.lists set outcome_share_consented_at = now() where id = $1", [list]);
  await asUser(db, alice, "update public.list_items set status = 'decided', outcome = 'admitted' where id = $1", [item]);
  await assert.rejects(asUser(db, alice, "select public.chances_outcome_rows()"), /permission denied/);
  const rows = (await asService<{ r: Record<string, unknown> }>(db, "select r from public.chances_outcome_rows() r")).map((x) => x.r);
  assert.equal(rows.length, 1, "Ben's unconsented row isn't read");
  assert.equal(rows[0].outcome, "admitted");
  assert.equal(rows[0].estimate_group, "target");
  for (const k of ["id", "item_id", "list_id", "student_id", "created_at"]) assert.ok(!(k in rows[0]), `no ${k}`);
  // A soft-deleted student's rows aren't read.
  await db.query("update public.students set deleted_at = now() where id = $1", [w.student]);
  assert.equal((await asService(db, "select r from public.chances_outcome_rows() r")).length, 0);
}

/** "Students like you": nothing for a thin cell; the counts once the cell clears every threshold. */
async function assertLikeYou(w: World, opts: { admitted: number; notAdmitted: number }) {
  const { db, student, list } = w;
  // Synthetic consented outcomes at one college, set up directly (the superuser session), one item per outcome.
  await db.query("update public.lists set outcome_share_consented_at = now() where id = $1", [list]);
  const total = opts.admitted + opts.notAdmitted;
  for (let i = 0; i < total; i++) {
    const unit = String(900000 + i);
    const itemId = (await db.query<{ id: string }>("insert into public.list_items (list_id, unit_id, position, status, applied_on, outcome) values ($1, $2, $3, 'decided', '2026-11-01', $4) returning id", [list, unit, 10 + i, i < opts.admitted ? "admitted" : "denied"])).rows[0].id;
    await db.query("insert into public.application_snapshots (item_id, list_id, student_id, unit_id, season, applied_on, position, base_rate_kind, state, consented) values ($1, $2, $3, '228778', 2026, '2025-11-01', 'in', 'residency', 'TX', true)", [itemId, list, student]);
  }
  return asUser<{ n: number; admitted: number }>(db, null, "select * from public.chances_like_you('228778', 'in', 'residency', 'TX', 2024, 2026)");
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test("snapshots: written only through the function, by an editor, for an applied item on a student's list", async () => {
  await assertWriteRules(await world());
});

test("snapshots: read by the list's readers only, deleted by the student (or the managing guardian)", async () => {
  await assertReadAndDelete(await world());
});

test("snapshots: the consent flag follows the list's consent; the row goes with the college", async () => {
  await assertConsentFollowsList(await world());
});

test("season-end cleanup: unconsented rows of finished seasons only; service role only", async () => {
  await assertCleanup(await world());
});

test("the measurements' read: consented, live students' rows with their outcome and no ids", async () => {
  await assertOutcomeRows(await world());
});

test("students like you: a cell of 50 with 10 each way shows; 49, or 9 admitted, or 9 not admitted, shows nothing", async () => {
  assert.deepEqual(await assertLikeYou(await world(), { admitted: 40, notAdmitted: 10 }), [{ n: 50, admitted: 40 }]);
  assert.deepEqual(await assertLikeYou(await world(), { admitted: 39, notAdmitted: 10 }), [], "49 outcomes");
  assert.deepEqual(await assertLikeYou(await world(), { admitted: 9, notAdmitted: 45 }), [], "9 admitted");
  assert.deepEqual(await assertLikeYou(await world(), { admitted: 45, notAdmitted: 9 }), [], "9 not admitted");
});

test("the summary: anyone reads it; only the service role writes it", async () => {
  const w = await world();
  const { db, alice } = w;
  await asService(db, "insert into public.chances_summary (season, model_version, scope, estimate_group, rate_band, n, admitted, interval_low, interval_high) values (2026, '2026.1', 'estimate', 'likely', 'lt20', 40, 36, 0.79, 0.95)");
  await asService(db, "insert into public.chances_summary (season, model_version, scope, n, sharers_mix) values (2026, '2026.1', 'all', 40, '{\"n\":40}')");
  assert.equal((await asUser(db, null, "select n from public.chances_summary")).length, 2, "signed out reads it");
  assert.equal((await asUser(db, alice, "select n from public.chances_summary")).length, 2);
  await assert.rejects(asUser(db, alice, "insert into public.chances_summary (season, model_version, scope, n) values (2026, 'x', 'all', 1)"), /permission denied/);
  await assert.rejects(asUser(db, null, "delete from public.chances_summary"), /permission denied/);
  await assert.rejects(asService(db, "insert into public.chances_summary (season, model_version, scope, estimate_group, rate_band, n, admitted) values (2026, '2026.1', 'estimate', 'reach', 'lt20', 10, 3)"), /check constraint/, "a share needs its interval");
  await assert.rejects(asService(db, "insert into public.chances_summary (season, model_version, scope, estimate_group, rate_band, n) values (2026, '2026.1', 'estimate', 'likely', 'lt20', 40)"), /unique/, "one row per cell");
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

test("guard: a read policy open to everyone shows an outsider the rows, and the check fails", async () => {
  const w = await world();
  await w.db.exec(`drop policy "Snapshots: read" on public.application_snapshots; create policy "Snapshots: read" on public.application_snapshots for select to authenticated using (true);`);
  await assert.rejects(assertReadAndDelete(w), /outsider sees nothing/);
});

test("guard: a cleanup that ignores consent deletes a consented row, and the check fails", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.delete_unconsented_snapshots(p_season integer default null) returns integer language plpgsql security definer set search_path = '' as $$
    declare v_count integer; begin
    if p_season > public.last_finished_season() then raise exception 'season_not_finished'; end if;
    delete from public.application_snapshots where season <= coalesce(p_season, public.last_finished_season()); get diagnostics v_count = row_count; return v_count; end; $$;`);
  await assert.rejects(assertCleanup(w), /only Ben's/);
});

test("guard: without the consent trigger a later consent doesn't reach the snapshot, and the check fails", async () => {
  const w = await world();
  await w.db.exec("drop trigger lists_sync_snapshots on public.lists");
  await assert.rejects(assertConsentFollowsList(w), /later consent covers/);
});

test("guard: a like-you function without the sub-count rule shows a cell with 9 admitted, and the check fails", async () => {
  const w = await world();
  await w.db.exec(`create or replace function public.chances_like_you(p_unit text, p_position text, p_base_rate_kind text, p_state text, p_from_season integer, p_to_season integer)
    returns table (n integer, admitted integer) language sql stable security definer set search_path = '' as $$
    select count(*)::integer, (count(*) filter (where li.outcome = 'admitted'))::integer from public.application_snapshots s join public.list_items li on li.id = s.item_id
    where s.consented and s.unit_id = p_unit and s.position = p_position and s.base_rate_kind = p_base_rate_kind and s.season between p_from_season and p_to_season
    having count(*) >= 50 $$;`);
  const rows = await assertLikeYou(w, { admitted: 9, notAdmitted: 45 });
  assert.throws(() => assert.deepEqual(rows, []));
});
