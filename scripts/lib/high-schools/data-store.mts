/**
 * The high-school syncs on the data store (specs/data-platform/pipelines.md "high schools"): the `high_schools.*`
 * layers, keyed exactly as scripts/import-data-from-files.mts keys data/high-schools/ (one document per state shard,
 * ledger, state file and detail file by its file name without `.json`, and one per shared top-level file), are laid
 * out as that folder in a scratch directory, the existing file-based sync runs on it unchanged, and whatever it
 * changed, added or removed is written back in the run's change set. So the adapters, merges and checks keep their
 * tests on folders, and a run reads its prior state from the store, never from data/.
 *
 * The tables (`high_schools`, …) stay the serving copy: the publisher loads them when this layer changed.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLLECTIONS } from "../data-platform/layers.mts";
import type { ChangeSetHandle, DataStore } from "../data-platform/store.mts";
import { writeChanged } from "../data-platform/producer.mts";

/** Each high-school collection and the folder (under data/high-schools/) its documents are files of; "" is the folder itself. */
export const HIGH_SCHOOL_FOLDERS: Readonly<Record<string, string>> = {
  [COLLECTIONS.highSchools.schools]: "schools",
  [COLLECTIONS.highSchools.ledger]: "ledger",
  [COLLECTIONS.highSchools.state]: "state",
  [COLLECTIONS.highSchools.detail]: "detail",
  [COLLECTIONS.highSchools.shared]: "",
};

export type HighSchoolLayers = Map<string, Map<string, unknown>>;

/** The `.json` files directly in `dir` (not in subfolders), sorted. */
function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && statSync(join(dir, f)).isFile())
    .sort();
}

/** The folder's documents by collection, keyed as the import keys them. */
export function readHighSchoolFolder(dir: string): HighSchoolLayers {
  const out: HighSchoolLayers = new Map();
  for (const [collection, sub] of Object.entries(HIGH_SCHOOL_FOLDERS)) {
    const docs = new Map<string, unknown>();
    const folder = join(dir, sub);
    for (const f of jsonFiles(folder)) docs.set(f.slice(0, -".json".length), JSON.parse(readFileSync(join(folder, f), "utf8")));
    out.set(collection, docs);
  }
  return out;
}

/** Writes the layers as the folder (each document as its JSON text; the syncs parse what they read). */
export function writeHighSchoolFolder(dir: string, layers: HighSchoolLayers): void {
  for (const [collection, docs] of layers) {
    const folder = join(dir, HIGH_SCHOOL_FOLDERS[collection]);
    mkdirSync(folder, { recursive: true });
    for (const [key, body] of docs) writeFileSync(join(folder, `${key}.json`), `${JSON.stringify(body)}\n`);
  }
}

/** The high-school layers from the store. */
export async function readHighSchoolLayers(store: Pick<DataStore, "read">): Promise<HighSchoolLayers> {
  const out: HighSchoolLayers = new Map();
  for (const collection of Object.keys(HIGH_SCHOOL_FOLDERS)) out.set(collection, await store.read(collection));
  return out;
}

/** What changed between two copies, written into the change set (removed documents removed). */
export async function writeHighSchoolChanges(handle: ChangeSetHandle, before: HighSchoolLayers, after: HighSchoolLayers): Promise<{ sent: number; removed: number }> {
  let sent = 0;
  let removed = 0;
  for (const collection of Object.keys(HIGH_SCHOOL_FOLDERS)) {
    const r = await writeChanged(handle, collection, before.get(collection) ?? new Map(), after.get(collection) ?? new Map(), { mirror: true });
    sent += r.sent;
    removed += r.removed;
  }
  return { sent, removed };
}

/** A scratch copy of the layers as `<root>/data/high-schools/`, for a script that reads and writes paths under a root. */
export interface HighSchoolScratch {
  /** Stands in for the repository root: `<root>/data/high-schools/` holds the layers. */
  root: string;
  dir: string;
  before: HighSchoolLayers;
  /** The folder's documents now. */
  read(): HighSchoolLayers;
  remove(): void;
}

export async function highSchoolScratch(store: Pick<DataStore, "read">): Promise<HighSchoolScratch> {
  const root = mkdtempSync(join(tmpdir(), "hs-layers-"));
  const dir = join(root, "data", "high-schools");
  const before = await readHighSchoolLayers(store);
  writeHighSchoolFolder(dir, before);
  return { root, dir, before, read: () => readHighSchoolFolder(dir), remove: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Runs `fn` on a scratch copy of the layers laid out as data/high-schools/ (the folder `fn` receives), then returns
 * the layers before and after. The scratch folder is removed afterwards.
 */
export async function onHighSchoolFolder<T>(store: Pick<DataStore, "read">, fn: (dir: string) => Promise<T>): Promise<{ result: T; before: HighSchoolLayers; after: HighSchoolLayers }> {
  const scratch = mkdtempSync(join(tmpdir(), "hs-layers-"));
  const dir = join(scratch, "data", "high-schools");
  try {
    const before = await readHighSchoolLayers(store);
    writeHighSchoolFolder(dir, before);
    const result = await fn(dir);
    return { result, before, after: readHighSchoolFolder(dir) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
