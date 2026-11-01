/**
 * Checks the reference document `major-admission` in the bundled copy, how colleges admit by school or major
 * (specs/chances/base-rates.md "Major", major-and-grades.md "Data"): every unit names a college in the bundled
 * colleges (not checked over the mini fixture), every value is quoted, and a gate's numbers appear in its quote. Exits 1 with one line per problem. The
 * publisher's reference gate runs the same validator.
 *
 *   npm run check:major-admission
 */
import { validateMajorAdmission, type MajorAdmissionFile } from "../lib/chances/major-admission.ts";
import { bundledUnitIdsForChecks, readBundledReference } from "./lib/data-platform/bundled.mts";

const file = readBundledReference<MajorAdmissionFile>("major-admission");
const problems = validateMajorAdmission(file, bundledUnitIdsForChecks());
if (problems.length > 0) {
  console.error(`major-admission: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`major-admission: ok (${file.units.length} units)`);
