/**
 * The data platform's loader (specs/data-platform/publish.md "The loader"; lib/data-platform/loader.ts, lib/data.ts)
 * and the build's fetch (scripts/fetch-snapshot.mts): which source each environment picks, the bundled copy, the
 * pointer check and the whole-dataset swap, shards with their fallback, and the download with hash checks. Snapshots
 * here are built in the test from three real colleges and served from memory or a local node:http server; nothing
 * reaches the network. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(import.meta.dirname, "..");

// lib/ is written for Next.js (`server-only`, `@/` paths, extensionless relative imports): resolve them the way
// Next.js does, as tests/supabase.test.mts does.
type ResolveResult = { url: string; shortCircuit?: boolean };
type ResolveContext = { parentURL?: string };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: ResolveContext, next: (s: string, c: ResolveContext) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    const fromRoot = specifier.startsWith("@/");
    if (fromRoot || ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:"))) {
      const path = fromRoot ? join(ROOT, specifier.slice(2)) : fileURLToPath(new URL(specifier, context.parentURL));
      if (!extname(path) || !existsSync(path)) {
        const found = [".ts", ".tsx", "/index.ts"].map((ext) => path + ext).find((p) => existsSync(p));
        if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
      }
      if (fromRoot) return { url: pathToFileURL(path).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const loader = await import("../lib/data-platform/loader.ts");
const { snapshotPath, POINTER_OBJECT } = await import("../lib/data-platform/snapshot.ts");
const fetchScript = await import("../scripts/fetch-snapshot.mts");
type SnapshotContent = import("../lib/data-platform/loader.ts").SnapshotContent;

/* ------------------------------------------------------------------ */
/* A tiny snapshot from three real colleges                            */
/* ------------------------------------------------------------------ */

const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const ALL = readJson("data/schools.json") as { unit_id: string; name: string }[];
const THREE = ALL.slice(0, 3);
const IDS = new Set(THREE.map((s) => s.unit_id));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const collegesText = (schools: unknown[]) => `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`;

/** Snapshot `id`'s objects (bucket-relative path → bytes) plus its pointer, as the publisher would upload them. */
function buildSnapshot(id: number, options: { rename?: string } = {}): { objects: Map<string, Buffer>; pointer: Buffer } {
  const schools = THREE.map((s, i) => (i === 0 && options.rename ? { ...s, name: options.rename } : s));
  const unit = THREE[0].unit_id;
  const plain: Record<string, Buffer> = {
    "colleges.json.gz": gzipSync(collegesText(schools)),
    "meta.json": Buffer.from(JSON.stringify(readJson("data/meta.json"))),
    "release-calendar.json": Buffer.from(JSON.stringify(readJson("data/release-calendar.json"))),
    "aliases.json": Buffer.from(JSON.stringify((readJson("data/aliases.json") as { unit_id: string }[]).filter((a) => IDS.has(a.unit_id)))),
    "history/shared.json.gz": gzipSync(
      JSON.stringify({ meta: readJson("data/history/meta.json"), national: readJson("data/history/national.json"), facts: readJson("data/history/facts.json"), cpi: readJson("data/history/cpi.json") }),
    ),
    [`history/${unit}.json`]: Buffer.from(JSON.stringify({ unit_id: unit, snapshot: id })),
    [`detail/${unit}.json`]: Buffer.from(JSON.stringify({ unit_id: unit, snapshot: id })),
    "reference/essay-guidance.md": Buffer.from(`# Guidance ${id}\n`),
  };
  const manifest = {
    id,
    created_at: new Date(0).toISOString(),
    previous_id: id > 1 ? id - 1 : null,
    colleges: schools.length,
    objects: Object.fromEntries(Object.entries(plain).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }])),
    layers: {},
    change_set_ids: [],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const objects = new Map<string, Buffer>();
  for (const [name, bytes] of Object.entries(plain)) objects.set(snapshotPath(id, name), bytes);
  objects.set(snapshotPath(id, "manifest.json"), manifestBytes);
  const pointer = Buffer.from(JSON.stringify({ id, at: new Date(0).toISOString(), manifest_sha256: sha256(manifestBytes) }));
  return { objects, pointer };
}

