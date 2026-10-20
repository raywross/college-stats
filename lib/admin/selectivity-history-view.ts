/**
 * Pure helpers for the selectivity history screens (specs/chances/selectivity-history.md "The admin screens"): input
 * changes in words, the latest publish's tier moves, and labels. No I/O; lib/admin/selectivity-history.ts reads.
 *
 * A point is one recorded row: one college at one publish, with all three pools side by side (owner, 2026-10-20).
 */
import type { SelectivityTier } from "@/lib/chances/types";

export type Pool = "all" | "in_state" | "out_of_state";
export const POOLS: readonly Pool[] = ["all", "in_state", "out_of_state"];
export type PointCause = "data" | "method" | "backfill" | "new" | "unrated";

export interface InputValue {
  v: number | null;
  year: string | null;
  source: string | null;
  imputed?: boolean;
}

/** One pool at one publish; score and tier are null when the college isn't rated in that pool. */
export interface PoolValue {
  score: number | null;
  tier: SelectivityTier | null;
  held: boolean;
}

export interface SelectivityPoint {
  publishedAt: string;
  rank: number | null;
  tierYear: string | null;
  band: string | null;
  cause: PointCause;
  method: string;
  gitCommit: string;
  inputs: Record<string, InputValue>;
  pools: Record<Pool, PoolValue>;
}

/** A recorded row's pool columns (score_all, tier_all, held_all, …) as one value per pool. */
export function poolsOf(row: Record<string, unknown>): Record<Pool, PoolValue> {
  const out = {} as Record<Pool, PoolValue>;
  for (const pool of POOLS) {
    const score = row[`score_${pool}`] as number | string | null | undefined;
    out[pool] = { score: score === null || score === undefined ? null : Number(score), tier: (row[`tier_${pool}`] as SelectivityTier | null) ?? null, held: Boolean(row[`held_${pool}`]) };
  }
  return out;
}

/**
 * Score moves smaller than this are hidden by default in Movers and a college's table ("show every change" shows them).
 * A display filter only: every change is recorded (Decision 2).
 */
export const DISPLAY_MOVE_MIN = 0.25;

/**
 * Whether a row is drift the console hides by default: a data cause, and in every pool the same tier as before and a
 * move under the filter. A pool that appeared or disappeared is never drift.
 */
export function isDrift(point: Pick<SelectivityPoint, "pools" | "cause">, prev: Pick<SelectivityPoint, "pools"> | null): boolean {
  if (!prev || point.cause !== "data") return false;
  return POOLS.every((pool) => {
    const a = prev.pools[pool];
    const b = point.pools[pool];
    if (a.tier !== b.tier) return false;
    if (a.score === null || b.score === null) return a.score === b.score;
    return Math.abs(b.score - a.score) < DISPLAY_MOVE_MIN;
  });
}

export const POOL_LABELS: Record<Pool, string> = { all: "All applicants", in_state: "In-state", out_of_state: "Out-of-state" };
export const CAUSE_LABELS: Record<PointCause, string> = {
  data: "New figures",
  method: "Method change",
  backfill: "Backfilled",
  new: "First record",
  unrated: "No longer rated",
};

const INPUT_LABELS: Record<string, string> = {
  admit_rate: "admit rate",
  admit_rate_in_state: "in-state admit rate",
  admit_rate_out_of_state: "out-of-state admit rate",
  sat_p75: "SAT 75th percentile",
  yield: "yield",
  retention: "retention",
  graduation: "graduation rate",
};
const SOURCE_WORDS: Record<string, string> = { "ipeds-adm": "federal", "ipeds-gr": "federal", scorecard: "Scorecard", "college-site": "college", cds: "CDS" };
const source = (s: string | null) => (s ? (SOURCE_WORDS[s] ?? (s.startsWith("ipeds") ? "federal" : s)) : null);

function valueText(name: string, v: number | null, imputed?: boolean): string {
  if (v === null) return imputed ? "filled in" : "none";
  return name === "sat_p75" ? String(Math.round(v)) : `${(v * 100).toFixed(1)}%`;
}

