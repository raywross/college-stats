/**
 * The high-school wave in one call (round 4; supabase/migrations/20261109120000_high_school_bundle.sql,
 * lib/supabase-high-schools.ts fetchHighSchoolRows, lib/snapshot-memo.ts, lib/high-schools.ts, lib/chances/rigor-server.ts):
 *   - against real Postgres (PGlite + the auth stub, every migration in order): high_school_bundle() returns what the
 *     three reads it replaces return (high_schools, high_school_details, school_course_list()), for a signed-out
 *     visitor and a signed-in user, with courses null when the profile has an AP list;
 *   - against a fake client: one call with the function, the three reads without it;
 *   - the per-instance memo of the shared files reloads only on a new snapshot id;
 *   - the source: the rigor reading takes the course list from the record, never a second call after the school.
 * Guard tests break a rule and show the check fail. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_STUB_SQL, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { readHighSchoolData, highSchoolTableRows } from "../scripts/lib/publish-high-schools.mts";
import { resetMissingBundles } from "../lib/bundle-read.ts";
import { fetchHighSchoolBundle, fetchHighSchoolRows } from "../lib/supabase-high-schools.ts";
import { snapshotMemo } from "../lib/snapshot-memo.ts";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "supabase", "migrations");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BUNDLE = "20261109120000_high_school_bundle.sql";
const FIXTURE = join(import.meta.dirname, "fixtures", "high-schools");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/** A school with a profile that lists AP courses, and one with no profile at all. */
const WITH_LIST = "060000100001";
const NO_PROFILE = "480000200001";

async function boot(transform: (name: string, sql: string) => string = (_n, sql) => sql): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL) await db.exec(transform(name, readFileSync(join(DIR, name), "utf8")));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  // The fixture's rows, as a publish leaves them (setup as the superuser).
  const data = readHighSchoolData(FIXTURE)!;
  for (const r of highSchoolTableRows(data))
    await db.query("insert into public.high_schools (id, state, kind, name, city, search, data) values ($1, $2, $3, $4, $5, $6, $7)", [r.id, r.state, r.kind, r.name, r.city, r.search, JSON.stringify(r.data)]);
  for (const d of data.details) await db.query("insert into public.high_school_details (id, data) values ($1, $2)", [d.data.id, JSON.stringify(d.data)]);
  return db;
}

let seq = 0;
/** A student at `school` listing `keys` as AP courses (the trigger pools them). */
async function student(db: AuthDb, school: string, keys: string[]): Promise<string> {
  seq += 1;
  const user = await createUser(db, { email: `hsb${seq}@example.com`, birthYear: 2009, roleHint: "student", displayName: `S${seq}` });
  const id = (await db.query<{ id: string }>("insert into public.students (user_id, display_name) values ($1, $2) returning id", [user, `S${seq}`])).rows[0].id;
  const doc = { basics: { highSchoolId: school }, academics: { courses: keys.map((key) => ({ kind: "ap", key })) } };
  await db.query("insert into public.student_profiles (student_id, data) values ($1, $2)", [id, JSON.stringify(doc)]);
  return user;
}

/** Three students at both schools list calculus; two list biology (under the threshold). */
async function pool(db: AuthDb): Promise<string> {
  let user = "";
  for (const school of [WITH_LIST, NO_PROFILE]) {
    user = await student(db, school, ["ap_calculus_ab", "ap_biology"]);
    await student(db, school, ["ap_calculus_ab", "ap_biology"]);
    await student(db, school, ["ap_calculus_ab"]);
  }
  return user;
}

/** What the three reads return for `who`, shaped as the bundle (lib/supabase-high-schools.ts fetchHighSchoolRows). */
async function threeReads(db: AuthDb, who: string | null, id: string) {
  const school = (await asUser<{ data: unknown }>(db, who, "select data from public.high_schools where id = $1", [id]))[0]?.data ?? null;
  const detail = (await asUser<{ data: { ap_courses?: unknown[] } }>(db, who, "select data from public.high_school_details where id = $1", [id]))[0]?.data ?? null;
  const courses = detail?.ap_courses?.length ? null : (await asUser<{ k: string }>(db, who, "select public.school_course_list($1) as k", [id])).map((r) => r.k);
  return { school, detail, courses };
}

const bundle = async (db: AuthDb, who: string | null, id: string) => (await asUser<{ b: unknown }>(db, who, "select public.high_school_bundle($1) as b", [id]))[0].b;

/* ------------------------------------------------------------------ */
/* The function, against the three reads                               */
/* ------------------------------------------------------------------ */

