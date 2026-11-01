/**
 * Checks the reference document `awards` in the bundled copy, the reviewed awards catalog the AwardsForm picker reads
 * (specs/chances/inputs-beyond-academics.md "Awards"): unique keys, a real tier, a giving body, an https source.
 * Exits 1 with one line per problem.
 *
 *   npm run check:awards-catalog
 */
import { validateAwardsCatalog } from "../lib/chances/awards-catalog.ts";
import { readBundledReference } from "./lib/data-platform/bundled.mts";

const file = readBundledReference<{ awards: unknown[] }>("awards");
const problems = validateAwardsCatalog(file);
if (problems.length > 0) {
  console.error(`awards: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`awards: ok (${file.awards.length} awards)`);
