/**
 * The publisher (scripts/publish-snapshot.mts, scripts/lib/data-platform/{compose,render,upload,changelog,ledger}.mts;
 * specs/data-platform/publish.md). The layers fixture is three real colleges stripped by the import's own code
 * (scripts/import-data-from-git.mts `importLayers`) into a file store in a temp folder: Duke (Common App, Coalition,
 * essays, college-reported with a CDS record, directories, the campus pilot's policies), Simpson University (CCCU,
 * Common App's international-aid answer), Hilbert College (Common App's own-site links). The full proof, every
 * college and shard byte for byte, is the phase gate: `npm run publish-snapshot -- --store file:<import> --dry-run
 * --out <dir>` over a full import, compared with `cmp`. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type { DatasetMeta, School } from "../lib/types";
import { formatDetail } from "../lib/detail.ts";
import { validateLineage, validateSchool } from "../lib/lineage.ts";
import { POINTER_OBJECT, SNAPSHOT_OBJECTS, detailObject, historyObject, snapshotPath, type SnapshotPointer } from "../lib/data-platform/snapshot.ts";
import { withEdits, type FieldEdit } from "../lib/data-platform/edits.ts";
import { formatAliasRows } from "../scripts/lib/aliases-sync.mts";
import { formatSchools } from "../scripts/lib/identity-sync.mts";
import { placeSelectivity } from "../scripts/lib/selectivity.mts";
import { formatHistoryShard } from "../scripts/history/build.mts";
import { ALL_COLLECTIONS, COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import { fileStore } from "../scripts/lib/data-platform/store.mts";
import { importLayers, writeImport } from "../scripts/import-data-from-git.mts";
import { composeSnapshot, loadPublishLayers, type PublishLayers } from "../scripts/lib/data-platform/compose.mts";
import { renderSnapshot, sha256 } from "../scripts/lib/data-platform/render.mts";
import { fileBucket, movePointer, pointerFor, prune, snapshotsToKeep, uploadSnapshot, type BucketClient, type SnapshotRow } from "../scripts/lib/data-platform/upload.mts";
import { recordChanges, recordTiers, snapshotCommit, tierSuppression } from "../scripts/lib/data-platform/changelog.mts";
import { fileLedger, FIELD_EDITS_FILE } from "../scripts/lib/data-platform/ledger.mts";
import { EXIT, publishSnapshot, type PublishOptions } from "../scripts/publish-snapshot.mts";
import { AUTH_STUB_SQL } from "./helpers/pg-auth.mts";

const ROOT = join(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
const IDS = ["198419", "123457", "191621"];
const ids = new Set(IDS);
const TODAY = "2026-10-31";

const committed = (JSON.parse(readFileSync(join(DATA, "schools.json"), "utf8")) as School[]).filter((s) => ids.has(s.unit_id));
const committedMeta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8")) as DatasetMeta;

/** Every collection the compose reads (the high schools' 39 MB of shards stay out of the fixture but for one state). */
const ONLY = new Set(ALL_COLLECTIONS.filter((c) => !c.startsWith("high_schools.") || c === COLLECTIONS.highSchools.shared || c === COLLECTIONS.highSchools.state));

/** A file store holding the three colleges' layers, written by the import's own code. */
async function fixtureStore(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "dp-publish-"));
  await writeImport(fileStore(dir), importLayers(ROOT, { units: ids, only: ONLY }), "test");
  return dir;
}

const storeDir = await fixtureStore();
const layers = await loadPublishLayers(fileStore(storeDir));
const composeFixture = (l: PublishLayers = layers, previous: School[] | null = committed) => composeSnapshot(l, { previous, today: TODAY, trends: false });
const first = composeFixture();

test.after(() => rmSync(storeDir, { recursive: true, force: true }));

/* ------------------------------------------------------------------ */
/* Compose                                                             */
/* ------------------------------------------------------------------ */

