/**
 * Applies data/coalition/members.json to the committed data/schools.json and data/meta.json
 * (specs/data-expansion/coalition-app.md "Store"), refusing to write on a lineage failure. No network.
 *
 *   npm run merge-coalition              # writes data/schools.json and data/meta.json
 *   npm run merge-coalition -- --dry-run # checks, writes nothing
 *
 * `npm run sync-data` applies the same file the same way, after the Common App block.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateLineage } from "../lib/lineage.ts";
import type { DatasetMeta, School } from "../lib/types.ts";
import { addCoalitionMeta, applyCoalition, readCoalition, summaryLine } from "./lib/coalition/merge.mts";

// MERGE_COALITION_ROOT lets tests point this at a scratch directory holding data/.
const ROOT = process.env.MERGE_COALITION_ROOT ?? join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

try {
  const file = readCoalition(ROOT);
  if (!file) throw new Error("data/coalition/members.json is missing; run `npm run sync-coalition` first");
  const schoolsPath = join(ROOT, "data", "schools.json");
  const metaPath = join(ROOT, "data", "meta.json");
  const schools: School[] = JSON.parse(readFileSync(schoolsPath, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(metaPath, "utf8"));
  const applied = applyCoalition(schools, file);
  addCoalitionMeta(meta, file);
  const problems = validateLineage(applied.schools, meta);
  if (problems.length) {
    const more = problems.length > 30 ? `\n  … and ${problems.length - 30} more` : "";
    throw new Error(`lineage check failed (${problems.length}); nothing written:\n  ${problems.slice(0, 30).join("\n  ")}${more}`);
  }
  if (!dryRun) {
    writeFileSync(schoolsPath, `${JSON.stringify(applied.schools)}\n`);
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  }
  console.log(`coalition: ${summaryLine(applied.summary)}${dryRun ? " (--dry-run, nothing written)" : ""}`);
} catch (err) {
  console.error(`merge-coalition: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
