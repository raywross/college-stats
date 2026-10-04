/**
 * publish-data's short-names step (lib/aliases.ts; specs/school-identity/aliases.md): check school_aliases exists,
 * replace every row in one transaction (supabase/migrations/20261004120000_school_aliases.sql — the table is small,
 * ~400 KB for ~4,000 rows, so unlike schools and history it needs no staging), and read it back.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AliasRow } from "../../lib/identity-files.ts";
import { fetchAllAliasRows } from "../../lib/supabase.ts";

export const ALIASES_MIGRATION = "supabase/migrations/20261004120000_school_aliases.sql";

/** Null when school_aliases exists; otherwise what's wrong (most likely the migration isn't applied). */
export async function aliasesTableProblem(client: SupabaseClient): Promise<string | null> {
  const { error } = await client.from("school_aliases").select("unit_id").limit(1);
  if (!error) return null;
  const what = [error.message, error.code].filter(Boolean).join(" · ") || "no error message";
  return error.code === "42P01" || error.code === "PGRST205" ? `${what}. Apply ${ALIASES_MIGRATION} first.` : `checking school_aliases failed: ${what}.`;
}

/** Replaces every row in one transaction (publish_aliases), then reads it all back. Throws on any failure. */
export async function publishAliases(client: SupabaseClient, rows: readonly AliasRow[]): Promise<number> {
  if (!rows.length) throw new Error("no aliases to publish");
  const { data, error } = await client.rpc("publish_aliases", { p_aliases: rows });
  if (error) throw new Error(`publishing aliases failed: ${error.message}`);

  const back = new Map((await fetchAllAliasRows(client)).map((r) => [`${r.unit_id}\u0000${r.key}`, r]));
  const key = (r: AliasRow) => `${r.unit_id}\u0000${r.key}`;
  const differ = rows.filter((r) => JSON.stringify(r) !== JSON.stringify(back.get(key(r)))).map((r) => `${r.unit_id}/${r.key}`);
  if (back.size !== rows.length || differ.length) {
    throw new Error(`aliases differ after reading back (${back.size} rows, expected ${rows.length}${differ.length ? `; e.g. ${differ.slice(0, 5).join(", ")}` : ""}).`);
  }
  return data as number;
}