test("compose gives the three committed colleges back byte for byte (selectivity aside: its scales are over every college)", () => {
  assert.deepEqual(first.problems, []);
  assert.deepEqual(first.schools.map((s) => s.unit_id), committed.map((s) => s.unit_id), "dataset order");
  // Tiers are standardized over the colleges given, so three can't reproduce them; place the committed block back and
  // every other byte must match (the full-data gate compares the tiers too).
  const placed = first.schools.map((s, i) => placeSelectivity(s, committed[i].selectivity));
  for (let i = 0; i < committed.length; i++) assert.equal(JSON.stringify(placed[i]), JSON.stringify(committed[i]), committed[i].name);
  assert.equal(formatSchools(placed), formatSchools(committed));
});

test("compose gives the colleges' detail and history shards and their alias rows back", () => {
  for (const id of IDS) {
    const d = first.detail.find((x) => x.unit_id === id);
    const file = join(DATA, "detail", "schools", `${id}.json`);
    if (existsSync(file)) assert.equal(d && formatDetail(d), readFileSync(file, "utf8"), `detail ${id}`);
    else assert.equal(d, undefined);
    const h = first.history.schools.get(id);
    assert.ok(h, `history ${id}`);
    assert.equal(formatHistoryShard(h), readFileSync(join(DATA, "history", "schools", `${id}.json`), "utf8"));
  }
  const rows = (JSON.parse(readFileSync(join(DATA, "aliases.json"), "utf8")) as { unit_id: string }[]).filter((r) => ids.has(r.unit_id));
  assert.equal(formatAliasRows(first.aliases), formatAliasRows(rows as never));
  assert.deepEqual(first.meta, committedMeta, "meta.json: every add*Meta is idempotent");
});

test("composing twice gives the same bytes and leaves the layers as they were", () => {
  const before = JSON.stringify([...layers.base.schools]);
  const again = composeFixture();
  assert.equal(formatSchools(again.schools), formatSchools(first.schools));
  assert.equal(JSON.stringify(again.meta), JSON.stringify(first.meta));
  assert.equal(JSON.stringify([...layers.base.schools]), before);
  const a = renderSnapshot(first, 3, 2, [5, 6], { createdAt: "2026-10-31T08:00:00.000Z" });
  const b = renderSnapshot(again, 3, 2, [5, 6], { createdAt: "2026-10-31T08:00:00.000Z" });
  assert.equal(a.manifestSha256, b.manifestSha256);
  assert.deepEqual([...a.objects.keys()], [...b.objects.keys()]);
});

test("the manifest records each layer's newest version", () => {
  assert.equal(first.versions[COLLECTIONS.base.colleges], 1);
  assert.equal(first.versions[COLLECTIONS.history.schools], 1);
});

/* ------------------------------------------------------------------ */
/* Field edits                                                         */
/* ------------------------------------------------------------------ */

const edit = (over: Partial<FieldEdit> = {}): FieldEdit => ({ id: 1, unit_id: "123457", path: "outcomes.graduation_rate", value: 0.7, note: "Per the registrar", created_at: "2026-10-30T17:00:00Z", released_at: null, ...over });

test("a field edit lands last, cited to Quad's editors, and passes the lineage check", () => {
  const edited = composeFixture({ ...layers, edits: [edit(), edit({ id: 2, value: 0.65, created_at: "2026-10-29T10:00:00Z" }), edit({ id: 3, value: 0.1, released_at: "2026-10-30T18:00:00Z" })] });
  assert.deepEqual(edited.problems, []);
  const s = edited.schools.find((x) => x.unit_id === "123457")!;
  assert.equal(s.outcomes?.graduation_rate, 0.7, "the newest unreleased edit wins");
  assert.deepEqual(s.lineage?.["outcomes.graduation_rate"], { source: "quad-edit", method: "edited", retrieved: "2026-10-30", note: "Per the registrar" });
  assert.ok(edited.meta.sources["quad-edit"], "meta gains the source once an edit is published");
  assert.deepEqual(validateLineage(edited.schools, edited.meta), []);
  assert.deepEqual(edited.edits, { applied: 1, colleges: 1 });
  // Untouched colleges are byte-identical to the unedited compose.
  assert.equal(JSON.stringify(edited.schools.find((x) => x.unit_id === "198419")), JSON.stringify(first.schools.find((x) => x.unit_id === "198419")));
  // Without an edit, meta has no quad-edit source (so meta.json stays the committed file).
  assert.equal(first.meta.sources["quad-edit"], undefined);
});

