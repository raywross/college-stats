/**
 * Applies the Common App block (specs/data-expansion/common-app.md "Store") to the committed data/schools.json from
 * the newest data/common-app/grid/*.json and data/common-app/members.json (written by `npm run sync-common-app`),
 * refreshes the Common App source and vintages in data/meta.json, and rebuilds data/aliases.json. No network.
 *
 *   npm run merge-common-app              # writes data/schools.json, data/meta.json, data/aliases.json
 *   npm run merge-common-app -- --dry-run # checks, writes nothing
 *
 * `npm run sync-data` and `npm run merge-reported` re-apply the same block from the same files.
 */
import { join } from "node:path";
import { mergeCommonApp, summaryLine } from "./lib/common-app/merge.mts";

// MERGE_COMMON_APP_ROOT lets tests point this at a scratch directory holding data/.
const ROOT = process.env.MERGE_COMMON_APP_ROOT ?? join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

try {
  const r = mergeCommonApp(ROOT, { dryRun });
  console.log(`common-app (${r.edition}): ${summaryLine(r)}; ${r.aliasRows} alias rows${dryRun ? " (--dry-run, nothing written)" : ""}`);
  if (r.duplicateMembers.length) console.warn(`  ⚠ members sharing an IPEDS id (first kept): ${r.duplicateMembers.join("; ")}`);
  if (r.duplicateRows.length) console.warn(`  ⚠ grid rows joined to the same college (first kept): ${r.duplicateRows.join("; ")}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
