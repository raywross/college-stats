/**
 * Merges data/college-reported.json into the committed data/schools.json, so the data PR itself carries the
 * site's figures (Decision 5, specs/college-reported-round-2.md) instead of waiting for someone to run
 * `npm run sync-data` by hand afterwards.
 *
 *   npm run merge-reported            # writes data/schools.json
 *   npm run merge-reported -- --dry-run   # prints what would change, writes nothing
 *
 * For every school, strips any existing `reported` block and every `reported.*` lineage record, then re-applies
 * the current `data/college-reported.json` entries (through `reportedToPatch`, exactly as `scripts/sync-data.mts`
 * does — both call `lib/reported-merge.ts#mergeReported`, so they can't disagree), then the newest groups from
 * `data/cds-records/` (enrollment, race, retention, graduation; lib/newest-groups.ts). A college dropped from
 * `college-reported.json` since the last merge loses its block. Refuses to write if the result fails
 * `validateLineage`. No network, no API key.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { validateLineage } from "../lib/lineage.ts";
import type { ReportedFile } from "../lib/reported.ts";
import { mergeReported } from "../lib/reported-merge.ts";
import { readRecords } from "./lib/college-reported/records.mts";

// MERGE_REPORTED_ROOT lets tests point this at a scratch directory holding just data/schools.json,
// data/college-reported.json, and data/meta.json, without copying the whole repo.
const ROOT = process.env.MERGE_REPORTED_ROOT ?? join(import.meta.dirname, "..");
const SCHOOLS = join(ROOT, "data", "schools.json");
const REPORTED = join(ROOT, "data", "college-reported.json");
const META = join(ROOT, "data", "meta.json");

const dryRun = process.argv.includes("--dry-run");

function main() {
  const schools: School[] = JSON.parse(readFileSync(SCHOOLS, "utf8"));
  const reported: ReportedFile = JSON.parse(readFileSync(REPORTED, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(META, "utf8"));

  // The CDS records (data/cds-records/) then supply the newest groups (specs/data-expansion/cds-student-body-and-outcomes.md).
  const records = readRecords(join(ROOT, "data", "cds-records"));
  const { schools: merged, merged: mergedCount, removed } = mergeReported(schools, reported, { records, meta });

  const problems = validateLineage(merged, meta);
  if (problems.length) {
    console.error(`merge-reported: lineage check failed (${problems.length}); nothing written:`);
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
    if (problems.length > 30) console.error(`  …and ${problems.length - 30} more`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`college-reported: ${mergedCount} colleges merged, ${removed} removed (--dry-run, nothing written)`);
    return;
  }

  // One school per line, same format as scripts/sync-data.mts, so a run's diff stays readable and the two
  // outputs are byte-identical when they agree.
  writeFileSync(SCHOOLS, `[\n${merged.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
  console.log(`college-reported: ${mergedCount} colleges merged, ${removed} removed`);
}

main();
