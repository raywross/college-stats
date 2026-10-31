/**
 * The data platform's store adapter (scripts/lib/data-platform/store.mts; specs/data-platform/pipelines.md "The
 * adapter"): the file store's semantics on a temp folder (idempotent writes, versions, conflicts, delete, change set
 * rows, key encoding), and the Supabase store's request shapes against a fake client (paging, chunking, the RPCs'
 * arguments, retries, conflict mapping). No test here touches a database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  READ_PAGE,
  StoreConflictError,
  WRITE_CHUNK,
  decodeKey,
  encodeKey,
  fileStore,
  fileStoreChangeSets,
  orderedJson,
  parseStoreFlag,
  retryable,
  storeFromFlag,
  supabaseStore,
  type StoreClient,
} from "../scripts/lib/data-platform/store.mts";
import { COLLECTIONS, readLayer, writeLayer, ALL_COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";

const tmp = () => mkdtempSync(join(tmpdir(), "dp-store-"));

test("orderedJson ignores key order at every depth and keeps array order", () => {
  assert.equal(orderedJson({ b: 1, a: { d: [2, 1], c: null } }), orderedJson({ a: { c: null, d: [2, 1] }, b: 1 }));
  assert.notEqual(orderedJson({ a: [1, 2] }), orderedJson({ a: [2, 1] }));
  assert.equal(orderedJson({ a: 1, b: undefined }), orderedJson({ a: 1 }));
  assert.equal(orderedJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

test("keys with / or | round-trip through the file names", () => {
  for (const key of ["essay-guidance/guidance", "100654|2025-26|C1", "2026-10-30T10:09:31Z", "plain-key_1.2"]) {
    assert.equal(decodeKey(encodeKey(key)), key);
    assert.ok(!encodeKey(key).includes("/") && !encodeKey(key).includes("|"), key);
  }
});

test("file store: write, read, versions, idempotent re-write, conflicts, delete, change set rows", async () => {
  const root = tmp();
  try {
    const store = fileStore(root);
    const c = COLLECTIONS.reported.reviewQueue;
    const set1 = await store.open("pipeline", "college-reported", "run-1", { cost_usd: 0.5 });
    await set1.write(c, [
      { key: "1|2025-26|C1", body: { a: 1, b: { y: 2, x: 1 } } },
      { key: "2||", body: { a: 2 } },
      { key: "3|x|C9", body: { a: 3 } },
    ]);
    // The key is one file, encoded; the body reads back as written.
    assert.ok(existsSync(join(root, c, `${encodeURIComponent("1|2025-26|C1")}.json`)));
    assert.deepEqual(await store.readOne(c, "1|2025-26|C1"), { a: 1, b: { y: 2, x: 1 } });
    const v1 = await store.readVersioned(c);
    assert.deepEqual([...v1.values()].map((d) => d.version), [1, 1, 1]);
    // The same bodies again (keys reordered inside) write nothing.
    await set1.write(c, [{ key: "1|2025-26|C1", body: { b: { x: 1, y: 2 }, a: 1 } }]);
    assert.equal(fileStoreChangeSets(root)[0].versions.length, 3);
    // A changed body is version 2.
    await set1.write(c, [{ key: "2||", body: { a: 20 } }]);
    assert.equal((await store.readVersioned(c)).get("2||")!.version, 2);
    // expectVersion: a mismatch refuses the whole call and writes nothing of it.
    await assert.rejects(
      set1.write(c, [
        { key: "3|x|C9", body: { a: 30 }, expectVersion: 1 },
        { key: "2||", body: { a: 21 }, expectVersion: 1 },
      ]),
      (err: unknown) => err instanceof StoreConflictError && err.key === "2||"
    );
    assert.deepEqual(await store.readOne(c, "3|x|C9"), { a: 3 });
    await set1.write(c, [{ key: "3|x|C9", body: { a: 30 }, expectVersion: 1 }]);
    // expectVersion 0: the document must not exist yet.
    await assert.rejects(set1.write(c, [{ key: "3|x|C9", body: { a: 31 }, expectVersion: 0 }]), StoreConflictError);
    await set1.write(c, [{ key: "4||", body: { a: 4 }, expectVersion: 0 }]);
    // Delete: the current file goes; deleting what isn't there writes nothing.
    await set1.remove(c, ["1|2025-26|C1", "nope"]);
    assert.equal(await store.readOne(c, "1|2025-26|C1"), null);
    assert.deepEqual([...(await store.read(c)).keys()], ["2||", "3|x|C9", "4||"]);
    // A key prefix narrows the read.
    assert.deepEqual([...(await store.read(c, "3|")).keys()], ["3|x|C9"]);
    await set1.close("applied");
    const [row] = fileStoreChangeSets(root);
    assert.equal(row.status, "applied");
    assert.equal(row.kind, "pipeline");
    assert.equal(row.run_ref, "run-1");
    assert.ok(row.closed_at);
    assert.deepEqual(
      { ...row.summary },
      { cost_usd: 0.5, documents: 7, added: 4, changed: 2, removed: 1, collections: [c] }
    );
    // A closed set refuses writes and a second close.
    await assert.rejects(set1.write(c, [{ key: "5||", body: {} }]), /change set is not open/);
    await assert.rejects(set1.close("applied"), /change set is not open/);
    // A re-created document continues its version numbers (the deleted one was at 2).
    const set2 = await store.open("import", "git", "abc", undefined);
    await set2.write(c, [{ key: "1|2025-26|C1", body: { back: true } }]);
    assert.equal((await store.readVersioned(c)).get("1|2025-26|C1")!.version, 3);
    await set2.close("held", "breaker tripped: half the reads held");
    const rows = fileStoreChangeSets(root);
    assert.deepEqual(rows.map((r) => [r.id, r.status, r.held_reason]), [
      [1, "applied", null],
      [2, "held", "breaker tripped: half the reads held"],
    ]);
    assert.equal(rows[1].summary.changed, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("file store: a second store over the same folder sees the writes; an empty folder reads empty", async () => {
  const root = tmp();
  try {
    assert.equal((await fileStore(root).read(COLLECTIONS.base.colleges)).size, 0);
    const set = await fileStore(root).open("import", "git", "x");
    await writeLayer(set, COLLECTIONS.history.shared, new Map([["meta", { built: "x" }], ["cpi", { values: [] }]]));
    await set.close("applied");
    assert.deepEqual([...(await readLayer(fileStore(root), COLLECTIONS.history.shared)).keys()], ["cpi", "meta"]);
    assert.deepEqual(readdirSync(join(root, COLLECTIONS.history.shared)).sort(), ["cpi.json", "meta.json"]);
    const file = JSON.parse(readFileSync(join(root, COLLECTIONS.history.shared, "meta.json"), "utf8"));
    assert.deepEqual(file, { version: 1, change_set_id: 1, body: { built: "x" } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bad collection names and keys are refused before anything is written", async () => {
  const root = tmp();
  try {
    const set = await fileStore(root).open("pipeline", "x", "r");
    await assert.rejects(set.write("Base.Colleges", [{ key: "1", body: {} }]), /collection name/);
    await assert.rejects(set.write(COLLECTIONS.base.colleges, [{ key: "", body: {} }]), /1 to 200/);
    await assert.rejects(set.write(COLLECTIONS.base.colleges, [{ key: "x".repeat(201), body: {} }]), /1 to 200/);
    await assert.rejects(set.write(COLLECTIONS.base.colleges, [{ key: "1", body: {} }, { key: "1", body: {} }]), /twice/);
    assert.equal(fileStoreChangeSets(root)[0].versions.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every collection name passes the database's check", () => {
  for (const c of ALL_COLLECTIONS) assert.match(c, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
  assert.equal(new Set(ALL_COLLECTIONS).size, ALL_COLLECTIONS.length);
});

/* ------------------------------------------------------------------ */
/* The Supabase store, against a fake client                           */
/* ------------------------------------------------------------------ */

