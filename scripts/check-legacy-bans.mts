/**
 * Checks the reference document legacy-bans, the states that have enacted a ban on legacy preference in admissions
 * (specs/chances/inputs-beyond-academics.md "Legacy"): sorted, one row per known USPS state, sectors are
 * "public"/"private" only and don't repeat, dates are YYYY-MM-DD, and every row cites an https source. Exits 1 with
 * one line per problem.
 *
 *   npm run check:legacy-bans
 */
import { STATES } from "../lib/states.ts";
import { LEGACY_BANS, validateLegacyBans } from "../lib/chances/legacy-bans.ts";

const knownStates = new Set([...STATES.values()].map((s) => s.postal));
const problems = validateLegacyBans(LEGACY_BANS, knownStates);
if (problems.length > 0) {
  console.error(`the reference document legacy-bans: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`the reference document legacy-bans: ok (${LEGACY_BANS.bans.length} states)`);
