/**
 * Reads Slate colleges' public event calendars into Supabase (specs/product/visit-events.md, "The nightly job";
 * scripts/lib/visit-events/).
 *
 *   npm run sync-visit-events                                   every active host (the nightly run)
 *   npm run sync-visit-events -- --units 134130,198419          those colleges' hosts
 *   npm run sync-visit-events -- --discover --units 134130      find the colleges' Slate hosts first, then read them
 *   npm run sync-visit-events -- --discover --all               find hosts for every college with a visit or apply link
 *                                                                not yet in slate_hosts (resumable), then read every host
 *   npm run sync-visit-events -- --dry-run                      read and diff; write nothing
 *   npm run sync-visit-events -- --limit 20                     at most 20 colleges
 *
 * Every request goes through PoliteHttp (robots.txt honored, at least a second between requests to one host, the
 * project's user agent); hosts in data/reference/blocked-hosts.json are skipped. Writes use the secret key
 * (SUPABASE_URL, SUPABASE_SECRET_KEY in .env.local).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { BlockedHostsFile } from "../lib/reported.ts";
import type { SlateHostRow } from "../lib/visit-events/types.ts";
import { supabaseClient } from "../lib/supabase.ts";
import { PoliteHttp } from "./lib/college-reported/http.mts";
import { isBlockedHost } from "./lib/college-reported/blocked.mts";
import { discoverSlateHost, type Discovered } from "./lib/visit-events/discover.mts";
import { loadZipTable } from "./lib/visit-events/geo.mts";
import { readHosts, supabaseStore, upsertHosts } from "./lib/visit-events/store.mts";
import { pool, runSync, type EventStore } from "./lib/visit-events/sync.mts";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const DRY_RUN = flag("--dry-run");
const DISCOVER = flag("--discover");
const ALL = flag("--all");
const UNITS = (value("--units") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LIMIT = value("--limit") ? Number(value("--limit")) : Infinity;
const MAX_PAGES = value("--max-pages") ? Number(value("--max-pages")) : undefined;

function fail(message: string): never {
  console.error(`sync-visit-events: ${message}`);
  process.exit(1);
}

if (UNITS.some((u) => !/^\d{1,10}$/.test(u))) fail(`--units takes unit ids separated by commas, got "${value("--units")}"`);
if (!Number.isFinite(LIMIT) && value("--limit")) fail("--limit takes a number");
if (DISCOVER && !UNITS.length && !ALL) fail("--discover needs --units or --all");

const configured = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY;
if (!configured && !DRY_RUN) fail("SUPABASE_URL and SUPABASE_SECRET_KEY are not set (see specs/supabase.md); use --dry-run to read without writing.");
const client = configured ? supabaseClient("publish") : null;

const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const blockedFile = JSON.parse(readFileSync(join(ROOT, "data", "reference", "blocked-hosts.json"), "utf8")) as BlockedHostsFile;
const now = new Date();
const today = now.toISOString().slice(0, 10);
const isBlocked = (host: string) => isBlockedHost(blockedFile, host, today);

const quiet: string[] = [];
const http = new PoliteHttp({
  fetch: globalThis.fetch,
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  minDelayMs: 1000,
  log: (m) => void quiet.push(m),
  timeoutMs: 30_000,
  maxBytes: 10 * 1024 * 1024,
});

let hosts: SlateHostRow[] = client ? await readHosts(client) : [];
const known = new Map(hosts.map((h) => [h.unit_id, h]));

/* Discovery */
if (DISCOVER) {
  let targets = UNITS.length ? UNITS : schools.filter((s) => s.links?.visit || s.links?.apply).map((s) => s.unit_id);
  // --all is resumable: colleges already in slate_hosts are skipped; --units rediscovers the named ones.
  if (!UNITS.length) targets = targets.filter((u) => !known.has(u));
  targets = targets.filter((u) => known.get(u)?.status !== "off").slice(0, LIMIT);
  console.log(`Discovering Slate hosts for ${targets.length} college${targets.length === 1 ? "" : "s"}…`);
  const CHUNK = 40;
  let found = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const results = await pool(chunk, 8, async (unitId): Promise<[string, Discovered | null]> => {
      const s = byId.get(unitId);
      if (!s) {
        console.log(`  ${unitId}: not in data/schools.json; skipped`);
        return [unitId, null];
      }
      const d = await discoverSlateHost(unitId, s.links?.visit ?? null, s.links?.apply ?? null, http, { isBlocked, log: (m) => console.log(m) });
      if (!d) console.log(`  ${unitId} ${s.name}: no Slate host found from ${s.links?.visit ?? s.links?.apply ?? "no link"}`);
      return [unitId, d];
    });
    const rows = results
      .filter((r): r is [string, Discovered] => r[1] !== null)
      .map(([unit_id, d]) => ({ unit_id, host: d.host, found_on: d.foundOn, portal_parts: d.portalParts }));
    found += rows.length;
    if (client && !DRY_RUN && rows.length) await upsertHosts(client, rows);
    for (const r of rows) {
      const prev = known.get(r.unit_id);
      const row: SlateHostRow = { status: "active", failures: 0, first_seen: now.toISOString(), last_read: null, last_error: null, ...prev, ...r };
      known.set(r.unit_id, row);
    }
  }
  console.log(`Found ${found} of ${targets.length}${DRY_RUN ? " (dry run: slate_hosts not written)" : ""}.`);
  hosts = [...known.values()];
}

