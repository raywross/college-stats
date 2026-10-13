/**
 * The reader's Supabase side (supabase/migrations/20261013180000_visit_events.sql): the secret-key client
 * (`supabaseClient("publish")`, lib/supabase.ts) reads a host's stored rows, upserts events in batches of 500,
 * updates `slate_hosts`, and records each run in `visit_event_sync`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SLATE_HOST_COLUMNS, type SlateHostRow } from "../../../lib/visit-events/types.ts";
import { STORED_EVENT_COLUMNS, type EventStore, type StoredEvent, type SyncRecord } from "./sync.mts";

export const BATCH = 500;
/** PostgREST returns at most this many rows a request; longer reads page. */
const PAGE = 1000;

/** Every row of `table` whose columns equal `eq`, ordered by `orderBy` so the pages don't overlap. */
async function selectAll<T>(client: SupabaseClient, table: string, columns: string, orderBy: string, eq: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(columns);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { data, error } = await q.order(orderBy).range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase: reading ${table} failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

export function supabaseStore(client: SupabaseClient): EventStore {
  return {
    storedFor: (host, unitId) => selectAll<StoredEvent>(client, "visit_events", STORED_EVENT_COLUMNS, "id", { host, unit_id: unitId }),
    async upsertEvents(rows) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await client.from("visit_events").upsert(rows.slice(i, i + BATCH), { onConflict: "id" });
        if (error) throw new Error(`Supabase: writing visit_events failed: ${error.message}`);
      }
    },
    async updateHost(unitId, patch) {
      const { error } = await client.from("slate_hosts").update(patch).eq("unit_id", unitId);
      if (error) throw new Error(`Supabase: updating slate_hosts ${unitId} failed: ${error.message}`);
    },
    async recordSync(row: SyncRecord) {
      const { error } = await client.from("visit_event_sync").insert(row);
      if (error) throw new Error(`Supabase: writing visit_event_sync failed: ${error.message}`);
    },
  };
}

/** Every `slate_hosts` row. */
export function readHosts(client: SupabaseClient): Promise<SlateHostRow[]> {
  return selectAll<SlateHostRow>(client, "slate_hosts", SLATE_HOST_COLUMNS, "unit_id");
}

/** Inserts or updates hosts found by discovery (keeping first_seen, failures, and last_read of a known one). */
export async function upsertHosts(client: SupabaseClient, rows: readonly Pick<SlateHostRow, "unit_id" | "host" | "found_on" | "portal_parts">[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await client.from("slate_hosts").upsert(
      rows.slice(i, i + BATCH).map((r) => ({ ...r, status: "active" })),
      { onConflict: "unit_id" },
    );
    if (error) throw new Error(`Supabase: writing slate_hosts failed: ${error.message}`);
  }
}

/** Every stored event (for the check), paged. */
export function readAllEvents(client: SupabaseClient): Promise<StoredEvent[]> {
  return selectAll<StoredEvent>(client, "visit_events", STORED_EVENT_COLUMNS, "id");
}
