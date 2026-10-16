/**
 * The batched reads and the profile write against real Postgres (PGlite with the auth stub, every migration in order;
 * 20261012140000_plan_bundle.sql). viewer_bundle() and plan_bundle() return exactly what the per-table reads they
 * replace return, for each caller (row-level security still decides: they are security invoker); an outsider gets
 * nothing of the household; save_student_profile() writes only where the table write could (a view-only guardian
 * and an outsider are refused), stamps the caller, and keeps the grad-year sync best-effort. Guard tests break a rule
 * on purpose and show the check fail. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BUNDLE = "20261012140000_plan_bundle.sql";
const PAUSE = "20261013100000_viewer_bundle_pause.sql";
const NEXT_STEPS = "20261014120000_next_steps.sql";
const PLAN_V3 = "20261016120000_plan_v3.sql";

async function boot(files = ALL): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of files) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}
const rpc = async <T,>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []) => (await one(asUser<{ v: T }>(db, who, `select ${sql} as v`, params))).v;

/** A per-table read as PostgREST returns it (rows as JSON), so it compares with the bundle's JSON directly. */
const rowsAs = (db: AuthDb, who: string, sql: string, params: unknown[] = []) => rpc<unknown[]>(db, who, `coalesce((select jsonb_agg(to_jsonb(t)) from (${sql}) t), '[]'::jsonb)`, params);

// suspended_at: the pause (20261012200000_admin.sql), which lib/auth.ts reads too and 20261013100000_viewer_bundle_pause.sql adds to the bundle.
const PROFILE_COLS = "id, display_name, birth_year, role_hint, created, updated, deleted_at, suspended_at";
const STUDENT_COLS = "id, user_id, display_name, grad_year, managed_by, created, deleted_at";
const MEMBER_COLS = "id, household_id, user_id, student_id, role, status, invited_email, can_edit, created, accepted_at";
const HOME_COLS = "household_id, lat, lng, label, place, zip, set_by, set_by_name, updated_at";
const LIST_COLS = "id, student_id, user_id, name, is_default, share_enabled, created_by, created, sort, rounds_plan_accepted_at";
const ITEM_COLS =
  "id, list_id, unit_id, category, status, outcome, round, position, added_by, added_at, decision_date, deadline_text, deadline_date, enrolling, updates, visited_on, follows_social, dream, priority, followed_networks, info_requested_on, application_platform, applied_on, complete_on, portal_url, committed_on, withdrawn_on, recommendations_count, supplements_count, transcript_shared, category_source, round_source, legacy, recruited, legacy_sibling, ed_dismissed_at, ed_checks";
const TASK_COLS =
  "id, list_id, item_id, key, kind, title, detail, due_on, window_start, window_end, assignee, source, source_field, source_edition, date_note, done_at, done_by, snoozed_until, dismissed, orphaned, position, created_by, created_at, season, action, dismissed_at, dismissed_by";
const VISIT_COLS = "id, item_id, kind, on_date, at_time, registered, registration_url, who, rating, notes, created_by, created_at, updated_at";
const OFFER_COLS = "id, item_id, award_year, letter_date, source, coa, gift, work_study, loans, quotes, pros, cons, confirmed_at, created_by, created_at";
const NUDGE_COLS = "id, task_id, from_user, to_student, note, sent_at, channel, reply, replied_at";

