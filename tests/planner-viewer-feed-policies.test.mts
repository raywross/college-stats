/**
 * The per-viewer calendar feed's schema (supabase/migrations/20261010130000_plan_viewer_feed.sql; U8) against real
 * Postgres (PGlite, every migration in order). A token never yields a list its owner can't read: a guardian outside
 * the household gets nothing of another family's, a guardian who left loses the children at once, a revoked token
 * yields nothing (and stays revoked), and for every person the feed's students are exactly the student lists
 * can_read_list lets them read. Tokens are their owner's alone; a signed-out caller reaches only the function.
 * The guard tests at the end break the function on purpose and show the checks notice. `npm test`.
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
const FEED_SQL = readFileSync(join(DIR, "20261010130000_plan_viewer_feed.sql"), "utf8");

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
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const invite = (db: AuthDb, who: string, household: string, email: string, side: "guardian" | "student") =>
  rpc<{ token: string }>(db, who, "public.create_invitation($1, $2, $3, $4, $5, $6, $7, $8)", [household, email, side, null, false, null, null, null]);
const accept = (db: AuthDb, who: string, token: string) => rpc<string>(db, who, "public.accept_invitation($1)", [token]);

interface FeedRow {
  student_id: string;
  student_name: string | null;
  kind: "task" | "visit";
  id: string;
  unit_id: string | null;
  title: string | null;
  due_on: string | null;
}

/** The feed as a calendar fetches it: signed out (anon), by the token's hash. */
const feed = (db: AuthDb, token: string) =>
  asUser<FeedRow>(db, null, "select student_id, student_name, kind, id, unit_id, title, due_on::text from public.plan_viewer_feed($1)", [sha(token)]);

const studentsIn = (rows: FeedRow[]) => [...new Set(rows.map((r) => r.student_id))].sort();

/**
 * The Smiths: Mom (guardian; also keeps a managed record for Ben, who has no account), Dad (guardian, view only),
 * Alice (student with an account: a default list with a dated task, a done one, a dismissed one, an undated one, a
 * window, and a visit; and a second, non-default list whose task isn't on the plan). Mom's own list (a guardian's,
 * not a plan) has a task too. The Joneses: Eve (guardian) and Bob (student), with one task. Every person has a live
 * viewer token named after them.
 */
