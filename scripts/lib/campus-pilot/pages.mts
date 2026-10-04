/**
 * Fetching a college's own pages for the campus-life pilot: our code (never the model) requests every URL, through the
 * national-directory crawler's PoliteHttp (robots.txt, Crawl-delay, ≥ 2 s per host, the `college-stats-research`
 * identity). Refusals (challenges, 401/403/429, login redirects, robots) come back as `blocked` and are recorded for
 * the owner (decision 1), never worked around. Bodies are cached under .cache/campus-pages/ (git-ignored) so re-runs
 * don't refetch; the recipe keeps each page's hash, ETag, and Last-Modified for conditional re-fetches later.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { PoliteHttp } from "../college-reported/http.mts";
import { detectFormat, findLinks, htmlToText, pdfPages, type FoundLink } from "../college-reported/documents.mts";
import { refusalOf } from "../directories/context.mts";

export interface Page {
  url: string;
  final_url: string;
  format: "html" | "pdf" | "other";
  /** Readable text (HTML → text; PDF → text with "--- Page N ---" markers). */
  text: string;
  links: FoundLink[];
  /** XML bodies (sitemaps) as served; HTML and PDF pages leave it out. */
  raw?: string;
  sha256: string;
  etag?: string;
  last_modified?: string;
  fetched: string;
}

export type FetchResult = { ok: true; page: Page } | { ok: false; url: string; blocked?: string; error?: string };

interface CacheMeta {
  url: string;
  final_url: string;
  status: number;
  content_type: string | null;
  etag?: string;
  last_modified?: string;
  fetched: string;
  sha256: string;
}

const MAX_AGE_DAYS = 30;
/** Pages longer than this are cut (a conduct handbook can run hundreds of pages; extraction reads keyword windows). */
const MAX_PDF_PAGES = 200;

export class PageFetcher {
  private http: PoliteHttp;
  private dir: string;
  private today: string;
  private memo = new Map<string, Promise<FetchResult>>();
  /** Every request this run made (not cache hits), for the run report. */
  requests = 0;
  /** Refusals seen, for data/directories/blocked.json. */
  blocked: { url: string; reason: string }[] = [];
  private recorded = new Set<string>();

  private unreachableHosts: ReadonlySet<string>;

  /**
   * `unreachableHosts`: filled by the PoliteHttp's log hook (see `httpLogHook`) with hosts that didn't answer, so a
   * dead host isn't recorded as a robots.txt refusal.
   */
  constructor(http: PoliteHttp, cacheDir: string, today: string, unreachableHosts: ReadonlySet<string> = new Set()) {
    this.http = http;
    this.dir = cacheDir;
    this.today = today;
    this.unreachableHosts = unreachableHosts;
  }

  private unreachable(url: string): boolean {
    try {
      return this.unreachableHosts.has(new URL(url).host);
    } catch {
      return false;
    }
  }

  /**
   * The page at `url` (memoized per run). `quiet`: a free discovery probe — a robots.txt refusal or a challenge is just
   * a miss, not a block for the owner's list (a later non-quiet read of the same URL still records it).
   */
  async get(url: string, o: { quiet?: boolean } = {}): Promise<FetchResult> {
    let p = this.memo.get(url);
    if (!p) {
      p = this.load(url);
      this.memo.set(url, p);
    }
    const r = await p;
    if (!r.ok && r.blocked && !o.quiet && !this.recorded.has(url)) {
      this.recorded.add(url);
      this.blocked.push({ url, reason: r.blocked });
    }
    return r;
  }

  /** The `Sitemap:` URLs robots.txt lists for `origin` (none when the fetcher has no robots-aware client). */
  async sitemaps(origin: string): Promise<string[]> {
    try {
      return await this.http.sitemaps(origin);
    } catch {
      return [];
    }
  }

  /** A text body as served (a sitemap's XML), through the same cache and robots rules, or null. Gzip is unpacked. */
  async raw(url: string, o: { quiet?: boolean } = {}): Promise<string | null> {
    const r = await this.get(url, o);
    if (!r.ok) return null;
    return r.page.raw ?? null;
  }

