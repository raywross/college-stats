/**
 * Wikipedia's college color data, fetched politely (specs/school-identity/brand.md, "Source: colors"):
 *   - `Module:College color/data`, the Lua table of every college athletic program's colors, once per run;
 *   - each college's article lead (section 0, where the infobox lives), in batches of 50 titles per request.
 * Both through the MediaWiki Action API with redirects followed, one request at a time at most once a second, with
 * `maxlag` so the job backs off when the servers are busy, and an honest user agent. Everything is cached for 30 days
 * in .cache/wikipedia/ (git-ignored), so a re-run within a month makes no requests.
 *
 * Measured 2026-10-04: `rvsection=0` is honored for every page of a 50-title batch (Harvey Mudd College's lead was
 * 3,897 characters either way; 50 leads came back in 231 KB and 0.7 s), so ~34 batched requests replace ~1,660
 * single-title ones. Full articles are 3-15 times longer than their leads, so the full-content batch was rejected.
 * Titles a batch returns without content are retried one at a time.
 *
 * The parsing and joining are pure and live in lib/brand-colors.ts; `buildBrandColors` here ties them to the files.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrandColorEntry, WikidataEntry } from "../../lib/identity-files";
import { colorsForArticle, parseColorModule, type ColorModule } from "../../lib/brand-colors.ts";

export const WIKIPEDIA_USER_AGENT = "QuadCollegeStats/1.0 (https://college-stats-nine.vercel.app/data)";
export const API_URL = "https://en.wikipedia.org/w/api.php";
export const MODULE_TITLE = "Module:College color/data";
export const MODULE_URL = "https://en.wikipedia.org/wiki/Module:College_color/data";
/** Cached copies older than this are fetched again. */
export const CACHE_DAYS = 30;
/** Titles per request: the API's limit for ordinary clients. */
export const BATCH = 50;
/** At least this long between two requests. */
export const MIN_DELAY_MS = 1000;

export interface WikiDeps {
  fetch: typeof globalThis.fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
}

export const defaultDeps = (): WikiDeps => ({
  fetch: globalThis.fetch,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (msg) => console.log(msg),
});

/** The cached module: its wikitext (Lua) and when it was read. */
export interface CachedModule {
  retrieved: string;
  revid: number | null;
  /** The revision's own timestamp, so a reviewer can see how fresh the table was. */
  timestamp: string | null;
  content: string;
}

/** One article's lead, keyed in the cache by the title asked for. */
export interface CachedLead {
  retrieved: string;
  /** The page the title resolved to after normalization and redirects. */
  title: string | null;
  /** True when Wikipedia has no such page. */
  missing?: boolean;
  content?: string;
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ageDays = (iso: string, now: number) => (now - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000;

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

/** Writes through a temporary file, so an interrupted run never leaves half a cache. */
function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

/** "https://en.wikipedia.org/wiki/University_of_Georgia" → "University of Georgia"; null for anything else. */
export function titleFromArticleUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/en\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/_/g, " ").trim() || null;
  } catch {
    return null;
  }
}

/** Paces requests (one at a time, MIN_DELAY_MS apart) and honors `maxlag` answers by waiting and retrying. */
export class WikiApi {
  private last = -Infinity;
  private deps: WikiDeps;
  requests = 0;

  constructor(deps: WikiDeps) {
    this.deps = deps;
  }

  async query(params: Record<string, string>): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams({ action: "query", format: "json", formatversion: "2", redirects: "1", maxlag: "5", ...params });
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + MIN_DELAY_MS - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
      this.last = this.deps.now();
      this.requests++;
      const res = await this.deps.fetch(`${API_URL}?${qs}`, { headers: { "User-Agent": WIKIPEDIA_USER_AGENT, "Api-User-Agent": WIKIPEDIA_USER_AGENT } });
      const retryAfter = Number(res.headers.get("retry-after") ?? NaN);
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) throw new Error(`Wikipedia API answered ${res.status} five times; stopping`);
        await this.deps.sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Wikipedia API answered ${res.status}`);
      const json = (await res.json()) as Record<string, unknown> & { error?: { code?: string; info?: string } };
      if (json.error?.code === "maxlag") {
        if (attempt >= 9) throw new Error("Wikipedia's servers stayed lagged; try again later");
        this.deps.log(`  Wikipedia is busy (maxlag); waiting`);
        await this.deps.sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000);
        continue;
      }
      if (json.error) throw new Error(`Wikipedia API error ${json.error.code}: ${json.error.info}`);
      return json;
    }
  }
}

interface ApiPage {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  revisions?: { revid?: number; timestamp?: string; slots?: { main?: { content?: string } } }[];
}
interface ApiQuery {
  normalized?: { from: string; to: string }[];
  redirects?: { from: string; to: string }[];
  pages?: ApiPage[];
}

/** `Module:College color/data`, from the cache when it is younger than CACHE_DAYS. */
export async function fetchColorModule(cacheDir: string, api: WikiApi, deps: WikiDeps, opts: { refresh?: boolean } = {}): Promise<CachedModule> {
  const path = join(cacheDir, "college-color-data.json");
  const cached = readJson<CachedModule | null>(path, null);
  if (cached && !opts.refresh && ageDays(cached.retrieved, deps.now()) < CACHE_DAYS) return cached;
  const json = await api.query({ prop: "revisions", rvprop: "content|ids|timestamp", rvslots: "main", titles: MODULE_TITLE });
  const page = ((json.query as ApiQuery | undefined)?.pages ?? [])[0];
  const rev = page?.revisions?.[0];
  const content = rev?.slots?.main?.content;
  if (!content) throw new Error(`${MODULE_TITLE}: no content in the API's answer`);
  const out: CachedModule = { retrieved: isoDate(deps.now()), revid: rev?.revid ?? null, timestamp: rev?.timestamp ?? null, content };
  mkdirSync(cacheDir, { recursive: true });
  writeJson(path, out);
  return out;
}