/** An in-memory bucket: put snapshots, move the pointer, break things, count requests. */
function fakeBucket() {
  const objects = new Map<string, Buffer>();
  const requests: string[] = [];
  let failing = false;
  const BASE = "https://storage.test/storage/v1/object/public/snapshots";
  return {
    BASE,
    requests,
    put(snapshot: { objects: Map<string, Buffer>; pointer: Buffer }) {
      for (const [k, v] of snapshot.objects) objects.set(k, v);
    },
    point(snapshot: { pointer: Buffer }) {
      objects.set(POINTER_OBJECT, snapshot.pointer);
    },
    tamper(path: string) {
      objects.set(path, Buffer.from("tampered"));
    },
    fail(on: boolean) {
      failing = on;
    },
    get: async (url: string) => {
      requests.push(url);
      if (failing) throw new Error("storage is down");
      const path = url.slice(BASE.length + 1).replace(/\?.*$/, "");
      const body = objects.get(path);
      return body ? { status: 200, body } : { status: 404, body: Buffer.from("not found") };
    },
  };
}

/** A temp folder holding `.data/snapshot/` written as fetch-snapshot would (gz objects ungzipped), for snapshot `id`. */
function bundledRoot(id: number): string {
  const root = mkdtempSync(join(tmpdir(), "dp-bundled-"));
  const dir = join(root, ".data", "snapshot");
  const { objects } = buildSnapshot(id);
  for (const [path, bytes] of objects) {
    const name = path.slice(snapshotPath(id, "").length);
    const local = join(dir, name.replace(/\.gz$/, ""));
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, name.endsWith(".gz") ? (zlibGunzip(bytes) as Buffer) : bytes);
  }
  return root;
}
const { gunzipSync: zlibGunzip } = await import("node:zlib");

/** console.info/error captured while `fn` runs. */
async function withConsole<T>(fn: (logs: { info: string[]; error: string[] }) => Promise<T>): Promise<T> {
  const original = { info: console.info, error: console.error };
  const logs = { info: [] as string[], error: [] as string[] };
  console.info = (...args: unknown[]) => void logs.info.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void logs.error.push(args.map(String).join(" "));
  try {
    return await fn(logs);
  } finally {
    Object.assign(console, original);
  }
}

const LEGACY: SnapshotContent = { id: "legacy", files: { schools: [], meta: {} as never, releaseCalendar: {} as never, aliases: [] }, history: null };

/* ------------------------------------------------------------------ */
/* Source selection                                                    */
/* ------------------------------------------------------------------ */

test("snapshotSource(): storage when DATA_SNAPSHOT_URL is set, else bundled when a copy exists, else legacy", () => {
  const empty = mkdtempSync(join(tmpdir(), "dp-empty-"));
  const bundled = bundledRoot(0);
  const URL_ = "https://ref.supabase.co/storage/v1/object/public/snapshots/";
  assert.deepEqual(loader.snapshotSource({}, empty), { kind: "legacy" });
  assert.deepEqual(loader.snapshotSource({}, bundled), { kind: "bundled" });
  assert.deepEqual(loader.snapshotSource({ DATA_SNAPSHOT_URL: URL_ }, empty), { kind: "storage", base: URL_.replace(/\/$/, "") });
  assert.deepEqual(loader.snapshotSource({ DATA_SNAPSHOT_URL: URL_ }, bundled), { kind: "storage", base: URL_.replace(/\/$/, "") });
  // Empty or blank counts as unset, like a variable created in a dashboard without a value.
  assert.deepEqual(loader.snapshotSource({ DATA_SNAPSHOT_URL: " " }, empty), { kind: "legacy" });
  assert.deepEqual(loader.snapshotSource({ DATA_SNAPSHOT_URL: "" }, bundled), { kind: "bundled" });
  // A folder without its manifest (a fetch cut short) is not a copy.
  rmSync(join(bundled, ".data", "snapshot", "manifest.json"));
  assert.deepEqual(loader.snapshotSource({}, bundled), { kind: "legacy" });
});

