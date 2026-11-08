/**
 * The bundled copy for scripts (specs/data-platform/git-ci-tests.md, publish.md "The loader"): `.data/snapshot/`, what
 * `npm run fetch-snapshot` wrote (the real snapshot after a fetch, the mini fixture after `--fixture` or a keyless
 * `--ensure`). The `check-*` scripts in `npm run verify` and the scripts that only need the composed colleges or a
 * reference document read it here, never a committed data folder. Every reader throws the `--ensure` sentence when the
 * copy is missing.
 *
 * `dir` defaults to the repository's `.data/snapshot/`; `QUAD_SNAPSHOT_DIR` (or a script's own flag passed through)
 * points a reader at another snapshot folder, such as `tests/fixtures/snapshot-mini/snapshot`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { DatasetMeta, School } from "../../../lib/types";
import { BUNDLED_SNAPSHOT_DIR, FIXTURE_SNAPSHOT_ID, type SnapshotManifest } from "../../../lib/data-platform/snapshot.ts";
import { installLazyLineage, type LineageObject, type SchoolLineage } from "../../../lib/data-platform/lineage-split.ts";
import type { DataStore } from "./store.mts";
import { COLLECTIONS } from "./layers.mts";

export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/** The sentence every reader throws when there is no bundled copy (the loader's own, lib/data-platform/loader.ts). */
export const NO_SNAPSHOT = "No data snapshot: run `npm run fetch-snapshot -- --ensure`";

/** The snapshot folder: `dir` if given, else `QUAD_SNAPSHOT_DIR`, else `<repo>/.data/snapshot`. Relative paths resolve from the repo root. */
export function bundledDir(dir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const chosen = dir ?? env.QUAD_SNAPSHOT_DIR ?? BUNDLED_SNAPSHOT_DIR;
  return isAbsolute(chosen) ? chosen : join(REPO_ROOT, chosen);
}

/** Throws NO_SNAPSHOT unless the folder holds a whole copy (fetch-snapshot writes `manifest.json` last). */
export function requireBundled(dir?: string): string {
  const root = bundledDir(dir);
  if (!existsSync(join(root, "manifest.json"))) throw new Error(`${NO_SNAPSHOT} (no ${join(root, "manifest.json")})`);
  return root;
}

/** One JSON object of the bundled copy by its path inside the snapshot (`meta.json`, `history/shared.json`). */
export function readBundledJson<T>(object: string, dir?: string): T {
  const path = join(requireBundled(dir), object);
  if (!existsSync(path)) throw new Error(`the bundled copy has no ${object} (${path}); ${NO_SNAPSHOT}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * The composed colleges (`colleges.json`, the `School[]` the app serves), each with its `lineage` as the loader gives
 * it (lib/data-platform/loader.ts `readBundledSchools`): a split snapshot's colleges get a lazy `lineage` that reads
 * `lineage/<unit_id>.json` (or the one `lineage.json` when there is no folder) on first access; an older snapshot's
 * inline records are left alone. So a script sees the same `School[]` it saw before the split.
 */
export function readBundledColleges(dir?: string): School[] {
  return readSnapshotSchools(requireBundled(dir));
}

/**
 * A colleges file a script was handed (`--schools <file>`): a snapshot folder's `colleges.json` comes with its lineage
 * (readSnapshotSchools); any other file is read as it is.
 */
export function readCollegesFile(file: string): School[] {
  if (basename(file) === "colleges.json") return readSnapshotSchools(dirname(file));
  return JSON.parse(readFileSync(file, "utf8")) as School[];
}

/** `colleges.json` of the snapshot folder `root` (any folder in the bundled layout) with each college's lineage, lazily. */
export function readSnapshotSchools(root: string): School[] {
  const schools = JSON.parse(readFileSync(join(root, "colleges.json"), "utf8")) as School[];
  const folder = join(root, "lineage");
  if (existsSync(folder)) {
    const units = new Set(readdirSync(folder).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)));
    installLazyLineage(schools, { units, read: (unitId) => JSON.parse(readFileSync(join(folder, `${unitId}.json`), "utf8")) as SchoolLineage });
  } else if (existsSync(join(root, "lineage.json"))) {
    let all: LineageObject | null = null;
    installLazyLineage(schools, { units: null, read: (unitId) => (all ??= JSON.parse(readFileSync(join(root, "lineage.json"), "utf8")) as LineageObject)[unitId] });
  }
  return schools;
}

/** The bundled copy's manifest. */
export function readBundledManifest(dir?: string): SnapshotManifest {
  return readBundledJson<SnapshotManifest>("manifest.json", dir);
}

/** Whether the bundled copy is the mini fixture (manifest id 0: 38 colleges, not the nation). */
export function bundledIsFixture(dir?: string): boolean {
  return readBundledManifest(dir).id === FIXTURE_SNAPSHOT_ID;
}

/**
 * The college ids a reference check tests membership against: the bundled colleges for a real snapshot; undefined
 * for the mini fixture, whose reference documents are the whole real ones and name colleges its 38 lack (the
 * publisher's reference gate checks membership against every composed college at publish time).
 */
export function bundledUnitIdsForChecks(dir?: string): Set<string> | undefined {
  return bundledIsFixture(dir) ? undefined : new Set(readBundledColleges(dir).map((s) => s.unit_id));
}

/** The dataset's `meta.json`. */
export function readBundledMeta(dir?: string): DatasetMeta {
  return readBundledJson<DatasetMeta>("meta.json", dir);
}

/**
 * A reference document by its name in `reference.files` (`aid-policies`, `blocked-hosts`, `essay-guidance/sources`):
 * the rendered `reference/<name>.json`. The five named objects keep their rendered names (`platform-prompts`,
 * `organizations`, `common-app-trends` as JSON; `essay-guidance/guidance` and `zcta-centroids` are text, read them
 * with readBundledReferenceText).
 */
export function readBundledReference<T = unknown>(name: string, dir?: string): T {
  return readBundledJson<T>(join("reference", `${name.replace(/\.json$/, "")}.json`), dir);
}

/** A text reference object by its rendered file name (`essay-guidance.md`, `zcta-centroids.csv`). */
export function readBundledReferenceText(file: string, dir?: string): string {
  const path = join(requireBundled(dir), "reference", file);
  if (!existsSync(path)) throw new Error(`the bundled copy has no reference/${file}; ${NO_SNAPSHOT}`);
  return readFileSync(path, "utf8");
}

/** The unit ids with a history shard (`history/<unit>.json`, `shared.json` excluded). */
export function bundledHistoryUnits(dir?: string): string[] {
  const folder = join(requireBundled(dir), "history");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".json") && f !== "shared.json")
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/**
 * A reference document from the store's `reference.files` (the current version, what the console edits), else the
 * bundled copy's rendered object (the version the last fetched snapshot carried); throws when neither has it.
 */
export async function readReferenceDocument<T = unknown>(store: Pick<DataStore, "readOne"> | null, name: string, dir?: string): Promise<T> {
  const fromStore = store ? await store.readOne<T>(COLLECTIONS.reference.files, name) : null;
  return fromStore ?? readBundledReference<T>(name, dir);
}
