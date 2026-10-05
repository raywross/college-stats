/**
 * The high school syncs (scripts/lib/high-schools/): merge rules for directory and enrichment adapters, `--only`
 * reruns keeping other adapters' fields, stub adapters changing nothing, the writer's stable output, the shrink and
 * validation guards (each proven to stop a bad run), state syncs, the download cache, and the adapter registries.
 * Runs against temporary directories with fake adapters; no network. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HighSchool } from "../lib/high-school-types.ts";
import { blankHighSchool, computeStateMedians, validateShard } from "../lib/high-school-core.ts";
import { readAllShards, readHsMedians, readHsMeta, readStateFiles } from "../lib/high-school-store.ts";
import { applyAdapterResults, mergeMeta, type AdapterRun } from "../scripts/lib/high-schools/merge.mts";
import { formatShard, formatStateFile, toShards } from "../scripts/lib/high-schools/write.mts";
import { SyncError, runHighSchoolSync, runStateSync } from "../scripts/lib/high-schools/sync.mts";
import { createAdapterContext, parseFlags } from "../scripts/lib/high-schools/context.mts";
import { ADAPTERS } from "../scripts/lib/high-schools/index.mts";
import { STATE_ADAPTERS } from "../scripts/lib/high-schools/states/index.mts";
import type { AdapterInfo, HighSchoolAdapter, StateAdapter } from "../scripts/lib/high-schools/types.mts";
import { info as ccdInfo } from "../scripts/lib/high-schools/ccd.mts";
import { info as pssInfo } from "../scripts/lib/high-schools/pss.mts";
import { info as edfactsInfo } from "../scripts/lib/high-schools/edfacts.mts";
import { info as crdcInfo } from "../scripts/lib/high-schools/crdc.mts";

const FIXTURE = join(import.meta.dirname, "fixtures", "high-schools");
const ROOT = join(import.meta.dirname, "..");
const quiet = { log: () => {}, warn: () => {} };

function tempCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "hs-sync-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const fixtureRows = () => readAllShards(FIXTURE).flatMap((s) => s.shard.schools);

function publicRow(id: string, name: string, o: Partial<HighSchool> = {}): HighSchool {
  return { ...blankHighSchool(id, "public", name, id.startsWith("06") ? "CA" : "TX"), grades: { low: "9", high: "12" }, ...o };
}

const SOURCE = { name: "Test source", publisher: "Test publisher", url: "https://example.org/data", retrieved: "2026-10-05" };

function fake(info: AdapterInfo, result: Awaited<ReturnType<HighSchoolAdapter["load"]>>): HighSchoolAdapter {
  return { info, load: async () => result };
}

/* ------------------------------------------------------------------ */
/* Merge rules                                                         */
/* ------------------------------------------------------------------ */

test("directory adapter: replaces its owned fields, keeps enrichment fields, adds and removes rows of its kind only", () => {
  const existing = fixtureRows();
  const rich = existing.find((r) => r.id === "060000100001")!;
  const renamed = { ...rich, name: "Fixture Hills High School (renamed)", grad_rate: null, rigor: null, suppressed: ["enrollment.by_race.american_indian"] };
  const added = publicRow("060000100077", "New Fixture High");
  const ccdRows = [renamed, added, ...existing.filter((r) => r.kind === "public" && r.state === "TX")];
  const { rows, report } = applyAdapterResults(existing, [{ info: ccdInfo, result: { rows: ccdRows, sources: {}, vintages: {} } }]);
  const after = rows.find((r) => r.id === "060000100001")!;
  assert.equal(after.name, "Fixture Hills High School (renamed)");
  assert.deepEqual(after.grad_rate, rich.grad_rate, "EDFacts' field survives a CCD run");
  assert.deepEqual(after.rigor, rich.rigor, "CRDC's field survives a CCD run");
  assert.deepEqual(after.suppressed, ["enrollment.by_race.american_indian", "rigor.ib_enrolled"], "rigor's suppressed entry stays; CCD's are replaced");
  assert.ok(rows.some((r) => r.id === "060000100077"));
  assert.ok(!rows.some((r) => r.id === "060000100002"), "a public school CCD no longer lists is removed");
  assert.ok(rows.some((r) => r.id === "A9900001"), "private rows are PSS's, untouched");
  assert.ok(!rows.some((r) => r.id === "060000100003"));
  // stray: TX school 2's rigor suppressed entry, which CCD doesn't own (dropped from CCD's input; the row keeps its own).
  assert.deepEqual(report[0], { key: "ccd", added: 1, updated: 1, removed: 5, unmatched: 0, stray: 1, skipped: false });
  assert.deepEqual(rows.find((r) => r.id === "480000200002")!.suppressed, ["rigor.ap_passed_some"]);
  assert.deepEqual(rows.map((r) => r.id), [...rows.map((r) => r.id)].sort(), "sorted by id");
});

