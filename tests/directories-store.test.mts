/**
 * The directory runner and the campus-life pilot on the data store (specs/data-platform/pipelines.md,
 * "campus-pilot, sync-directories"): scripts/lib/directories/store.mts and scripts/lib/campus-pilot/store.mts, on the
 * file store, seeded by the import from the committed files so a run and an import key every document alike.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore, fileStoreChangeSets } from "../scripts/lib/data-platform/store.mts";
import { COLLECTIONS, SINGLE_KEYS, loadDirectoriesLayer } from "../scripts/lib/data-platform/layers.mts";
import { withRunSet } from "../scripts/lib/data-platform/change-set.mts";
import { importLayers, writeImport } from "../scripts/import-data-from-git.mts";
import { Blocked, defineAdapter, type CrawlContext, type RawEntry } from "../scripts/lib/directories/contract.mts";
import type { BlockedFile, DirectoryFile, UnmatchedFile } from "../scripts/lib/directories/files.mts";
import { readDirectoryFiles } from "../scripts/lib/directories/files.mts";
import { matchIndexFromStore, readBlockedDoc, readReviewedDoc, syncDirectories, writeBlockedDoc, writeOrgDocs } from "../scripts/lib/directories/store.mts";
import { storeColleges } from "../scripts/lib/identity-store.mts";
import { DEFAULT_COLLEGES_FILE, readCollegeList, readPagesFile, readSourcesFile, type PublishedCollege } from "../scripts/lib/campus-pilot/files.mts";
import { latestCampusReport, readCollegeListFrom, readPagesDoc, readSourcesDoc, saveCampusRun } from "../scripts/lib/campus-pilot/store.mts";
import type { CampusRecipe, CollegeResult } from "../scripts/lib/campus-pilot/run.mts";

const ROOT = join(import.meta.dirname, "fixtures", "directories-store");
const TODAY = "2026-10-04";
// Stands in for the original Vanderbilt/Columbia pair (tests/fixtures/directories-store/README.md): a small real
// college whose name the fake adapter's entry matches, and a second real college that stays unmatched.
const MATCHED = "490328"; // Mechon L'hoyroa

/** A file store with the import's documents for `only` (and `units` for the per-college ones). */
async function imported(only: string[], units?: Set<string>): Promise<{ root: string; store: ReturnType<typeof fileStore> }> {
  const root = mkdtempSync(join(tmpdir(), "directories-store-"));
  const store = fileStore(root);
  await writeImport(store, importLayers(ROOT, { only: new Set(only), units }), "fixture");
  return { root, store };
}

const fake = (key: string, crawl: () => Promise<RawEntry[]>) =>
  defineAdapter({ key, organization: key, publisher: key, listUrl: `https://${key}.org/chapters`, tier: "D", domain: "faith", tradition: "orthodox", crawl });
const ctx = (org: string) => ({ org, today: TODAY, fetchText: async () => "", fetchJson: async () => ({}), log: () => {} }) as CrawlContext;

/* ------------------------------------------------------------------ */
/* Directories                                                         */
/* ------------------------------------------------------------------ */

