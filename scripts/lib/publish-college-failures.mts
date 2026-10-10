/**
 * Loads data/college-failures.json into public.college_data_failures
 * (supabase/migrations/20261010140000_college_data_failures.sql; specs/college-data-failures.md).
 *
 * Rows in the file are upserted on (unit_id, reason_code) with resolved_at cleared; rows still open in the table but
 * no longer in the file get resolved_at set. Nothing is deleted. Safe to re-run: a second load of the same file
 * writes the same values and resolves nothing new.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowKey, type FailureRow } from "./college-failures.mts";

export const FAILURES_TABLE = "college_data_failures";
export const FAILURES_MIGRATION = "supabase/migrations/20261010140000_college_data_failures.sql";
const BATCH = 500;
const PAGE = 1000;

type Key = Pick<FailureRow, "unit_id" | "reason_code">;

export interface LoadPlan {
  upserts: FailureRow[];
  /** Open rows no longer in the file, grouped by reason code: unit ids to mark resolved. */
  resolve: Map<string, string[]>;
}

/** What a load writes, given the file's rows and the keys of the table's open (unresolved) rows. Pure. */
export function planFailureLoad(fileRows: readonly FailureRow[], openKeys: readonly Key[]): LoadPlan {
  const inFile = new Set(fileRows.map(rowKey));
  const resolve = new Map<string, string[]>();
  for (const k of openKeys) {
    if (inFile.has(rowKey(k))) continue;
    resolve.set(k.reason_code, [...(resolve.get(k.reason_code) ?? []), k.unit_id]);
  }
  return { upserts: [...fileRows], resolve };
}

/** Null when the table exists; otherwise what's wrong. A missing table names the migration to apply. */
export async function failuresTableProblem(client: SupabaseClient): Promise<{ missing: boolean; message: string } | null> {
  const { error } = await client.from(FAILURES_TABLE).select("unit_id").limit(1);
  if (!error) return null;
  const what = [error.message, error.code].filter(Boolean).join(" · ") || "no error message";
  const missing = error.code === "42P01" || error.code === "PGRST205";
  return { missing, message: missing ? `${what}. Apply ${FAILURES_MIGRATION} first.` : `checking ${FAILURES_TABLE} failed: ${what}.` };
}

async function openKeys(client: SupabaseClient): Promise<Key[]> {
  const keys: Key[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(FAILURES_TABLE)
      .select("unit_id, reason_code")
      .is("resolved_at", null)
      .order("unit_id")
      .order("reason_code")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${FAILURES_TABLE}: listing open rows: ${error.message}`);
    keys.push(...(data as Key[]));
    if (data.length < PAGE) return keys;
  }
}

/** Upserts the file's rows and resolves the rest. Throws on any failure. */
export async function loadCollegeFailures(
  client: SupabaseClient,
  rows: readonly FailureRow[],
  opts: { now?: string; dryRun?: boolean } = {},
): Promise<{ upserted: number; resolved: number }> {
  const now = opts.now ?? new Date().toISOString();
  const plan = planFailureLoad(rows, await openKeys(client));
  const resolved = [...plan.resolve.values()].reduce((n, ids) => n + ids.length, 0);
  if (opts.dryRun) return { upserted: plan.upserts.length, resolved };

  for (let i = 0; i < plan.upserts.length; i += BATCH) {
    const chunk = plan.upserts.slice(i, i + BATCH).map((r) => ({ ...r, resolved_at: null, loaded_at: now }));
    const { error } = await client.from(FAILURES_TABLE).upsert(chunk, { onConflict: "unit_id,reason_code" });
    if (error) throw new Error(`${FAILURES_TABLE}: writing rows ${i}–${i + chunk.length}: ${error.message}`);
  }
  for (const [reason, ids] of plan.resolve) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const { error } = await client
        .from(FAILURES_TABLE)
        .update({ resolved_at: now, loaded_at: now })
        .eq("reason_code", reason)
        .in("unit_id", ids.slice(i, i + BATCH))
        .is("resolved_at", null);
      if (error) throw new Error(`${FAILURES_TABLE}: resolving ${reason} rows: ${error.message}`);
    }
  }
  return { upserted: plan.upserts.length, resolved };
}
