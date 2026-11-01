/**
 * The import (scripts/import-data-from-git.mts; specs/data-platform/pipelines.md "The import"): the committed
 * dataset stripped of its later layers, written to the file store, and the layers re-applied in sync-data's order give
 * each committed college back byte for byte, which is the contract the publisher (D3) relies on. Until the mini
 * fixture exists (tests/fixtures/snapshot-mini/), the fixture is built here from three real colleges copied out of
 * data/ into a temp folder (under 300 KB): Duke (Common App, Coalition, essays, college-reported with a CDS record,
 * directories, the campus pilot's policies, selectivity), Simpson University (CCCU, Common App's international-aid
 * answer), Hilbert College (Common App's own-site links, directories). `npm run import-data-from-git -- --check` runs
 * the same proof over every college. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { applyIdentity } from "../lib/identity.ts";
import { addIdentityMeta } from "../lib/identity.ts";
import { mergeReported, stripReported } from "../lib/reported-merge.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { applyCommonApp, addCommonAppMeta, stripCommonApp } from "../scripts/lib/common-app/merge.mts";
import { applyCoalition, addCoalitionMeta, stripCoalition } from "../scripts/lib/coalition/merge.mts";
import { applyEssays, stripEssays } from "../scripts/lib/essay-prompts/merge.mts";
import { addDirectoryMeta, applyCccuMembership, applyDirectories, chapterFiles, directoryDetails, stripCccuMembership, stripDirectories } from "../scripts/lib/directories/merge.mts";
import { applyLgbtqPolicies, pilotDirectoryFiles, stripLgbtqPolicies } from "../scripts/lib/campus-pilot/merge.mts";
import { placeSelectivity } from "../scripts/lib/selectivity.mts";
import { deepMerge, type Patch } from "../scripts/lib/overrides.mts";
import { lineageForPatch } from "../lib/lineage.ts";
import { miniLayers, miniMeta } from "./helpers/snapshot.mts";
import { fileStore, fileStoreChangeSets } from "../scripts/lib/data-platform/store.mts";
import {
  COLLECTIONS,
  loadBase,
  loadCoalitionLayer,
  loadCommonAppLayer,
  loadDirectoriesLayer,
  loadEssaysLayer,
  loadIdentity,
  loadReportedLayer,
  readLayer,
} from "../scripts/lib/data-platform/layers.mts";
import {
  DETAIL_TABLE_KEYS,
  LATER_DETAIL_TABLES,
  baseProblems,
  importLayers,
  reapplyLaterLayers,
  reapplyProblems,
  stripLaterLayers,
  writeImport,
} from "../scripts/import-data-from-git.mts";

const ROOT = join(import.meta.dirname, "..");
// A git-layout data/ slice for these three colleges, already filtered and committed (tests/fixtures/data-platform-import/,
// built by this file's own buildFixture() logic against the real data/ and frozen 2026-10-31; see its README).
const DATA = join(ROOT, "tests", "fixtures", "data-platform-import", "data");
const IDS = ["198419", "123457", "191621"];
const ids = new Set(IDS);

const readData = <T,>(rel: string): T => JSON.parse(readFileSync(join(DATA, rel), "utf8")) as T;
const committed: School[] = readData<School[]>("schools.json");

/* ------------------------------------------------------------------ */
/* The fixture: three colleges and their slice of every input          */
/* ------------------------------------------------------------------ */

/**
 * DATA is already the filtered, three-college fixture (tests/fixtures/data-platform-import/data/, committed); this
 * just copies it into a fresh temp dir so each run (and the tests that write into it) has its own scratch copy.
 */
function buildFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "dp-import-fixture-"));
  cpSync(DATA, join(root, "data"), { recursive: true });
  return root;
}

function sizeOf(dir: string): number {
  return readdirSync(dir).reduce((n, f) => {
    const p = join(dir, f);
    return n + (statSync(p).isDirectory() ? sizeOf(p) : statSync(p).size);
  }, 0);
}

/** The day the committed essay records were read: inside their cycle, so the merge keeps them whenever the test runs. */
function essaysToday(root: string): string {
  const dir = join(root, "data", "essay-prompts", "records");
  const dates = readdirSync(dir).map((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { retrieved: string }).retrieved);
  return dates.sort().at(-1)!;
}

