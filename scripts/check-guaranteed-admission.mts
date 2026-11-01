/**
 * Checks the reference document `guaranteed-admission` in the bundled copy, the published automatic-admission programs
 * (specs/chances/base-rates.md "Automatic admission"): the cycle is current, every program names colleges in the
 * bundled colleges (not checked over the mini fixture), has a threshold, falls that include the cycle, and a quoted source. Exits 1 with one line per
 * problem. The publisher's reference gate runs the same validator.
 *
 *   npm run check:guaranteed-admission
 */
import { validateGuaranteed, type GuaranteedFile } from "../lib/chances/guaranteed.ts";
import { bundledUnitIdsForChecks, readBundledReference } from "./lib/data-platform/bundled.mts";

const file = readBundledReference<GuaranteedFile>("guaranteed-admission");
const problems = validateGuaranteed(file, new Date(), bundledUnitIdsForChecks());
if (problems.length > 0) {
  console.error(`guaranteed-admission: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`guaranteed-admission: ok (${file.programs.length} programs, fall ${file.cycle})`);