type Result = { data: unknown; error: { message: string; code?: string } | null; status?: number };
interface Call {
  kind: "select" | "rpc";
  name: string;
  args: unknown;
  ops: [string, ...unknown[]][];
}

/** A client that records each request (table or function, filters, range) and answers from `answer`. */
function fakeClient(answer: (call: Call) => Result): { client: StoreClient; calls: Call[] } {
  const calls: Call[] = [];
  const builder = (call: Call) => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq", "like", "order", "range", "maybeSingle"]) {
      b[op] = (...args: unknown[]) => {
        call.ops.push([op, ...args]);
        return b;
      };
    }
    b.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => {
      calls.push(call);
      try {
        return Promise.resolve(answer(call)).then(resolve, reject);
      } catch (err) {
        return Promise.reject(err).then(resolve, reject);
      }
    };
    return b;
  };
  const client = {
    from: (table: string) => builder({ kind: "select", name: table, args: null, ops: [] }),
    rpc: (name: string, args: unknown) => builder({ kind: "rpc", name, args, ops: [] }),
  } as unknown as StoreClient;
  return { client, calls };
}

test("supabase store: reads page through data_documents 1,000 rows at a time, filtered by collection and prefix", async () => {
  const rows = Array.from({ length: READ_PAGE + 5 }, (_, i) => ({ key: String(100000 + i), version: 1, body: { i } }));
  const { client, calls } = fakeClient((call) => {
    const range = call.ops.find((o) => o[0] === "range")!;
    const [from, to] = [range[1] as number, range[2] as number];
    return { data: rows.slice(from, to + 1), error: null };
  });
  const store = supabaseStore("https://x.supabase.co", "secret", { client, waits: [0, 0, 0] });
  const docs = await store.read<{ i: number }>(COLLECTIONS.base.colleges, "1_0%");
  assert.equal(docs.size, READ_PAGE + 5);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "data_documents");
  assert.deepEqual(calls[0].ops, [
    ["select", "key, version, body"],
    ["eq", "collection", "base.colleges"],
    ["like", "key", "1\\_0\\%%"],
    ["order", "key", { ascending: true }],
    ["range", 0, READ_PAGE - 1],
  ]);
  assert.deepEqual(calls[1].ops.at(-1), ["range", READ_PAGE, 2 * READ_PAGE - 1]);
});

