/**
 * Pure helpers for the selectivity history screens (specs/chances/selectivity-history.md "The admin screens"): input
 * changes in words, the latest publish's tier moves, and labels. No I/O; lib/admin/selectivity-history.ts reads.
 */
import type { SelectivityTier } from "@/lib/chances/types";

export type Pool = "all" | "in_state" | "out_of_state";
export type PointCause = "data" | "method" | "backfill" | "new_pool" | "unrated";

export interface InputValue {
  v: number | null;
  year: string | null;
  source: string | null;
  imputed?: boolean;
}

export interface SelectivityPoint {
  publishedAt: string;
  pool: Pool;
  score: number | null;
  rank: number | null;
  tier: SelectivityTier | null;
  tierYear: string | null;
  band: string | null;
  held: boolean;
  cause: PointCause;
  method: string;
  gitCommit: string;
  inputs: Record<string, InputValue>;
}

/**
 * Score moves smaller than this are hidden by default in Movers and a college's table ("show every change" shows them).
 * A display filter only: every change is recorded (Decision 2).
 */
export const DISPLAY_MOVE_MIN = 0.25;

/** Whether a row is drift the console hides by default: same tier as before, a data cause, and a move under the filter. */
export function isDrift(point: Pick<SelectivityPoint, "score" | "tier" | "cause">, prev: Pick<SelectivityPoint, "score" | "tier"> | null): boolean {
  if (!prev || point.cause !== "data" || point.tier !== prev.tier || point.score === null || prev.score === null) return false;
  return Math.abs(point.score - prev.score) < DISPLAY_MOVE_MIN;
}

export const POOL_LABELS: Record<Pool, string> = { all: "All applicants", in_state: "In-state", out_of_state: "Out-of-state" };
export const CAUSE_LABELS: Record<PointCause, string> = {
  data: "New figures",
  method: "Method change",
  backfill: "Backfilled",
  new_pool: "New pool",
  unrated: "No longer rated",
};

const INPUT_LABELS: Record<string, string> = { admit_rate: "admit rate", sat_p75: "SAT 75th percentile", yield: "yield", retention: "retention", graduation: "graduation rate" };
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

/** Each point with the one before it in the same pool (oldest first in, newest first out), for the history table. */
export function withPrevious(points: readonly SelectivityPoint[]): { point: SelectivityPoint; prev: SelectivityPoint | null }[] {
  const last = new Map<Pool, SelectivityPoint>();
  const out = points.map((point) => {
    const prev = last.get(point.pool) ?? null;
    last.set(point.pool, point);
    return { point, prev };
  });
  return out.reverse();
}

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
