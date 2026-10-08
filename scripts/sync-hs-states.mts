/**
 * Build data/high-schools/state/{xx}.json from a state's report card downloads, then recompute medians.json.
 *
 *   npm run sync-hs-states -- --state ca
 *   npm run sync-hs-states -- --state ca,tx,ny
 *   npm run sync-hs-states -- --all             # every built adapter
 *   npm run sync-hs-states -- --state ca --dry-run
 *
 * Adapters: scripts/lib/high-schools/states/{xx}.mts (registry: states/index.mts; contract: StateAdapter in
 * scripts/lib/high-schools/types.mts). Schools not in the state's shard move to `unmatched`; the file must pass
 * validateStateFile. HIGH_SCHOOLS_DIR (or --dir) writes elsewhere. specs/product/high-school-data.md.
 */
import { join } from "node:path";
import { highSchoolsDir } from "../lib/high-school-store.ts";
import { STATE_ADAPTERS } from "./lib/high-schools/states/index.mts";
import { parseFlags } from "./lib/high-schools/context.mts";
import { SyncError, runStateSync } from "./lib/high-schools/sync.mts";

const ROOT = join(import.meta.dirname, "..");
const flags = parseFlags(process.argv.slice(2));
const outDir = typeof flags.dir === "string" ? join(process.cwd(), flags.dir) : highSchoolsDir(process.env, ROOT);

const codes =
  flags.all === true
    ? Object.keys(STATE_ADAPTERS).filter((k) => STATE_ADAPTERS[k].built)
    : typeof flags.state === "string"
      ? flags.state.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];
if (!codes.length) {
  console.error(`Usage: npm run sync-hs-states -- --state <xx>[,<xx>] | --all   (adapters: ${Object.keys(STATE_ADAPTERS).join(", ")})`);
  process.exit(1);
}

let failed = false;
for (const code of codes) {
  const adapter = STATE_ADAPTERS[code];
  if (!adapter) {
    console.error(`${code}: no state adapter (known: ${Object.keys(STATE_ADAPTERS).join(", ")})`);
    failed = true;
    continue;
  }
  try {
    const { file, written } = await runStateSync({ root: ROOT, outDir, adapter, flags, offline: flags.offline === true, dryRun: flags["dry-run"] === true });
    const n = Object.keys(file.schools).length;
    console.log(`${adapter.state}: ${n} schools, ${file.sections.length} sections, ${file.unmatched?.length ?? 0} unmatched${written ? "; written" : " (dry run)"}.`);
  } catch (err) {
    failed = true;
    const problems = err instanceof SyncError ? err.problems : [];
    console.error(`${adapter.state}: ${err instanceof Error ? err.message : String(err)}`);
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
  }
}
process.exit(failed ? 1 : 0);
