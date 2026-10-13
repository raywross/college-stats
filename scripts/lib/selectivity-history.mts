/**
 * Quad's selectivity history (specs/chances/selectivity-history.md): which rows a publish records, and what each row
 * carries. Pure: the publish and backfill scripts read the commits and the table, and this decides.
 *
 * Every change is recorded (owner, 2026-10-13: "we should track everything"; Decision 2). A row is written for a
 * college and pool when anything differs from that pool's last recorded row: the score at its two stored decimals,
 * the rank, the tier, the tier's admissions year, the top-of-Ultra band, the hysteresis hold, or any input; when the
 * pool is new (`new_pool`) or lost its rating (`unrated`, score and tier null); and for every rated college and pool
 * when the method changed (`method`, so a method change never reads as a college moving). There is no threshold: the
 * console hides moves under DISPLAY_MOVE_MIN by default, as a display filter.
 */
import type { DatasetMeta, School } from "../../lib/types";
import type { SelectivityTier } from "../../lib/chances/types.ts";
import type { FieldPath } from "../../lib/fields.ts";
import { lineageFor } from "../../lib/lineage.ts";
import { SELECTIVITY_METHOD, rawInputs, selectivityTier } from "../../lib/selectivity.ts";
import type { SelectivityIndexFile } from "./selectivity.mts";

export const HISTORY_POOLS = ["all", "in_state", "out_of_state"] as const;
export type HistoryPool = (typeof HISTORY_POOLS)[number];


export type RowCause = "data" | "method" | "backfill" | "new_pool" | "unrated";
export type RunCause = "data" | "method" | "backfill";

/** The last recorded row for a college and pool (selectivity_latest_rows()). */
export interface Recorded {
  unit_id: string;
  pool: HistoryPool;
  score: number | null;
  rank: number | null;
  tier: string | null;
  tier_year: string | null;
  band: string | null;
  held: boolean;
  inputs: Record<string, InputValue>;
}

export interface InputValue {
  v: number | null;
  year: string | null;
  source: string | null;
  imputed?: boolean;
}

export interface HistoryRow {
  unit_id: string;
  pool: HistoryPool;
  score: number | null;
  rank: number | null;
  tier: SelectivityTier | null;
  tier_year: string | null;
  band: string | null;
  held: boolean;
  cause: RowCause;
  inputs: Record<string, InputValue>;
}

export interface HistoryRun {
  git_commit: string;
  published_at: string;
  method: string;
  elite_index: number;
  counts: Record<string, number>;
  elite_any_pool: number;
  rated: number;
  cause: RunCause;
  publish_id?: number | null;
}

/** One commit's selectivity: the index file, the colleges (with `selectivity`), and the dataset's meta. */
export interface SelectivityAt {
  index: SelectivityIndexFile;
  schools: readonly School[];
  meta: DatasetMeta;
  /** The method string the commit was built with (the index file's `method`, or the backfill's map). */
  method: string;
}

