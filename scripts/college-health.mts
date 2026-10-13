/**
 * Writes data/college-health.json: what the admin console's data health page needs per college, reduced from the
 * college-reported documents and records, the pipeline's failures and review queue, the link prober's findings, and
 * the dataset's lineage (specs/product/admin.md "Files the deploy must carry"). The deployed page reads only this
 * file (about 1 MB; its sources are 42 MB). Deterministic: the same sources always give the same bytes, and the only
 * date in it is the newest date the sources carry.
 *
 *   npm run college-health              # writes data/college-health.json
 *   npm run college-health -- --dry-run # prints the size and counts, writes nothing
 *   npm run college-health -- --date 2026-10-10   # the `generated` date (default: newest date of the sources)
 *
 * Run it after anything that changes its sources (merge-reported, college-failures, the identity refresh, sync-data);
 * `npm run check:college-health` (part of `npm run verify`) fails when the committed file is stale.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT, buildCollegeHealth } from "./lib/college-health.mts";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, date: { type: "string" } } });

const { compact, text, missing } = buildCollegeHealth(REPO_ROOT, { generated: values.date });
if (missing.length) {
  console.error(`college-health: missing ${missing.join(", ")}`);
  process.exit(1);
}

const colleges = Object.values(compact.colleges);
console.log(`college-health: ${colleges.length} colleges, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB, generated ${compact.generated}`);
console.log(`  with a document ${colleges.filter((c) => c.docs.length).length}, open failures ${colleges.reduce((n, c) => n + c.failures.length, 0)}, queue items ${colleges.reduce((n, c) => n + c.queue, 0)}, dead links ${colleges.reduce((n, c) => n + c.linkIssues.length, 0)}`);
if (values["dry-run"]) process.exit(0);
writeFileSync(join(REPO_ROOT, "data", "college-health.json"), text);
console.log("wrote data/college-health.json");
