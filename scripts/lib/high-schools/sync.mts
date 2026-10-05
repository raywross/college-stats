/**
 * The two high school syncs as functions (the CLIs in scripts/sync-high-schools.mts and scripts/sync-hs-states.mts
 * parse flags and call these; tests call them with fake adapters and a temporary directory).
 */
import type { HighSchool, HighSchoolStateFile } from "../../../lib/high-school-types.ts";
import { computeStateMedians, validateHighSchoolMeta, validateHighSchoolRow, validateStateFile } from "../../../lib/high-school-core.ts";
import { readAllShards, readHsMeta, readStateFiles } from "../../../lib/high-school-store.ts";
import { createAdapterContext, type ContextOptions } from "./context.mts";
import { applyAdapterResults, mergeMeta, type AdapterRun, type MergeReport } from "./merge.mts";
import type { HighSchoolAdapter, StateAdapter } from "./types.mts";
import { writeMedians, writeMeta, writeShards, writeStateFile } from "./write.mts";

export class SyncError extends Error {
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(message);
    this.problems = problems;
  }
}

/** Refuse to drop more than this share of a kind's rows in one run unless allowShrink. */
export const SHRINK_LIMIT = 0.1;

export interface HighSchoolSyncOptions extends Omit<ContextOptions, "existing"> {
  adapters: readonly HighSchoolAdapter[];
  /** Adapter keys to run (`--only ccd,pss`); default every adapter. */
  only?: readonly string[];
  dryRun?: boolean;
  allowShrink?: boolean;
}

export interface HighSchoolSyncResult {
  rows: HighSchool[];
  report: MergeReport[];
  notes: string[];
  written: boolean;
}

function existingRows(dir: string): HighSchool[] {
  return readAllShards(dir).flatMap(({ shard }) => shard.schools);
}

export async function runHighSchoolSync(opts: HighSchoolSyncOptions): Promise<HighSchoolSyncResult> {
  const known = new Set(opts.adapters.map((a) => a.info.key));
  const unknown = (opts.only ?? []).filter((k) => !known.has(k as never));
  if (unknown.length) throw new SyncError(`unknown adapter(s): ${unknown.join(", ")} (known: ${[...known].join(", ")})`);
  const selected = opts.only?.length ? opts.adapters.filter((a) => opts.only!.includes(a.info.key)) : [...opts.adapters];

  const existing = existingRows(opts.outDir);
  const ctx = createAdapterContext({ ...opts, existing: new Map(existing.map((r) => [r.id, r])) });
  const runs: AdapterRun[] = [];
  for (const a of selected) {
    ctx.log(`${a.info.key}: loading`);
    runs.push({ info: a.info, result: await a.load(ctx) });
  }

  const { rows, report } = applyAdapterResults(existing, runs);
  const problems = rows.flatMap(validateHighSchoolRow);
  if (problems.length) throw new SyncError(`${problems.length} invalid row(s); nothing written`, problems);

  // Shrink guard, per kind (a broken download most likely).
  for (const kind of ["public", "private"] as const) {
    const before = existing.filter((r) => r.kind === kind).length;
    const after = rows.filter((r) => r.kind === kind).length;
    if (before && after < before * (1 - SHRINK_LIMIT) && !opts.allowShrink) {
      throw new SyncError(`would drop ${kind} high schools from ${before} to ${after}; check the source files, or pass --allow-shrink`);
    }
  }

  const meta = mergeMeta(readHsMeta(opts.outDir), runs, rows, ctx.today);
  const metaProblems = validateHighSchoolMeta(meta, rows);
  if (metaProblems.length) throw new SyncError(`meta.json would be invalid; nothing written`, metaProblems);

  const notes = runs.flatMap((r) => r.result.notes ?? []);
  if (opts.dryRun) return { rows, report, notes, written: false };
  const stateFiles = readStateFiles(opts.outDir).map((f) => f.data);
  writeShards(opts.outDir, rows);
  writeMeta(opts.outDir, meta);
  writeMedians(opts.outDir, computeStateMedians(rows, stateFiles));
  return { rows, report, notes, written: true };
}

export interface StateSyncOptions extends Omit<ContextOptions, "existing"> {
  adapter: StateAdapter;
  dryRun?: boolean;
}

/**
 * One state's report card file: run its adapter, move schools that aren't in the state's shard to `unmatched`,
 * validate, write state/{xx}.json, add the state's source to meta.json (when there is one), and recompute medians.
 */
export async function runStateSync(opts: StateSyncOptions): Promise<{ file: HighSchoolStateFile; written: boolean }> {
  const { adapter } = opts;
  if (!adapter.built) throw new SyncError(`${adapter.state} state adapter isn't built yet`);
  const all = existingRows(opts.outDir);
  const rows = all.filter((r) => r.state === adapter.state && r.kind === "public");
  const crosswalk = new Map(rows.filter((r) => r.state_school_id).map((r) => [r.state_school_id!, r.id]));
  const result = await adapter.load({ ...createAdapterContext(opts), state: adapter.state, rows, crosswalk });

  const file: HighSchoolStateFile = { state: adapter.state, sections: result.sections, schools: { ...result.schools }, unmatched: [...(result.unmatched ?? [])] };
  if (rows.length) {
    const ids = new Set(rows.map((r) => r.id));
    for (const id of Object.keys(file.schools)) {
      if (ids.has(id)) continue;
      delete file.schools[id];
      file.unmatched!.push({ stateId: id, name: "", ncessch: id, reason: `not a high school in schools/${adapter.state}.json` });
    }
  }
  if (!file.unmatched!.length) delete file.unmatched;
  const problems = validateStateFile(file, rows.length ? { ids: new Set(rows.map((r) => r.id)) } : {});
  if (problems.length) throw new SyncError(`${adapter.state} state file would be invalid; nothing written`, problems);
  if (opts.dryRun) return { file, written: false };

  writeStateFile(opts.outDir, file);
  const meta = readHsMeta(opts.outDir);
  if (meta) {
    const retrieved = file.sections.map((s) => s.retrieved).sort().at(-1)!;
    meta.sources = Object.fromEntries(
      Object.entries({ ...meta.sources, [adapter.source]: { name: adapter.name, publisher: adapter.publisher, url: adapter.url, retrieved } }).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeMeta(opts.outDir, meta);
  }
  if (all.length) writeMedians(opts.outDir, computeStateMedians(all, readStateFiles(opts.outDir).map((f) => f.data)));
  return { file, written: true };
}
