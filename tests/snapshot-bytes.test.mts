/**
 * A snapshot's size computed in Postgres (supabase/migrations/20261110130000_snapshot_bytes.sql;
 * specs/product/admin-speed.md "As built: U2"): `snapshot_bytes(data_snapshots)` sums the manifest's
 * `objects[*].bytes`, is zero for a manifest without objects, never raises on a malformed one, and answers anyone who
 * can read the table (it's what the console selects as `bytes:snapshot_bytes`). PGlite with every migration.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { anon, bootDataDb, migrationSql, run, user } from "./helpers/data-platform-db.mts";

const w = await bootDataDb();

async function snapshot(manifest: unknown): Promise<number> {
  const rows = await w.db.query<{ id: number }>("insert into public.data_snapshots (status, manifest) values ('published', $1::jsonb) returning id", [JSON.stringify(manifest)]);
  return Number(rows.rows[0].id);
}

const bytesOf = async (id: number, who = anon) =>
  Number((await run<{ b: string }>(w.db, who, "select public.snapshot_bytes(s) as b from public.data_snapshots s where s.id = $1", [id]))[0].b);

test("sums every object's bytes", async () => {
  const id = await snapshot({ colleges: 1893, layers: { "base.colleges": 3 }, objects: { "colleges.json.gz": { bytes: 6_000_000, sha256: "a" }, "lineage/1.json": { bytes: 100_000, sha256: "b" } } });
  assert.equal(await bytesOf(id), 6_100_000);
  assert.equal(await bytesOf(id, user(w.eve)), 6_100_000, "a signed-in reader too");
});

test("zero without objects, and never an error on a malformed manifest", async () => {
  assert.equal(await bytesOf(await snapshot({})), 0);
  assert.equal(await bytesOf(await snapshot({ objects: "not a map" })), 0);
  assert.equal(await bytesOf(await snapshot({ objects: { a: { bytes: "12" }, b: { bytes: 5 }, c: null, d: [] } })), 5, "only numeric bytes count");
});

test("the migration is additive and idempotent: applying it again changes nothing", async () => {
  await w.db.exec(migrationSql("20261110130000_snapshot_bytes.sql"));
  assert.equal(await bytesOf(await snapshot({ objects: { a: { bytes: 7, sha256: "x" } } })), 7);
  const sql = migrationSql("20261110130000_snapshot_bytes.sql");
  assert.match(sql, /create or replace function public\.snapshot_bytes\(s public\.data_snapshots\)/);
  assert.match(sql, /set search_path = ''/);
  assert.doesNotMatch(sql, /security definer/, "runs as the caller: the table's own select policy applies");
});
