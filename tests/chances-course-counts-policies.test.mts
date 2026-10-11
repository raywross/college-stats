/**
 * Pooled school course lists against real Postgres (PGlite with the auth stub, every migration in order;
 * supabase/migrations/20261011120000_school_course_counts.sql; specs/chances/course-plan.md "The school's course
 * list"): the trigger keeps distinct-student counts in step with student_profiles writes (insert, update, delete, a
 * student changing school, a course listed twice), only catalog keys count, nobody can read the table, and
 * school_course_list() returns a course only once three distinct students at the school have listed it and never
 * returns a count. Guard tests break the threshold and show the check fail. `npm test`.
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

async function boot(transform: (name: string, sql: string) => string = (_n, sql) => sql): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL) await db.exec(transform(name, readFileSync(join(DIR, name), "utf8")));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

const doc = (school: string | null, courses: { kind?: string; key?: string | null }[]) =>
  JSON.stringify({ basics: { highSchoolId: school }, academics: { courses: courses.map((c) => ({ kind: "ap", ...c })) } });

let seq = 0;
/** A student with a profile document; setup runs as the superuser (the trigger still fires). */
async function student(db: AuthDb, data: string): Promise<string> {
  seq += 1;
  const user = await createUser(db, { email: `s${seq}@example.com`, birthYear: 2009, roleHint: "student", displayName: `S${seq}` });
  const id = (await db.query<{ id: string }>("insert into public.students (user_id, display_name) values ($1, $2) returning id", [user, `S${seq}`])).rows[0].id;
  await db.query("insert into public.student_profiles (student_id, data) values ($1, $2)", [id, data]);
  return id;
}

const counts = async (db: AuthDb) =>
  (await db.query<{ high_school_id: string; course_key: string; students: number }>("select * from public.school_course_counts order by 1, 2")).rows.map((r) => `${r.high_school_id}:${r.course_key}:${r.students}`);
const listFor = async (db: AuthDb, who: string | null, school: string) => (await asUser<{ k: string }>(db, who, "select public.school_course_list($1) as k", [school])).map((r) => r.k);

test("the trigger counts distinct students per school and course, from inserts, updates, and deletes", async () => {
  const db = await boot();
  const a = await student(db, doc("S1", [{ key: "ap_calculus_ab" }, { key: "ap_calculus_ab" }, { key: "ap_biology" }]));
  assert.deepEqual(await counts(db), ["S1:ap_biology:1", "S1:ap_calculus_ab:1"], "a course listed twice by one student counts once");
  const b = await student(db, doc("S1", [{ key: "ap_calculus_ab" }, { kind: "ib_hl", key: "ib_math_aa_hl" }]));
  assert.deepEqual(await counts(db), ["S1:ap_biology:1", "S1:ap_calculus_ab:2", "S1:ib_math_aa_hl:1"]);
  // Dropping a course and adding another.
  await db.query("update public.student_profiles set data = $2 where student_id = $1", [a, doc("S1", [{ key: "ap_calculus_ab" }, { key: "ap_chemistry" }])]);
  assert.deepEqual(await counts(db), ["S1:ap_calculus_ab:2", "S1:ap_chemistry:1", "S1:ib_math_aa_hl:1"]);
  // Changing school moves the student's contribution with them.
  await db.query("update public.student_profiles set data = $2 where student_id = $1", [b, doc("S2", [{ key: "ap_calculus_ab" }])]);
  assert.deepEqual(await counts(db), ["S1:ap_calculus_ab:1", "S1:ap_chemistry:1", "S2:ap_calculus_ab:1"]);
  // An update that doesn't touch the courses leaves the counts alone.
  await db.query("update public.student_profiles set data = jsonb_set(data, '{tests}', '{\"satTotal\":1500}') where student_id = $1", [a]);
  assert.deepEqual(await counts(db), ["S1:ap_calculus_ab:1", "S1:ap_chemistry:1", "S2:ap_calculus_ab:1"]);
  // Deleting a profile (cascading from the student) removes its contribution, and a count of zero is gone.
  await db.query("delete from public.students where id = $1", [a]);
  assert.deepEqual(await counts(db), ["S2:ap_calculus_ab:1"]);
});

