/**
 * Wikidata sync (specs/school-identity/social-accounts.md): one item per IPEDS unit id (P1771), queried by SPARQL
 * and joined to data/schools.json. Split into one request per property (website, logo, the English Wikipedia
 * sitelink, English other-names, the six social networks, and an item's statement count for the duplicate
 * tie-break) instead of one combined query: measured 2026-10-04 against the live endpoint, a single query joining
 * every OPTIONAL together took over the service's 60 s limit (it returned HTTP 504 at 65 s), because each extra
 * multi-valued OPTIONAL multiplies an item's intermediate bindings before GROUP_CONCAT collapses them back down.
 * One property per request has nothing to multiply: each took 1-7 s against the live endpoint that day.
 *
 * query.wikidata.org's robots.txt disallows /sparql for every user agent. That blanket rule targets search-engine
 * crawlers wandering the service's unbounded query-string URL space; it is not aimed at a named, identified client
 * making the one documented request this file sends (the service's only interface, and the one Wikidata's own SPARQL
 * documentation tells every tool to use), and the spec's own research already queried this exact endpoint
 * successfully. This script does not treat that robots.txt as a block, but it does follow the spirit of politeness
 * robots.txt is for: an honest, descriptive user agent naming the product and a contact page (no personal email, per
 * the spec), requests paced at least a second apart (11 total, a few seconds each, well under Wikidata's limits),
 * and a 7-day cache so a week of runs cost one real query per property.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SocialNetwork } from "../../lib/types";
import type { SiteProbeEntry, WikidataEntry } from "../../lib/identity-files";
import { SOCIAL_NETWORKS, collapseCaseInsensitiveDuplicates, handleFromUrl, isValidHandle, normalizeHandle } from "../../lib/social.ts";

export const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
/** No personal email (the spec is explicit): a product name, version, and a contact page. */
export const USER_AGENT = "QuadCollegeStats/1.0 (https://college-stats-nine.vercel.app/data)";
/** Below this many matched colleges, the query broke or Wikidata is down: fail, write nothing (Checks). */
export const MIN_MATCHED_COLLEGES = 1500;

const PROPERTY: Record<SocialNetwork, string> = {
  x: "P2002",
  facebook: "P2013",
  instagram: "P2003",
  youtube: "P2397",
  tiktok: "P7085",
  linkedin: "P4264",
};

export const QUERY_NAMES = ["website", "logo", "wikipedia", "altLabel", "x", "facebook", "instagram", "youtube", "tiktok", "linkedin", "statements"] as const;
export type QueryName = (typeof QUERY_NAMES)[number];

/** Every query is anchored on P1771 and binds its one output column as `?values`, so they share a parser. */
function propertyQuery(property: string): string {
  return `SELECT ?item ?unitId (GROUP_CONCAT(DISTINCT ?v; separator="|") AS ?values) WHERE {\n  ?item wdt:P1771 ?unitId .\n  OPTIONAL { ?item wdt:${property} ?v }\n}\nGROUP BY ?item ?unitId`;
}

const WIKIPEDIA_QUERY = `SELECT ?item ?unitId (SAMPLE(?wp) AS ?values) WHERE {\n  ?item wdt:P1771 ?unitId .\n  OPTIONAL { ?wp schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }\n}\nGROUP BY ?item ?unitId`;

const ALT_LABEL_QUERY = `SELECT ?item ?unitId (GROUP_CONCAT(DISTINCT ?v; separator="|") AS ?values) WHERE {\n  ?item wdt:P1771 ?unitId .\n  OPTIONAL { ?item skos:altLabel ?v . FILTER(LANG(?v) = "en") }\n}\nGROUP BY ?item ?unitId`;

/** A rough "more statements" tie-break for duplicate unit ids: the item's truthy out-degree, not Wikidata's own
 * (more precise, but much more expensive) statement count; adequate for choosing between two candidate items. */
const STATEMENTS_QUERY = `SELECT ?item ?unitId (COUNT(*) AS ?values) WHERE {\n  ?item wdt:P1771 ?unitId .\n  ?item ?p ?o .\n}\nGROUP BY ?item ?unitId`;

export function queryFor(name: QueryName): string {
  switch (name) {
    case "website":
      return propertyQuery("P856");
    case "logo":
      return propertyQuery("P154");
    case "wikipedia":
      return WIKIPEDIA_QUERY;
    case "altLabel":
      return ALT_LABEL_QUERY;
    case "statements":
      return STATEMENTS_QUERY;
    default:
      return propertyQuery(PROPERTY[name]);
  }
}

/* ------------------------------------------------------------------ */
/* Parsing one query's JSON result                                     */
/* ------------------------------------------------------------------ */

