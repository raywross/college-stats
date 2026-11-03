/**
 * Builds `tests/fixtures/snapshot-mini/` (specs/data-platform/git-ci-tests.md "The mini fixture"): a small, real
 * slice of the data platform for the colleges in DEFAULT_UNITS, chosen for coverage, used by the test suite in place
 * of the real snapshot or the database (no test reads the live snapshot or the database). Two folders:
 *
 *   tests/fixtures/snapshot-mini/layers/    the file store layout (scripts/lib/data-platform/store.mts), for testing
 *                                           the publisher's compose end to end, offline
 *   tests/fixtures/snapshot-mini/snapshot/  the bundled layout (lib/data-platform/snapshot.ts BUNDLED_SNAPSHOT_DIR),
 *                                           ungzipped, that `fetch-snapshot --fixture` copies into `.data/snapshot/`
 *
 * Two inputs, both read-only:
 *
 *   --snapshot <dir>   a snapshot folder in the bundled layout (default `.data/snapshot`, what `npm run fetch-snapshot`
 *                      wrote): the composed objects. The chosen colleges' rows of colleges.json, aliases.json and the
 *                      search index are re-rendered; every other object (meta, the calendar, detail and history
 *                      shards, the shared history, trends/index.json, the reference objects, source-files.json, the
 *                      high-school files) is copied byte for byte.
 *   --store supabase|file:<dir>   the layers (default: supabase when DATA_SUPABASE_URL is set). Each collection the
 *                      fixture keeps is read and filtered to the chosen colleges by the import's rules
 *                      (scripts/import-data-from-files.mts: a per-college collection keeps its colleges' documents, a
 *                      whole-file one is kept and trimmed below), then written to the layers folder as one change set.
 *
 *   npm run build-mini-fixture -- --store supabase                       rebuild in place from the real snapshot
 *   npm run build-mini-fixture -- --snapshot tests/fixtures/snapshot-mini/snapshot \
 *       --store file:tests/fixtures/snapshot-mini/layers --out /tmp/mini-check   the fixture from its own folders
 *   npm run build-mini-fixture -- … --add 123456   also includes unit id 123456 (it must be in both inputs)
 *   npm run build-mini-fixture -- … --out <dir>    writes elsewhere
 *
 * Everything is read into memory before the output folder is cleared, so the fixture can be rebuilt from itself. The
 * build is a fixed point: run over the fixture's own two folders it reproduces them byte for byte
 * (tests/data-platform-fixture.test.mts). To keep that true, every trim is idempotent and the layers keep their
 * source's order: from a file store, the order its change sets wrote the documents in (and its import's kind, source,
 * run_ref and note); from the database, collections in ALL_COLLECTIONS order and keys sorted.
 *
 * Trims (each costs no coverage a test uses; under 40 colleges and about 9 MB in all): CDS records only for the four
 * colleges the CDS academics tests pin; `zcta-centroids` keeps its header comments and every 300th row of a national
 * table (a table already under 1,000 rows is kept, so a rebuild changes nothing); of the national trend files only
 * `index.json`; the high-school shared files only `meta.json`, `medians.json`, `review-queue.json`, and the state
 * files only the two smallest (sc, ct); `reported.{reports,batches,docs,sources,failures,review_queue}`,
 * `directories.{unmatched,blocked,matches}`, `campus.sources`, `essays.runs` and `high_schools.{schools,ledger,detail}`
 * are left out of the layers (pipeline bookkeeping compose doesn't read, or not composed into a snapshot). Add
 * anything back the moment a test needs it from the fixture.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { AliasRow } from "../lib/identity-files";
import type { DatasetMeta, School } from "../lib/types";
import { buildSearchIndex } from "../lib/search-index.ts";
import { formatAliasRows } from "./lib/aliases-sync.mts";
import { compareKeys, fileStore, fileStoreChangeSets, flagValue, parseStoreFlag, storeFromFlag, type DataStore } from "./lib/data-platform/store.mts";
import { ALL_COLLECTIONS, COLLECTIONS, type CollectionName } from "./lib/data-platform/layers.mts";
import { BUNDLED_SNAPSHOT_DIR, REFERENCE_OBJECTS, SNAPSHOT_OBJECTS, type SnapshotManifest } from "../lib/data-platform/snapshot.ts";
import { REFERENCE_SOURCES } from "./lib/data-platform/render.mts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE_ROOT = join(ROOT, "tests", "fixtures", "snapshot-mini");

/** The spec's list (specs/data-platform/git-ci-tests.md, the brief's D5 section): coverage, not completeness. */
export const DEFAULT_UNITS: readonly string[] = [
  "221999", // Vanderbilt: every later layer present, one of the four CDS academics colleges
  "110635", // UC Berkeley: the UC's shared essay page
  "110662", // UCLA: the UC's shared essay page
  "190415", // Cornell: a CDS record, CDS academics
  "231624", // William & Mary: a CDS record, CDS academics
  "145637", // UIUC: a CDS record, CDS academics
  "166683", // MIT
  "139755", // Georgia Tech
  "166027", // Harvard
  "228778", // UT Austin
  "490328", // Mechon L'hoyroa: open admission, minimal data
  "138558", // Abraham Baldwin Agricultural College: none of the later layers
  // Phase 4 (specs/data-platform/git-ci-tests.md): the colleges the test suite pinned from the real data most often,
  // so the tests point here instead of the real data. Keep the whole list under 40.
  "100654", // Alabama A&M
  "198419", // Duke
  "243780", // Purdue
  "243744", // Stanford
  "199847", // Wake Forest
  "134130", // Florida
  "100724", // Alabama State
  "139959", // Georgia
  "199120", // UNC Chapel Hill
  "123457", // Simpson University
  "100706", // Alabama in Huntsville
  "204796", // Ohio State
  "198516", // Elon
  "170976", // Michigan
  "191621", // Hilbert College
  "123961", // Southern California
  "204024", // Miami (Ohio)
  "100663", // Alabama at Birmingham
  "200004", // Western Carolina
  "186131", // Princeton
  "176910", // Central Christian College of the Bible
  "131520", // Howard
  "228723", // Texas A&M
  "218663", // South Carolina
  "183026", // Southern New Hampshire
  "135726", // Miami (Florida)
];

