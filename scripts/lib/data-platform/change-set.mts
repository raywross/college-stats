/**
 * A producer's change set (specs/data-platform/pipelines.md "Rules for every producer"): one per run. A workflow that
 * runs several scripts opens the set first with `scripts/data-change-set.mts open`, passes its id to each script as
 * `--change-set <id>`, and closes it at the end (`data-change-set.mts close`); a script run on its own opens and
 * closes its own. `replaceCollection` is how a producer that rebuilds a whole state file writes it: the new documents,
 * and a removal for every key the file no longer has.
 */
import type { ChangeSetHandle, DataStore } from "./store.mts";
import { flagValue } from "./store.mts";

/** The change sets' `source` names (brief, "Shared contracts"); the CLI refuses any other. */
export const CHANGE_SET_SOURCES = [
  "sync-data",
  "college-reported",
  "identity-refresh",
  "directories",
  "campus-pilot",
  "common-app",
  "coalition",
  "essay-prompts",
  "history",
  "high-schools",
  "hold-misread",
  "console",
] as const;
export type ChangeSetSource = (typeof CHANGE_SET_SOURCES)[number];

export const isChangeSetSource = (s: string): s is ChangeSetSource => (CHANGE_SET_SOURCES as readonly string[]).includes(s);

/** The run's reference: the GitHub Actions run id, or a local stamp. */
export function runRefFromEnv(env: Readonly<Record<string, string | undefined>> = process.env, now: () => Date = () => new Date()): string {
  return env.GITHUB_RUN_ID || `local-${now().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

/** A script's change set: attached (the workflow owns it, so the script never closes it) or its own. */
export interface RunSet {
  handle: ChangeSetHandle;
  /** True when this script opened the set and so closes it. */
  owned: boolean;
}

/**
 * `--change-set <id>` attaches to the workflow's open set; without it the script opens its own pipeline set with
 * `source` and the run's reference.
 */
export async function openRunSet(store: DataStore, opts: { source: ChangeSetSource; changeSet?: string | number | null; runRef?: string; summary?: object }): Promise<RunSet> {
  if (opts.changeSet !== undefined && opts.changeSet !== null && opts.changeSet !== "") {
    const id = Number(opts.changeSet);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`--change-set ${opts.changeSet}: expected a change set id`);
    return { handle: await store.attach(id), owned: false };
  }
  return { handle: await store.open("pipeline", opts.source, opts.runRef ?? runRefFromEnv(), opts.summary), owned: true };
}

/** Closes the set when the script owns it (an attached set is the workflow's to close). */
export async function finishRunSet(run: RunSet, status: "applied" | "held", heldReason?: string, summary?: object): Promise<void> {
  if (run.owned) await run.handle.close(status, heldReason, summary);
}

/**
 * Runs `write` inside the script's change set: closes its own set `applied` (or with the status `write` returns), or
 * `held` with the error's message when `write` throws (then rethrows). An attached set is left open for the workflow,
 * which closes it `held` when a step failed.
 */
export async function withRunSet<T>(
  store: DataStore,
  opts: {
    source: ChangeSetSource;
    changeSet?: string | number | null;
    runRef?: string;
    summary?: object;
    /** How an own set closes, from the result (default `applied`). */
    close?: (result: T) => { status: "applied" | "held"; reason?: string; summary?: object };
  },
  write: (handle: ChangeSetHandle) => Promise<T>
): Promise<T> {
  const run = await openRunSet(store, opts);
  let result: T;
  try {
    result = await write(run.handle);
  } catch (err) {
    await finishRunSet(run, "held", `stopped: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500)).catch(() => {});
    throw err;
  }
  const end = opts.close?.(result) ?? { status: "applied" as const };
  await finishRunSet(run, end.status, end.reason, end.summary);
  return result;
}

/** `--change-set` from argv. */
export const changeSetFlag = (argv: readonly string[]) => flagValue(argv, "--change-set");

/**
 * Writes `docs` as the whole of `collection` (unchanged documents write nothing) and removes every current key not
 * in it, except those `keep` returns true for. `currentKeys` saves the read when the caller already knows the keys. Returns
 * how many keys were removed.
 */
export async function replaceCollection(store: DataStore, handle: ChangeSetHandle, collection: string, docs: ReadonlyMap<string, unknown>, opts: { keep?: (key: string) => boolean; currentKeys?: Iterable<string> } = {}): Promise<number> {
  const current = opts.currentKeys ? [...new Set(opts.currentKeys)] : [...(await store.read<unknown>(collection)).keys()];
  if (docs.size) await handle.write(collection, [...docs].map(([key, body]) => ({ key, body })));
  const gone = current.filter((k) => !docs.has(k) && !opts.keep?.(k));
  if (gone.length) await handle.remove(collection, gone);
  return gone.length;
}
