/**
 * Supabase clients for the server and scripts, and the What changed reader. Plain module, no Next.js imports, so Node
 * can run it directly. The college dataset is not read from here: it ships with the deploy (lib/data.ts;
 * specs/serving-architecture.md). Schema: supabase/migrations/. How the pieces fit: specs/supabase.md.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CpiTable, HistoryMeta, NationalHistory, TrendFacts } from "./history";
import type { StoredChange } from "./changes";

/** data/history/{meta,national,facts,cpi}.json, read by lib/data.ts getHistoryFiles(). */
export interface HistoryFiles {
  meta: HistoryMeta;
  national: NationalHistory;
  facts: TrendFacts;
  cpi: CpiTable;
}

/**
 * Reads use the publishable key (row-level security allows public `select` only); publishing uses the
 * secret key, which bypasses RLS and must never reach the browser or be committed.
 */
export function supabaseClient(role: "read" | "publish"): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const keyName = role === "read" ? "SUPABASE_PUBLISHABLE_KEY" : "SUPABASE_SECRET_KEY";
  const key = process.env[keyName];
  if (!url || !key) {
    throw new Error(`Supabase is not configured: set SUPABASE_URL and ${keyName} (see specs/supabase.md).`);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/* ------------------------------------------------------------------ */
/* What changed (supabase/migrations/20261005140000_follows.sql; specs/product/follow-colleges.md) */
/* ------------------------------------------------------------------ */

/** Columns of a dataset_changes row as lib/changes.ts StoredChange names them. */
export const CHANGE_COLUMNS = "publish_id, published_at, unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release";

/**
 * One college's recorded changes, newest first (at most `limit`). Throws on any failure, including a missing table
 * (the follows migration not applied yet); callers decide whether that's fatal.
 */
export async function fetchSchoolChanges(client: SupabaseClient, unitId: string, limit = 200): Promise<StoredChange[]> {
  const { data, error } = await client
    .from("dataset_changes")
    .select(CHANGE_COLUMNS)
    .eq("unit_id", unitId)
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase: reading changes for ${unitId} failed: ${error.message}`);
  return (data as StoredChange[]).map((c) => ({ ...c, publish_id: Number(c.publish_id) }));
}
