/**
 * The college-reported pipeline's state on the data store (specs/data-platform/pipelines.md, "Each producer"): what
 * the CLI (scripts/sync-college-reported.mts) used to read from and write to data/college-*.json,
 * data/review-queue.json, data/cds-records/ and data/reports/, now the `reported.*` layers, keyed exactly as
 * scripts/import-data-from-git.mts keys them so an import and a run agree:
 *
 *   reported.entries       unit id      a ReportedEntry (data/college-reported.json)
 *   reported.sources       unit id      a Recipe (data/college-sources.json)
 *   reported.docs          sha256       a manifest entry (data/college-docs.json)
 *   reported.batches       batch id     an open Message Batch (data/college-batches.json)
 *   reported.review_queue  reviewKey    a ReviewItem (data/review-queue.json)
 *   reported.cds_records   unit id      a CollegeRecord (data/cds-records/<unit>.json), in serializeRecord's order
 *   reported.failures      unit id      the college's failure rows (data/college-failures.json), in file order
 *   reported.reports       file name    the run summary (parsed JSON) and the calls log ({text})
 *   reference.files        blocked-hosts, cds-urls, college-reported-pilot (data/reference/<name>.json)
 *   import.headers         file name    each file's top-level fields (`updated`, …): read here, never written
 *
 * `StateWriter` writes after every college as the files were: it compares each document with what it last wrote and
 * sends only the changed ones (removing the documents that left the state) into the run's one change set. The CDS
 * records are compared only for the colleges the pipeline marked dirty, as the CLI wrote only those files.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewKey, type BatchEntry, type BlockedHostsFile, type CallLog, type CdsUrlEntry, type CdsUrlsFile, type Recipe, type ReportedEntry, type ReviewItem, type RunSummary, type RunSummaryV3 } from "../../../lib/reported.ts";
import type { CollegeRecord, ManifestEntry } from "../../../lib/cds-sections.ts";
import type { DatasetMeta, School } from "../../../lib/types";
import { federalYears } from "../../../lib/newest-groups.ts";
import { prBody } from "../../college-reported-pr-body.mts";
import { COLLECTIONS, readLayer, type TextDocument } from "../data-platform/layers.mts";
import type { ChangeSetHandle, DataStore } from "../data-platform/store.mts";
import { serializeRecord } from "./records.mts";
import { emptySummaryV3, memoryCallLogWriter, roundUsd, summaryCost, type CallLogWriter } from "./models.mts";
import { writeDerived } from "./derived.mts";
import type { Round3State } from "./phases.mts";

/** The change set's `source` for a run (shared contracts). */
export const REPORTED_SOURCE = "college-reported";

/** The reference documents the pipeline reads (and, for blocked hosts, writes): keys of `reference.files`. */
export const REFERENCE_KEYS = { blocked: "blocked-hosts", manual: "cds-urls", pilot: "college-reported-pilot" } as const;

/** The import's header keys (the file names under data/). */
export const HEADER_KEYS = {
  reported: "college-reported.json",
  sources: "college-sources.json",
  docs: "college-docs.json",
  batches: "college-batches.json",
  queue: "review-queue.json",
  failures: "college-failures.json",
} as const;

/** data/reports/college-reported-run-<run>.json's name (colons in an ISO run id become dashes), the `reported.reports` key. */
export const summaryKey = (run: string) => `college-reported-run-${run.replace(/[:]/g, "-")}.json`;
/** data/reports/college-reported-calls-<run>.jsonl's name, the `reported.reports` key of the calls log. */
export const callsKey = (run: string) => `college-reported-calls-${run.replace(/[:]/g, "-")}.jsonl`;

/** A record as the import stores it: the parsed text of data/cds-records/<unit>.json (fixed key and document order). */
export const recordBody = (record: CollegeRecord): CollegeRecord => JSON.parse(serializeRecord(record)) as CollegeRecord;

type Header = { updated?: string | null };

