/**
 * Checks the reference document `application-cycle` in the bundled copy, the dates that apply to every applicant in a
 * cycle (specs/planner/timeline.md "The cycle file"): the schema, the `applies` vocabulary the planner understands,
 * real dates inside each cycle, and an https source on every entry. Exits 1 with one line per problem. The publisher's
 * reference gate runs the same validator.
 *
 *   npm run check:cycle
 */
import { validateCycleFile } from "../lib/planner/cycle.ts";
import { readBundledReference } from "./lib/data-platform/bundled.mts";

const problems = validateCycleFile(readBundledReference("application-cycle"));
if (problems.length > 0) {
  console.error(`application-cycle: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("application-cycle: ok");
