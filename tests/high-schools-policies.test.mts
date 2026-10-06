/**
 * High school tables and search (supabase/migrations/20261005180000_high_schools.sql), checked against real Postgres
 * (PGlite with pg_trgm + the auth stub from tests/helpers/pg-auth.mts): public read, no writes or staging calls through
 * the API, the staged swap, exact read-back of the fixture's published rows, and search_high_schools ranking and
 * filters. The last test breaks the read policy on purpose and proves the check notices. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, asUser, affectedAsUser } from "./helpers/pg-auth.mts";
import { readHighSchoolData, highSchoolTableRows } from "../scripts/lib/publish-high-schools.mts";
import { hsSearchKey, searchRows } from "../lib/high-school-core.ts";

const MIGRATION = join(import.meta.dirname, "..", "supabase", "migrations", "20261005180000_high_schools.sql");
const FIXTURE = join(import.meta.dirname, "fixtures", "high-schools");

async function db(): Promise<PGlite> {
  const pg = await PGlite.create({ extensions: { pg_trgm } });
  await pg.exec(AUTH_STUB_SQL);
  await pg.exec(readFileSync(MIGRATION, "utf8"));
  // Supabase grants this on its own `extensions` schema; PGlite's is new.
  await pg.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return pg;
}

async function asService<T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return pg.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Publish the fixture the way a one-transaction publish would: stage in two batches, then swap. */
async function publishFixture(pg: PGlite) {
  const data = readHighSchoolData(FIXTURE)!;
  const rows = highSchoolTableRows(data);
  const half = Math.ceil(rows.length / 2);
  await asService(pg, "select public.stage_high_schools($1, true)", [JSON.stringify(rows.slice(0, half))]);
  await asService(pg, "select public.stage_high_schools($1, false)", [JSON.stringify(rows.slice(half))]);
  const [{ n }] = await asService<{ n: number }>(pg, "select public.publish_high_schools_staged($1) as n", [rows.length]);
  assert.equal(n, rows.length);
  const details = data.details.map((d) => d.data);
  await asService(pg, "select public.stage_high_school_details($1, true)", [JSON.stringify(details)]);
  await asService(pg, "select public.publish_high_school_details_staged($1)", [details.length]);
  await asService(pg, "insert into public.high_school_files (name, data) values ('meta', $1), ('medians', $2)", [JSON.stringify(data.meta), JSON.stringify(data.medians)]);
  return { data, rows, details };
}

test("published rows read back byte for byte (key order kept), with state reports merged in", async () => {
  const pg = await db();
  const { rows, details, data } = await publishFixture(pg);
  const back = await asUser<{ id: string; state: string; kind: string; name: string; city: string | null; search: string; data: unknown }>(
    pg,
    null,
    "select id, state, kind, name, city, search, data from public.high_schools order by id",
  );
  assert.equal(JSON.stringify(back), JSON.stringify(rows));
  const rich = back.find((r) => r.id === "060000100001")!.data as { state_report: { values: Record<string, number> } };
  assert.equal(rich.state_report.values.college_going_rate, 0.71);
  assert.equal(back.find((r) => r.id === "060000100001")!.search, hsSearchKey("Fixture Hills High School", "Los Angeles"));
  const detailBack = await asUser<{ data: unknown }>(pg, null, "select data from public.high_school_details order by id");
  assert.equal(JSON.stringify(detailBack.map((d) => d.data)), JSON.stringify(details));
  const files = await asUser<{ name: string; data: unknown }>(pg, "00000000-0000-0000-0000-000000000001", "select name, data from public.high_school_files order by name");
  assert.equal(JSON.stringify(files.find((f) => f.name === "meta")!.data), JSON.stringify(data.meta));
});

test("the staged swap checks the count, replaces everything, and empties staging", async () => {
  const pg = await db();
  await publishFixture(pg);
  const one = highSchoolTableRows(readHighSchoolData(FIXTURE)!).slice(0, 1);
  await asService(pg, "select public.stage_high_schools($1, true)", [JSON.stringify(one)]);
  await assert.rejects(asService(pg, "select public.publish_high_schools_staged(5)"), /1 rows staged, expected 5/);
  await asService(pg, "select public.publish_high_schools_staged(1)");
  assert.equal((await asUser(pg, null, "select id from public.high_schools")).length, 1, "republish replaces, never appends");
  assert.equal((await asService(pg, "select id from public.hs_staging")).length, 0);
  await assert.rejects(asService(pg, "select public.stage_high_schools('{}'::json)"), /must be an array/);
});