/** Maps each title asked for to the page it ended on (normalization first, then redirects; double redirects too). */
export function resolveTitles(asked: readonly string[], q: ApiQuery): Map<string, string> {
  const norm = new Map((q.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((q.redirects ?? []).map((r) => [r.from, r.to]));
  const out = new Map<string, string>();
  for (const a of asked) {
    let t = norm.get(a) ?? a;
    for (let hops = 0; redir.has(t) && hops < 3; hops++) t = redir.get(t)!;
    out.set(a, t);
  }
  return out;
}

/**
 * The lead section (section 0) of every title, from the cache when younger than CACHE_DAYS, else fetched in batches
 * of BATCH titles. The cache is saved after every batch.
 */
export async function fetchLeads(
  titles: readonly string[],
  cacheDir: string,
  api: WikiApi,
  deps: WikiDeps,
  opts: { refresh?: boolean } = {},
): Promise<Map<string, CachedLead>> {
  const path = join(cacheDir, "leads.json");
  const cache = readJson<Record<string, CachedLead>>(path, {});
  const now = deps.now();
  const stale = [...new Set(titles)].filter((t) => opts.refresh || !cache[t] || ageDays(cache[t].retrieved, now) >= CACHE_DAYS);
  mkdirSync(cacheDir, { recursive: true });
  const retry: string[] = [];
  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH);
    const got = await leadBatch(batch, api, deps);
    for (const t of batch) {
      const lead = got.get(t);
      if (lead && (lead.content !== undefined || lead.missing)) cache[t] = lead;
      else retry.push(t);
    }
    writeJson(path, cache);
    deps.log(`  leads: ${Math.min(i + BATCH, stale.length)} of ${stale.length} fetched`);
  }
  // A page a batch returned without content (rare): ask for it alone.
  for (const t of retry) {
    const lead = (await leadBatch([t], api, deps)).get(t);
    cache[t] = lead ?? { retrieved: isoDate(deps.now()), title: null, missing: true };
  }
  if (retry.length) writeJson(path, cache);
  return new Map(titles.filter((t) => cache[t]).map((t) => [t, cache[t]]));
}

async function leadBatch(batch: readonly string[], api: WikiApi, deps: WikiDeps): Promise<Map<string, CachedLead>> {
  const retrieved = isoDate(deps.now());
  const pages = new Map<string, ApiPage>();
  let q: ApiQuery = {};
  let cont: Record<string, string> = {};
  // The API continues a batch when the answer would pass its size limit; collect every part.
  for (;;) {
    const json = await api.query({ prop: "revisions", rvprop: "content", rvslots: "main", rvsection: "0", titles: batch.join("|"), ...cont });
    const part = (json.query as ApiQuery | undefined) ?? {};
    q = { normalized: [...(q.normalized ?? []), ...(part.normalized ?? [])], redirects: [...(q.redirects ?? []), ...(part.redirects ?? [])] };
    for (const p of part.pages ?? []) {
      const prev = pages.get(p.title);
      if (!prev?.revisions?.[0]?.slots?.main?.content) pages.set(p.title, p);
    }
    const next = json.continue as Record<string, string> | undefined;
    if (!next) break;
    cont = next;
  }
  const resolved = resolveTitles(batch, q);
  const out = new Map<string, CachedLead>();
  for (const t of batch) {
    const final = resolved.get(t) ?? t;
    const page = pages.get(final);
    if (!page) continue;
    if (page.missing || page.invalid) {
      out.set(t, { retrieved, title: final, missing: true });
      continue;
    }
    const content = page.revisions?.[0]?.slots?.main?.content;
    if (content !== undefined) out.set(t, { retrieved, title: final, content });
  }
  return out;
}