const tag = (x: InputValue | undefined) => [x?.year, source(x?.source ?? null)].filter(Boolean).join(" ");

/**
 * The inputs that changed between two rows, in words: "admit rate 31.0% → 22.2% (Fall 2024 federal → Fall 2025
 * college)". Without a previous row, nothing.
 */
export function inputChanges(prev: Record<string, InputValue> | null, next: Record<string, InputValue>): string[] {
  if (!prev) return [];
  const out: string[] = [];
  for (const name of Object.keys(INPUT_LABELS)) {
    const a = prev[name];
    const b = next[name];
    if (!b && !a) continue;
    const sameValue = (a?.v ?? null) === (b?.v ?? null);
    const sameTag = tag(a) === tag(b);
    if (sameValue && sameTag) continue;
    const vals = sameValue ? valueText(name, b?.v ?? null, b?.imputed) : `${valueText(name, a?.v ?? null, a?.imputed)} → ${valueText(name, b?.v ?? null, b?.imputed)}`;
    const tags = sameTag ? (tag(b) ? ` (${tag(b)})` : "") : ` (${tag(a) || "no year"} → ${tag(b) || "no year"})`;
    out.push(`${INPUT_LABELS[name]} ${vals}${tags}`);
  }
  return out;
}

/** Each point with the one before it (oldest first in, newest first out), for the history table. */
export function withPrevious(points: readonly SelectivityPoint[]): { point: SelectivityPoint; prev: SelectivityPoint | null }[] {
  return points.map((point, i) => ({ point, prev: points[i - 1] ?? null })).reverse();
}

/** One pool's change at one publish, for the latest-publish lists and the method log. */
export interface RunChange {
  unitId: string;
  pool: Pool;
  score: number | null;
  tier: SelectivityTier | null;
  cause: PointCause;
  held: boolean;
  prevScore: number | null;
  prevTier: SelectivityTier | null;
}

/**
 * A run's rows (one per college, its pools and the previous row's) as one change per pool that moved: a score or a
 * tier differs, or the pool appeared or went away. A pool the college has never had is left out.
 */
export function runChangesOf(row: Record<string, unknown> & { unit_id: string; cause: PointCause }): RunChange[] {
  const now = poolsOf(row);
  const before = poolsOf(Object.fromEntries(POOLS.flatMap((p) => [[`score_${p}`, row[`prev_score_${p}`]], [`tier_${p}`, row[`prev_tier_${p}`]]])));
  return POOLS.filter((pool) => now[pool].score !== before[pool].score || now[pool].tier !== before[pool].tier).map((pool) => ({
    unitId: row.unit_id,
    pool,
    score: now[pool].score,
    tier: now[pool].tier,
    cause: row.cause,
    held: now[pool].held,
    prevScore: before[pool].score,
    prevTier: before[pool].tier,
  }));
}

const ORDER: SelectivityTier[] = ["elite", "highly_selective", "very_selective", "selective", "accessible", "open"];

/** A run's tier moves (up first, then down), and the colleges entering or leaving Ultra selective in any pool. */
export function tierMoves(changes: readonly RunChange[]): { up: RunChange[]; down: RunChange[]; eliteIn: string[]; eliteOut: string[] } {
  const moved = changes.filter((c) => c.prevTier !== c.tier && (c.prevTier !== null || c.tier !== null));
  const rank = (t: SelectivityTier | null) => (t === null ? ORDER.length : ORDER.indexOf(t));
  const up = moved.filter((c) => rank(c.tier) < rank(c.prevTier));
  const down = moved.filter((c) => rank(c.tier) > rank(c.prevTier));
  const eliteIn = [...new Set(moved.filter((c) => c.tier === "elite").map((c) => c.unitId))];
  const eliteOut = [...new Set(moved.filter((c) => c.prevTier === "elite" && c.tier !== "elite").map((c) => c.unitId))];
  return { up, down, eliteIn, eliteOut };
}
