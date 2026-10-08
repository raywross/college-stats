/**
 * Checks data/application-cycle.json, the dates that apply to every applicant in a cycle (specs/planner/timeline.md
 * "The cycle file"): the schema, the `applies` vocabulary the planner understands, real dates inside each cycle, and
 * an https source on every entry. Exits 1 with one line per problem.
 *
 *   npm run check:cycle
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCycleFile } from "../lib/planner/cycle.ts";

const path = join(import.meta.dirname, "..", "data", "application-cycle.json");
const problems = validateCycleFile(JSON.parse(readFileSync(path, "utf8")));
if (problems.length > 0) {
  console.error(`data/application-cycle.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("data/application-cycle.json: ok");
