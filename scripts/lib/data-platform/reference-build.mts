/**
 * One document a build script makes, written through the data store (specs/data-platform/pipelines.md "Rules for
 * every producer"): the reference builds (`build-cip`, `build-cds-template`, `build-zcta`,
 * `selectivity-method-sample`) write their `reference.files` document, and `source-files` its `base.source_files`
 * document, each in one change set (kind pipeline) with `--store supabase|file:<dir>` (default supabase when
 * DATA_SUPABASE_URL is set), `--change-set <id>` to write into a set a workflow opened, and `--dry-run` to write
 * nothing. A body equal to the stored one writes no version (the store compares), so a re-run with no news is an empty
 * change set the publisher skips. The publisher renders the document into the next snapshot.
 */
import { COLLECTIONS } from "./layers.mts";
import { flagValue, orderedJson } from "./store.mts";
import { changeSetFromArgv, openProducerRun, storeFromArgv } from "./producer.mts";

/** The change set's source for the reference builds. */
export const REFERENCE_BUILD_SOURCE = "reference-build";

export interface DocumentRun {
  collection: string;
  key: string;
  body: unknown;
  /** The change set's source (default `reference-build`). */
  source?: string;
  argv?: readonly string[];
  log?: (line: string) => void;
}

/** Writes `body` at `collection/key` per the argv's `--store`, `--change-set`, `--dry-run`; returns whether it changed. */
export async function writeDocumentRun(run: DocumentRun): Promise<boolean> {
  const argv = run.argv ?? process.argv.slice(2);
  const log = run.log ?? ((l: string) => console.log(l));
  const store = storeFromArgv(argv);
  const before = await store.readOne<unknown>(run.collection, run.key);
  const changed = before === null || orderedJson(before) !== orderedJson(run.body);
  if (argv.includes("--dry-run")) {
    log(`--dry-run: ${run.collection}/${run.key} ${changed ? "would change" : "is unchanged"}; nothing written`);
    return changed;
  }
  const source = run.source ?? REFERENCE_BUILD_SOURCE;
  const producer = await openProducerRun(store, source, { changeSet: changeSetFromArgv(argv), runRef: flagValue(argv, "--run-ref") });
  await producer.handle.write(run.collection, [{ key: run.key, body: run.body }]);
  await producer.finish("applied", undefined, { document: `${run.collection}/${run.key}`, changed });
  log(`${run.collection}/${run.key}: ${changed ? "written" : "unchanged"} (change set ${producer.handle.id}${producer.attached ? ", the workflow's" : ""})`);
  return changed;
}

/** `writeDocumentRun` for a `reference.files` document. */
export function writeReferenceDocument(name: string, body: unknown, opts: Omit<DocumentRun, "collection" | "key" | "body"> = {}): Promise<boolean> {
  return writeDocumentRun({ collection: COLLECTIONS.reference.files, key: name, body, ...opts });
}
