/**
 * The college-reported pipeline on the data store (specs/data-platform/pipelines.md; scripts/lib/college-reported/
 * state.mts): the run's documents are keyed and shaped exactly as scripts/import-data-from-files.mts imports the files,
 * the writer sends only what changed, hold-misread and college-failures write through the store, and the workflow
 * neither commits nor opens a PR and asks the publisher only when its change set closed applied. The runs themselves
 * (one change set, held on the breaker, collect into the same set) are in tests/cds-pipeline.test.mts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BatchEntry, ReportedFile, ReviewItem, ReviewQueueFile, SourcesFile } from "../lib/reported.ts";
import type { CollegeDocsFile, CollegeRecord } from "../lib/cds-sections.ts";
import { importLayers } from "../scripts/import-data-from-files.mts";
import { COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import { fileStore, fileStoreChangeSets, orderedJson } from "../scripts/lib/data-platform/store.mts";
import { writeQueue, writeReported, writeSources } from "../scripts/lib/college-reported/files.mts";
import { writeManifest, writeRecord } from "../scripts/lib/college-reported/records.mts";
import { writeBatches } from "../scripts/lib/college-reported/batch.mts";
import { emptySummaryV3 } from "../scripts/lib/college-reported/models.mts";
import type { Round3State } from "../scripts/lib/college-reported/phases.mts";
import { REFERENCE_KEYS, StateWriter, loadReportedState, recordBody, stateDocuments } from "../scripts/lib/college-reported/state.mts";
import { holdMisread } from "../scripts/hold-misread.mts";

const ROOT = join(import.meta.dirname, "..");
const UNIT = "232256";
// This college's slice of every state file (tests/fixtures/college-reported-store/README.md): the mini fixture's
// layers leave out reported.sources, reported.review_queue, and reported.docs (pipeline bookkeeping, not
// unit-filtered by the import), and this unit isn't one of the four CDS academics colleges whose record the
// layers do carry.
const FIXTURES = join(ROOT, "tests", "fixtures", "college-reported-store");
const json = <T,>(rel: string): T => JSON.parse(readFileSync(join(FIXTURES, rel), "utf8")) as T;

/** One real college's slice of every state file, plus an open batch and a blocked host. */
function realState(): Round3State {
  const sources = json<SourcesFile>("college-sources.json");
  const reported = json<ReportedFile>("college-reported.json");
  const queue = json<ReviewQueueFile>("review-queue.json");
  const docs = json<CollegeDocsFile>("college-docs.json");
  const record = json<CollegeRecord>(`${UNIT}.json`);
  const batch: BatchEntry = { id: "msgbatch_x1", phase: "extract", submitted: "2026-10-30T10:00:00Z", requests: 2, reserved_usd: 0.5, custom_ids: [`u${UNIT}-abcdef01-C-v1`], run: "r9", model: "claude-haiku-4-5" };
  return {
    sources: { updated: sources.updated, recipes: sources.recipes.filter((r) => r.unit_id === UNIT) },
    reported: { updated: reported.updated, entries: reported.entries.filter((e) => e.unit_id === UNIT) },
    queue: { updated: queue.updated, items: queue.items.filter((i) => i.unit_id === UNIT) },
    manifest: { updated: docs.updated, documents: docs.documents.filter((d) => d.unit_id === UNIT) },
    records: new Map([[UNIT, record]]),
    batches: { updated: "2026-10-30", batches: [batch] },
    blocked: { hosts: [{ host: "blocked.example.edu", status: 403, last_seen: "2026-10-30", unit_ids: [UNIT] }] },
    manual: [],
    summary: emptySummaryV3("r9", "2026-10-30T10:00:00Z"),
    dirty: new Set(),
  } as unknown as Round3State;
}

/** The state written as today's files under <root>/data (the old writers), as a commit would have held them. */
function writeFiles(root: string, s: Round3State) {
  const data = join(root, "data");
  mkdirSync(join(data, "reference"), { recursive: true });
  writeSources(join(data, "college-sources.json"), s.sources);
  writeReported(join(data, "college-reported.json"), s.reported);
  writeQueue(join(data, "review-queue.json"), s.queue);
  writeManifest(join(data, "college-docs.json"), s.manifest);
  for (const rec of s.records.values()) writeRecord(join(data, "cds-records"), rec);
  writeBatches(join(data, "college-batches.json"), s.batches);
  writeFileSync(join(data, "reference", "blocked-hosts.json"), `${JSON.stringify(s.blocked, null, 2)}\n`);
}

const tmp = () => mkdtempSync(join(tmpdir(), "reported-store-"));

