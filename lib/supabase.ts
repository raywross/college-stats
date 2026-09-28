/**
 * Supabase access for the dataset, shared by the app (lib/data.ts) and the publish script
 * (scripts/publish-data.mts). Plain module, no Next.js imports, so Node can run it directly.
 * Schema: supabase/migrations/. How the pieces fit: specs/supabase.md.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DatasetMeta, School } from "./types";
import type { ReleaseCalendar } from "./releases";
import type { DatasetFiles } from "./dataset";

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
export async function fetchDatasetFiles(client: SupabaseClient, attempts = 3): Promise<PublishedDataset> {
  for (let attempt = 1; ; attempt++) {
    const before = await fetchPublishedVersion(client);
    const read = await readDataset(client);
    if (read.version === before) return read;
    if (attempt >= attempts) throw new Error("Supabase: the dataset kept changing while it was being read.");
  }
}

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
  return { schools, meta, releaseCalendar, version: file("meta")!.published_at as string };
}
