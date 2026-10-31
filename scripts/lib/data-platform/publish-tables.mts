/**
 * The publisher's table step (specs/data-platform/publish.md step 6): after the pointer moves, the two groups of
 * tables the app reads that aren't in the snapshot are brought in line with it.
 *
 * - `college_data_failures`: upserted from the `reported.failures` layer (one document per college, each a list of
 *   rows, as scripts/import-data-from-git.mts keys it) with `loadCollegeFailures` (scripts/lib/publish-college-failures.mts):
 *   rows in the layer are upserted, open rows no longer in it are resolved. Every publish (a whole-file load is
 *   idempotent). An empty layer loads nothing, so a missing layer never resolves every open row.
 * - The high-school tables (`high_schools`, `high_school_details`, `high_school_files`): written with
 *   `publishHighSchools` (scripts/lib/publish-high-schools.mts) after the same file checks `check:lineage` runs, only
 *   when the high-school objects of this snapshot differ from what the tables last received. The comparison is a
 *   digest of the snapshot's `high-schools/*` object hashes, not the collections' max version: versions count per
 *   document, so a shard going from version 1 to 2 while another sits at 3 leaves the max unchanged. The digest the
 *   tables hold is carried from snapshot to snapshot in the ledger row's manifest (`tables.high_schools.tables_digest`),
 *   so a failed write is retried on the next publish; a snapshot from before this step falls back to its own objects.
 *
 * Neither step ever throws: the pointer has already moved, so a failure is logged in the row's manifest (`tables`,
 * beside the bucket manifest's fields) and the run goes on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SnapshotManifest } from "../../../lib/data-platform/snapshot.ts";
import type { HighSchoolDetail, HighSchoolMeta, HighSchoolShard, HighSchoolStateFile, StateMedians } from "../../../lib/high-school-types.ts";
import type { FailureRow } from "../college-failures.mts";
import { failuresTableProblem, loadCollegeFailures } from "../publish-college-failures.mts";
import { highSchoolFileProblems, highSchoolTablesProblem, publishHighSchools, type HighSchoolData } from "../publish-high-schools.mts";
import { sha256 } from "./render.mts";
import { COLLECTIONS } from "./layers.mts";

/** What one table step did. `skipped`: not configured or nothing to load; `unchanged`: the tables already match. */
export type TableStatus = "published" | "unchanged" | "skipped" | "failed";

export interface FailuresLog {
  status: TableStatus;
  upserted?: number;
  resolved?: number;
  message?: string;
}

export interface HighSchoolsLog {
  status: TableStatus;
  /** The digest of this snapshot's `high-schools/*` objects (null when it has none). */
  digest: string | null;
  /** The digest the tables hold after this step: this one when published or unchanged, else the previous one. */
  tables_digest: string | null;
  schools?: number;
  details?: number;
  removed?: number;
  message?: string;
}

/** The `tables` entry of a snapshot row's manifest. */
export interface TablesLog {
  college_data_failures: FailuresLog;
  high_schools: HighSchoolsLog;
}

/** A row manifest as the ledger stores it: the bucket manifest plus the table step's log. */
export type RecordedManifest = SnapshotManifest & { tables?: TablesLog };

const HIGH_SCHOOL_PREFIX = "high-schools/";

/** A digest over the `high-schools/*` objects' names and hashes, or null when there are none. */
export function highSchoolDigest(objects: Readonly<Record<string, { sha256: string }>> | undefined): string | null {
  const lines = Object.entries(objects ?? {})
    .filter(([name]) => name.startsWith(HIGH_SCHOOL_PREFIX))
    .map(([name, o]) => `${name} ${o.sha256}`)
    .sort();
  return lines.length ? sha256(Buffer.from(lines.join("\n"), "utf8")) : null;
}

/** The digest the high-school tables hold as of a previous snapshot's row manifest (null: unknown or never written). */
export function tablesDigestAfter(previous: Partial<RecordedManifest> | null): string | null {
  if (!previous) return null;
  if (previous.tables) return previous.tables.high_schools.tables_digest;
  return highSchoolDigest(previous.objects);
}

/** The composed `high_schools.*` collections as the files `readHighSchoolData` reads, or null when there are none. */
export function highSchoolDataFrom(collections: ReadonlyMap<string, ReadonlyMap<string, unknown>>): HighSchoolData | null {
  const get = (c: string) => collections.get(c) ?? new Map<string, unknown>();
  const shards = [...get(COLLECTIONS.highSchools.schools)].map(([key, shard]) => ({ file: `${key}.json`, shard: shard as HighSchoolShard }));
  const stateFiles = [...get(COLLECTIONS.highSchools.state)].map(([key, data]) => ({ file: `${key}.json`, data: data as HighSchoolStateFile }));
  const details = [...get(COLLECTIONS.highSchools.detail)].map(([key, data]) => ({ file: `${key}.json`, data: data as HighSchoolDetail }));
  const shared = get(COLLECTIONS.highSchools.shared);
  const meta = (shared.get("meta") as HighSchoolMeta | undefined) ?? null;
  const medians = (shared.get("medians") as StateMedians | undefined) ?? null;
  if (!meta && !shards.length && !stateFiles.length && !details.length) return null;
  return { meta, medians, shards, rows: shards.flatMap((s) => s.shard.schools), stateFiles, details };
}

