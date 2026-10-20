/**
 * Quad's selectivity history (specs/chances/selectivity-history.md): which rows a publish records, and what each row
 * carries. Pure: the publish, backfill, and rebuild scripts read the commits and the table, and this decides.
 *
 * One row per college per publish, with all three pools side by side (owner, 2026-10-20: "store those all in one row
 * with 3 columns instead of 3 rows"): the score, tier, and hysteresis hold for all applicants, in-state, and
 * out-of-state, the all-applicants rank, the tier's admissions year, the top-of-Ultra band, and the inputs.
 *
 * A row is written only when something about the college differs from its last recorded row (owner, 2026-10-20: "we
 * shouldn't store history records when the data doesn't change"): any pool's score at its two stored decimals, tier,
 * or hold, the rank, the year, the band, or any input. A college recorded for the first time is `new`; one that is no
 * longer rated in any pool is `unrated` (every pool null); a method change records every rated college (`method`, so a
 * method change never reads as a college moving). There is no threshold: the console hides moves under
 * DISPLAY_MOVE_MIN by default, as a display filter. A publish that changes nothing records nothing, not even its run.
 */
import type { DatasetMeta, School } from "../../lib/types";
import type { SelectivityTier } from "../../lib/chances/types.ts";
import type { FieldPath } from "../../lib/fields.ts";
import { lineageFor } from "../../lib/lineage.ts";
import { SELECTIVITY_METHOD, rawInputs, selectivityTier } from "../../lib/selectivity.ts";
import type { SelectivityIndexFile } from "./selectivity.mts";

export const HISTORY_POOLS = ["all", "in_state", "out_of_state"] as const;
export type HistoryPool = (typeof HISTORY_POOLS)[number];

export type RowCause = "data" | "method" | "backfill" | "new" | "unrated";
export type RunCause = "data" | "method" | "backfill";

export interface InputValue {
  v: number | null;
  year: string | null;
  source: string | null;
  imputed?: boolean;
}

/** What a row holds about a college (and what the next publish is compared against). */
export interface CollegeState {
  unit_id: string;
  rank: number | null;
  tier_year: string | null;
  band: string | null;
  score_all: number | null;
  tier_all: SelectivityTier | null;
  held_all: boolean;
  score_in_state: number | null;
  tier_in_state: SelectivityTier | null;
  held_in_state: boolean;
  score_out_of_state: number | null;
  tier_out_of_state: SelectivityTier | null;
  held_out_of_state: boolean;
  inputs: Record<string, InputValue>;
}