/** The Smiths: Mom (edits Alice, manages Ben), Dad (view only), Alice (own account), Ben (managed), Eve outside. */
async function world(files = ALL) {
  const db = await boot(files);
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
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben', 2029)", [household]);
  // Alice: an older second list, then her default list with two colleges, tasks, a visit, an offer, a nudge.
  await asUser(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'Ideas', false)", [student]);
  const list = (await one(asUser<{ id: string }>(db, alice, "insert into public.lists (student_id, name, is_default) values ($1, 'My list', true) returning id", [student]))).id;
  const item = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position, category, category_source) values ($1, '243744', 0, 'reach', 'student') returning id", [list]))).id;
  const item2 = (await one(asUser<{ id: string }>(db, alice, "insert into public.list_items (list_id, unit_id, position) values ($1, '166027', 1) returning id", [list]))).id;
  const task = (await one(asUser<{ id: string }>(db, alice, "insert into public.plan_tasks (list_id, item_id, key, kind, title, due_on, source) values ($1, $2, $3, 'apply', 'Stanford: apply', '2026-11-01', 'college') returning id", [list, item, `${item}:apply:ed`]))).id;
  await asUser(db, alice, "insert into public.plan_tasks (list_id, kind, title, source) values ($1, 'own', 'Undated', 'own')", [list]);
  await db.query("insert into public.plan_visits (item_id, kind, on_date) values ($1, 'campus_tour', '2026-10-20')", [item2]);
  await db.query("insert into public.plan_offers (item_id, award_year) values ($1, 2027)", [item]);
  await db.query("insert into public.plan_nudges (task_id, from_user, to_student, note, channel) values ($1, $2, $3, 'Go', 'app')", [task, mom, student]).catch(async () => {
    await db.query("insert into public.plan_nudges (task_id, from_user, to_student, note) values ($1, $2, $3, 'Go')", [task, mom, student]);
  });
  await asUser(db, alice, "insert into public.student_profiles (student_id, data, updated_by) values ($1, $2::jsonb, $3)", [student, JSON.stringify({ basics: { gradYear: 2027 } }), alice]);
  await asUser(
    db,
    mom,
    "insert into public.household_homes (household_id, lat, lng, label, place, zip, set_by, set_by_name) values ($1, 42.373, -71.109, '1 Main St, Cambridge, MA 02139', 'Cambridge, MA', '02139', $2, 'Tracy')",
    [household, mom],
  );
  // Eve's own household, so "nothing of the Smiths" is about policy, not an empty database.
  await rpc<string>(db, eve, "public.create_household('Eve home', 'guardian')");
  return { db, mom, dad, alice, eve, household, student, ben, list, item, item2, task };
}

type World = Awaited<ReturnType<typeof world>>;

const byId = (rows: unknown[]) => [...(rows as { id: string }[])].sort((a, b) => a.id.localeCompare(b.id));

/** What the per-table reads return for `who` (lib/auth.ts, lib/households.ts, lib/student-profile-store.ts, lib/home-store.ts). */
async function viewerByTables(w: World, who: string) {
  const { db } = w;
  const profile = (await rowsAs(db, who, `select ${PROFILE_COLS} from public.profiles where id = $1`, [who]))[0] ?? null;
  const students = await rowsAs(db, who, `select ${STUDENT_COLS} from public.students where deleted_at is null`);
  const members = await rowsAs(db, who, `select ${MEMBER_COLS} from public.household_members`);
  const households = (await rowsAs(db, who, "select id, name, created from public.households where deleted_at is null order by created")) as { id: string }[];
  const withRoster = [];
  for (const h of households) withRoster.push({ ...h, members: await rowsAs(db, who, "select * from public.household_roster($1)", [h.id]) });
  const studentProfiles = await rowsAs(db, who, "select student_id, data from public.student_profiles order by student_id");
  const household = await rpc<string | null>(db, who, "public.my_household()");
  const home = household ? ((await rowsAs(db, who, `select ${HOME_COLS} from public.household_homes where household_id = $1`, [household]))[0] ?? null) : null;
  return { profile, students: byId(students), members: byId(members), households: withRoster, student_profiles: studentProfiles, home };
}

async function viewerByBundle(w: World, who: string) {
  const b = await rpc<Record<string, unknown[]> & { profile: unknown; home: unknown }>(w.db, who, "public.viewer_bundle()");
  return { profile: b.profile, students: byId(b.students), members: byId(b.members), households: b.households, student_profiles: b.student_profiles, home: b.home };
}

