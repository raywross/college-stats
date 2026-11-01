/**
 * A producer's run on the data store (specs/data-platform/pipelines.md "Rules for every producer",
 * change-sets.md "A run, start to finish"): the `--store` and `--change-set` flags, the run's change set (opened
 * here, or one a workflow's first step opened with scripts/data-change-set.mts and passed in), and the exit codes the
 * workflows read: 0 applied, 2 closed `held` (the breaker tripped), 3 stopped early. The workflow's tail sends the
 * `publish-snapshot` dispatch only on 0.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../../../lib/types";
import type { AliasRow } from "../../../lib/identity-files";
import { flagValue, storeFromFlag, type ChangeSetHandle, type DataStore, type Env } from "./store.mts";
import { COLLECTIONS, SINGLE_KEYS, datasetOrder, readLayer } from "./layers.mts";
import { readBundledColleges, readBundledJson } from "./bundled.mts";
import { BUNDLED_SNAPSHOT_DIR, SNAPSHOT_OBJECTS } from "../../../lib/data-platform/snapshot.ts";

/** Exit codes a producer ends with (the workflows skip the publish dispatch on HELD and STOPPED). */
export const EXIT = { applied: 0, failed: 1, held: 2, stopped: 3 } as const;

/** The run's reference: the workflow run id in Actions, else a local stamp (`local-2026-10-31T12:00:00Z`). */
export function runRef(env: Env = process.env, now: Date = new Date()): string {
  return env.GITHUB_RUN_ID || `local-${now.toISOString().replace(/\.\d+Z$/, "Z")}`;
}

/** `--store` from argv (see store.mts `storeFromFlag`; default supabase when DATA_SUPABASE_URL is set). */
export function storeFromArgv(argv: readonly string[], env: Env = process.env): DataStore {
  return storeFromFlag(flagValue(argv, "--store"), env, { log: (l) => console.log(l) });
}

/** `--change-set <id>`: a set the workflow opened, or undefined. */
export function changeSetFromArgv(argv: readonly string[]): number | undefined {
  const v = flagValue(argv, "--change-set");
  if (v === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(v)) throw new Error(`--change-set ${v}: expected a change set id`);
  return Number(v);
}

export interface ProducerRun {
  readonly handle: ChangeSetHandle;
  /** True when the set came from `--change-set` (whoever opened it closes it). */
  readonly attached: boolean;
  /**
   * Ends the run: closes the set `applied` or `held` (with the breaker's sentence and the run's summary) unless it
   * is attached, in which case the summary is left for the opener and the status is only the exit code.
   */
  finish(status: "applied" | "held", heldReason?: string, summary?: object): Promise<void>;
}

/** Opens the run's change set (kind `pipeline`), or attaches to `changeSet` when given. */
export async function openProducerRun(store: DataStore, source: string, opts: { runRef?: string; changeSet?: number; summary?: object } = {}): Promise<ProducerRun> {
  if (opts.changeSet !== undefined) {
    if (!store.attach) throw new Error("--change-set: this store can't attach to an open change set");
    const handle = await store.attach(opts.changeSet);
    return { handle, attached: true, finish: async () => {} };
  }
  const handle = await store.open("pipeline", source, opts.runRef ?? runRef(), opts.summary);
  return {
    handle,
    attached: false,
    finish: (status, heldReason, summary) => handle.close(status, heldReason, summary),
  };
}

/**
 * Writes `next` into the run's set where it differs from `before` (by orderedJson-style equality the store applies
 * anyway; skipping here saves sending unchanged documents), and removes keys in `before` that `next` lacks when
 * `mirror` is set. Returns how many documents were sent and removed.
 */
export async function writeChanged(
  handle: ChangeSetHandle,
  collection: string,
  before: ReadonlyMap<string, unknown>,
  next: ReadonlyMap<string, unknown>,
  opts: { mirror?: boolean } = {}
): Promise<{ sent: number; removed: number }> {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const docs = [...next].filter(([k, body]) => !before.has(k) || !same(before.get(k), body)).map(([key, body]) => ({ key, body }));
  if (docs.length) await handle.write(collection, docs);
  const stale = opts.mirror ? [...before.keys()].filter((k) => !next.has(k)) : [];
  if (stale.length) await handle.remove(collection, stale);
  return { sent: docs.length, removed: stale.length };
}

/**
 * The colleges a producer works over: the store's base layer (`base.colleges`, kept current by sync-data), in the
 * dataset's order. Only when the layer is empty (a fresh file store on a laptop) are the colleges read from the
 * bundled copy under `root` (`.data/snapshot/colleges.json`, what `npm run fetch-snapshot` wrote), with a line saying so.
 */
export async function datasetColleges(store: DataStore, root: string, log: (line: string) => void = (l) => console.log(l)): Promise<School[]> {
  const base = await readLayer<School>(store, COLLECTIONS.base.colleges);
  if (base.size) return datasetOrder([...base.values()]);
  log("  base.colleges is empty in this store; reading the colleges from the bundled copy (.data/snapshot/colleges.json)");
  return readBundledColleges(join(root, BUNDLED_SNAPSHOT_DIR));
}

/** The base layer's alias rows (`base.aliases`), or the bundled copy's aliases.json when the store has none (empty when neither has them). */
export async function datasetAliases(store: DataStore, root: string): Promise<AliasRow[]> {
  const rows = await store.readOne<AliasRow[]>(COLLECTIONS.base.aliases, SINGLE_KEYS.aliases);
  if (rows) return rows;
  const dir = join(root, BUNDLED_SNAPSHOT_DIR);
  return existsSync(join(dir, SNAPSHOT_OBJECTS.aliases)) ? readBundledJson<AliasRow[]>(SNAPSHOT_OBJECTS.aliases, dir) : [];
}