test("the run's documents are the import's: same collections, same keys, same bodies", () => {
  const dir = tmp();
  try {
    const state = realState();
    writeFiles(dir, state);
    const ours = stateDocuments(state, state.records.keys());
    const imported = importLayers(join(dir, "data"), { only: new Set(ours.keys()) });
    for (const [c, docs] of ours) {
      const theirs = imported.get(c as never) ?? new Map();
      assert.deepEqual([...docs.keys()].sort(), [...theirs.keys()].sort(), `${c}: keys`);
      for (const [key, body] of docs) assert.equal(orderedJson(body), orderedJson(theirs.get(key)), `${c}/${key}`);
    }
    assert.ok(ours.get(COLLECTIONS.reported.reviewQueue)!.size > 0, "the fixture has queue items");
    // The record's document order and item order are the file's (serializeRecord), not just equal as sets.
    assert.equal(JSON.stringify(ours.get(COLLECTIONS.reported.cdsRecords)!.get(UNIT)), JSON.stringify(imported.get(COLLECTIONS.reported.cdsRecords)!.get(UNIT)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadReportedState reads back what an import of the files wrote", async () => {
  const dir = tmp();
  try {
    const state = realState();
    writeFiles(dir, state);
    const store = fileStore(join(dir, "layers"));
    const h = await store.open("import", "git", "fixture");
    for (const [c, docs] of importLayers(join(dir, "data"), { only: new Set([...Object.values(COLLECTIONS.reported), COLLECTIONS.reference.files, COLLECTIONS.import.headers]) })) await h.write(c, [...docs].map(([key, body]) => ({ key, body })));
    await h.close("applied");
    const back = await loadReportedState(store, state.summary);
    assert.equal(back.sources.updated, state.sources.updated, "updated from import.headers");
    assert.equal(back.reported.updated, state.reported.updated);
    assert.deepEqual(back.reported.entries, state.reported.entries);
    assert.deepEqual(back.sources.recipes, state.sources.recipes);
    assert.deepEqual(back.batches.batches, state.batches.batches);
    assert.deepEqual(back.blocked, state.blocked);
    assert.deepEqual(back.records.get(UNIT), recordBody(state.records.get(UNIT)!));
    assert.equal(back.queue.items.length, state.queue.items.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("StateWriter sends only what changed, removes what left the state, and compares records only when dirty", async () => {
  const dir = tmp();
  try {
    const store = fileStore(dir);
    const state = realState();
    const seed = await store.open("import", "git", "fixture");
    await seed.write(COLLECTIONS.reported.batches, state.batches.batches.map((b) => ({ key: b.id, body: b })));
    await seed.close("applied");
    const handle = await store.open("pipeline", "college-reported", "r9");
    const writer = new StateWriter(handle, state);
    writer.save(state);
    await writer.flush();
    assert.equal(writer.written, 0, "nothing changed since the load");

    // A changed entry, a collected batch, a blocked host cleared, a record edited but not marked dirty.
    state.reported.entries[0] = { ...state.reported.entries[0], name: "Renamed" } as (typeof state.reported.entries)[0];
    state.batches.batches = [];
    state.blocked = { hosts: [] };
    const rec = state.records.get(UNIT)!;
    rec.documents[0] = { ...rec.documents[0], retrieved: "1999-01-01" };
    writer.save(state);
    await writer.flush();
    const versions = () => fileStoreChangeSets(dir).find((s) => s.id === handle.id)!.versions;
    assert.deepEqual(versions().map((v) => `${v.collection}/${v.key}${v.deleted ? " (removed)" : ""}`).sort(), [
      `${COLLECTIONS.reference.files}/${REFERENCE_KEYS.blocked}`,
      `${COLLECTIONS.reported.batches}/msgbatch_x1 (removed)`,
      `${COLLECTIONS.reported.entries}/${UNIT}`,
    ]);

    state.dirty.add(UNIT);
    writer.save(state);
    await writer.flush();
    assert.ok(versions().some((v) => v.collection === COLLECTIONS.reported.cdsRecords && v.key === UNIT), "a dirty record is written");
    assert.equal(state.dirty.size, 0, "save clears the dirty set");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hold-misread writes the record and the review items through the store in a hold-misread change set", async () => {
  const dir = tmp();
  try {
    const store = fileStore(dir);
    const state = realState();
    const record = recordBody(state.records.get(UNIT)!);
    const doc = record.documents.find((d) => Object.values(d.items).some((it) => it.v !== undefined && it.status === "passed"))!;
    const code = Object.keys(doc.items).find((c) => doc.items[c].v !== undefined && doc.items[c].status === "passed")!;
    const seed = await store.open("import", "git", "fixture");
    await seed.write(COLLECTIONS.reported.cdsRecords, [{ key: UNIT, body: record }]);
    await seed.close("applied");

    const held = await holdMisread(store, [{ unit: UNIT, edition: doc.edition!, codes: [code], detail: "the PDF shows 1,234" }], { today: "2026-10-31", names: new Map([[UNIT, "A College"]]) });
    assert.deepEqual(held, [{ unit: UNIT, held: [code] }]);
    const after = await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, UNIT);
    const item = after!.documents.find((d) => d.edition === doc.edition)!.items[code];
    assert.equal(item.status, "failed");
    assert.deepEqual(item.failures?.at(-1), { check: "misread", detail: "the PDF shows 1,234" });
    const queued = [...(await store.read<ReviewItem>(COLLECTIONS.reported.reviewQueue)).values()];
    assert.ok(queued.some((i) => i.unit_id === UNIT && i.code === code && i.run === "hold-misread"));
    const set = fileStoreChangeSets(dir).find((s) => s.source === "hold-misread")!;
    assert.equal(set.status, "applied");
    assert.deepEqual([...new Set(set.versions.map((v) => v.collection))].sort(), [COLLECTIONS.reported.cdsRecords, COLLECTIONS.reported.reviewQueue]);

    await assert.rejects(holdMisread(store, [{ unit: UNIT, edition: "1999-00", codes: [code], detail: "x" }], { today: "2026-10-31", names: new Map() }), /no 1999-00 document/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("npm run college-failures -- --store file:… writes reported.failures and health.colleges in one applied change set", () => {
  const dir = tmp();
  try {
    const state = realState();
    writeFiles(dir, state);
    const layers = join(dir, "layers");
    const schools = join(dir, "schools.json");
    writeFileSync(schools, JSON.stringify([{ unit_id: UNIT, name: "A College", admissions: { year: 2024 }, lineage: {} }]));
    // Seed the store from the files, as the import would.
    const seed = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "-e", `
      const { importLayers } = await import(${JSON.stringify(join(ROOT, "scripts", "import-data-from-files.mts"))});
      const { fileStore } = await import(${JSON.stringify(join(ROOT, "scripts", "lib", "data-platform", "store.mts"))});
      const store = fileStore(${JSON.stringify(layers)});
      const h = await store.open("import", "git", "fixture");
      for (const [c, docs] of importLayers(${JSON.stringify(join(dir, "data"))}, { only: new Set(["reported.sources", "reported.entries", "reported.review_queue", "reported.docs", "reported.cds_records", "reported.batches", "reference.files", "import.headers"]) })) await h.write(c, [...docs].map(([key, body]) => ({ key, body })));
      await h.close("applied");
    `], { encoding: "utf8", input: "" });
    assert.equal(seed.status, 0, seed.stderr);
    const run = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "college-failures.mts"), "--store", `file:${layers}`, "--schools", schools, "--date", "2026-10-31"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /failure rows for/);
    const sets = fileStoreChangeSets(layers).filter((s) => s.kind === "pipeline");
    assert.equal(sets.length, 1);
    assert.deepEqual([sets[0].source, sets[0].status, sets[0].run_ref], ["college-reported", "applied", "college-failures-2026-10-31"]);
    assert.ok(sets[0].versions.some((v) => v.collection === COLLECTIONS.health.colleges && v.key === "health"));

    const dry = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "college-failures.mts"), "--store", `file:${layers}`, "--schools", schools, "--dry-run"], { encoding: "utf8" });
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(fileStoreChangeSets(layers).filter((s) => s.kind === "pipeline").length, 1, "a dry run opens nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* The workflow                                                        */
/* ------------------------------------------------------------------ */

const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "college-reported.yml"), "utf8");
/** Every step's `run:` script and `if:` condition, by job, from the YAML text (two-space job keys, `- name:` steps). */
function jobText(job: "run" | "collect"): string {
  const start = WORKFLOW.indexOf(`\n  ${job}:\n`);
  assert.ok(start >= 0, `job ${job}`);
  const next = WORKFLOW.slice(start + 1).search(/\n {2}[a-z]+:\n/);
  return next < 0 ? WORKFLOW.slice(start) : WORKFLOW.slice(start, start + 1 + next);
}

test("the workflow neither commits nor opens a pull request nor writes a release note", () => {
  const lines = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#"));
  const code = lines.join("\n");
  for (const forbidden of [/git (add|commit|push|checkout -b)/, /gh pr /, /release-notes\//, /college-reported-pr-body/, /merge-reported|merge-directories|build-selectivity|build-trends/, /pull-requests: write/]) {
    assert.doesNotMatch(code, forbidden, String(forbidden));
  }
});

test("each job ends by dispatching the publisher, only when its change set closed applied (never on exit 2 or 3)", () => {
  for (const job of ["run", "collect"] as const) {
    const text = jobText(job);
    const step = text.slice(text.indexOf("- name: Ask the publisher for a snapshot"));
    assert.ok(step.length > 0, `${job}: the dispatch step`);
    const cond = /\n\s+if: (.*)\n/.exec(step)![1];
    assert.match(cond, /steps\.sync\.outputs\.exit_code == '0'/, `${job}: guarded on exit 0`);
    assert.match(cond, /steps\.sync\.outputs\.status == 'applied'/, `${job}: guarded on the set closing applied`);
    assert.match(step, /gh api repos\/\$\{\{ github\.repository \}\}\/dispatches -f event_type=publish-snapshot/);
    assert.match(text, /--store supabase/, `${job}: writes to the data store`);
    assert.match(text, /actions\/cache@v4[\s\S]*\.cache\/college-docs/, `${job}: keeps the document cache`);
  }
  assert.match(WORKFLOW, /DATA_SUPABASE_URL: \$\{\{ secrets\.DATA_SUPABASE_URL/);
  assert.match(WORKFLOW, /DATA_SUPABASE_SECRET_KEY: \$\{\{ secrets\.DATA_SUPABASE_SECRET_KEY/);
  assert.match(jobText("collect"), /--print-open-run --store supabase/, "the collect job finds its run on the store");
});
