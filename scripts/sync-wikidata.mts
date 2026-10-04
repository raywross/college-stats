/**
 * Wikidata sync (specs/school-identity/social-accounts.md): social accounts, the Wikipedia article, the Commons
 * logo file, and other names for every college with a Wikidata item (P1771 = its IPEDS unit id).
 *
 *   npm run sync-wikidata
 *
 * Reads data/schools.json (each college's own homepage, to resolve the rare unit id with two Wikidata items) and
 * data/site-probe.json when the site probe has already run (to flag disagreements with the homepage's own footer
 * links; an empty list until then). Writes data/wikidata.json and data/wikidata-issues.json, then calls
 * mergeIdentity so `school.social` and meta.json's retrieval date are refreshed on the committed data/schools.json
 * without a full sync.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { SiteProbeEntry } from "../lib/identity-files";
import { SOCIAL_NETWORKS } from "../lib/social.ts";
import { mergeIdentity } from "./lib/identity-sync.mts";
import { MIN_MATCHED_COLLEGES, assertEnoughMatches, buildWikidataEntries, fetchWikidataResults, rawItemsFromResults } from "./lib/wikidata.mts";

const ROOT = join(import.meta.dirname, "..");
const SCHOOLS = join(ROOT, "data", "schools.json");
const PROBE = join(ROOT, "data", "site-probe.json");
const OUT = join(ROOT, "data", "wikidata.json");
const ISSUES = join(ROOT, "data", "wikidata-issues.json");
const CACHE_DIR = join(ROOT, ".cache", "wikidata");

async function main() {
  const schools: School[] = JSON.parse(readFileSync(SCHOOLS, "utf8"));
  const homepageByUnitId = new Map(schools.map((s) => [s.unit_id, s.links?.website ?? null]));
  const probeEntries: SiteProbeEntry[] = existsSync(PROBE) ? JSON.parse(readFileSync(PROBE, "utf8")) : [];
  const probeByUnitId = new Map(probeEntries.map((p) => [p.unit_id, p] as const));

  console.log("Querying Wikidata (one request per property; see scripts/lib/wikidata.mts for why)…");
  const results = await fetchWikidataResults(CACHE_DIR);
  const rawItems = rawItemsFromResults(results);
  const retrieved = new Date().toISOString().slice(0, 10);
  const { entries, issues, duplicateUnitIds } = buildWikidataEntries(rawItems, homepageByUnitId, probeByUnitId, retrieved);

  // Fewer than MIN_MATCHED_COLLEGES means the query broke or Wikidata is down: fail loudly, write nothing.
  assertEnoughMatches(entries.length);

  writeFileSync(OUT, `[\n${entries.map((e) => JSON.stringify(e)).join(",\n")}\n]\n`);
  writeFileSync(ISSUES, `${JSON.stringify(issues, null, 2)}\n`);

  const withAny = entries.filter((e) => Object.keys(e.accounts).length > 0).length;
  const perNetwork = SOCIAL_NETWORKS.map((n) => `${n} ${entries.filter((e) => e.accounts[n]).length}`).join(", ");
  console.log(`\nWrote ${entries.length} colleges to data/wikidata.json (of ${schools.length} in the dataset; guard is ${MIN_MATCHED_COLLEGES})`);
  console.log(`  any account:  ${withAny}`);
  console.log(`  by network:   ${perNetwork}`);
  console.log(`  Commons logo: ${entries.filter((e) => e.logo_file).length}`);
  console.log(`  alt labels:   ${entries.filter((e) => e.alt_labels.length).length}`);
  console.log(`  duplicate unit ids (two items): ${duplicateUnitIds}`);
  console.log(`  issues logged: ${issues.length} (data/wikidata-issues.json)${probeEntries.length ? "" : " — site probe hasn't run yet, so no homepage disagreements checked"}`);

  const r = mergeIdentity(ROOT);
  console.log(`\nmerge-identity: ${r.schools} colleges; social accounts now on ${r.withSocial}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
