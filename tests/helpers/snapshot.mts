/**
 * The mini fixture (tests/fixtures/snapshot-mini/, built by scripts/build-mini-fixture.mts;
 * specs/data-platform/git-ci-tests.md "The mini fixture"): the small, real slice of the data platform tests use in
 * place of the real snapshot or the database. 38 colleges (DEFAULT_UNITS in the builder), their history and detail
 * shards, the shared history files, every reference document, two high-school states, and the layers they composed
 * from. Not a test file. No test reads `data/`, the live snapshot, or the database: it reads this.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, School } from "../../lib/types";
import type { SchoolDetail } from "../../lib/detail";
import type { SchoolHistory } from "../../lib/history";
import type { ReleaseCalendar } from "../../lib/releases";
import type { AliasRow } from "../../lib/identity-files";
import type { HistoryFiles } from "../../lib/supabase";
import { register } from "node:module";
import type { Dataset } from "../../lib/dataset.ts";
import { fileStore, type DataStore } from "../../scripts/lib/data-platform/store.mts";
import type { TrendContext } from "../../scripts/trends/context.mts";

let resolverInstalled = false;

/**
 * lib/dataset.ts is written for the bundler (extensionless relative imports), which plain Node can't resolve. Before
 * importing it, register a resolve hook that retries a failed relative import with `.ts` (the pattern of
 * tests/search-index.test.mts). Idempotent; harmless for a test that registered its own.
 */
export function installTsResolver(): void {
  if (resolverInstalled) return;
  resolverInstalled = true;
  register(
    "data:text/javascript," +
      encodeURIComponent(`export async function resolve(specifier, context, next) {
        try { return await next(specifier, context); }
        catch (error) {
          if (!specifier.startsWith(".") || error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
          try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
        }
      }`),
  );
}

const ROOT = join(import.meta.dirname, "..", "..");
const FIXTURE_DIR = join(ROOT, "tests", "fixtures", "snapshot-mini");

/** `tests/fixtures/snapshot-mini/snapshot/`: the bundled layout `fetch-snapshot --fixture` copies to `.data/snapshot/`. */
export function miniSnapshotDir(): string {
  return join(FIXTURE_DIR, "snapshot");
}

/**
 * Makes the mini fixture the bundled copy for code that reads `.data/snapshot/` under the working directory
 * (lib/data.ts's `getData()`, `readBundledShard`), whatever `.data/snapshot/` holds in the checkout (the real snapshot
 * after a local `npm run fetch-snapshot`): makes a temporary root whose `.data/snapshot` links to the fixture's
 * snapshot folder, changes the working directory to it, and unsets DATA_SNAPSHOT_URL. Call it before the first
 * `getData()`; it changes this test process's working directory for good (each test file runs in its own process).
 * Returns the temporary root.
 */
export function installMiniAsBundledCopy(): string {
  const root = mkdtempSync(join(tmpdir(), "quad-mini-root-"));
  mkdirSync(join(root, ".data"));
  symlinkSync(miniSnapshotDir(), join(root, ".data", "snapshot"), "dir");
  delete process.env.DATA_SNAPSHOT_URL;
  process.chdir(root);
  return root;
}

/** `tests/fixtures/snapshot-mini/layers/`: the file store (scripts/lib/data-platform/store.mts) over the mini fixture's layers. */
export function miniLayers(): DataStore {
  return fileStore(join(FIXTURE_DIR, "layers"));
}

const jsonCache = new Map<string, unknown>();

/** A JSON file of the snapshot folder, parsed once; null when the fixture has no such file. */
function snapshotJson<T>(rel: string): T | null {
  const path = join(miniSnapshotDir(), rel);
  if (!jsonCache.has(path)) jsonCache.set(path, existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);
  return jsonCache.get(path) as T | null;
}

/** The mini fixture's colleges, in dataset order, from `snapshot/colleges.json` (the composed, rendered form). */
export function miniSchools(): School[] {
  return snapshotJson<School[]>("colleges.json")!;
}

/** One college of the mini fixture by unit id, or undefined (`scripts/build-mini-fixture.mts` DEFAULT_UNITS lists them). */
export function miniSchool(unitId: string): School | undefined {
  return miniSchools().find((s) => s.unit_id === unitId);
}

/** One college of the mini fixture by unit id; throws naming the id when the fixture lacks it (pick one it has). */
export function requireMiniSchool(unitId: string): School {
  const s = miniSchool(unitId);
  if (!s) throw new Error(`the mini fixture has no college ${unitId}; pick one of DEFAULT_UNITS in scripts/build-mini-fixture.mts`);
  return s;
}

/** The mini fixture's `meta.json`. */
export function miniMeta(): DatasetMeta {
  return snapshotJson<DatasetMeta>("meta.json")!;
}

/** The mini fixture's `release-calendar.json`. */
export function miniReleaseCalendar(): ReleaseCalendar {
  return snapshotJson<ReleaseCalendar>("release-calendar.json")!;
}

/** The mini fixture's `aliases.json` rows. */
export function miniAliases(): AliasRow[] {
  return snapshotJson<AliasRow[]>("aliases.json") ?? [];
}

let cachedDataset: Promise<Dataset> | null = null;