test("directories: the runner's writers key the committed files as the import does (writing them back writes nothing)", async () => {
  const { root, store } = await imported([COLLECTIONS.directories.listings, COLLECTIONS.directories.unmatched, COLLECTIONS.directories.blocked, COLLECTIONS.directories.matches]);
  try {
    const listings = await store.read<DirectoryFile>(COLLECTIONS.directories.listings);
    const unmatched = await store.read<UnmatchedFile>(COLLECTIONS.directories.unmatched);
    assert.equal(listings.size, readDirectoryFiles(ROOT).length);
    const handle = await store.open("pipeline", "directories", "resave");
    for (const [org, file] of listings) await writeOrgDocs(store, handle, file, unmatched.get(org) ?? { org, crawled: file.crawled, entries: [] });
    await writeBlockedDoc(handle, await readBlockedDoc(store));
    await handle.close("applied");
    assert.equal(fileStoreChangeSets(root).at(-1)!.summary.documents, 0);
    assert.ok(Object.keys(await readReviewedDoc(store)).length > 0, "the hand-checked answers come from directories.matches");
    assert.ok(!Object.keys(await readReviewedDoc(store)).some((k) => k.startsWith("_")), "without the file's notes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncDirectories: writes each adapter's documents, records refusals, keeps a failed adapter's, and a dry run writes nothing", async () => {
  const { root, store } = await imported([COLLECTIONS.base.colleges, COLLECTIONS.directories.matches], new Set([MATCHED, "138558"]));
  try {
    // Earlier documents for the two adapters that will fail this run.
    const seed = await store.open("pipeline", "directories", "earlier");
    const earlier = (org: string) => ({ org, organization: org, crawled: "2026-09-01", entries: [] }) as unknown as DirectoryFile;
    await seed.write(COLLECTIONS.directories.listings, [{ key: "fake-broken", body: earlier("fake-broken") }, { key: "fake-refused", body: earlier("fake-refused") }]);
    await seed.write(COLLECTIONS.directories.unmatched, [{ key: "fake", body: { org: "fake", crawled: "2026-09-01", entries: [{ campus: "Old" }] } }]);
    await seed.close("applied");

    const schools = await storeColleges(store);
    const index = await matchIndexFromStore(store, schools, mkdtempSync(join(tmpdir(), "no-cache-")), () => {});
    let entries: RawEntry[] = [{ campus: "Mechon L'hoyroa", state: "NY", name: "OCF at Mechon" }, { campus: "Columbia College" }];
    const adapters = [
      fake("fake", async () => entries),
      fake("fake-refused", async () => {
        throw new Blocked("https://fake-refused.org/chapters", "challenge", "a challenge page");
      }),
      fake("fake-broken", async () => {
        throw new Error("layout changed");
      }),
    ];
    const opts = { index, today: TODAY, contextFor: (a: { key: string }) => ctx(a.key), log: () => {}, error: () => {} };

    const dry = await syncDirectories(store, null, adapters, opts);
    assert.deepEqual([dry.written, dry.blocked, dry.failed], [[], ["fake-refused"], ["fake-broken"]]);
    assert.equal(fileStoreChangeSets(root).length, 2, "a dry run opens no change set and writes nothing");

    const result = await withRunSet(store, { source: "directories", runRef: "1" }, (h) => syncDirectories(store, h, adapters, opts));
    assert.deepEqual([result.written, result.blocked, result.failed], [["fake"], ["fake-refused"], ["fake-broken"]]);
    const listing = (await store.readOne<DirectoryFile>(COLLECTIONS.directories.listings, "fake"))!;
    assert.deepEqual(listing.entries.map((e) => e.matches.map((m) => m.unit_id)), [[MATCHED]]);
    assert.deepEqual((await store.readOne<UnmatchedFile>(COLLECTIONS.directories.unmatched, "fake"))!.entries.map((e) => e.campus), ["Columbia College"]);
    assert.equal((await store.readOne<DirectoryFile>(COLLECTIONS.directories.listings, "fake-broken"))!.crawled, "2026-09-01", "a failed adapter keeps its documents");
    assert.equal((await store.readOne<DirectoryFile>(COLLECTIONS.directories.listings, "fake-refused"))!.crawled, "2026-09-01", "a refused one too");
    const blocked = (await store.readOne<BlockedFile>(COLLECTIONS.directories.blocked, SINGLE_KEYS.blocked))!;
    assert.deepEqual(blocked.blocked.map((b) => [b.org, b.reason, b.first_seen]), [["fake-refused", "challenge", TODAY]]);
    const set = fileStoreChangeSets(root).at(-1)!;
    assert.deepEqual([set.source, set.status, set.summary.collections], ["directories", "applied", [COLLECTIONS.directories.blocked, COLLECTIONS.directories.listings, COLLECTIONS.directories.unmatched]]);

    // Everything matches next time: the unmatched document goes; the publisher's loader reads the listing.
    entries = [{ campus: "Mechon L'hoyroa", state: "NY", name: "OCF at Mechon" }];
    await withRunSet(store, { source: "directories", runRef: "2" }, (h) => syncDirectories(store, h, [adapters[0]], opts));
    assert.equal(await store.readOne(COLLECTIONS.directories.unmatched, "fake"), null);
    assert.deepEqual((await loadDirectoriesLayer(store)).files.map((f) => f.org), ["fake-broken", "fake-refused", "fake"], "in readDirectoryFiles' order (by file name)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* The campus-life pilot                                               */
/* ------------------------------------------------------------------ */

function emptyResult(unit_id: string, name: string, extra: Partial<CollegeResult> = {}): CollegeResult {
  return { unit_id, name, checked: TODAY, greek: null, faith: null, lgbtq: null, listings: [], raw: {}, escalated: [], dropped: [], checks: [], errors: [], ...extra };
}
const recipeFor = (unit_id: string): CampusRecipe => ({ unit_id, learned: TODAY, model: "claude-sonnet-5", links: { greek: { fsl_office: `https://fsl.x${unit_id}.edu/` } }, sources: [] });

const CAMPUS = [COLLECTIONS.campus.pages, COLLECTIONS.campus.sources, COLLECTIONS.import.headers, COLLECTIONS.directories.blocked, COLLECTIONS.reference.files];

test("campus pilot: the store reads give back the committed files, and an empty run on the same day writes nothing", async () => {
  const { root, store } = await imported(CAMPUS);
  try {
    const pages = readPagesFile(join(ROOT, "data", "campus-pages.json"));
    const sources = readSourcesFile(join(ROOT, "data", "campus-sources.json"), TODAY);
    const doc = await readPagesDoc(store);
    assert.equal(doc.updated, pages.updated);
    assert.deepEqual(doc.colleges, [...pages.colleges].sort((a, b) => (a.unit_id < b.unit_id ? -1 : 1)));
    assert.deepEqual(await readSourcesDoc(store, TODAY), { updated: sources.updated, recipes: [...sources.recipes].sort((a, b) => (a.unit_id < b.unit_id ? -1 : 1)) });
    assert.deepEqual(await readCollegeListFrom(store, DEFAULT_COLLEGES_FILE, ROOT), readCollegeList(join(ROOT, DEFAULT_COLLEGES_FILE)), "the default list comes from reference.files");

    const handle = await store.open("pipeline", "campus-pilot", "empty");
    await saveCampusRun(store, handle, { results: [], recipes: [], blocked: [], report: null, today: pages.updated! });
    await handle.close("applied");
    assert.equal(fileStoreChangeSets(root).at(-1)!.summary.documents, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("campus pilot: a run changes only its colleges, records refusals and the report, and holds for review by default", async () => {
  const { root, store } = await imported(CAMPUS);
  try {
    const before = await store.read<PublishedCollege>(COLLECTIONS.campus.pages);
    const [kept, cleared] = [...before.keys()];
    const b1 = "999991";
    const results = [
      emptyResult(b1, "B one", { faith: { office: { url: "https://x.edu/chaplain", checked: TODAY, quote: "Office of the Chaplain", name: "Office of the Chaplain" } } }),
      emptyResult(cleared, "Cleared"),
    ];
    const run = "2026-10-31T12-00-00";
    await withRunSet(
      store,
      { source: "campus-pilot", runRef: "1", close: () => ({ status: "held", reason: "review first" }) },
      (handle) => saveCampusRun(store, handle, { results, recipes: [recipeFor(b1)], blocked: [{ url: "https://x.edu/greek", reason: "challenge" }], report: { run, body: { run, results } }, today: "2026-10-31" })
    );
    const after = await store.read<PublishedCollege>(COLLECTIONS.campus.pages);
    assert.ok(after.has(b1), "the college with a fact is added");
    assert.equal(after.has(cleared), false, "a clean run with nothing to publish removes the college");
    assert.deepEqual(after.get(kept), before.get(kept), "every other college is kept as it was");
    assert.deepEqual(await store.readOne(COLLECTIONS.import.headers, "campus-pages.json"), { updated: "2026-10-31" });
    assert.ok((await store.read(COLLECTIONS.campus.sources)).has(b1));
    assert.ok((await readBlockedDoc(store)).blocked.some((b) => b.org === "campus-pilot" && b.url === "https://x.edu/greek"));
    assert.deepEqual(await latestCampusReport(store), { key: `campus-pilot-${run}.json`, body: { run, results } });
    const set = fileStoreChangeSets(root).at(-1)!;
    assert.deepEqual([set.source, set.status, set.held_reason], ["campus-pilot", "held", "review first"]);
    assert.ok((set.summary.collections as string[]).includes(COLLECTIONS.reported.reports));
    // The publisher's loader sees the pages with the new header.
    assert.equal((await loadDirectoriesLayer(store)).pages.updated, "2026-10-31");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
