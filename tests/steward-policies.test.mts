/**
 * The Data Steward's storage rules (specs/product/data-steward.md "What it writes", "Tests"):
 * - `admin_steward_write` (supabase/migrations/20261101140000_steward.sql) against real Postgres (PGlite, every
 *   migration): an admin writes a `steward.*` document as a new version in its own change set (kind 'edit', source
 *   'console') and one `steward.write` log row with the fields that changed, before and after; any other collection
 *   raises `not_steward_collection`; the body must be a JSON object; a non-admin, an admin at aal1 and a signed-out
 *   visitor are refused.
 * - The `steward.*` collections are never composed into a snapshot (the publisher's loader reads none of them, so the
 *   compose can't carry one) and never served by the Data API (no route reads the store), and the mini fixture's
 *   layers leave them out.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { anon, bootDataDb, codeOf, errorOf, run, user, value, type DataWorld } from "./helpers/data-platform-db.mts";
import { COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import type { DataStore } from "../scripts/lib/data-platform/store.mts";
import { overlayStore } from "../scripts/lib/sync-data-base.mts";
import { composeSnapshot, loadPublishLayers } from "../scripts/lib/data-platform/compose.mts";
import { miniLayers, miniSchools } from "./helpers/snapshot.mts";
import { STEWARD_COLLECTIONS } from "../lib/admin/steward-reads.ts";

const ROOT = join(import.meta.dirname, "..");
const admin = (w: DataWorld) => user(w.quinn);

type Log = { action: string; target_kind: string; target_id: string; details: Record<string, unknown> };
const logs = async (w: DataWorld) => (await w.db.query<Log>("select action, target_kind, target_id, details from public.admin_log order by id")).rows;
const current = async (w: DataWorld, collection: string, key: string) =>
  (await w.db.query<{ version: number; body: Record<string, unknown>; change_set_id: string; text: string }>(
    "select version, body, change_set_id, body::text as text from public.data_documents where collection = $1 and key = $2",
    [collection, key],
  )).rows[0];
const setRow = async (w: DataWorld, id: number) => (await w.db.query<{ kind: string; source: string; status: string; summary: Record<string, unknown> }>("select kind, source, status, summary from public.data_change_sets where id = $1", [id])).rows[0];

const write = (w: DataWorld, collection: string, key: string, body: unknown, note: string | null = null, who = admin(w)) =>
  value<string>(w.db, who, "public.admin_steward_write($1, $2, $3, $4)", [collection, key, typeof body === "string" ? body : JSON.stringify(body), note]).then(Number);

/* ------------------------------------------------------------------ */
/* admin_steward_write                                                 */
/* ------------------------------------------------------------------ */

test("admin_steward_write: a new document at version 1, then a change at version 2, each in its own console edit set; logged with the changed fields", async () => {
  const w = await bootDataDb();
  const issue = { key: "order|x #", kind: "value", status: "new", hypothesis: "a reader bug", findings: [], proposals: [], reason: null, run: "r1", updated: "2026-11-01" };
  const first = await write(w, "steward.issues", issue.key, issue, "the Steward's first look");
  let doc = await current(w, "steward.issues", issue.key);
  assert.deepEqual([doc.version, doc.body, Number(doc.change_set_id)], [1, issue, first]);
  assert.equal(doc.text, JSON.stringify(issue), "stored as written");
  const set = await setRow(w, first);
  assert.deepEqual([set.kind, set.source, set.status], ["edit", "console", "applied"]);
  let log = (await logs(w)).at(-1)!;
  assert.deepEqual([log.action, log.target_kind, log.target_id], ["steward.write", "document", issue.key]);
  assert.deepEqual([log.details.collection, log.details.key, log.details.change_set, log.details.note, log.details.before], ["steward.issues", issue.key, first, "the Steward's first look", null]);
  assert.deepEqual(log.details.changed, Object.keys(issue).sort());

  const left = { ...issue, status: "left", reason: "waiting for the archive" };
  const second = await write(w, "steward.issues", issue.key, left, "Leave");
  doc = await current(w, "steward.issues", issue.key);
  assert.deepEqual([doc.version, doc.body.status, Number(doc.change_set_id)], [2, "left", second]);
  log = (await logs(w)).at(-1)!;
  assert.deepEqual(log.details.changed, ["reason", "status"]);
  assert.deepEqual(log.details.before, { reason: null, status: "new" });
  assert.deepEqual(log.details.after, { reason: "waiting for the archive", status: "left" });

  // A removed field is a change too; the same body again writes no new version but is still logged.
  const without: Record<string, unknown> = { ...left };
  delete without.hypothesis;
  await write(w, "steward.issues", issue.key, without, null);
  log = (await logs(w)).at(-1)!;
  assert.deepEqual([log.details.changed, log.details.before, log.details.after], [["hypothesis"], { hypothesis: "a reader bug" }, {}]);
  await write(w, "steward.issues", issue.key, without, null);
  assert.equal((await current(w, "steward.issues", issue.key)).version, 3);
  assert.deepEqual((await logs(w)).at(-1)!.details.changed, []);
  for (const c of Object.values(STEWARD_COLLECTIONS)) assert.equal(await errorOf(write(w, c, "k", { a: 1 })), "ok", c);
});

