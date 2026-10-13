/**
 * The selectivity guard in `npm run verify` (specs/chances/selectivity-index.md "Data and lineage"): the Elite count
 * stays within 25–50, every tier holds a college, no tier moved without crossing its cutoff by the hysteresis band,
 * data/selectivity-index.json is a fresh build of data/schools.json at the current SELECTIVITY_METHOD, the method
 * scores its frozen sample as recorded (scripts/lib/selectivity-method.mts), and the index appears nowhere in public/
 * or in app code. Exits 1 with one line per problem.
 *
 *   npm run check:selectivity
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { leakProblems, readIndexFile, selectivityProblems } from "./lib/selectivity.mts";
import { methodProblems, readMethodSample } from "./lib/selectivity-method.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const file = readIndexFile(ROOT);
const problems = [
  ...(file ? [...selectivityProblems(schools, file, meta), ...leakProblems(ROOT)] : ["data/selectivity-index.json is missing: run npm run build-selectivity"]),
  ...methodProblems(readMethodSample(ROOT)),
];
if (problems.length) {
  console.error(`selectivity: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`selectivity: ok (Elite ${file!.elite_count}, ELITE_INDEX ${file!.elite_index})`);
