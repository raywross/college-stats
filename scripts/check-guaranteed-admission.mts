/**
 * Checks data/guaranteed-admission.json, the published automatic-admission programs (specs/chances/base-rates.md
 * "Automatic admission"): the cycle is current, every program names colleges in the dataset, has a threshold, falls
 * that include the cycle, and a quoted source. Exits 1 with one line per problem.
 *
 *   npm run check:guaranteed-admission
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateGuaranteed } from "../lib/chances/guaranteed.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: { unit_id: string }[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const file = JSON.parse(readFileSync(join(ROOT, "data", "guaranteed-admission.json"), "utf8"));
const problems = validateGuaranteed(file, new Date(), new Set(schools.map((s) => s.unit_id)));
if (problems.length > 0) {
  console.error(`data/guaranteed-admission.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`data/guaranteed-admission.json: ok (${file.programs.length} programs, fall ${file.cycle})`);
