/**
 * The mini fixture (tests/fixtures/snapshot-mini/, built by scripts/build-mini-fixture.mts;
 * specs/data-platform/git-ci-tests.md "The mini fixture"): the small, real slice of the data platform tests use in
 * place of the real snapshot or the database. Not a test file.
 *
 * NOTE (G4, 2026-10-31): as found, this file carried only miniSnapshotDir/miniLayers/miniSchools/miniSchool/miniMeta,
 * and the fixture itself was still the earlier 12-college build (no `feature/data-platform-4` integration branch
 * existed yet to merge the lead's planned pre-step: 38 colleges, every reference document, these extra helpers). The
 * functions below were added here by G4 because G2/G3/G4 all need them and nothing else had supplied them; see this
 * unit's report for the conflict this may cause when the lead's real pre-step lands.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
import type { DatasetMeta, School } from "../../lib/types";
import type { ReleaseCalendar } from "../../lib/releases";
import type { SchoolHistory } from "../../lib/history";
import type { AliasRow } from "../../lib/identity-files";
import { fileStore, type DataStore } from "../../scripts/lib/data-platform/store.mts";

const ROOT = join(import.meta.dirname, "..", "..");
const FIXTURE_DIR = join(ROOT, "tests", "fixtures", "snapshot-mini");

/** `tests/fixtures/snapshot-mini/snapshot/`: the bundled layout `fetch-snapshot --fixture` copies to `.data/snapshot/`. */
export function miniSnapshotDir(): string {
  return join(FIXTURE_DIR, "snapshot");
}

/** `tests/fixtures/snapshot-mini/layers/`: the file store (scripts/lib/data-platform/store.mts) over the mini fixture's layers. */
export function miniLayers(): DataStore {
  return fileStore(join(FIXTURE_DIR, "layers"));
}

let cachedSchools: School[] | null = null;

/** The mini fixture's colleges, in dataset order, from `snapshot/colleges.json` (the composed, rendered form). */
export function miniSchools(): School[] {
  if (!cachedSchools) cachedSchools = JSON.parse(readFileSync(join(miniSnapshotDir(), "colleges.json"), "utf8")) as School[];
  return cachedSchools;
}

/** One college of the mini fixture by unit id, or undefined (`scripts/build-mini-fixture.mts` DEFAULT_UNITS lists them). */
export function miniSchool(unitId: string): School | undefined {
  return miniSchools().find((s) => s.unit_id === unitId);
}

/** Like `miniSchool`, but throws (with the unit id) when the fixture lacks it, for tests that need one unconditionally. */
export function requireMiniSchool(unitId: string): School {
  const s = miniSchool(unitId);
  if (!s) throw new Error(`mini fixture lacks unit ${unitId} (see scripts/build-mini-fixture.mts DEFAULT_UNITS)`);
  return s;
}

let cachedMeta: DatasetMeta | null = null;

/** The mini fixture's `meta.json`. */
export function miniMeta(): DatasetMeta {
  if (!cachedMeta) cachedMeta = JSON.parse(readFileSync(join(miniSnapshotDir(), "meta.json"), "utf8")) as DatasetMeta;
  return cachedMeta;
}

let cachedCalendar: ReleaseCalendar | null = null;

/** The mini fixture's `release-calendar.json`. */
export function miniReleaseCalendar(): ReleaseCalendar {
  if (!cachedCalendar) cachedCalendar = JSON.parse(readFileSync(join(miniSnapshotDir(), "release-calendar.json"), "utf8")) as ReleaseCalendar;
  return cachedCalendar;
}

let cachedAliases: AliasRow[] | null = null;

/** The mini fixture's `aliases.json`. */
export function miniAliases(): AliasRow[] {
  if (!cachedAliases) cachedAliases = JSON.parse(readFileSync(join(miniSnapshotDir(), "aliases.json"), "utf8")) as AliasRow[];
  return cachedAliases;
}

/** One college's history shard (`snapshot/history/<unitId>.json`), or undefined when the fixture carries none for it. */
export function miniHistory(unitId: string): SchoolHistory | undefined {
  const p = join(miniSnapshotDir(), "history", `${unitId}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SchoolHistory) : undefined;
}

/** The shared history files (`snapshot/history/shared.json`): `{meta, national, facts, cpi}`, real but for all colleges. */
export function miniHistoryFiles(): { meta: unknown; national: unknown; facts: unknown; cpi: unknown } {
  return JSON.parse(readFileSync(join(miniSnapshotDir(), "history", "shared.json"), "utf8"));
}

/** One college's detail shard (`snapshot/detail/<unitId>.json`), or undefined when the fixture carries none for it. */
export function miniDetail(unitId: string): unknown | undefined {
  const p = join(miniSnapshotDir(), "detail", `${unitId}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
}

/** One national trend file (`snapshot/trends/<name>.json`); the fixture only ships `index` today. */
export function miniTrend(name: string): unknown | undefined {
  const p = join(miniSnapshotDir(), "trends", `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
}

/**
 * One reference document, by its `reference.files` key (e.g. "cip2020", "federal-loans", "aid-policies",
 * "application-cycle", "major-admission", "guaranteed-admission", "zcta-centroids", "essay-guidance/guidance"): the
 * body as the real store holds it (a parsed object, or `{text}` for a text file). Reads the mini fixture's layers
 * (`tests/fixtures/snapshot-mini/layers/reference.files/`), which as built here (G4, 2026-10-31) carries the five
 * names a snapshot renders plus the extra documents this unit's tests need, copied by hand from `data/` because the
 * lead's planned pre-step (the publisher rendering every reference document into the fixture) hadn't landed yet; see
 * this unit's report. Returns null when the fixture doesn't carry that name.
 */
export async function miniReference<T = unknown>(name: string): Promise<T | null> {
  return miniLayerDocument<T>("reference.files", name);
}

/** `tests/fixtures/snapshot-mini/snapshot/high-schools`: the bundled high-school fallback folder (two states). */
export function miniHighSchoolsDir(): string {
  return join(miniSnapshotDir(), "high-schools");
}

/** One document from the mini fixture's layers (the file store), by collection and key, or null when absent. */
export async function miniLayerDocument<T = unknown>(collection: string, key: string): Promise<T | null> {
  return miniLayers().readOne<T>(collection, key);
}

let tsResolverInstalled = false;

/**
 * Registers a resolve hook that retries a failed relative import with `.ts` (then `/index.ts`), so plain Node can
 * load a module written for the bundler (extensionless relative imports: lib/dataset.ts, lib/data.ts). Idempotent;
 * call before importing any such module. (Same approach as tests/search-index.test.mts.)
 */
export function installTsResolver(): void {
  if (tsResolverInstalled) return;
  tsResolverInstalled = true;
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

/**
 * `createDataset` (lib/dataset.ts) over the mini fixture: what `getData()` gives a page. Async: it installs the ts
 * resolver, then dynamically imports lib/dataset.ts, before any other `lib/` module written for the bundler is
 * imported in the same process.
 */
export async function miniDataset(): Promise<ReturnType<typeof import("../../lib/dataset.ts").createDataset>> {
  installTsResolver();
  const { createDataset } = await import("../../lib/dataset.ts");
  return createDataset({ schools: miniSchools(), meta: miniMeta(), releaseCalendar: miniReleaseCalendar(), aliases: miniAliases() });
}
