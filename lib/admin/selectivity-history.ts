import "server-only";
/**
 * The console's reads of Quad's selectivity history (specs/chances/selectivity-history.md, "Reader contract"): one
 * college's points per pool, the latest publish's tier moves, the biggest movers, tier counts over time, and the method
 * log. Every read runs with the admin's session and the console header, so the "Admins read" policies and the
 * admin_selectivity_*() functions answer; nothing here is imported by a public page (tests/admin-hidden.test.mts).
 */
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { SelectivityTier } from "@/lib/chances/types";
import { tierMoves, type InputValue, type PointCause, type Pool, type RunChange, type SelectivityPoint } from "./selectivity-history-view";

export type { Pool, SelectivityPoint } from "./selectivity-history-view";

export interface SelectivityRun {
  id: number;
  gitCommit: string;
  publishedAt: string;
  method: string;
  eliteAnyPool: number;
  counts: Record<string, number>;
  rated: number;
  rowsRecorded: number;
  cause: "data" | "method" | "backfill";
}

export interface Mover {
  unitId: string;
  pool: Pool;
  scoreFrom: number | null;
  scoreTo: number | null;
  delta: number | null;
  tierFrom: SelectivityTier | null;
  tierTo: SelectivityTier | null;
  movedAt: string;
  cause: PointCause;
}

async function client() {
  await requireAdmin();
  return adminSupabase();
}

