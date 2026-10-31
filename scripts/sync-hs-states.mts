/**
 * Build a state's report card file (`high_schools.state`, one document per state) from its downloads, then recompute
 * medians (`high_schools.shared/medians`).
 *
 *   npm run sync-hs-states -- --store supabase --state ca
 *   npm run sync-hs-states -- --state ca,tx,ny
 *   npm run sync-hs-states -- --all             # every built adapter
 *   npm run sync-hs-states -- --state ca --dry-run
 *   npm run sync-hs-states -- --state ca --dir <folder>   # the old file layout in a folder instead of the store
 *
 * Adapters: scripts/lib/high-schools/states/{xx}.mts (registry: states/index.mts; contract: StateAdapter in
 * scripts/lib/high-schools/types.mts). Schools not in the state's shard move to `unmatched`; the file must pass
 * validateStateFile. Every state of one run goes into one change set (source `high-schools`;
 * scripts/lib/high-schools/data-store.mts); `--change-set <id>` writes into a set the workflow opened. A state that
 * fails is reported and the others are still written; the exit code is 1. specs/product/high-school-data.md.
 */
import { join } from "node:path";
import { STATE_ADAPTERS } from "./lib/high-schools/states/index.mts";
import { parseFlags } from "./lib/high-schools/context.mts";
import { SyncError, runStateSync } from "./lib/high-schools/sync.mts";
import { onHighSchoolFolder, writeHighSchoolChanges } from "./lib/high-schools/data-store.mts";
import { changeSetFromArgv, openProducerRun, storeFromArgv } from "./lib/data-platform/producer.mts";

const ROOT = join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const flags = parseFlags(argv);
const dryRun = flags["dry-run"] === true;

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

/** Runs every state on `outDir`; returns whether any failed and whether any was written. */
async function runStates(outDir: string): Promise<{ failed: boolean; written: boolean }> {
  let failed = false;
  let written = false;
  for (const code of codes) {
    const adapter = STATE_ADAPTERS[code];
    if (!adapter) {
      console.error(`${code}: no state adapter (known: ${Object.keys(STATE_ADAPTERS).join(", ")})`);
      failed = true;
      continue;
    }
    try {
      const r = await runStateSync({ root: ROOT, outDir, adapter, flags, offline: flags.offline === true, dryRun });
      written ||= r.written;
      const n = Object.keys(r.file.schools).length;
      console.log(`${adapter.state}: ${n} schools, ${r.file.sections.length} sections, ${r.file.unmatched?.length ?? 0} unmatched${r.written ? "; written" : " (dry run)"}.`);
    } catch (err) {
      failed = true;
      const problems = err instanceof SyncError ? err.problems : [];
      console.error(`${adapter.state}: ${err instanceof Error ? err.message : String(err)}`);
      for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
    }
  }
  return { failed, written };
}

let failed: boolean;
if (typeof flags.dir === "string") {
  failed = (await runStates(join(process.cwd(), flags.dir))).failed;
} else {
  const store = storeFromArgv(argv);
  const changeSet = changeSetFromArgv(argv);
  const ran = await onHighSchoolFolder(store, runStates);
  failed = ran.result.failed;
  if (!dryRun && ran.result.written) {
    const run = await openProducerRun(store, "high-schools", { changeSet });
    const changed = await writeHighSchoolChanges(run.handle, ran.before, ran.after);
    await run.finish("applied", undefined, { states: codes, documents_sent: changed.sent, documents_removed: changed.removed });
    console.log(`Change set ${run.handle.id}: ${changed.sent} documents sent, ${changed.removed} removed.`);
  }
}
process.exit(failed ? 1 : 0);