/** lib/planner/read-plan.ts readPlan, table by table, for the list load.ts would pick. */
async function planByTables(w: World, who: string, studentId: string) {
  const { db } = w;
  const lists = (await rowsAs(db, who, "select id, is_default from public.lists where student_id = $1 order by is_default desc, created", [studentId])) as { id: string; is_default: boolean }[];
  const listId = lists.find((l) => l.is_default)?.id ?? lists[0]?.id ?? null;
  const student = (await rowsAs(db, who, `select ${STUDENT_COLS} from public.students where id = $1 and deleted_at is null`, [studentId]))[0] ?? null;
  if (!listId) return { student, list: null, items: [], tasks: [], visits: [], offers: [], nudges: [] };
  const list = (await rowsAs(db, who, `select ${LIST_COLS} from public.lists where id = $1`, [listId]))[0] ?? null;
  const items = (await rowsAs(db, who, `select ${ITEM_COLS} from public.list_items where list_id = $1 order by position`, [listId])) as { id: string }[];
  const tasks = (await rowsAs(db, who, `select ${TASK_COLS} from public.plan_tasks where list_id = $1 order by due_on asc nulls last, position`, [listId])) as { id: string }[];
  const itemIds = items.map((i) => i.id);
  const taskIds = tasks.map((t) => t.id);
  const visits = itemIds.length ? await rowsAs(db, who, `select ${VISIT_COLS} from public.plan_visits where item_id = any($1::uuid[]) order by on_date`, [itemIds]) : [];
  const offers = itemIds.length ? await rowsAs(db, who, `select ${OFFER_COLS} from public.plan_offers where item_id = any($1::uuid[]) order by created_at`, [itemIds]) : [];
  const nudges = taskIds.length ? await rowsAs(db, who, `select ${NUDGE_COLS} from public.plan_nudges where task_id = any($1::uuid[]) order by sent_at desc`, [taskIds]) : [];
  return { student, list, items, tasks, visits, offers, nudges };
}

const planByBundle = (w: World, who: string, studentId: string | null) => rpc<Record<string, unknown>>(w.db, who, "public.plan_bundle($1)", [studentId]);

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

let shared: Promise<World> | null = null;
const smiths = () => (shared ??= world());

test("viewer_bundle() returns what the per-table reads return, for every caller", async () => {
  const w = await smiths();
  for (const who of [w.alice, w.mom, w.dad, w.eve]) assert.deepEqual(await viewerByBundle(w, who), await viewerByTables(w, who));
});

test("viewer_bundle(): an outsider gets nothing of the Smiths; signed out can't call it", async () => {
  const w = await smiths();
  const eve = await viewerByBundle(w, w.eve);
  const text = JSON.stringify(eve);
  for (const id of [w.student, w.ben, w.household, w.mom, w.alice]) assert.ok(!text.includes(id), `Eve's bundle mentions ${id}`);
  assert.equal(eve.home, null);
  await assert.rejects(asUser(w.db, null, "select public.viewer_bundle()"), /permission denied/);
});

test("plan_bundle() returns what readPlan returns, for the student, both guardians, and an outsider", async () => {
  const w = await smiths();
  for (const who of [w.alice, w.mom, w.dad, w.eve]) {
    for (const s of [w.student, w.ben]) assert.deepEqual(await planByBundle(w, who, s), await planByTables(w, who, s), `caller ${who}, student ${s}`);
  }
  const alice = await planByBundle(w, w.alice, w.student);
  assert.equal((alice.list as { id: string }).id, w.list, "the default list, not the older one");
  assert.equal((alice.items as unknown[]).length, 2);
  assert.equal((alice.tasks as { title: string }[]).at(-1)?.title, "Undated", "undated tasks last");
  assert.equal((alice.visits as unknown[]).length, 1);
  assert.equal((alice.offers as unknown[]).length, 1);
  assert.equal((alice.nudges as unknown[]).length, 1);
  const eve = await planByBundle(w, w.eve, w.student);
  assert.deepEqual([eve.student, eve.list, eve.items, eve.tasks, eve.visits, eve.offers, eve.nudges], [null, null, [], [], [], [], []], "an outsider gets nothing");
  await assert.rejects(asUser(w.db, null, "select public.plan_bundle(null)"), /permission denied/);
});

