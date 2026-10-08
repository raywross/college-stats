/**
 * Build data/high-schools/ from the federal files (CCD, EDFacts, CRDC) and the Private School Survey.
 *
 *   npm run sync-high-schools                     # every adapter
 *   npm run sync-high-schools -- --only ccd,pss   # just these; other adapters' fields stay as the shards have them
 *   npm run sync-high-schools -- --dry-run        # load, merge, and check; write nothing
 *   npm run sync-high-schools -- --offline        # cached downloads only (.cache/high-schools/)
 *   npm run sync-high-schools -- --allow-shrink   # allow dropping more than 10% of a kind's schools
 *
 * Adapters live in scripts/lib/high-schools/ (registry: index.mts; contract: types.mts; merge rules: merge.mts).
 * Writes schools/{XX}.json (one school per line, sorted), meta.json, and medians.json, after every row passes
 * validateHighSchoolRow and meta passes validateHighSchoolMeta. HIGH_SCHOOLS_DIR (or --dir) writes elsewhere.
 * specs/product/high-school-data.md.
 */
import { join } from "node:path";
import { highSchoolsDir } from "../lib/high-school-store.ts";
import { ADAPTERS } from "./lib/high-schools/index.mts";
import { parseFlags } from "./lib/high-schools/context.mts";
import { SyncError, runHighSchoolSync } from "./lib/high-schools/sync.mts";

const ROOT = join(import.meta.dirname, "..");
const flags = parseFlags(process.argv.slice(2));
const outDir = typeof flags.dir === "string" ? join(process.cwd(), flags.dir) : highSchoolsDir(process.env, ROOT);
const only = typeof flags.only === "string" ? flags.only.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

try {
  const { rows, report, notes, written } = await runHighSchoolSync({
    root: ROOT,
    outDir,
    adapters: ADAPTERS,
    only,
    flags,
    offline: flags.offline === true,
    dryRun: flags["dry-run"] === true,
    allowShrink: flags["allow-shrink"] === true,
  });
  for (const r of report) {
    console.log(r.skipped ? `  ${r.key}: nothing loaded; unchanged` : `  ${r.key}: +${r.added} added, ${r.updated} updated, −${r.removed} removed${r.unmatched ? `, ${r.unmatched} unmatched` : ""}${r.stray ? `, ${r.stray} stray entries dropped` : ""}`);
  }
  for (const n of notes) console.log(`  ${n}`);
  const pub = rows.filter((r) => r.kind === "public").length;
  console.log(`${written ? "Wrote" : "Checked (dry run)"} ${rows.length} high schools (${pub} public, ${rows.length - pub} private) in ${outDir}.`);
} catch (err) {
  if (err instanceof SyncError) {
    console.error(`sync-high-schools failed: ${err.message}`);
    for (const p of err.problems.slice(0, 30)) console.error(`  ${p}`);
    if (err.problems.length > 30) console.error(`  …and ${err.problems.length - 30} more`);
    process.exit(1);
  }
  throw err;
}