/**
 * The dataset the app would build from the mini fixture (`createDataset` over its colleges, meta, calendar and
 * aliases), built once: what `getData()` gives a page, for tests of queries, citations and rankings. Ranks and
 * medians are over the 38 colleges, not the nation. Async because lib/dataset.ts is imported lazily behind the
 * resolver above: `const data = await miniDataset()`.
 */
export function miniDataset(): Promise<Dataset> {
  if (!cachedDataset) {
    installTsResolver();
    cachedDataset = import("../../lib/dataset.ts").then(({ createDataset }) =>
      createDataset({ schools: miniSchools(), meta: miniMeta(), releaseCalendar: miniReleaseCalendar(), aliases: miniAliases() }),
    );
  }
  return cachedDataset;
}

/** A college's history shard (`snapshot/history/<unit>.json`), or null when the fixture has none for it. */
export function miniHistory(unitId: string): SchoolHistory | null {
  return snapshotJson<SchoolHistory>(join("history", `${unitId}.json`));
}

/** The shared history files (`snapshot/history/shared.json`: meta, national, facts, cpi). */
export function miniHistoryFiles(): HistoryFiles {
  return snapshotJson<HistoryFiles>(join("history", "shared.json"))!;
}

/** A college's detail tables (`snapshot/detail/<unit>.json`), or null. */
export function miniDetail(unitId: string): SchoolDetail | null {
  return snapshotJson<SchoolDetail>(join("detail", `${unitId}.json`));
}

/** A national trend file (`snapshot/trends/<name>.json`), or null when the fixture doesn't carry it (only `index`). */
export function miniTrend<T = unknown>(name: string): T | null {
  return snapshotJson<T>(join("trends", `${name}.json`));
}

/**
 * A reference document as the snapshot renders it: `reference/<name>.json` parsed, or the text of
 * `essay-guidance.md` / `zcta-centroids.csv` / a `<name>.txt`. Names are the `reference.files` keys
 * (`aid-policies`, `cip2020`, `platform-prompts`, `organizations`, `common-app-trends`, …). Throws when missing.
 */
export function miniReference<T = unknown>(name: string): T {
  const dir = join(miniSnapshotDir(), "reference");
  for (const file of [`${name}.json`, `${name}.md`, `${name}.csv`, `${name}.txt`, name]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    return (file.endsWith(".json") ? JSON.parse(text) : text) as T;
  }
  throw new Error(`the mini fixture has no reference document ${name} (tests/fixtures/snapshot-mini/snapshot/reference/)`);
}

/** `snapshot/high-schools/`: the JSON fallback's folder (HIGH_SCHOOLS_DIR) with two states, ct and sc. */
export function miniHighSchoolsDir(): string {
  return join(miniSnapshotDir(), "high-schools");
}

/** Every history shard the mini fixture has, for its colleges in dataset order. */
export function miniHistories(): SchoolHistory[] {
  return miniSchools().flatMap((s) => {
    const h = miniHistory(s.unit_id);
    return h ? [h] : [];
  });
}

let cachedTrendContext: Promise<TrendContext> | null = null;

/**
 * The national-trend builders' context over the mini fixture (scripts/trends/context.mts `trendContextFrom`, as the
 * publisher's compose builds it): its colleges, history shards and shared history files, detail shards, and the
 * excluded-campuses reference document. Built once.
 */
export function miniTrendContext(): Promise<TrendContext> {
  if (!cachedTrendContext) {
    cachedTrendContext = import("../../scripts/trends/context.mts").then(({ trendContextFrom }) => {
      const files = miniHistoryFiles();
      return trendContextFrom({
        root: "",
        schools: miniSchools(),
        histories: new Map(miniHistories().map((h) => [h.unit_id, h])),
        hmeta: files.meta,
        cpi: files.cpi,
        national: files.national,
        facts: files.facts,
        detail: (id) => miniDetail(id),
        excludedCampuses: miniReference("excluded-campuses"),
      });
    });
  }
  return cachedTrendContext;
}

const trendBuilds = new Map<string, Promise<unknown>>();

/**
 * One national trend file as its builder (scripts/trends/index.mts BUILDERS) makes it from the mini fixture: the
 * fixture ships only `trends/index.json` (copied from the real snapshot), so a study's test recomputes it here and
 * checks it against its own long-way computation over the same shards. Panels are the fixture's 38 colleges, so every
 * group sits under its floor. Throws when the builder can't run on so few colleges.
 */
export function miniTrendFile<T = unknown>(name: string): Promise<T> {
  if (!trendBuilds.has(name)) {
    trendBuilds.set(
      name,
      Promise.all([import("../../scripts/trends/index.mts"), miniTrendContext()]).then(([{ BUILDERS }, ctx]) => {
        const builder = BUILDERS.find((b) => b.name === name);
        if (!builder) throw new Error(`no trend builder named ${name}`);
        return builder.build(ctx).file;
      }),
    );
  }
  return trendBuilds.get(name) as Promise<T>;
}

/** One layer document from the mini fixture's file store (`collection`, `key`), or null. */
export async function miniLayerDocument<T = unknown>(collection: string, key: string): Promise<T | null> {
  return miniLayers().readOne<T>(collection, key);
}
