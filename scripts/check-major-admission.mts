/**
 * Checks data/major-admission.json, how colleges admit by school or major (specs/chances/base-rates.md "Major",
 * major-and-grades.md "Data"): every unit names a college in the dataset, every value is quoted, and a gate's numbers
 * appear in its quote. Exits 1 with one line per problem.
 *
 *   npm run check:major-admission
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateMajorAdmission } from "../lib/chances/major-admission.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: { unit_id: string }[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const file = JSON.parse(readFileSync(join(ROOT, "data", "major-admission.json"), "utf8"));
const problems = validateMajorAdmission(file, new Set(schools.map((s) => s.unit_id)));
if (problems.length > 0) {
  console.error(`data/major-admission.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`data/major-admission.json: ok (${file.units.length} units)`);
