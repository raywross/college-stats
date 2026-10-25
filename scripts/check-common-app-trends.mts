/**
 * Checks data/trends/common-app.json, the hand-reviewed national figures for "This season on the Common App"
 * (specs/data-expansion/common-app.md "National and state figures"; common-app-build/brief.md "U5"): the schema,
 * the measures vocabulary, report ids, ISO dates, commonapp.org urls, page bounds, and that every quote contains
 * its value's digits. Exits 1 with one line per problem.
 *
 *   npm run check:common-app-trends
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCommonAppTrends } from "../lib/common-app/trends.ts";

const path = join(import.meta.dirname, "..", "data", "trends", "common-app.json");
const problems = validateCommonAppTrends(JSON.parse(readFileSync(path, "utf8")));
if (problems.length > 0) {
  console.error(`data/trends/common-app.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("data/trends/common-app.json: ok");
