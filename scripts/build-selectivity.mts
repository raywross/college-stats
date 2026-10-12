/**
 * Quad's selectivity (specs/chances/selectivity-index.md): rebuilds every college's tiers in data/schools.json
 * (`school.selectivity`) and the hidden index in data/selectivity-index.json from the committed dataset, with
 * hysteresis against the tiers already there. `npm run sync-data` runs the same step after it builds the dataset;
 * run this after anything else that changes admissions figures or trends (merge-reported, sync-history).
 *
 *   npm run build-selectivity              # writes data/schools.json and data/selectivity-index.json
 *   npm run build-selectivity -- --dry-run # prints the tiers, writes nothing
 *   npm run build-selectivity -- --list    # also prints the Elite colleges and a sample of each tier
 *
 * Running it twice changes nothing the second time. Refuses to write if the lineage check fails. No network.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { validateLineage } from "../lib/lineage.ts";
import { SELECTIVITY_TIERS, SELECTIVITY_TIER_LABELS } from "../lib/chances/levels.ts";
import { buildSelectivity, formatIndexFile, readIndexFile, selectivityProblems } from "./lib/selectivity.mts";

const ROOT = process.env.BUILD_SELECTIVITY_ROOT ?? join(import.meta.dirname, "..");
const SCHOOLS = join(ROOT, "data", "schools.json");
const META = join(ROOT, "data", "meta.json");
const INDEX = join(ROOT, "data", "selectivity-index.json");
const dryRun = process.argv.includes("--dry-run");
const list = process.argv.includes("--list") || dryRun;

function main() {
  const schools: School[] = JSON.parse(readFileSync(SCHOOLS, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(META, "utf8"));
  const { schools: built, file, changed } = buildSelectivity(schools, meta, { prior: readIndexFile(ROOT) });
  const problems = [...validateLineage(built, meta), ...selectivityProblems(built, file, meta)];
  if (problems.length) {
    console.error(`build-selectivity: checks failed (${problems.length}); nothing written:`);
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
    process.exit(1);
  }
  const summary = SELECTIVITY_TIERS.map((t) => `${SELECTIVITY_TIER_LABELS[t]} ${file.counts[t]}`).join(", ");
  console.log(`selectivity: ${summary}; not rated ${built.filter((s) => !s.selectivity).length}; Elite for some pool ${file.elite_count} (ELITE_INDEX ${file.elite_index}); ${changed} colleges changed`);
  if (list) {
    const byTier = (t: string) => built.filter((s) => s.selectivity?.tier === t);
    console.log(`\nElite: ${byTier("elite").map((s) => s.name).join("; ")}`);
    const poolElite = built.filter((s) => s.selectivity?.tier !== "elite" && (s.selectivity?.in_state === "elite" || s.selectivity?.out_of_state === "elite"));
    if (poolElite.length) console.log(`Elite for one pool: ${poolElite.map((s) => s.name).join("; ")}`);
    for (const t of SELECTIVITY_TIERS.slice(1)) console.log(`${SELECTIVITY_TIER_LABELS[t]} (sample): ${byTier(t).slice(0, 8).map((s) => s.name).join("; ")}`);
    const differ = built.filter((s) => s.selectivity?.in_state && s.selectivity.in_state !== s.selectivity.out_of_state);
    console.log(`\nPools differ (${differ.length}): ${differ.map((s) => `${s.name} (in-state ${s.selectivity!.in_state}, out of state ${s.selectivity!.out_of_state})`).join("; ")}`);
  }
  if (dryRun) {
    console.log("(--dry-run, nothing written)");
    return;
  }
  writeFileSync(SCHOOLS, `[\n${built.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
  writeFileSync(INDEX, formatIndexFile(file));
}

main();
