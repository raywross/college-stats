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

  get(url: string): Promise<FetchResult> {
    let p = this.memo.get(url);
    if (!p) {
      p = this.load(url);
      this.memo.set(url, p);
    }
    return p;
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
      this.blocked.push({ url, reason: "robots" });
      return { ok: false, url, blocked: "robots" };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
    const refusal = refusalOf(url, res, head);
    if (refusal) {
      this.blocked.push({ url, reason: refusal });
      return { ok: false, url, blocked: refusal };
    }
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
    const html = new TextDecoder().decode(bytes);
    return { ok: true, page: { ...common, format: "html", text: htmlToText(html), links: findLinks(html, meta.final_url) } };
  }
}

/* ------------------------------------------------------------------ */
/* Link harvesting (code, no model)                                    */
/* ------------------------------------------------------------------ */

const YEAR = /20(1\d|2\d)/g;

/** The newest four-digit year a link names (URL or text), or 0. */
export function newestYear(l: FoundLink): number {
  const ys = [...`${decodeURIComponent(l.url)} ${l.text}`.matchAll(YEAR)].map((m) => Number(m[0]));
  return ys.length ? Math.max(...ys) : 0;
}

const FSL_REPORT = /(chapter[\s_-]*size|size[\s_-]*report|community[\s_-]*report|membership|roster|statistic|demograph|by[\s_-]*the[\s_-]*numbers|fast[\s_-]*facts|scorecard|annual[\s_-]*report|grade[\s_-]*report|academic[\s_-]*report|gpa)/i;
const FSL_PAGE = /(councils?|recruit|join|prospective|housing|chapters|our[\s_-]*community|about|reports?|data|forms)/i;

/**
 * Report files and pages to read from a fraternity & sorority life office page: size, community, and grade reports
 * (newest first, size before grade), then council, recruitment, and housing pages on the same host. At most `max`.
 */
export function fslLinks(page: Page, max = 10): FoundLink[] {
  const host = new URL(page.final_url).host;
  const scored = page.links
    .filter((l) => l.url !== page.final_url && l.url !== page.url)
    .map((l) => {
      const hay = `${decodeURIComponent(l.url)} ${l.text}`;
      const isFile = /\.pdf($|\?)/i.test(l.url);
      let s = 0;
      if (FSL_REPORT.test(hay)) s += /size|membership|roster|community/i.test(hay) ? 6 : /grade|gpa|academic/i.test(hay) ? 3 : 4;
      if (isFile && s) s += 1;
      if (!isFile && new URL(l.url).host === host && FSL_PAGE.test(hay)) s += 2;
      const y = newestYear(l);
      if (s && y) s += Math.max(0, 3 - (new Date().getFullYear() - y));
      return { l, s, y };
    })
    .filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || b.y - a.y);
  return scored.slice(0, max).map((x) => x.l);
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
export function shortQuote(q: string, max = 160): string {
  const s = q.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
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