function check<T>(what: string, r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new Error(`admin: reading ${what} failed: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

/** Whether the history tables exist yet (the migration may not be applied); a missing table reads as "not set up". */
export async function historyInstalled(): Promise<boolean> {
  const supabase = await client();
  const { error } = await supabase.from("selectivity_publishes").select("id").limit(1);
  return !error;
}

type RunRow = { id: number; git_commit: string; published_at: string; method: string; elite_any_pool: number; counts: Record<string, number>; rated: number; rows_recorded: number; cause: SelectivityRun["cause"] };
const toRun = (r: RunRow): SelectivityRun => ({
  id: r.id,
  gitCommit: r.git_commit,
  publishedAt: r.published_at,
  method: r.method,
  eliteAnyPool: r.elite_any_pool,
  counts: r.counts,
  rated: r.rated,
  rowsRecorded: r.rows_recorded,
  cause: r.cause,
});

/** Every recorded run, newest first. */
export async function runs(): Promise<SelectivityRun[]> {
  const supabase = await client();
  const rows = check<RunRow[]>(
    "selectivity runs",
    await supabase.from("selectivity_publishes").select("id, git_commit, published_at, method, elite_any_pool, counts, rated, rows_recorded, cause").order("published_at", { ascending: false }).order("id", { ascending: false }),
  );
  return rows.map(toRun);
}

/** One college's points, every pool, oldest first. */
export async function collegeHistory(unitId: string): Promise<SelectivityPoint[]> {
  const supabase = await client();
  type Row = { published_at: string; pool: Pool; score: number | string | null; rank: number | null; tier: SelectivityTier | null; tier_year: string | null; band: string | null; held: boolean; cause: PointCause; inputs: Record<string, InputValue>; selectivity_publishes: Pub | Pub[] | null };
  type Pub = { method: string; git_commit: string };
  const rows = check<Row[]>(
    "a college's selectivity history",
    await supabase
      .from("selectivity_history")
      .select("published_at, pool, score, rank, tier, tier_year, band, held, cause, inputs, selectivity_publishes(method, git_commit)")
      .eq("unit_id", unitId)
      .order("published_at", { ascending: true })
      .order("id", { ascending: true }),
  );
  // A many-to-one embed comes back as one object (the client's types say a list); either shape is read.
  const pub = (r: Row): Pub | null => (Array.isArray(r.selectivity_publishes) ? (r.selectivity_publishes[0] ?? null) : r.selectivity_publishes);
  return rows.map((r) => ({
    publishedAt: r.published_at,
    pool: r.pool,
    score: r.score === null ? null : Number(r.score),
    rank: r.rank,
    tier: r.tier,
    tierYear: r.tier_year,
    band: r.band,
    held: r.held,
    cause: r.cause,
    method: pub(r)?.method ?? "",
    gitCommit: pub(r)?.git_commit ?? "",
    inputs: r.inputs ?? {},
  }));
}

/** One run's rows with the rows they replaced. */
export async function runChanges(runId: number): Promise<RunChange[]> {
  const supabase = await client();
  type Row = { unit_id: string; pool: Pool; score: number | string | null; tier: SelectivityTier | null; cause: PointCause; held: boolean; prev_score: number | string | null; prev_tier: SelectivityTier | null };
  const rows = check<Row[]>("a run's changes", await supabase.rpc("admin_selectivity_run_changes", { p_run: runId }));
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({ unitId: r.unit_id, pool: r.pool, score: num(r.score), tier: r.tier, cause: r.cause, held: r.held, prevScore: num(r.prev_score), prevTier: r.prev_tier }));
}

/** The biggest score moves over a window (method changes left out unless asked for). */
export async function movers(o: { days: 7 | 30 | 90; pool?: Pool; includeMethod?: boolean; limit?: number; minMove?: number; tier?: SelectivityTier; cause?: PointCause }): Promise<Mover[]> {
  const supabase = await client();
  type Row = { unit_id: string; pool: Pool; score_from: number | string | null; score_to: number | string | null; delta: number | string | null; tier_from: SelectivityTier | null; tier_to: SelectivityTier | null; moved_at: string; cause: PointCause };
  const rows = check<Row[]>(
    "movers",
    await supabase.rpc("admin_selectivity_movers", {
      p_days: o.days,
      p_pool: o.pool ?? null,
      p_include_method: o.includeMethod ?? false,
      p_limit: o.limit ?? 50,
      p_min: o.minMove ?? 0,
      p_tier: o.tier ?? null,
      p_cause: o.cause ?? null,
    }),
  );
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({ unitId: r.unit_id, pool: r.pool, scoreFrom: num(r.score_from), scoreTo: num(r.score_to), delta: num(r.delta), tierFrom: r.tier_from, tierTo: r.tier_to, movedAt: r.moved_at, cause: r.cause }));
}

/** How many colleges each tier held after each publish, for one pool, oldest first. */
export async function tierCounts(pool: Pool): Promise<{ publishedAt: string; method: string; cause: string; counts: Partial<Record<SelectivityTier, number>> }[]> {
  const supabase = await client();
  type Row = { run_id: number; published_at: string; method: string; cause: string; counts: Partial<Record<SelectivityTier, number>> };
  const rows = check<Row[]>("tier counts", await supabase.rpc("admin_selectivity_tier_counts", { p_pool: pool }));
  return rows.map((r) => ({ publishedAt: r.published_at, method: r.method, cause: r.cause, counts: r.counts ?? {} }));
}

/**
 * The Health page's one line: the last run and its tier moves, or null when the history isn't set up or can't be
 * read (a broken history read never takes the Health page down with it).
 */
export async function lastRunSummary(): Promise<{ run: SelectivityRun; tierChanges: number } | null> {
  try {
    if (!(await historyInstalled())) return null;
    const run = (await runs())[0];
    if (!run) return null;
    const moves = tierMoves(await runChanges(run.id));
    return { run, tierChanges: moves.up.length + moves.down.length };
  } catch (err) {
    console.warn("[admin] selectivity history summary unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface FollowerTierEmail {
  publishId: number;
  publishedAt: string;
  unitId: string;
  field: string;
  sentence: string;
  /** People following the college now (the change went to each one who had update emails on that week). */
  followers: number;
}

/**
 * The tier changes that went to followers (Decision 7): `dataset_changes` rows for the three tier fields, newest
 * publish first, each with the college's follower count. `describe` turns a row into its sentence (lib/changes.ts).
 */
export async function followerTierEmails(describe: (c: { field: string; kind: string; old_value: unknown; new_value: unknown; old_year: string | null; new_year: string | null }) => string, limit = 100): Promise<FollowerTierEmail[]> {
  const supabase = await client();
  type Row = { publish_id: number; published_at: string; unit_id: string; field: string; kind: string; old_value: unknown; new_value: unknown; old_year: string | null; new_year: string | null };
  const rows = check<Row[]>(
    "tier changes sent to followers",
    await supabase
      .from("dataset_changes")
      .select("publish_id, published_at, unit_id, field, kind, old_value, new_value, old_year, new_year")
      .in("field", ["selectivity.tier", "selectivity.in_state", "selectivity.out_of_state"])
      .order("published_at", { ascending: false })
      .limit(limit),
  );
  const units = [...new Set(rows.map((r) => r.unit_id))];
  const follows = units.length ? check<{ unit_id: string }[]>("followers", await supabase.from("follows").select("unit_id").in("unit_id", units)) : [];
  const count = new Map<string, number>();
  for (const f of follows) count.set(f.unit_id, (count.get(f.unit_id) ?? 0) + 1);
  return rows.map((r) => ({ publishId: r.publish_id, publishedAt: r.published_at, unitId: r.unit_id, field: r.field, sentence: describe(r), followers: count.get(r.unit_id) ?? 0 }));
}