test("enrichment adapter: fills its fields from patches, resets unreported schools, never creates rows, counts unmatched", () => {
  const existing = fixtureRows();
  const run: AdapterRun = {
    info: edfactsInfo,
    result: {
      patches: [
        { id: "060000100002", values: { grad_rate: { value: null, low: null, high: null, cohort: 12 } }, suppressed: ["grad_rate"] },
        { id: "060000199999", values: { grad_rate: { value: 0.5, low: null, high: null, cohort: 100 } } },
        { id: "A9900001", values: { grad_rate: { value: 0.99, low: null, high: null, cohort: 60 } } },
        { id: "480000200001", values: { grad_rate: { value: 0.91, low: null, high: null, cohort: 400 } }, suppressed: ["rigor.ap_enrolled"] },
      ],
      sources: {},
      vintages: {},
    },
  };
  const { rows, report } = applyAdapterResults(existing, [run]);
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.deepEqual(by.get("060000100002")!.suppressed, ["grad_rate"]);
  assert.equal(by.get("060000100001")!.grad_rate, null, "not in this release: reset");
  assert.deepEqual(by.get("060000100001")!.rigor, existing.find((r) => r.id === "060000100001")!.rigor, "CRDC's field untouched");
  assert.equal(by.get("A9900001")!.grad_rate, null, "private rows aren't EDFacts'");
  assert.ok(!by.has("060000199999"), "enrichment never creates rows");
  assert.equal(by.get("480000200001")!.grad_rate!.value, 0.91);
  assert.equal(report[0].unmatched, 2);
  assert.equal(report[0].stray, 1, "a suppressed path outside grad_rate is dropped and counted");
  assert.equal(rows.length, existing.length);
});

test("stub results (no rows / patches) change nothing; --only reruns keep other adapters' fields", () => {
  const existing = fixtureRows();
  const stubRuns: AdapterRun[] = [ccdInfo, pssInfo, edfactsInfo, crdcInfo].map((info) => ({ info, result: { sources: {}, vintages: {} } }));
  const { rows, report } = applyAdapterResults(existing, stubRuns);
  assert.equal(JSON.stringify(rows), JSON.stringify([...existing].sort((a, b) => (a.id < b.id ? -1 : 1))));
  assert.ok(report.every((r) => r.skipped));
  // An empty CCD result would wipe every public school; undefined (a stub) must not.
  const wiped = applyAdapterResults(existing, [{ info: ccdInfo, result: { rows: [], sources: {}, vintages: {} } }]);
  assert.equal(wiped.rows.filter((r) => r.kind === "public").length, 0, "an explicit empty list is a real (if suspicious) result: the sync's shrink guard stops it");
});

test("directory adapters reject rows of the wrong kind and duplicates", () => {
  const priv = blankHighSchool("A9900002", "private", "X", "CA");
  assert.throws(() => applyAdapterResults([], [{ info: ccdInfo, result: { rows: [priv], sources: {}, vintages: {} } }]), /creates public rows/);
  const r = publicRow("060000100077", "Dup");
  assert.throws(() => applyAdapterResults([], [{ info: ccdInfo, result: { rows: [r, r], sources: {}, vintages: {} } }]), /twice/);
});

test("mergeMeta: this run's sources and vintages replace theirs, others stay, counts follow the rows", () => {
  const prev = readHsMeta(FIXTURE)!;
  const rows = fixtureRows();
  const next = mergeMeta(prev, [{ info: crdcInfo, result: { sources: { crdc: SOURCE }, vintages: { crdc: "2023–24" } } }], rows, "2026-11-01");
  assert.equal(next.generated, "2026-11-01");
  assert.deepEqual(next.sources.crdc, SOURCE);
  assert.deepEqual(next.sources["nces-ccd"], prev.sources["nces-ccd"]);
  assert.equal(next.vintages.crdc, "2023–24");
  assert.equal(next.vintages["ccd-directory"], prev.vintages["ccd-directory"]);
  assert.deepEqual(next.counts, prev.counts);
});

