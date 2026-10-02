/**
 * publish-data's detail-file step (lib/detail.ts): read data/detail/schools/, check every file, stage them in batches,
 * swap them in with one transaction, and read them back (supabase/migrations/20261002120000_school_details.sql).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DatasetMeta, School } from "../../lib/types.ts";
import { detailMismatches, validateDetail, type SchoolDetail } from "../../lib/detail.ts";
import { fetchAllSchoolDetails } from "../../lib/supabase-detail.ts";
import { replaceInBatches } from "./publish-batches.mts";

/** Detail files per staging call: small today (home states), larger once majors arrive. */
const BATCH = 200;
const MIGRATION = "supabase/migrations/20261002120000_school_details.sql";

/** Every file in data/detail/schools/, sorted by unit ID; null when the folder doesn't exist. */
export function readDetails(root: string): SchoolDetail[] | null {
  const dir = join(root, "data", "detail", "schools");
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as SchoolDetail;
      if (`${d.unit_id}.json` !== f) throw new Error(`data/detail/schools/${f}: file name doesn't match unit_id ${d.unit_id}`);
      return d;
    });
}

/** The same checks as check:lineage: every file valid and consistent with data/schools.json. */
export function detailFileProblems(details: readonly SchoolDetail[], schools: readonly School[], meta: DatasetMeta): string[] {
  const ids = new Set(schools.map((s) => s.unit_id));
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  return details.flatMap((d) => [...validateDetail(d, meta, ids), ...(byId.has(d.unit_id) ? detailMismatches(byId.get(d.unit_id)!, d) : [])]);
}

/** Null when the tables exist; otherwise what's wrong (most likely the migration isn't applied). */
export async function detailTablesProblem(client: SupabaseClient): Promise<string | null> {
  for (const table of ["school_details", "detail_staging"]) {
    const { error } = await client.from(table).select("unit_id").limit(1);
    if (!error) continue;
    const what = [error.message, error.code].filter(Boolean).join(" · ") || "no error message";
    return error.code === "42P01" || error.code === "PGRST205" ? `${what}. Apply ${MIGRATION} first.` : `checking ${table} failed: ${what}.`;
  }
  return null;
}

/** Stage, swap, and read back. Throws on any failure. Returns the number published. */
export async function publishDetails(client: SupabaseClient, details: readonly SchoolDetail[]): Promise<number> {
  if (!details.length) throw new Error("no detail files to publish");
  // In batches straight into the live table, like history (scripts/lib/publish-batches.mts): not atomic.
  const n = await replaceInBatches(client, "school_details", details.map((d) => ({ unit_id: d.unit_id, data: d })), BATCH, "Details");
  const back = new Map((await fetchAllSchoolDetails(client)).map((d) => [d.unit_id, d]));
  const differ = details.filter((d) => JSON.stringify(d) !== JSON.stringify(back.get(d.unit_id))).map((d) => d.unit_id);
  if (back.size !== details.length || differ.length) {
    throw new Error(`details differ after reading back (${back.size} files, expected ${details.length}${differ.length ? `; e.g. ${differ.slice(0, 5).join(", ")}` : ""}).`);
  }
  return n;
}