/** The `reported.failures` layer's documents as one list of rows, in key order. */
export function failureRowsFrom(layer: ReadonlyMap<string, readonly FailureRow[]>): FailureRow[] {
  return [...layer.values()].flat();
}

export interface TablesInput {
  /** The composed colleges' unit ids (the high-school detail files' college links are checked against them). */
  collegeIds: ReadonlySet<string>;
  /** The composed `high_schools.*` collections. */
  highSchools: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  /** This snapshot's manifest (its objects give the digest). */
  manifest: SnapshotManifest;
  /** The previous published snapshot's row manifest, or null for a first publish. */
  previous: Partial<RecordedManifest> | null;
  /** The `reported.failures` layer, by unit id. */
  failures: ReadonlyMap<string, readonly FailureRow[]>;
}

/** The library calls the step makes (the real ones by default; tests pass fakes). */
export interface TablesDeps {
  failuresTableProblem: typeof failuresTableProblem;
  loadCollegeFailures: typeof loadCollegeFailures;
  highSchoolFileProblems: typeof highSchoolFileProblems;
  highSchoolTablesProblem: typeof highSchoolTablesProblem;
  publishHighSchools: typeof publishHighSchools;
}

const REAL: TablesDeps = { failuresTableProblem, loadCollegeFailures, highSchoolFileProblems, highSchoolTablesProblem, publishHighSchools };

export interface TablesOptions {
  /** Write the high-school tables even when the digest matches (`--republish-high-schools`). */
  forceHighSchools?: boolean;
  now?: string;
  log?: (line: string) => void;
  deps?: Partial<TablesDeps>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function loadFailures(client: SupabaseClient, input: TablesInput, opts: TablesOptions, d: TablesDeps, log: (line: string) => void): Promise<FailuresLog> {
  const rows = failureRowsFrom(input.failures);
  if (!input.failures.size) {
    log("college data failures: the reported.failures layer is empty; nothing loaded (open rows left as they are)");
    return { status: "skipped", message: "the reported.failures layer is empty" };
  }
  try {
    const problem = await d.failuresTableProblem(client);
    if (problem) {
      log(`college data failures: ${problem.missing ? "not loaded" : "failed"}: ${problem.message}`);
      return { status: problem.missing ? "skipped" : "failed", message: problem.message };
    }
    const r = await d.loadCollegeFailures(client, rows, { now: opts.now });
    log(`college data failures: upserted ${r.upserted} rows, resolved ${r.resolved}`);
    return { status: "published", upserted: r.upserted, resolved: r.resolved };
  } catch (err) {
    log(`college data failures: failed: ${message(err)}`);
    return { status: "failed", message: message(err) };
  }
}

async function loadHighSchools(client: SupabaseClient, input: TablesInput, opts: TablesOptions, d: TablesDeps, log: (line: string) => void): Promise<HighSchoolsLog> {
  const digest = highSchoolDigest(input.manifest.objects);
  const held = tablesDigestAfter(input.previous);
  const keep = (status: TableStatus, msg: string): HighSchoolsLog => ({ status, digest, tables_digest: held, message: msg });
  const data = highSchoolDataFrom(input.highSchools);
  if (!data || !digest) {
    log("high schools: no high_schools layer in this snapshot; tables left as they are");
    return keep("skipped", "no high_schools layer");
  }
  if (digest === held && !opts.forceHighSchools) {
    log("high schools: unchanged since the tables were last written; nothing to do");
    return { status: "unchanged", digest, tables_digest: digest };
  }
  const problems = d.highSchoolFileProblems(data, { collegeIds: input.collegeIds });
  if (problems.length) {
    log(`high schools: ${problems.length} file problem(s); tables not written:`);
    for (const p of problems.slice(0, 10)) log(`  ${p}`);
    return keep("failed", problems.slice(0, 10).join("\n"));
  }
  try {
    const problem = await d.highSchoolTablesProblem(client);
    if (problem) {
      // highSchoolTablesProblem names anything but a missing table "checking <table> failed".
      const failed = problem.startsWith("checking ");
      log(`high schools: ${failed ? "failed" : "not written"}: ${problem}`);
      return keep(failed ? "failed" : "skipped", problem);
    }
    const r = await d.publishHighSchools(client, data);
    log(`high schools: wrote ${r.schools} schools and ${r.details} profile details${r.removed ? ` (removed ${r.removed} old)` : ""}; read back and verified`);
    return { status: "published", digest, tables_digest: digest, schools: r.schools, details: r.details, removed: r.removed };
  } catch (err) {
    log(`high schools: failed: ${message(err)}`);
    return keep("failed", message(err));
  }
}

/** Both table steps, failures first. Never throws. */
export async function publishTables(client: SupabaseClient, input: TablesInput, opts: TablesOptions = {}): Promise<TablesLog> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const d: TablesDeps = { ...REAL, ...opts.deps };
  const college_data_failures = await loadFailures(client, input, opts, d, log);
  const high_schools = await loadHighSchools(client, input, opts, d, log);
  return { college_data_failures, high_schools };
}

/** The log of a run that wrote no tables (the file store, `--skip-tables`): the tables' digest carries over. */
export function skippedTables(input: Pick<TablesInput, "manifest" | "previous">, why: string): TablesLog {
  return {
    college_data_failures: { status: "skipped", message: why },
    high_schools: { status: "skipped", digest: highSchoolDigest(input.manifest.objects), tables_digest: tablesDigestAfter(input.previous), message: why },
  };
}
