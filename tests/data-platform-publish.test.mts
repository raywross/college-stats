/**
 * The publisher (scripts/publish-snapshot.mts, scripts/lib/data-platform/{compose,render,upload,changelog,ledger,publish-tables}.mts;
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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type { DatasetMeta, School } from "../lib/types";
import { formatDetail } from "../lib/detail.ts";
import { validateLineage, validateSchool } from "../lib/lineage.ts";
import { POINTER_OBJECT, SNAPSHOT_OBJECTS, detailObject, historyObject, snapshotPath, type SnapshotManifest, type SnapshotPointer } from "../lib/data-platform/snapshot.ts";
import type { ConfirmedRecord } from "../lib/essay-prompts/confirmed.ts";
import { openCycle } from "../scripts/lib/essay-prompts/cycle.mts";
import type { FailureRow } from "../scripts/lib/college-failures.mts";
import type { HighSchoolData } from "../scripts/lib/publish-high-schools.mts";
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
import { failureRowsFrom, highSchoolDataFrom, highSchoolDigest, publishTables, tablesDigestAfter, type RecordedManifest, type TablesDeps } from "../scripts/lib/data-platform/publish-tables.mts";
import { EXIT, publishSnapshot, type PublishOptions } from "../scripts/publish-snapshot.mts";
import { AUTH_STUB_SQL } from "./helpers/pg-auth.mts";

const ROOT = join(import.meta.dirname, "..");
// The same three real colleges as tests/data-platform-import.test.mts's fixture, plus two high-school state shards
// the compose step also reads (tests/fixtures/data-platform-publish/, copied from tests/fixtures/data-platform-import/
// and data/high-schools/{state/ct,state/sc,meta,medians,review-queue}.json, committed 2026-10-31; not the real data/).
const FIXTURE_ROOT = join(ROOT, "tests", "fixtures", "data-platform-publish");
const DATA = join(FIXTURE_ROOT, "data");
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
  await writeImport(fileStore(dir), importLayers(FIXTURE_ROOT, { units: ids, only: ONLY }), "test");
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
  // sources.directory.description names every organization with a listing; this git-layout fixture's directories/
  // files are pre-trimmed to these three colleges (tests/fixtures/data-platform-import/, see its README), so it
  // names fewer organizations than the real meta.json copied in verbatim — a fixture-coverage mismatch, not real.
  const stripDirDesc = (m: DatasetMeta) => ({ ...m, sources: { ...m.sources, directory: { ...m.sources.directory, description: "" } } });
  assert.deepEqual(stripDirDesc(first.meta), stripDirDesc(committedMeta), "meta.json: every add*Meta is idempotent");
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

test("trends come from the history layer: a changed history document changes the college's trends", () => {
  for (const s of first.schools) assert.deepEqual(s.trends, committed.find((c) => c.unit_id === s.unit_id)!.trends, `${s.name}: derived as sync-history wrote it`);
  const histories = new Map(layers.history.schools);
  const duke = structuredClone(histories.get("198419")!);
  const applicants = duke.series.applicants!;
  applicants.values[applicants.values.length - 1] = 60000;
  histories.set("198419", duke);
  // The previous snapshot's trends no longer win over the history layer.
  const changed = composeFixture({ ...layers, history: { ...layers.history, schools: histories } });
  const trends = changed.schools.find((s) => s.unit_id === "198419")!.trends!;
  assert.equal(trends.applicants?.to, 60000);
  assert.notDeepEqual(trends, first.schools.find((s) => s.unit_id === "198419")!.trends);
  assert.deepEqual(changed.problems, []);
  // A college with no history document keeps the previous snapshot's trends.
  const without = new Map(layers.history.schools);
  without.delete("123457");
  const previous = committed.map((s) => (s.unit_id === "123457" ? { ...s, trends: { applicants: { since: 2014, from: 1, to: 2, change: 1 } } } : s)) as School[];
  const kept = composeFixture({ ...layers, history: { ...layers.history, schools: without } }, previous);
  assert.deepEqual(kept.schools.find((s) => s.unit_id === "123457")!.trends, { applicants: { since: 2014, from: 1, to: 2, change: 1 } });
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

test("compose records editsObject (edits.json's body): the pre-edit pipeline value and lineage, one row per live edit", () => {
  // 123457 carries no coalition layer at all, so coalition.member has no pipeline value to record.
  const noPipeline = edit({ id: 4, unit_id: "123457", path: "coalition.member", value: true, note: null, created_at: "2026-10-30T12:00:00Z" });
  const edited = composeFixture({ ...layers, edits: [edit(), edit({ id: 2, value: 0.65, created_at: "2026-10-29T10:00:00Z" }), edit({ id: 3, value: 0.1, released_at: "2026-10-30T18:00:00Z" }), noPipeline] });
  assert.deepEqual(edited.problems, []);
  // One row per path actually applied (the newest unreleased), not one per stored edit row: id 2 is superseded, id 3 is released.
  assert.equal(edited.editsObject.length, 2);
  const grad = edited.editsObject.find((e) => e.path === "outcomes.graduation_rate")!;
  assert.equal(grad.id, 1, "the newest unreleased edit wins, as liveEdits picks it");
  assert.equal(grad.unit_id, "123457");
  assert.equal(grad.value, 0.7);
  assert.equal(grad.note, "Per the registrar");
  assert.equal(grad.created_at, "2026-10-30T17:00:00Z");
  assert.ok(grad.pipeline, "the pipeline had a value at this path before the edit");
  assert.equal(grad.pipeline!.value, committed.find((s) => s.unit_id === "123457")!.outcomes!.graduation_rate);
  const coal = edited.editsObject.find((e) => e.path === "coalition.member")!;
  assert.equal(coal.note, null);
  assert.equal(coal.pipeline, null, "no coalition layer for 123457: the path had no pipeline value");
  // Sorted (unit_id, then path): deterministic regardless of the edits' arrival order.
  assert.deepEqual(edited.editsObject.map((e) => e.path), ["coalition.member", "outcomes.graduation_rate"].sort());
  // No edits at all: an empty editsObject, not an absent one.
  assert.deepEqual(first.editsObject, []);
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
  // sources.directory and sources["state-law"]'s descriptions name every organization/state with a listing or law;
  // this fixture's directories/ and state laws are only as wide as these three colleges' own matches and states,
  // so they name fewer than the real, untrimmed meta.json copied in verbatim (a fixture-coverage mismatch, not
  // real); checked structurally instead, without those two description fields.
  const renderedMeta = JSON.parse(r.objects.get(SNAPSHOT_OBJECTS.meta)!.bytes.toString("utf8")) as DatasetMeta;
  const realMeta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8")) as DatasetMeta;
  const stripDescriptions = (m: DatasetMeta) => ({
    ...m,
    sources: { ...m.sources, directory: { ...m.sources.directory, description: "" }, "state-law": { ...m.sources["state-law"], description: "" } },
  });
  assert.deepEqual(stripDescriptions(renderedMeta), stripDescriptions(realMeta));
  assert.ok(r.objects.has("high-schools/meta.json") && [...r.objects.keys()].some((k) => k.startsWith("high-schools/state/")));
  assert.ok(r.objects.has("reference/platform-prompts.json") && r.objects.has("reference/essay-guidance.md"));
  const index = JSON.parse(r.objects.get(SNAPSHOT_OBJECTS.searchIndex)!.bytes.toString("utf8"));
  assert.deepEqual(index.schools.map((s: { id: string }) => s.id), first.schools.map((s) => s.unit_id));
  const again = renderSnapshot(first, 7, 6, [11, 12], { createdAt: "2026-10-31T08:00:00.000Z" });
  assert.ok(again.manifestBytes.equals(r.manifestBytes));
  for (const [name, o] of r.objects) assert.ok(again.objects.get(name)!.bytes.equals(o.bytes), name);
});

test("render: edits.json carries the snapshot id and every applied edit, empty or not, hashed in the manifest", () => {
  const empty = renderSnapshot(first, 7, 6, [11, 12], { createdAt: "2026-10-31T08:00:00.000Z" });
  assert.deepEqual(JSON.parse(empty.objects.get(SNAPSHOT_OBJECTS.edits)!.bytes.toString("utf8")), { snapshot: 7, edits: [] });
  assert.ok(SNAPSHOT_OBJECTS.edits in empty.manifest.objects, "listed in the manifest like every object");
  const edited = composeFixture({ ...layers, edits: [edit()] });
  const withEdit = renderSnapshot(edited, 9, 7, [20], { createdAt: "2026-10-31T08:00:00.000Z" });
  assert.deepEqual(JSON.parse(withEdit.objects.get(SNAPSHOT_OBJECTS.edits)!.bytes.toString("utf8")), { snapshot: 9, edits: edited.editsObject });
  // Adding the edit changes edits.json, colleges.json (the edited value) and meta.json (the quad-edit source), but
  // no other object's bytes.
  const touched = new Set<string>([SNAPSHOT_OBJECTS.edits, SNAPSHOT_OBJECTS.colleges, SNAPSHOT_OBJECTS.meta]);
  for (const [name, o] of empty.objects) {
    if (touched.has(name)) continue;
    assert.ok(withEdit.objects.get(name)!.bytes.equals(o.bytes), `${name} unaffected by the edit`);
  }
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

/* ------------------------------------------------------------------ */
/* The hand-read prompts, as the retired nightly export applied them   */
/* ------------------------------------------------------------------ */

