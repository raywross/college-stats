/**
 * Common App sync (specs/data-expansion/common-app.md "Sync"): downloads the Requirements Grid, parses it, reads the
 * member records from the Explore pages (one request per member, cached), joins grid names to members and IPEDS ids,
 * checks the parse, and writes through the data store (specs/data-platform/pipelines.md), in one change set (source
 * `common-app`):
 *   common_app.grid/<cycle>_<updated>   the parsed edition (GridEdition); the PDF goes to the document archive by sha
 *   common_app.members/members          the member records (MembersFile), saved every 50 members as before
 * The publisher applies the newest edition and the members; no file under data/ is written. The name map
 * (`common_app.name_map`) and the editions and members on file are read from the store.
 *
 *   npm run sync-common-app -- --store supabase  grid + new members; a no-op when the grid's stamp is unchanged
 *   npm run sync-common-app -- --refresh-members refetch every member (yearly), then rejoin
 *   npm run sync-common-app -- --grid-only       grid and join from the members already on file
 *   npm run sync-common-app -- --members-only    members only (sitemap + new slugs)
 *   npm run sync-common-app -- --limit 20        fetch at most 20 member records this run
 *   npm run sync-common-app -- --dry-run         read and check, write nothing
 *   --store supabase|file:<dir> (default supabase when DATA_SUPABASE_URL is set); --change-set <id> writes into a set
 *   the workflow opened.
 *
 * Permission: Common App agreed to this use in October 2026. Every request goes through PoliteHttp (robots.txt, an
 * honest user agent, at least a second between requests to one host). Exit 1 when any parse check fails (the change
 * set, if members were saved, still closes applied: the members are good; the edition is not written).
 */
import { createHash } from "node:crypto";

import { join } from "node:path";
import { PoliteHttp } from "./lib/college-reported/http.mts";
import { pdfTextItems } from "./lib/college-reported/layout.mts";
import { createArchive } from "./lib/college-reported/archive.mts";
import { editionFromHeader, GRID_URL, gridProblems, parseGrid } from "./lib/common-app/grid.mts";
import { fetchMember, fetchSlugs, membersFileText, SITEMAP_URL } from "./lib/common-app/members.mts";
import { joinNames } from "./lib/common-app/names.mts";
import { editionFileText } from "./lib/common-app/edition-file.mts";
import type { GridEdition, Member, MembersFile, NameMap } from "../lib/common-app/types.ts";
import type { AliasRow } from "../lib/identity-files.ts";
import { COLLECTIONS, SINGLE_KEYS } from "./lib/data-platform/layers.mts";
import { changeSetFromArgv, datasetAliases, datasetColleges, openProducerRun, storeFromArgv, type ProducerRun } from "./lib/data-platform/producer.mts";

const ROOT = join(import.meta.dirname, "..");

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const KNOWN = new Set(["--grid-only", "--members-only", "--refresh-members", "--limit", "--dry-run", "--store", "--change-set"]);
function fail(message: string): never {
  console.error(`sync-common-app: ${message}`);
  process.exit(1);
}
for (const a of args) if (a.startsWith("--") && !KNOWN.has(a.split("=")[0])) fail(`unknown flag ${a}`);
const GRID_ONLY = flag("--grid-only");
const MEMBERS_ONLY = flag("--members-only");
const REFRESH = flag("--refresh-members");
const DRY_RUN = flag("--dry-run");
const LIMIT = value("--limit") !== undefined ? Number(value("--limit")) : Infinity;
if (GRID_ONLY && MEMBERS_ONLY) fail("--grid-only and --members-only exclude each other");
if (value("--limit") !== undefined && !(Number.isInteger(LIMIT) && LIMIT >= 0)) fail("--limit takes a whole number");
if (GRID_ONLY && REFRESH) fail("--refresh-members fetches members; it can't go with --grid-only");