const fixture = buildFixture();
const today = essaysToday(fixture);
const previous = new Map(committed.map((s) => [s.unit_id, s.selectivity]));
const fixtureColleges = committed.filter((s) => ids.has(s.unit_id));

async function importedStore(root = fixture): Promise<{ dir: string; store: ReturnType<typeof fileStore> }> {
  const dir = mkdtempSync(join(tmpdir(), "dp-import-store-"));
  const store = fileStore(dir);
  await writeImport(store, importLayers(root), "test-commit");
  return { dir, store };
}

test.after(() => rmSync(fixture, { recursive: true, force: true }));

test("the fixture is three real colleges and stays under 300 KB", () => {
  const bytes = sizeOf(join(fixture, "data"));
  assert.ok(bytes < 300 * 1024, `fixture is ${Math.round(bytes / 1024)} KB`);
  const duke = fixtureColleges.find((s) => s.unit_id === "198419")!;
  // Each later layer is on at least one fixture college, so the round trip exercises every strip.
  for (const k of ["apply", "coalition", "essays", "reported", "directories", "selectivity"] as const) assert.ok(k in duke, `Duke has ${k}`);
  assert.ok(duke.lgbtq?.policies, "Duke has the campus pilot's policies");
  assert.ok(fixtureColleges.some((s) => s.religion?.cccu_member), "a CCCU member");
  assert.ok(fixtureColleges.some((s) => s.links?.transfer_guarantee || s.links?.daca_aid), "Common App's own-site links");
  assert.ok(fixtureColleges.some((s) => s.aid && "international_offered" in s.aid), "Common App's international-aid answer");
});

