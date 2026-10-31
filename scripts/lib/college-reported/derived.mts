/**
 * The two files derived from the college-reported state, on the data store: the failures list (`reported.failures`,
 * one document per college holding its rows, as scripts/import-data-from-git.mts groups data/college-failures.json)
 * and the compact health file (`health.colleges`, key `health`, data/college-health.json whole). The run derives both
 * before it closes its change set (scripts/sync-college-reported.mts); `npm run college-failures` and
 * `npm run college-health` derive them on their own from the store. The rules are the existing pure functions
 * (scripts/lib/college-failures.mts `buildFailuresFile`, lib/admin/health-files.ts `compactHealth`).
 */
import type { School } from "../../../lib/types";
import type { ReviewItem } from "../../../lib/reported.ts";
import type { CollegeRecord } from "../../../lib/cds-sections.ts";
import { compactHealth, formatCompact, newer, summarizeRecord, type CompactHealth, type FailureRowLite, type HealthSchool, type LinkIssueRowLite, type ManifestDocLite } from "../../../lib/admin/health-files.ts";
import { buildFailuresFile, type CollegeInfo, type FailureRow, type FailuresFile, type ManifestDoc } from "../college-failures.mts";
import { COLLECTIONS, SINGLE_KEYS, readLayer } from "../data-platform/layers.mts";
import type { ChangeSetHandle, DataStore } from "../data-platform/store.mts";
import type { Round3State } from "./phases.mts";

/** What the failures rules know of each college (from the composed dataset, as scripts/college-failures.mts read it). */
export function collegeInfos(schools: readonly School[]): Map<string, CollegeInfo> {
  return new Map(
    schools.map((s) => {
      const adm = s.admissions as (School["admissions"] & { federal?: { year?: number } }) | undefined;
      return [s.unit_id, { name: s.name, published: Boolean(s.reported), federal_year: adm?.federal?.year ?? adm?.year ?? null }];
    }),
  );
}

/** sha256 of every CDS-record document with at least one read. */
export function readShasOf(records: Iterable<CollegeRecord>): Set<string> {
  const out = new Set<string>();
  for (const rec of records) for (const d of rec.documents ?? []) if (Object.keys(d.reads ?? {}).length) out.add(d.sha256);
  return out;
}

type FailureInputs = Pick<Round3State, "sources" | "queue" | "manifest" | "records" | "blocked">;

/** The failures file for the state, keeping `first_seen` from the previous rows. */
export function deriveFailures(state: FailureInputs, colleges: ReadonlyMap<string, CollegeInfo>, previous: readonly FailureRow[], date: string): FailuresFile {
  return buildFailuresFile(
    {
      recipes: state.sources.recipes,
      queue: state.queue.items,
      docs: state.manifest.documents as unknown as ManifestDoc[],
      readShas: readShasOf(state.records.values()),
      blockedHosts: state.blocked.hosts,
      colleges,
    },
    previous.length ? { generated: "", counts: {}, rows: [...previous] } : null,
    date,
  );
}

/** `reported.failures` documents: each college's rows in the file's order (the import's grouping). */
export function failureDocuments(file: FailuresFile): Map<string, FailureRow[]> {
  const by = new Map<string, FailureRow[]>();
  for (const r of file.rows) by.set(r.unit_id, [...(by.get(r.unit_id) ?? []), r]);
  return by;
}

/** Every row of the `reported.failures` documents, in unit id order. */
export async function readFailureRows(store: DataStore): Promise<FailureRow[]> {
  return [...(await readLayer<FailureRow[]>(store, COLLECTIONS.reported.failures)).values()].flat();
}

/** Every row of `identity.link_issues` (one document per college holding its rows). */
export async function readLinkIssueRows(store: DataStore): Promise<LinkIssueRowLite[]> {
  return [...(await readLayer<LinkIssueRowLite[]>(store, COLLECTIONS.identity.linkIssues)).values()].flat();
}

/** The compact health for the state, the failures, the link issues, and the composed colleges. */
export function deriveHealth(input: {
  state: Pick<Round3State, "manifest" | "records" | "queue">;
  failures: FailuresFile;
  linkIssues: readonly LinkIssueRowLite[];
  schools: readonly HealthSchool[];
  metaRetrieved: string | null;
  generated?: string;
}): { compact: CompactHealth; text: string } {
  const queue = new Map<string, number>();
  // A resolved item (rejected or accepted in the console) no longer holds the college back.
  for (const item of input.state.queue.items as ReviewItem[]) if (!item.resolved) queue.set(item.unit_id, (queue.get(item.unit_id) ?? 0) + 1);
  const records = new Map([...input.state.records].map(([id, rec]) => [id, summarizeRecord(rec as Parameters<typeof summarizeRecord>[0])]));
  const generated =
    input.generated ?? [input.state.manifest.updated, input.failures.generated, input.state.queue.updated, input.metaRetrieved].reduce<string | null>((acc, d) => newer(acc, d || null), null);
  if (!generated) throw new Error("college-health: the sources carry no date; pass --date");
  const compact = compactHealth(
    {
      manifest: input.state.manifest.documents as unknown as ManifestDocLite[],
      records,
      failures: input.failures.rows as unknown as FailureRowLite[],
      queue,
      linkIssues: [...input.linkIssues],
    },
    input.schools,
    { metaRetrieved: input.metaRetrieved, generated },
  );
  return { compact, text: formatCompact(compact) };
}

/** The `health.colleges` document's key. */
export const HEALTH_KEY = SINGLE_KEYS.health;

/** Where derived documents go: a change set's handle, or the run's queued writer (scripts/lib/college-reported/state.mts). */
export interface DerivedSink {
  put(collection: string, docs: { key: string; body: unknown }[]): void | Promise<void>;
  drop(collection: string, keys: string[]): void | Promise<void>;
}

/**
 * Derives the failures list and the compact health from `state` and writes both: every college's `reported.failures`
 * document (removing those of colleges no longer listed) and `health.colleges`. The previous rows (for `first_seen`)
 * and the link issues come from the store. Returns what it wrote.
 */
export async function writeDerived(
  store: DataStore,
  sink: DerivedSink,
  state: FailureInputs,
  opts: { served: readonly School[]; metaRetrieved: string | null; today: string; generated?: string },
): Promise<{ failures: FailuresFile; health: CompactHealth }> {
  const previous = await readFailureRows(store);
  const failures = deriveFailures(state, collegeInfos(opts.served), previous, opts.today);
  const docs = failureDocuments(failures);
  await sink.put(COLLECTIONS.reported.failures, [...docs].map(([key, body]) => ({ key, body })));
  await sink.drop(COLLECTIONS.reported.failures, [...new Set(previous.map((r) => r.unit_id))].filter((id) => !docs.has(id)));
  const health = deriveHealth({ state, failures, linkIssues: await readLinkIssueRows(store), schools: opts.served, metaRetrieved: opts.metaRetrieved, generated: opts.generated });
  await sink.put(COLLECTIONS.health.colleges, [{ key: HEALTH_KEY, body: JSON.parse(health.text) }]);
  return { failures, health: health.compact };
}

/** A sink over a change set's handle (the standalone CLIs). */
export function handleSink(handle: ChangeSetHandle): DerivedSink {
  return {
    put: (collection, docs) => (docs.length ? handle.write(collection, docs) : undefined),
    drop: (collection, keys) => (keys.length ? handle.remove(collection, keys) : undefined),
  };
}
