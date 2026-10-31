/**
 * The mini fixture (tests/fixtures/snapshot-mini/, built by scripts/build-mini-fixture.mts;
 * specs/data-platform/git-ci-tests.md "The mini fixture"): the small, real slice of the data platform tests use in
 * place of the real snapshot or the database. Not a test file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../../lib/types";
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

let cachedMeta: DatasetMeta | null = null;

/** The mini fixture's `meta.json`. */
export function miniMeta(): DatasetMeta {
  if (!cachedMeta) cachedMeta = JSON.parse(readFileSync(join(miniSnapshotDir(), "meta.json"), "utf8")) as DatasetMeta;
  return cachedMeta;
}