test("plan_bundle(null) is the caller's own student; a named list is read as named", async () => {
  const w = await smiths();
  assert.deepEqual(await planByBundle(w, w.alice, null), await planByBundle(w, w.alice, w.student));
  const mom = await planByBundle(w, w.mom, null);
  assert.equal(mom.student, null, "a guardian has no student record of their own");
  const ideas = (await one(asUser<{ id: string }>(w.db, w.alice, "select id from public.lists where name = 'Ideas'"))).id;
  const named = await rpc<{ list: { id: string } }>(w.db, w.alice, "public.plan_bundle($1, $2)", [w.student, ideas]);
  assert.equal(named.list.id, ideas);
  // A named list brings its own student (the follow-up pass knows only the list): Mom gets Alice's row with it.
  const byList = await rpc<{ student: { id: string; grad_year: number | null }; list: { id: string } }>(w.db, w.mom, "public.plan_bundle(null, $1)", [w.list]);
  assert.deepEqual([byList.student.id, byList.list.id], [w.student, w.list]);
  const eveByList = await rpc<{ student: unknown; list: unknown; items: unknown[] }>(w.db, w.eve, "public.plan_bundle(null, $1)", [w.list]);
  assert.deepEqual([eveByList.student, eveByList.list, eveByList.items], [null, null, []], "an outsider naming the list gets nothing");
});

/* ------------------------------------------------------------------ */
/* The write                                                            */
/* ------------------------------------------------------------------ */

const save = (w: World, who: string, studentId: string, data: object) => asUser(w.db, who, "select public.save_student_profile($1, $2::jsonb)", [studentId, JSON.stringify(data)]);
const storedProfile = (w: World, studentId: string) =>
  one(w.db.query<{ data: { basics: { gradYear: number } }; updated_by: string }>("select data, updated_by from public.student_profiles where student_id = $1", [studentId]).then((r) => r.rows));
const gradYear = async (w: World, studentId: string) => (await one(w.db.query<{ grad_year: number | null }>("select grad_year from public.students where id = $1", [studentId]).then((r) => r.rows))).grad_year;

test("save_student_profile(): the student and an editing guardian write, stamped with who; the grad year follows", async () => {
  const w = await world();
  await save(w, w.alice, w.student, { basics: { gradYear: 2028 } });
  assert.deepEqual([(await storedProfile(w, w.student)).data.basics.gradYear, (await storedProfile(w, w.student)).updated_by], [2028, w.alice]);
  assert.equal(await gradYear(w, w.student), 2028);
  await save(w, w.mom, w.student, { basics: { gradYear: 2027 } });
  assert.deepEqual([(await storedProfile(w, w.student)).data.basics.gradYear, (await storedProfile(w, w.student)).updated_by], [2027, w.mom], "attributed to Mom");
  assert.equal(await gradYear(w, w.student), 2027);
  // A managed student (no profile row yet): Mom inserts it.
  await save(w, w.mom, w.ben, { basics: { gradYear: 2030 } });
  assert.equal((await storedProfile(w, w.ben)).updated_by, w.mom);
  assert.equal(await gradYear(w, w.ben), 2030);
  // No grad year in the data: the students row is left alone.
  await save(w, w.alice, w.student, { basics: { gradYear: null } });
  assert.equal(await gradYear(w, w.student), 2027);
});