  private key(url: string) {
    return createHash("sha256").update(url).digest("hex").slice(0, 32);
  }

  private async load(url: string): Promise<FetchResult> {
    if (!/^https?:\/\//.test(url)) return { ok: false, url, error: "not an http(s) URL" };
    // Campus Labs Engage's JSON API is disallowed by the colleges' robots.txt (UT's, checked 2026-09-28); never request
    // it, whatever a given host's robots.txt says (religious-life.md "Access rules").
    if (/\/engage\/api\//i.test(url)) return { ok: false, url, blocked: "robots" };
    const base = join(this.dir, this.key(url));
    if (existsSync(`${base}.json`)) {
      const meta = JSON.parse(readFileSync(`${base}.json`, "utf8")) as CacheMeta;
      const age = (Date.parse(this.today) - Date.parse(meta.fetched)) / 86_400_000;
      if (age <= MAX_AGE_DAYS && existsSync(`${base}.bin`)) return this.parse(meta, new Uint8Array(readFileSync(`${base}.bin`)));
    }
    let res: Response | null;
    try {
      this.requests++;
      res = await this.http.get(url);
    } catch (err) {
      return { ok: false, url, error: (err instanceof Error ? err.message : String(err)).slice(0, 160) };
    }
    if (!res) {
      // PoliteHttp returns null both for a robots.txt refusal and for a host that never answered (no DNS, refused, or
      // a 5xx for robots.txt); only the first is a block for the owner's list (decision 1), the second is a dead page.
      if (this.unreachable(url)) return { ok: false, url, error: "host didn't answer" };
      return { ok: false, url, blocked: "robots" };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
    const refusal = refusalOf(url, res, head);
    if (refusal) return { ok: false, url, blocked: refusal };
    if (!res.ok) return { ok: false, url, error: `HTTP ${res.status}` };
    const meta: CacheMeta = {
      url,
      final_url: res.url || url,
      status: res.status,
      content_type: res.headers.get("content-type"),
      ...(res.headers.get("etag") ? { etag: res.headers.get("etag")! } : {}),
      ...(res.headers.get("last-modified") ? { last_modified: res.headers.get("last-modified")! } : {}),
      fetched: this.today,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(`${base}.bin`, bytes);
    writeFileSync(`${base}.json`, JSON.stringify(meta));
    return this.parse(meta, bytes);
  }

  private async parse(meta: CacheMeta, bytes: Uint8Array): Promise<FetchResult> {
    const fmt = detectFormat(bytes, meta.content_type, meta.final_url);
    const common = { url: meta.url, final_url: meta.final_url, sha256: meta.sha256, fetched: meta.fetched, ...(meta.etag ? { etag: meta.etag } : {}), ...(meta.last_modified ? { last_modified: meta.last_modified } : {}) };
    if (fmt === "pdf") {
      try {
        const pages = (await pdfPages(bytes)).slice(0, MAX_PDF_PAGES);
        return { ok: true, page: { ...common, format: "pdf", text: pages.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join("\n"), links: [] } };
      } catch (err) {
        return { ok: false, url: meta.url, error: `PDF unreadable: ${(err instanceof Error ? err.message : String(err)).slice(0, 100)}` };
      }
    }
    if (fmt === "xlsx") return { ok: false, url: meta.url, error: "spreadsheet (not read by the pilot)" };
    const body = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzip(bytes) : new TextDecoder().decode(bytes);
    if (/^\s*<\?xml|<(urlset|sitemapindex)[\s>]/i.test(body.slice(0, 500))) return { ok: true, page: { ...common, format: "other", text: "", links: [], raw: body } };
    return { ok: true, page: { ...common, format: "html", text: htmlToText(body), links: findLinks(body, meta.final_url) } };
  }
}

function gunzip(bytes: Uint8Array): string {
  try {
    return gunzipSync(bytes).toString("utf8");
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Link harvesting (code, no model)                                    */
/* ------------------------------------------------------------------ */

const YEAR = /20(1\d|2\d)/g;

/** decodeURIComponent that returns the input when it isn't valid percent-encoding. */
export function safeDecode(u: string): string {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
}

/** The newest four-digit year a link names (URL or text), or 0. */
export function newestYear(l: FoundLink): number {
  const ys = [...`${safeDecode(l.url)} ${l.text}`.matchAll(YEAR)].map((m) => Number(m[0]));
  return ys.length ? Math.max(...ys) : 0;
}

/** Words that name a fraternity & sorority report (size, community, grade, scorecard), in a link's URL or text. */
export const FSL_REPORT =
  /(chapter[\s_-]*(size|data|statistic|report)|size[\s_-]*report|community[\s_-]*(report|data|statistic)|membership[\s_-]*(statistic|report|data|numbers)|roster|statistic|stats\b|demograph|by[\s_-]*the[\s_-]*numbers|fast[\s_-]*facts|facts[\s_-]*(and|&)[\s_-]*figures|scorecard|score[\s_-]*card|report[\s_-]*card|annual[\s_-]*report|grade[\s_-]*(report|ranking)|academic[\s_-]*(report|performance|ranking)|gpa|(chapter|community|council|membership|academic|grade|size)[\w\s%-]{0,40}(reports?|rankings?|statistics?|scorecards?)\b)/i;
/** A page in the office's own section that names a part of the community (councils, chapters, joining, its reports). */
const FSL_PAGE = /(councils?|chapters?|recruit|join|intake|prospective|our[\s_-]*community|meet[\s_-]*the[\s_-]*community|reports?|data|panhellenic|interfraternity|\bifc\b|\bnphc\b|\bmgc\b|\bupc\b|\bcpc\b|multicultural[\s_-]*greek|pan[\s_-]*hellenic)/i;
/** Words that put a page in the fraternity & sorority community even outside the office's own path. */
const FSL_WORDS = /fraternit|sororit|greek|panhellenic|interfraternity|\bfsl\b|\bsfl\b|\bofsl\b|\bosfl\b/i;
/** News, stories, events, people, sign-in, and award pages: never followed as a report or council page. */
const FSL_NOISE = /\/(news|stories|story|events?|calendar|blog|posts?|press|people|profiles?|staff|tag|category|author|secure|admin)\/|\/20\d\d\/\d\d\/|log-?in|sign-?in|recognized|award|spotlight|-stories\b/i;
/** Viewers that show a file through a script (Issuu, Flipsnack, Google Drive): not a file we can read. */
const VIEWER = /(issuu\.com|flipsnack\.com|drive\.google\.com|docs\.google\.com|canva\.com|yumpu\.com)/i;
/** Pages in the office's section worth reading for report links (reports and data first, then about, councils, resources). */
const FSL_HUB = /reports?|data|statistic|resources|about|families|parents|community|councils?|chapters?|hub|scholarship|academics?/i;

const isFile = (u: string) => /\.pdf($|[?#])/i.test(u);
/** The registrable domain of a host, roughly ("blogs.uoregon.edu" → "uoregon.edu"). */
const siteOf = (host: string) => host.split(".").slice(-2).join(".");

/** The office's own section: the path of its page without the last segment when that segment is a file ("/fsl/index.html" → "/fsl/"). */
function sectionOf(url: string): string {
  const p = new URL(url).pathname;
  const dir = /\.[a-z]{2,5}$/i.test(p) ? p.slice(0, p.lastIndexOf("/") + 1) : p.endsWith("/") ? p : `${p}/`;
  return dir.toLowerCase();
}

/**
 * Inside the office's section: same host and under the office page's path, or anywhere on a host of its own
 * ("sfl.osu.edu"), or a page of the college's (any host on its domain, like Oregon's FSL blog) whose address or link
 * text says it's about fraternities and sororities.
 */
function inOfficeSection(page: Page, l: FoundLink): boolean {
  try {
    const u = new URL(l.url);
    const base = new URL(page.final_url);
    const says = FSL_WORDS.test(`${u.host.replace(/\./g, " ")} ${safeDecode(u.pathname)} ${l.text}`);
    if (u.host === base.host) return u.pathname.toLowerCase().startsWith(sectionOf(page.final_url)) || FSL_WORDS.test(base.host.replace(/\./g, " ")) || says;
    return siteOf(u.host) === siteOf(base.host) && says;
  } catch {
    return false;
  }
}

/** `reportList`: the page is itself a page of reports, so every PDF it links to is one of them. */
function fslScore(page: Page, l: FoundLink, reportList: boolean): number {
  if (l.url === page.final_url || l.url === page.url || VIEWER.test(l.url)) return 0;
  const hay = `${safeDecode(l.url)} ${l.text}`;
  // A news story or an awards page isn't a report, unless its own words say it is one ("2025 awards and grade report").
  const file = isFile(l.url);
  // (A file's dated folder, "/wp-content/uploads/2026/07/", is where uploads live, not a news story's date.)
  if (FSL_NOISE.test(file ? l.url.replace(/\/20\d\d\/\d\d\//, "/") : l.url) && !FSL_REPORT.test(hay)) return 0;
  let s = 0;
  // Report files may live on a CDN host (wpmucdn, an AWS bucket); only links the office's own pages give are taken.
  if (FSL_REPORT.test(hay)) s += /size|membership|roster|community|statistic|stats|numbers|facts|scorecard|score[\s_-]*card/i.test(hay) ? 6 : /grade|gpa|academic/i.test(hay) ? 3 : 4;
  else if (file && reportList) s += 4;
  if (file && s) s += 1;
  if (!file && inOfficeSection(page, l) && FSL_PAGE.test(hay)) s += 2;
  if (s && !file && !inOfficeSection(page, l)) s = 0;
  const y = newestYear(l);
  if (s && y) s += Math.max(0, 3 - (new Date().getFullYear() - y));
  return s;
}

const unique = (links: FoundLink[]): FoundLink[] => {
  const seen = new Set<string>();
  return links.filter((l) => {
    const k = l.url.replace(/#.*$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Report files and pages to read from a fraternity & sorority life office page (round 3): size, community, and grade
 * reports and scorecards (newest first, size before grade; files on any host the office links to, each robots-checked
 * on its own host when fetched), then council, chapter, and joining pages in the office's own section. News, stories,
 * sign-in pages, script viewers, and pages elsewhere on the site (an "about the university" page, recreation
 * memberships) are never taken. `reportList`: the page is a page of reports (every PDF on it counts). At most `max`.
 */
export function fslLinks(page: Page, max = 10, reportList = false): FoundLink[] {
  const scored = page.links.map((l) => ({ l, s: fslScore(page, l, reportList), y: newestYear(l) })).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || b.y - a.y);
  return unique(scored.map((x) => x.l)).slice(0, max);
}

/** Only the report links among `fslLinks` (files and pages whose URL or text names a report; any file on a page of reports), newest first. */
export function fslReportLinks(page: Page, max = 6, reportList = false): FoundLink[] {
  return fslLinks(page, 40, reportList)
    .filter((l) => FSL_REPORT.test(`${safeDecode(l.url)} ${l.text}`) || (reportList && isFile(l.url)))
    .slice(0, max);
}

/** Pages in the office's section that may link to its reports (a reports or data page first, then about, councils, resources). */
export function fslHubLinks(page: Page, max = 4): FoundLink[] {
  const hubs = unique(page.links).filter((l) => {
    if (l.url === page.final_url || isFile(l.url) || VIEWER.test(l.url) || FSL_NOISE.test(l.url)) return false;
    const hay = `${safeDecode(l.url)} ${l.text}`;
    return inOfficeSection(page, l) && (FSL_HUB.test(hay) || FSL_REPORT.test(hay) || new URL(l.url).host !== new URL(page.final_url).host);
  });
  const rank = (l: FoundLink) => (FSL_REPORT.test(`${safeDecode(l.url)} ${l.text}`) ? 2 : /reports?|data|statistic|academic|resources/i.test(`${safeDecode(l.url)} ${l.text}`) ? 1 : 0);
  return hubs.sort((a, b) => rank(b) - rank(a)).slice(0, max);
}

const FAITH_PAGE = /(student[\s_-]*(groups|organizations)|faith[\s_-]*(groups|communities|organizations)|religious[\s_-]*(groups|life|organizations)|ministr|chaplain|interfaith|communities|spiritual)/i;
const LGBTQ_PAGE = /(student[\s_-]*(groups|organizations)|groups|organizations|resources|queer|lgbt|pride|gender|trans)/i;

/** Same-host pages from an office page that likely list its groups (faith communities or LGBTQ+ groups). */
export function groupPageLinks(page: Page, domain: "faith" | "lgbtq", max = 3): FoundLink[] {
  const host = new URL(page.final_url).host;
  const re = domain === "faith" ? FAITH_PAGE : LGBTQ_PAGE;
  return page.links
    .filter((l) => l.url !== page.final_url && !/\.(pdf|jpg|png|docx?)($|\?)/i.test(l.url))
    .filter((l) => {
      try {
        return new URL(l.url).host === host && re.test(`${decodeURIComponent(new URL(l.url).pathname)} ${l.text}`);
      } catch {
        return false;
      }
    })
    .slice(0, max);
}

/* ------------------------------------------------------------------ */
/* What the extractor reads                                            */
/* ------------------------------------------------------------------ */

/** Keyword windows (±`radius` characters around each hit, merged) when a page is longer than `max`. */
export function keywordWindows(text: string, re: RegExp, max: number, radius = 700): string {
  if (text.length <= max) return text;
  const spans: [number, number][] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    const s = Math.max(0, m.index! - radius);
    const e = Math.min(text.length, m.index! + m[0].length + radius);
    const last = spans.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else spans.push([s, e]);
  }
  if (!spans.length) return text.slice(0, max);
  let out = "";
  for (const [s, e] of spans) {
    const piece = text.slice(s, e);
    if (out.length + piece.length + 5 > max) {
      out += `\n[…]\n${piece.slice(0, Math.max(0, max - out.length - 5))}`;
      break;
    }
    out += (out ? "\n[…]\n" : "") + piece;
  }
  return out;
}

/** Whitespace, case, quotes, and dashes folded, for checking a model's quote against the page. */
export function foldText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[^a-z0-9%$.,;:'"!?()\-/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether `quote` is the page's own words: each part (split on "…" / "...") appears in the page text after folding
 * (and again with punctuation dropped, since PDF text and HTML tables space punctuation differently).
 */
export function quoteOnPage(quote: string, pageText: string): boolean {
  const parts = quote
    .split(/\.\.\.|…|\[…\]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  if (!parts.length) return false;
  const hay = foldText(pageText);
  const bare = (s: string) => s.replace(/[^a-z0-9%$ ]+/g, " ").replace(/\s+/g, " ").trim();
  const hayBare = bare(hay);
  return parts.every((p) => {
    const f = foldText(p);
    return hay.includes(f) || hayBare.includes(bare(f));
  });
}

/** A quote cut to `max` characters at a word boundary (stored quotes are short; lib/directories.ts MAX_QUOTE). */
export function shortQuote(q: string, max = 160, focus?: RegExp): string {
  const s = q.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  // Keep the words that state the fact (a long nondiscrimination list's "sexual orientation") when they'd be cut off:
  // "…" marks the cut, and quoteOnPage reads each side of it separately.
  const at = focus ? s.search(focus) : -1;
  if (at > max - 40) {
    const start = Math.max(0, s.lastIndexOf(" ", Math.max(0, at - (max - 50))) + 1);
    if (start + max - 1 >= s.length) return `…${s.slice(start)}`;
    const piece = s.slice(start, start + max - 2);
    return `…${piece.slice(0, Math.max(piece.lastIndexOf(" "), max - 40)).trim()}…`;
  }
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).trim()}…`;
}

/**
 * A PoliteHttp log hook that records hosts that didn't answer (its "<host> didn't respond" and "<host> returned a
 * server error for robots.txt" lines) into `hosts`, then passes every line on to `log`.
 */
export function httpLogHook(hosts: Set<string>, log: (m: string) => void = () => {}): (m: string) => void {
  return (m) => {
    const dead = /^\s*(\S+) didn't respond/.exec(m) ?? /^\s*(\S+) returned a server error for robots\.txt/.exec(m);
    if (dead) hosts.add(dead[1]);
    log(m);
  };
}
