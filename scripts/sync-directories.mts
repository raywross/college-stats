/**
 * Crawls national directories of campus chapters and groups and matches them to colleges (specs/campus-directories.md).
 *
 *   npm run sync-directories                          # every adapter
 *   npm run sync-directories -- --org ssa             # one (repeat --org, or comma-separate, for several)
 *   npm run sync-directories -- --domain faith        # faith | greek | lgbtq
 *   npm run sync-directories -- --refresh             # ignore the .cache/directories copies
 *   npm run sync-directories -- --max-age-days 7      # reuse cached pages younger than this (default 30)
 *   npm run sync-directories -- --dry-run             # crawl and match, print counts, write nothing
 *
 * Writes data/directories/<org>.json and unmatched/<org>.json per adapter, and data/directories/blocked.json for
 * lists that refuse us (never bypassed; owner decision 1). A failed or blocked adapter keeps its previous file. Then
 * run `npm run merge-directories` to put the listings into the dataset.
 */
import { join } from "node:path";
import { DIRECTORY_DOMAINS, type DirectoryDomain } from "../lib/directories.ts";
import { Blocked } from "./lib/directories/contract.mts";
import { createContext, directoryHttp, DEFAULT_MAX_AGE_DAYS } from "./lib/directories/context.mts";
import { loadMatchIndex } from "./lib/directories/colleges.mts";
import { clearBlocks, readBlocked, recordBlock, writeBlocked, writeOrgFiles } from "./lib/directories/files.mts";
import { loadAdapters } from "./lib/directories/registry.mts";
import { runAdapter } from "./lib/directories/run.mts";

const ROOT = process.env.SYNC_DIRECTORIES_ROOT ?? join(import.meta.dirname, "..");

function args(argv: string[]) {
  const orgs: string[] = [];
  let domain: DirectoryDomain | null = null;
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  let refresh = false;
  let dryRun = false;
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
    else throw new Error(`unknown argument ${a}`);
  }
  return { orgs, domain, maxAgeDays, refresh, dryRun };
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
  const index = loadMatchIndex(ROOT);
  const http = directoryHttp();
  let blocked = readBlocked(ROOT);
  let failed = 0;

  for (const adapter of adapters) {
    const ctx = createContext(adapter.key, { cacheDir: join(ROOT, ".cache", "directories"), maxAgeDays: opts.maxAgeDays, refresh: opts.refresh, today, http });
    try {
      const { file, unmatched, placeholders } = await runAdapter(adapter, ctx, index);
      const c = file.counts;
      console.log(
        `  ${adapter.key}: ${c.entries} entries → ${c.matched} matched (${c.multi} serving several colleges), ${c.unmatched} unmatched; ${c.colleges} colleges` +
          (placeholders ? `; ${placeholders} placeholder${placeholders === 1 ? "" : "s"} dropped` : "")
      );
      if (!opts.dryRun) {
        writeOrgFiles(ROOT, file, unmatched);
        blocked = clearBlocks(blocked, adapter.key);
      }
    } catch (err) {
      if (err instanceof Blocked) {
        console.log(`  ${adapter.key}: BLOCKED (${err.reason}) at ${err.url}; recorded in data/directories/blocked.json, previous file kept`);
        blocked = recordBlock(blocked, { org: adapter.key, url: err.url, reason: err.reason, detail: err.message }, today);
      } else {
        failed++;
        console.error(`  ${adapter.key}: FAILED: ${err instanceof Error ? err.message : String(err)} (previous file kept)`);
      }
    }
  }
  if (!opts.dryRun) writeBlocked(ROOT, blocked);
  console.log(opts.dryRun ? "Dry run: nothing written." : "Next: npm run merge-directories");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
