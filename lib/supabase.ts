/**
 * Supabase access for the dataset, shared by the app (lib/data.ts) and the publish script
 * (scripts/publish-data.mts). Plain module, no Next.js imports, so Node can run it directly.
 * Schema: supabase/migrations/. How the pieces fit: specs/supabase.md.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DatasetMeta, School } from "./types";
import type { ReleaseCalendar } from "./releases";
import type { DatasetFiles } from "./dataset";
import type { CpiTable, HistoryMeta, NationalHistory, SchoolHistory, TrendFacts } from "./history";
import type { AliasRow } from "./identity-files";
import type { StoredChange } from "./changes";

/** data/history/{meta,national,facts,cpi}.json */
export interface HistoryFiles {
  meta: HistoryMeta;
  national: NationalHistory;
  facts: TrendFacts;
  cpi: CpiTable;
}

/** PostgREST returns at most 1,000 rows per request by default. */
const PAGE_SIZE = 1000;

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

/**
 * Which publish the project is serving: `dataset_files.published_at`, which publish_dataset() sets to the
 * transaction time on every publish. One tiny query, so the app can check it on every render (lib/data.ts).
 * Null if nothing has been published.
 */
export async function fetchPublishedVersion(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.from("dataset_files").select("name, published_at");
  if (error) throw new Error(`Supabase: reading the published version failed: ${error.message}`);
  return (data.find((f) => f.name === "meta")?.published_at as string | undefined) ?? null;
}

/** A full read of one publish, tagged with its version (fetchPublishedVersion). */
export type PublishedDataset = DatasetFiles & { version: string };

/**
 * One published dataset, read in full: every college plus meta.json and release-calendar.json. The colleges
 * come back in several requests, so the version is read before and after; if a publish landed in between, the
 * read could mix two publishes, and it's repeated.
 */
export async function fetchDatasetFiles(
  client: SupabaseClient,
  { attempts = 3, timeoutWaits = TIMEOUT_WAITS_MS, wait = sleep }: { attempts?: number; timeoutWaits?: readonly number[]; wait?: (ms: number) => Promise<void> } = {},
): Promise<PublishedDataset> {
  let timeouts = 0;
  for (let attempt = 1; ; ) {
    let read: PublishedDataset;
    let before: string | null;
    try {
      before = await fetchPublishedVersion(client);
      read = await readDataset(client);
    } catch (err) {
      // A publish swapping the schools table makes reads time out for a while (the 2026-10-05 production build
      // failed this way mid-publish); wait it out instead of failing the build or the page.
      if (!isStatementTimeout(err) || timeouts >= timeoutWaits.length) throw err;
      await wait(timeoutWaits[timeouts++]);
      continue;
    }
    if (read.version === before) return read;
    if (++attempt > attempts) throw new Error("Supabase: the dataset kept changing while it was being read.");
  }
}

/** Waits between reads that hit Postgres's statement timeout: about a minute in all, longer than a publish's swap. */
export const TIMEOUT_WAITS_MS: readonly number[] = [5_000, 10_000, 20_000, 30_000];