/** One row per line, so a refresh's diff shows which colleges changed. */
export function formatRows(rows: readonly object[]): string {
  return rows.length ? `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n` : "[]\n";
}

/**
 * The color step on disk: reads the article links (data/wikidata.json, or `wikidataPath`), fetches, joins, and writes
 * data/brand-colors.json. With `ids`, only those colleges' rows are replaced. sync-wikidata may call this after
 * writing its file; `npm run sync-brand -- --colors` runs it alone.
 */
export async function syncBrandColors(
  root: string,
  opts: { ids?: ReadonlySet<string>; refresh?: boolean; wikidataPath?: string; deps?: WikiDeps } = {},
): Promise<ColorsRun> {
  const wikidataPath = opts.wikidataPath ?? join(root, "data", "wikidata.json");
  if (!existsSync(wikidataPath)) throw new Error(`${wikidataPath} is missing: run \`npm run sync-wikidata\` first (it gives each college's Wikipedia article)`);
  const wikidata = JSON.parse(readFileSync(wikidataPath, "utf8")) as Pick<WikidataEntry, "unit_id" | "wikipedia">[];
  const run = await buildBrandColors(wikidata, join(root, ".cache", "wikipedia"), opts.deps ?? defaultDeps(), opts);
  const outPath = join(root, "data", "brand-colors.json");
  let rows = run.entries;
  if (opts.ids) {
    const kept = readJson<BrandColorEntry[]>(outPath, []).filter((e) => !opts.ids!.has(e.unit_id));
    rows = [...kept, ...run.entries].sort((a, b) => a.unit_id.localeCompare(b.unit_id));
  }
  writeFileSync(outPath, formatRows(rows));
  return { ...run, entries: rows };
}

export interface ColorsRun {
  entries: BrandColorEntry[];
  /** Colleges with an article whose lead gave no colors, by reason, for the run summary. */
  misses: Record<string, number>;
  requests: number;
  module: { entries: number; aliases: number; retrieved: string; revid: number | null };
}

/**
 * Colors for every college with an English Wikipedia article: the module once, each article's lead, then the pure
 * join in lib/brand-colors.ts (`colorsForArticle`). `ids` limits the run to those colleges.
 */
export async function buildBrandColors(
  wikidata: readonly Pick<WikidataEntry, "unit_id" | "wikipedia">[],
  cacheDir: string,
  deps: WikiDeps = defaultDeps(),
  opts: { ids?: ReadonlySet<string>; refresh?: boolean } = {},
): Promise<ColorsRun> {
  const api = new WikiApi(deps);
  const mod = await fetchColorModule(cacheDir, api, deps, opts);
  const parsed: ColorModule = parseColorModule(mod.content);
  const rows = wikidata.filter((w) => (!opts.ids || opts.ids.has(w.unit_id)) && titleFromArticleUrl(w.wikipedia));
  const titles = rows.map((r) => titleFromArticleUrl(r.wikipedia)!);
  const leads = await fetchLeads(titles, cacheDir, api, deps, opts);
  const entries: BrandColorEntry[] = [];
  const misses: Record<string, number> = {};
  for (const r of rows) {
    const lead = leads.get(titleFromArticleUrl(r.wikipedia)!);
    if (!lead || lead.missing || lead.content === undefined) {
      misses["no such article"] = (misses["no such article"] ?? 0) + 1;
      continue;
    }
    const article = `https://en.wikipedia.org/wiki/${encodeURIComponent((lead.title ?? "").replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":")}`;
    const found = colorsForArticle(lead.content, parsed);
    if (!found.colors) {
      misses[found.reason] = (misses[found.reason] ?? 0) + 1;
      continue;
    }
    entries.push({
      unit_id: r.unit_id,
      colors: found.colors.colors,
      names: found.colors.names,
      key: found.colors.key,
      article,
      cite_url: found.colors.cite_url,
      cite_title: found.colors.cite_title,
      retrieved: found.colors.key ? mod.retrieved : lead.retrieved,
      via: found.colors.via,
      ...(found.colors.quote ? { quote: found.colors.quote } : {}),
    });
  }
  entries.sort((a, b) => a.unit_id.localeCompare(b.unit_id));
  return {
    entries,
    misses,
    requests: api.requests,
    module: { entries: parsed.entries.size, aliases: parsed.aliases.size, retrieved: mod.retrieved, revid: mod.revid },
  };
}
