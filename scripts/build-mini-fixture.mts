/**
 * Builds `tests/fixtures/snapshot-mini/` (specs/data-platform/git-ci-tests.md "The mini fixture"): a small, real
 * slice of the data platform for about a dozen colleges, chosen for coverage, used by the test suite in place of the
 * real snapshot or the database (no test reads the live snapshot or the database). Two folders:
 *
 *   tests/fixtures/snapshot-mini/layers/    the file store layout (scripts/lib/data-platform/store.mts), for testing
 *                                           the publisher's compose end to end, offline
 *   tests/fixtures/snapshot-mini/snapshot/  the bundled layout (lib/data-platform/snapshot.ts BUNDLED_SNAPSHOT_DIR),
 *                                           ungzipped, that `fetch-snapshot --fixture` copies into `.data/snapshot/`
 *
 * Both are rebuilt from the real `data/` (phase 1) every run. The layers folder reuses D2's import logic
 * (scripts/import-data-from-git.mts `importLayers`) restricted to the chosen colleges; the snapshot folder is
 * assembled directly from the real, already-composed files (data/schools.json, data/detail/schools/, …) because the
 * publisher (D3) isn't built yet — once it is, the snapshot folder's colleges.json etc. should equal
 * `composeSnapshot` + `renderSnapshot` over the layers folder (tests/data-platform-publish.test.mts, not this file).
 *
 *   npm run build-mini-fixture                 rebuilds the fixture in place
 *   npm run build-mini-fixture -- --add 123456  also includes unit id 123456
 *   npm run build-mini-fixture -- --out <dir>   writes elsewhere (the drift test uses this on a temp dir)
 *
 * Under 40 colleges; aimed at 2 MB combined but, as built, lands around 2.5 MB even after the trims below, because
 * the named colleges (flagship universities with full CDS records and deep per-field lineage) run well above the
 * dataset's typical per-college size — `colleges.json` alone is about 47 KB per college here, against roughly 15 KB
 * across the whole 1,893-college dataset. Getting under 2 MB outright would mean dropping one of the named colleges
 * or a collection the brief or a current test needs; this script instead trims everything that doesn't cost
 * coverage (documented in the build report, not repeated in specs): CDS records are real but limited to the four
 * colleges the CDS academics tests pin (the other named colleges' CDS records are real too, in production, but
 * repeating all ten here would cost about 550 KB more for no test that needs them); `reference.files`/`reference/*`
 * is limited to the five names a snapshot actually renders (REFERENCE_OBJECTS) rather than every file under
 * data/reference/ (most of which feed other pipelines, not publish); `zcta-centroids.csv` keeps its header comments
 * and every 300th row (a national table, not filterable by college); of the national trend files, only `index.json`
 * ships (the rest, and the two per-state/per-conference files whose size scales with every college's state or
 * conference, cost 300+ KB combined for no test that reads trends from the fixture today); the high-school shared
 * files are limited to `meta.json`, `medians.json`, `review-queue.json` (the other three are a Los Angeles-only
 * pilot and a recipe file unrelated to any college or state here); `reported.{reports,batches,docs,sources,
 * failures,review_queue}`, `directories.{unmatched,blocked,matches}`, `campus.sources`, and `essays.runs` are left
 * out of the layers folder (pipeline bookkeeping compose doesn't read, and not unit-filtered by importLayers, so
 * each would otherwise carry every college's backlog); `high_schools.{schools,ledger,detail}` are left out too (not
 * composed into a snapshot; the JSON fallback shards and shared files the loader and the console care about are
 * `high_schools.state`, limited to the two smallest shards, and `high_schools.shared`, above). Add anything back
 * here the moment a test needs it from the fixture.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AliasRow } from "../lib/identity-files";
import type { DatasetMeta, School } from "../lib/types";
import { buildSearchIndex } from "../lib/search-index.ts";
import { formatAliasRows } from "./lib/aliases-sync.mts";
import { fileStore } from "./lib/data-platform/store.mts";
import { COLLECTIONS, type CollectionName } from "./lib/data-platform/layers.mts";
import { importLayers, writeImport, type ImportedLayers } from "./import-data-from-git.mts";
import { BUNDLED_SNAPSHOT_DIR, REFERENCE_OBJECTS, SNAPSHOT_OBJECTS, type SnapshotManifest } from "../lib/data-platform/snapshot.ts";
import { flagValue } from "./lib/data-platform/store.mts";

const ROOT = join(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
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
];

/** Of DEFAULT_UNITS (plus --add), the ones whose real CDS record is kept (specs/cds-sections "CDS academics tests"). */
const CDS_UNITS = new Set(["221999", "190415", "231624", "145637"]);

