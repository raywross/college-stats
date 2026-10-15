/**
 * The reader's Supabase side (supabase/migrations/20261013180000_visit_events.sql): the secret-key client
 * (`supabaseClient("publish")`, lib/supabase.ts) reads a host's stored rows, upserts events in batches of 500,
 * updates `slate_hosts`, and records each run in `visit_event_sync` (with its failed and collapsed host counts and
 * whether misses were withheld, migration 20261015100000_visit_events_upkeep.sql); the check writes its summary onto the
 * newest run (`recordCheck`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SLATE_HOST_COLUMNS, type SlateHostRow } from "../../../lib/visit-events/types.ts";
import type { CheckRecord } from "./check.mts";
import { STORED_EVENT_COLUMNS, type EventStore, type StoredEvent, type SyncRecord } from "./sync.mts";

export const BATCH = 500;
/** PostgREST returns at most this many rows a request; longer reads page. */
const PAGE = 1000;

/**
 * Every row of `table` whose columns equal `eq`, paged by `keyColumn` (a unique, indexed column: the primary key).
 * Keyset paging (`key > last`), not offsets: an offset page over 330,000 events costs more each page and hits the
 * statement timeout before the end (the full read of 2026-10-14).
 */
async function selectAll<T extends object>(client: SupabaseClient, table: string, columns: string, keyColumn: string, eq: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  let last: string | null = null;
  for (;;) {
    let q = client.from(table).select(columns);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    if (last !== null) q = q.gt(keyColumn, last);
    const { data, error } = await q.order(keyColumn).limit(PAGE);
    if (error) throw new Error(`Supabase: reading ${table} failed: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    last = String((rows[rows.length - 1] as Record<string, unknown>)[keyColumn]);
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

/**
 * Inserts or updates hosts found by discovery (keeping first_seen, failures, last_read, last_attempt, search_total,
 * and zero_since of a known one; the reader's bookkeeping, hosts.mts, moves those).
 */
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

/**
 * Writes the check's counts and summary onto the newest `visit_event_sync` row (the run the check follows). Returns that
 * row's id, or null when no run is recorded yet.
 */
export async function recordCheck(client: SupabaseClient, payload: CheckRecord): Promise<number | null> {
  const { data, error } = await client.from("visit_event_sync").select("id").order("ran_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (error) throw new Error(`Supabase: reading visit_event_sync failed: ${error.message}`);
  const id = (data?.[0] as { id: number } | undefined)?.id;
  if (id == null) return null;
  const { error: upd } = await client.from("visit_event_sync").update(payload).eq("id", id);
  if (upd) throw new Error(`Supabase: writing the check onto visit_event_sync ${id} failed: ${upd.message}`);
  return id;
}