/** The pipeline's state from the store; the summary is the caller's (a new run's, or the prior one a collect continues). */
export async function loadReportedState(store: DataStore, summary: Round3State["summary"]): Promise<Round3State> {
  const values = <T,>(m: Map<string, T>) => [...m.values()];
  const header = async (key: string) => (await store.readOne<Header>(COLLECTIONS.import.headers, key)) ?? {};
  const [reportedH, sourcesH, docsH, batchesH, queueH] = await Promise.all([HEADER_KEYS.reported, HEADER_KEYS.sources, HEADER_KEYS.docs, HEADER_KEYS.batches, HEADER_KEYS.queue].map(header));
  const blocked = await store.readOne<BlockedHostsFile>(COLLECTIONS.reference.files, REFERENCE_KEYS.blocked);
  const manual = await store.readOne<CdsUrlsFile>(COLLECTIONS.reference.files, REFERENCE_KEYS.manual);
  return {
    sources: { updated: sourcesH.updated ?? "", recipes: values(await readLayer<Recipe>(store, COLLECTIONS.reported.sources)) },
    reported: { updated: reportedH.updated ?? null, entries: values(await readLayer<ReportedEntry>(store, COLLECTIONS.reported.entries)) },
    queue: { updated: queueH.updated ?? "", items: values(await readLayer<ReviewItem>(store, COLLECTIONS.reported.reviewQueue)) },
    manifest: { updated: docsH.updated ?? null, documents: values(await readLayer<ManifestEntry>(store, COLLECTIONS.reported.docs)) },
    records: await readLayer<CollegeRecord>(store, COLLECTIONS.reported.cdsRecords),
    batches: { updated: batchesH.updated ?? null, batches: values(await readLayer<BatchEntry>(store, COLLECTIONS.reported.batches)) },
    blocked: blocked ?? { hosts: [] },
    manual: manual?.entries ?? ([] as CdsUrlEntry[]),
    summary,
    dirty: new Set(),
  };
}

/** A run summary written earlier for `run` (the collect job continues it), or null. */
export async function readRunSummary<T extends RunSummary>(store: DataStore, run: string): Promise<T | null> {
  return store.readOne<T>(COLLECTIONS.reported.reports, summaryKey(run));
}

/** The run of the oldest open batch, or null when none is open (the collect job's "anything to collect?"). */
export async function oldestOpenRun(store: DataStore): Promise<string | null> {
  const batches = [...(await readLayer<BatchEntry>(store, COLLECTIONS.reported.batches)).values()];
  batches.sort((a, b) => a.submitted.localeCompare(b.submitted) || a.id.localeCompare(b.id));
  return batches[0]?.run ?? null;
}

/** The state's documents per collection, keyed as the import keys them (records only for `recordIds`). */
export function stateDocuments(s: Round3State, recordIds: Iterable<string>): Map<string, Map<string, unknown>> {
  const by = <T,>(rows: readonly T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r), r as unknown]));
  const records = new Map<string, unknown>();
  for (const id of recordIds) {
    const rec = s.records.get(id);
    if (rec) records.set(id, recordBody(rec));
  }
  return new Map<string, Map<string, unknown>>([
    [COLLECTIONS.reported.sources, by(s.sources.recipes, (r) => r.unit_id)],
    [COLLECTIONS.reported.entries, by(s.reported.entries, (e) => e.unit_id)],
    [COLLECTIONS.reported.reviewQueue, by(s.queue.items, reviewKey)],
    [COLLECTIONS.reported.docs, by(s.manifest.documents, (d) => d.sha256)],
    [COLLECTIONS.reported.batches, by(s.batches.batches, (b) => b.id)],
    [COLLECTIONS.reported.cdsRecords, records],
    [COLLECTIONS.reference.files, new Map([[REFERENCE_KEYS.blocked, s.blocked as unknown]])],
  ]);
}

/** Collections whose every document is in `stateDocuments` (so a key missing from the state is a removal). */
const WHOLE = new Set<string>([COLLECTIONS.reported.sources, COLLECTIONS.reported.entries, COLLECTIONS.reported.reviewQueue, COLLECTIONS.reported.docs, COLLECTIONS.reported.batches]);

/**
 * Writes the state into one change set, document by document, after every college. `save(state)` is synchronous (the
 * pipeline's `onProgress` is): it works out what changed at that moment and queues the writes in order; `flush()`
 * waits for them and rethrows the first failure.
 */
export class StateWriter {
  private last = new Map<string, Map<string, string>>();
  private chain: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  /** Documents sent so far (changed or removed), for the log. */
  written = 0;

  private readonly handle: ChangeSetHandle;

  constructor(handle: ChangeSetHandle, initial: Round3State) {
    this.handle = handle;
    for (const [c, docs] of stateDocuments(initial, initial.records.keys())) this.last.set(c, new Map([...docs].map(([k, v]) => [k, JSON.stringify(v)])));
  }