/** Of DEFAULT_UNITS (plus --add), the ones whose real CDS record is kept (specs/cds-sections "CDS academics tests"). */
const CDS_UNITS = new Set(["221999", "190415", "231624", "145637"]);

/** The two smallest real high-school state files (`high_schools.state` keys). */
const HS_STATES = ["sc", "ct"];

/**
 * The shared high-school files kept (`high_schools.shared` keys): `ap-ledger-pilot` and `profile-pilot` are a Los
 * Angeles-only pilot unrelated to any college or state here, and `profile-recipes` is recipe config no test reads.
 */
const HS_SHARED_FILES = ["meta.json", "medians.json", "review-queue.json"];

/** National trend files that ship (`trends/<name>.json`): the trends hub's card summaries exercise the shape. */
const TREND_FILES = ["index"];

/** Collections the layers folder leaves out (pipeline-internal, or not composed into a snapshot). */
const LAYER_EXCLUDES: readonly CollectionName[] = [
  "reported.reports",
  "reported.batches",
  "reported.docs",
  "reported.sources",
  "reported.failures",
  "reported.review_queue",
  "directories.unmatched",
  "directories.blocked",
  "directories.matches",
  "campus.sources",
  "essays.runs",
  "high_schools.schools",
  "high_schools.ledger",
  "high_schools.detail",
  // The Data Steward's own documents: never composed into a college, never in a snapshot (specs/product/data-steward.md).
  "steward.issues",
  "steward.proposals",
  "steward.todo",
  "steward.decisions",
  "steward.audits",
  "steward.runs",
];

/**
 * The collections keyed by unit id (the import's `perUnit`, `groupedPerUnit` and `unitFolder`, and the per-college
 * entries of a whole file): a document is kept when its key is one of the chosen colleges.
 */
const UNIT_KEYED: ReadonlySet<CollectionName> = new Set<CollectionName>([
  COLLECTIONS.base.colleges,
  COLLECTIONS.base.detail,
  COLLECTIONS.identity.wikidata,
  COLLECTIONS.identity.probe,
  COLLECTIONS.identity.linkIssues,
  COLLECTIONS.identity.brandColors,
  COLLECTIONS.identity.brandLogos,
  COLLECTIONS.identity.brandOverrides,
  COLLECTIONS.identity.wikidataIssues,
  COLLECTIONS.reported.entries,
  COLLECTIONS.reported.cdsRecords,
  COLLECTIONS.campus.pages,
  COLLECTIONS.essays.records,
  COLLECTIONS.essays.held,
  COLLECTIONS.essays.confirmed,
  COLLECTIONS.essays.pages,
  COLLECTIONS.history.schools,
  COLLECTIONS.overrides.legacy,
]);

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/* ------------------------------------------------------------------ */
/* Trims: idempotent, so a rebuild from the fixture changes nothing    */
/* ------------------------------------------------------------------ */

