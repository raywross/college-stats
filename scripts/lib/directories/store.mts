/**
 * The directory runner's state in the data store (specs/data-platform/pipelines.md, "campus-pilot, sync-directories"),
 * keyed as scripts/import-data-from-files.mts keys data/directories/: `directories.listings` and
 * `directories.unmatched` by organization (an org with no unmatched entries has no document), `directories.blocked`
 * one document (`blocked`), `directories.matches` one document (`matches`, the hand-checked answers; read only). The
 * publisher applies the listings (scripts/lib/campus-pilot/merge.mts `applyDirectoryLayers`).
 */
import type { School } from "../../../lib/types.ts";
import type { ChangeSetHandle, DataStore } from "../data-platform/store.mts";
import { COLLECTIONS, SINGLE_KEYS } from "../data-platform/layers.mts";
import { Blocked, type CrawlContext, type DirectoryAdapter } from "./contract.mts";
import { clearBlocks, recordBlock, type BlockedFile, type DirectoryFile, type UnmatchedFile } from "./files.mts";
import { buildIndex, type MatchIndex } from "./matcher.mts";
import { collegesFrom, readHdAliases } from "./colleges.mts";
import { runAdapter } from "./run.mts";

export async function readBlockedDoc(store: DataStore): Promise<BlockedFile> {
  return (await store.readOne<BlockedFile>(COLLECTIONS.directories.blocked, SINGLE_KEYS.blocked)) ?? { blocked: [] };
}

export async function writeBlockedDoc(handle: ChangeSetHandle, file: BlockedFile): Promise<void> {
  await handle.write(COLLECTIONS.directories.blocked, [{ key: SINGLE_KEYS.blocked, body: file }]);
}

/** The hand-checked answers ("campus|ST" → unit ids), without the file's `_` notes (as `readReviewed`). */
export async function readReviewedDoc(store: DataStore): Promise<Record<string, string[]>> {
  const raw = (await store.readOne<Record<string, unknown>>(COLLECTIONS.directories.matches, SINGLE_KEYS.matches)) ?? {};
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")) as [string, string[]][]);
}

/** One adapter's two documents; the unmatched one is removed when nothing is unmatched (as `writeOrgFiles`). */
export async function writeOrgDocs(store: DataStore, handle: ChangeSetHandle, file: DirectoryFile, unmatched: UnmatchedFile): Promise<void> {
  await handle.write(COLLECTIONS.directories.listings, [{ key: file.org, body: file }]);
  if (unmatched.entries.length) await handle.write(COLLECTIONS.directories.unmatched, [{ key: file.org, body: unmatched }]);
  else if (await store.readOne(COLLECTIONS.directories.unmatched, file.org)) await handle.remove(COLLECTIONS.directories.unmatched, [file.org]);
}

/** The matcher's index from the store's colleges (with identity applied), the cached HD aliases, and the answers. */
export async function matchIndexFromStore(store: DataStore, schools: readonly School[], root: string, log: (m: string) => void = console.log): Promise<MatchIndex> {
  const colleges = collegesFrom(schools);
  return buildIndex(colleges, readHdAliases(root, new Set(colleges.map((c) => c.unit_id)), log), await readReviewedDoc(store));
}

export interface SyncDirectoriesResult {
  /** Adapters that failed for a reason other than a refusal (their previous documents kept). */
  failed: string[];
  /** Adapters a list refused (recorded in `directories.blocked`; previous documents kept). */
  blocked: string[];
  written: string[];
}

/**
 * Runs each adapter and writes its documents into `handle` (null: a dry run, nothing written). A failed or refused
 * adapter keeps its previous documents; refusals are recorded, and an adapter read today clears its old ones.
 */
export async function syncDirectories(
  store: DataStore,
  handle: ChangeSetHandle | null,
  adapters: readonly DirectoryAdapter[],
  opts: { index: MatchIndex; today: string; contextFor: (adapter: DirectoryAdapter) => CrawlContext; log?: (m: string) => void; error?: (m: string) => void }
): Promise<SyncDirectoriesResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const error = opts.error ?? ((m: string) => console.error(m));
  let blocked = await readBlockedDoc(store);
  const out: SyncDirectoriesResult = { failed: [], blocked: [], written: [] };
  for (const adapter of adapters) {
    try {
      const { file, unmatched, placeholders } = await runAdapter(adapter, opts.contextFor(adapter), opts.index);
      const c = file.counts;
      log(
        `  ${adapter.key}: ${c.entries} entries → ${c.matched} matched (${c.multi} serving several colleges), ${c.unmatched} unmatched; ${c.colleges} colleges` +
          (placeholders ? `; ${placeholders} placeholder${placeholders === 1 ? "" : "s"} dropped` : "")
      );
      if (handle) {
        await writeOrgDocs(store, handle, file, unmatched);
        blocked = clearBlocks(blocked, adapter.key);
        out.written.push(adapter.key);
      }
    } catch (err) {
      if (err instanceof Blocked) {
        log(`  ${adapter.key}: BLOCKED (${err.reason}) at ${err.url}; recorded in directories.blocked, previous documents kept`);
        blocked = recordBlock(blocked, { org: adapter.key, url: err.url, reason: err.reason, detail: err.message }, opts.today);
        out.blocked.push(adapter.key);
      } else {
        out.failed.push(adapter.key);
        error(`  ${adapter.key}: FAILED: ${err instanceof Error ? err.message : String(err)} (previous documents kept)`);
      }
    }
  }
  if (handle) await writeBlockedDoc(handle, blocked);
  return out;
}
