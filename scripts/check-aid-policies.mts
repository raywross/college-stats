/**
 * Checks the reference document `aid-policies` in the bundled copy, the colleges' published aid promises and rules
 * (specs/product/cost-by-income.md "Published promises"): every entry names a college in the bundled colleges once (not checked over the mini fixture, which holds 38),
 * cites an https page with a real `checked` date and an award year, and has sound thresholds and rules. Exits 1 with
 * one line per problem. The publisher's reference gate runs the same validator at publish time.
 *
 *   npm run check:aid-policies
 */
import { validateAidPolicies, type AidPolicyFile } from "../lib/aid-policies.ts";
import { bundledUnitIdsForChecks, readBundledReference } from "./lib/data-platform/bundled.mts";

const file = readBundledReference<AidPolicyFile>("aid-policies");
const problems = validateAidPolicies(file, bundledUnitIdsForChecks());
if (problems.length > 0) {
  console.error(`aid-policies: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`aid-policies: ok (${file.policies.length} colleges)`);