test("save_student_profile(): a view-only guardian and an outsider are refused, as the table write refuses them", async () => {
  const w = await world();
  for (const who of [w.dad, w.eve]) {
    await assert.rejects(save(w, who, w.student, { basics: { gradYear: 2031 } }), /row-level security/);
    await assert.rejects(
      asUser(w.db, who, "insert into public.student_profiles (student_id, data, updated_by) values ($1, '{}'::jsonb, $2) on conflict (student_id) do update set data = excluded.data", [w.student, who]),
      /row-level security/,
      "the table write is refused the same way",
    );
  }
  assert.equal((await storedProfile(w, w.student)).data.basics.gradYear, 2027, "unchanged");
  assert.equal(await gradYear(w, w.student), null, "the grad year untouched");
  await assert.rejects(asUser(w.db, null, "select public.save_student_profile($1, '{}'::jsonb)", [w.student]), /permission denied/);
});

test("save_student_profile(): a bad grad year never fails the profile write (the sync is best-effort)", async () => {
  const w = await world();
  await save(w, w.alice, w.student, { basics: { gradYear: "soon" } });
  assert.equal((await storedProfile(w, w.student)).data.basics.gradYear as unknown, "soon");
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

test("guard: a security definer bundle would leak another household's plan, and the comparison catches it", async () => {
  // The pause migration re-creates viewer_bundle(); leave it out too so the definer copy below is the only one.
  // The next-steps migration re-creates plan_bundle() too (20261014120000_next_steps.sql): it runs after the definer
  // copy, made definer the same way, so the bundle under test is the current one. So does plan v3's
  // (20261016120000_plan_v3.sql), after it.
  const files = ALL.filter((f) => f !== BUNDLE && f !== PAUSE && f !== NEXT_STEPS && f !== PLAN_V3);
  const w = await world(files);
  const sql = readFileSync(join(DIR, BUNDLE), "utf8").replaceAll("security invoker", "security definer");
  await w.db.exec(sql);
  await w.db.exec(readFileSync(join(DIR, NEXT_STEPS), "utf8").replaceAll("security invoker", "security definer"));
  await w.db.exec(readFileSync(join(DIR, PLAN_V3), "utf8").replaceAll("security invoker", "security definer"));
  const eve = await planByBundle(w, w.eve, w.student);
  assert.notDeepEqual(eve, await planByTables(w, w.eve, w.student), "definer: Eve sees Alice's plan, so the equality check fails");
});

test("the pause migration re-creates viewer_bundle() unchanged but for the profile's suspended_at", () => {
  const original = readFileSync(join(DIR, BUNDLE), "utf8");
  const pause = readFileSync(join(DIR, PAUSE), "utf8");
  const body = (sql: string) => sql.slice(sql.indexOf("function public.viewer_bundle()"), sql.indexOf("$$;", sql.indexOf("function public.viewer_bundle()")));
  assert.equal(body(pause), body(original).replace("created, updated, deleted_at\n        from public.profiles", "created, updated, deleted_at, suspended_at\n        from public.profiles"));
  assert.match(pause, /create or replace function public\.viewer_bundle\(\)/);
  assert.match(pause, /security invoker/);
  assert.doesNotMatch(pause, /security definer/);
  assert.ok(pause.includes("revoke execute on function public.viewer_bundle() from public, anon;"));
  assert.ok(pause.includes("grant execute on function public.viewer_bundle() to authenticated;"));
});

test("the migration keeps all three functions security invoker and closed to anon", () => {
  const sql = readFileSync(join(DIR, BUNDLE), "utf8");
  assert.equal((sql.match(/security invoker/g) ?? []).length, 3);
  assert.doesNotMatch(sql, /security definer/);
  for (const f of ["viewer_bundle()", "plan_bundle(uuid, uuid)", "save_student_profile(uuid, jsonb)"]) {
    assert.ok(sql.includes(`revoke execute on function public.${f} from public, anon;`), f);
    assert.ok(sql.includes(`grant execute on function public.${f} to authenticated;`), f);
  }
});