test("strip, write to the file store, re-apply in the compose order: every college, detail file and alias row comes back byte for byte", async () => {
  const { dir, store } = await importedStore();
  try {
    const bases = [...(await readLayer<School>(store, COLLECTIONS.base.colleges)).values()];
    assert.equal(bases.length, 3);
    for (const b of bases) assert.deepEqual(baseProblems(b), [], b.unit_id);
    const got = await reapplyLaterLayers(store, { previous, today });
    assert.deepEqual(reapplyProblems(got, fixture), []);
    // And the bytes, spelled out: the one-college-per-line file.
    const text = `[\n${got.schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`;
    assert.equal(text, readFileSync(join(fixture, "data", "schools.json"), "utf8"));
    // Twice gives the same bytes (determinism).
    const again = await reapplyLaterLayers(store, { previous, today });
    assert.equal(JSON.stringify(again), JSON.stringify(got));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each strip undoes exactly its own layer: strip(stage k) is stage k-1 on real colleges", async () => {
  const { dir, store } = await importedStore();
  try {
    const base = (await loadBase(store)).schools;
    const meta = (await loadBase(store)).meta!;
    const ca = (await loadCommonAppLayer(store))!;
    const coalition = (await loadCoalitionLayer(store))!;
    const essays = await loadEssaysLayer(store);
    const reported = await loadReportedLayer(store);
    const { files, pages } = await loadDirectoriesLayer(store);
    const tables = directoryDetails([...chapterFiles(files), ...pilotDirectoryFiles(pages)], ids);
    const s1 = applyCommonApp(base, ca.edition, ca.members, today).schools;
    const s2 = applyCoalition(s1, coalition).schools;
    const s3 = applyEssays(s2, essays.records, today, essays.confirmed).schools;
    const s4 = mergeReported(s3, reported.file, { records: reported.records, meta, table: CDS_TEMPLATE }).schools;
    const s5 = applyLgbtqPolicies(applyCccuMembership(applyDirectories(s4, tables), files), pages);
    const s6 = s5.map((s) => placeSelectivity(s, previous.get(s.unit_id)));
    const same = (a: School[], b: School[], what: string) => assert.equal(a.map((s) => JSON.stringify(s)).join("\n"), b.map((s) => JSON.stringify(s)).join("\n"), what);
    same(s6, datasetOrdered(fixtureColleges), "the stages end at the committed colleges");
    same(s6.map((s) => placeSelectivity(s, undefined)), s5, "selectivity");
    same(s5.map((s) => stripDirectories(stripCccuMembership(stripLgbtqPolicies(s)))), s4, "directories");
    // stripReported also takes back the Common App grid's test policy (part of the newest test values it restores), so
    // its stage holds as apply∘strip, and the policy is back once the remaining strips run (stripLaterLayers, below).
    same(mergeReported(s4.map(stripReported), reported.file, { records: reported.records, meta, table: CDS_TEMPLATE }).schools, s4, "college-reported: apply∘strip");
    same(s4.map((s) => stripCommonApp(stripCoalition(stripEssays(stripReported(s))))), base, "college-reported, then the rest");
    same(s3.map(stripEssays), s2, "essays");
    // The two strips this unit wrote, each beside its apply: apply∘strip is the identity at its stage, and so is strip∘apply.
    same(s2.map(stripCoalition), s1, "Coalition");
    same(applyCoalition(s2.map(stripCoalition), coalition).schools, s2, "Coalition: apply∘strip");
    same(s1.map(stripCommonApp), base, "Common App");
    same(applyCommonApp(s1.map(stripCommonApp), ca.edition, ca.members, today).schools, s1, "Common App: apply∘strip");
    // The whole chain is stripLaterLayers.
    same(fixtureColleges.map(stripLaterLayers), datasetOrdered(base), "stripLaterLayers");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const datasetOrdered = (schools: readonly School[]) => [...schools].sort((a, b) => a.name.localeCompare(b.name) || a.unit_id.localeCompare(b.unit_id));

test("identity stays in the base, and re-applying it from its own layers changes nothing", async () => {
  const { dir, store } = await importedStore();
  try {
    const inputs = await loadIdentity(store);
    assert.ok(inputs.probe.size === 3 && inputs.wikidata.size > 0, "the identity layers hold the fixture's colleges");
    for (const b of (await loadBase(store)).schools) {
      assert.ok(b.links && b.brand, `${b.unit_id} keeps its identity values`);
      assert.equal(JSON.stringify(applyIdentity(structuredClone(b), inputs)), JSON.stringify(b), b.unit_id);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the legacy overrides stay in the base, and re-applying them as sync-data does changes nothing (real data)", () => {
  // None of the three fixture colleges has a real data/overrides.json entry; NYU (193900, real record + its real
  // override patch) is copied separately (tests/fixtures/data-platform-import/overrides-sample.json, not part of
  // the "under 300 KB" three-college fixture) so this still exercises the real check, on real data.
  const sample = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "data-platform-import", "overrides-sample.json"), "utf8")) as { school: School; overrides: Record<string, Patch> };
  const overrides = sample.overrides;
  const ids = Object.keys(overrides).filter((k) => !k.startsWith("_"));
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const base = stripLaterLayers(sample.school);
    const again = deepMerge(base, overrides[id]);
    again.lineage = { ...(again.lineage ?? {}), ...lineageForPatch(id, overrides[id]) };
    assert.equal(JSON.stringify(again), JSON.stringify(base), id);
  }
});

test("base.meta keeps the later layers' sources, and the compose's add*Meta calls leave it unchanged", async () => {
  // Originally imported straight from the real data/ (importLayers(ROOT, {...})) into a scratch store; the mini
  // fixture's own committed layers (tests/fixtures/snapshot-mini/layers/, already imported) stand in for that, so
  // this needs no real `data/` at all.
  const store = miniLayers();
  const meta = (await loadBase(store)).meta!;
  assert.deepEqual(meta, miniMeta());
  const after = structuredClone(meta);
  addIdentityMeta(after, await loadIdentity(store));
  const ca = (await loadCommonAppLayer(store))!;
  addCommonAppMeta(after, ca.edition, ca.members);
  addCoalitionMeta(after, (await loadCoalitionLayer(store))!);
  addDirectoryMeta(after, (await loadDirectoriesLayer(store)).files);
  // sources.directory.description names every organization with a listing; the mini fixture's directories.listings
  // is trimmed to its 12 colleges (scripts/build-mini-fixture.mts trimLayers), so it names fewer organizations than
  // the real, untrimmed meta.json copied into the fixture verbatim — a fixture-coverage mismatch, not a real one.
  // Checked without that one field; everything else (including the other three add*Meta calls) is unchanged.
  const strip = (m: DatasetMeta) => ({ ...m, sources: { ...m.sources, directory: { ...m.sources.directory, description: "" } } });
  assert.equal(JSON.stringify(strip(after)), JSON.stringify(strip(meta)));
});

test("base.detail drops only the tables the later layers build", async () => {
  for (const t of LATER_DETAIL_TABLES) assert.ok(DETAIL_TABLE_KEYS.includes(t), t);
  const { dir, store } = await importedStore();
  try {
    const details = await readLayer<{ tables: Record<string, unknown> }>(store, COLLECTIONS.base.detail);
    for (const [id, d] of details) {
      for (const t of LATER_DETAIL_TABLES) assert.ok(!(t in d.tables), `${id} still has ${t}`);
      const file = JSON.parse(readFileSync(join(fixture, "data", "detail", "schools", `${id}.json`), "utf8")) as { tables: Record<string, unknown> };
      for (const t of Object.keys(file.tables).filter((k) => !(LATER_DETAIL_TABLES as readonly string[]).includes(k))) assert.deepEqual(d.tables[t], file.tables[t]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the guards bite: a skipped strip, a missing layer, a changed base are all caught", async () => {
  const duke = committed.find((s) => s.unit_id === "198419")!;
  assert.ok(baseProblems(duke).length > 5, "a committed college is no base");
  // A chain that forgets Coalition's strip leaves the block, which the re-apply alone wouldn't notice.
  const noCoalitionStrip = stripCommonApp(stripEssays(stripReported(stripDirectories(stripCccuMembership(stripLgbtqPolicies(placeSelectivity(duke, undefined)))))));
  assert.match(baseProblems(noCoalitionStrip).join("\n"), /has coalition/);
  // Re-applying without the Coalition layer, or over a changed base, no longer gives the committed bytes.
  const { dir, store } = await importedStore();
  try {
    const set = await store.open("pipeline", "test", "r");
    await set.remove(COLLECTIONS.coalition.members, ["members"]);
    await set.close("applied");
    assert.match(reapplyProblems(await reapplyLaterLayers(store, { previous, today }), fixture).join("\n"), /198419.*differs/);
    const set2 = await store.open("pipeline", "test", "r2");
    const { trends: _t, ...noTrends } = (await store.readOne<School>(COLLECTIONS.base.colleges, "123457"))!;
    void _t;
    await set2.write(COLLECTIONS.base.colleges, [{ key: "123457", body: noTrends }]);
    await set2.close("applied");
    assert.match(reapplyProblems(await reapplyLaterLayers(store, { previous, today }), fixture).join("\n"), /123457.*differs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one import change set; re-importing writes nothing; a document git lost is removed", async () => {
  const { dir, store } = await importedStore();
  try {
    const [first] = fileStoreChangeSets(dir);
    assert.equal(first.kind, "import");
    assert.equal(first.source, "git");
    assert.equal(first.run_ref, "test-commit");
    assert.equal(first.status, "applied");
    assert.ok((first.summary.documents as number) > 20);
    await writeImport(store, importLayers(fixture), "test-commit");
    assert.equal(fileStoreChangeSets(dir)[1].summary.documents, 0);
    // A college's essay record leaves git: the next import removes the document.
    const layers = importLayers(fixture);
    layers.get(COLLECTIONS.essays.records)!.delete("198419");
    await writeImport(store, layers, "next-commit");
    assert.equal(await store.readOne(COLLECTIONS.essays.records, "198419"), null);
    assert.equal(fileStoreChangeSets(dir)[2].summary.removed, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--only and units limit what the import reads; headers keep each split file's other fields", () => {
  const only = importLayers(fixture, { only: new Set([COLLECTIONS.reported.entries, COLLECTIONS.import.headers]) });
  assert.deepEqual([...only.keys()].sort(), [COLLECTIONS.import.headers, COLLECTIONS.reported.entries].sort());
  assert.deepEqual(only.get(COLLECTIONS.import.headers)!.get("college-reported.json"), { updated: readData<{ updated: string }>("college-reported.json").updated });
  const one = importLayers(fixture, { units: new Set(["123457"]) });
  assert.deepEqual([...one.get(COLLECTIONS.base.colleges)!.keys()], ["123457"]);
  assert.deepEqual([...one.get(COLLECTIONS.history.schools)!.keys()], ["123457"]);
});
