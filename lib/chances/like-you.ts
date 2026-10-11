/**
 * "Students like you" counts (specs/chances/calibration.md): of the students on Quad in the same cell (this college,
 * the same academic position, the same kind of base rate, and the same state when the base rate is a residency rate)
 * who shared outcomes in the last three finished seasons, how many were admitted. A count of what happened, never a
 * chance; the estimate stays the headline.
 *
 * Shown only when the cell has at least 50 outcomes and at least 10 each admitted and not admitted. The database
 * function (chances_like_you(), 20261011100000_application_snapshots.sql) returns nothing below that, and this module
 * checks again. Null until data exists: no Supabase configured, the migration not applied, or a thin cell.
 *
 * For the server only (the browser never talks to Supabase); no server-only import so tests can pass a fake client.
 *
 *   const c = await likeYouCount({ unitId: "243780", position: "in", baseRateKind: "residency", state: "IN" });
 *   // { n: 63, admitted: 47, seasons: [2025, 2027] } or null
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoolRateKind } from "./types.ts";
import { likeYouSeasons, likeYouVisible } from "./calibration.ts";
import { lastFinishedSeason } from "./snapshot.ts";
import { supabaseClient } from "../supabase.ts";

export interface LikeYouQuery {
  unitId: string;
  /** The estimate's academic position for this student at this college. */
  position: "below" | "in" | "above";
  baseRateKind: PoolRateKind;
  /** The student's state (USPS); used only when the base rate is a residency rate. */
  state: string | null;
}

export interface LikeYouCount {
  n: number;
  admitted: number;
  /** First and last season counted. */
  seasons: [number, number];
}

function readClient(): Pick<SupabaseClient, "rpc"> | null {
  if (!process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_PUBLISHABLE_KEY?.trim()) return null;
  try {
    return supabaseClient("read");
  } catch {
    return null;
  }
}

/** The cell's counts, or null (nothing yet, or too few to show). Never throws. */
export async function likeYouCount(
  q: LikeYouQuery,
  { client, today = new Date().toISOString().slice(0, 10) }: { client?: Pick<SupabaseClient, "rpc"> | null; today?: string } = {},
): Promise<LikeYouCount | null> {
  if (!/^[0-9]{1,10}$/.test(q.unitId)) return null;
  const db = client === undefined ? readClient() : client;
  if (!db) return null;
  const seasons = likeYouSeasons(lastFinishedSeason(today));
  try {
    const { data, error } = await db.rpc("chances_like_you", {
      p_unit: q.unitId,
      p_position: q.position,
      p_base_rate_kind: q.baseRateKind,
      p_state: q.baseRateKind === "residency" ? q.state : null,
      p_from_season: seasons[0],
      p_to_season: seasons[1],
    });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as { n?: unknown; admitted?: unknown } | null | undefined;
    const n = Number(row?.n);
    const admitted = Number(row?.admitted);
    return likeYouVisible(n, admitted) ? { n, admitted, seasons } : null;
  } catch {
    return null;
  }
}
