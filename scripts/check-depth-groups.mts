/**
 * Checks data/reference/depth-groups.json, the broad groups the estimate's depth themes read
 * (specs/chances/method/standing.md "Revision 3"): exactly the three groups, every course subject and activity family
 * placed, every named course in the catalog with a reason, athletics/service/faith outside, and published sources.
 * Exits 1 with one line per problem.
 *
 *   npm run check:depth-groups
 */
import { DEPTH_GROUPS, validateDepthGroups } from "../lib/chances/depth-groups.ts";

const problems = validateDepthGroups(DEPTH_GROUPS);
if (problems.length > 0) {
  console.error(`data/reference/depth-groups.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`data/reference/depth-groups.json: ok (${DEPTH_GROUPS.groups.length} groups, ${DEPTH_GROUPS.courses.length} courses named)`);
