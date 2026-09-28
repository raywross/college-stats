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

/** One published dataset, read in full: every college plus meta.json and release-calendar.json. */
export async function fetchDatasetFiles(client: SupabaseClient): Promise<DatasetFiles> {
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

  const { data: files, error } = await client.from("dataset_files").select("name, data");
  if (error) throw new Error(`Supabase: reading dataset_files failed: ${error.message}`);
  const file = (name: string) => files.find((f) => f.name === name)?.data;
  const meta = file("meta") as DatasetMeta | undefined;
  const releaseCalendar = file("release_calendar") as ReleaseCalendar | undefined;
  if (!schools.length || !meta || !releaseCalendar) {
    throw new Error("Supabase has no published dataset yet. Run `npm run publish-data` (see specs/supabase.md).");
  }
  return { schools, meta, releaseCalendar };
}