/** A hand-read record for Hilbert College (placeholder prompts, not the college's text). */
const handRead = (): ConfirmedRecord => ({
  unit_id: "191621",
  name: "Hilbert College",
  cycle: openCycle(TODAY),
  status: "published",
  confidence: "confirmed",
  source: "form-by-hand",
  form: "common_app",
  read_on: TODAY,
  reader: "RR",
  prompts: [1, 2].map((n) => ({
    id: `191621:${openCycle(TODAY)}:${n}`,
    text: `Placeholder question ${n}: tell us about something you care about and why it matters to you.`,
    kind: "short_answer" as const,
    limit: { kind: "words" as const, max: 250 },
    required: true,
    applies_to: "all" as const,
    quote: `Placeholder question ${n}: tell us about something you care about and why it matters to you.`,
  })),
});

test("a valid essay_prompt_overrides row composes exactly as the export's confirmed file did", () => {
  const record = handRead();
  const fromRow = composeFixture({ ...layers, promptOverrides: [{ unit_id: record.unit_id, cycle: record.cycle, record }] });
  // The retired nightly export wrote the row to data/essay-prompts/confirmed/, which the layer holds.
  const fromLayer = composeFixture({ ...layers, essays: { ...layers.essays, confirmed: [record] }, promptOverrides: null });
  assert.deepEqual(fromRow.problems, []);
  assert.deepEqual(fromRow.warnings.filter((w) => w.includes("essay_prompt_overrides")), []);
  assert.equal(formatSchools(fromRow.schools), formatSchools(fromLayer.schools));
  const hilbert = fromRow.schools.find((s) => s.unit_id === "191621")!;
  assert.notEqual(JSON.stringify(hilbert.essays), JSON.stringify(first.schools.find((s) => s.unit_id === "191621")!.essays), "the hand read lands on the college");
  // A row for a closed cycle is ignored, and the layer's record (none here) stands.
  const closed = composeFixture({ ...layers, promptOverrides: [{ unit_id: "191621", cycle: "2020-21", record: { ...record, cycle: "2020-21" } }] });
  assert.equal(formatSchools(closed.schools), formatSchools(first.schools));
});

