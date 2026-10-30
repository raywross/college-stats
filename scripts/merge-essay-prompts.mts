/**
 * Applies data/essay-prompts/records/ and the hand-read data/essay-prompts/confirmed/ (sources.md "The hand read") to
 * the committed data/schools.json (specs/product/essays/prompts.md "Store"), after checking
 * data/reference/platform-prompts.json, refusing to write on a lineage failure. No network. Both cite the college's own
 * words (source `college-site`), so data/meta.json needs nothing new and isn't written.
 *
 *   npm run merge-essay-prompts              # writes data/schools.json
 *   npm run merge-essay-prompts -- --dry-run # checks, writes nothing
 *
 * `npm run sync-data` applies the same records the same way, after the Coalition block.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateLineage } from "../lib/lineage.ts";
import type { DatasetMeta, School } from "../lib/types.ts";
import { formatSchools } from "./lib/identity-sync.mts";
import { applyEssays, confirmedProblems, platformProblems, summaryLine } from "./lib/essay-prompts/merge.mts";
import { essayPaths, readConfirmedRecords, readEssayRecords, readPlatformPrompts } from "./lib/essay-prompts/store.mts";

// MERGE_ESSAY_PROMPTS_ROOT lets tests point this at a scratch directory holding data/.
const ROOT = process.env.MERGE_ESSAY_PROMPTS_ROOT ?? join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const today = process.env.MERGE_ESSAY_PROMPTS_TODAY ?? new Date().toISOString().slice(0, 10);

try {
  const P = essayPaths(ROOT);
  const platform = platformProblems(readPlatformPrompts(P.platform));
  if (platform.length) throw new Error(`platform prompts check failed; nothing written:\n  ${platform.join("\n  ")}`);
  const schoolsPath = join(ROOT, "data", "schools.json");
  const schools: School[] = JSON.parse(readFileSync(schoolsPath, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
  const confirmed = readConfirmedRecords(P.confirmed);
  const hand = confirmedProblems(confirmed, today);
  if (hand.length) throw new Error(`hand-read records check failed; nothing written:\n  ${hand.join("\n  ")}`);
  const applied = applyEssays(schools, readEssayRecords(P.records), today, confirmed);
  const problems = validateLineage(applied.schools, meta);
  if (problems.length) {
    const more = problems.length > 30 ? `\n  … and ${problems.length - 30} more` : "";
    throw new Error(`lineage check failed (${problems.length}); nothing written:\n  ${problems.slice(0, 30).join("\n  ")}${more}`);
  }
  if (!dryRun) writeFileSync(schoolsPath, formatSchools(applied.schools));
  console.log(`essays: ${summaryLine(applied.summary)}${dryRun ? " (--dry-run, nothing written)" : ""}`);
} catch (err) {
  console.error(`merge-essay-prompts: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