test("high_school_bundle returns what the three reads return, signed out and signed in", async () => {
  const db = await boot();
  const user = await pool(db);
  for (const who of [null, user]) {
    for (const id of [WITH_LIST, NO_PROFILE, "999999999999"]) {
      const [got, want] = [await bundle(db, who, id), await threeReads(db, who, id)];
      assert.deepEqual(got, want, `${who ?? "anon"} ${id}`);
      assert.equal(JSON.stringify(got), JSON.stringify(want), "documents verbatim, key order included");
    }
  }
  const noProfile = (await bundle(db, null, NO_PROFILE)) as { school: { id: string }; detail: unknown; courses: string[] };
  assert.equal(noProfile.school.id, NO_PROFILE);
  assert.equal(noProfile.detail, null);
  assert.deepEqual(noProfile.courses, ["ap_calculus_ab"], "only courses three students listed; never a count");
  assert.equal(((await bundle(db, null, WITH_LIST)) as { courses: unknown }).courses, null, "a profile with an AP list: no pooled list");
  assert.deepEqual(await bundle(db, null, "999999999999"), { school: null, detail: null, courses: [] });
});

test("high_school_bundle is security invoker, stable, and callable by anon and authenticated only through its grant", async () => {
  const sql = readFileSync(join(DIR, BUNDLE), "utf8");
  assert.match(sql, /security invoker/);
  assert.match(sql, /\bstable\b/);
  assert.match(sql, /revoke all on function public\.high_school_bundle\(text\) from public;/);
  assert.match(sql, /grant execute on function public\.high_school_bundle\(text\) to anon, authenticated, service_role;/);
  const db = await boot();
  const [{ invoker }] = (await db.query<{ invoker: boolean }>("select not prosecdef as invoker from pg_proc where proname = 'high_school_bundle'")).rows;
  assert.equal(invoker, true);
});

test("guard: a bundle that ships the pooled list beside a profile's AP list is caught", async () => {
  const db = await boot((name, sql) => (name === BUNDLE ? sql.replace("then null", "then coalesce((select json_agg(k.key) from public.school_course_list(p_id) as k(key)), '[]'::json)") : sql));
  await pool(db);
  assert.notDeepEqual(await bundle(db, null, WITH_LIST), await threeReads(db, null, WITH_LIST));
});

test("guard: without the grant to anon, a signed-out visitor can't call it (the check notices)", async () => {
  const db = await boot((name, sql) => (name === BUNDLE ? sql.replace("to anon, authenticated, service_role", "to authenticated, service_role") : sql));
  await assert.rejects(bundle(db, null, NO_PROFILE), /permission denied/);
});

/* ------------------------------------------------------------------ */
/* The client: one call with the function, three without               */
/* ------------------------------------------------------------------ */

type Answer = { data: unknown; error: { code?: string; message?: string } | null };

function fakeClient(opts: { bundle: Answer; rows: Record<string, unknown>; detail: unknown; list: unknown[] }) {
  const calls: string[] = [];
  const client = {
    rpc(fn: string) {
      calls.push(`rpc ${fn}`);
      return Promise.resolve(fn === "high_school_bundle" ? opts.bundle : { data: opts.list, error: null });
    },
    from(table: string) {
      calls.push(table);
      const data = table === "high_schools" ? opts.rows : table === "high_school_details" ? opts.detail : null;
      const q = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: data === null ? null : { data }, error: null }) };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const SCHOOL = { id: NO_PROFILE, name: "Fixture Ridge High School" };

test("fetchHighSchoolRows: one call when high_school_bundle is there", async () => {
  resetMissingBundles();
  const { client, calls } = fakeClient({ bundle: { data: { school: SCHOOL, detail: null, courses: ["ap_calculus_ab"] }, error: null }, rows: SCHOOL, detail: null, list: [] });
  assert.deepEqual(await fetchHighSchoolRows(client, NO_PROFILE), { school: SCHOOL, detail: null, courses: ["ap_calculus_ab"] });
  assert.deepEqual(calls, ["rpc high_school_bundle"]);
});

