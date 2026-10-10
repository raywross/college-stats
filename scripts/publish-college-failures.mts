/**
 * Load data/college-failures.json into Supabase's college_data_failures table (specs/college-data-failures.md;
 * scripts/lib/publish-college-failures.mts).
 *
 *   npm run publish-college-failures              # the project in .env.local, or SUPABASE_URL/SUPABASE_SECRET_KEY
 *   npm run publish-college-failures -- --dry-run # count what would be upserted and resolved; write nothing
 *
 * Runs after each production deploy (.github/workflows/publish-changes.yml, job `college-failures`). Without
 * SUPABASE_URL/SUPABASE_SECRET_KEY it says so and exits 0. When the table isn't there yet (the migration not applied)
 * it warns and exits 0, so a deploy never fails on it; any other error exits 1.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseClient } from "../lib/supabase.ts";
import type { FailuresFile } from "./lib/college-failures.mts";
import { failuresTableProblem, loadCollegeFailures } from "./lib/publish-college-failures.mts";

const FILE = join(import.meta.dirname, "..", "data", "college-failures.json");
const DRY_RUN = process.argv.includes("--dry-run");

if (!existsSync(FILE)) {
  console.log("No data/college-failures.json (run npm run college-failures); nothing to load.");
  process.exit(0);
}
const file = JSON.parse(readFileSync(FILE, "utf8")) as FailuresFile;
console.log(`${file.rows.length} failure rows in data/college-failures.json (as of ${file.generated}).`);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.log("SUPABASE_URL or SUPABASE_SECRET_KEY is not set; nothing loaded.");
  process.exit(0);
}

const client = supabaseClient("publish");
const host = new URL(process.env.SUPABASE_URL).host;
const problem = await failuresTableProblem(client);
if (problem?.missing) {
  console.warn(`::warning::College data failures not loaded to ${host}: ${problem.message}`);
  process.exit(0);
}
if (problem) {
  console.error(`Load failed: ${problem.message}`);
  process.exit(1);
}

try {
  const r = await loadCollegeFailures(client, file.rows, { dryRun: DRY_RUN });
  console.log(`${DRY_RUN ? "Would upsert" : "Upserted"} ${r.upserted} rows and ${DRY_RUN ? "resolve" : "resolved"} ${r.resolved} on ${host}${DRY_RUN ? " (--dry-run)" : ""}.`);
} catch (err) {
  console.error(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
