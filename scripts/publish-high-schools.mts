/**
 * Publish data/high-schools/ to Supabase's high school tables (specs/product/high-school-data.md;
 * scripts/lib/publish-high-schools.mts). High schools stay a table: 35,000 rows searched by trigram
 * (specs/serving-architecture.md section 2).
 *
 *   npm run publish-high-schools              # the project in .env.local, or SUPABASE_URL/SUPABASE_SECRET_KEY
 *   npm run publish-high-schools -- --dry-run # check the files (and the tables, when configured); write nothing
 *
 * Steps: the same file checks as check:lineage (nothing invalid is published); then rows (state reports merged in),
 * profile details, meta and medians are written in batches and read back. When the high school tables aren't on the
 * project yet, it warns and exits 0, so a data merge never waits on the owner applying a migration. Without
 * SUPABASE_URL/SUPABASE_SECRET_KEY it says so after the file checks and exits 0.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { supabaseClient } from "../lib/supabase.ts";
import { highSchoolFileProblems, highSchoolTablesProblem, publishHighSchools, readHighSchoolData } from "./lib/publish-high-schools.mts";

const ROOT = join(import.meta.dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function fail(message: string): never {
  console.error(`Publish failed: ${message}`);
  process.exit(1);
}

const data = readHighSchoolData(join(ROOT, "data", "high-schools"));
if (!data) {
  console.log("No data/high-schools/ (run npm run sync-high-schools); nothing to publish.");
  process.exit(0);
}

const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as Pick<School, "unit_id">[];
const problems = highSchoolFileProblems(data, { collegeIds: new Set(schools.map((s) => s.unit_id)) });
if (problems.length) {
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  fail(`${problems.length} high school file problem(s); run npm run check:lineage.`);
}
console.log(`${data.rows.length.toLocaleString("en-US")} high schools and ${data.details.length.toLocaleString("en-US")} profile details checked.`);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.log("SUPABASE_URL or SUPABASE_SECRET_KEY is not set; nothing published.");
  process.exit(0);
}

const client = supabaseClient("publish");
const host = new URL(process.env.SUPABASE_URL).host;
const problem = await highSchoolTablesProblem(client);
// highSchoolTablesProblem names anything but a missing table "checking <table> failed": that one is retried, not skipped.
if (problem?.startsWith("checking ")) fail(problem);
if (problem) {
  console.warn(`Warning: high schools not published to ${host}: ${problem}`);
  process.exit(0);
}
if (DRY_RUN) {
  console.log(`Checks passed against ${host}; nothing written (--dry-run).`);
  process.exit(0);
}

const r = await publishHighSchools(client, data).catch((err: Error) => fail(err.message));
console.log(`Published ${r.schools} high schools and ${r.details} profile details to ${host}${r.removed ? ` (removed ${r.removed} old)` : ""}; read back and verified.`);