test("readBundled() reads the ungzipped copy: id, colleges, meta, calendar, aliases, history's shared object", () => {
  const root = bundledRoot(7);
  const content = loader.readBundled(root);
  assert.equal(content.id, 7);
  assert.deepEqual(content.files.schools.map((s) => s.unit_id), THREE.map((s) => s.unit_id));
  assert.deepEqual(content.files.meta, readJson("data/meta.json"));
  assert.ok((content.files.aliases ?? []).every((a) => IDS.has(a.unit_id)));
  assert.deepEqual(content.history?.cpi, readJson("data/history/cpi.json"));
  // Aliases and history are optional, as their files are today.
  rmSync(join(root, ".data", "snapshot", "aliases.json"));
  rmSync(join(root, ".data", "snapshot", "history", "shared.json"));
  const bare = loader.readBundled(root);
  assert.deepEqual(bare.files.aliases, []);
  assert.equal(bare.history, null);
});

/* ------------------------------------------------------------------ */
/* Pointer, swap, the 60-second gate                                   */
/* ------------------------------------------------------------------ */

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

test("fetchSnapshotFiles() checks every object against the manifest and the manifest against the pointer", async () => {
  const bucket = fakeBucket();
  const one = buildSnapshot(1);
  bucket.put(one);
  bucket.point(one);
  const pointer = await loader.fetchPointer(bucket.BASE, bucket.get);
  const content = await loader.fetchSnapshotFiles(bucket.BASE, pointer.id, bucket.get, pointer.manifest_sha256);
  assert.equal(content.files.schools.length, 3);
  assert.deepEqual(content.history?.facts, readJson("data/history/facts.json"));
  await assert.rejects(loader.fetchSnapshotFiles(bucket.BASE, 1, bucket.get, "0".repeat(64)), /manifest doesn't match the pointer/);
  bucket.tamper(snapshotPath(1, "colleges.json.gz"));
  await assert.rejects(loader.fetchSnapshotFiles(bucket.BASE, 1, bucket.get), /colleges\.json\.gz doesn't match its hash/);
  await assert.rejects(loader.fetchSnapshotFiles(bucket.BASE, 9, bucket.get), /404/);
});

test("a moved pointer swaps in a new dataset object; the old one is untouched; the check runs at most once a minute", async () => {
  await withConsole(async (logs) => {
    const bucket = fakeBucket();
    const one = buildSnapshot(1);
    const two = buildSnapshot(2, { rename: "Renamed in snapshot two" });
    bucket.put(one);
    bucket.put(two);
    bucket.point(one);
    const time = clock();
    const swaps: unknown[] = [];
    const empty = mkdtempSync(join(tmpdir(), "dp-nobundle-"));
    const holder = loader.createSnapshotHolder({
      source: { kind: "storage", base: bucket.BASE },
      readLegacy: () => LEGACY,
      build: (content) => ({ names: content.files.schools.map((s) => s.name) }),
      root: empty,
      get: bucket.get,
      now: time.now,
      onSwap: (s) => swaps.push(s),
    });

    // No bundled copy: the first load downloads the current snapshot.
    const first = await holder.load();
    assert.equal(first.id, 1);
    assert.equal(first.value.names[0], THREE[0].name);
    assert.deepEqual(logs.info, ["[data] loaded 3 colleges (snapshot 1) in 0 ms"]);

    // Within the minute: no pointer read at all.
    const before = bucket.requests.length;
    time.advance(30_000);
    await holder.maybeRefresh();
    assert.equal(bucket.requests.length, before, "no request inside the 60 s gate");

    // The pointer moves; after the minute, one check swaps.
    bucket.point(two);
    time.advance(31_000);
    await holder.maybeRefresh();
    const second = await holder.load();
    assert.equal(second.id, 2);
    assert.notEqual(second.value, first.value, "a new dataset object");
    assert.equal(second.value.names[0], "Renamed in snapshot two");
    assert.equal(first.value.names[0], THREE[0].name, "a render holding the old one keeps it, unchanged");
    assert.equal(first.id, 1);
    assert.deepEqual(swaps, [{ from: 1, to: 2, ms: 0 }]);
    assert.equal(logs.info.at(-1), "[data] loaded 3 colleges (snapshot 2) in 0 ms");

    // Same pointer again: a read, no swap.
    time.advance(61_000);
    await holder.maybeRefresh();
    assert.equal(holder.current(), second);

    // Storage down: never throws, keeps serving, logs once per minute at most.
    bucket.fail(true);
    time.advance(61_000);
    await holder.maybeRefresh();
    await holder.maybeRefresh(); // inside the gate: no request, no second line
    assert.equal(holder.current(), second);
    assert.equal(logs.error.length, 1);
    assert.match(logs.error[0], /checking for a newer snapshot failed; still serving the current one/);

    // A bad object in a newer snapshot: no swap, the current stays.
    bucket.fail(false);
    const three = buildSnapshot(3);
    bucket.put(three);
    bucket.tamper(snapshotPath(3, "meta.json"));
    bucket.point(three);
    time.advance(61_000);
    await holder.maybeRefresh();
    assert.equal(holder.current(), second);

    // Pointing back to an older snapshot is followed too (the console's "Point back here").
    bucket.point(one);
    time.advance(61_000);
    await holder.maybeRefresh();
    assert.equal(holder.current()?.id, 1);
    assert.deepEqual(swaps.at(-1), { from: 2, to: 1, ms: 0 });
  });
});

test("concurrent checks share one pointer read, and the first load is shared by concurrent callers", async () => {
  await withConsole(async () => {
    const bucket = fakeBucket();
    const one = buildSnapshot(1);
    bucket.put(one);
    bucket.point(one);
    const time = clock();
    let builds = 0;
    const holder = loader.createSnapshotHolder({
      source: { kind: "storage", base: bucket.BASE },
      readLegacy: () => LEGACY,
      build: () => ({ copy: ++builds }),
      root: mkdtempSync(join(tmpdir(), "dp-nobundle-")),
      get: bucket.get,
      now: time.now,
    });
    const all = await Promise.all([holder.load(), holder.load(), holder.load()]);
    assert.equal(builds, 1);
    assert.ok(all.every((s) => s === all[0]));
    time.advance(61_000);
    const pointerReads = () => bucket.requests.filter((u) => u.includes("current.json")).length;
    const readsBefore = pointerReads();
    await Promise.all([holder.maybeRefresh(), holder.maybeRefresh(), holder.maybeRefresh()]);
    assert.equal(pointerReads() - readsBefore, 1);
  });
});

test("storage with a bundled copy serves the copy first (no request), then the first check swaps to the pointer's snapshot", async () => {
  await withConsole(async (logs) => {
    const bucket = fakeBucket();
    const two = buildSnapshot(2);
    bucket.put(two);
    bucket.point(two);
    const holder = loader.createSnapshotHolder({
      source: { kind: "storage", base: bucket.BASE },
      readLegacy: () => LEGACY,
      build: (content) => content.id,
      root: bundledRoot(0),
      get: bucket.get,
      now: clock().now,
    });
    assert.equal((await holder.load()).id, 0);
    assert.deepEqual(bucket.requests, [], "the cold start reads only the disk");
    assert.equal(logs.info[0], "[data] loaded 3 colleges (snapshot 0) in 0 ms");
    await holder.maybeRefresh();
    assert.equal(holder.current()?.id, 2);
  });
});

test("storage unreachable with no bundled copy falls back to data/; the bundled and legacy sources never touch the network", async () => {
  await withConsole(async (logs) => {
    const bucket = fakeBucket();
    bucket.fail(true);
    const time = clock();
    const fallback = loader.createSnapshotHolder({
      source: { kind: "storage", base: bucket.BASE },
      readLegacy: () => LEGACY,
      build: (content) => content.id,
      root: mkdtempSync(join(tmpdir(), "dp-nobundle-")),
      get: bucket.get,
      now: time.now,
    });
    assert.equal((await fallback.load()).id, "legacy");
    assert.match(logs.error[0], /could not be loaded; falling back to data\//);
    assert.equal(logs.info[0], "[data] loaded 0 colleges from data/ in 0 ms");

    for (const source of [{ kind: "bundled" as const }, { kind: "legacy" as const }]) {
      const requests: string[] = [];
      const holder = loader.createSnapshotHolder({
        source,
        readLegacy: () => LEGACY,
        build: (content) => content.id,
        root: bundledRoot(4),
        get: async (url) => (requests.push(url), { status: 500, body: Buffer.alloc(0) }),
        now: time.now,
      });
      assert.equal((await holder.load()).id, source.kind === "bundled" ? 4 : "legacy");
      time.advance(120_000);
      await holder.maybeRefresh();
      assert.deepEqual(requests, [], `${source.kind}: no request`);
    }
  });
});

test("next build never swaps: every prerendered page comes from the one copy", async () => {
  const saved = process.env.NEXT_PHASE;
  process.env.NEXT_PHASE = "phase-production-build";
  try {
    const bucket = fakeBucket();
    const two = buildSnapshot(2);
    bucket.put(two);
    bucket.point(two);
    const holder = loader.createSnapshotHolder({
      source: { kind: "storage", base: bucket.BASE },
      readLegacy: () => LEGACY,
      build: (content) => content.id,
      root: bundledRoot(1),
      get: bucket.get,
      now: clock().now,
    });
    await withConsole(async () => {
      await holder.load();
      await holder.maybeRefresh();
    });
    assert.equal(holder.current()?.id, 1);
    assert.deepEqual(bucket.requests, []);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = saved;
  }
});

/* ------------------------------------------------------------------ */
/* Shards                                                              */
/* ------------------------------------------------------------------ */

test("readShard(): fetched for the snapshot's id with force-cache; 404 is none; a failure falls back to the bundled file", async () => {
  const root = bundledRoot(5);
  const unit = THREE[0].unit_id;
  const base = "https://storage.test/storage/v1/object/public/snapshots";
  assert.equal(loader.shardUrl("history", unit, 12, base), `${base}/snapshots/12/history/${unit}.json`);
  assert.equal(loader.shardUrl("reference", "essay-guidance.md", 12, base), `${base}/snapshots/12/reference/essay-guidance.md`);
  assert.equal(loader.shardUrl("trend", "movers", null, base), null, "no snapshot id, no URL");

  const realFetch = globalThis.fetch;
  const seen: { url: string; cache?: RequestCache }[] = [];
  let mode: "ok" | "404" | "down" = "ok";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url, cache: init?.cache });
    if (mode === "down") throw new Error("network down");
    if (mode === "404") return new Response("missing", { status: 404 });
    return new Response(url.endsWith(".md") ? "# from storage" : JSON.stringify({ from: "storage" }), { status: 200 });
  }) as typeof fetch;
  try {
    await withConsole(async (logs) => {
      assert.deepEqual(await loader.readShard("history", unit, { id: 12, base, root }), { from: "storage" });
      assert.deepEqual(seen[0], { url: `${base}/snapshots/12/history/${unit}.json`, cache: "force-cache" });
      assert.equal(await loader.readShard("reference", "essay-guidance.md", { id: 12, base, root }), "# from storage");
      mode = "404";
      assert.equal(await loader.readShard("detail", unit, { id: 12, base, root }), null, "the snapshot has none");
      mode = "down";
      assert.deepEqual(await loader.readShard("detail", unit, { id: 12, base, root }), { unit_id: unit, snapshot: 5 }, "the bundled file");
      assert.equal(await loader.readShard("reference", "essay-guidance.md", { id: 12, base, root }), "# Guidance 5\n");
      assert.equal(await loader.readShard("trend", "movers", { id: 12, base, root }), null, "not bundled either");
      assert.equal(logs.error.length, 1, "logged once a minute at most");
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ------------------------------------------------------------------ */
/* lib/data.ts end to end                                              */
/* ------------------------------------------------------------------ */

/** A fresh lib/data.ts (its own instance state), run with the working directory and env given. */
async function withDataModule<T>(cwd: string, env: Record<string, string | undefined>, fn: (data: typeof import("../lib/data.ts")) => Promise<T>): Promise<T> {
  const savedCwd = process.cwd();
  const savedEnv = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.chdir(cwd);
  try {
    const mod = (await import(`${pathToFileURL(join(ROOT, "lib", "data.ts")).href}?instance=${Math.random()}`)) as typeof import("../lib/data.ts");
    return await fn(mod);
  } finally {
    process.chdir(savedCwd);
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("lib/data.ts with a bundled copy: the dataset, history, shards and the snapshot id all come from .data/snapshot/", async () => {
  const root = bundledRoot(0);
  const unit = THREE[0].unit_id;
  await withConsole(async (logs) => {
    await withDataModule(root, { DATA_SNAPSHOT_URL: undefined, DATA_SOURCE: undefined }, async (data) => {
      const dataset = await data.getData();
      assert.deepEqual(dataset.getAllSchools().map((s) => s.unit_id).sort(), [...IDS].sort());
      assert.equal(await data.getSnapshotId(), "0");
      assert.deepEqual(await data.getHistory(unit), { unit_id: unit, snapshot: 0 });
      assert.deepEqual(await data.getDetail(unit), { unit_id: unit, snapshot: 0 });
      assert.equal(await data.getHistory("999999999"), null);
      assert.deepEqual((await data.getHistoryFiles())?.cpi, readJson("data/history/cpi.json"));
      assert.equal(await data.getPlatformPrompts(), null, "not in this copy");
      const { snapshot, aliases } = await data.getSearchIndexInputs();
      assert.equal(snapshot, "0");
      assert.ok(aliases.every((a) => IDS.has(a.unit_id)));
    });
    assert.equal(logs.info.length, 1, "one load line");
    assert.match(logs.info[0], /^\[data\] loaded 3 colleges \(snapshot 0\) in \d+ ms$/);
    assert.deepEqual(logs.error, []);
  });
});

test("lib/data.ts with nothing configured reads data/ and reports `legacy` without loading the dataset", async (t) => {
  if (existsSync(join(ROOT, ".data", "snapshot", "manifest.json"))) return t.skip("a local fetch-snapshot wrote .data/snapshot/: this checkout is in bundled mode");
  await withConsole(async (logs) => {
    await withDataModule(ROOT, { DATA_SNAPSHOT_URL: undefined }, async (data) => {
      assert.equal(await data.getSnapshotId(), "legacy");
      assert.deepEqual(logs.info, [], "the id needs no load");
      const dataset = await data.getData();
      assert.equal(dataset.getAllSchools().length, ALL.length);
      assert.match(logs.info[0], /^\[data\] loaded \d+ colleges from data\/ in \d+ ms$/);
      assert.equal((await data.getSearchIndexInputs()).snapshot, "legacy");
    });
  });
});

/* ------------------------------------------------------------------ */
/* fetch-snapshot                                                      */
/* ------------------------------------------------------------------ */

/** A local node:http server serving a bucket's objects under /storage/v1/object/public/snapshots/. */
async function serveBucket(objects: Map<string, Buffer>): Promise<{ base: string; server: Server; hits: string[] }> {
  const hits: string[] = [];
  const PREFIX = "/storage/v1/object/public/snapshots/";
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "").replace(/\?.*$/, "")).slice(PREFIX.length);
    hits.push(path);
    const body = objects.get(path);
    if (!body) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "application/octet-stream" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}${PREFIX.replace(/\/$/, "")}`, server, hits };
}

test("fetch-snapshot downloads pointer → manifest → objects, checks hashes, gunzips, skips what is present, removes the rest", async () => {
  const objects = new Map<string, Buffer>();
  const one = buildSnapshot(1);
  for (const [k, v] of one.objects) objects.set(k, v);
  objects.set(POINTER_OBJECT, one.pointer);
  const { base, server, hits } = await serveBucket(objects);
  try {
    const dir = join(mkdtempSync(join(tmpdir(), "dp-fetch-")), ".data", "snapshot");
    const first = await fetchScript.fetchSnapshot({ base, dir });
    assert.equal(first.id, 1);
    assert.equal(first.skipped, 0);
    assert.equal(first.downloaded, 8);
    assert.equal(readFileSync(join(dir, "colleges.json"), "utf8"), collegesText(THREE), "ungzipped, one college per line");
    assert.ok(existsSync(join(dir, "history", "shared.json")));
    assert.ok(!existsSync(join(dir, "colleges.json.gz")));
    assert.equal(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).id, 1);
    // The loader reads what it wrote.
    assert.equal(loader.readBundled(dirname(dirname(dir))).files.schools.length, 3);

    // Again: everything present with the right hash is skipped.
    hits.length = 0;
    const again = await fetchScript.fetchSnapshot({ base, dir });
    assert.deepEqual([again.downloaded, again.skipped], [0, 8]);
    assert.deepEqual(hits.sort(), [POINTER_OBJECT, snapshotPath(1, "manifest.json")].sort());

    // A file changed on disk (plain or ungzipped) is fetched again; a stray file is removed.
    writeFileSync(join(dir, "meta.json"), "{}");
    writeFileSync(join(dir, "colleges.json"), "[]");
    writeFileSync(join(dir, "detail", "999999.json"), "{}");
    const repaired = await fetchScript.fetchSnapshot({ base, dir });
    assert.deepEqual([repaired.downloaded, repaired.removed], [2, 1]);
    assert.equal(readFileSync(join(dir, "colleges.json"), "utf8"), collegesText(THREE));

    // A newer snapshot: only what changed downloads (snapshot 2's shards differ; meta, calendar, aliases don't).
    const two = buildSnapshot(2);
    for (const [k, v] of two.objects) objects.set(k, v);
    objects.set(POINTER_OBJECT, two.pointer);
    const moved = await fetchScript.fetchSnapshot({ base, dir });
    assert.equal(moved.id, 2);
    assert.ok(moved.skipped >= 3, `unchanged objects skipped (${moved.skipped})`);

    // A tampered object fails the fetch, and the folder is left without a manifest (not a copy).
    objects.set(snapshotPath(2, `detail/${THREE[0].unit_id}.json`), Buffer.from("tampered"));
    rmSync(join(dir, "detail", `${THREE[0].unit_id}.json`));
    await assert.rejects(fetchScript.fetchSnapshot({ base, dir }), /doesn't match its hash/);
    assert.ok(!existsSync(join(dir, "manifest.json")));
    assert.equal(loader.snapshotSource({}, dirname(dirname(dir))).kind, "legacy");
  } finally {
    server.close();
  }
});

test("fetch-snapshot's flags: --if-configured is a no-op without DATA_SNAPSHOT_URL; --check; --fixture", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "dp-cli-"));
  const quiet = async (fn: () => Promise<number>) => {
    const original = { log: console.log, error: console.error };
    const lines: string[] = [];
    console.log = console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      return { code: await fn(), lines };
    } finally {
      Object.assign(console, original);
    }
  };
  const noop = await quiet(() => fetchScript.main(["--if-configured"], {}, cwd));
  assert.deepEqual(noop, { code: 0, lines: [] }, "nothing printed");
  assert.ok(!existsSync(join(cwd, ".data")), "nothing written");
  assert.equal((await quiet(() => fetchScript.main([], {}, cwd))).code, 1, "a plain fetch needs the URL");
  assert.equal((await quiet(() => fetchScript.main(["--check"], {}, cwd))).code, 1);

  const fixture = await quiet(() => fetchScript.main(["--fixture"], {}, cwd));
  if (existsSync(join(fetchScript.FIXTURE_DIR, "manifest.json"))) {
    assert.equal(fixture.code, 0);
    assert.ok(existsSync(join(cwd, ".data", "snapshot", "manifest.json")));
    assert.equal((await quiet(() => fetchScript.main(["--check"], {}, cwd))).code, 0);
  } else {
    assert.equal(fixture.code, 1);
    assert.match(fixture.lines.join("\n"), /the mini fixture isn't built yet/);
  }

  // The real prebuild command, as npm runs it: exits 0 and prints nothing when nothing is configured.
  const env = { ...process.env };
  delete env.DATA_SNAPSHOT_URL;
  const run = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "fetch-snapshot.mts"), "--if-configured"], { cwd, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout + run.stderr, "");
  assert.ok(!existsSync(join(cwd, ".data")));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.prebuild, /scripts\/fetch-snapshot\.mts --if-configured$/);
});