test("admin_steward_write: only steward.* collections; a reported.* key raises not_steward_collection and writes nothing", async () => {
  const w = await bootDataDb();
  for (const collection of ["reported.review_queue", "reported.cds_records", "base.colleges", "steward", "stewardx.issues", "steward.", "Steward.issues", "steward.issues; drop", ""]) {
    assert.match(await errorOf(write(w, collection, "100654||", { resolved: "accepted" })), /not_steward_collection/, collection);
  }
  assert.equal(await codeOf(write(w, "reported.review_queue", "k", {})), "22023");
  assert.equal((await w.db.query("select 1 from public.data_documents")).rows.length, 0);
  assert.equal((await w.db.query("select 1 from public.data_change_sets")).rows.length, 0);
  assert.equal((await logs(w)).length, 0);
});

test("admin_steward_write: the body must be a JSON object; the key 1–200 characters; the note at most 500", async () => {
  const w = await bootDataDb();
  for (const body of ["[]", '"text"', "12", "null", "not json", "{"]) assert.match(await errorOf(write(w, "steward.todo", "k", body)), /invalid_body/, body);
  assert.match(await errorOf(value(w.db, admin(w), "public.admin_steward_write('steward.todo', 'k', null, null)")), /invalid_body/);
  assert.match(await errorOf(write(w, "steward.todo", "", {})), /invalid_key/);
  assert.match(await errorOf(write(w, "steward.todo", "k".repeat(201), {})), /invalid_key/);
  assert.match(await errorOf(write(w, "steward.todo", "k", {}, "n".repeat(501))), /invalid_note/);
  assert.equal(await errorOf(write(w, "steward.todo", "k".repeat(200), {}, "n".repeat(500))), "ok");
});

test("admin_steward_write: a non-admin, an admin at aal1 and a signed-out visitor are refused, and nothing is written", async () => {
  const w = await bootDataDb();
  assert.equal(await errorOf(write(w, "steward.issues", "k", {}, null, user(w.eve))), "admin only");
  assert.equal(await errorOf(write(w, "steward.issues", "k", {}, null, user(w.quinn, "aal1"))), "admin only");
  assert.match(await errorOf(run(w.db, anon, "select public.admin_steward_write('steward.issues', 'k', '{}', null)")), /permission denied/);
  assert.equal((await w.db.query("select 1 from public.data_documents")).rows.length, 0);
  assert.equal((await logs(w)).length, 0);
});

/* ------------------------------------------------------------------ */
/* Never composed, never served                                        */
/* ------------------------------------------------------------------ */

test("the console's steward collections are the store's", () => {
  assert.deepEqual(STEWARD_COLLECTIONS, COLLECTIONS.steward);
});

/** A store that records every collection read. */
function recording(store: DataStore): { store: DataStore; read: Set<string> } {
  const read = new Set<string>();
  return {
    read,
    store: {
      ...store,
      async read<T>(c: string, prefix?: string) {
        read.add(c);
        return store.read<T>(c, prefix);
      },
      async readOne<T>(c: string, key: string) {
        read.add(c);
        return store.readOne<T>(c, key);
      },
      async readVersioned<T>(c: string, prefix?: string) {
        read.add(c);
        return store.readVersioned<T>(c, prefix);
      },
    },
  };
}

test("the publisher's compose never reads a steward.* collection, so no snapshot carries one", async () => {
  const MARK = "steward-marker-7f3a";
  const steward = new Map(Object.values(COLLECTIONS.steward).map((c) => [c, new Map<string, unknown>([["221999", { unit_id: "221999", name: MARK, summary: MARK }]])]));
  const { store, read } = recording(overlayStore(miniLayers(), steward));
  const layers = await loadPublishLayers(store);
  assert.ok(read.size > 10, "the loader read the layers through the recorder");
  assert.deepEqual([...read].filter((c) => c.startsWith("steward.")), []);
  assert.deepEqual(Object.keys(layers.versions).filter((c) => c.startsWith("steward.")), []);
  const composed = composeSnapshot(layers, { previous: miniSchools(), today: "2026-11-01", trends: false });
  assert.ok(!JSON.stringify(composed.schools).includes(MARK));
  assert.ok(!JSON.stringify(composed.meta).includes(MARK));
});

/** Every source file under a folder. */
function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx|mts|json)$/.test(name) ? [path] : [];
  });
}

test("the Data API serves no steward.* collection: no route or API library reads the store or names a steward collection", () => {
  const files = [...sources(join(ROOT, "app", "api")), ...sources(join(ROOT, "lib", "api"))];
  assert.ok(files.some((f) => f.includes(join("app", "api", "v1"))), "the Data API's routes were scanned");
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.ok(!/steward\./.test(text), `${f} names a steward collection`);
    assert.ok(!/data_documents|lib\/admin\/steward-reads|steward-reads/.test(text), `${f} reads the store's documents`);
  }
});

test("the mini fixture's layers leave the steward collections out", () => {
  const builder = readFileSync(join(ROOT, "scripts", "build-mini-fixture.mts"), "utf8");
  const excludes = /const LAYER_EXCLUDES[^=]*=\s*\[([\s\S]*?)\];/.exec(builder)![1];
  for (const c of Object.values(COLLECTIONS.steward)) assert.ok(excludes.includes(`"${c}"`), `${c} is in LAYER_EXCLUDES`);
  const layers = readdirSync(join(ROOT, "tests", "fixtures", "snapshot-mini", "layers"));
  assert.deepEqual(layers.filter((c) => c.startsWith("steward.")), []);
});
