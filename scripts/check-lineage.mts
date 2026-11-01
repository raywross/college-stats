/**
 * Checks that every value in the bundled copy (`.data/snapshot/`: the mini fixture in CI, the real snapshot locally
 * after `npm run fetch-snapshot`) can be traced to a source.
 *
 *   npm run check:lineage
 *
 * The colleges (`colleges.json` with its `meta.json`): every stored field is registered in lib/fields.ts, every
 * lineage record is complete, every release has a year, and the registry's derivations are sound (lib/lineage.ts).
 * History (`history/`, lib/history.ts): every series is registered in SERIES, every shard belongs to a college in the
 * snapshot, values are possible, and every file family cites a known source. Detail files (`detail/`): valid tables,
 * cited like the registry says, consistent with the colleges. High schools (`high-schools/`, when the snapshot carries
 * them; lib/high-school-core.ts): every shard row, state report file and profile detail file is valid and cited, meta
 * matches the shards, and medians.json equals a fresh computation.
 *
 * Not here: the CDS records (every passed value located and quoted, every document in the docs manifest) and the
 * legacy overrides' sources. Those are layers, not snapshot objects; the publisher's compose
 * (scripts/lib/data-platform/compose.mts) checks them and validateLineage fails the publish before anything is uploaded.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateLineage } from "../lib/lineage.ts";
import { validateHistoryMeta, validateShard, type HistoryMeta, type SchoolHistory } from "../lib/history.ts";
import { detailFileProblems, readDetails } from "./lib/publish-details.mts";
import { orphanSummaries } from "./lib/directories/merge.mts";
import { highSchoolFileProblems, readHighSchoolData } from "./lib/publish-high-schools.mts";
import { bundledHistoryUnits, bundledIsFixture, readBundledColleges, readBundledJson, readBundledMeta, requireBundled } from "./lib/data-platform/bundled.mts";

const SNAPSHOT = requireBundled();
const schools = readBundledColleges();
const meta = readBundledMeta();
const fixture = bundledIsFixture();

const problems = validateLineage(schools, meta);

// History: the shared meta (history/shared.json) and one shard per college.
const hmeta = readBundledJson<{ meta: HistoryMeta }>(join("history", "shared.json")).meta;
problems.push(...validateHistoryMeta(hmeta, meta));
const ids = new Set(schools.map((s) => s.unit_id));
const units = bundledHistoryUnits();
for (const unit of units) {
  const h: SchoolHistory = JSON.parse(readFileSync(join(SNAPSHOT, "history", `${unit}.json`), "utf8"));
  if (h.unit_id !== unit) problems.push(`history ${unit}.json: file name doesn't match unit_id ${h.unit_id}`);
  problems.push(...validateShard(h, ids));
}
// The mini fixture carries 38 shards under the real history meta (1,893); a real snapshot carries them all.
if (!fixture && units.length !== hmeta.schools) problems.push(`history meta says ${hmeta.schools} shards; the snapshot has ${units.length}`);

// Per-college detail files (lib/detail.ts): valid tables, cited like the registry says, consistent with the colleges.
const details = readDetails(join(SNAPSHOT, "detail"));
if (details) problems.push(...detailFileProblems(details, schools, meta));
// National directories (specs/campus-directories.md): a summary with no credited listings behind it.
problems.push(...orphanSummaries(schools, details ?? []));

// High schools (specs/product/high-school-data.md), when the snapshot carries them.
const highSchools = readHighSchoolData(join(SNAPSHOT, "high-schools"));
if (highSchools) problems.push(...highSchoolFileProblems(highSchools, { collegeIds: fixture ? undefined : ids }));

if (problems.length) {
  console.error(`Lineage check failed: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
  if (problems.length > 50) console.error(`  …and ${problems.length - 50} more`);
  process.exit(1);
}
const overridden = schools.filter((s) => s.lineage && Object.keys(s.lineage).length).length;
console.log(
  `Lineage OK${fixture ? " (the mini fixture)" : ""}: ${schools.length} colleges, ${overridden} with values from a non-default source` +
    `; ${units.length} college histories` +
    (details ? `; ${details.length} detail files` : "") +
    (highSchools ? `; ${highSchools.rows.length} high schools, ${highSchools.stateFiles.length} state report files, ${highSchools.details.length} profile details` : "") +
    "."
);
