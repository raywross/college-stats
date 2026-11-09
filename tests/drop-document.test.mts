/**
 * scripts/drop-document.mts on a file store (no database): the document leaves the record, its manifest entry and
 * queue items go, the recipe lists the URL as dropped, refusals, a caller's change set, and discovery's skip of a
 * dropped URL (scripts/lib/college-reported/discovery.mts `ladder`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollegeRecord, DocumentRecord, ManifestEntry } from "../lib/cds-sections.ts";
import { withoutDropped, type Recipe, type ReviewItem } from "../lib/reported.ts";
import type { School } from "../lib/types";
import { dropDocument } from "../scripts/drop-document.mts";
import { ladder } from "../scripts/lib/college-reported/discovery.mts";
import { COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import { fileStore, fileStoreChangeSets, type DataStore } from "../scripts/lib/data-platform/store.mts";

const UNIT = "145637";
const GOOD = "a".repeat(64);
const BAD = "b".repeat(64);
const DRIVE = "https://drive.google.com/uc?export=download&id=abc";
const OFFICIAL = "https://ir.example.edu/cds-2024-25.pdf";
const miniDoc = (JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "snapshot-mini", "layers", "reported.cds_records", `${UNIT}.json`), "utf8")) as { body: CollegeRecord }).body.documents[0];

const doc = (sha256: string, edition: string): DocumentRecord => ({ ...structuredClone(miniDoc), sha256, edition });
const manifest = (sha256: string, url: string, edition: string): ManifestEntry => ({ sha256, unit_id: UNIT, url, kind: "cds", type: "pdf-flat", edition, retrieved: "2026-10-19", bytes: 100, archive: null });
const item = (sha256: string, edition: string, code: string): ReviewItem => ({ unit_id: UNIT, name: "C", urls: [], entering_term: null, failures: [], queued: "2026-10-26", run: "r", code, edition, sha256 });

async function seeded(o: { only?: boolean } = {}): Promise<{ dir: string; store: DataStore }> {
  const dir = join(mkdtempSync(join(tmpdir(), "drop-")), "layers");
  const store = fileStore(dir);
  const set = await store.open("import", "test-seed", "seed");
  const docs = o.only ? [doc(BAD, "2025-26")] : [doc(BAD, "2025-26"), doc(GOOD, "2024-25")];
  await set.write(COLLECTIONS.reported.cdsRecords, [{ key: UNIT, body: { unit_id: UNIT, documents: docs } }]);
  await set.write(COLLECTIONS.reported.docs, [
    { key: BAD, body: manifest(BAD, DRIVE, "2025-26") },
    { key: GOOD, body: manifest(GOOD, OFFICIAL, "2024-25") },
  ]);
  await set.write(COLLECTIONS.reported.reviewQueue, [
    ...["C.101", "C.102", "H.201"].map((c) => ({ key: `${UNIT}|2025-26|${c}`, body: item(BAD, "2025-26", c) })),
    { key: `${UNIT}|2024-25|C.101`, body: item(GOOD, "2024-25", "C.101") },
  ]);
  const recipe: Recipe = { unit_id: UNIT, sources: [{ kind: "cds", url: DRIVE, format: "pdf", sha256: BAD }, { kind: "cds", url: OFFICIAL, format: "pdf", sha256: GOOD }], index_urls: [], learned: "2026-10-01", model: "m" };
  await set.write(COLLECTIONS.reported.sources, [{ key: UNIT, body: recipe }]);
  await set.close("applied");
  return { dir, store };
}

test("drop: the document leaves the record, the manifest, the queue and the recipe, in one drop-document set", async () => {
  const { dir, store } = await seeded();
  const lines: string[] = [];
  const res = await dropDocument(store, { unit: UNIT, sha: "bbbb", why: "a Drive copy of the 2024-25 CDS" }, { today: "2026-11-08", log: (l) => lines.push(l) });
  assert.deepEqual(res, { unit: UNIT, sha256: BAD, edition: "2025-26", queueRemoved: 3, recipeSourceDropped: true, manifestRemoved: true });
  const rec = (await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, UNIT))!;
  assert.deepEqual(rec.documents.map((d) => [d.sha256, d.edition]), [[GOOD, "2024-25"]]);
  assert.equal(await store.readOne(COLLECTIONS.reported.docs, BAD), null);
  assert.ok(await store.readOne(COLLECTIONS.reported.docs, GOOD));
  assert.deepEqual([...(await store.read<ReviewItem>(COLLECTIONS.reported.reviewQueue, `${UNIT}|`)).keys()], [`${UNIT}|2024-25|C.101`]);
  const recipe = (await store.readOne<Recipe>(COLLECTIONS.reported.sources, UNIT))!;
  assert.deepEqual(recipe.sources.map((s) => s.url), [OFFICIAL]);
  assert.deepEqual(recipe.dropped, [{ url: DRIVE, sha256: BAD, on: "2026-11-08", why: "a Drive copy of the 2024-25 CDS" }]);
  const set = fileStoreChangeSets(dir).at(-1)!;
  assert.deepEqual([set.kind, set.source, set.status], ["pipeline", "drop-document", "applied"]);
  assert.match(lines[0], /^145637 bbbbbbbbbb \(2025-26\): dropped/);
  assert.match(lines.at(-1)!, /^Change set \d+: applied$/);
});

test("drop: a dry run writes nothing; a caller's set is written into and left open", async () => {
  const { dir, store } = await seeded();
  const before = fileStoreChangeSets(dir).length;
  const dry = await dropDocument(store, { unit: UNIT, sha: BAD, why: "w" }, { dry: true });
  assert.equal(dry.queueRemoved, 3);
  assert.equal(fileStoreChangeSets(dir).length, before);
  assert.equal((await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, UNIT))!.documents.length, 2);
  const handle = await store.open("pipeline", "steward-apply", "apply-1");
  await dropDocument(store, { unit: UNIT, sha: BAD, why: "w" }, { handle });
  const set = fileStoreChangeSets(dir).find((s) => s.id === handle.id)!;
  assert.deepEqual([set.source, set.status], ["steward-apply", "open"]);
});

test("drop: refuses an unknown document, a missing why, and the only document without --force", async () => {
  const { store } = await seeded();
  await assert.rejects(dropDocument(store, { unit: UNIT, sha: "cccc", why: "w" }), /145637: no document cccc/);
  await assert.rejects(dropDocument(store, { unit: "999999", sha: BAD, why: "w" }), /999999: no document/);
  await assert.rejects(dropDocument(store, { unit: UNIT, sha: BAD, why: " " }), /needs unit, sha/);
  const only = await seeded({ only: true });
  await assert.rejects(dropDocument(only.store, { unit: UNIT, sha: BAD, why: "w" }), /the record's only document; --force/);
  const forced = await dropDocument(only.store, { unit: UNIT, sha: BAD, why: "w" }, { force: true });
  assert.equal(forced.sha256, BAD);
  assert.equal(await only.store.readOne(COLLECTIONS.reported.cdsRecords, UNIT), null);
});

test("discovery: a URL the recipe dropped is never added back, whichever step finds it", async () => {
  const recipe: Recipe = {
    unit_id: UNIT,
    sources: [{ kind: "cds", url: OFFICIAL, format: "pdf" }],
    index_urls: [],
    learned: "2026-10-01",
    model: "m",
    dropped: [{ url: DRIVE, sha256: BAD, on: "2026-11-08", why: "w" }],
  };
  const school = { unit_id: UNIT, name: "C", admissions: { year: 2024, acceptance_rate: 0.3 }, demographics: { undergrad_enrollment: 5000 }, links: { website: "https://www.c.edu/", price_calculator: null } } as unknown as School;
  const found = { path: "manual" as const, sources: [{ kind: "cds" as const, url: DRIVE, format: "pdf" as const }, { kind: "cds" as const, url: "https://ir.example.edu/cds-2025-26.pdf", format: "pdf" as const }], index_urls: [] };
  const r = await ladder({ school, recipe }, { today: "2026-11-09", budget: { remaining_usd: 0 }, blocked: { hosts: [] } }, { known: async () => found, probe: async () => found });
  assert.ok(!r.recipe.sources.some((s) => s.url === DRIVE));
  assert.ok(r.recipe.sources.some((s) => s.url === "https://ir.example.edu/cds-2025-26.pdf"));
  assert.deepEqual(r.recipe.dropped, recipe.dropped);
  assert.deepEqual(withoutDropped([{ url: DRIVE }, { url: OFFICIAL }], recipe.dropped), [{ url: OFFICIAL }]);
  assert.deepEqual(withoutDropped([{ url: DRIVE }], undefined), [{ url: DRIVE }]);
});