const key = (unit: string, pool: string) => `${unit}|${pool}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The field each input is dated by, per pool (the admit rate differs by pool). */
const INPUT_PATHS: Record<string, (pool: HistoryPool) => FieldPath> = {
  admit_rate: (pool) => (pool === "in_state" ? "derived.admit_rate_in_state" : pool === "out_of_state" ? "derived.admit_rate_out_of_state" : "admissions.acceptance_rate") as FieldPath,
  sat_p75: () => "admissions.sat_math_25_75" as FieldPath,
  yield: () => "admissions.admitted" as FieldPath,
  retention: () => "outcomes.retention_rate" as FieldPath,
  graduation: () => "outcomes.graduation_rate" as FieldPath,
};

/** The raw values the score read for this pool, each with its year and source kind (no weights, no percentiles). */
export function inputsFor(school: School, pool: HistoryPool, meta: DatasetMeta): Record<string, InputValue> {
  const raw = rawInputs(school);
  const values: Record<string, number | null> = {
    admit_rate: pool === "in_state" ? raw.inStateRate : pool === "out_of_state" ? raw.outOfStateRate : raw.admitRate,
    sat_p75: raw.sat75,
    yield: raw.yield,
    retention: raw.retention,
    graduation: raw.graduation,
  };
  const out: Record<string, InputValue> = {};
  for (const [name, v] of Object.entries(values)) {
    let year: string | null = null;
    let source: string | null = null;
    if (v !== null) {
      try {
        const c = lineageFor(INPUT_PATHS[name](pool), school, meta);
        year = c.year;
        source = c.key;
      } catch {
        // A path an older dataset didn't register: the value stands without its year.
      }
    }
    out[name] = { v: v === null ? null : Math.round(v * 10000) / 10000, year, source, ...(name === "sat_p75" && v === null ? { imputed: true } : {}) };
  }
  return out;
}

/** Whether anything recorded differs: score (two decimals), rank, tier, year, band, hold, or an input. */
function differsFrom(last: Recorded, row: HistoryRow): boolean {
  return (
    round2(Number(last.score)) !== row.score ||
    (last.rank ?? null) !== row.rank ||
    last.tier !== row.tier ||
    last.tier_year !== row.tier_year ||
    last.band !== row.band ||
    Boolean(last.held) !== row.held ||
    JSON.stringify(sortKeys(last.inputs ?? {})) !== JSON.stringify(sortKeys(row.inputs))
  );
}

/** Inputs compared key by key, whatever order the database returned them in. */
function sortKeys(inputs: Record<string, InputValue>): [string, InputValue][] {
  return Object.keys(inputs)
    .sort()
    .map((k) => {
      const v = inputs[k];
      return [k, { v: v.v ?? null, year: v.year ?? null, source: v.source ?? null, ...(v.imputed ? { imputed: true } : {}) }];
    });
}

const tierOf = (school: School, pool: HistoryPool): SelectivityTier | null =>
  ((pool === "all" ? school.selectivity?.tier : school.selectivity?.[pool]) ?? null) as SelectivityTier | null;

/**
 * The rows a publish records. `prev`: the last recorded row per college and pool; `lastMethod`: the method of the last
 * recorded run (null before the first). `backfill` marks every row `backfill` (the rules still decide which rows).
 */
export function historyRows(prev: ReadonlyMap<string, Recorded>, next: SelectivityAt, opts: { lastMethod: string | null; backfill?: boolean }): HistoryRow[] {
  const methodChanged = opts.lastMethod !== null && opts.lastMethod !== next.method;
  const rows: HistoryRow[] = [];
  const seen = new Set<string>();
  for (const school of next.schools) {
    const entry = next.index.colleges[school.unit_id];
    if (!entry) continue;
    for (const pool of HISTORY_POOLS) {
      const score = pool === "all" ? entry.all : entry[pool];
      const tier = tierOf(school, pool);
      if (score === undefined || score === null || tier === null) continue;
      seen.add(key(school.unit_id, pool));
      const last = prev.get(key(school.unit_id, pool));
      const tierYear = school.selectivity?.year ?? null;
      const band = pool === "all" ? (school.selectivity?.band ?? null) : null;
      const row: HistoryRow = {
        unit_id: school.unit_id,
        pool,
        score: round2(score),
        rank: entry.rank ?? null,
        tier,
        tier_year: tierYear,
        band,
        // Held is read with today's cutoffs, so it's only known for rows built with today's method.
        held: next.method === SELECTIVITY_METHOD && tier !== selectivityTier(score, null),
        cause: "data",
        inputs: inputsFor(school, pool, next.meta),
      };
      let cause: RowCause | null = null;
      if (methodChanged) cause = "method";
      else if (!last || last.score === null) cause = "new_pool";
      else if (differsFrom(last, row)) cause = "data";
      if (!cause) continue;
      rows.push({ ...row, cause: opts.backfill ? "backfill" : cause });
    }
  }
  // A pool recorded as rated that this publish no longer rates.
  for (const last of prev.values()) {
    if (last.score === null || seen.has(key(last.unit_id, last.pool))) continue;
    const school = next.schools.find((s) => s.unit_id === last.unit_id);
    rows.push({
      unit_id: last.unit_id,
      pool: last.pool,
      score: null,
      rank: null,
      tier: null,
      tier_year: null,
      band: null,
      held: false,
      cause: opts.backfill ? "backfill" : "unrated",
      inputs: school ? inputsFor(school, last.pool, next.meta) : {},
    });
  }
  return rows.sort((a, b) => a.unit_id.localeCompare(b.unit_id) || HISTORY_POOLS.indexOf(a.pool) - HISTORY_POOLS.indexOf(b.pool));
}

/** The publish's summary row. */
export function historyRun(next: SelectivityAt, opts: { gitCommit: string; publishedAt: string; lastMethod: string | null; backfill?: boolean; publishId?: number | null }): HistoryRun {
  return {
    git_commit: opts.gitCommit,
    published_at: opts.publishedAt,
    method: next.method,
    elite_index: next.index.elite_index,
    counts: next.index.counts,
    elite_any_pool: next.index.elite_count,
    rated: Object.keys(next.index.colleges).length,
    cause: opts.backfill ? "backfill" : opts.lastMethod !== null && opts.lastMethod !== next.method ? "method" : "data",
    publish_id: opts.publishId ?? null,
  };
}

/** The recorded rows a run leaves as "last recorded", for the next run in the same process (the backfill walks several). */
export function advance(prev: Map<string, Recorded>, rows: readonly HistoryRow[]): Map<string, Recorded> {
  const out = new Map(prev);
  for (const r of rows) out.set(key(r.unit_id, r.pool), { unit_id: r.unit_id, pool: r.pool, score: r.score, rank: r.rank, tier: r.tier, tier_year: r.tier_year, band: r.band, held: r.held, inputs: r.inputs });
  return out;
}

export function recordedMap(rows: readonly Recorded[]): Map<string, Recorded> {
  return new Map(rows.map((r) => [key(r.unit_id, r.pool), { ...r, score: r.score === null ? null : Number(r.score), rank: r.rank ?? null, held: Boolean(r.held), inputs: r.inputs ?? {} }]));
}

/* ------------------------------------------------------------------ */
/* Reading a commit, and the table (the scripts)                       */
/* ------------------------------------------------------------------ */

/** A commit's selectivity from git. `methodFor` names the method when the index file doesn't (files built before it). */
export function selectivityAt(readAt: (sha: string, path: string) => string, sha: string, methodFor: (sha: string) => string | null = () => null): SelectivityAt {
  const read = <T,>(path: string): T => JSON.parse(readAt(sha, path)) as T;
  const index = read<SelectivityIndexFile>("data/selectivity-index.json");
  const method = index.method ?? methodFor(sha);
  if (!method) throw new Error(`data/selectivity-index.json at ${sha.slice(0, 12)} has no method, and none is known for that commit`);
  return { index, schools: read<School[]>("data/schools.json"), meta: read<DatasetMeta>("data/meta.json"), method };
}

/** The minimal client surface the scripts use, so tests can stub it. */
export interface HistoryClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  from(table: string): {
    select(cols: string): {
      order(col: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }> };
      eq(col: string, v: string): { limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
  };
}

/** The last recorded rows and the last recorded method. */
export async function readRecorded(client: HistoryClient): Promise<{ prev: Map<string, Recorded>; lastMethod: string | null; commits: Set<string> }> {
  const latest = await client.rpc("selectivity_latest_rows");
  if (latest.error) throw new Error(`reading the last recorded rows: ${latest.error.message}`);
  const runs = await client.from("selectivity_publishes").select("git_commit, method").order("id", { ascending: false }).limit(10000);
  if (runs.error) throw new Error(`reading selectivity_publishes: ${runs.error.message}`);
  const list = (runs.data ?? []) as { git_commit: string; method: string }[];
  return { prev: recordedMap((latest.data ?? []) as Recorded[]), lastMethod: list[0]?.method ?? null, commits: new Set(list.map((r) => r.git_commit)) };
}

/** Records one run; null when the commit was already recorded. */
export async function recordRun(client: HistoryClient, run: HistoryRun, rows: readonly HistoryRow[]): Promise<number | null> {
  const { data, error } = await client.rpc("record_selectivity_run", { p_run: run, p_rows: rows });
  if (error) throw new Error(`record_selectivity_run: ${error.message}`);
  return (data as number | null) ?? null;
}

/** "3 rows: UT Austin all 72.45 (data), …" for the log. */
export function describeRows(rows: readonly HistoryRow[], names: ReadonlyMap<string, string>, limit = 12): string[] {
  const byCause = new Map<string, number>();
  for (const r of rows) byCause.set(r.cause, (byCause.get(r.cause) ?? 0) + 1);
  const head = `${rows.length} row(s)${rows.length ? `: ${[...byCause].map(([c, n]) => `${n} ${c}`).join(", ")}` : ""}`;
  return [head, ...rows.slice(0, limit).map((r) => `  ${names.get(r.unit_id) ?? r.unit_id} · ${r.pool} · ${r.score ?? "unrated"} · ${r.tier ?? "-"}${r.held ? " (held)" : ""} · ${r.cause}`)];
}
