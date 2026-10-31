import "server-only";
/**
 * The advisor's live hand-read prompts (the hand-read brief, "Changed by the owner, 2026-10-30 (later)": "if I'm making
 * changes in the admin page, I'd want them to take effect right away"). The console saves a college's prompts to
 * `public.essay_prompt_overrides` (supabase/migrations/20261030150000_essay_prompt_overrides.sql); the plan's colleges
 * (lib/planner/context.ts planSchools) and the essays lookup (lib/essays/load.ts promptLookup) lay the saved row over
 * the dataset's block with `overlayEssays` (lib/essay-prompts/confirmed.ts, pure: the merge's precedence), so the
 * Essays tab, the picker, the package, the editor's prompt heading, and the essays move see a save on the next load.
 * The public college page doesn't read the table: it shows the record the publisher composes into the next snapshot
 * from the same table (scripts/lib/data-platform/compose.mts, `confirmedFromRows`).
 *
 * One query per request and argument set (React `cache`); every reader may read the table (its policy is `using
 * (true)`). A missing table (the migration not applied yet) or any error is logged and reads as no rows: the advisor
 * then shows the dataset's block, never an error.
 */
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase-server";
import { overlayEssays, openCycleOf, type ConfirmedRecord } from "@/lib/essay-prompts/confirmed";
import type { School } from "@/lib/types";

const todayIso = () => new Date().toISOString().slice(0, 10);

/** The open cycle's rows (all of them for `ids` ""), by unit id. `ids` is the sorted, comma-joined list, so `cache` can key on it. */
const readRows = cache(async (ids: string, cycle: string): Promise<Map<string, ConfirmedRecord>> => {
  const out = new Map<string, ConfirmedRecord>();
  try {
    const supabase = await createServerSupabase();
    let q = supabase.from("essay_prompt_overrides").select("unit_id, record").eq("cycle", cycle);
    if (ids) q = q.in("unit_id", ids.split(","));
    const { data, error } = await q;
    if (error) {
      const missing = error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
      if (!missing) console.error(`essays: reading the hand-read prompts failed: ${error.message}`);
      return out;
    }
    for (const row of (data ?? []) as { unit_id: string; record: ConfirmedRecord | null }[]) {
      if (row.record && typeof row.record === "object") out.set(row.unit_id, row.record);
    }
  } catch (err) {
    console.error(`essays: reading the hand-read prompts failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
});

/**
 * The saved hand-read records for `unitIds` (every college's when null) in `cycle` (the open one by default), by unit
 * id, in one query. Never throws.
 */
export async function readEssayOverrides(unitIds: readonly string[] | null, cycle: string = openCycleOf(todayIso())): Promise<Map<string, ConfirmedRecord>> {
  if (unitIds && unitIds.length === 0) return new Map();
  const ids = unitIds ? [...new Set(unitIds)].filter((id) => /^\d{1,12}$/.test(id)).sort().join(",") : "";
  if (unitIds && !ids) return new Map();
  return readRows(ids, cycle);
}

/** The college with its saved row laid over its block (unchanged when there's no row or the block wins). */
export function withOverride(school: School, overrides: ReadonlyMap<string, ConfirmedRecord>, today: string = todayIso()): School {
  const row = overrides.get(school.unit_id);
  if (!row) return school;
  const essays = overlayEssays(school, row, today);
  if (essays === school.essays) return school;
  return { ...school, essays };
}

export { overlayEssays };