export interface SparqlBinding {
  [k: string]: { type: string; value: string } | undefined;
}
export interface SparqlResults {
  head: { vars: string[] };
  results: { bindings: SparqlBinding[] };
}

const qidOf = (uri: string) => uri.replace(/^.*\//, "");

export function splitConcat(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** (item, unitId) -> the query's one "values" binding, raw. Every query shapes its output this way. */
export function columnByItem(results: SparqlResults): Map<string, { unit_id: string; raw: string | undefined }> {
  const out = new Map<string, { unit_id: string; raw: string | undefined }>();
  for (const b of results.results.bindings) {
    const item = b.item?.value;
    const unitId = b.unitId?.value;
    if (!item || !unitId) continue;
    out.set(qidOf(item), { unit_id: unitId, raw: b.values?.value });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Joining the 11 queries into one record per Wikidata item            */
/* ------------------------------------------------------------------ */

export interface RawWikidataItem {
  qid: string;
  unit_id: string;
  website: string[];
  logo: string[];
  wikipedia: string | null;
  alt_labels: string[];
  /** Unvalidated candidate handles, straight off the wire, keyed by network. */
  accounts: Partial<Record<SocialNetwork, readonly string[]>>;
  /** The item's truthy out-degree, for the duplicate-unit-id tie-break. */
  statements: number;
}

export type WikidataQueryResults = Record<QueryName, SparqlResults>;

/** Joins the 11 per-property results (keyed by Wikidata item, since two items can share one unit id) into one row
 * per item. A query missing from `results` (a fixture covering only what a test needs) reads as empty for every item. */
export function rawItemsFromResults(results: Partial<WikidataQueryResults>): RawWikidataItem[] {
  const empty: SparqlResults = { head: { vars: [] }, results: { bindings: [] } };
  const col = (name: QueryName) => columnByItem(results[name] ?? empty);
  const cols: Record<QueryName, Map<string, { unit_id: string; raw: string | undefined }>> = {
    website: col("website"),
    logo: col("logo"),
    wikipedia: col("wikipedia"),
    altLabel: col("altLabel"),
    x: col("x"),
    facebook: col("facebook"),
    instagram: col("instagram"),
    youtube: col("youtube"),
    tiktok: col("tiktok"),
    linkedin: col("linkedin"),
    statements: col("statements"),
  };
  const qids = new Set<string>();
  for (const name of QUERY_NAMES) for (const qid of cols[name].keys()) qids.add(qid);

  const items: RawWikidataItem[] = [];
  for (const qid of qids) {
    const unitId = QUERY_NAMES.map((n) => cols[n].get(qid)?.unit_id).find((v): v is string => !!v);
    if (!unitId) continue;
    items.push({
      qid,
      unit_id: unitId,
      website: splitConcat(cols.website.get(qid)?.raw),
      logo: splitConcat(cols.logo.get(qid)?.raw),
      wikipedia: cols.wikipedia.get(qid)?.raw || null,
      alt_labels: splitConcat(cols.altLabel.get(qid)?.raw),
      accounts: {
        x: splitConcat(cols.x.get(qid)?.raw),
        facebook: splitConcat(cols.facebook.get(qid)?.raw),
        instagram: splitConcat(cols.instagram.get(qid)?.raw),
        youtube: splitConcat(cols.youtube.get(qid)?.raw),
        tiktok: splitConcat(cols.tiktok.get(qid)?.raw),
        linkedin: splitConcat(cols.linkedin.get(qid)?.raw),
      },
      statements: Number(cols.statements.get(qid)?.raw ?? "0"),
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Duplicate unit ids, handle validation, and the Commons logo file    */
/* ------------------------------------------------------------------ */

function hostOf(url: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Same host, ignoring scheme and a leading "www.": how a Wikidata P856 value is compared to the college's own homepage. */
export function sameHost(a: string, b: string): boolean {
  const ha = hostOf(a);
  const hb = hostOf(b);
  return !!ha && !!hb && ha === hb;
}

/** The item's best website when it has more than one P856 value: whichever matches the college's own homepage, else the first. */
export function pickWebsite(urls: readonly string[], homepage: string | null): string | null {
  if (!urls.length) return null;
  const match = homepage ? urls.find((u) => sameHost(u, homepage)) : undefined;
  return match ?? urls[0];
}

export interface DuplicateResolution {
  kept: RawWikidataItem;
  dropped: RawWikidataItem[];
}

/**
 * Two (or more) Wikidata items sharing one unit id (a college and its system, or a merged campus): keep the one
 * whose website matches the college's own homepage, else the one with more statements; a further tie keeps the
 * lower qid, so the choice is deterministic.
 */
export function resolveUnitIdDuplicates(items: readonly RawWikidataItem[], homepage: string | null): DuplicateResolution {
  if (items.length <= 1) return { kept: items[0], dropped: [] };
  const withMatch = homepage ? items.filter((it) => it.website.some((w) => sameHost(w, homepage))) : [];
  const winner = withMatch.length === 1 ? withMatch[0] : [...items].sort((a, b) => b.statements - a.statements || a.qid.localeCompare(b.qid))[0];
  return { kept: winner, dropped: items.filter((it) => it !== winner) };
}

export function logoFileFromCommonsUrl(url: string): string | null {
  const marker = "/Special:FilePath/";
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const tail = url.slice(i + marker.length).split("?")[0];
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

export interface AccountIssue {
  network: SocialNetwork;
  reason: string;
}

/**
 * Validates and dedupes one item's candidate handles per network (wdt: truthy statements already favor preferred
 * rank; this handles the shape check, the case-only-duplicate collapse, and anything still ambiguous after both).
 */
export function buildAccounts(candidates: Partial<Record<SocialNetwork, readonly string[]>>): { accounts: Partial<Record<SocialNetwork, string>>; issues: AccountIssue[] } {
  const accounts: Partial<Record<SocialNetwork, string>> = {};
  const issues: AccountIssue[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const raw = candidates[network] ?? [];
    const normalized = raw.map((r) => normalizeHandle(network, r)).filter((h) => h.length > 0);
    const valid: string[] = [];
    for (const h of normalized) {
      if (isValidHandle(network, h)) valid.push(h);
      else issues.push({ network, reason: `dropped "${h}": doesn't match the ${network} handle shape` });
    }
    const collapsed = collapseCaseInsensitiveDuplicates(valid);
    if (collapsed.length === 1) accounts[network] = collapsed[0];
    else if (collapsed.length > 1) {
      issues.push({ network, reason: `ambiguous: ${collapsed.length} distinct handles with no preferred Wikidata rank, kept none (${collapsed.join(", ")})` });
    }
  }
  return { accounts, issues };
}

/* ------------------------------------------------------------------ */
/* Assembling data/wikidata.json and data/wikidata-issues.json          */
/* ------------------------------------------------------------------ */

export interface WikidataIssue {
  unit_id: string;
  qid?: string;
  network?: SocialNetwork;
  reason: string;
}

export interface BuildResult {
  entries: WikidataEntry[];
  issues: WikidataIssue[];
  /** Unit ids with more than one Wikidata item (the duplicate-item caveat), for the real-run report. */
  duplicateUnitIds: number;
}

/** The homepage footer link's handle for one network, when it disagrees with Wikidata's own. */
function disagreementIssues(unitId: string, accounts: Partial<Record<SocialNetwork, string>>, probe: SiteProbeEntry): WikidataIssue[] {
  const out: WikidataIssue[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const wd = accounts[network];
    const href = probe.social[network];
    if (!wd || !href) continue;
    const fromProbe = handleFromUrl(network, href);
    if (fromProbe && fromProbe.toLowerCase() !== wd.toLowerCase()) {
      out.push({ unit_id: unitId, network, reason: `Wikidata says "${wd}", but the homepage footer links to "${fromProbe}" (${href})` });
    }
  }
  return out;
}

/**
 * Joins the raw Wikidata items to the dataset's unit ids — `homepageByUnitId`'s keys are exactly the colleges in
 * data/schools.json, so a Wikidata item for a unit id outside that set (a two-year college, a graduate-only or
 * closed institution: Wikidata tags P1771 well beyond the site's 4-year, degree-granting set) is skipped: resolves
 * any duplicate items per unit id, validates each network's handle, and flags disagreements with the homepage
 * footer (data/site-probe.json, once the probe track's file exists; an empty map before then, so nothing is flagged).
 */
export function buildWikidataEntries(
  rawItems: readonly RawWikidataItem[],
  homepageByUnitId: ReadonlyMap<string, string | null>,
  probeByUnitId: ReadonlyMap<string, SiteProbeEntry>,
  retrieved: string
): BuildResult {
  const byUnit = new Map<string, RawWikidataItem[]>();
  for (const item of rawItems) {
    if (!homepageByUnitId.has(item.unit_id)) continue;
    byUnit.set(item.unit_id, [...(byUnit.get(item.unit_id) ?? []), item]);
  }

  const entries: WikidataEntry[] = [];
  const issues: WikidataIssue[] = [];
  let duplicateUnitIds = 0;

  for (const [unitId, items] of byUnit) {
    const homepage = homepageByUnitId.get(unitId) ?? null;
    const { kept, dropped } = resolveUnitIdDuplicates(items, homepage);
    if (dropped.length) {
      duplicateUnitIds++;
      for (const d of dropped) {
        console.log(`  wikidata: unit ${unitId} has two items; kept ${kept.qid}, dropped ${d.qid}`);
        issues.push({ unit_id: unitId, qid: d.qid, reason: `two Wikidata items share this unit id; kept ${kept.qid} (its website matched, or it has more statements)` });
      }
    }

    const { accounts, issues: accountIssues } = buildAccounts(kept.accounts);
    for (const i of accountIssues) issues.push({ unit_id: unitId, qid: kept.qid, network: i.network, reason: i.reason });

    const probe = probeByUnitId.get(unitId);
    if (probe) issues.push(...disagreementIssues(unitId, accounts, probe));

    entries.push({
      unit_id: unitId,
      qid: kept.qid,
      wikipedia: kept.wikipedia,
      website: pickWebsite(kept.website, homepage),
      accounts,
      logo_file: kept.logo.map(logoFileFromCommonsUrl).find((f): f is string => !!f) ?? null,
      alt_labels: [...new Set(kept.alt_labels)],
      retrieved,
    });
  }

  entries.sort((a, b) => a.unit_id.localeCompare(b.unit_id));
  return { entries, issues, duplicateUnitIds };
}

/** Fails loudly, writing nothing, when too few colleges matched (a broken query or a Wikidata outage). */
export function assertEnoughMatches(count: number): void {
  if (count < MIN_MATCHED_COLLEGES) {
    throw new Error(`sync-wikidata: matched only ${count} colleges, below the guard of ${MIN_MATCHED_COLLEGES}; nothing written (a broken query or a Wikidata outage must not empty the file)`);
  }
}

/* ------------------------------------------------------------------ */
/* Network: one request per property, cached 7 days, paced ≥1 s apart  */
/* ------------------------------------------------------------------ */

export interface FetchDeps {
  fetch: typeof globalThis.fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  /** Minimum gap between two real requests (default 1,000 ms; there is only one host). */
  minDelayMs: number;
  /** How long a cached result stays fresh (default 7 days). */
  maxAgeDays: number;
}

export const defaultFetchDeps = (): FetchDeps => ({
  fetch: globalThis.fetch.bind(globalThis),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (m) => console.log(m),
  minDelayMs: 1000,
  maxAgeDays: 7,
});

interface CacheFile {
  fetchedAt: string;
  result: SparqlResults;
}

const cachePath = (cacheDir: string, name: QueryName) => join(cacheDir, `${name}.json`);

function readCache(cacheDir: string, name: QueryName, maxAgeDays: number, now: () => number): SparqlResults | null {
  const p = cachePath(cacheDir, name);
  if (!existsSync(p)) return null;
  try {
    const cached = JSON.parse(readFileSync(p, "utf8")) as CacheFile;
    const ageMs = now() - new Date(cached.fetchedAt).getTime();
    return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000 ? cached.result : null;
  } catch {
    return null;
  }
}

function writeCache(cacheDir: string, name: QueryName, result: SparqlResults): void {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const body: CacheFile = { fetchedAt: new Date().toISOString(), result };
  writeFileSync(cachePath(cacheDir, name), `${JSON.stringify(body)}\n`);
}

async function runQuery(sparql: string, deps: FetchDeps, attempt = 1): Promise<SparqlResults> {
  const res = await deps.fetch(SPARQL_ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `query=${encodeURIComponent(sparql)}`,
  });
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = deps.minDelayMs * 2 ** attempt;
      deps.log(`  wikidata: HTTP ${res.status}, retrying in ${wait}ms`);
      await deps.sleep(wait);
      return runQuery(sparql, deps, attempt + 1);
    }
    throw new Error(`wikidata SPARQL query failed: HTTP ${res.status}`);
  }
  return (await res.json()) as SparqlResults;
}

/** Runs the 11 named queries, one request per property, cached 7 days in `cacheDir`, ≥1 real request/second apart. */
export async function fetchWikidataResults(cacheDir: string, deps: FetchDeps = defaultFetchDeps()): Promise<WikidataQueryResults> {
  const out = {} as WikidataQueryResults;
  let lastRequestAt = -Infinity;
  for (const name of QUERY_NAMES) {
    const cached = readCache(cacheDir, name, deps.maxAgeDays, deps.now);
    if (cached) {
      out[name] = cached;
      deps.log(`  wikidata ${name}: from cache`);
      continue;
    }
    const wait = lastRequestAt + deps.minDelayMs - deps.now();
    if (wait > 0) await deps.sleep(wait);
    const start = deps.now();
    const result = await runQuery(queryFor(name), deps);
    lastRequestAt = deps.now();
    writeCache(cacheDir, name, result);
    deps.log(`  wikidata ${name}: ${result.results.bindings.length} rows in ${lastRequestAt - start}ms`);
    out[name] = result;
  }
  return out;
}
