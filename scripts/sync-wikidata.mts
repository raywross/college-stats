/**
 * Wikidata sync (specs/school-identity/social-accounts.md): social accounts, the Wikipedia article, the Commons
 * logo file, and other names for every college with a Wikidata item (P1771 = its IPEDS unit id).
 *
 *   npm run sync-wikidata -- --store supabase                  # the data project (default when DATA_SUPABASE_URL is set)
 *   npm run sync-wikidata -- --store file:/tmp/layers          # a folder (the file store)
 *   npm run sync-wikidata -- --change-set 42                   # write into the workflow's open change set
 *   npm run sync-wikidata -- --dry-run                         # query and count; write nothing
 *
 * Reads the colleges from the store (each college's own homepage, to resolve the rare unit id with two Wikidata items:
 * the base with identity applied, as the publisher composes it) and `identity.probe` (to flag disagreements with the
 * homepage's own footer links). Writes `identity.wikidata` and `identity.wikidata_issues`, one document per college,
 * in one change set (its own, source `identity-refresh`, unless `--change-set` names the workflow's). The publisher
 * applies them to the colleges (specs/data-platform/pipelines.md).
 */
import { join } from "node:path";
import { SOCIAL_NETWORKS } from "../lib/social.ts";
import { flagValue, storeFromFlag } from "./lib/data-platform/store.mts";
import { changeSetFlag, withRunSet } from "./lib/data-platform/change-set.mts";
import { readProbe, storeColleges, writeWikidata } from "./lib/identity-store.mts";
import { MIN_MATCHED_COLLEGES, assertEnoughMatches, buildWikidataEntries, fetchWikidataResults, rawItemsFromResults } from "./lib/wikidata.mts";

const ROOT = join(import.meta.dirname, "..");
const CACHE_DIR = join(ROOT, ".cache", "wikidata");
const argv = process.argv.slice(2);

async function main() {
  const store = storeFromFlag(flagValue(argv, "--store"));
  const dryRun = argv.includes("--dry-run");
  const schools = await storeColleges(store);
  if (!schools.length) throw new Error("the store has no colleges (base.colleges): import or sync the base first");
  const homepageByUnitId = new Map(schools.map((s) => [s.unit_id, s.links?.website ?? null]));
  const probeEntries = await readProbe(store);
  const probeByUnitId = new Map(probeEntries.map((p) => [p.unit_id, p] as const));

  console.log("Querying Wikidata (one request per property; see scripts/lib/wikidata.mts for why)…");
  const results = await fetchWikidataResults(CACHE_DIR);
  const rawItems = rawItemsFromResults(results);
  const retrieved = new Date().toISOString().slice(0, 10);
  const { entries, issues, duplicateUnitIds } = buildWikidataEntries(rawItems, homepageByUnitId, probeByUnitId, retrieved);

  // Fewer than MIN_MATCHED_COLLEGES means the query broke or Wikidata is down: fail loudly, write nothing.
  assertEnoughMatches(entries.length);

  if (!dryRun) await withRunSet(store, { source: "identity-refresh", changeSet: changeSetFlag(argv) }, (handle) => writeWikidata(store, handle, entries, issues));

  const withAny = entries.filter((e) => Object.keys(e.accounts).length > 0).length;
  const perNetwork = SOCIAL_NETWORKS.map((n) => `${n} ${entries.filter((e) => e.accounts[n]).length}`).join(", ");
  console.log(`\n${dryRun ? "Dry run, nothing written: " : "Wrote "}${entries.length} colleges to identity.wikidata (of ${schools.length} in the dataset; guard is ${MIN_MATCHED_COLLEGES})`);
  console.log(`  any account:  ${withAny}`);
  console.log(`  by network:   ${perNetwork}`);
  console.log(`  Commons logo: ${entries.filter((e) => e.logo_file).length}`);
  console.log(`  alt labels:   ${entries.filter((e) => e.alt_labels.length).length}`);
  console.log(`  duplicate unit ids (two items): ${duplicateUnitIds}`);
  console.log(`  issues logged: ${issues.length} (identity.wikidata_issues)${probeEntries.length ? "" : " — site probe hasn't run yet, so no homepage disagreements checked"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