test("supabase store: readOne asks for one row", async () => {
  const { client, calls } = fakeClient(() => ({ data: { body: { ok: 1 } }, error: null }));
  const store = supabaseStore("u", "k", { client });
  assert.deepEqual(await store.readOne(COLLECTIONS.base.meta, "meta"), { ok: 1 });
  assert.deepEqual(calls[0].ops, [["select", "body"], ["eq", "collection", "base.meta"], ["eq", "key", "meta"], ["maybeSingle"]]);
  const none = fakeClient(() => ({ data: null, error: null }));
  assert.equal(await supabaseStore("u", "k", { client: none.client }).readOne(COLLECTIONS.base.meta, "meta"), null);
});

test("supabase store: open, write in chunks of 200, remove, close call the data_* functions with the spec's arguments", async () => {
  const { client, calls } = fakeClient((call) => {
    if (call.name === "data_open_change_set") return { data: 42, error: null };
    if (call.name === "data_write_documents") return { data: (call.args as { p_documents: unknown[] }).p_documents.length, error: null };
    return { data: null, error: null };
  });
  const store = supabaseStore("u", "k", { client });
  const set = await store.open("pipeline", "essay-prompts", "run-7", { budget_usd: 40 });
  assert.equal(set.id, 42);
  const docs = Array.from({ length: WRITE_CHUNK * 2 + 1 }, (_, i) => ({ key: String(i), body: { i } }));
  await set.write(COLLECTIONS.essays.records, docs);
  await set.write(COLLECTIONS.essays.records, [{ key: "x", body: { v: 2 }, expectVersion: 3 }]);
  await set.remove(COLLECTIONS.essays.held, ["9"]);
  await set.close("held", "over half held", { held: 30 });
  assert.deepEqual(calls[0].args, { p_kind: "pipeline", p_source: "essay-prompts", p_run_ref: "run-7", p_summary: { budget_usd: 40 } });
  const writes = calls.filter((c) => c.name === "data_write_documents").map((c) => c.args as { p_change_set: number; p_documents: Record<string, unknown>[] });
  assert.deepEqual(writes.map((w) => w.p_documents.length), [WRITE_CHUNK, WRITE_CHUNK, 1, 1, 1]);
  assert.ok(writes.every((w) => w.p_change_set === 42));
  assert.deepEqual(writes[0].p_documents[0], { collection: "essays.records", key: "0", body: { i: 0 } });
  assert.deepEqual(writes[3].p_documents[0], { collection: "essays.records", key: "x", body: { v: 2 }, expect_version: 3 });
  assert.deepEqual(writes[4].p_documents[0], { collection: "essays.held", key: "9", body: null });
  assert.deepEqual(calls.at(-1)!.args, { p_change_set: 42, p_status: "held", p_held_reason: "over half held", p_summary: { held: 30 } });
  assert.equal(calls.at(-1)!.name, "data_close_change_set");
});