/** The two smallest real high-school state shards (data/high-schools/state/*.json; checked once, see the report). */
const HS_STATES = ["sc", "ct"];

/**
 * The shared high-school files (data/high-schools/*.json) kept whole: `ap-ledger-pilot.json` and `profile-pilot.json`
 * are a Los Angeles-only pilot (159 KB combined) unrelated to any college or state this fixture carries, and
 * `profile-recipes.json` (42 KB) is recipe config no test here reads; the other three are small and genuinely
 * "shared" (meta, state medians, the empty review queue). Add the rest back if a test needs them from the fixture.
 */
const HS_SHARED_FILES = ["meta.json", "medians.json", "review-queue.json"];

/** reference.files keys a snapshot actually renders (lib/data-platform/snapshot.ts REFERENCE_OBJECTS), by name. */
const REFERENCE_KEYS = ["platform-prompts", "organizations", "common-app-trends", "essay-guidance/guidance", "zcta-centroids"];

/**
 * National trend files that ship whole. All nine small ones (everything but states.json and conferences.json, left
 * out above) would fit the coverage goal better, but at 300+ KB combined they alone would use most of the fixture's
 * budget for files no test reads from the mini fixture; `index.json` (the trends hub's card summaries) is the
 * cheapest single file that still exercises the shape. Add more here if a test needs one.
 */
const TREND_FILES = ["index"];

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const readJson = <T,>(rel: string): T => JSON.parse(readFileSync(join(DATA, rel), "utf8")) as T;

/* ------------------------------------------------------------------ */
/* Trims: the whole-file documents importLayers doesn't filter by unit */
/* ------------------------------------------------------------------ */

/** Keeps only the colleges `units` names in a reference-style array keyed by `idOf`. */
function keepUnits<T>(rows: readonly T[], units: ReadonlySet<string>, idOf: (row: T) => string | null | undefined): T[] {
  return rows.filter((r) => {
    const id = idOf(r);
    return id != null && units.has(id);
  });
}

/** Trims the whole-file documents the import writes unfiltered (storage.md's single-key or whole-file layers). */
function trimLayers(layers: ImportedLayers, units: ReadonlySet<string>): void {
  const aliases = layers.get(COLLECTIONS.base.aliases)?.get("aliases") as AliasRow[] | undefined;
  if (aliases) layers.get(COLLECTIONS.base.aliases)!.set("aliases", keepUnits(aliases, units, (r) => r.unit_id));

  const members = layers.get(COLLECTIONS.commonApp.members)?.get("members") as { members: { ipeds: string | null }[] } | undefined;
  if (members) members.members = keepUnits(members.members, units, (m) => m.ipeds);

  const grid = layers.get(COLLECTIONS.commonApp.grid);
  if (grid) for (const [key, edition] of grid) edition && ((edition as { rows: { unit_id: string | null }[] }).rows = keepUnits((edition as { rows: { unit_id: string | null }[] }).rows, units, (r) => r.unit_id)), grid.set(key, edition);

  const coalition = layers.get(COLLECTIONS.coalition.members)?.get("members") as { members: { unit_id: string }[] } | undefined;
  if (coalition) coalition.members = keepUnits(coalition.members, units, (m) => m.unit_id);

  const health = layers.get(COLLECTIONS.health.colleges)?.get("health") as { colleges: Record<string, unknown> } | undefined;
  if (health) health.colleges = Object.fromEntries(Object.entries(health.colleges).filter(([id]) => units.has(id)));

  // Organization listings: trim each org's entries to our colleges; drop an org with none left.
  const listings = layers.get(COLLECTIONS.directories.listings);
  if (listings) {
    for (const [org, doc] of listings) {
      const d = doc as { entries: { matches: { unit_id: string }[] }[] };
      const kept = d.entries.filter((e) => e.matches.some((m) => units.has(m.unit_id)));
      if (kept.length) listings.set(org, { ...d, entries: kept });
      else listings.delete(org);
    }
  }

  // reference.files: only the five names a snapshot renders; zcta-centroids keeps its header and a sample of rows.
  const reference = layers.get(COLLECTIONS.reference.files);
  if (reference) {
    for (const key of [...reference.keys()]) if (!REFERENCE_KEYS.includes(key)) reference.delete(key);
    const zcta = reference.get("zcta-centroids") as { text: string } | undefined;
    if (zcta) zcta.text = sampleCsv(zcta.text);
  }
}

/** Keeps a CSV's leading `#` comments, its header row, and every Nth data row (a real, smaller sample). */
function sampleCsv(text: string, every = 300): string {
  const lines = text.split("\n");
  const head = lines.filter((l) => l.startsWith("#"));
  const rest = lines.filter((l) => !l.startsWith("#") && l.length);
  const [header, ...rows] = rest;
  const sampled = rows.filter((_, i) => i % every === 0);
  return `${[...head, header, ...sampled].join("\n")}\n`;
}

