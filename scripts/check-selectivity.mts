/**
 * The selectivity guard in `npm run verify` (specs/chances/selectivity-index.md "Data and lineage"), over the bundled
 * copy (`.data/snapshot/`). A snapshot carries no index file (the index never ships), so the check recomputes it from
 * `colleges.json` and `meta.json` with hysteresis against the colleges' own tiers and then asks: the Elite count stays
 * within 25–50, every tier holds a college, no tier moved without crossing its cutoff by the hysteresis band, and the
 * published tiers are a fresh build at the current SELECTIVITY_METHOD. Over the mini fixture that part is skipped (the
 * method standardizes each input over every college, so 38 colleges score differently from the nation's 1,893; the
 * publisher builds the real tiers, tests/selectivity.test.mts covers the rules). Always: the method scores its frozen
 * sample (the reference document `selectivity-method`) as recorded, and the index appears nowhere in public/ or in app
 * code. Exits 1 with one line per problem.
 *
 *   npm run check:selectivity
 */
import { buildSelectivity, leakProblems, selectivityProblems } from "./lib/selectivity.mts";
import { methodProblems, readMethodSample } from "./lib/selectivity-method.mts";
import { REPO_ROOT, bundledIsFixture, readBundledColleges, readBundledMeta } from "./lib/data-platform/bundled.mts";

const schools = readBundledColleges();
const meta = readBundledMeta();
const fixture = bundledIsFixture();
let elite: number | null = null;
const problems: string[] = [];
if (!fixture) {
  const own = new Map(schools.map((s) => [s.unit_id, s.selectivity]));
  const { file } = buildSelectivity(schools, meta, { previous: own });
  problems.push(...selectivityProblems(schools, file, meta));
  elite = file.elite_count;
}
problems.push(...leakProblems(REPO_ROOT), ...methodProblems(readMethodSample()));
if (problems.length) {
  console.error(`selectivity: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  process.exit(1);
}
console.log(fixture ? "selectivity: ok (the mini fixture: the method sample and the leak check; tiers are checked over a real snapshot)" : `selectivity: ok (Elite ${elite})`);