/* ------------------------------------------------------------------ */
/* Writer                                                              */
/* ------------------------------------------------------------------ */

test("writer: shards and state files are byte-stable, one school per line, and round-trip", () => {
  for (const { file, shard } of readAllShards(FIXTURE)) {
    const text = readFileSync(join(FIXTURE, "schools", file), "utf8");
    assert.equal(formatShard(shard), text, `${file} isn't in writer format`);
    assert.equal(formatShard({ ...shard, schools: [...shard.schools].reverse() }), text, "input order doesn't matter");
    assert.equal(text.split("\n").length, shard.schools.length + 3);
    assert.deepEqual(validateShard(JSON.parse(text)), []);
  }
  for (const { file, data } of readStateFiles(FIXTURE)) {
    assert.equal(formatStateFile(data), readFileSync(join(FIXTURE, "state", file), "utf8"), `${file} isn't in writer format`);
    assert.deepEqual(JSON.parse(formatStateFile(data)), data);
  }
  assert.deepEqual(toShards(fixtureRows()).map((s) => s.state), ["CA", "TX"]);
});

/* ------------------------------------------------------------------ */
/* runHighSchoolSync                                                   */
/* ------------------------------------------------------------------ */

test("sync: --only enrichment run writes shards, meta, and fresh medians; other fields untouched", async () => {
  const dir = tempCopy();
  try {
    const before = readAllShards(dir).flatMap((s) => s.shard.schools);
    const crdc = fake(crdcInfo, {
      patches: before.filter((r) => r.kind === "public").map((r) => ({ id: r.id, values: { rigor: { ...(r.rigor ?? { ap_courses: null, ap_enrolled: null, ap_exam_takers: null, ap_passed_some: null, ib_enrolled: null, dual_enrolled: null, enrollment: null }), ap_courses: 30 } }, suppressed: r.suppressed?.filter((p) => p.startsWith("rigor.")) })),
      sources: { crdc: SOURCE },
      vintages: { crdc: "2023–24" },
    });
    const res = await runHighSchoolSync({ root: ROOT, outDir: dir, adapters: [...ADAPTERS.filter((a) => a.info.key !== "crdc"), crdc], only: ["crdc"], now: new Date("2026-11-01T12:00:00Z"), ...quiet });
    assert.ok(res.written);
    const after = readAllShards(dir).flatMap((s) => s.shard.schools);
    assert.ok(after.filter((r) => r.kind === "public").every((r) => r.rigor?.ap_courses === 30));
    for (const r of after) {
      const b = before.find((x) => x.id === r.id)!;
      assert.deepEqual({ ...r, rigor: null, suppressed: null }, { ...b, rigor: null, suppressed: null }, `${r.id}: only rigor changed`);
    }
    const meta = readHsMeta(dir)!;
    assert.equal(meta.vintages.crdc, "2023–24");
    assert.equal(meta.generated, "2026-11-01");
    assert.deepEqual(readHsMedians(dir), computeStateMedians(after, readStateFiles(dir).map((f) => f.data)));
    assert.equal(readHsMedians(dir)!.CA["rigor.ap_courses"], 30);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync guards: invalid rows, a shrink, and unknown adapters stop the run before anything is written", async () => {
  const dir = tempCopy();
  const snapshot = () => readdirSync(join(dir, "schools")).map((f) => readFileSync(join(dir, "schools", f), "utf8")).join("");
  const original = snapshot();
  try {
    const bad = fake(ccdInfo, { rows: [publicRow("060000100001", "Bad", { frl_share: 5 })], sources: {}, vintages: {} });
    await assert.rejects(runHighSchoolSync({ root: ROOT, outDir: dir, adapters: [bad], ...quiet }), (e: unknown) => e instanceof SyncError && e.problems.some((p) => /frl_share/.test(p)));
    const shrink = fake(ccdInfo, { rows: [], sources: {}, vintages: {} });
    await assert.rejects(runHighSchoolSync({ root: ROOT, outDir: dir, adapters: [shrink], ...quiet }), /would drop public high schools from 12 to 0/);
    await assert.rejects(runHighSchoolSync({ root: ROOT, outDir: dir, adapters: ADAPTERS, only: ["niche"], ...quiet }), /unknown adapter/);
    const noSource = fake(ccdInfo, { rows: fixtureRows().filter((r) => r.kind === "public"), sources: {}, vintages: {} });
    rmSync(join(dir, "meta.json"));
    await assert.rejects(runHighSchoolSync({ root: ROOT, outDir: dir, adapters: [noSource], ...quiet }), (e: unknown) => e instanceof SyncError && e.problems.some((p) => /meta.sources doesn't describe/.test(p)));
    assert.equal(snapshot(), original, "nothing written");
    // --allow-shrink lets a deliberate shrink through.
    cpSync(join(FIXTURE, "meta.json"), join(dir, "meta.json"));
    const res = await runHighSchoolSync({ root: ROOT, outDir: dir, adapters: [shrink], allowShrink: true, ...quiet });
    assert.equal(res.rows.filter((r) => r.kind === "public").length, 0);
    assert.ok(!existsSync(join(dir, "schools", "TX.json")), "a state with no rows left loses its shard");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync: adapters still stubbed run cleanly and change nothing; a dry run writes nothing regardless", async () => {
  // pss is built (the private-schools unit) and fetches the real NCES file even in a dry run, same as a live sync
  // would; the rest are still stubs until their units land. pss's own parsing is covered network-free by
  // tests/high-schools-pss.test.mts; this only checks that running it alongside stubs doesn't touch disk.
  const dir = tempCopy();
  try {
    const before = readFileSync(join(dir, "schools", "CA.json"), "utf8");
    const res = await runHighSchoolSync({ root: ROOT, outDir: dir, adapters: ADAPTERS, dryRun: true, ...quiet });
    assert.equal(res.written, false);
    for (const r of res.report) if (r.key !== "pss") assert.ok(r.skipped, `${r.key} should still be a stub`);
    assert.equal(readFileSync(join(dir, "schools", "CA.json"), "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* runStateSync                                                        */
/* ------------------------------------------------------------------ */

function fakeState(result: Awaited<ReturnType<StateAdapter["load"]>>, o: Partial<StateAdapter> = {}): StateAdapter {
  return { state: "TX", source: "state-tx", name: "Texas test files", publisher: "Texas Education Agency", url: "https://tea.texas.gov/", built: true, load: async () => result, ...o };
}

test("state sync: writes the file, moves schools not in the shard to unmatched, adds the source, recomputes medians", async () => {
  const dir = tempCopy();
  try {
    let seen: { rows: number; crosswalk: number } | null = null;
    const adapter = fakeState({
      sections: [{ key: "absence", source: "state-tx", label: "TEA attendance (test)", year: "2023–24", url: "https://tea.texas.gov/x", retrieved: "2026-11-02", fields: ["chronic_absence"] }],
      schools: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`48000020000${n}`, { chronic_absence: 0.1 + n / 100 }]).concat([["480000209999", { chronic_absence: 0.3 }]])),
    });
    const wrapped: StateAdapter = { ...adapter, load: async (ctx) => ((seen = { rows: ctx.rows.length, crosswalk: ctx.crosswalk.size }), adapter.load(ctx)) };
    const { file } = await runStateSync({ root: ROOT, outDir: dir, adapter: wrapped, ...quiet });
    assert.deepEqual(seen, { rows: 6, crosswalk: 6 }, "the adapter sees the state's public rows and their state-id crosswalk");
    assert.deepEqual(file.unmatched, [{ stateId: "480000209999", name: "", ncessch: "480000209999", reason: "not a high school in schools/TX.json" }]);
    const written = readStateFiles(dir).find((f) => f.data.state === "TX")!.data;
    assert.equal(Object.keys(written.schools).length, 6);
    assert.equal(readHsMeta(dir)!.sources["state-tx"]!.retrieved, "2026-11-02");
    assert.equal(readHsMedians(dir)!.TX["state.chronic_absence"], 0.135);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("state sync guards: an invalid file is refused and nothing is written; stubs aren't run", async () => {
  const dir = tempCopy();
  try {
    const before = readFileSync(join(dir, "state", "tx.json"), "utf8");
    const bad = fakeState({ sections: [{ key: "x", source: "state-ca", label: "x", year: "2024", url: "https://x.org", retrieved: "2026-11-02", fields: ["chronic_absence"] }], schools: { "480000200001": { chronic_absence: 14 } } });
    await assert.rejects(runStateSync({ root: ROOT, outDir: dir, adapter: bad, ...quiet }), (e: unknown) => e instanceof SyncError && e.problems.some((p) => /cites state-tx/.test(p)) && e.problems.some((p) => /0–1 share/.test(p)));
    assert.equal(readFileSync(join(dir, "state", "tx.json"), "utf8"), before);
    await assert.rejects(runStateSync({ root: ROOT, outDir: dir, adapter: STATE_ADAPTERS.ca, ...quiet }), /isn't built yet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Context, registries                                                 */
/* ------------------------------------------------------------------ */

test("fetchCached downloads once into the cache, honors maxAgeDays, and refuses uncached files offline", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "hs-cache-"));
  try {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(`body ${calls}`);
    }) as unknown as typeof fetch;
    const ctx = createAdapterContext({ root: ROOT, outDir: cacheDir, cacheDir, fetchImpl, ...quiet });
    const path = await ctx.fetchCached("https://nces.ed.gov/ccd/data/zip/ccd_sch_029_2425.zip");
    assert.equal(path, join(cacheDir, "ccd_sch_029_2425.zip"));
    await ctx.fetchCached("https://nces.ed.gov/ccd/data/zip/ccd_sch_029_2425.zip");
    assert.equal(calls, 1, "second call is served from the cache");
    assert.equal(readFileSync(path, "utf8"), "body 1");
    assert.equal(readFileSync(`${path}.url`, "utf8").trim(), "https://nces.ed.gov/ccd/data/zip/ccd_sch_029_2425.zip");
    const later = createAdapterContext({ root: ROOT, outDir: cacheDir, cacheDir, fetchImpl, now: new Date(Date.now() + 10 * 86_400_000), ...quiet });
    await later.fetchCached("https://nces.ed.gov/ccd/data/zip/ccd_sch_029_2425.zip", { maxAgeDays: 7 });
    assert.equal(calls, 2, "stale copy re-downloaded");
    const offline = createAdapterContext({ root: ROOT, outDir: cacheDir, cacheDir, fetchImpl, offline: true, ...quiet });
    await assert.rejects(offline.fetchCached("https://example.org/other.csv"), /not cached/);
    const failing = createAdapterContext({ root: ROOT, outDir: cacheDir, cacheDir, fetchImpl: (async () => new Response("no", { status: 404 })) as unknown as typeof fetch, ...quiet });
    await assert.rejects(failing.fetchCached("https://example.org/missing.csv"), /HTTP 404/);
    assert.ok(!existsSync(join(cacheDir, "missing.csv")));
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("parseFlags", () => {
  assert.deepEqual(parseFlags(["--only", "ccd,pss", "--dry-run", "--year=2023", "--state", "ca"]), { only: "ccd,pss", "dry-run": true, year: "2023", state: "ca" });
});

test("registries list every adapter, each with a sound contract", () => {
  assert.deepEqual(ADAPTERS.map((a) => a.info.key), ["ccd", "pss", "edfacts", "crdc"]);
  for (const a of ADAPTERS) {
    assert.equal(typeof a.load, "function");
    assert.ok(a.info.owns.length);
    if (a.info.role === "enrichment") assert.ok(!a.info.owns.includes("name"), `${a.info.key} can't own directory fields`);
  }
  // Ownership doesn't overlap within a kind (two adapters writing one field would fight on every rerun).
  for (const kind of ["public", "private"] as const) {
    const owned = ADAPTERS.filter((a) => a.info.rowKind === kind).flatMap((a) => a.info.owns);
    assert.equal(new Set(owned).size, owned.length, `${kind}: overlapping owns`);
  }
  assert.deepEqual(Object.keys(STATE_ADAPTERS).sort(), ["ca", "ct", "fl", "il", "ny", "sc", "tx"]);
  for (const [code, a] of Object.entries(STATE_ADAPTERS)) {
    assert.equal(a.state, code.toUpperCase());
    assert.equal(a.source, `state-${code}`);
    assert.match(a.url, /^https:\/\//);
  }
});
