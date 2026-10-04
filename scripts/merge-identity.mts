/**
 * Re-applies school identity (links, social accounts, colors and marks: lib/identity.ts) to the committed
 * data/schools.json and rebuilds data/aliases.json, without a full sync. No network, no API key.
 *
 *   npm run merge-identity              # writes data/schools.json, data/meta.json, data/aliases.json
 *   npm run merge-identity -- --dry-run # checks, writes nothing
 *
 * `npm run sync-wikidata`, the site probe, and the brand step call the same function after writing their files, so a
 * refresh reaches the site in the same data PR; a full `npm run sync-data` applies `applyIdentity` to a fresh build.
 */
import { join } from "node:path";
import { mergeIdentity } from "./lib/identity-sync.mts";

// MERGE_IDENTITY_ROOT lets tests point this at a scratch directory holding data/schools.json and data/meta.json.
const ROOT = process.env.MERGE_IDENTITY_ROOT ?? join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

try {
  const r = mergeIdentity(ROOT, { dryRun });
  console.log(
    `identity: ${r.schools} colleges; visit page ${r.withVisit}, social accounts ${r.withSocial}, colors ${r.withColors}, mark ${r.withLogo}${dryRun ? " (--dry-run, nothing written)" : ""}`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