test("supabase store: retries a failed call three times, never a refusal; 40001 is a StoreConflictError", async () => {
  let n = 0;
  const flaky = fakeClient(() => (++n <= 3 ? { data: null, error: { message: "fetch failed" } } : { data: 7, error: null }));
  const store = supabaseStore("u", "k", { client: flaky.client, waits: [0, 0, 0] });
  assert.equal((await store.open("import", "git", "h")).id, 7);
  assert.equal(flaky.calls.length, 4);

  const down = fakeClient(() => ({ data: null, error: { message: "upstream", code: "" }, status: 503 }));
  await assert.rejects(supabaseStore("u", "k", { client: down.client, waits: [0, 0, 0] }).open("import", "git", "h"), /failed: upstream/);
  assert.equal(down.calls.length, 4);

  const closed = fakeClient((call) => (call.name === "data_open_change_set" ? { data: 1, error: null } : { data: null, error: { message: "change set is not open", code: "P0001" } }));
  const set = await supabaseStore("u", "k", { client: closed.client, waits: [0, 0, 0] }).open("import", "git", "h");
  await assert.rejects(set.write(COLLECTIONS.base.meta, [{ key: "meta", body: {} }]), /change set is not open/);
  assert.equal(closed.calls.length, 2);

  const conflict = fakeClient((call) => (call.name === "data_open_change_set" ? { data: 1, error: null } : { data: null, error: { message: "version conflict", code: "40001" } }));
  const set2 = await supabaseStore("u", "k", { client: conflict.client, waits: [0, 0, 0] }).open("import", "git", "h");
  await assert.rejects(set2.write(COLLECTIONS.base.meta, [{ key: "meta", body: {}, expectVersion: 1 }]), StoreConflictError);
  assert.equal(conflict.calls.length, 2);

  assert.equal(retryable({ error: { message: "x", code: "57P01" } }), true);
  assert.equal(retryable({ error: { message: "x", code: "PGRST202" }, status: 404 }), false);
  assert.equal(retryable({ error: { message: "x", code: "22023" } }), false);
});

test("--store: file:<dir>, supabase with the env fallbacks, and no silent default to the app's project", () => {
  assert.deepEqual(parseStoreFlag("file:/tmp/x", {}), { kind: "file", root: "/tmp/x" });
  assert.deepEqual(parseStoreFlag("supabase", { DATA_SUPABASE_URL: "https://d", DATA_SUPABASE_SECRET_KEY: "dk", SUPABASE_URL: "https://a", SUPABASE_SECRET_KEY: "ak" }), { kind: "supabase", url: "https://d", key: "dk" });
  assert.deepEqual(parseStoreFlag("supabase", { SUPABASE_URL: "https://a", SUPABASE_SECRET_KEY: "ak" }), { kind: "supabase", url: "https://a", key: "ak" });
  assert.throws(() => parseStoreFlag("supabase", {}), /DATA_SUPABASE_URL/);
  // No flag: supabase only when DATA_SUPABASE_URL is set; SUPABASE_URL alone (the app's .env.local) is not enough.
  assert.throws(() => parseStoreFlag(undefined, { SUPABASE_URL: "https://a", SUPABASE_SECRET_KEY: "ak" }), /--store is required/);
  assert.equal(parseStoreFlag(undefined, { DATA_SUPABASE_URL: "https://d", DATA_SUPABASE_SECRET_KEY: "dk" }).kind, "supabase");
  assert.throws(() => parseStoreFlag("postgres", {}), /expected supabase or file/);
  assert.throws(() => parseStoreFlag("file:", {}), /needs a folder/);
  assert.equal(typeof storeFromFlag("file:/tmp/never-written", {}).read, "function");
});