/** Keeps only the colleges `units` names in a reference-style array keyed by `idOf`. */
function keepUnits<T>(rows: readonly T[], units: ReadonlySet<string>, idOf: (row: T) => string | null | undefined): T[] {
  return rows.filter((r) => {
    const id = idOf(r);
    return id != null && units.has(id);
  });
}

/** A national table of more rows than this is sampled; one this small (already a sample) is kept whole. */
const SAMPLE_ABOVE_ROWS = 1000;

/** Keeps a CSV's leading `#` comments, its header row, and every Nth data row of a national table (a real, smaller sample). */
export function sampleCsv(text: string, every = 300): string {
  const lines = text.split("\n");
  const head = lines.filter((l) => l.startsWith("#"));
  const rest = lines.filter((l) => !l.startsWith("#") && l.length);
  const [header, ...rows] = rest;
  const sampled = rows.length > SAMPLE_ABOVE_ROWS ? rows.filter((_, i) => i % every === 0) : rows;
  return `${[...head, header, ...sampled].join("\n")}\n`;
}

/** Trims the whole-file documents the store keeps unfiltered (storage.md's single-key or whole-file layers). */
function trimLayers(layers: Map<CollectionName, Map<string, unknown>>, units: ReadonlySet<string>): void {
  const aliases = layers.get(COLLECTIONS.base.aliases)?.get("aliases") as AliasRow[] | undefined;
  if (aliases) layers.get(COLLECTIONS.base.aliases)!.set("aliases", keepUnits(aliases, units, (r) => r.unit_id));

  const members = layers.get(COLLECTIONS.commonApp.members)?.get("members") as { members: { ipeds: string | null }[] } | undefined;
  if (members) members.members = keepUnits(members.members, units, (m) => m.ipeds);

  const grid = layers.get(COLLECTIONS.commonApp.grid);
  if (grid) for (const edition of grid.values()) if (edition) (edition as { rows: { unit_id: string | null }[] }).rows = keepUnits((edition as { rows: { unit_id: string | null }[] }).rows, units, (r) => r.unit_id);

  const coalition = layers.get(COLLECTIONS.coalition.members)?.get("members") as { members: { unit_id: string }[] } | undefined;
  if (coalition) coalition.members = keepUnits(coalition.members, units, (m) => m.unit_id);

  const health = layers.get(COLLECTIONS.health.colleges)?.get("health") as { colleges: Record<string, unknown> } | undefined;
  if (health) health.colleges = Object.fromEntries(Object.entries(health.colleges).filter(([id]) => units.has(id)));

  // Organization listings: each org's entries trimmed to the chosen colleges; an org with none left is dropped.
  const listings = layers.get(COLLECTIONS.directories.listings);
  if (listings) {
    for (const [org, doc] of listings) {
      const d = doc as { entries: { matches: { unit_id: string }[] }[] };
      const kept = d.entries.filter((e) => e.matches.some((m) => units.has(m.unit_id)));
      if (kept.length) listings.set(org, { ...d, entries: kept });
      else listings.delete(org);
    }
  }

  const zcta = layers.get(COLLECTIONS.reference.files)?.get("zcta-centroids") as { text: string } | undefined;
  if (zcta) zcta.text = sampleCsv(zcta.text);

  const cds = layers.get(COLLECTIONS.reported.cdsRecords);
  if (cds) for (const id of [...cds.keys()]) if (!CDS_UNITS.has(id)) cds.delete(id);

  const states = layers.get(COLLECTIONS.highSchools.state);
  if (states) for (const key of [...states.keys()]) if (!HS_STATES.includes(key)) states.delete(key);

  const shared = layers.get(COLLECTIONS.highSchools.shared);
  if (shared) for (const key of [...shared.keys()]) if (!HS_SHARED_FILES.includes(`${key}.json`)) shared.delete(key);
}