/* ------------------------------------------------------------------ */
/* The table step: college_data_failures and the high-school tables    */
/* ------------------------------------------------------------------ */

const failure = (unit: string, reason = "no_document"): FailureRow =>
  ({ unit_id: unit, name: `College ${unit}`, reason_code: reason, stage: "discovery", detail: "x", url: null, edition: null, check_ids: [], first_seen: "2026-10-01", last_seen: "2026-10-30" }) as unknown as FailureRow;

/** Fakes for the table step's library calls, recording what each received. */
function fakeTables(over: Partial<TablesDeps> = {}) {
  const calls: string[] = [];
  const loaded: FailureRow[][] = [];
  const written: HighSchoolData[] = [];
  const deps: TablesDeps = {
    failuresTableProblem: async () => (calls.push("failures?"), null),
    loadCollegeFailures: async (_c, rows) => (calls.push("failures"), loaded.push([...rows]), { upserted: rows.length, resolved: 1 }),
    highSchoolFileProblems: () => (calls.push("hs-files"), []),
    highSchoolTablesProblem: async () => (calls.push("hs?"), null),
    publishHighSchools: async (_c, data) => (calls.push("hs"), written.push(data), { schools: data.rows.length, details: data.details.length, removed: 0 }),
    ...over,
  };
  return { deps, calls, loaded, written };
}