test("the lineage check holds an edit to its rule: edited goes with quad-edit and needs the day", () => {
  const s = withEdits(committed[0], [edit({ unit_id: committed[0].unit_id })]);
  const meta = { ...committedMeta, sources: { ...committedMeta.sources, "quad-edit": { label: "Quad's editors", url: "https://usequad.app/data" } } } as DatasetMeta;
  assert.deepEqual(validateSchool(s, meta).filter((p) => p.includes("graduation_rate")), []);
  const noDay = structuredClone(s);
  delete noDay.lineage!["outcomes.graduation_rate"]!.retrieved;
  assert.ok(validateSchool(noDay, meta).some((p) => p.includes("lacks retrieved")));
  const wrongSource = structuredClone(s);
  wrongSource.lineage!["outcomes.graduation_rate"]!.source = "scorecard";
  assert.ok(validateSchool(wrongSource, meta).some((p) => p.includes('method "edited" goes with source "quad-edit"')));
});

test("an edit the registry refuses fails the publish", () => {
  const bad = composeFixture({ ...layers, edits: [edit({ path: "outcomes.not_a_field" }), edit({ id: 9, unit_id: "999999" })] });
  assert.ok(bad.problems.some((p) => p.includes("not a registered field")));
  assert.ok(bad.problems.some((p) => p.includes("no such college")));
});

test("the console's hand-read prompts replace the layer's as the nightly export would", () => {
  const rows = [{ unit_id: "191621", cycle: "2026-27", record: { unit_id: "191621", cycle: "1999-00" } as never }];
  const c = composeFixture({ ...layers, promptOverrides: rows });
  assert.ok(c.warnings.some((w) => w.includes("essay_prompt_overrides row skipped: 191621")), "an invalid row is skipped with why");
  assert.deepEqual(c.problems, []);
});

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

test("render: deterministic, every object hashed in the manifest, today's formats", () => {
  const r = renderSnapshot(first, 7, 6, [11, 12], { createdAt: "2026-10-31T08:00:00.000Z" });
  assert.equal(r.manifest.id, 7);
  assert.equal(r.manifest.previous_id, 6);
  assert.deepEqual(r.manifest.change_set_ids, [11, 12]);
  assert.equal(r.manifest.colleges, 3);
  assert.equal(r.manifestSha256, sha256(r.manifestBytes));
  for (const [name, o] of r.objects) {
    assert.equal(r.manifest.objects[name].sha256, sha256(o.bytes), name);
    assert.equal(r.manifest.objects[name].bytes, o.bytes.length, name);
  }
  assert.ok(!(SNAPSHOT_OBJECTS.manifest in r.manifest.objects));
  assert.equal(gunzipSync(r.objects.get(SNAPSHOT_OBJECTS.colleges)!.bytes).toString("utf8"), formatSchools(first.schools));
  const shared = JSON.parse(gunzipSync(r.objects.get(SNAPSHOT_OBJECTS.historyShared)!.bytes).toString("utf8"));
  assert.deepEqual(Object.keys(shared), ["meta", "national", "facts", "cpi"]);
  assert.equal(r.objects.get(historyObject("198419"))!.bytes.toString("utf8"), readFileSync(join(DATA, "history", "schools", "198419.json"), "utf8"));
  assert.equal(r.objects.get(detailObject("198419"))!.bytes.toString("utf8"), readFileSync(join(DATA, "detail", "schools", "198419.json"), "utf8"));
  assert.equal(r.objects.get(SNAPSHOT_OBJECTS.meta)!.bytes.toString("utf8"), readFileSync(join(DATA, "meta.json"), "utf8"));
  assert.ok(r.objects.has("high-schools/meta.json") && [...r.objects.keys()].some((k) => k.startsWith("high-schools/state/")));
  assert.ok(r.objects.has("reference/platform-prompts.json") && r.objects.has("reference/essay-guidance.md"));
  const index = JSON.parse(r.objects.get(SNAPSHOT_OBJECTS.searchIndex)!.bytes.toString("utf8"));
  assert.deepEqual(index.schools.map((s: { id: string }) => s.id), first.schools.map((s) => s.unit_id));
  const again = renderSnapshot(first, 7, 6, [11, 12], { createdAt: "2026-10-31T08:00:00.000Z" });
  assert.ok(again.manifestBytes.equals(r.manifestBytes));
  for (const [name, o] of r.objects) assert.ok(again.objects.get(name)!.bytes.equals(o.bytes), name);
});

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