async function world() {
  const db = await boot();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Sam Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve Jones" });
  const bob = await createUser(db, { email: "bob@example.com", birthYear: 2009, roleHint: "student", displayName: "Bob Jones" });

  const smiths = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  await accept(db, dad, (await invite(db, mom, smiths, "dad@example.com", "guardian")).token);
  await accept(db, alice, (await invite(db, mom, smiths, "alice@example.com", "student")).token);
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben Smith', 2029)", [smiths]);
  const joneses = await rpc<string>(db, eve, "public.create_household('The Joneses', 'guardian')");
  await accept(db, bob, (await invite(db, eve, joneses, "bob@example.com", "student")).token);

  const aliceId = (await one(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const bobId = (await one(asUser<{ id: string }>(db, bob, "select id from public.students where user_id = $1", [bob]))).id;

  const newList = async (who: string, owner: { student?: string; user?: string }, isDefault: boolean, name = "My list") =>
    (
      await one(
        asUser<{ id: string }>(db, who, "insert into public.lists (student_id, user_id, name, is_default) values ($1, $2, $3, $4) returning id", [
          owner.student ?? null,
          owner.user ?? null,
          name,
          isDefault,
        ]),
      )
    ).id;
  const newItem = async (who: string, list: string, unit: string) =>
    (await one(asUser<{ id: string }>(db, who, "insert into public.list_items (list_id, unit_id, position, round) values ($1, $2, 0, 'ed') returning id", [list, unit]))).id;
  const ownTask = (who: string, list: string, title: string, extra: { due?: string | null; item?: string | null; window?: [string, string]; done?: boolean; dismissed?: boolean } = {}) =>
    asUser(
      db,
      who,
      `insert into public.plan_tasks (list_id, item_id, kind, title, due_on, window_start, window_end, source, done_at, dismissed)
       values ($1, $2, 'own', $3, $4, $5, $6, 'own', case when $7 then now() end, $8)`,
      [list, extra.item ?? null, title, extra.due ?? null, extra.window?.[0] ?? null, extra.window?.[1] ?? null, !!extra.done, !!extra.dismissed],
    );

  const aliceList = await newList(alice, { student: aliceId }, true);
  const aliceItem = await newItem(alice, aliceList, "199120");
  await ownTask(alice, aliceList, "Apply (ED I)", { due: "2026-11-01", item: aliceItem });
  await ownTask(alice, aliceList, "Already done", { due: "2026-10-01", done: true });
  await ownTask(alice, aliceList, "Dismissed", { due: "2026-10-02", dismissed: true });
  await ownTask(alice, aliceList, "No date yet");
  await ownTask(alice, aliceList, "Write the personal essay", { window: ["2026-06-01", "2026-08-31"] });
  await asUser(db, alice, "insert into public.plan_visits (item_id, kind, on_date, at_time) values ($1, 'campus_tour', '2026-10-20', '10:00')", [aliceItem]);
  const aliceExtra = await newList(alice, { student: aliceId }, false, "Maybe later");
  await ownTask(alice, aliceExtra, "Not on the plan", { due: "2026-12-01" });

  const benList = await newList(mom, { student: ben }, true);
  await ownTask(mom, benList, "Ben's first visit", { due: "2027-03-01" });
  const momList = await newList(mom, { user: mom }, true);
  await ownTask(mom, momList, "Mom's own errand", { due: "2026-11-15" });

  const bobList = await newList(bob, { student: bobId }, true);
  await ownTask(bob, bobList, "Bob applies", { due: "2026-11-15" });

  for (const [who, name] of [[mom, "mom"], [dad, "dad"], [alice, "alice"], [eve, "eve"], [bob, "bob"]] as const) {
    await asUser(db, who, "insert into public.plan_viewer_calendar_tokens (token_hash) values ($1)", [sha(`${name}-token`)]);
  }
  return { db, mom, dad, alice, eve, bob, smiths, joneses, aliceId, ben, bobId, aliceList, benList, momList, bobList };
}

type World = Awaited<ReturnType<typeof world>>;

/* ------------------------------------------------------------------ */
/* Checks (the guard tests break the function and expect these to fail) */
/* ------------------------------------------------------------------ */

/** For every person, the feed's students are exactly the students whose lists can_read_list lets them read. */
async function assertMatchesCanReadList(w: World) {
  const { db } = w;
  const lists = (await db.query<{ id: string; student_id: string }>("select id, student_id from public.lists where student_id is not null")).rows;
  for (const [who, name] of [[w.mom, "mom"], [w.dad, "dad"], [w.alice, "alice"], [w.eve, "eve"], [w.bob, "bob"]] as const) {
    const readable = new Set<string>();
    for (const l of lists) {
      if (await rpc<boolean>(db, who, "public.can_read_list($1)", [l.id])) readable.add(l.student_id);
    }
    const fed = studentsIn((await feed(db, `${name}-token`)).filter((r) => r.kind === "task"));
    // A readable student with no open dated task on their plan list has nothing in the feed; every one here has one.
    assert.deepEqual(fed, [...readable].sort(), `${name}'s feed covers exactly the students they can read`);
  }
}

/** A guardian outside the household never gets another family's events. */
async function assertOutsiderGetsNothing(w: World) {
  const rows = await feed(w.db, "eve-token");
  assert.deepEqual(studentsIn(rows), [w.bobId], "Eve's feed is Bob's only");
  assert.ok(!rows.some((r) => r.student_id === w.aliceId || r.student_id === w.ben), "nothing of the Smiths' children");
}

/** A revoked token yields nothing. */
async function assertRevokedGivesNothing(w: World) {
  assert.equal(await affectedAsUser(w.db, w.mom, "update public.plan_viewer_calendar_tokens set revoked_at = now() where user_id = $1", [w.mom]), 1);
  assert.deepEqual(await feed(w.db, "mom-token"), [], "a revoked token yields nothing");
}

test("a guardian's feed: each readable child's plan list, open dated tasks and visits only, first names", async () => {
  const w = await world();
  const rows = await feed(w.db, "mom-token");
  assert.deepEqual(studentsIn(rows), [w.aliceId, w.ben].sort(), "Alice (a household student) and Ben (Mom's managed record)");
  const alice = rows.filter((r) => r.student_id === w.aliceId);
  assert.deepEqual(
    alice.filter((r) => r.kind === "task").map((r) => r.title).sort(),
    ["Apply (ED I)", "Write the personal essay"],
    "done, dismissed, and undated tasks are left out; the extra list isn't the plan",
  );
  assert.equal(alice.filter((r) => r.kind === "visit").length, 1, "the visit is in");
  assert.ok(alice.every((r) => r.student_name === "Alice"), "the child's first name");
  assert.equal(rows.find((r) => r.title === "Apply (ED I)")?.unit_id, "199120", "the unit id, for the route to name the college");
  assert.ok(!rows.some((r) => r.title === "Mom's own errand"), "a guardian's own list isn't a plan");
  assert.ok(!rows.some((r) => r.title === "Not on the plan"), "only the default list");
});

test("a token never yields a list its owner can't read", async () => {
  const w = await world();
  await assertOutsiderGetsNothing(w);
  await assertMatchesCanReadList(w);
  // A student sees only themselves.
  assert.deepEqual(studentsIn(await feed(w.db, "alice-token")), [w.aliceId]);
});

test("a guardian who leaves the household loses the children at once; a deleted student drops out", async () => {
  const w = await world();
  assert.deepEqual(studentsIn(await feed(w.db, "dad-token")), [w.aliceId, w.ben].sort());
  await asUser(w.db, w.dad, "select public.leave_household($1)", [w.smiths]);
  assert.deepEqual(await feed(w.db, "dad-token"), [], "Dad's token yields nothing once he's left");
  await assertMatchesCanReadList(w);
  await w.db.query("update public.students set deleted_at = now() where id = $1", [w.aliceId]);
  assert.deepEqual(studentsIn(await feed(w.db, "mom-token")), [w.ben], "a deleted student's plan is gone");
  await assertMatchesCanReadList(w);
});

test("a revoked token yields nothing and stays revoked; unknown and malformed hashes yield nothing", async () => {
  const w = await world();
  await assertRevokedGivesNothing(w);
  await asUser(w.db, w.mom, "update public.plan_viewer_calendar_tokens set revoked_at = null where user_id = $1", [w.mom]);
  assert.deepEqual(await feed(w.db, "mom-token"), [], "clearing revoked_at doesn't bring it back");
  assert.deepEqual(await feed(w.db, "nobody's-token"), []);
  assert.deepEqual(await asUser(w.db, null, "select * from public.plan_viewer_feed($1)", ["not-a-hash"]), []);
});

test("tokens are their owner's: read, create, and revoke only their own; signed out reaches only the function", async () => {
  const w = await world();
  const { db, mom, eve } = w;
  assert.equal((await asUser(db, mom, "select id from public.plan_viewer_calendar_tokens")).length, 1, "Mom reads her own");
  assert.equal((await asUser(db, eve, "select id from public.plan_viewer_calendar_tokens")).length, 1, "Eve reads only her own");
  assert.equal(await affectedAsUser(db, eve, "update public.plan_viewer_calendar_tokens set revoked_at = now() where user_id = $1", [mom]), 0, "Eve can't revoke Mom's");
  await assert.rejects(asUser(db, eve, "insert into public.plan_viewer_calendar_tokens (user_id, token_hash) values ($1, $2)", [mom, sha("forged")]), /row-level security/, "no token for someone else");
  await assert.rejects(asUser(db, eve, "insert into public.plan_viewer_calendar_tokens (token_hash, revoked_at) values ($1, now())", [sha("x")]), /permission denied/);
  await assert.rejects(asUser(db, eve, "update public.plan_viewer_calendar_tokens set user_id = $1", [mom]), /permission denied/, "the owner never changes");
  await assert.rejects(asUser(db, null, "select * from public.plan_viewer_calendar_tokens"), /permission denied/, "signed out: no table");
  await assert.rejects(asUser(db, null, "insert into public.plan_viewer_calendar_tokens (token_hash) values ($1)", [sha("anon")]), /permission denied/);
  assert.ok((await feed(db, "mom-token")).length > 0, "signed out: the function works with a live token");
});

/* ------------------------------------------------------------------ */
/* Guards: break the function and show the checks notice              */
/* ------------------------------------------------------------------ */

/** Re-creates plan_viewer_feed from the migration with one substitution (as the superuser, like a bad migration). */
async function breakFeed(db: AuthDb, from: string, to: string) {
  const start = FEED_SQL.indexOf("create function public.plan_viewer_feed");
  const end = FEED_SQL.indexOf("$$;", start) + 3;
  const fn = FEED_SQL.slice(start, end);
  assert.ok(fn.includes(from), `the function contains ${JSON.stringify(from)}`);
  await db.exec(fn.replace("create function", "create or replace function").replace(from, to));
}

test("guard: a feed that ignores the household (any guardian reads every student) is caught", async () => {
  const w = await world();
  await breakFeed(w.db, "where g.user_id = v.user_id", "where true");
  await assert.rejects(assertOutsiderGetsNothing(w));
});

test("guard: a feed that ignores a guardian's status (a removed guardian keeps reading) is caught", async () => {
  const w = await world();
  await breakFeed(w.db, "and g.role = 'guardian' and g.status = 'active'", "and g.role = 'guardian'");
  // Leaving deletes the membership; an inactive one is what this rule is for.
  await w.db.query("update public.household_members set status = 'invited' where user_id = $1", [w.dad]);
  await assert.rejects(assertMatchesCanReadList(w));
});

test("guard: a feed that ignores revocation is caught", async () => {
  const w = await world();
  await breakFeed(w.db, "and t.revoked_at is null", "");
  await assert.rejects(assertRevokedGivesNothing(w));
});