  /** Queues the documents that changed since the last save (and the removals); clears `state.dirty`. */
  save(state: Round3State): void {
    const docs = stateDocuments(state, state.dirty);
    state.dirty.clear();
    for (const [c, now] of docs) {
      const before = this.last.get(c) ?? this.last.set(c, new Map()).get(c)!;
      const writes: { key: string; body: unknown }[] = [];
      for (const [key, body] of now) {
        const text = JSON.stringify(body);
        if (before.get(key) === text) continue;
        before.set(key, text);
        writes.push({ key, body: JSON.parse(text) });
      }
      const removed = WHOLE.has(c) ? [...before.keys()].filter((k) => !now.has(k)) : [];
      for (const k of removed) before.delete(k);
      if (writes.length) this.enqueue(() => this.handle.write(c, writes), writes.length);
      if (removed.length) this.enqueue(() => this.handle.remove(c, removed), removed.length);
    }
  }

  /** Queues one write of a document outside the state (a report, the derived failures and health). */
  put(collection: string, docs: { key: string; body: unknown }[]): void {
    if (docs.length) this.enqueue(() => this.handle.write(collection, docs), docs.length);
  }

  /** Queues removals of documents outside the state. */
  drop(collection: string, keys: string[]): void {
    if (keys.length) this.enqueue(() => this.handle.remove(collection, keys), keys.length);
  }

  private enqueue(run: () => Promise<void>, n: number) {
    this.chain = this.chain.then(async () => {
      if (this.failure) return;
      try {
        await run();
        this.written += n;
      } catch (err) {
        this.failure = err;
      }
    });
  }

  /** Waits for every queued write; throws the first failure. */
  async flush(): Promise<void> {
    await this.chain;
    if (this.failure) throw this.failure;
  }
}

/* ------------------------------------------------------------------ */
/* The colleges and the federal graduation year                        */
/* ------------------------------------------------------------------ */

/**
 * The composed colleges as the site serves them: the bundled snapshot (`.data/snapshot/colleges.json`, written by
 * fetch-snapshot) when present, else the committed data/schools.json (in git until phase 4). Only the publisher
 * composes, so a producer reads the served copy rather than building one.
 */
export function collegesFile(root: string): string {
  const bundled = join(root, ".data", "snapshot", "colleges.json");
  return existsSync(bundled) ? bundled : join(root, "data", "schools.json");
}

export function readColleges(root: string, file: string = collegesFile(root)): School[] {
  return JSON.parse(readFileSync(file, "utf8")) as School[];
}

