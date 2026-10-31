/**
 * Build the high-school layers from the federal files (CCD, EDFacts, CRDC) and the Private School Survey.
 *
 *   npm run sync-high-schools -- --store supabase           # every adapter, into the data project
 *   npm run sync-high-schools -- --store file:/tmp/dp       # a folder (the file store)
 *   npm run sync-high-schools -- --only ccd,pss   # just these; other adapters' fields stay as the shards have them
 *   npm run sync-high-schools -- --dry-run        # load, merge, and check; write nothing
 *   npm run sync-high-schools -- --offline        # cached downloads only (.cache/high-schools/)
 *   npm run sync-high-schools -- --allow-shrink   # allow dropping more than 10% of a kind's schools
 *   npm run sync-high-schools -- --dir <folder>   # the old file layout in a folder instead of the store
 *
 * Adapters live in scripts/lib/high-schools/ (registry: index.mts; contract: types.mts; merge rules: merge.mts).
 * Writes the state shards (`high_schools.schools`, one document per state), `meta` and `medians`
 * (`high_schools.shared`) after every row passes validateHighSchoolRow and meta passes validateHighSchoolMeta, in one
 * change set (source `high-schools`; scripts/lib/high-schools/data-store.mts runs the sync on a scratch copy of the
 * layers). `--change-set <id>` writes into a set the workflow opened. The publisher loads the tables when the layer
 * changed. specs/product/high-school-data.md, specs/data-platform/pipelines.md.
 */
import { join } from "node:path";
import { ADAPTERS } from "./lib/high-schools/index.mts";
import { parseFlags } from "./lib/high-schools/context.mts";
import { SyncError, runHighSchoolSync } from "./lib/high-schools/sync.mts";
import { onHighSchoolFolder, writeHighSchoolChanges } from "./lib/high-schools/data-store.mts";
import { changeSetFromArgv, openProducerRun, storeFromArgv } from "./lib/data-platform/producer.mts";

const ROOT = join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const flags = parseFlags(argv);
const only = typeof flags.only === "string" ? flags.only.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
const dryRun = flags["dry-run"] === true;

const sync = (outDir: string) =>
  runHighSchoolSync({
    root: ROOT,
    outDir,
    adapters: ADAPTERS,
    only,
    flags,
    offline: flags.offline === true,
    dryRun,
    allowShrink: flags["allow-shrink"] === true,
  });

try {
  let out: Awaited<ReturnType<typeof sync>>;
  let where: string;
  if (typeof flags.dir === "string") {
    where = join(process.cwd(), flags.dir);
    out = await sync(where);
  } else {
    const store = storeFromArgv(argv);
    const changeSet = changeSetFromArgv(argv);
    const ran = await onHighSchoolFolder(store, sync);
    out = ran.result;
    where = "the high_schools layers";
    if (!dryRun && out.written) {
      const run = await openProducerRun(store, "high-schools", { changeSet });
      let changed: { sent: number; removed: number };
      try {
        changed = await writeHighSchoolChanges(run.handle, ran.before, ran.after);
      } catch (err) {
        // Leaving the set open serves no one: hold it with why, so the console shows it instead of a stuck "open" run.
        await run.finish("held", `stopped: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500)).catch(() => {});
        throw err;
      }
      await run.finish("applied", undefined, { schools: out.rows.length, documents_sent: changed.sent, documents_removed: changed.removed });
      where = `${where} (change set ${run.handle.id}: ${changed.sent} documents sent, ${changed.removed} removed)`;
    }
  }
  const { rows, report, notes, written } = out;
  for (const r of report) {
    console.log(r.skipped ? `  ${r.key}: nothing loaded; unchanged` : `  ${r.key}: +${r.added} added, ${r.updated} updated, −${r.removed} removed${r.unmatched ? `, ${r.unmatched} unmatched` : ""}${r.stray ? `, ${r.stray} stray entries dropped` : ""}`);
  }
  for (const n of notes) console.log(`  ${n}`);
  const pub = rows.filter((r) => r.kind === "public").length;
  console.log(`${written ? "Wrote" : "Checked (dry run)"} ${rows.length} high schools (${pub} public, ${rows.length - pub} private) in ${where}.`);
} catch (err) {
  if (err instanceof SyncError) {
    console.error(`sync-high-schools failed: ${err.message}`);
    for (const p of err.problems.slice(0, 30)) console.error(`  ${p}`);
    if (err.problems.length > 30) console.error(`  …and ${err.problems.length - 30} more`);
    process.exit(1);
  }
  throw err;
}
