/**
 * The free rungs of the discovery ladder (specs/college-reported-round-3.md Decisions 6 and 8): HTTP only, through
 * `PoliteHttp` (robots.txt, the 1-second per-host gap, the 60-second timeout and 50 MB cap), no model.
 *
 *   step 0 `knownStep`: the owner's list (data/reference/cds-urls.json), the recipe's index pages re-scanned for a newer
 *          link, and next year's file name guessed from the one we know.
 *   step 1 `probeStep`: (a) sitemaps listed in robots.txt, sitemap indexes followed, scanned for CDS and class-profile
 *          URLs; (b) IR host × path patterns on the college's domain (from the 35 real recipes); (c) the Scorecard
 *          website, then a two-hop crawl following links that name institutional research, facts, or data.
 *          At most PROBE_LIMITS.total page requests per college (robots.txt is fetched once per host on top).
 *
 * Share links (Google Sheets and Drive, Box, SharePoint/OneDrive) are rewritten by rule and accepted only when the
 * answer starts with `%PDF` or `PK`; anything else (a viewer page, a sign-in page) goes to the owner. Nothing here works
 * around bot protection: a refusal is recorded (./blocked.mts) and the step moves on.
 */
import { gunzipSync } from "node:zlib";
import type { CdsUrlEntry, DiscoveryAttempt, DiscoveryPath, DocumentFormat, Recipe, RecipeSource } from "../../../lib/reported.ts";
import type { ReportedSourceKind, School } from "../../../lib/types";
import { blockedStatusOf, type BlockedObservation } from "./blocked.mts";
import { decodeEntities, entryYearOf, findLinks, newSourcesFromIndex, newSourcesFromLinks, type FoundLink } from "./documents.mts";
import { guessNextEditionUrls } from "./guess.mts";

/* ------------------------------------------------------------------ */
/* Shapes shared with the ladder (./discovery.mts)                     */
/* ------------------------------------------------------------------ */

/** A page the free steps fetched, reduced to its links: what the Haiku picker (step 2) reads. */
export interface ProbePage {
  url: string;
  links: FoundLink[];
}

/** A downloaded document, kept so the first read doesn't fetch it again. */
export interface Prefetched {
  bytes: Uint8Array;
  format: DocumentFormat;
}

/** What one ladder step found. A free step has found a document when `sources` holds a CDS. */
export interface StepFind {
  /** How the find was made (`none` when nothing was found). */
  path: DiscoveryPath;
  sources: RecipeSource[];
  index_urls: string[];
  /** One row per sub-step, turned into `recipe.discovery.tried` rows by the ladder. */
  attempts?: { via?: DiscoveryPath; result: DiscoveryAttempt["result"]; detail?: string }[];
  /** HTML pages fetched, for the picker. */
  pages?: ProbePage[];
  /** Hosts that answered with a page or a refusal (candidates for the blocked-host rule). */
  answered?: string[];
  blocked?: BlockedObservation[];
  prefetched?: Map<string, Prefetched>;
  /** Page requests made (the probe's budget). */
  requests?: number;
  /** For paid steps: the model that found it, its notes, and whether it says nothing newer is published. */
  model?: string;
  notes?: string;
  none_found?: boolean;
}

/** The slice of `PoliteHttp` the probes use (tests pass a real PoliteHttp over a fake fetch). */
export interface ProbeHttp {
  get(url: string): Promise<Response | null>;
  sitemaps(url: string): Promise<string[]>;
}

/* ------------------------------------------------------------------ */
/* Patterns (from data/college-sources.json's 35 real recipes)         */
/* ------------------------------------------------------------------ */

/** IR subdomains seen in the real recipes, most common first. */
export const IR_HOST_PREFIXES = [
  "ir.",
  "oir.",
  "oira.",
  "irp.",
  "ira.",
  "irds.",
  "iris.",
  "oirds.",
  "opir.",
  "obp.",
  "oie.",
  "opa.",
  "apb.",
  "dair.",
  "abpa.",
  "ir.provost.",
  "ir.web.",
] as const;

export const IR_PATHS = ["/common-data-set", "/cds", "/institutional-research/common-data-set", "/common-data-set-archive"] as const;

/** Page requests per college: in all, and per sub-step (robots.txt, once per host, is not counted). */
export const PROBE_LIMITS = { total: 40, sitemaps: 8, sitemapPages: 3, hosts: 20, crawl: 12, linksPerPage: 300 } as const;

