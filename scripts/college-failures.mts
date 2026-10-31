/**
 * Rebuilds `reported.failures` on the data store: the colleges where the college-reported pipeline failed, one row
 * per college and reason code, for research (specs/college-data-failures.md), one document per college (as
 * scripts/import-data-from-git.mts groups data/college-failures.json). Derived only from the pipeline's state on the
 * store; no network beyond the store, no API key. A college-reported run derives it itself before it closes its
 * change set (scripts/lib/college-reported/derived.mts); this is for a rebuild on its own, and it also rebuilds
 * `health.colleges`, which reads the failures.
 *
 *   npm run college-failures -- --store supabase            # one change set (source college-reported)
 *   npm run college-failures -- --store file:/tmp/layers --dry-run   # prints the counts, writes nothing
 *   npm run college-failures -- --store supabase --change-set 42     # writes into an open change set
 *   npm run college-failures -- --date 2026-10-10           # the generation date (default today)
 *
 * Reads `reported.sources`, `reported.review_queue`, `reported.docs`, `reported.cds_records`, the blocked hosts
 * (`reference.files` blocked-hosts), the previous `reported.failures` (first_seen is kept for a college and reason
 * listed before), and the served colleges (`.data/snapshot/colleges.json`, else data/schools.json; `--schools <file>`).
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { emptySummaryV3 } from "./lib/college-reported/models.mts";
import { REPORTED_SOURCE, loadReportedState, readColleges, readMeta } from "./lib/college-reported/state.mts";
import { handleSink, writeDerived } from "./lib/college-reported/derived.mts";
import { storeFromFlag, type ChangeSetHandle } from "./lib/data-platform/store.mts";

const ROOT = join(import.meta.dirname, "..");

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    date: { type: "string" },
    store: { type: "string" },
    "change-set": { type: "string" },
    "run-ref": { type: "string" },
    schools: { type: "string" },
  },
});

async function main() {
  const store = storeFromFlag(values.store);
  const today = values.date ?? new Date().toISOString().slice(0, 10);
  const state = await loadReportedState(store, emptySummaryV3("college-failures", new Date().toISOString()));
  const served = readColleges(ROOT, values.schools);
  const meta = await readMeta(store, ROOT);
  const dry = values["dry-run"];
  const sink = { put() {}, drop() {} };
  let handle: ChangeSetHandle | null = null;
  if (!dry) {
    const id = values["change-set"] ? Number(values["change-set"]) : null;
    handle = id !== null ? await store.attach(id) : await store.open("pipeline", REPORTED_SOURCE, values["run-ref"] ?? `college-failures-${today}`);
  }
  const { failures } = await writeDerived(store, handle ? handleSink(handle) : sink, state, { served, metaRetrieved: meta?.retrieved ?? null, today });
  const listed = new Set(failures.rows.map((r) => r.unit_id)).size;
  console.log(`${failures.rows.length} failure rows for ${listed} colleges (as of ${failures.generated}):`);
  for (const [code, n] of Object.entries(failures.counts)) console.log(`  ${code.padEnd(26)} ${n}`);
  if (!handle) {
    console.log("Dry run; nothing written.");
    return;
  }
  // A set this script opened, it closes; one it was handed stays open for its owner.
  if (!values["change-set"]) await handle.close("applied");
  console.log(`Wrote reported.failures and health.colleges in change set ${handle.id}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
