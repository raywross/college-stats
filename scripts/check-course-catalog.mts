/**
 * Checks data/reference/ap-courses.json and ib-courses.json, the course catalogs the course picker and the course plan
 * read (specs/chances/rigor-in-context.md, course-plan.md): unique keys, known subjects and major families, sequences
 * that resolve, https pages. Exits 1 with one line per problem.
 *
 *   npm run check:course-catalog
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCatalogs } from "../lib/chances/catalog.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (f: string) => JSON.parse(readFileSync(join(ROOT, "data", "reference", f), "utf8"));
const ap = read("ap-courses.json");
const ib = read("ib-courses.json");
const problems = validateCatalogs(ap, ib);
if (problems.length > 0) {
  console.error(`course catalogs: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`course catalogs: ok (${ap.courses.length} AP, ${ib.courses.length} IB)`);