/* ------------------------------------------------------------------ */
/* The layers: read from the store                                     */
/* ------------------------------------------------------------------ */

/** The change set the layers folder is written as: the source's import when it is a file store holding one. */
interface SetMeta {
  kind: "import" | "pipeline";
  source: string;
  runRef: string;
  note: string;
}

const DEFAULT_SET: SetMeta = { kind: "import", source: "files", runRef: "mini-fixture", note: "the mini fixture (scripts/build-mini-fixture.mts)" };

/**
 * The order to write in: from a file store, the order its change sets first wrote each collection and document (so a
 * rebuild from the fixture reproduces `_change_sets.json`); otherwise ALL_COLLECTIONS, keys sorted.
 */
function writeOrder(storeRoot: string | null): { collections: string[]; keys: Map<string, string[]>; set: SetMeta } {
  const collections: string[] = [];
  const keys = new Map<string, string[]>();
  let set = DEFAULT_SET;
  if (storeRoot) {
    const sets = fileStoreChangeSets(storeRoot);
    if (sets.length === 1) set = { kind: sets[0].kind, source: sets[0].source, runRef: sets[0].run_ref ?? DEFAULT_SET.runRef, note: String(sets[0].summary.note ?? DEFAULT_SET.note) };
    const seen = new Set<string>();
    for (const s of sets) {
      for (const v of s.versions) {
        if (!keys.has(v.collection)) {
          keys.set(v.collection, []);
          collections.push(v.collection);
        }
        const id = `${v.collection}\u0000${v.key}`;
        if (!seen.has(id)) {
          seen.add(id);
          keys.get(v.collection)!.push(v.key);
        }
      }
    }
  }
  for (const c of ALL_COLLECTIONS) if (!collections.includes(c)) collections.push(c);
  return { collections, keys, set };
}

/** The kept collections, filtered to `units` and trimmed, in write order. */
async function readLayers(store: DataStore, units: ReadonlySet<string>, order: ReturnType<typeof writeOrder>): Promise<Map<CollectionName, Map<string, unknown>>> {
  const out = new Map<CollectionName, Map<string, unknown>>();
  for (const c of order.collections as CollectionName[]) {
    if (!(ALL_COLLECTIONS as readonly string[]).includes(c) || LAYER_EXCLUDES.includes(c)) continue;
    const docs = await store.read<unknown>(c);
    if (!docs.size) continue;
    const known = order.keys.get(c) ?? [];
    const rank = new Map(known.map((k, i) => [k, i]));
    const sorted = [...docs.keys()].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || compareKeys(a, b));
    const kept = new Map<string, unknown>();
    for (const key of sorted) if (!UNIT_KEYED.has(c) || units.has(key)) kept.set(key, docs.get(key));
    out.set(c, kept);
  }
  trimLayers(out, units);
  return out;
}

/** Writes the layers as one change set into a fresh file store at `dir`, on a fixed clock (the drift test compares bytes). */
async function writeLayers(layers: Map<CollectionName, Map<string, unknown>>, dir: string, set: SetMeta, log: (line: string) => void): Promise<void> {
  const store = fileStore(dir, { now: () => new Date(0) });
  const handle = await store.open(set.kind, set.source, set.runRef, { note: set.note });
  for (const [c, docs] of layers) {
    if (docs.size) await handle.write(c, [...docs].map(([key, body]) => ({ key, body })));
  }
  await handle.close("applied");
  log(`layers: change set ${handle.id}, ${layers.size} collections`);
}

/* ------------------------------------------------------------------ */
/* The snapshot folder: read from a snapshot                           */
/* ------------------------------------------------------------------ */

/** The snapshot's objects to write, in manifest order: name → bytes. */
type Objects = [string, Buffer][];