/** A fake Storage bucket: every call recorded; `upsert: false` on an existing object answers 409. */
function fakeBucket(): BucketClient & { calls: { op: string; path: string; upsert?: boolean; cacheControl?: string }[]; objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  const calls: { op: string; path: string; upsert?: boolean; cacheControl?: string }[] = [];
  return {
    calls,
    objects,
    async upload(path, body, options) {
      calls.push({ op: "upload", path, upsert: options.upsert, cacheControl: options.cacheControl });
      if (objects.has(path) && !options.upsert) return { error: { message: "The resource already exists", statusCode: "409" } };
      objects.set(path, Buffer.from(body));
      return { error: null };
    },
    async download(path) {
      calls.push({ op: "download", path });
      const b = objects.get(path);
      return b ? { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }, error: null } : { data: null, error: { message: "not found", statusCode: "404" } };
    },
    async remove(paths) {
      for (const p of paths) {
        calls.push({ op: "remove", path: p });
        objects.delete(p);
      }
      return { error: null };
    },
  };
}

test("upload: objects, then the manifest, then the pointer; objects are never overwritten", async () => {
  const r = renderSnapshot(first, 4, null, [1], { createdAt: "2026-10-31T08:00:00.000Z" });
  const bucket = fakeBucket();
  const up = await uploadSnapshot(bucket, r, { waits: [] });
  await movePointer(bucket, pointerFor(4, r.manifestSha256, "2026-10-31T08:00:00.000Z"), { waits: [] });
  assert.equal(up.uploaded, r.objects.size + 1);
  const uploads = bucket.calls.filter((c) => c.op === "upload");
  const manifestAt = uploads.findIndex((c) => c.path === snapshotPath(4, SNAPSHOT_OBJECTS.manifest));
  assert.equal(manifestAt, uploads.length - 2, "the manifest after every object");
  assert.equal(uploads.at(-1)!.path, POINTER_OBJECT, "the pointer last, at the bucket's root");
  assert.ok(uploads.slice(0, -1).every((c) => c.upsert === false && c.cacheControl === "31536000" && c.path.startsWith("4/")));
  assert.equal(uploads.at(-1)!.upsert, true);
  assert.equal(uploads.at(-1)!.cacheControl, "no-cache");
  const pointer = JSON.parse(bucket.objects.get(POINTER_OBJECT)!.toString("utf8")) as SnapshotPointer;
  assert.deepEqual(pointer, { id: 4, at: "2026-10-31T08:00:00.000Z", manifest_sha256: r.manifestSha256 });

  // A re-run after a crash finds its own bytes and moves on; other bytes under the same name stop it.
  const again = await uploadSnapshot(bucket, r, { waits: [] });
  assert.equal(again.uploaded, 0);
  assert.equal(again.present, r.objects.size + 1);
  bucket.objects.set(snapshotPath(4, SNAPSHOT_OBJECTS.meta), Buffer.from("{}"));
  await assert.rejects(uploadSnapshot(bucket, r, { waits: [] }), /already exists with other bytes/);
});

test("prune keeps the newest snapshots and every one pointed back to", async () => {
  const row = (id: number, created: string, pointer: string | null): SnapshotRow => ({ id, status: "published", created_at: created, pointer_at: pointer, manifest: { objects: { "meta.json": { bytes: 1, sha256: "x" } } } });
  const rows = [row(1, "2026-10-01", "2026-10-20"), row(2, "2026-10-02", "2026-10-02"), row(3, "2026-10-03", "2026-10-03"), row(4, "2026-10-04", "2026-10-04")];
  const keep = snapshotsToKeep(rows, 4, 2);
  assert.deepEqual([...keep].sort(), [1, 3, 4], "1 was pointed back to after 2, 3 and 4 were made");
  const bucket = fakeBucket();
  const removed = await prune(bucket, rows, keep, { waits: [] });
  assert.equal(removed, 2);
  assert.deepEqual(bucket.calls.map((c) => c.path), ["2/meta.json", "2/manifest.json"]);
});

