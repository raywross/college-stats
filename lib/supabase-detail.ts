/**
 * Supabase access for the per-college detail files (lib/detail.ts; supabase/migrations/20261002120000_school_details.sql),
 * shared by the app (lib/data.ts getDetail) and the publish script. Plain module, no Next.js imports.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchoolDetail } from "./detail";

const PAGE_SIZE = 1000;

/** One college's detail file, or null when it has none. */
export async function fetchSchoolDetail(client: SupabaseClient, unitId: string): Promise<SchoolDetail | null> {
  const { data, error } = await client.from("school_details").select("data").eq("unit_id", unitId).maybeSingle();
  if (error) throw new Error(`Supabase: reading details for ${unitId} failed: ${error.message}`);
  return (data?.data as SchoolDetail | undefined) ?? null;
}

/** Every published detail file, for the publish script's read-back check. */
export async function fetchAllSchoolDetails(client: SupabaseClient): Promise<SchoolDetail[]> {
  const out: SchoolDetail[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from("school_details").select("data").order("unit_id").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase: reading school_details failed: ${error.message}`);
    for (const row of data) out.push(row.data as SchoolDetail);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}
