/**
 * High school files: the checks check:lineage and publish-data share, and publish-data's high school step
 * (supabase/migrations/20261005170000_high_schools.sql; specs/product/high-school-data.md).
 *
 * Publishing writes the live tables in batches (like history and detail files: ~24,000 rows, ~25 MB, too big to swap
 * in one statement within the API's timeout), deletes rows no longer in the files, writes meta and medians last, and
 * reads everything back. Each row is published with its state report merged in (toPublishedRow), so the app reads
 * one row per school. Not atomic: mid-publish, readers can see a mix of old and new rows (accepted for history on
 * 2026-10-02; every row is complete either way).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HighSchool, HighSchoolDetail, HighSchoolMeta, HighSchoolShard, HighSchoolStateFile, StateMedians } from "../../lib/high-school-types.ts";
import { toPublishedRow, validateHighSchoolDetail, validateHighSchoolMeta, validateMedians, validateShard, validateStateFile } from "../../lib/high-school-core.ts";
import { validateHsRegistry } from "../../lib/hs-fields.ts";
import { readAllHsDetails, readAllShards, readHsMedians, readHsMeta, readStateFiles } from "../../lib/high-school-store.ts";
import { fetchAllHighSchoolDetails, fetchAllHighSchoolFiles, fetchAllHighSchoolRows, toHighSchoolTableRow, type HighSchoolTableRow } from "../../lib/supabase-high-schools.ts";

export const HIGH_SCHOOLS_MIGRATION = "supabase/migrations/20261005170000_high_schools.sql";
/** Rows per upsert (~1–2 KB each). */
const ROW_BATCH = 500;
const DETAIL_BATCH = 200;
const PAGE = 1000;

export interface HighSchoolData {
  meta: HighSchoolMeta | null;
  medians: StateMedians | null;
  shards: { file: string; shard: HighSchoolShard }[];
  rows: HighSchool[];
  stateFiles: { file: string; data: HighSchoolStateFile }[];
  details: { file: string; data: HighSchoolDetail }[];
}

/** Everything under a high school directory, or null when nothing has been built there (no meta.json, no shards). */
export function readHighSchoolData(dir: string): HighSchoolData | null {
  const meta = readHsMeta(dir);
  const shards = readAllShards(dir);
  const stateFiles = readStateFiles(dir);
  const details = readAllHsDetails(dir);
  if (!meta && !shards.length && !stateFiles.length && !details.length) return null;
  return { meta, medians: readHsMedians(dir), shards, rows: shards.flatMap((s) => s.shard.schools), stateFiles, details };
}

/** Every problem with the files: registry, shards, meta, medians, state files, detail files. */
export function highSchoolFileProblems(data: HighSchoolData, opts: { collegeIds?: ReadonlySet<string> } = {}): string[] {
  const p = [...validateHsRegistry()];
  const seen = new Set<string>();
  for (const { file, shard } of data.shards) {
    p.push(...validateShard(shard, file));
    for (const r of shard.schools) {
      if (seen.has(r.id)) p.push(`high-schools: ${r.id} appears in more than one shard`);
      seen.add(r.id);
    }
  }
  if (data.shards.length) {
    if (!data.meta) p.push("high-schools/meta.json is missing");
    else p.push(...validateHighSchoolMeta(data.meta, data.rows));
    if (!data.medians) p.push("high-schools/medians.json is missing");
    else p.push(...validateMedians(data.medians, data.rows, data.stateFiles.map((f) => f.data)));
  }
  const byState = new Map<string, Set<string>>();
  for (const { shard } of data.shards) byState.set(shard.state, new Set(shard.schools.filter((r) => r.kind === "public").map((r) => r.id)));
  for (const { file, data: sf } of data.stateFiles) p.push(...validateStateFile(sf, { fileName: file, ids: byState.get(sf.state) }));
  const schoolIds = data.rows.length ? seen : undefined;
  for (const { file, data: d } of data.details) p.push(...validateHighSchoolDetail(d, { fileName: file, schoolIds, collegeIds: opts.collegeIds }));
  return p;
}

