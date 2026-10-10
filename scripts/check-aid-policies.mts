/**
 * Checks data/aid-policies.json, the colleges' published aid promises and rules (specs/product/cost-by-income.md
 * "Published promises"): every entry names a college in the dataset once, cites an https page with a real `checked`
 * date and an award year, and has sound thresholds and rules. Exits 1 with one line per problem.
 *
 *   npm run check:aid-policies
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateAidPolicies } from "../lib/aid-policies.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: { unit_id: string }[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const file = JSON.parse(readFileSync(join(ROOT, "data", "aid-policies.json"), "utf8"));
const problems = validateAidPolicies(file, new Set(schools.map((s) => s.unit_id)));
if (problems.length > 0) {
  console.error(`data/aid-policies.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`data/aid-policies.json: ok (${file.policies.length} colleges)`);
