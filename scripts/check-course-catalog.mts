/**
 * Checks the reference documents `ap-courses` and `ib-courses` in the bundled copy, the course catalogs the course
 * picker and the course plan read (specs/chances/rigor-in-context.md, course-plan.md): unique keys, known subjects and
 * major families, sequences that resolve, https pages. Exits 1 with one line per problem.
 *
 *   npm run check:course-catalog
 */
import { validateCatalogs } from "../lib/chances/catalog.ts";
import { readBundledReference } from "./lib/data-platform/bundled.mts";

type Catalog = Parameters<typeof validateCatalogs>[0];
const ap = readBundledReference<Catalog>("ap-courses");
const ib = readBundledReference<Catalog>("ib-courses");
const problems = validateCatalogs(ap, ib);
if (problems.length > 0) {
  console.error(`course catalogs: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`course catalogs: ok (${ap.courses.length} AP, ${ib.courses.length} IB)`);
