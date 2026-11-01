/**
 * Crawls national directories of campus chapters and groups and matches them to colleges (specs/campus-directories.md).
 *
 *   npm run sync-directories -- --store supabase      # every adapter (--store file:<dir> for a folder)
 *   npm run sync-directories -- --org ssa             # one (repeat --org, or comma-separate, for several)
 *   npm run sync-directories -- --domain faith        # faith | greek | lgbtq
 *   npm run sync-directories -- --refresh             # ignore the .cache/directories copies
 *   npm run sync-directories -- --max-age-days 7      # reuse cached pages younger than this (default 30)
 *   npm run sync-directories -- --change-set 42       # write into a workflow's open change set
 *   npm run sync-directories -- --dry-run             # crawl and match, print counts, write nothing
 *
 * Writes `directories.listings` and `directories.unmatched` per adapter and `directories.blocked` for lists that
 * refuse us (never bypassed; owner decision 1), in one change set (source `directories`). A failed or blocked adapter
 * keeps its previous documents. The publisher puts the listings into the dataset.
 */
import { join } from "node:path";
import { DIRECTORY_DOMAINS, type DirectoryDomain } from "../lib/directories.ts";
import { createContext, directoryHttp, DEFAULT_MAX_AGE_DAYS } from "./lib/directories/context.mts";
import { loadAdapters } from "./lib/directories/registry.mts";
import { matchIndexFromStore, syncDirectories } from "./lib/directories/store.mts";
import { storeFromFlag, type ChangeSetHandle } from "./lib/data-platform/store.mts";
import { withRunSet } from "./lib/data-platform/change-set.mts";
import { storeColleges } from "./lib/identity-store.mts";

const ROOT = process.env.SYNC_DIRECTORIES_ROOT ?? join(import.meta.dirname, "..");

function args(argv: string[]) {
  const orgs: string[] = [];
  let domain: DirectoryDomain | null = null;
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  let refresh = false;
  let dryRun = false;
  let store: string | undefined;
  let changeSet: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--org") orgs.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (a === "--domain") {
      const d = argv[++i] as DirectoryDomain;
      if (!DIRECTORY_DOMAINS.includes(d)) throw new Error(`--domain must be one of ${DIRECTORY_DOMAINS.join(", ")}`);
      domain = d;
    } else if (a === "--max-age-days") maxAgeDays = Number(argv[++i]);
    else if (a === "--refresh") refresh = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--store") store = argv[++i];
    else if (a.startsWith("--store=")) store = a.slice("--store=".length);
    else if (a === "--change-set") changeSet = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return { orgs, domain, maxAgeDays, refresh, dryRun, store, changeSet };
}

async function main() {
  const opts = args(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const all = await loadAdapters();
  const unknown = opts.orgs.filter((o) => !all.some((a) => a.key === o));
  if (unknown.length) throw new Error(`no adapter named ${unknown.join(", ")} (have: ${all.map((a) => a.key).join(", ")})`);
  const adapters = all.filter((a) => (!opts.orgs.length || opts.orgs.includes(a.key)) && (!opts.domain || a.domain === opts.domain));
  if (!adapters.length) throw new Error("no adapters selected");

  console.log(`sync-directories: ${adapters.length} adapter${adapters.length === 1 ? "" : "s"} (${adapters.map((a) => a.key).join(", ")})`);
  const store = storeFromFlag(opts.store);
  const schools = await storeColleges(store);
  if (!schools.length) throw new Error("the store has no colleges (base.colleges): import or sync the base first");
  const index = await matchIndexFromStore(store, schools, ROOT);
  const http = directoryHttp();
  const contextFor = (adapter: { key: string }) => createContext(adapter.key, { cacheDir: join(ROOT, ".cache", "directories"), maxAgeDays: opts.maxAgeDays, refresh: opts.refresh, today, http });
  const run = (handle: ChangeSetHandle | null) => syncDirectories(store, handle, adapters, { index, today, contextFor });

  const result = opts.dryRun ? await run(null) : await withRunSet(store, { source: "directories", changeSet: opts.changeSet }, run);
  console.log(opts.dryRun ? "Dry run: nothing written." : `Wrote ${result.written.length} adapters' documents; the publisher puts them live.`);
  if (result.failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