/* ------------------------------------------------------------------ */
/* The layers folder                                                   */
/* ------------------------------------------------------------------ */

/** Collections the mini fixture's layers folder leaves out (pipeline-internal, or not composed into a snapshot). */
const LAYER_EXCLUDES: readonly CollectionName[] = [
  "reported.reports",
  "reported.batches",
  // Pipeline bookkeeping compose doesn't read (publish.md step 3 names only entries and cds_records from `reported.*`)
  // and that isn't unit-filtered by importLayers, so it would otherwise carry every college's backlog: not worth the
  // size for this fixture. Add one back here if a test needs it from the mini fixture.
  "reported.docs",
  "reported.sources",
  "reported.failures",
  "reported.review_queue",
  "directories.unmatched",
  "directories.blocked",
  "directories.matches",
  "campus.sources", // scraper recipes; compose reads campus.pages, not these
  "essays.runs", // the reader's last-run stamp; not composed into a school
  "high_schools.schools",
  "high_schools.ledger",
  "high_schools.detail",
  "high_schools.state", // written by hand below, limited to HS_STATES
];

async function buildLayers(units: ReadonlySet<string>, dir: string, log: (line: string) => void): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  const only = new Set(
    (Object.values(COLLECTIONS).flatMap((g) => Object.values(g)) as CollectionName[]).filter((c) => !LAYER_EXCLUDES.includes(c))
  );
  const layers = importLayers(ROOT, { units, only });

  // CDS records: only the four CDS-academics colleges (see the module comment).
  const cds = layers.get(COLLECTIONS.reported.cdsRecords);
  if (cds) for (const id of [...cds.keys()]) if (!CDS_UNITS.has(id)) cds.delete(id);

  trimLayers(layers, units);

  // The two smallest high-school state shards, added by hand (shards() in importLayers has no state filter).
  const stateDocs = new Map<string, unknown>();
  for (const st of HS_STATES) stateDocs.set(st, readJson(`high-schools/state/${st}.json`));
  layers.set(COLLECTIONS.highSchools.state, stateDocs);

  // The shared high-school files: limited to HS_SHARED_FILES (see its comment).
  const shared = layers.get(COLLECTIONS.highSchools.shared);
  if (shared) for (const key of [...shared.keys()]) if (!HS_SHARED_FILES.includes(`${key}.json`)) shared.delete(key);

  // A fixed clock: the fixture is rebuilt and compared byte for byte (the drift test), so `_change_sets.json`'s
  // timestamps can't depend on when `npm run build-mini-fixture` happened to run.
  const store = fileStore(dir, { now: () => new Date(0) });
  const id = await writeImport(store, layers, "mini-fixture", log);
  log(`layers: change set ${id}, ${layers.size} collections`);
}

/* ------------------------------------------------------------------ */
/* The snapshot folder                                                 */
/* ------------------------------------------------------------------ */

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

function writeFile(dir: string, rel: string, bytes: Buffer | string, objects: Record<string, { bytes: number; sha256: string }>, objectName: string): void {
  const buf = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  objects[objectName] = { bytes: buf.length, sha256: sha256(buf) };
}