const started = Date.now();
const today = new Date().toISOString().slice(0, 10);
let requests = 0;
const http = new PoliteHttp({
  fetch: (input, init) => {
    requests++;
    return globalThis.fetch(input, init);
  },
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  minDelayMs: 1000,
  log: (m) => console.log(m),
  timeoutMs: 60_000,
  maxBytes: 20 * 1024 * 1024,
});
const store = storeFromArgv(args);
const changeSet = changeSetFromArgv(args);
/** The run's change set, opened at the first write (a run with nothing to write opens none). */
let run: ProducerRun | null = null;
const runSet = async () => (run ??= await openProducerRun(store, "common-app", { changeSet }));
/** The editions on file, newest last (by key: cycle, then updated stamp, as the files sorted). */
const editions = [...(await store.read<GridEdition>(COLLECTIONS.commonApp.grid)).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const newestOnFile = editions.length ? { cycle: editions.at(-1)![1].cycle, updated: editions.at(-1)![1].updated, file: editions.at(-1)![1] } : null;

/* ---------------------------------------------------------------- */
/* 1. The grid                                                       */
/* ---------------------------------------------------------------- */
let gridBytes: Uint8Array | null = null;
let parsed: ReturnType<typeof parseGrid> | null = null;
if (!MEMBERS_ONLY) {
  console.log(`Downloading ${GRID_URL}…`);
  const res = await http.get(GRID_URL);
  if (!res) fail(`robots.txt disallows ${GRID_URL}`);
  if (!res.ok) fail(`${GRID_URL}: HTTP ${res.status}`);
  gridBytes = new Uint8Array(await res.arrayBuffer());
  const pages = await pdfTextItems(gridBytes);
  const stamp = editionFromHeader(pages);
  const newest = newestOnFile;
  console.log(`  ${pages.length} pages, ${stamp.cycle} cycle, updated ${stamp.updated}${newest ? `; newest on file ${newest.cycle} updated ${newest.updated}` : "; none on file"}`);
  if (newest && newest.cycle === stamp.cycle && newest.updated === stamp.updated && !REFRESH && !GRID_ONLY) {
    console.log("unchanged: the grid's stamp matches the newest edition on file (pass --refresh-members or --grid-only to rejoin)");
    process.exit(0);
  }
  parsed = parseGrid(pages);
  console.log(`  ${parsed.rows.length} rows; ${parsed.school_type_cells} School-type cells`);
}

/* ---------------------------------------------------------------- */
/* 2. Members                                                        */
/* ---------------------------------------------------------------- */
const onFile = await store.readOne<MembersFile>(COLLECTIONS.commonApp.members, SINGLE_KEYS.members);
let members: Member[] = onFile?.members ?? [];
let fetchedMembers = 0;
const memberFailures: string[] = [];
if (!GRID_ONLY) {
  const slugs = await fetchSlugs(http);
  console.log(`Sitemap: ${slugs.length} member slugs`);
  const inSitemap = new Set(slugs);
  const dropped = members.filter((m) => !inSitemap.has(m.slug));
  if (dropped.length) console.log(`  no longer in the sitemap (dropped): ${dropped.map((m) => m.slug).join(", ")}`);
  const kept = new Map(members.filter((m) => inSitemap.has(m.slug)).map((m) => [m.slug, m]));
  const todo = (REFRESH ? slugs : slugs.filter((s) => !kept.has(s))).slice(0, LIMIT);
  console.log(`Fetching ${todo.length} member record${todo.length === 1 ? "" : "s"} (${kept.size} on file)…`);
  const save = async () => {
    const file: MembersFile = { retrieved: today, sitemap_url: SITEMAP_URL, members: [...kept.values()] };
    if (DRY_RUN) return;
    // The document is the file's text parsed (one member per line, sorted by slug), as the import keys it.
    await (await runSet()).handle.write(COLLECTIONS.commonApp.members, [{ key: SINGLE_KEYS.members, body: JSON.parse(membersFileText(file)) }]);
  };
  for (const [i, slug] of todo.entries()) {
    try {
      const m = await fetchMember(http, slug, today);
      if (m) {
        kept.set(slug, m);
        fetchedMembers++;
      } else memberFailures.push(`${slug}: no record (404 or no school in the page data)`);
    } catch (err) {
      memberFailures.push(`${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if ((i + 1) % 50 === 0) {
      await save();
      console.log(`  ${i + 1}/${todo.length}`);
    }
  }
  await save();
  members = [...kept.values()];
  for (const f of memberFailures) console.log(`  failed: ${f}`);
  console.log(`  ${members.length} members on file; ${members.filter((m) => !m.ipeds).length} without an IPEDS id`);
}

/* ---------------------------------------------------------------- */
/* 3. Join and check                                                 */
/* ---------------------------------------------------------------- */
const schools = await datasetColleges(store, ROOT);
const schoolIds = new Set(schools.map((s) => s.unit_id));
const notCarried = members.filter((m) => m.ipeds && !schoolIds.has(m.ipeds));
let exitCode = 0;
if (parsed && gridBytes) {
  const aliases: AliasRow[] = await datasetAliases(store, ROOT);
  const nameMap = ((await store.readOne<NameMap>(COLLECTIONS.commonApp.nameMap, SINGLE_KEYS.nameMap)) ?? {}) as NameMap;
  const joined = joinNames(parsed.rows, members, aliases, nameMap, schools);
  const edition: GridEdition = {
    cycle: parsed.cycle,
    updated: parsed.updated,
    source_url: GRID_URL,
    retrieved: today,
    pages: parsed.pages,
    rows: joined.rows,
    unmatched: joined.unmatched,
  };
  const problems = gridProblems({ ...edition, school_type_cells: parsed.school_type_cells, issues: parsed.issues });

  // A name that joined a different college last edition is a change for review (spec "Checks").
  const previous = newestOnFile;
  if (previous && !(previous.cycle === edition.cycle && previous.updated === edition.updated)) {
    const before = new Map(previous.file.rows.map((r) => [r.name, r.slug]));
    for (const r of edition.rows) {
      const was = before.get(r.name);
      if (was && r.slug && was !== r.slug) console.log(`  review: "${r.name}" joined ${was} in ${previous.updated}, now ${r.slug}`);
    }
  }

  console.log("");
  for (const w of parsed.warnings) console.log(`warning: ${w}`);
  for (const s of joined.staleMap) console.log(`warning: name-map entry ${s}`);
  for (const [slug, names] of joined.sharedSlugs) console.log(`warning: ${slug} is joined by ${names.length} grid rows: ${names.join("; ")}`);
  console.log(`\nUnmatched grid names (${joined.unmatched.length}):`);
  for (const n of joined.unmatched) console.log(`  ${n}`);

  const s = joined.stats;
  console.log(`\nRows ${s.rows} (School-type cells ${parsed.school_type_cells}); joined ${s.joined}: title ${s.by_rule.title}, normalized ${s.by_rule.normalized}, alias ${s.by_rule.alias}, name map ${s.by_rule["name-map"]}`);
  console.log(`  matched to the dataset: ${s.matched}; joined to a member without an IPEDS id: ${s.member_without_ipeds}; IPEDS id not carried: ${s.ipeds_not_carried}; unmatched: ${s.unmatched}`);
  console.log(`Members ${members.length}; without an IPEDS id ${members.filter((m) => !m.ipeds).length}; IPEDS ids not in the dataset ${notCarried.length}${notCarried.length ? ` (e.g. ${notCarried.slice(0, 5).map((m) => `${m.ipeds} ${m.title}`).join("; ")})` : ""}`);
  console.log(`Name map entries: ${Object.keys(nameMap).length}`);

  if (problems.length) {
    console.error(`\n${problems.length} check${problems.length === 1 ? "" : "s"} failed; nothing written for the grid:`);
    for (const p of problems) console.error(`  ${p}`);
    exitCode = 1;
  } else {
    const key = `${edition.cycle}_${edition.updated}`;
    if (!DRY_RUN) {
      // The PDF goes to the document archive by sha (storage.md: the layer holds the parsed edition only).
      const sha = createHash("sha256").update(gridBytes).digest("hex");
      const where = await createArchive({ log: (m) => console.log(m) }).put(sha, gridBytes, "pdf");
      await (await runSet()).handle.write(COLLECTIONS.commonApp.grid, [{ key, body: JSON.parse(editionFileText(edition)) }]);
      console.log(`\nWrote ${COLLECTIONS.commonApp.grid}/${key} (the PDF: ${where})`);
    } else console.log(`\nWould write ${COLLECTIONS.commonApp.grid}/${key}`);
  }
}
console.log(`${requests} requests (${fetchedMembers} member records) in ${((Date.now() - started) / 1000).toFixed(0)} s${DRY_RUN ? "; dry run, nothing written" : ""}`);
const finished = run as ProducerRun | null;
if (finished) {
  await finished.finish("applied", undefined, { members: members.length, fetched_members: fetchedMembers, member_failures: memberFailures.length, grid: exitCode === 0 && parsed ? `${parsed.cycle}_${parsed.updated}` : null });
  console.log(`Change set ${finished.handle.id}: applied`);
}
process.exit(exitCode);
