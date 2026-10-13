/**
 * Fails when data/college-health.json is missing or stale: rebuilds it in memory from its sources (college-docs,
 * cds-records, college-failures, review-queue, link-issues, the dataset's lineage) and compares it with the committed
 * file. Part of `npm run verify`. Fix: `npm run college-health`, then commit the file.
 *
 *   npm run check:college-health
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, buildCollegeHealth, differingColleges } from "./lib/college-health.mts";

const path = join(REPO_ROOT, "data", "college-health.json");
const { text, missing } = buildCollegeHealth(REPO_ROOT);
if (missing.length) {
  console.error(`data/college-health.json cannot be checked: missing ${missing.join(", ")}`);
  process.exit(1);
}
if (!existsSync(path)) {
  console.error("data/college-health.json does not exist. Run `npm run college-health` and commit the file.");
  process.exit(1);
}
const committed = readFileSync(path, "utf8");
if (committed !== text) {
  const differing = differingColleges(committed, text);
  console.error("data/college-health.json is stale: the sources it is built from have changed since it was written.");
  console.error(differing.length ? `  ${differing.length} college(s) differ, e.g. ${differing.slice(0, 5).join(", ")}` : "  the header differs (generated date or federal retrieval date)");
  console.error("Run `npm run college-health` and commit data/college-health.json.");
  process.exit(1);
}
console.log("data/college-health.json: ok");