const hsCollections = (): Map<string, Map<string, unknown>> =>
  new Map([
    [COLLECTIONS.highSchools.schools, new Map<string, unknown>([["VT", { state: "VT", schools: [{ id: "500001", kind: "public" }] }]])],
    [COLLECTIONS.highSchools.shared, new Map<string, unknown>([["meta", { generated: "2026-10-30" }], ["medians", {}]])],
  ]);

const manifestWith = (objects: Record<string, string>): SnapshotManifest => ({
  id: 2,
  created_at: "",
  previous_id: 1,
  colleges: 3,
  objects: Object.fromEntries(Object.entries(objects).map(([k, sha]) => [k, { bytes: 1, sha256: sha }])),
  layers: {},
  change_set_ids: [],
});

test("highSchoolDataFrom gives the shape readHighSchoolData reads; the digest covers only high-schools/ objects", () => {
  const data = highSchoolDataFrom(hsCollections())!;
  assert.deepEqual(data.shards.map((s) => s.file), ["VT.json"]);
  assert.deepEqual(data.rows.map((r) => r.id), ["500001"]);
  assert.deepEqual(data.meta, { generated: "2026-10-30" });
  assert.equal(highSchoolDataFrom(new Map()), null);
  // The fixture's composed layers (one state file, the shared files) map too.
  const fixture = highSchoolDataFrom(first.highSchools)!;
  assert.ok(fixture.meta && fixture.medians && fixture.stateFiles.length > 0);

  const a = highSchoolDigest(manifestWith({ "colleges.json.gz": "1", "high-schools/meta.json": "2" }).objects);
  assert.equal(a, highSchoolDigest(manifestWith({ "colleges.json.gz": "other", "high-schools/meta.json": "2" }).objects), "college objects don't count");
  assert.notEqual(a, highSchoolDigest(manifestWith({ "high-schools/meta.json": "3" }).objects));
  assert.equal(highSchoolDigest(manifestWith({ "colleges.json.gz": "1" }).objects), null);
  // A snapshot from before the table step: its own objects stand for what the tables hold.
  assert.equal(tablesDigestAfter(manifestWith({ "high-schools/meta.json": "2" })), a);
  assert.equal(tablesDigestAfter(null), null);
  const rows = failureRowsFrom(new Map([["1", [failure("1")]], ["2", [failure("2"), failure("2", "failed_checks")]]]));
  assert.deepEqual(rows.map((r) => r.unit_id), ["1", "2", "2"]);
});

