/**
 * Rebuilds `health.colleges` (key `health`) on the data store: what the admin console's data health page needs per
 * college, reduced from the college-reported documents and records, the pipeline's failures and review queue, the
 * link prober's findings, and the served dataset's lineage (specs/product/admin.md). lib/admin/health.ts reads it from
 * the store. A college-reported run derives it itself before it closes its change set; this is for a rebuild on its
 * own (after an identity refresh, say). Deterministic: the same sources give the same bytes, and the only date in it is
 * the newest date the sources carry.
 *
 *   npm run college-health -- --store supabase             # one change set (source college-reported)
 *   npm run college-health -- --store supabase --change-set 42   # writes into an open change set
 *   npm run college-health -- --store file:/tmp/layers --dry-run # prints the size and counts, writes nothing
 *   npm run college-health -- --date 2026-10-10             # the `generated` date (default: newest date of the sources)
 *
 * Reads `reported.docs`, `reported.cds_records`, `reported.failures`, `reported.review_queue`, `identity.link_issues`,
 * `base.meta`, and the served colleges (the bundled copy, `.data/snapshot/colleges.json`; `--schools <file>`).
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { CompactHealth } from "../lib/admin/health-files.ts";
import { emptySummaryV3 } from "./lib/college-reported/models.mts";
import { REPORTED_SOURCE, loadReportedState, readColleges, readMeta } from "./lib/college-reported/state.mts";
import { HEALTH_KEY, deriveHealth, readFailureRows, readLinkIssueRows } from "./lib/college-reported/derived.mts";
import { COLLECTIONS } from "./lib/data-platform/layers.mts";
import { storeFromFlag } from "./lib/data-platform/store.mts";
import { readBundledColleges } from "./lib/data-platform/bundled.mts";

const REPO_ROOT = join(import.meta.dirname, "..");

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

function report(compact: CompactHealth, text: string) {
  const colleges = Object.values(compact.colleges);
  console.log(`college-health: ${colleges.length} colleges, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB, generated ${compact.generated}`);
  console.log(`  with a document ${colleges.filter((c) => c.docs.length).length}, open failures ${colleges.reduce((n, c) => n + c.failures.length, 0)}, queue items ${colleges.reduce((n, c) => n + c.queue, 0)}, dead links ${colleges.reduce((n, c) => n + c.linkIssues.length, 0)}`);
}

async function main() {
  const store = storeFromFlag(values.store);
  const state = await loadReportedState(store, emptySummaryV3("college-health", new Date().toISOString()));
  const rows = await readFailureRows(store);
  const generatedFailures = rows.reduce((acc, r) => (r.last_seen > acc ? r.last_seen : acc), "");
  const meta = await readMeta(store);
  const { compact, text } = deriveHealth({
    state,
    failures: { generated: generatedFailures, counts: {}, rows },
    linkIssues: await readLinkIssueRows(store),
    schools: values.schools ? readColleges(REPO_ROOT, values.schools) : readBundledColleges(),
    metaRetrieved: meta?.retrieved ?? null,
    generated: values.date,
  });
  report(compact, text);
  if (values["dry-run"]) {
    console.log("Dry run; nothing written.");
    return;
  }
  const id = values["change-set"] ? Number(values["change-set"]) : null;
  const handle = id !== null ? await store.attach(id) : await store.open("pipeline", REPORTED_SOURCE, values["run-ref"] ?? `college-health-${new Date().toISOString().slice(0, 10)}`);
  await handle.write(COLLECTIONS.health.colleges, [{ key: HEALTH_KEY, body: JSON.parse(text) }]);
  // A set this script opened, it closes; one it was handed stays open for its owner.
  if (id === null) await handle.close("applied");
  console.log(`Wrote health.colleges in change set ${handle.id}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
