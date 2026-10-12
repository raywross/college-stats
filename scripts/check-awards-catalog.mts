/**
 * Checks data/reference/awards.json, the reviewed awards catalog the AwardsForm picker reads
 * (specs/chances/inputs-beyond-academics.md "Awards"): unique keys, a real tier, a giving body, an https source.
 * Exits 1 with one line per problem.
 *
 *   npm run check:awards-catalog
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateAwardsCatalog } from "../lib/chances/awards-catalog.ts";

const ROOT = join(import.meta.dirname, "..");
const file = JSON.parse(readFileSync(join(ROOT, "data", "reference", "awards.json"), "utf8"));
const problems = validateAwardsCatalog(file);
if (problems.length > 0) {
  console.error(`data/reference/awards.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`data/reference/awards.json: ok (${file.awards.length} awards)`);
