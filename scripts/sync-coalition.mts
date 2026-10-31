/**
 * Reads the Coalition for College member list and Scoir's list of colleges taking applications through it, joins the
 * names to the site's colleges, and writes the `coalition.members` document through the data store
 * (specs/data-expansion/coalition-app.md; specs/data-platform/pipelines.md), in one change set (source `coalition`).
 * The publisher applies it; no file under data/ is written.
 *
 *   npm run sync-coalition -- --store supabase              # two requests, then the document
 *   npm run sync-coalition -- --store file:/tmp/dp          # a folder (the file store)
 *   npm run sync-coalition -- --dry-run                     # reads and joins, writes nothing
 *   npm run sync-coalition -- --from-files <members.html> <scoir.html>   # saved pages, no network (tests, reruns)
 *
 * Both pages go through PoliteHttp (robots.txt honored, the honest user agent). Checks (coalition-app.md "Checks"):
 * 100–300 distinct member names, at least 50 Scoir names, at most 10% of either list unmatched; otherwise exit 1 and
 * nothing is written, with the names to add to the hand map (`coalition.name_map`) printed. The hand map is read from
 * the store; the colleges and aliases it joins against are the base layer's (`base.colleges`, `base.aliases`). `--change-set <id>`
 * writes into a set the workflow opened.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AliasRow } from "../lib/aliases.ts";
import { COALITION_MEMBERS_URL, SCOIR_LIST_URL } from "../lib/coalition.ts";
import type { School } from "../lib/types.ts";
import { PoliteHttp } from "./lib/college-reported/http.mts";
import { buildCoalitionFile, coalitionDocument } from "./lib/coalition/sync.mts";
import { COLLECTIONS, SINGLE_KEYS } from "./lib/data-platform/layers.mts";
import { changeSetFromArgv, datasetAliases, datasetColleges, openProducerRun, storeFromArgv } from "./lib/data-platform/producer.mts";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fromAt = args.indexOf("--from-files");
const FROM_FILES = fromAt >= 0 ? { members: args[fromAt + 1], scoir: args[fromAt + 2] } : null;
if (FROM_FILES && (!FROM_FILES.members || !FROM_FILES.scoir)) {
  console.error("sync-coalition: --from-files takes two paths, the member page and Scoir's page");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const http = new PoliteHttp({
  fetch: (input, init) => globalThis.fetch(input, init),
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  minDelayMs: 1000,
  log: (m) => console.log(m),
  timeoutMs: 60_000,
  maxBytes: 20 * 1024 * 1024,
});

async function page(url: string): Promise<string> {
  const res = await http.get(url);
  if (!res) throw new Error(`${url}: robots.txt disallows it`);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

try {
  const store = storeFromArgv(args);
  const changeSet = changeSetFromArgv(args);
  const membersHtml = FROM_FILES ? readFileSync(FROM_FILES.members, "utf8") : await page(COALITION_MEMBERS_URL);
  const scoirHtml = FROM_FILES ? readFileSync(FROM_FILES.scoir, "utf8") : await page(SCOIR_LIST_URL);
  const schools: School[] = await datasetColleges(store, ROOT);
  const aliases: AliasRow[] = await datasetAliases(store, ROOT);
  const nameMap = (await store.readOne<Record<string, string | string[]>>(COLLECTIONS.coalition.nameMap, SINGLE_KEYS.nameMap)) ?? {};
  let built;
  try {
    built = buildCoalitionFile(membersHtml, scoirHtml, { schools, aliases, nameMap, today });
  } catch (err) {
    for (const l of (err as { lines?: string[] }).lines ?? []) console.log(l);
    throw err;
  }
  for (const l of built.lines) console.log(l);

  if (DRY_RUN) {
    console.log("--dry-run: nothing written");
  } else {
    const run = await openProducerRun(store, "coalition", { changeSet });
    await run.handle.write(COLLECTIONS.coalition.members, [{ key: SINGLE_KEYS.members, body: coalitionDocument(built.file) }]);
    await run.finish("applied", undefined, { members: built.file.members.length, unmatched: built.file.unmatched.length });
    console.log(`wrote ${COLLECTIONS.coalition.members}/${SINGLE_KEYS.members} in change set ${run.handle.id}`);
  }
} catch (err) {
  console.error(`sync-coalition: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
