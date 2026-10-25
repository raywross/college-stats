/**
 * Common App sync (specs/data-expansion/common-app.md "Sync"): downloads the Requirements Grid, parses it, reads the
 * member records from the Explore pages (one request per member, cached), joins grid names to members and IPEDS ids,
 * checks the parse, and writes:
 *   data/common-app/grid/<cycle>_<updated>.pdf   the grid as downloaded
 *   data/common-app/grid/<cycle>_<updated>.json  the parsed edition (GridEdition)
 *   data/common-app/members.json                 the member records (MembersFile)
 * It never touches data/schools.json: `npm run merge-common-app` applies the newest edition and members.json.
 *
 *   npm run sync-common-app                      grid + new members; a no-op when the grid's stamp is unchanged
 *   npm run sync-common-app -- --refresh-members refetch every member (yearly), then rejoin
 *   npm run sync-common-app -- --grid-only       grid and join from the members already on file
 *   npm run sync-common-app -- --members-only    members only (sitemap + new slugs)
 *   npm run sync-common-app -- --limit 20        fetch at most 20 member records this run
 *   npm run sync-common-app -- --dry-run         read and check, write nothing
 *
 * Permission: Common App agreed to this use in October 2026. Every request goes through PoliteHttp (robots.txt, an
 * honest user agent, at least a second between requests to one host). Exit 1 when any parse check fails.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PoliteHttp } from "./lib/college-reported/http.mts";
import { pdfTextItems } from "./lib/college-reported/layout.mts";
import { editionFromHeader, GRID_URL, gridProblems, parseGrid } from "./lib/common-app/grid.mts";
import { fetchMember, fetchSlugs, readMembersFile, SITEMAP_URL, writeMembersFile } from "./lib/common-app/members.mts";
import { joinNames } from "./lib/common-app/names.mts";
import { editionFileText, newestEdition } from "./lib/common-app/edition-file.mts";
import type { GridEdition, Member, MembersFile, NameMap } from "../lib/common-app/types.ts";
import type { AliasRow } from "../lib/identity-files.ts";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "data", "common-app");
const GRID_DIR = join(DIR, "grid");
const MEMBERS_PATH = join(DIR, "members.json");
const NAME_MAP_PATH = join(DIR, "name-map.json");

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const KNOWN = new Set(["--grid-only", "--members-only", "--refresh-members", "--limit", "--dry-run"]);
function fail(message: string): never {
  console.error(`sync-common-app: ${message}`);
  process.exit(1);
}
for (const a of args) if (a.startsWith("--") && !KNOWN.has(a)) fail(`unknown flag ${a}`);
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
const write = (path: string, data: string | Uint8Array) => {
  if (DRY_RUN) return;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, data);
};

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
  const newest = newestEdition(GRID_DIR);
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
const onFile = readMembersFile(MEMBERS_PATH);
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
  const save = () => {
    const file: MembersFile = { retrieved: today, sitemap_url: SITEMAP_URL, members: [...kept.values()] };
    if (!DRY_RUN) writeMembersFile(MEMBERS_PATH, file);
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
      save();
      console.log(`  ${i + 1}/${todo.length}`);
    }
  }
  save();
  members = [...kept.values()];
  for (const f of memberFailures) console.log(`  failed: ${f}`);
  console.log(`  ${members.length} members on file; ${members.filter((m) => !m.ipeds).length} without an IPEDS id`);
}

/* ---------------------------------------------------------------- */
/* 3. Join and check                                                 */
/* ---------------------------------------------------------------- */
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as { unit_id: string; name: string }[];
const schoolIds = new Set(schools.map((s) => s.unit_id));
const notCarried = members.filter((m) => m.ipeds && !schoolIds.has(m.ipeds));
let exitCode = 0;
if (parsed && gridBytes) {
  const aliases = JSON.parse(readFileSync(join(ROOT, "data", "aliases.json"), "utf8")) as AliasRow[];
  const nameMap = (existsSync(NAME_MAP_PATH) ? JSON.parse(readFileSync(NAME_MAP_PATH, "utf8")) : {}) as NameMap;
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
  const previous = newestEdition(GRID_DIR);
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
  console.log(`  matched to data/schools.json: ${s.matched}; joined to a member without an IPEDS id: ${s.member_without_ipeds}; IPEDS id not carried: ${s.ipeds_not_carried}; unmatched: ${s.unmatched}`);
  console.log(`Members ${members.length}; without an IPEDS id ${members.filter((m) => !m.ipeds).length}; IPEDS ids not in data/schools.json ${notCarried.length}${notCarried.length ? ` (e.g. ${notCarried.slice(0, 5).map((m) => `${m.ipeds} ${m.title}`).join("; ")})` : ""}`);
  console.log(`Name map entries: ${Object.keys(nameMap).length}`);

  if (problems.length) {
    console.error(`\n${problems.length} check${problems.length === 1 ? "" : "s"} failed; nothing written for the grid:`);
    for (const p of problems) console.error(`  ${p}`);
    exitCode = 1;
  } else {
    const base = join(GRID_DIR, `${edition.cycle}_${edition.updated}`);
    write(`${base}.pdf`, gridBytes);
    write(`${base}.json`, editionFileText(edition));
    console.log(`\n${DRY_RUN ? "Would write" : "Wrote"} data/common-app/grid/${edition.cycle}_${edition.updated}.{pdf,json}`);
  }
}
console.log(`${requests} requests (${fetchedMembers} member records) in ${((Date.now() - started) / 1000).toFixed(0)} s${DRY_RUN ? "; dry run, nothing written" : ""}`);
process.exit(exitCode);