test("fetchHighSchoolRows: the three reads when the function is missing (and the miss is remembered)", async () => {
  resetMissingBundles();
  const missing: Answer = { data: null, error: { code: "PGRST202", message: "Could not find the function public.high_school_bundle" } };
  const { client, calls } = fakeClient({ bundle: missing, rows: SCHOOL, detail: null, list: ["ap_calculus_ab"] });
  assert.deepEqual(await fetchHighSchoolRows(client, NO_PROFILE), { school: SCHOOL, detail: null, courses: ["ap_calculus_ab"] });
  assert.deepEqual(calls, ["rpc high_school_bundle", "high_schools", "high_school_details", "rpc school_course_list"]);
  calls.length = 0;
  await fetchHighSchoolRows(client, NO_PROFILE);
  assert.deepEqual(calls, ["high_schools", "high_school_details", "rpc school_course_list"], "within the minute: straight to the three reads");
  // A profile with an AP list: no course-list call, as offeringFor never made one.
  resetMissingBundles();
  const withList = fakeClient({ bundle: missing, rows: SCHOOL, detail: { id: NO_PROFILE, ap_courses: ["ap_biology"] }, list: [] });
  assert.equal((await fetchHighSchoolRows(withList.client, NO_PROFILE)).courses, null);
  assert.deepEqual(withList.calls, ["rpc high_school_bundle", "high_schools", "high_school_details"]);
  resetMissingBundles();
});

test("fetchHighSchoolBundle: an error other than a missing function throws (getHighSchoolRecord logs it and reads null)", async () => {
  resetMissingBundles();
  const { client } = fakeClient({ bundle: { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }, rows: SCHOOL, detail: null, list: [] });
  await assert.rejects(fetchHighSchoolBundle(client, NO_PROFILE), /statement timeout/);
});

/* ------------------------------------------------------------------ */
/* The shared files, once per instance per snapshot                    */
/* ------------------------------------------------------------------ */

test("snapshotMemo: one load per snapshot id, shared by concurrent callers; a new id reloads; a failure isn't held", async () => {
  let loads = 0;
  let fail = false;
  const memo = snapshotMemo(async () => {
    loads += 1;
    if (fail) throw new Error("db down");
    return { loads };
  });
  const [a, b] = await Promise.all([memo("7"), memo("7")]);
  assert.equal(loads, 1);
  assert.equal(a, b);
  await memo("7");
  assert.equal(loads, 1, "a warm instance never re-reads");
  assert.deepEqual(await memo("8"), { loads: 2 }, "a new snapshot id reloads");
  fail = true;
  await assert.rejects(memo("9"), /db down/);
  fail = false;
  assert.deepEqual(await memo("9"), { loads: 4 }, "the failed load wasn't held");
});

test("guard: a memo that ignored the key would serve the old snapshot's files", async () => {
  // The broken rule, written out: hold the first value whatever the key.
  const broken = <T,>(load: () => Promise<T>): ((key: string) => Promise<T>) => {
    let held: Promise<T> | null = null;
    return () => (held ??= load());
  };
  let n = 0;
  const memo = broken(async () => ++n);
  await memo("1");
  assert.notEqual(await memo("2"), 2, "the check below would fail on this memo");
  const good = snapshotMemo(async () => ++n);
  const first = await good("1");
  assert.equal(await good("2"), first + 1);
});

/* ------------------------------------------------------------------ */
/* The source                                                          */
/* ------------------------------------------------------------------ */

test("source: the shared files come from the per-instance memo keyed by the snapshot id; the school from fetchHighSchoolRows", () => {
  const src = read("lib", "high-schools.ts");
  assert.match(src, /snapshotMemo\(\(\) => fetchHighSchoolFile\(supabaseClient\("read"\), "meta"\)\)/);
  assert.match(src, /snapshotMemo\(\(\) => fetchHighSchoolFile\(supabaseClient\("read"\), "medians"\)\)/);
  assert.match(src, /currentSnapshotId\(\)/);
  assert.match(src, /fetchHighSchoolRows\(supabaseClient\("read"\), id/);
  assert.doesNotMatch(src, /fetchHighSchool\(|fetchHighSchoolDetail\(/, "no per-table reads beside the bundle path");
  assert.match(src, /export const getHighSchool = cache\(async \(id: string\)[^\n]*getHighSchoolRecord\(id\)/, "getHighSchool shares the record");
});

test("source: offeringFor takes the course list from the school's record, not a second call after it", () => {
  const src = read("lib", "chances", "rigor-server.ts");
  const body = src.slice(src.indexOf("export async function offeringFor"), src.indexOf("export async function rigorViewFor"));
  assert.match(body, /await getHighSchoolRecord\(highSchoolId\)/);
  assert.doesNotMatch(body, /getHighSchool\(/);
  // pooledCourseKeys is reached only for the json source's "unread" list.
  const calls = [...body.matchAll(/pooledCourseKeys\(/g)].length;
  assert.equal(calls, 1);
  assert.match(body, /record\.courses === "unread" \? await pooledCourseKeys\(highSchoolId\) : apCourseKeys\(record\.courses\)/);
});
