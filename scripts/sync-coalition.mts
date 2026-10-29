/**
 * Reads the Coalition for College member list and Scoir's list of colleges taking applications through it, joins the
 * names to the site's colleges, and writes data/coalition/members.json (specs/data-expansion/coalition-app.md).
 *
 *   npm run sync-coalition              # two requests, then the file
 *   npm run sync-coalition -- --dry-run # reads and joins, writes nothing
 *   npm run sync-coalition -- --from-files <members.html> <scoir.html>   # saved pages, no network (tests, reruns)
 *
 * Both pages go through PoliteHttp (robots.txt honored, the honest user agent). Checks (coalition-app.md "Checks"):
 * 100–300 distinct member names, at least 50 Scoir names, at most 10% of either list unmatched; otherwise exit 1 and
 * nothing is written, with the names to add to data/coalition/name-map.json printed. Then `npm run merge-coalition`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AliasRow } from "../lib/aliases.ts";
import { COALITION_MEMBERS_URL, SCOIR_LIST_URL, type CoalitionFile, type CoalitionUnmatched } from "../lib/coalition.ts";
import type { School } from "../lib/types.ts";
import { PoliteHttp } from "./lib/college-reported/http.mts";
import { buildJoinIndex, joinName, mappedIds } from "./lib/coalition/join.mts";
import { parseMemberPage, parseScoirPage } from "./lib/coalition/parse.mts";

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
  const membersHtml = FROM_FILES ? readFileSync(FROM_FILES.members, "utf8") : await page(COALITION_MEMBERS_URL);
  const scoirHtml = FROM_FILES ? readFileSync(FROM_FILES.scoir, "utf8") : await page(SCOIR_LIST_URL);

  const members = parseMemberPage(membersHtml);
  const scoir = parseScoirPage(scoirHtml);
  const names = new Set(members.map((m) => m.name));
  if (members.length < 100 || members.length > 300) throw new Error(`member page: ${members.length} names (expected 100–300); the page's markup may have changed`);
  if (names.size !== members.length) throw new Error(`member page: ${members.length - names.size} duplicate names`);
  if (scoir.names.length < 50) throw new Error(`Scoir page: ${scoir.names.length} names (expected 50 or more); the page's markup may have changed`);

  const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
  const aliases: AliasRow[] = JSON.parse(readFileSync(join(ROOT, "data", "aliases.json"), "utf8"));
  const nameMapPath = join(ROOT, "data", "coalition", "name-map.json");
  const nameMap: Record<string, string | string[]> = existsSync(nameMapPath) ? JSON.parse(readFileSync(nameMapPath, "utf8")) : {};
  const index = buildJoinIndex(
    schools.map((s) => ({ unit_id: s.unit_id, name: s.name, website: s.links?.website ?? null })),
    aliases,
    nameMap,
  );

  const unmatched: CoalitionUnmatched[] = [];
  // A hand-map entry with several ids (one printed name for two campuses) becomes one row per college.
  const scoirJoined = scoir.names.flatMap((name) => {
    const many = mappedIds(index, name);
    if (many.length > 1) return many.map((unit_id) => ({ name, unit_id, join: "name-map" as const }));
    const r = joinName(index, name, null);
    if (!r.unit_id) unmatched.push({ name, list: "scoir", tried: r.tried });
    return [{ name, unit_id: r.unit_id, join: r.join }];
  });
  const scoirIds = new Set(scoirJoined.map((s) => s.unit_id).filter((id): id is string => !!id));
  const joined = members.flatMap((m) => {
    const many = mappedIds(index, m.name);
    const rows = many.length > 1 ? many.map((unit_id) => ({ unit_id, join: "name-map" as const })) : [joinName(index, m.name, m.admissions_url)];
    return rows.map((r) => {
      if (!r.unit_id) unmatched.push({ name: m.name, list: "coalition", tried: (r as { tried: CoalitionUnmatched["tried"] }).tried });
      return { name: m.name, admissions_url: m.admissions_url, unit_id: r.unit_id, join: r.join, via_scoir: !!r.unit_id && scoirIds.has(r.unit_id) };
    });
  });
  const seenIds = new Set<string>();
  for (const m of joined) {
    if (m.unit_id && seenIds.has(m.unit_id)) throw new Error(`two member names joined to the same college (${m.unit_id}: ${m.name}); fix data/coalition/name-map.json`);
    if (m.unit_id) seenIds.add(m.unit_id);
  }
  const memberIds = new Set(joined.map((m) => m.unit_id).filter((id): id is string => !!id));
  const notMembers = scoirJoined.filter((s) => s.unit_id && !memberIds.has(s.unit_id)).map((s) => ({ name: s.name, unit_id: s.unit_id! }));

  const file: CoalitionFile = {
    retrieved: today,
    member_url: COALITION_MEMBERS_URL,
    scoir_url: SCOIR_LIST_URL,
    members: joined.sort((a, b) => a.name.localeCompare(b.name)),
    scoir: { as_of: scoir.as_of, names: scoirJoined, not_members: notMembers },
    unmatched,
  };

  const unCo = unmatched.filter((u) => u.list === "coalition").length;
  const unSc = unmatched.filter((u) => u.list === "scoir").length;
  console.log(`coalition: ${members.length} members, ${memberIds.size} joined (${unCo} unmatched); Scoir ${scoir.names.length} names as of ${scoir.as_of ?? "no date"}, ${scoirIds.size} joined (${unSc} unmatched); ${joined.filter((m) => m.via_scoir).length} members through Scoir; ${notMembers.length} Scoir colleges not on the member list`);
  for (const u of unmatched) console.log(`  unmatched (${u.list}): ${u.name}  [tried ${u.tried.join(", ")}]`);
  for (const n of notMembers) console.log(`  on Scoir's list, not a member: ${n.name} (${n.unit_id})`);
  if (unCo > members.length / 10 || unSc > scoir.names.length / 10) throw new Error("more than 10% of a list is unmatched; add the names to data/coalition/name-map.json and rerun");

  if (DRY_RUN) {
    console.log("--dry-run: nothing written");
  } else {
    const out = join(ROOT, "data", "coalition", "members.json");
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`wrote ${out}`);
  }
} catch (err) {
  console.error(`sync-coalition: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