/** A sitemap URL worth a look: a CDS page or file, or a class profile. */
export const SITEMAP_HIT =
  /common[-_ ]?data[-_ ]?set|commondataset|\/cds(?:[/._-]|$)|class[-_]?profile|(?:first[-_]?year|freshman|incoming|entering)[-_]?(?:class[-_]?|student[-_]?)?profile|admissions?[-_]?(?:statistics|stats)/i;
const CDS_URL = /common[-_ ]?data[-_ ]?set|commondataset|\/cds(?:[/._-]|$)/i;
const CDS_TEXT = /common\s*data\s*set|(^|[^a-z])cds([^a-z]|$)/i;
const FILE_URL = /\.(pdf|xlsx?|docx?|zip|png|jpe?g)($|\?)/i;

/* ------------------------------------------------------------------ */
/* Domains                                                             */
/* ------------------------------------------------------------------ */

/** The Scorecard website as a URL ("www.x.edu/" gets https://), or null. */
export function websiteUrl(school: Pick<School, "links">): URL | null {
  const raw = school.links?.website?.trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/** The registrable domain of a host: "www.cmu.edu" → "cmu.edu"; "www.ox.ac.uk" → "ox.ac.uk". */
export function collegeDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const second = labels[labels.length - 2];
  const take = labels[labels.length - 1].length === 2 && ["ac", "co", "edu", "gov", "org"].includes(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

const onSite = (url: string, domain: string) => {
  try {
    const h = new URL(url).host.toLowerCase();
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ */
/* Share links (Decision 8)                                            */
/* ------------------------------------------------------------------ */

export type ShareService = "google-sheets" | "google-drive-file" | "google-drive-folder" | "box" | "sharepoint";

/** A share link rewritten to its direct download, or `manual` when no rule can (a Drive folder). */
export type ShareRewrite = { service: ShareService; url: string } | { service: ShareService; manual: string };

/**
 * The direct-download form of a share link, by rule, or null when `url` isn't a share link:
 * - Google Sheets `/spreadsheets/d/<id>/…` → `/spreadsheets/d/<id>/export?format=xlsx`
 * - Google Drive file `/file/d/<id>/…` or `open?id=` → `https://drive.google.com/uc?export=download&id=<id>`
 * - Google Drive folder → manual
 * - Box `/s/<id>` → `/shared/static/<id>` (direct only when the owner allowed it)
 * - SharePoint / OneDrive → `download=1` appended (an assumption, confirmed by the bytes)
 */
export function rewriteShareLink(url: string): ShareRewrite | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.host.toLowerCase();
  if (host === "docs.google.com") {
    const m = /^\/spreadsheets\/d\/([\w-]+)/.exec(u.pathname);
    if (m) return { service: "google-sheets", url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx` };
    return null;
  }
  if (host === "drive.google.com") {
    if (/\/folders\//.test(u.pathname)) return { service: "google-drive-folder", manual: "a Google Drive folder has no direct download; the owner picks the file" };
    const id = /^\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? ((u.pathname === "/open" || u.pathname === "/uc") && u.searchParams.get("id")) ?? null;
    if (id) return { service: "google-drive-file", url: `https://drive.google.com/uc?export=download&id=${id}` };
    return null;
  }
  if (host === "box.com" || host.endsWith(".box.com")) {
    const m = /^\/(?:s|shared\/static)\/([\w.-]+)/.exec(u.pathname);
    if (m) return { service: "box", url: `https://${host}/shared/static/${m[1]}` };
    return null;
  }
  if (host.endsWith(".sharepoint.com") || host === "onedrive.live.com" || host === "1drv.ms") {
    const next = new URL(u);
    next.searchParams.set("download", "1");
    return { service: "sharepoint", url: next.toString() };
  }
  return null;
}

/** "pdf" for `%PDF`, "xlsx" for `PK` (a zip: Excel), else null. Only the bytes count, never the URL or content type. */
export function magicFormat(bytes: Uint8Array): "pdf" | "xlsx" | null {
  const head = Buffer.from(bytes.subarray(0, 4)).toString("latin1");
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK")) return "xlsx";
  return null;
}

export type Confirmed = { ok: true; url: string; format: "pdf" | "xlsx"; bytes: Uint8Array } | { ok: false; url: string; reason: string; manual: true };

/** GETs `url` and accepts it only when the answer is a PDF or Excel file by its first bytes. */
export async function confirmDocument(get: (url: string) => Promise<Response | null>, url: string): Promise<Confirmed> {
  let res: Response | null;
  try {
    res = await get(url);
  } catch (err) {
    return { ok: false, url, reason: err instanceof Error ? err.message : String(err), manual: true };
  }
  if (!res) return { ok: false, url, reason: "robots.txt disallows it", manual: true };
  if (!res.ok) return { ok: false, url, reason: `HTTP ${res.status}`, manual: true };
  const bytes = new Uint8Array(await res.arrayBuffer());
  const format = magicFormat(bytes);
  if (!format) return { ok: false, url, reason: "HTML back, not a file (a viewer or sign-in page)", manual: true };
  return { ok: true, url, format, bytes };
}

/** Rewrites a share link and confirms the rewrite by its bytes. Not a share link, a folder, or HTML back → manual. */
export async function resolveShareLink(get: (url: string) => Promise<Response | null>, url: string): Promise<Confirmed> {
  const rw = rewriteShareLink(url);
  if (!rw) return { ok: false, url, reason: "not a share link", manual: true };
  if ("manual" in rw) return { ok: false, url, reason: rw.manual, manual: true };
  return confirmDocument(get, rw.url);
}

/* ------------------------------------------------------------------ */
/* Pages and sitemaps                                                  */
/* ------------------------------------------------------------------ */

/**
 * What a page offers: its newest CDS (and class-profile) file links, as `newSourcesFromIndex` reads them, plus CDS
 * share links (a Box or Drive link whose text names the Common Data Set), newest edition first.
 */
export function sourcesFromPage(html: string, pageUrl: string): { sources: RecipeSource[]; shareLinks: FoundLink[] } {
  const sources = newSourcesFromIndex(html, pageUrl, []);
  const year = (l: FoundLink) => entryYearOf(`${l.url} ${l.text}`) ?? -1;
  const shareLinks = findLinks(html, pageUrl)
    .filter((l) => rewriteShareLink(l.url) && CDS_TEXT.test(l.text))
    .sort((a, b) => year(b) - year(a));
  return { sources, shareLinks };
}

/** A sitemap's `<loc>` entries, and whether it is a sitemap index. */
export function parseSitemap(xml: string): { index: boolean; locs: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
  return { index: /<sitemapindex[\s>]/i.test(xml), locs };
}

/** Children of a sitemap index most likely to list IR pages first (pages before posts, media and people last). */
function rankSitemapChildren(locs: string[]): string[] {
  const score = (u: string) =>
    (/institutional|research|\bir\b|data|cds|admission|about|page/i.test(u) ? 2 : 0) - (/image|video|media|event|news|people|person|faculty|tag|author/i.test(u) ? 2 : 0);
  return [...locs].sort((a, b) => score(b) - score(a));
}

const decodeUrl = (u: string) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

/** Bytes as text; a gzipped sitemap (`.xml.gz`) is unpacked. */
function textOf(bytes: Uint8Array): string {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return gunzipSync(bytes).toString("utf8");
    } catch {
      return "";
    }
  }
  return new TextDecoder().decode(bytes);
}

/** How strongly a link's text (and, for IR, its path) points at institutional research, facts, or data. 0 = don't follow. */
export function crawlScore(link: FoundLink): number {
  const t = link.text.toLowerCase();
  let path = "";
  try {
    path = new URL(link.url).pathname.toLowerCase();
  } catch {
    return 0;
  }
  if (FILE_URL.test(path)) return 0;
  if (CDS_TEXT.test(t)) return 5;
  if (/institutional\s+(research|effectiveness|analytics|planning|data|assessment)|office of (planning|analytics|data)|decision support|\bir\b/.test(t)) return 3;
  if (/institutional[-_]research|\/ir(\/|$)|\/oir(\/|$)/.test(path)) return 3;
  if (/\bfacts?\b|\bdata\b|at a glance|by the numbers|statistics|fact ?book/.test(t)) return 1;
  return 0;
}

/* ------------------------------------------------------------------ */
/* One college's probe session                                         */
/* ------------------------------------------------------------------ */

interface Fetched {
  url: string;
  finalUrl: string;
  status: number;
  bytes: Uint8Array;
  html: string | null;
  blocked: boolean;
}

/** Counts page requests against a budget and collects what the ladder needs: answered hosts, refusals, pages. */
class Session {
  requests = 0;
  readonly answered = new Set<string>();
  readonly blocked: BlockedObservation[] = [];
  readonly pages: ProbePage[] = [];
  readonly prefetched = new Map<string, Prefetched>();
  readonly errors: string[] = [];
  private http: ProbeHttp;
  private limit: number;
  private unitId: string;
  constructor(http: ProbeHttp, limit: number, unitId: string) {
    this.http = http;
    this.limit = limit;
    this.unitId = unitId;
  }

  left() {
    return this.limit - this.requests;
  }

  /** The `get` for confirmDocument: counted and observed like any page. */
  readonly get = async (url: string): Promise<Response | null> => {
    if (this.left() <= 0) return null;
    let res: Response | null;
    try {
      res = await this.http.get(url);
    } catch (err) {
      this.requests++;
      throw err;
    }
    if (!res) return null; // robots.txt: no page request was made
    this.requests++;
    return res;
  };

  /** A counted, observed GET; null when robots.txt, the budget, or a network error stopped it. */
  async fetch(url: string): Promise<Fetched | null> {
    let res: Response | null;
    try {
      res = await this.get(url);
    } catch (err) {
      this.errors.push(`${url}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
    if (!res) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const finalUrl = res.url || url;
    const host = new URL(finalUrl).host;
    const isFile = magicFormat(bytes) !== null;
    const html = !isFile && res.status < 400 ? textOf(bytes) : null;
    const status = blockedStatusOf(res.status, res.headers, isFile ? "" : textOf(bytes.subarray(0, 64 * 1024)));
    if (status !== null) {
      this.blocked.push({ host: new URL(url).host, url, status, unit_id: this.unitId });
      this.answered.add(new URL(url).host);
    } else if (res.ok) this.answered.add(host);
    if (html && res.ok && status === null) this.pages.push({ url: finalUrl, links: findLinks(html, finalUrl).slice(0, PROBE_LIMITS.linksPerPage) });
    return { url, finalUrl, status: res.status, bytes, html: status === null ? html : null, blocked: status !== null };
  }

  /**
   * The documents a fetched page leads to: the page itself when it is a CDS file, else its newest CDS file links, else
   * its first CDS share link that resolves to a file.
   */
  async documentsOn(page: Fetched, why: string[]): Promise<RecipeSource[]> {
    const format = magicFormat(page.bytes);
    if (format) {
      this.prefetched.set(page.finalUrl, { bytes: page.bytes, format });
      return CDS_URL.test(decodeUrl(page.url)) ? [{ kind: "cds", url: page.finalUrl, format }] : [];
    }
    if (!page.html || page.status !== 200) return [];
    const { sources, shareLinks } = sourcesFromPage(page.html, page.finalUrl);
    if (sources.some((s) => s.kind === "cds")) return sources;
    for (const link of shareLinks.slice(0, 2)) {
      const got = await resolveShareLink(this.get, link.url);
      if (got.ok) {
        this.prefetched.set(got.url, { bytes: got.bytes, format: got.format });
        return [...sources, { kind: "cds", url: got.url, format: got.format }];
      }
      why.push(`share link ${link.url}: ${got.reason}`);
    }
    return sources;
  }

  find(path: DiscoveryPath, sources: RecipeSource[], index_urls: string[], attempts: NonNullable<StepFind["attempts"]>): StepFind {
    return {
      path,
      sources,
      index_urls,
      attempts,
      pages: this.pages,
      answered: [...this.answered],
      blocked: this.blocked,
      prefetched: this.prefetched,
      requests: this.requests,
    };
  }
}

const hasCds = (sources: RecipeSource[]) => sources.some((s) => s.kind === "cds");

function formatFromUrl(url: string, kind: ReportedSourceKind): DocumentFormat {
  if (/\.xlsx($|\?)|format=xlsx/i.test(url)) return "xlsx";
  if (/\.pdf($|\?)/i.test(url)) return "pdf";
  return kind === "cds" ? "pdf" : "html";
}

/* ------------------------------------------------------------------ */
/* Step 0: known                                                       */
/* ------------------------------------------------------------------ */

export interface KnownInput {
  school: School;
  recipe?: Recipe;
  /** The owner's entries (data/reference/cds-urls.json); only this college's are used. */
  manual?: CdsUrlEntry[];
}

/**
 * Step 0. The owner's list first (no fetch: the link may be on a blocked host, and the owner may have archived the file
 * with `npm run archive-doc`; share links are rewritten by rule). Then the recipe's index pages, re-scanned for a newer
 * edition. Then next year's file name guessed from the CDS URL we know, accepted only by its bytes.
 */
export async function knownStep(http: ProbeHttp, c: KnownInput, o: { limit?: number } = {}): Promise<StepFind> {
  const s = new Session(http, o.limit ?? PROBE_LIMITS.total, c.school.unit_id);
  const mine = (c.manual ?? []).filter((e) => e.unit_id === c.school.unit_id);
  if (mine.length) {
    const sources: RecipeSource[] = mine.map((e) => {
      const rw = rewriteShareLink(e.url);
      const url = rw && "url" in rw ? rw.url : e.url;
      return { kind: e.kind, url, format: formatFromUrl(url, e.kind) };
    });
    return s.find("manual", sources, [], [{ via: "manual", result: "found", detail: `the owner's list: ${sources.map((x) => x.url).join(" ")}` }]);
  }
  const attempts: NonNullable<StepFind["attempts"]> = [];
  const existing = c.recipe?.sources ?? [];
  for (const idx of c.recipe?.index_urls ?? []) {
    const page = await s.fetch(idx);
    if (!page?.html || page.status !== 200) continue;
    const fresh = newSourcesFromIndex(page.html, page.finalUrl, existing);
    if (hasCds(fresh)) {
      attempts.push({ via: "known", result: "found", detail: `newer link on ${idx}` });
      return s.find("known", fresh, c.recipe!.index_urls, attempts);
    }
  }
  if (c.recipe?.index_urls.length) attempts.push({ via: "known", result: "none", detail: "no newer link on the index pages" });
  const bases = [...new Set([c.school.cds?.url, ...existing.filter((x) => x.kind === "cds").map((x) => x.url)].filter((u): u is string => !!u))];
  const tried = new Set<string>();
  for (const base of bases) {
    for (const url of guessNextEditionUrls(base, c.school.admissions.year ?? 0)) {
      if (tried.has(url)) continue;
      tried.add(url);
      const got = await confirmDocument(s.get, url);
      if (got.ok) {
        s.prefetched.set(url, { bytes: got.bytes, format: got.format });
        attempts.push({ via: "guessed", result: "found", detail: url });
        return s.find("guessed", [{ kind: "cds", url, format: got.format }], c.recipe?.index_urls ?? [], attempts);
      }
    }
  }
  if (tried.size) attempts.push({ via: "guessed", result: "none", detail: `${tried.size} guessed URL(s) answered with no file` });
  return s.find("none", [], [], attempts);
}

/* ------------------------------------------------------------------ */
/* Step 1: free probes                                                 */
/* ------------------------------------------------------------------ */

/** Step 1: sitemaps, then IR host patterns, then the two-hop crawl; stops at the first that finds a CDS. */
export async function probeStep(http: ProbeHttp, school: School, o: { limit?: number } = {}): Promise<StepFind> {
  const s = new Session(http, o.limit ?? PROBE_LIMITS.total, school.unit_id);
  const site = websiteUrl(school);
  if (!site) return s.find("none", [], [], [{ via: "probe-sitemap", result: "skipped", detail: "no website" }]);
  const domain = collegeDomain(site.host);
  const attempts: NonNullable<StepFind["attempts"]> = [];
  const why: string[] = [];
  const done = (path: DiscoveryPath, sources: RecipeSource[], index: string[], detail: string) => {
    attempts.push({ via: path, result: "found", detail });
    return s.find(path, sources, index, attempts);
  };
  const none = (via: DiscoveryPath, detail: string) => attempts.push({ via, result: "none", detail: [detail, ...why.splice(0)].join("; ") });

  /* (a) sitemaps */
  const profiles: RecipeSource[] = [];
  {
    const start = s.requests;
    const listed = await http.sitemaps(site.origin);
    const queue = listed.length ? [...listed] : [`${site.origin}/sitemap.xml`];
    const seen = new Set<string>();
    const hits: string[] = [];
    while (queue.length && s.requests - start < PROBE_LIMITS.sitemaps && s.left() > 0) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const got = await s.fetch(url);
      if (!got || got.status !== 200 || got.blocked) continue;
      const { index, locs } = parseSitemap(textOf(got.bytes));
      if (index) queue.push(...rankSitemapChildren(locs).filter((l) => !seen.has(l)));
      else for (const l of locs) if (SITEMAP_HIT.test(decodeUrl(l)) && !hits.includes(l)) hits.push(l);
      if (hits.some((h) => CDS_URL.test(decodeUrl(h)))) break;
    }
    const asLinks = hits.map((url) => ({ url, text: "" }));
    const files = newSourcesFromLinks(asLinks, []);
    const pages = hits.filter((h) => !FILE_URL.test(h));
    const newest = (u: string) => entryYearOf(u) ?? -1;
    const profile = pages.filter((h) => !CDS_URL.test(decodeUrl(h))).sort((a, b) => newest(b) - newest(a) || a.length - b.length)[0];
    if (profile && !files.some((f) => f.kind === "class-profile")) profiles.push({ kind: "class-profile", url: profile, format: "html" });
    profiles.push(...files.filter((f) => f.kind === "class-profile"));
    if (hasCds(files)) return done("probe-sitemap", [...files.filter((f) => f.kind === "cds"), ...profiles], [], `${hits.length} sitemap hit(s)`);
    const cdsPages = pages.filter((h) => CDS_URL.test(decodeUrl(h))).sort((a, b) => newest(b) - newest(a) || a.length - b.length);
    for (const page of cdsPages.slice(0, PROBE_LIMITS.sitemapPages)) {
      const got = await s.fetch(page);
      if (!got) continue;
      const docs = await s.documentsOn(got, why);
      if (hasCds(docs)) return done("probe-sitemap", [...docs, ...profiles], [got.finalUrl], `CDS page in the sitemap: ${page}`);
    }
    none("probe-sitemap", `${seen.size} sitemap(s), ${hits.length} hit(s)`);
  }

  /* (b) IR hosts × paths */
  {
    const start = s.requests;
    let tried = 0;
    hosts: for (const prefix of IR_HOST_PREFIXES) {
      const host = `${prefix}${domain}`;
      for (const path of IR_PATHS) {
        if (s.requests - start >= PROBE_LIMITS.hosts || s.left() <= 0) break hosts;
        const before = s.requests;
        const got = await s.fetch(`https://${host}${path}`);
        if (s.requests > before) tried++;
        // No such host (robots.txt unreachable), robots.txt says no, a network error, or a refusal: next host.
        if (!got || got.blocked) continue hosts;
        // Redirected off the host (a catch-all to the main site): its other paths would land there too.
        if (new URL(got.finalUrl).host !== host) continue hosts;
        if (got.status !== 200) continue;
        const docs = await s.documentsOn(got, why);
        if (hasCds(docs)) return done("probe-host", [...docs, ...profiles], [got.finalUrl], `https://${host}${path}`);
      }
    }
    none("probe-host", `${tried} IR host request(s)`);
  }

  /* (c) the website, then two hops */
  {
    const start = s.requests;
    const frontier: { url: string; depth: number; score: number }[] = [{ url: site.toString(), depth: 0, score: 99 }];
    const visited = new Set<string>();
    while (frontier.length && s.requests - start < PROBE_LIMITS.crawl && s.left() > 0) {
      frontier.sort((a, b) => b.score - a.score || a.depth - b.depth);
      const next = frontier.shift()!;
      if (visited.has(next.url)) continue;
      visited.add(next.url);
      const got = await s.fetch(next.url);
      if (!got || got.status !== 200) continue;
      visited.add(got.finalUrl);
      const docs = await s.documentsOn(got, why);
      if (hasCds(docs)) return done("probe-crawl", [...docs, ...profiles], [got.finalUrl], `${next.depth} hop(s) from ${site}`);
      if (next.depth >= 2 || !got.html) continue;
      for (const link of findLinks(got.html, got.finalUrl)) {
        if (visited.has(link.url) || !onSite(link.url, domain)) continue;
        const score = crawlScore(link);
        if (score > 0) frontier.push({ url: link.url, depth: next.depth + 1, score });
      }
    }
    none("probe-crawl", `${visited.size} page(s) crawled`);
  }
  if (s.errors.length) attempts.push({ via: "probe-crawl", result: "failed", detail: s.errors.slice(0, 3).join("; ") });
  return s.find("none", profiles, [], attempts);
}

/** Steps 0 and 1 over one `PoliteHttp`, in the shape the ladder takes (`LadderDeps.known` and `.probe`). */
export function freeSteps(http: ProbeHttp, manual: CdsUrlEntry[] = []) {
  return {
    known: (c: { school: School; recipe?: Recipe }) => knownStep(http, { ...c, manual }),
    probe: (c: { school: School }) => probeStep(http, c.school),
  };
}
