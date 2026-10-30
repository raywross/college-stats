/**
 * Exports the console's hand-read essay prompts (public.essay_prompt_overrides, the hand-read brief "Git catches up
 * nightly") into data/essay-prompts/confirmed/<unit_id>.json, then applies them to data/schools.json with
 * `npm run merge-essay-prompts` (which refuses to write on a bad record or a lineage failure). The directory mirrors
 * the table's open-cycle rows (scripts/lib/essay-prompts/export-confirmed.mts). `.github/workflows/essay-confirmed.yml`
 * runs it nightly and opens a data PR when anything changed.
 *
 *   npm run export-essay-confirmed              # read the table, write the files, run the merge
 *   npm run export-essay-confirmed -- --dry-run # print what would change, write nothing
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (the publish-changes workflow's names; environment variables win over
 * .env.local). Without them it says so and exits 0 having written nothing. EXPORT_ESSAY_CONFIRMED_ROOT points it at a
 * scratch directory holding data/ (tests).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { supabaseClient } from "../lib/supabase.ts";
import { essayPaths } from "./lib/essay-prompts/store.mts";
import { applyExport, exportLine, planExport, readConfirmedFiles, type OverrideRow } from "./lib/essay-prompts/export-confirmed.mts";

const ROOT = process.env.EXPORT_ESSAY_CONFIRMED_ROOT ?? join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const today = new Date().toISOString().slice(0, 10);

async function main(): Promise<number> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.log("::notice::SUPABASE_URL or SUPABASE_SECRET_KEY is not set; nothing exported.");
    return 0;
  }
  const client = supabaseClient("publish");
  const { data, error } = await client.from("essay_prompt_overrides").select("unit_id, cycle, record").order("unit_id");
  if (error) throw new Error(`reading essay_prompt_overrides failed: ${error.message}`);
  const dir = essayPaths(ROOT).confirmed;
  const plan = planExport((data ?? []) as OverrideRow[], readConfirmedFiles(dir), today);
  console.log(`essay-confirmed: ${exportLine(plan)}${dryRun ? " (--dry-run, nothing written)" : ""}`);
  for (const s of plan.skipped) console.log(`::warning::essay-confirmed skipped ${s}`);
  if (dryRun) return 0;
  applyExport(dir, plan);
  const merge = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(import.meta.dirname, "merge-essay-prompts.mts")], {
    stdio: "inherit",
    env: { ...process.env, MERGE_ESSAY_PROMPTS_ROOT: ROOT },
  });
  return merge.status ?? 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`export-essay-confirmed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