/** Null when the tables exist; otherwise what's wrong (most likely the migration isn't applied). */
export async function highSchoolTablesProblem(client: SupabaseClient): Promise<string | null> {
  for (const [table, key] of [["high_schools", "id"], ["high_school_details", "id"], ["high_school_files", "name"]] as const) {
    const { error } = await client.from(table).select(key).limit(1);
    if (!error) continue;
    const what = [error.message, error.code].filter(Boolean).join(" · ") || "no error message";
    return error.code === "42P01" || error.code === "PGRST205" ? `${what}. Apply ${HIGH_SCHOOLS_MIGRATION} first.` : `checking ${table} failed: ${what}.`;
  }
  return null;
}

async function allIds(client: SupabaseClient, table: string): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select("id").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: listing rows: ${error.message}`);
    ids.push(...(data as { id: string }[]).map((r) => r.id));
    if (data.length < PAGE) return ids;
  }
}

/** Upsert rows (keyed by id) in batches, then delete rows not among them. */
async function replaceById(client: SupabaseClient, table: string, rows: readonly ({ id: string } & Record<string, unknown>)[], batch: number, label: string) {
  const publishedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch).map((r) => ({ ...r, published_at: publishedAt }));
    const { error } = await client.from(table).upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`${label}: writing ${i}–${i + chunk.length}: ${error.message}`);
  }
  const keep = new Set(rows.map((r) => r.id));
  const stale = (await allIds(client, table)).filter((id) => !keep.has(id));
  for (let i = 0; i < stale.length; i += batch) {
    const { error } = await client.from(table).delete().in("id", stale.slice(i, i + batch));
    if (error) throw new Error(`${label}: removing rows no longer in the files: ${error.message}`);
  }
  return stale.length;
}

/** The table rows a publish writes, in id order. */
export function highSchoolTableRows(data: HighSchoolData): HighSchoolTableRow[] {
  const stateFiles = data.stateFiles.map((f) => f.data);
  return [...data.rows].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => toHighSchoolTableRow(toPublishedRow(r, stateFiles)));
}

/** Write, clean up, and read back. Throws on any failure. Returns counts. */
export async function publishHighSchools(client: SupabaseClient, data: HighSchoolData): Promise<{ schools: number; details: number; removed: number }> {
  if (!data.meta || !data.medians) throw new Error("high schools: meta.json and medians.json are required to publish");
  const rows = highSchoolTableRows(data);
  const details = data.details.map((d) => d.data);
  let removed = await replaceById(client, "high_schools", rows as unknown as ({ id: string } & Record<string, unknown>)[], ROW_BATCH, "High schools");
  removed += await replaceById(client, "high_school_details", details.map((d) => ({ id: d.id, data: d })), DETAIL_BATCH, "High school details");
  const publishedAt = new Date().toISOString();
  const { error } = await client.from("high_school_files").upsert(
    [
      { name: "meta", data: data.meta, published_at: publishedAt },
      { name: "medians", data: data.medians, published_at: publishedAt },
    ],
    { onConflict: "name" },
  );
  if (error) throw new Error(`high school files: ${error.message}`);

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const back = new Map((await fetchAllHighSchoolRows(client)).map((r) => [r.id, r]));
  const differ = rows.filter((r) => !same(r, back.get(r.id))).map((r) => r.id);
  if (back.size !== rows.length || differ.length) {
    throw new Error(`high schools differ after reading back (${back.size} rows, expected ${rows.length}${differ.length ? `; e.g. ${differ.slice(0, 5).join(", ")}` : ""}).`);
  }
  const backDetails = new Map((await fetchAllHighSchoolDetails(client)).map((d) => [d.id, d]));
  if (backDetails.size !== details.length || details.some((d) => !same(d, backDetails.get(d.id)))) throw new Error("high school details differ after reading back.");
  const files = await fetchAllHighSchoolFiles(client);
  if (!same(files.meta, data.meta) || !same(files.medians, data.medians)) throw new Error("high school meta or medians differ after reading back.");
  return { schools: rows.length, details: details.length, removed };
}