export interface HistoryRow extends CollegeState {
  cause: RowCause;
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

/**
 * The method each early index commit was built with, for the files written before the index carried `method`. The
 * first version (five tiers, many tied at the top) is 2026.10.12.1, so its jumps read as method changes.
 */
export const BACKFILL_METHODS: Record<string, string> = {
  "1bbc2596": "2026.10.12.1",
  "491ecb37": "2026.10.12.2",
  a118cc13: "2026.10.12.3",
  "3c5b4280": "2026.10.12.3",
};
export const backfillMethodFor = (sha: string) => Object.entries(BACKFILL_METHODS).find(([short]) => sha.startsWith(short))?.[1] ?? null;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The column name of a pool's score, tier, and hold. */
export const poolColumns = (pool: HistoryPool) => ({ score: `score_${pool}`, tier: `tier_${pool}`, held: `held_${pool}` }) as const;

/** The admit rate's key in `inputs` for each pool; the other inputs are the same for every pool. */
export const ADMIT_RATE_KEY: Record<HistoryPool, string> = { all: "admit_rate", in_state: "admit_rate_in_state", out_of_state: "admit_rate_out_of_state" };

/** The field each input is dated by. */
const INPUT_PATHS: Record<string, FieldPath> = {
  admit_rate: "admissions.acceptance_rate" as FieldPath,
  admit_rate_in_state: "derived.admit_rate_in_state" as FieldPath,
  admit_rate_out_of_state: "derived.admit_rate_out_of_state" as FieldPath,
  sat_p75: "admissions.sat_math_25_75" as FieldPath,
  yield: "admissions.admitted" as FieldPath,
  retention: "outcomes.retention_rate" as FieldPath,
  graduation: "outcomes.graduation_rate" as FieldPath,
};

/**
 * The raw values the scores read, each with its year and source kind (no weights, no percentiles): the admit rate for
 * each pool the college has, then the inputs every pool shares.
 */
export function inputsFor(school: School, meta: DatasetMeta): Record<string, InputValue> {
  const raw = rawInputs(school);
  const values: Record<string, number | null> = {
    admit_rate: raw.admitRate,
    ...(raw.inStateRate !== null ? { admit_rate_in_state: raw.inStateRate } : {}),
    ...(raw.outOfStateRate !== null ? { admit_rate_out_of_state: raw.outOfStateRate } : {}),
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
        const c = lineageFor(INPUT_PATHS[name], school, meta);
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

/** Inputs compared key by key, whatever order the database returned them in. */
function inputsKey(inputs: Record<string, InputValue>): string {
  return JSON.stringify(
    Object.keys(inputs)
      .sort()
      .map((k) => {
        const v = inputs[k];
        return [k, { v: v.v ?? null, year: v.year ?? null, source: v.source ?? null, ...(v.imputed ? { imputed: true } : {}) }];
      }),
  );
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : round2(Number(v)));

/** Whether anything recorded about the college differs: a pool's score, tier, or hold, the rank, year, band, or an input. */
export function differs(last: CollegeState, next: CollegeState): boolean {
  for (const pool of HISTORY_POOLS) {
    const c = poolColumns(pool);
    if (num(last[c.score]) !== num(next[c.score]) || (last[c.tier] ?? null) !== (next[c.tier] ?? null) || Boolean(last[c.held]) !== Boolean(next[c.held])) return true;
  }
  return (
    (last.rank ?? null) !== (next.rank ?? null) ||
    (last.tier_year ?? null) !== (next.tier_year ?? null) ||
    (last.band ?? null) !== (next.band ?? null) ||
    inputsKey(last.inputs ?? {}) !== inputsKey(next.inputs ?? {})
  );
}

const rated = (s: CollegeState) => HISTORY_POOLS.some((p) => s[poolColumns(p).score] !== null);

const tierOf = (school: School, pool: HistoryPool): SelectivityTier | null =>
  ((pool === "all" ? school.selectivity?.tier : school.selectivity?.[pool]) ?? null) as SelectivityTier | null;

/** A college's state in a commit: each pool's score and tier (a pool without both is null), and what they read. */
export function stateOf(school: School, entry: SelectivityIndexFile["colleges"][string], at: Pick<SelectivityAt, "meta" | "method">): CollegeState {
  const state = {
    unit_id: school.unit_id,
    rank: entry.rank ?? null,
    tier_year: school.selectivity?.year ?? null,
    band: school.selectivity?.band ?? null,
    inputs: inputsFor(school, at.meta),
  } as CollegeState;
  for (const pool of HISTORY_POOLS) {
    const c = poolColumns(pool);
    const score = pool === "all" ? entry.all : entry[pool];
    const tier = tierOf(school, pool);
    const ratedHere = score !== undefined && score !== null && tier !== null;
    Object.assign(state, {
      [c.score]: ratedHere ? round2(score) : null,
      [c.tier]: ratedHere ? tier : null,
      // Held is read with today's cutoffs, so it's only known for rows built with today's method.
      [c.held]: ratedHere && at.method === SELECTIVITY_METHOD && tier !== selectivityTier(score, null),
    });
  }
  return state;
}

/** The state recorded when a college is no longer rated anywhere: every pool null, the inputs it still has. */
function unratedState(last: CollegeState, school: School | undefined, meta: DatasetMeta): CollegeState {
  const state = { unit_id: last.unit_id, rank: null, tier_year: null, band: null, inputs: school ? inputsFor(school, meta) : {} } as CollegeState;
  for (const pool of HISTORY_POOLS) Object.assign(state, { [poolColumns(pool).score]: null, [poolColumns(pool).tier]: null, [poolColumns(pool).held]: false });
  return state;
}

/**
 * The rows a publish records: one per college whose state differs from its last recorded row. `prev`: the last
 * recorded state per college; `lastMethod`: the method of the last recorded run (null before the first). `backfill`
 * marks every row `backfill` (the rules still decide which rows).
 */
export function historyRows(prev: ReadonlyMap<string, CollegeState>, next: SelectivityAt, opts: { lastMethod: string | null; backfill?: boolean }): HistoryRow[] {
  const methodChanged = opts.lastMethod !== null && opts.lastMethod !== next.method;
  const rows: HistoryRow[] = [];
  const seen = new Set<string>();
  for (const school of next.schools) {
    const entry = next.index.colleges[school.unit_id];
    if (!entry) continue;
    const state = stateOf(school, entry, next);
    if (!rated(state)) continue;
    seen.add(school.unit_id);
    const last = prev.get(school.unit_id);
    let cause: RowCause | null = null;
    if (methodChanged) cause = "method";
    else if (!last || !rated(last)) cause = "new";
    else if (differs(last, state)) cause = "data";
    if (cause) rows.push({ ...state, cause: opts.backfill ? "backfill" : cause });
  }
  // A college recorded as rated that this publish no longer rates in any pool.
  for (const last of prev.values()) {
    if (!rated(last) || seen.has(last.unit_id)) continue;
    const school = next.schools.find((s) => s.unit_id === last.unit_id);
    rows.push({ ...unratedState(last, school, next.meta), cause: opts.backfill ? "backfill" : "unrated" });
  }
  return rows.sort((a, b) => a.unit_id.localeCompare(b.unit_id));
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

/** The recorded states a run leaves as "last recorded", for the next run in the same process (backfill, rebuild). */
export function advance(prev: Map<string, CollegeState>, rows: readonly HistoryRow[]): Map<string, CollegeState> {
  const out = new Map(prev);
  for (const { cause: _cause, ...state } of rows) out.set(state.unit_id, state);
  return out;
}

/** The last recorded rows as read from the table (numerics may arrive as strings). */
export function recordedMap(rows: readonly CollegeState[]): Map<string, CollegeState> {
  return new Map(
    rows.map((r) => {
      const state = { ...r, rank: r.rank ?? null, inputs: r.inputs ?? {} } as CollegeState;
      for (const pool of HISTORY_POOLS) {
        const c = poolColumns(pool);
        Object.assign(state, { [c.score]: num(r[c.score]), [c.tier]: r[c.tier] ?? null, [c.held]: Boolean(r[c.held]) });
      }
      return [r.unit_id, state];
    }),
  );
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

type Result = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
interface Ranged extends Result {
  range(from: number, to: number): Result;
}

/** The minimal client surface the scripts use, so tests can stub it. */
export interface HistoryClient {
  rpc(fn: string, args?: Record<string, unknown>): Ranged;
  from(table: string): {
    select(cols: string): {
      order(col: string, o: { ascending: boolean }): { limit(n: number): Result };
      eq(col: string, v: string): { limit(n: number): Result };
    };
  };
}

/** A page of rows a read returns (PostgREST caps every response at 1,000 rows). */
export const PAGE = 1000;

/**
 * Every row a set-returning function gives, page by page. A single read stops at 1,000 rows: reading the last
 * recorded rows in one call once lost every college past the 1,000th, so each publish re-recorded them as new.
 */
export async function readAllPages<T>(page: (from: number, to: number) => Result, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`reading ${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** The last recorded rows (every college, every page) and the last recorded method. */
export async function readRecorded(client: HistoryClient): Promise<{ prev: Map<string, CollegeState>; lastMethod: string | null; commits: Set<string> }> {
  const latest = await readAllPages<CollegeState>((from, to) => client.rpc("selectivity_latest_rows").range(from, to), "the last recorded rows");
  const runs = await client.from("selectivity_publishes").select("git_commit, method").order("id", { ascending: false }).limit(10000);
  if (runs.error) throw new Error(`reading selectivity_publishes: ${runs.error.message}`);
  const list = (runs.data ?? []) as { git_commit: string; method: string }[];
  return { prev: recordedMap(latest), lastMethod: list[0]?.method ?? null, commits: new Set(list.map((r) => r.git_commit)) };
}

/** Records one run; null when the commit was already recorded or there is nothing to record. */
export async function recordRun(client: HistoryClient, run: HistoryRun, rows: readonly HistoryRow[]): Promise<number | null> {
  if (!rows.length) return null;
  const { data, error } = await client.rpc("record_selectivity_run", { p_run: run, p_rows: rows });
  if (error) throw new Error(`record_selectivity_run: ${error.message}`);
  return (data as number | null) ?? null;
}

const scoreText = (s: CollegeState, pool: HistoryPool) => {
  const c = poolColumns(pool);
  return s[c.score] === null ? null : `${pool} ${s[c.score]} ${s[c.tier]}${s[c.held] ? " (held)" : ""}`;
};

/** "3 row(s): UT Austin · all 72.45 highly_selective, out_of_state 80.49 elite · data" for the log. */
export function describeRows(rows: readonly HistoryRow[], names: ReadonlyMap<string, string>, limit = 12): string[] {
  const byCause = new Map<string, number>();
  for (const r of rows) byCause.set(r.cause, (byCause.get(r.cause) ?? 0) + 1);
  const head = `${rows.length} row(s)${rows.length ? `: ${[...byCause].map(([c, n]) => `${n} ${c}`).join(", ")}` : ""}`;
  return [
    head,
    ...rows.slice(0, limit).map((r) => `  ${names.get(r.unit_id) ?? r.unit_id} · ${HISTORY_POOLS.map((p) => scoreText(r, p)).filter(Boolean).join(", ") || "unrated"} · ${r.cause}`),
  ];
}