/* ------------------------------------------------------------------ */
/* The change log and tier history                                     */
/* ------------------------------------------------------------------ */

/** A fake secret-key client: answers by table and function; records every rpc. */
function fakeClient(opts: { changeCount?: number } = {}) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const result = (data: unknown, extra: object = {}) => ({ data, error: null, ...extra });
  const chain = (value: unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "range", "not", "is", "in"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => void) => resolve(value);
    return c;
  };
  return {
    rpcs,
    from(table: string) {
      if (table === "dataset_change_staging") return chain(result([]));
      if (table === "dataset_changes") return chain(result([], { count: opts.changeCount ?? 0 }));
      if (table === "selectivity_publishes") return chain(result([{ git_commit: "abc1234", method: "old-method" }]));
      return chain(result([]));
    },
    rpc(fn: string, args: Record<string, unknown> = {}) {
      rpcs.push({ fn, args });
      if (fn === "publish_changes") return chain(result({ publish_id: 77, changes: 0, reused: false }));
      if (fn === "record_selectivity_run") return chain(result(5));
      return chain(result(null));
    },
  };
}

test("the change log stages and publishes under snapshot:<id>, and the tiers record against it", async () => {
  const client = fakeClient();
  const lines: string[] = [];
  const { result } = await recordChanges(client as never, { schools: committed, meta: committedMeta }, { schools: committed, meta: committedMeta }, { releases: [] }, 9, { publishedBy: "test", log: (l) => lines.push(l) });
  assert.equal(result.publish_id, 77);
  assert.deepEqual(client.rpcs.map((r) => r.fn), ["stage_dataset_changes", "publish_changes"]);
  assert.equal(client.rpcs[1].args.p_git_commit, "snapshot:9");
  assert.equal(snapshotCommit(9), "snapshot:9");
  const tiers = await recordTiers(client as never, { schools: first.schools, meta: first.meta, index: first.selectivity }, 9, { publishId: 77, log: (l) => lines.push(l) });
  assert.equal(tiers.id, 5);
  const run = client.rpcs.find((r) => r.fn === "record_selectivity_run")!.args.p_run as { git_commit: string; publish_id: number };
  assert.equal(run.git_commit, "snapshot:9");
  assert.equal(run.publish_id, 77);
  assert.match(tierSuppression("old-method") ?? "", /method changed/);
  assert.equal(tierSuppression(null), null);
});

test("selectivity_publishes takes snapshot:<id> as its commit (migration 20261031140000)", async () => {
  const dir = join(ROOT, "supabase", "migrations");
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  const { readdirSync } = await import("node:fs");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  const insert = (commit: string) =>
    db.query(`insert into public.selectivity_publishes (git_commit, published_at, method, elite_index, counts, elite_any_pool, rated, rows_recorded, cause) values ($1, now(), 'm', 1, '{}', 0, 0, 0, 'data')`, [commit]);
  await insert("snapshot:12");
  await insert("0123abcd");
  await assert.rejects(insert("snapshot:twelve"));
  await assert.rejects(insert("snapshot:12"), /duplicate|unique/);
  await db.close();
});

/* ------------------------------------------------------------------ */
/* The CLI, over the file store                                        */
/* ------------------------------------------------------------------ */

const cliOptions = (dir: string, over: Partial<PublishOptions> = {}): PublishOptions & { lines: string[] } => {
  const lines: string[] = [];
  return {
    store: `file:${dir}`,
    dryRun: false,
    force: false,
    skipChangelog: false,
    previous: "git",
    today: TODAY,
    revalidateWaitS: 0,
    skipTrends: true,
    env: {},
    log: (l) => lines.push(l),
    root: ROOT,
    lines,
    deps: { now: () => new Date("2026-10-31T08:00:00.000Z") },
    ...over,
  };
};