test("anon and signed-in users read but can't write, stage, or publish; staging tables are invisible", async () => {
  const pg = await db();
  await publishFixture(pg);
  const user = "00000000-0000-0000-0000-000000000002";
  for (const who of [null, user]) {
    assert.ok((await asUser(pg, who, "select id from public.high_schools")).length > 0);
    await assert.rejects(asUser(pg, who, "insert into public.high_schools (id, state, kind, name, search, data) values ('060000100099', 'CA', 'public', 'X', 'x', '{}')"), /permission denied/);
    assert.equal((await asUser(pg, who, "select id from public.high_school_details")).length, 1);
    assert.equal((await asUser(pg, who, "select name from public.high_school_files")).length, 2);
    assert.equal(await affectedAsUser(pg, who, "update public.high_schools set name = 'X'").catch((e: Error) => e.message), "permission denied for table high_schools");
    await assert.rejects(asUser(pg, who, "update public.high_school_files set data = '{}'"), /permission denied/);
    await assert.rejects(asUser(pg, who, "delete from public.high_school_details"), /permission denied/);
    await assert.rejects(asUser(pg, who, "select * from public.hs_staging"), /permission denied/);
    await assert.rejects(asUser(pg, who, "select * from public.hs_detail_staging"), /permission denied/);
    await assert.rejects(asUser(pg, who, "select public.stage_high_schools('[]'::json, true)"), /permission denied/);
    await assert.rejects(asUser(pg, who, "select public.publish_high_schools_staged(0)"), /permission denied/);
    await assert.rejects(asUser(pg, who, "select public.stage_high_school_details('[]'::json, true)"), /permission denied/);
    await assert.rejects(asUser(pg, who, "select public.publish_high_school_details_staged(0)"), /permission denied/);
  }
});

type Hit = { id: string; name: string; city: string | null; state: string; kind: string; district: string | null; grades: string; score: number };

test("search_high_schools: prefix first, typo-tolerant, state filter, state listing, limits, wildcards escaped", async () => {
  const pg = await db();
  await publishFixture(pg);
  const search = (q: string, state: string | null = null, limit = 20) => asUser<Hit>(pg, null, "select * from public.search_high_schools($1, $2, $3)", [q, state, limit]);

  const hills = await search("fixture hills");
  assert.equal(hills[0].id, "060000100001");
  assert.deepEqual(
    { name: hills[0].name, city: hills[0].city, state: hills[0].state, kind: hills[0].kind, district: hills[0].district, grades: hills[0].grades },
    { name: "Fixture Hills High School", city: "Los Angeles", state: "CA", kind: "public", district: "Fixture Unified School District", grades: "9–12" },
  );
  assert.equal((await search("ridge"))[0].id, "480000200001", "a word inside the name");
  assert.equal((await search("fixtur ridg"))[0].id, "480000200001", "trigram similarity catches partial words");
  assert.ok((await search("fixture", "tx")).every((h) => h.state === "TX"), "state filter (any case)");
  assert.equal((await search("", "TX")).length, 6, "a state alone lists it");
  assert.deepEqual((await search("", "TX")).map((h) => h.name), [...(await search("", "TX")).map((h) => h.name)].sort(), "by name");
  assert.equal((await search("")).length, 0, "nothing to search for");
  assert.equal((await search("fixture", null, 3)).length, 3);
  assert.ok((await search("fixture", null, 500)).length <= 50, "limit capped at 50");
  assert.equal((await search("%")).length, 0, "% is a literal, not a wildcard");
  assert.equal((await search("_")).length, 0, "_ is a literal, not a wildcard");
  const priv = await search("fixture academy");
  assert.equal(priv[0].id, "A9900001");
  assert.equal(priv[0].district, null);
  assert.equal(priv[0].grades, "6–12");

  // The json store finds the same top result as SQL for the same queries.
  const rows = readHighSchoolData(FIXTURE)!.rows;
  for (const q of ["fixture hills", "ridge", "fixture academy"]) assert.equal(searchRows(rows, { q })[0].id, (await search(hsSearchKey(q)))[0].id, q);
});

test("guard: without the read policy, the checks above notice (anon sees nothing)", async () => {
  const pg = await db();
  await publishFixture(pg);
  await pg.exec('drop policy "High schools are public" on public.high_schools');
  assert.equal((await asUser(pg, null, "select id from public.high_schools")).length, 0);
  assert.equal((await asUser<Hit>(pg, null, "select * from public.search_high_schools('fixture', null, 20)")).length, 0);
});