function readSnapshot(snapshotDir: string, units: ReadonlySet<string>, referenceNames: readonly string[]): Objects {
  const read = (rel: string) => readFileSync(join(snapshotDir, rel));
  const has = (rel: string) => existsSync(join(snapshotDir, rel));
  if (!has(SNAPSHOT_OBJECTS.manifest)) throw new Error(`build-mini-fixture: ${snapshotDir} has no manifest.json; run \`npm run fetch-snapshot\` or pass --snapshot`);
  const objects: Objects = [];
  const add = (name: string, bytes: Buffer | string) => objects.push([name, typeof bytes === "string" ? Buffer.from(bytes) : bytes]);

  const all = JSON.parse(read("colleges.json").toString("utf8")) as School[];
  const schools = all.filter((s) => units.has(s.unit_id));
  const missing = [...units].filter((id) => !schools.some((s) => s.unit_id === id));
  if (missing.length) throw new Error(`build-mini-fixture: not in ${join(snapshotDir, "colleges.json")}: ${missing.join(", ")}`);
  add(SNAPSHOT_OBJECTS.colleges, `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
  add(SNAPSHOT_OBJECTS.meta, read(SNAPSHOT_OBJECTS.meta));
  add(SNAPSHOT_OBJECTS.releaseCalendar, read(SNAPSHOT_OBJECTS.releaseCalendar));
  const aliases = keepUnits(JSON.parse(read(SNAPSHOT_OBJECTS.aliases).toString("utf8")) as AliasRow[], units, (r) => r.unit_id);
  add(SNAPSHOT_OBJECTS.aliases, formatAliasRows(aliases));
  // No admin edits in the mini fixture; every real snapshot writes the object, empty or not, so the fixture does too.
  add(SNAPSHOT_OBJECTS.edits, `${JSON.stringify({ snapshot: 0, edits: [] }, null, 2)}\n`);
  const meta = JSON.parse(read(SNAPSHOT_OBJECTS.meta).toString("utf8")) as DatasetMeta;
  add(SNAPSHOT_OBJECTS.searchIndex, `${JSON.stringify(buildSearchIndex({ getAllSchools: () => schools, getMeta: () => meta }, aliases))}\n`);

  for (const id of units) {
    if (has(`detail/${id}.json`)) add(`detail/${id}.json`, read(`detail/${id}.json`));
    if (has(`history/${id}.json`)) add(`history/${id}.json`, read(`history/${id}.json`));
  }
  add(SNAPSHOT_OBJECTS.historyShared, `${JSON.stringify(JSON.parse(read("history/shared.json").toString("utf8")))}\n`);
  for (const name of TREND_FILES) if (has(`trends/${name}.json`)) add(`trends/${name}.json`, read(`trends/${name}.json`));

  // The named reference objects the loader asks for; then every other reference document as the publisher renders it.
  for (const object of [REFERENCE_OBJECTS.platformPrompts, REFERENCE_OBJECTS.organizations, REFERENCE_OBJECTS.commonAppTrends, REFERENCE_OBJECTS.essayGuidance]) add(`reference/${object}`, read(`reference/${object}`));
  add(`reference/${REFERENCE_OBJECTS.zctaCentroids}`, sampleCsv(read(`reference/${REFERENCE_OBJECTS.zctaCentroids}`).toString("utf8")));
  const named = new Set(Object.values(REFERENCE_SOURCES));
  for (const name of [...referenceNames].sort(compareKeys)) {
    if (named.has(name)) continue;
    const object = has(`reference/${name}.json`) ? `reference/${name}.json` : `reference/${name}.txt`;
    add(object, read(object));
  }

  add(SNAPSHOT_OBJECTS.sourceFiles, read(SNAPSHOT_OBJECTS.sourceFiles));
  for (const st of HS_STATES) if (has(`high-schools/state/${st}.json`)) add(`high-schools/state/${st}.json`, read(`high-schools/state/${st}.json`));
  for (const f of HS_SHARED_FILES) if (has(`high-schools/${f}`)) add(`high-schools/${f}`, read(`high-schools/${f}`));
  return objects;
}

/**
 * The high-school files from the layers when the snapshot carries none (the live snapshot doesn't: the tables are the
 * serving copy), as the publisher renders them.
 */
async function highSchoolsFromLayers(objects: Objects, layers: Map<CollectionName, Map<string, unknown>>): Promise<void> {
  if (objects.some(([name]) => name.startsWith("high-schools/"))) return;
  const { formatStateFile } = await import("./lib/high-schools/write.mts");
  const { prettyJson } = await import("./lib/data-platform/render.mts");
  const states = layers.get(COLLECTIONS.highSchools.state) ?? new Map();
  const shared = layers.get(COLLECTIONS.highSchools.shared) ?? new Map();
  for (const st of HS_STATES) if (states.has(st)) objects.push([`high-schools/state/${st}.json`, Buffer.from(formatStateFile(states.get(st) as never))]);
  for (const f of HS_SHARED_FILES) {
    const key = f.slice(0, -".json".length);
    if (shared.has(key)) objects.push([`high-schools/${f}`, Buffer.from(prettyJson(shared.get(key)))]);
  }
}

function writeSnapshot(objects: Objects, dir: string, colleges: number, log: (line: string) => void): void {
  const manifestObjects: SnapshotManifest["objects"] = {};
  const write = (rel: string, bytes: Buffer) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), bytes);
  };
  for (const [name, bytes] of objects) {
    write(name.replace(/\.gz$/, ""), bytes);
    manifestObjects[name] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  const manifest: SnapshotManifest = { id: 0, created_at: new Date(0).toISOString(), previous_id: null, colleges, objects: manifestObjects, layers: {}, change_set_ids: [] };
  write(SNAPSHOT_OBJECTS.manifest, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  log(`snapshot: ${colleges} colleges, ${objects.length + 1} objects`);
}

/* ------------------------------------------------------------------ */
/* Size report                                                         */
/* ------------------------------------------------------------------ */

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())
    .reduce((sum, p) => sum + statSync(p).size, 0);
}

/* ------------------------------------------------------------------ */
/* The CLI                                                             */
/* ------------------------------------------------------------------ */

export interface BuildOptions {
  units?: ReadonlySet<string>;
  /** The output folder (default the fixture itself). */
  out?: string;
  /** The snapshot folder to read (default `.data/snapshot`). */
  snapshot?: string;
  /** The layers: a `--store` value (`supabase`, `file:<dir>`) or a store with its folder (null for the database). */
  store?: string | { store: DataStore; root: string | null };
  log?: (line: string) => void;
}

export async function build(options: BuildOptions = {}): Promise<{ units: Set<string>; bytes: number }> {
  const log = options.log ?? (() => {});
  const units = new Set(options.units ?? DEFAULT_UNITS);
  const out = options.out ?? FIXTURE_ROOT;
  const snapshotDir = options.snapshot ?? join(ROOT, BUNDLED_SNAPSHOT_DIR);
  let store: DataStore;
  let storeRoot: string | null;
  if (options.store && typeof options.store === "object") ({ store, root: storeRoot } = options.store);
  else {
    const spec = parseStoreFlag(options.store);
    store = storeFromFlag(options.store);
    storeRoot = spec.kind === "file" ? spec.root : null;
  }

  // Read everything first: the inputs may be the output folder itself.
  const order = writeOrder(storeRoot);
  const layers = await readLayers(store, units, order);
  const referenceNames = [...(layers.get(COLLECTIONS.reference.files)?.keys() ?? [])];
  const objects = readSnapshot(snapshotDir, units, referenceNames);
  await highSchoolsFromLayers(objects, layers);
  const colleges = (JSON.parse(objects[0][1].toString("utf8")) as unknown[]).length;

  rmSync(join(out, "layers"), { recursive: true, force: true });
  rmSync(join(out, "snapshot"), { recursive: true, force: true });
  await writeLayers(layers, join(out, "layers"), order.set, log);
  writeSnapshot(objects, join(out, "snapshot"), colleges, log);
  const bytes = dirBytes(out);
  log(`total: ${units.size} colleges, ${kb(bytes)} (layers ${kb(dirBytes(join(out, "layers")))}, snapshot ${kb(dirBytes(join(out, "snapshot")))})`);
  return { units, bytes };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const add = argv.includes("--add") ? flagValue(argv, "--add")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [] : [];
  const abs = (p: string | undefined) => (p === undefined ? undefined : isAbsolute(p) ? p : join(process.cwd(), p));
  const storeFlag = flagValue(argv, "--store");
  const store = storeFlag?.startsWith("file:") ? `file:${abs(storeFlag.slice("file:".length))}` : storeFlag;
  const units = new Set([...DEFAULT_UNITS, ...add]);
  const { bytes } = await build({ units, out: abs(flagValue(argv, "--out")), snapshot: abs(flagValue(argv, "--snapshot")), store, log: (l) => console.log(l) });
  // A soft budget, not enforced: these colleges (flagships with full CDS records and deep lineage) run well above the
  // dataset's typical per-college size. Warn, don't fail.
  if (bytes > 10 * 1024 * 1024) console.warn(`build-mini-fixture: ${kb(bytes)} is over the fixture's 10 MB target (see the module comment)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