/* Reading */
let chosen: SlateHostRow[];
if (UNITS.length) {
  chosen = UNITS.map((u) => known.get(u)).filter((h): h is SlateHostRow => !!h && h.status !== "off");
  const missing = UNITS.filter((u) => !known.has(u));
  if (missing.length) console.log(`No Slate host on record for ${missing.join(", ")} (run with --discover, or seed slate_hosts).`);
} else {
  // Unreachable hosts are retried weekly (Sundays); colleges whose hosts are blocked are skipped.
  const sunday = now.getUTCDay() === 0;
  chosen = hosts.filter((h) => h.status === "active" || h.status === "no_events" || (h.status === "unreachable" && sunday));
}
chosen = chosen.filter((h) => {
  if (!isBlocked(h.host)) return true;
  console.log(`  ${h.host} is in data/reference/blocked-hosts.json; skipped`);
  return false;
});
chosen = chosen.slice(0, LIMIT);
if (!chosen.length) {
  console.log("No hosts to read.");
  process.exit(0);
}

const memoryStore: EventStore = {
  storedFor: async () => [],
  upsertEvents: async () => {},
  updateHost: async () => {},
  recordSync: async () => {},
};
const zips = loadZipTable(ROOT);
console.log(`Reading ${chosen.length} host${chosen.length === 1 ? "" : "s"}${DRY_RUN ? " (dry run)" : ""}…`);
const { results, record } = await runSync(chosen, {
  http,
  store: client ? supabaseStore(client) : memoryStore,
  zips,
  now,
  campus: (unitId) => ({ city: byId.get(unitId)?.location?.city ?? null, state: byId.get(unitId)?.location?.state ?? null }),
  dryRun: DRY_RUN,
  maxPages: MAX_PAGES,
  log: (m) => console.log(m),
});

for (const r of results) {
  const name = byId.get(r.unitId)?.name ?? r.unitId;
  if (!r.ok) {
    console.log(`${name} (${r.host}): FAILED: ${r.error}`);
    continue;
  }
  const rows = r.read!.rows;
  const kinds = new Map<string, number>();
  for (const e of rows) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const located = rows.filter((e) => !e.online && e.kind !== "online").length;
  const withPoint = rows.filter((e) => !e.online && e.kind !== "online" && e.lat != null).length;
  const c = r.diff!.counts;
  console.log(
    `${name} (${r.host}): ${rows.length} events (search said ${r.read!.searchTotal ?? "?"}); ${c.new} new, ${c.changed} changed, ${r.diff!.missed.length} missed (${c.removed} removed); ` +
      `${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}; located ${withPoint}/${located}; ${r.read!.errors.length} errors`,
  );
}
console.log(
  `Run: ${record.hosts_read} hosts read, ${record.events_new} new, ${record.events_changed} changed, ${record.events_removed} removed, ${record.pages_fetched} requests, ${record.errors.length} errors${DRY_RUN ? " (dry run: nothing written)" : ""}.`,
);
if (quiet.length) console.log(`${quiet.length} requests skipped by robots.txt or unreachable hosts (first: ${quiet[0].trim()}).`);