export function isStatementTimeout(err: unknown): boolean {
  return err instanceof Error && /statement timeout/i.test(err.message);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readDataset(client: SupabaseClient): Promise<PublishedDataset> {
  const schools: School[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("schools")
      .select("data")
      // `position` is the row's index in data/schools.json, so both stores list colleges in the same order.
      .order("position")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase: reading schools failed: ${error.message}`);
    for (const row of data) schools.push(row.data as School);
    if (data.length < PAGE_SIZE) break;
  }

  const { data: files, error } = await client.from("dataset_files").select("name, data, published_at");
  if (error) throw new Error(`Supabase: reading dataset_files failed: ${error.message}`);
  const file = (name: string) => files.find((f) => f.name === name);
  const meta = file("meta")?.data as DatasetMeta | undefined;
  const releaseCalendar = file("release_calendar")?.data as ReleaseCalendar | undefined;
  if (!schools.length || !meta || !releaseCalendar) {
    throw new Error("Supabase has no published dataset yet. Run `npm run publish-data` (see specs/supabase.md).");
  }
  return { schools, meta, releaseCalendar, aliases: await fetchAliasRows(client), version: file("meta")!.published_at as string };
}

/* ------------------------------------------------------------------ */
/* Short names and nicknames (supabase/migrations/20261004120000_school_aliases.sql; specs/school-identity/aliases.md) */
/* ------------------------------------------------------------------ */

/** Every row of school_aliases, paged like schools. Throws on any failure; used by publish-data's read-back check. */
export async function fetchAllAliasRows(client: SupabaseClient): Promise<AliasRow[]> {
  const rows: AliasRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("school_aliases")
      .select("unit_id, alias, key, source, weight")
      .order("unit_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase: reading school_aliases failed: ${error.message}`);
    rows.push(...(data as AliasRow[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

let aliasWarned = false;

/**
 * Every alias row, fail-soft: a missing table (the migration isn't applied yet) or any other error is logged once
 * — not on every request — and search runs without short names rather than failing the whole dataset load.
 */
export async function fetchAliasRows(client: SupabaseClient): Promise<AliasRow[]> {
  try {
    return await fetchAllAliasRows(client);
  } catch (err) {
    if (!aliasWarned) {
      aliasWarned = true;
      console.error(`Supabase: school_aliases unavailable; search runs without short names (${err instanceof Error ? err.message : err}).`);
    }
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* History (supabase/migrations/20260928120000_history.sql)            */
/* ------------------------------------------------------------------ */

/** Which history publish the project serves: `history_files.published_at` of 'meta'. Null before the first. */
export async function fetchHistoryVersion(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.from("history_files").select("name, published_at").eq("name", "meta");
  if (error) throw new Error(`Supabase: reading the history version failed: ${error.message}`);
  return (data[0]?.published_at as string | undefined) ?? null;
}

/** The shared history files, or null when history hasn't been published. */
export async function fetchHistoryFiles(client: SupabaseClient): Promise<(HistoryFiles & { version: string }) | null> {
  // Only the four shared files: the table also holds the trend files (`trends/{name}`), read one at a time.
  const { data, error } = await client.from("history_files").select("name, data, published_at").in("name", [...HISTORY_FILE_NAMES]);
  if (error) throw new Error(`Supabase: reading history_files failed: ${error.message}`);
  const file = (name: string) => data.find((f) => f.name === name);
  if (!file("meta")) return null;
  return {
    meta: file("meta")!.data as HistoryMeta,
    national: file("national")!.data as NationalHistory,
    facts: file("facts")!.data as TrendFacts,
    cpi: file("cpi")!.data as CpiTable,
    version: file("meta")!.published_at as string,
  };
}

/** The shared history files' row names in history_files (data/history/{name}.json). */
export const HISTORY_FILE_NAMES = ["meta", "national", "facts", "cpi"] as const;

/**
 * National trend files (data/history/trends/{name}.json; specs/national-trends.md) live in history_files as
 * `trends/{name}` (supabase/migrations/20261004130000_trend_files.sql), published with the rest of history.
 */
export const trendRowName = (name: string) => `trends/${name}`;

/** One trend file, or null when it hasn't been published. */
export async function fetchTrendFile(client: SupabaseClient, name: string): Promise<unknown | null> {
  const { data, error } = await client.from("history_files").select("data").eq("name", trendRowName(name)).maybeSingle();
  if (error) throw new Error(`Supabase: reading trend file ${name} failed: ${error.message}`);
  return data?.data ?? null;
}

/** Every published trend file by name (without the `trends/` prefix), for the publish script's read-back check. */
export async function fetchAllTrendFiles(client: SupabaseClient): Promise<Record<string, unknown>> {
  const { data, error } = await client.from("history_files").select("name, data").like("name", "trends/%");
  if (error) throw new Error(`Supabase: reading trend files failed: ${error.message}`);
  return Object.fromEntries(data.map((r) => [(r.name as string).slice("trends/".length), r.data]));
}

/** One college's history, or null when it has none. */
export async function fetchSchoolHistory(client: SupabaseClient, unitId: string): Promise<SchoolHistory | null> {
  const { data, error } = await client.from("school_histories").select("data").eq("unit_id", unitId).maybeSingle();
  if (error) throw new Error(`Supabase: reading history for ${unitId} failed: ${error.message}`);
  return (data?.data as SchoolHistory | undefined) ?? null;
}

/** Every published shard, for the publish script's read-back check. */
export async function fetchAllSchoolHistories(client: SupabaseClient): Promise<SchoolHistory[]> {
  const out: SchoolHistory[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from("school_histories").select("data").order("unit_id").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase: reading school_histories failed: ${error.message}`);
    for (const row of data) out.push(row.data as SchoolHistory);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
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
