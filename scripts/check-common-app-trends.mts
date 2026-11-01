/**
 * Checks the reference document `common-app-trends` in the bundled copy, the hand-reviewed national figures for "This
 * season on the Common App" (specs/data-expansion/common-app.md "National and state figures"): the schema, the
 * measures vocabulary, report ids, ISO dates, commonapp.org urls, page bounds, and that every quote contains its
 * value's digits. Exits 1 with one line per problem. The publisher's reference gate runs the same validator.
 *
 *   npm run check:common-app-trends
 */
import { validateCommonAppTrends } from "../lib/common-app/trends.ts";
import { readBundledReference } from "./lib/data-platform/bundled.mts";

const problems = validateCommonAppTrends(readBundledReference("common-app-trends"));
if (problems.length > 0) {
  console.error(`common-app-trends: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("common-app-trends: ok");