test("only catalog keys of AP and IB rows from a linked school count; typed names and malformed documents add nothing", async () => {
  const db = await boot();
  await student(db, doc("S1", [{ kind: "honors", key: null }, { kind: "dual", key: "ap_calculus_ab" }, { key: null }, { key: "calculus ab" }, { key: "ap_ok" }]));
  await student(db, doc(null, [{ key: "ap_calculus_ab" }]));
  await student(db, doc("not a school id!!", [{ key: "ap_calculus_ab" }]));
  await student(db, JSON.stringify({ basics: { highSchoolId: "S1" }, academics: { courses: "nope" } }));
  await student(db, "{}");
  assert.deepEqual(await counts(db), ["S1:ap_ok:1"], "the dual row with a key, the unnamed rows, and the free text are ignored");
});

test("nobody reads the table; school_course_list returns a course only at three distinct students, and returns keys, not counts", async () => {
  const db = await boot();
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });
  for (let i = 0; i < 2; i++) await student(db, doc("S1", [{ key: "ap_calculus_ab" }, { key: "ap_biology" }]));
  assert.deepEqual(await listFor(db, eve, "S1"), [], "two students: nothing");
  await student(db, doc("S1", [{ key: "ap_calculus_ab" }]));
  assert.deepEqual(await listFor(db, eve, "S1"), ["ap_calculus_ab"], "three: that course only");
  assert.deepEqual(await listFor(db, null, "S1"), ["ap_calculus_ab"], "a visitor with no account reads the same list");
  assert.deepEqual(await listFor(db, eve, "S2"), []);
  // The function's result is a bare list of keys.
  const raw = await asUser<Record<string, unknown>>(db, eve, "select * from public.school_course_list($1)", ["S1"]);
  assert.deepEqual(Object.keys(raw[0]), ["school_course_list"]);
  assert.equal(typeof raw[0].school_course_list, "string");
  // The table itself is closed to every role the app uses.
  for (const who of [eve, null]) {
    await assert.rejects(() => asUser(db, who, "select * from public.school_course_counts"), /permission denied/);
    await assert.rejects(() => asUser(db, who, "insert into public.school_course_counts values ('S1', 'ap_x', 99)"), /permission denied/);
  }
  // A student leaving the school takes the list back under the threshold.
  const leaver = (await db.query<{ student_id: string }>("select student_id from public.student_profiles limit 1")).rows[0].student_id;
  await db.query("update public.student_profiles set data = $2 where student_id = $1", [leaver, doc(null, [])]);
  assert.deepEqual(await listFor(db, eve, "S1"), []);
});

test("the backfill counts the profiles that already exist when the migration runs", async () => {
  // Boot every migration but this one, add profiles, then run this one.
  const last = "20261011120000_school_course_counts.sql";
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL.filter((f) => f !== last)) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  for (let i = 0; i < 3; i++) await student(db, doc("S1", [{ key: "ap_calculus_ab" }]));
  await db.exec(readFileSync(join(DIR, last), "utf8"));
  assert.deepEqual(await counts(db), ["S1:ap_calculus_ab:3"]);
});

test("guard: with the threshold lowered to two, the check fails (the three-student rule is in school_course_list)", async () => {
  const db = await boot((name, sql) => (name.endsWith("school_course_counts.sql") ? sql.replace("c.students >= 3", "c.students >= 2") : sql));
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });
  for (let i = 0; i < 2; i++) await student(db, doc("S1", [{ key: "ap_calculus_ab" }]));
  assert.deepEqual(await listFor(db, eve, "S1"), ["ap_calculus_ab"], "the broken function leaks a two-student course");
  const real = await boot();
  const eve2 = await createUser(real, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });
  for (let i = 0; i < 2; i++) await student(real, doc("S1", [{ key: "ap_calculus_ab" }]));
  assert.deepEqual(await listFor(real, eve2, "S1"), [], "the real function does not");
});
