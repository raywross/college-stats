/**
 * The selectivity guard in `npm run verify` (specs/chances/selectivity-index.md "Data and lineage"), over the bundled
 * copy (`.data/snapshot/`). A snapshot carries no index file (the index never ships), so over a full snapshot the
 * check recomputes it from `colleges.json` and `meta.json` with hysteresis against the colleges' own tiers and asks:
 * the Elite count stays within 25–50, every tier holds a college, no tier moved without crossing its cutoff by the
 * hysteresis band, and the published tiers are a fresh build at the current SELECTIVITY_METHOD.
 *
 * Over a small snapshot (fewer than FULL_SNAPSHOT colleges: the mini fixture's 38) that comparison means nothing (the
 * method standardizes each input over every college, so 38 colleges score differently from the nation's 1,893), so it
 * checks consistency only, with a notice: a college has a tier exactly when its figures give it an index, every tier
 * (and pool tier) is a known one, and only an Ultra selective college sits in the top band. The publisher's compose
 * builds the real tiers with hysteresis on the real data; tests/selectivity.test.mts covers the rules.
 *
 * Always: the method scores its frozen sample (the reference document `selectivity-method`) as recorded, and the
 * index appears nowhere in public/ or in app code. Exits 1 with one line per problem.
 *
 *   npm run check:selectivity
 */
import type { School } from "../lib/types";
import { SELECTIVITY_TIERS } from "../lib/chances/levels.ts";
import { collegeIndex, rawInputs, scales } from "../lib/selectivity.ts";
import { buildSelectivity, leakProblems, selectivityProblems } from "./lib/selectivity.mts";
import { methodProblems, readMethodSample } from "./lib/selectivity-method.mts";
import { REPO_ROOT, readBundledColleges, readBundledMeta } from "./lib/data-platform/bundled.mts";

/** Below this many colleges a snapshot is a sample (the mini fixture), and only consistency is checked. */
export const FULL_SNAPSHOT = 200;

/** Consistency over any set of colleges: tiers where the figures give an index, known tiers, the top band only on Ultra. */
export function tierConsistencyProblems(schools: readonly School[]): string[] {
  const problems: string[] = [];
  const raws = schools.map(rawInputs);
  const sc = scales(raws);
  const known = new Set<string>(SELECTIVITY_TIERS);
  schools.forEach((s, i) => {
    const where = `${s.name} (${s.unit_id})`;
    const hasIndex = collegeIndex(raws[i], sc).all !== null;
    const sel = s.selectivity;
    if (hasIndex && !sel) problems.push(`${where}: its figures give an index but it has no tier`);
    if (!hasIndex && sel) problems.push(`${where}: has a tier but its figures give no index`);
    if (!sel) return;
    for (const [pool, tier] of [["all", sel.tier], ["in_state", sel.in_state], ["out_of_state", sel.out_of_state]] as const) {
      if (tier !== undefined && tier !== null && !known.has(tier)) problems.push(`${where}: ${pool} tier "${tier}" isn't a tier`);
    }
    if (sel.band === "top" && sel.tier !== "elite") problems.push(`${where}: in the top band but not Ultra selective`);
  });
  return problems;
}

const schools = readBundledColleges();
const meta = readBundledMeta();
const full = schools.length >= FULL_SNAPSHOT;
let elite: number | null = null;
const problems: string[] = [];
if (full) {
  const own = new Map(schools.map((s) => [s.unit_id, s.selectivity]));
  const { file } = buildSelectivity(schools, meta, { previous: own });
  problems.push(...selectivityProblems(schools, file, meta));
  elite = file.elite_count;
} else {
  problems.push(...tierConsistencyProblems(schools));
}
problems.push(...leakProblems(REPO_ROOT), ...methodProblems(readMethodSample()));
if (problems.length) {
  console.error(`selectivity: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  process.exit(1);
}
if (full) console.log(`selectivity: ok (Elite ${elite})`);
else {
  console.log(`selectivity: ok (${schools.length} colleges: tiers consistent, the method sample, the leak check)`);
  console.log(`  notice: the fresh-build comparison needs the full snapshot (${FULL_SNAPSHOT}+ colleges; npm run fetch-snapshot)`);
}