test("the CLI publishes, says nothing to publish the second time, blocks on a hold (exit 2), fails on lineage (exit 1), and points back", async () => {
  const dir = await fixtureStore();
  try {
    const run = await publishSnapshot(cliOptions(dir));
    assert.equal(run, EXIT.ok);
    const pointer = JSON.parse(readFileSync(join(dir, "_bucket", POINTER_OBJECT), "utf8")) as SnapshotPointer;
    assert.equal(pointer.id, 1);
    assert.equal(sha256(readFileSync(join(dir, "_bucket", snapshotPath(1, SNAPSHOT_OBJECTS.manifest)))), pointer.manifest_sha256);
    const colleges = gunzipSync(readFileSync(join(dir, "_bucket", snapshotPath(1, SNAPSHOT_OBJECTS.colleges)))).toString("utf8");
    assert.equal(colleges.split("\n").length, 3 + 3);
    assert.equal((await fileLedger(dir).snapshots())[0].status, "published");

    const idle = cliOptions(dir, { previous: "auto" });
    assert.equal(await publishSnapshot(idle), EXIT.ok);
    assert.ok(idle.lines.some((l) => l.includes("nothing to publish")));

    // A held change set blocks the line.
    const h = await fileStore(dir).open("pipeline", "college-reported", "run-1");
    await h.write(COLLECTIONS.reported.reports, [{ key: "run-1.md", body: { text: "a run's report" } }]);
    await h.close("held", "the breaker tripped");
    const blocked = cliOptions(dir, { previous: "auto" });
    assert.equal(await publishSnapshot(blocked), EXIT.held);
    assert.ok(blocked.lines.some((l) => l.includes("the breaker tripped")));

    // A refused edit fails the compose: nothing uploaded, the snapshot recorded failed.
    writeFileSync(join(dir, FIELD_EDITS_FILE), JSON.stringify([edit({ path: "outcomes.not_a_field" })]));
    const failing = cliOptions(dir, { previous: "auto", force: true });
    assert.equal(await publishSnapshot(failing), EXIT.failed);
    assert.ok(failing.lines.some((l) => l.includes("not a registered field")));
    const rows = await fileLedger(dir).snapshots();
    assert.equal(rows[0].status, "failed");
    assert.ok(!existsSync(join(dir, "_bucket", String(rows[0].id))));

    // Point back moves only the pointer.
    rmSync(join(dir, FIELD_EDITS_FILE));
    assert.equal(await publishSnapshot(cliOptions(dir, { point: 1 })), EXIT.ok);
    assert.equal((JSON.parse(readFileSync(join(dir, "_bucket", POINTER_OBJECT), "utf8")) as SnapshotPointer).id, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI's process exits 2 on a hold and writes nothing on a dry run", async () => {
  const dir = await fixtureStore();
  try {
    const h = await fileStore(dir).open("pipeline", "essay-prompts", "run-2");
    await h.close("held", "too many changes");
    const script = join(ROOT, "scripts", "publish-snapshot.mts");
    // No .env.local values reach the script: only the file store, nothing configured.
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", NODE_ENV: "test" };
    const held = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "--store", `file:${dir}`, "--dry-run"], { encoding: "utf8", env });
    assert.equal(held.status, 2, held.stderr);
    const out = join(dir, "out");
    const forced = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "--store", `file:${dir}`, "--dry-run", "--force", "--previous", "git", "--skip-trends", "--out", out], { encoding: "utf8", env });
    assert.equal(forced.status, 0, forced.stderr);
    assert.ok(existsSync(join(out, SNAPSHOT_OBJECTS.manifest)));
    assert.ok(!existsSync(join(dir, "_bucket")), "a dry run uploads nothing");
    assert.ok(!existsSync(join(dir, "_snapshots.json")), "a dry run records nothing");
    const bad = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "--store", `file:${dir}`, "--previous", "sometimes"], { encoding: "utf8", env });
    assert.equal(bad.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fileBucket refuses to overwrite an object, like Storage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dp-bucket-"));
  try {
    const b = fileBucket(dir);
    assert.equal((await b.upload("1/a.json", Buffer.from("x"), { contentType: "application/json", cacheControl: "1", upsert: false })).error, null);
    assert.equal((await b.upload("1/a.json", Buffer.from("y"), { contentType: "application/json", cacheControl: "1", upsert: false })).error?.statusCode, "409");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