/** `base.meta` from the store, else data/meta.json, else null (the federal years the checks use). */
export async function readMeta(store: DataStore, root: string): Promise<Pick<DatasetMeta, "vintages" | "retrieved"> | null> {
  const fromStore = await store.readOne<DatasetMeta>(COLLECTIONS.base.meta, "meta");
  if (fromStore) return fromStore;
  const file = join(root, "data", "meta.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as DatasetMeta) : null;
}

/** The calls log as a `reported.reports` document: the prior text (a collect continues it) plus this process's rows. */
export function callsDocument(prior: TextDocument | null, rows: readonly unknown[]): TextDocument {
  return { text: `${prior?.text ?? ""}${rows.map((r) => `${JSON.stringify(r)}\n`).join("")}` };
}

/* ------------------------------------------------------------------ */
/* A run on the store                                                  */
/* ------------------------------------------------------------------ */

/** The run's change set: the open one with this run_ref (a later phase of the same run, the collect job), else a new one. */
export async function runChangeSet(store: DataStore, run: string, log: (line: string) => void = () => {}): Promise<ChangeSetHandle> {
  const open = await store.findOpen(REPORTED_SOURCE, run);
  if (open !== null) {
    log(`Continuing change set ${open} (run ${run}).`);
    return store.attach(open);
  }
  const handle = await store.open("pipeline", REPORTED_SOURCE, run);
  log(`Opened change set ${handle.id} (run ${run}).`);
  return handle;
}

/** The change set's summary: the counts and cost a reviewer scans, plus the PR body's text (scripts/college-reported-pr-body.mts). */
export function changeSetSummary(state: Round3State, names: ReadonlyMap<string, string>): Record<string, unknown> {
  const s = state.summary;
  return {
    run: s.run,
    status: s.status,
    attempted: s.attempted,
    documents_read: s.documents_read,
    published: s.published,
    changed: s.changed,
    failed: s.failed,
    unreachable: s.unreachable ?? 0,
    discovered: s.discovered,
    escalated: s.escalated,
    open_batches: state.batches.batches.length,
    cost_usd: roundUsd(summaryCost(s)),
    body: prBody(s, state.queue, state.reported, new Map(names)),
  };
}

/** How a run's change set ended: closed applied or held, or left open for the collect job (batches still open). */
export type RunStatus = "applied" | "held" | "open";

export interface ReportedRun {
  state: Round3State;
  /** null on a dry run (nothing is opened or written). */
  handle: ChangeSetHandle | null;
  /** The federal graduation class's entering fall, for the checks (`Round3Options.gradYear`). */
  gradYear: number | null;
  /** The pipeline's call log (`Round3Deps.callLog`): kept in memory, written as the run's calls document. */
  callLog: CallLogWriter & { rows: CallLog[] };
  /** The pipeline's `onProgress`: writes what changed into the change set. */
  save(state: Round3State): void;
  /**
   * The last save (state, summary, calls log, the derived failures and health), then the set closes: `held` with the
   * reason for exit 1, 2 or 3; `applied` for 0 with no batch open; left open for 0 with batches open. Runs once.
   */
  finish(exit: 0 | 1 | 2 | 3, reason?: string | null): Promise<RunStatus | null>;
}

/**
 * Loads a run's state from the store and opens (or continues) its change set: what scripts/sync-college-reported.mts
 * wraps around `createRound3(...).run`, and what the tests drive with fakes.
 */
export async function openReportedRun(
  store: DataStore,
  opts: { run: string; root: string; served: readonly School[]; dry?: boolean; today?: () => string; log?: (line: string) => void },
): Promise<ReportedRun> {
  const log = opts.log ?? (() => {});
  const today = opts.today ?? (() => new Date().toISOString().slice(0, 10));
  // A later phase of the same run (the collect job) continues its summary and its calls log.
  const prior = await readRunSummary<RunSummaryV3>(store, opts.run);
  const summary: RunSummaryV3 = prior?.round === 3 ? { ...prior, status: "running", finished: null } : emptySummaryV3(opts.run, new Date().toISOString());
  delete summary.stopped_reason;
  const state = await loadReportedState(store, summary);
  const meta = await readMeta(store, opts.root);
  const priorCalls = await store.readOne<TextDocument>(COLLECTIONS.reported.reports, callsKey(opts.run));
  const handle = opts.dry ? null : await runChangeSet(store, opts.run, log);
  const writer = handle ? new StateWriter(handle, state) : null;
  const callLog = memoryCallLogWriter();
  const save = (s: Round3State) => {
    if (!writer) return;
    writer.save(s);
    writer.put(COLLECTIONS.reported.reports, [{ key: summaryKey(opts.run), body: s.summary }]);
  };
  let done = false;
  return {
    state,
    handle,
    gradYear: federalYears({ vintages: meta?.vintages ?? {} } as Pick<DatasetMeta, "vintages">).graduation,
    callLog,
    save,
    async finish(exit, reason = null) {
      if (done || !writer || !handle) return null;
      done = true;
      save(state);
      writer.put(COLLECTIONS.reported.reports, [{ key: callsKey(opts.run), body: callsDocument(priorCalls, callLog.rows) }]);
      try {
        await writeDerived(store, writer, state, { served: opts.served, metaRetrieved: meta?.retrieved ?? null, today: today() });
      } catch (err) {
        log(`Deriving the failures list and health failed (the state is still written): ${err instanceof Error ? err.message : err}`);
      }
      await writer.flush();
      const closeSummary = changeSetSummary(state, new Map(opts.served.map((s) => [s.unit_id, s.name])));
      if (exit !== 0) {
        await handle.close("held", reason ?? `exit ${exit}`, closeSummary);
        log(`Change set ${handle.id} closed held: ${reason ?? `exit ${exit}`}`);
        return "held";
      }
      if (state.batches.batches.length) {
        log(`Change set ${handle.id} stays open: ${state.batches.batches.length} batch(es) still open; the collect job (or --phase collect --run ${opts.run}) finishes them.`);
        return "open";
      }
      await handle.close("applied", undefined, closeSummary);
      log(`Change set ${handle.id} closed applied (${writer.written} documents written by this process).`);
      return "applied";
    },
  };
}