test("the table step loads the failures every time and the high-school tables only when they changed, retrying a failure", async () => {
  const failures = new Map([["198419", [failure("198419")]]]);
  const manifest = manifestWith({ "high-schools/meta.json": "aa", "high-schools/schools/VT.json": "bb" });
  const input = { collegeIds: new Set(IDS), highSchools: hsCollections(), manifest, previous: null, failures };
  const quiet = () => {};
  const f = fakeTables();
  const log = await publishTables({} as never, input, { deps: f.deps, log: quiet });
  assert.deepEqual(log.college_data_failures, { status: "published", upserted: 1, resolved: 1 });
  assert.deepEqual(f.loaded, [[failure("198419")]]);
  assert.equal(log.high_schools.status, "published", "a first publish writes the tables");
  assert.equal(log.high_schools.tables_digest, highSchoolDigest(manifest.objects));
  assert.deepEqual(f.calls, ["failures?", "failures", "hs-files", "hs?", "hs"]);

  // The next snapshot, same high schools: nothing written; the failures load again.
  const next = fakeTables();
  const again = await publishTables({} as never, { ...input, previous: { ...manifest, tables: log } }, { deps: next.deps, log: quiet });
  assert.equal(again.high_schools.status, "unchanged");
  assert.deepEqual(next.calls, ["failures?", "failures"]);
  // --republish-high-schools writes them anyway.
  const forced = fakeTables();
  const forcedLog = await publishTables({} as never, { ...input, previous: { ...manifest, tables: log } }, { deps: forced.deps, forceHighSchools: true, log: quiet });
  assert.equal(forcedLog.high_schools.status, "published");

  // A changed shard whose write fails is logged, never thrown, and the next snapshot retries it.
  const changed = manifestWith({ "high-schools/meta.json": "aa", "high-schools/schools/VT.json": "cc" });
  const failing = fakeTables({
    publishHighSchools: async () => {
      throw new Error("statement timeout");
    },
  });
  const failed = await publishTables({} as never, { ...input, manifest: changed, previous: { ...manifest, tables: log } }, { deps: failing.deps, log: quiet });
  assert.equal(failed.high_schools.status, "failed");
  assert.match(failed.high_schools.message ?? "", /statement timeout/);
  assert.equal(failed.high_schools.tables_digest, log.high_schools.tables_digest, "the tables still hold the older high schools");
  const retry = fakeTables();
  const retried = await publishTables({} as never, { ...input, manifest: changed, previous: { ...changed, tables: failed } }, { deps: retry.deps, log: quiet });
  assert.equal(retried.high_schools.status, "published");

  // File problems stop the write; an empty failures layer resolves nothing; a missing table is skipped, not failed.
  const bad = fakeTables({ highSchoolFileProblems: () => ["high-schools/meta.json is missing"] });
  const badLog = await publishTables({} as never, { ...input, failures: new Map() }, { deps: bad.deps, log: quiet });
  assert.equal(badLog.college_data_failures.status, "skipped");
  assert.deepEqual(bad.loaded, [], "an empty layer never resolves every open row");
  assert.equal(badLog.high_schools.status, "failed");
  assert.ok(!bad.calls.includes("hs"));
  const missing = fakeTables({ failuresTableProblem: async () => ({ missing: true, message: "Apply the migration first." }), highSchoolTablesProblem: async () => "relation does not exist. Apply it first." });
  const missingLog = await publishTables({} as never, input, { deps: missing.deps, log: quiet });
  assert.equal(missingLog.college_data_failures.status, "skipped");
  assert.equal(missingLog.high_schools.status, "skipped");
  const broken = fakeTables({
    loadCollegeFailures: async () => {
      throw new Error("network");
    },
  });
  assert.equal((await publishTables({} as never, input, { deps: broken.deps, log: quiet })).college_data_failures.status, "failed");
});

