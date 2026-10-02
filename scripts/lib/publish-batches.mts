/**
 * Replace a table's rows in batches (specs/supabase.md#publishing). History (20 MB after wave 2) and detail files are too
 * big to swap in one statement within the API's statement timeout (the history swap timed out on 2026-10-02), so
 * publish-data upserts them straight into the live table, a batch per call, then deletes rows whose college is gone.
 *
 * Not atomic: while a publish runs, readers can see some colleges' new rows and some old ones (accepted 2026-10-02; every
 * row is a complete, valid file either way, and publish-data reads everything back afterwards).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface KeyedRow {
  unit_id: string;
  data: unknown;
}

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000;

/** Every unit_id in a table, paging past PostgREST's row limit. */
export async function allUnitIds(client: SupabaseClient, table: string): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select("unit_id").order("unit_id").range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: listing rows: ${error.message}`);
    ids.push(...(data as { unit_id: string }[]).map((r) => r.unit_id));
    if (data.length < PAGE) return ids;
  }
}

/**
 * Upsert `rows` into `table` (keyed by unit_id) `batch` at a time, then delete the rows not in `rows`. Throws on any
 * failure, naming the batch. Returns the number of rows written.
 */
export async function replaceInBatches(
  client: SupabaseClient,
  table: string,
  rows: readonly KeyedRow[],
  batch: number,
  label: string,
): Promise<number> {
  if (!rows.length) throw new Error(`${label}: nothing to publish`);
  const publishedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch).map((r) => ({ unit_id: r.unit_id, data: r.data, published_at: publishedAt }));
    const { error } = await client.from(table).upsert(chunk, { onConflict: "unit_id" });
    if (error) throw new Error(`${label}: writing ${i}–${i + chunk.length}: ${error.message}`);
    process.stdout.write(`\r  ${label}: wrote ${i + chunk.length}/${rows.length}`);
  }
  process.stdout.write("\n");
  const keep = new Set(rows.map((r) => r.unit_id));
  const stale = (await allUnitIds(client, table)).filter((id) => !keep.has(id));
  for (let i = 0; i < stale.length; i += batch) {
    const { error } = await client.from(table).delete().in("unit_id", stale.slice(i, i + batch));
    if (error) throw new Error(`${label}: removing colleges no longer in the data: ${error.message}`);
  }
  if (stale.length) console.log(`  ${label}: removed ${stale.length} colleges no longer in the data`);
  return rows.length;
}