async function buildSnapshot(units: ReadonlySet<string>, dir: string, log: (line: string) => void): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  const objects: Record<string, { bytes: number; sha256: string }> = {};

  const allSchools = readJson<School[]>("schools.json");
  const schools = allSchools.filter((s) => units.has(s.unit_id));
  const missing = [...units].filter((id) => !schools.some((s) => s.unit_id === id));
  if (missing.length) throw new Error(`build-mini-fixture: not in data/schools.json: ${missing.join(", ")}`);

  writeFile(dir, SNAPSHOT_OBJECTS.colleges.replace(/\.gz$/, ""), `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`, objects, SNAPSHOT_OBJECTS.colleges);
  writeFile(dir, SNAPSHOT_OBJECTS.meta, readFileSync(join(DATA, "meta.json")), objects, SNAPSHOT_OBJECTS.meta);
  writeFile(dir, SNAPSHOT_OBJECTS.releaseCalendar, readFileSync(join(DATA, "release-calendar.json")), objects, SNAPSHOT_OBJECTS.releaseCalendar);

  const aliases = keepUnits(readJson<AliasRow[]>("aliases.json"), units, (r) => r.unit_id);
  writeFile(dir, SNAPSHOT_OBJECTS.aliases, formatAliasRows(aliases), objects, SNAPSHOT_OBJECTS.aliases);

  const meta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8")) as DatasetMeta;
  const searchIndex = buildSearchIndex({ getAllSchools: () => schools, getMeta: () => meta }, aliases);
  writeFile(dir, SNAPSHOT_OBJECTS.searchIndex, `${JSON.stringify(searchIndex)}\n`, objects, SNAPSHOT_OBJECTS.searchIndex);

  for (const id of units) {
    const detailPath = join(DATA, "detail", "schools", `${id}.json`);
    if (existsSync(detailPath)) writeFile(dir, `detail/${id}.json`, readFileSync(detailPath), objects, `detail/${id}.json`);
    const historyPath = join(DATA, "history", "schools", `${id}.json`);
    if (existsSync(historyPath)) writeFile(dir, `history/${id}.json`, readFileSync(historyPath), objects, `history/${id}.json`);
  }

  const shared = {
    meta: readJson("history/meta.json"),
    national: readJson("history/national.json"),
    facts: readJson("history/facts.json"),
    cpi: readJson("history/cpi.json"),
  };
  writeFile(dir, SNAPSHOT_OBJECTS.historyShared.replace(/\.gz$/, ""), `${JSON.stringify(shared)}\n`, objects, SNAPSHOT_OBJECTS.historyShared);

  for (const name of TREND_FILES) writeFile(dir, `trends/${name}.json`, readFileSync(join(DATA, "history", "trends", `${name}.json`)), objects, `trends/${name}.json`);

  const refFiles: Record<string, string> = {
    [REFERENCE_OBJECTS.platformPrompts]: "reference/platform-prompts.json",
    [REFERENCE_OBJECTS.organizations]: "directories/organizations.json",
    [REFERENCE_OBJECTS.commonAppTrends]: "trends/common-app.json",
    [REFERENCE_OBJECTS.essayGuidance]: "reference/essay-guidance/guidance.md",
  };
  for (const [object, rel] of Object.entries(refFiles)) writeFile(dir, `reference/${object}`, readFileSync(join(DATA, rel)), objects, `reference/${object}`);
  const zcta = sampleCsv(readFileSync(join(DATA, "reference", "zcta-centroids.csv"), "utf8"));
  writeFile(dir, `reference/${REFERENCE_OBJECTS.zctaCentroids}`, zcta, objects, `reference/${REFERENCE_OBJECTS.zctaCentroids}`);

  for (const st of HS_STATES) writeFile(dir, `high-schools/${st}.json`, readFileSync(join(DATA, "high-schools", "state", `${st}.json`)), objects, `high-schools/${st}.json`);
  for (const f of HS_SHARED_FILES) writeFile(dir, `high-schools/${f}`, readFileSync(join(DATA, "high-schools", f)), objects, `high-schools/${f}`);

  const manifest: SnapshotManifest = {
    id: 0,
    created_at: new Date(0).toISOString(),
    previous_id: null,
    colleges: schools.length,
    objects,
    layers: {},
    change_set_ids: [],
  };
  writeFile(dir, SNAPSHOT_OBJECTS.manifest, `${JSON.stringify(manifest, null, 2)}\n`, objects, SNAPSHOT_OBJECTS.manifest);
  log(`snapshot: ${schools.length} colleges, ${Object.keys(objects).length} objects`);
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

export async function build(options: { units?: ReadonlySet<string>; out?: string; log?: (line: string) => void } = {}): Promise<{ units: Set<string>; bytes: number }> {
  const log = options.log ?? (() => {});
  const units = new Set(options.units ?? DEFAULT_UNITS);
  const out = options.out ?? FIXTURE_ROOT;
  await buildLayers(units, join(out, "layers"), log);
  await buildSnapshot(units, join(out, "snapshot"), log);
  const bytes = dirBytes(out);
  log(`total: ${units.size} colleges, ${kb(bytes)} (layers ${kb(dirBytes(join(out, "layers")))}, snapshot ${kb(dirBytes(join(out, "snapshot")))})`);
  return { units, bytes };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const add = argv.includes("--add") ? flagValue(argv, "--add")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [] : [];
  const outFlag = flagValue(argv, "--out");
  const units = new Set([...DEFAULT_UNITS, ...add]);
  const { bytes } = await build({ units, out: outFlag ? join(process.cwd(), outFlag) : undefined, log: (l) => console.log(l) });
  // A soft budget, not enforced: these particular colleges (flagships with full CDS records and deep lineage) run
  // well above the dataset's typical per-college size; see the build report for the arithmetic. Warn, don't fail.
  if (bytes > 2 * 1024 * 1024) console.warn(`build-mini-fixture: ${kb(bytes)} is over the fixture's 2 MB target (see the module comment and the build report)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