test("the CLI: tables after the pointer, logged in the row's manifest; then the wait, the revalidate, and the deploy hook once", async () => {
  const dir = await fixtureStore();
  try {
    const fetched: { url: string; method?: string }[] = [];
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      fetched.push({ url: String(url), method: init?.method });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const env = { REVALIDATE_SECRET: "s", REVALIDATE_URLS: "https://a.example", VERCEL_DEPLOY_HOOK_URL: "https://hooks.example/deploy/secret-id" };
    const deps = (tables: Partial<TablesDeps>, at: string) => ({ now: () => new Date(at), changelogClient: {}, tables, fetch: fakeFetch });
    const opts = cliOptions(dir, { skipChangelog: true, env, deps: deps(fakeTables().deps, "2026-10-31T08:00:00.000Z") });
    assert.equal(await publishSnapshot(opts), EXIT.ok);
    assert.deepEqual(
      fetched,
      [
        { url: "https://a.example/api/revalidate", method: "POST" },
        { url: "https://hooks.example/deploy/secret-id", method: "POST" },
      ],
      "the revalidate, then the hook, each once"
    );
    assert.ok(opts.lines.includes("deploy hook: answered 201"));
    assert.ok(!opts.lines.some((l) => l.includes("secret-id")), "the hook's URL is never logged");
    const at = (prefix: string) => opts.lines.findIndex((l) => l.includes(prefix));
    assert.ok(at("is live; the pointer names it") >= 0 && at("is live; the pointer names it") < at("college data failures:"), "tables after the pointer");
    assert.ok(at("high schools:") < at("deploy hook:"));
    const manifest = (await fileLedger(dir).manifest(1)) as RecordedManifest;
    assert.equal(manifest.tables?.college_data_failures.status, "published");
    assert.equal(manifest.tables?.college_data_failures.upserted, 4, "the fixture's four failure rows");
    assert.equal(manifest.tables?.high_schools.status, "published");
    assert.equal(manifest.objects[SNAPSHOT_OBJECTS.colleges].sha256, sha256(readFileSync(join(dir, "_bucket", snapshotPath(1, SNAPSHOT_OBJECTS.colleges)))), "the bucket manifest's fields are kept");
    const bucketManifest = JSON.parse(readFileSync(join(dir, "_bucket", snapshotPath(1, SNAPSHOT_OBJECTS.manifest)), "utf8"));
    assert.equal(bucketManifest.tables, undefined, "the bucket's manifest stays as rendered (the pointer names its hash)");

    // A forced re-publish: the high schools are unchanged; --skip-deploy calls no hook.
    fetched.length = 0;
    const again = cliOptions(dir, { previous: "auto", force: true, skipChangelog: true, skipDeploy: true, env, deps: deps(fakeTables().deps, "2026-10-31T09:00:00.000Z") });
    assert.equal(await publishSnapshot(again), EXIT.ok);
    assert.equal(((await fileLedger(dir).manifest(2)) as RecordedManifest).tables?.high_schools.status, "unchanged");
    assert.deepEqual(fetched.map((c) => c.url), ["https://a.example/api/revalidate"]);
    assert.ok(again.lines.includes("deploy hook: skipped (--skip-deploy)"));
    // --skip-tables writes none and carries the tables' digest forward.
    const third = fakeTables();
    const skipped = cliOptions(dir, { previous: "auto", force: true, skipChangelog: true, skipTables: true, env: {}, deps: deps(third.deps, "2026-10-31T10:00:00.000Z") });
    assert.equal(await publishSnapshot(skipped), EXIT.ok);
    assert.deepEqual(third.calls, []);
    const log3 = ((await fileLedger(dir).manifest(3)) as RecordedManifest).tables!;
    assert.equal(log3.high_schools.status, "skipped");
    assert.equal(log3.high_schools.tables_digest, manifest.tables?.high_schools.tables_digest);

    // A point-back moves the pointer, then revalidates and rebuilds the bundle through the hook; no tables.
    fetched.length = 0;
    const point = fakeTables();
    const back = cliOptions(dir, { point: 1, env, deps: deps(point.deps, "2026-10-31T11:00:00.000Z") });
    assert.equal(await publishSnapshot(back), EXIT.ok);
    assert.deepEqual(fetched.map((c) => c.url), ["https://a.example/api/revalidate", "https://hooks.example/deploy/secret-id"]);
    assert.deepEqual(point.calls, []);
    // A hook that fails is logged; the run still succeeds.
    const refused = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    const down = cliOptions(dir, { point: 1, env: { VERCEL_DEPLOY_HOOK_URL: "https://hooks.example/x" }, deps: { fetch: refused } });
    assert.equal(await publishSnapshot(down), EXIT.ok);
    assert.ok(down.lines.includes("deploy hook: failed: connection refused"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Retired: publish-changes.yml and the git-based CLIs                 */
/* ------------------------------------------------------------------ */

test("publish-changes.yml and its CLIs are retired; the publisher's workflow passes every secret it reads", () => {
  for (const f of [".github/workflows/publish-changes.yml", "scripts/publish-changes.mts", "scripts/publish-selectivity-history.mts", "scripts/publish-college-failures.mts"]) {
    assert.ok(!existsSync(join(ROOT, f)), `${f} is gone`);
  }
  // Their library code stays: the publisher calls it.
  for (const f of ["scripts/lib/publish-changes.mts", "scripts/lib/selectivity-history.mts", "scripts/lib/publish-college-failures.mts", "scripts/lib/publish-high-schools.mts"]) {
    assert.ok(existsSync(join(ROOT, f)), `${f} stays`);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  for (const s of ["publish-changes", "publish-selectivity-history", "publish-college-failures"]) assert.equal(pkg.scripts[s], undefined, `npm run ${s}`);
  for (const f of readdirSync(join(ROOT, ".github", "workflows"))) {
    assert.doesNotMatch(readFileSync(join(ROOT, ".github", "workflows", f), "utf8"), /npm run publish-(changes|selectivity-history|college-failures)\b/, f);
  }
  const yml = readFileSync(join(ROOT, ".github", "workflows", "publish-snapshot.yml"), "utf8");
  const jobs = yml.split(/^ {2}(?=publish:|point:)/m).slice(1);
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    for (const name of ["DATA_SUPABASE_URL", "DATA_SUPABASE_SECRET_KEY", "REVALIDATE_SECRET", "REVALIDATE_URLS", "VERCEL_DEPLOY_HOOK_URL"]) {
      assert.match(job, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name}\\b`), `${job.slice(0, 6)} ${name}`);
    }
  }
});
