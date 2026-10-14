/**
 * The universe of events by kind, from the standard search alone (one request per Slate host, the project user agent,
 * 24 hosts at a time): counts and colleges per kind, the most common titles per kind (for tuning lib/visit-events/kinds.ts),
 * and the hosts with the highest staff share. Reads slate_hosts from Supabase; writes nothing there. Output:
 * JSON and Markdown to --out (default the working directory).
 *
 *   node --env-file-if-exists=.env.local scripts/visit-events-universe.mts --out /path/to/folder
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseClient } from "../lib/supabase.ts";
import { kindOf } from "../lib/visit-events/kinds.ts";
import type { VisitEventKind } from "../lib/visit-events/types.ts";
import { readHosts } from "./lib/visit-events/store.mts";
import { parseStandardSearch, searchUrl } from "./lib/visit-events/slate-search.mts";
import { pool } from "./lib/visit-events/sync.mts";
import { USER_AGENT } from "./lib/college-reported/http.mts";

const args = process.argv.slice(2);
const outDir = args[args.indexOf("--out") + 1] && args.includes("--out") ? args[args.indexOf("--out") + 1] : process.cwd();

const ROOT = join(import.meta.dirname, "..");
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as { unit_id: string; name: string; location: { city: string | null } }[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));

const client = supabaseClient("publish");
const hosts = (await readHosts(client)).filter((h) => h.status !== "off");
console.log(`${hosts.length} hosts`);

interface HostResult {
  unit_id: string;
  host: string;
  name: string;
  total: number | null;
  kinds: Partial<Record<VisitEventKind, number>>;
  titles: Partial<Record<VisitEventKind, Map<string, number>>>;
  error?: string;
}

const results = await pool(hosts, 24, async (h): Promise<HostResult> => {
  const s = byId.get(h.unit_id);
  const r: HostResult = { unit_id: h.unit_id, host: h.host, name: s?.name ?? h.unit_id, total: null, kinds: {}, titles: {} };
  try {
    const res = await fetch(searchUrl(h.host), { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      r.error = `HTTP ${res.status}`;
      return r;
    }
    const parsed = parseStandardSearch(await res.text(), h.host);
    r.total = parsed.total;
    const campusCity = s?.location.city?.toLowerCase() ?? null;
    for (const row of parsed.rows) {
      const kind = kindOf({ title: row.title, place: row.place, campusCity });
      r.kinds[kind] = (r.kinds[kind] ?? 0) + 1;
      const t = (r.titles[kind] ??= new Map());
      const key = row.title.replace(/\s+/g, " ").trim().slice(0, 80);
      t.set(key, (t.get(key) ?? 0) + 1);
    }
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
  }
  return r;
});

const KINDS: VisitEventKind[] = ["info_session", "travel", "tour", "other", "online", "open_house", "staff"];
const totals: Record<string, { events: number; colleges: number }> = {};
const titleTotals: Record<string, Map<string, number>> = {};
let eventsAll = 0;
let read = 0;
const errors: HostResult[] = [];
for (const r of results) {
  if (r.error) {
    errors.push(r);
    continue;
  }
  read++;
  for (const k of KINDS) {
    const n = r.kinds[k] ?? 0;
    if (!n) continue;
    eventsAll += n;
    totals[k] ??= { events: 0, colleges: 0 };
    totals[k].events += n;
    totals[k].colleges++;
    const tt = (titleTotals[k] ??= new Map());
    for (const [t, c] of r.titles[k] ?? []) tt.set(t, (tt.get(t) ?? 0) + c);
  }
}
const staffHeavy = results
  .filter((r) => !r.error)
  .map((r) => ({ name: r.name, host: r.host, staff: r.kinds.staff ?? 0, all: Object.values(r.kinds).reduce((a, b) => a + (b ?? 0), 0) }))
  .filter((r) => r.all > 0)
  .map((r) => ({ ...r, share: r.staff / r.all }))
  .sort((a, b) => b.share - a.share)
  .slice(0, 25);

const top = (k: string, n: number) => [...(titleTotals[k] ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const md: string[] = [];
md.push(`# Visit events universe (standard search only, ${new Date().toISOString().slice(0, 16)}Z)`);
md.push("");
md.push(`${read} of ${hosts.length} hosts answered; ${errors.length} failed. ${eventsAll.toLocaleString()} events (the search lists placed events only; online sessions come from the portal widgets and are undercounted here).`);
md.push("");
md.push("| Kind | Events | Share | Colleges |");
md.push("|---|---|---|---|");
for (const k of KINDS) {
  const t = totals[k];
  if (!t) continue;
  md.push(`| ${k} | ${t.events.toLocaleString()} | ${((100 * t.events) / eventsAll).toFixed(1)}% | ${t.colleges} |`);
}
for (const k of KINDS) {
  md.push("");
  md.push(`## ${k}: most common titles`);
  md.push("");
  md.push("| Title | Events |");
  md.push("|---|---|");
  for (const [t, c] of top(k, k === "other" || k === "staff" ? 80 : 30)) md.push(`| ${t.replace(/\|/g, "\\|")} | ${c} |`);
}
md.push("");
md.push("## Hosts with the highest staff share");
md.push("");
md.push("| College | Host | Staff | All | Share |");
md.push("|---|---|---|---|---|");
for (const r of staffHeavy) md.push(`| ${r.name} | ${r.host} | ${r.staff} | ${r.all} | ${(100 * r.share).toFixed(0)}% |`);
if (errors.length) {
  md.push("");
  md.push("## Hosts that failed");
  md.push("");
  for (const r of errors) md.push(`- ${r.name} (${r.host}): ${r.error}`);
}

writeFileSync(join(outDir, "universe.md"), md.join("\n") + "\n");
writeFileSync(
  join(outDir, "universe.json"),
  JSON.stringify(
    {
      hosts: hosts.length,
      read,
      eventsAll,
      totals,
      titles: Object.fromEntries(KINDS.map((k) => [k, top(k, 500)])),
      perHost: results.map((r) => ({ unit_id: r.unit_id, host: r.host, name: r.name, total: r.total, kinds: r.kinds, error: r.error })),
    },
    null,
    1,
  ),
);
console.log(md.slice(0, 14).join("\n"));
