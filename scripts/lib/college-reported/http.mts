/**
 * Polite HTTP for the college-reported pipeline: our code (not the model) fetches every recipe URL.
 * - Honors robots.txt (RFC 9309): disallowed URLs are skipped and logged, never fetched another way.
 * - At least `minDelayMs` (1 s) between requests to one host, longer when robots.txt sets a Crawl-delay.
 * - Conditional GET (If-None-Match / If-Modified-Since); a 304 means the copy we processed is current.
 * - Identifies itself honestly and never retries with a different user agent to get past bot protection.
 * - Every request (headers and body together) ends within REQUEST_TIMEOUT_MS (60 s), and a body over
 *   MAX_DOCUMENT_BYTES (50 MB) is aborted: both throw an `HttpLimitError`, which callers record like any network error
 *   (specs/college-reported-round-3.md "Fixed in this round", http.mts:155). Bodies are buffered, so a returned
 *   Response's `arrayBuffer()` never hangs.
 * - Answers that refuse us (401, 403, 405, 429, a bot-protection challenge) are kept in `blockedSeen()` for
 *   data/reference/blocked-hosts.json (Decision 8; ./blocked.mts).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blockedStatusOf, type BlockedObservation } from "./blocked.mts";

export const USER_AGENT = "QuadCollegeData/1.0 (college admissions figures; +https://college-stats-nine.vercel.app/data)";
/** The product token robots.txt groups are matched against. */
const UA_TOKEN = "quadcollegedata";

export type FetchFn = typeof globalThis.fetch;

/* ------------------------------------------------------------------ */
/* robots.txt                                                          */
/* ------------------------------------------------------------------ */

export interface RobotsRules {
  rules: { allow: boolean; path: string }[];
  crawlDelayMs: number | null;
  /** Unreachable robots.txt (5xx or network error): everything is disallowed, per RFC 9309. */
  disallowAll?: boolean;
  /** Why everything is disallowed when it is: the server answered 5xx, or the host didn't answer at all (no DNS, refused). */
  unreachable?: "server-error" | "no-response";
  /** `Sitemap:` lines (absolute URLs; they belong to no group and apply to every user agent). */
  sitemaps?: string[];
}

/** Parses robots.txt, keeping the group for our user agent if there is one, else the `*` group. */
export function parseRobots(text: string): RobotsRules {
  type Group = { agents: string[]; rules: RobotsRules["rules"]; delay: number | null };
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "sitemap") {
      if (/^https?:\/\//i.test(value) && !sitemaps.includes(value)) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [], delay: null }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (value) cur.rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay") {
      const s = Number(value);
      if (Number.isFinite(s) && s > 0) cur.delay = s * 1000;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && UA_TOKEN.startsWith(a.split("/")[0])));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return { rules: chosen.flatMap((g) => g.rules), crawlDelayMs: chosen.find((g) => g.delay !== null)?.delay ?? null, sitemaps };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** Longest matching rule wins; Allow wins a tie; no match allows. */
export function robotsAllows(robots: RobotsRules, url: string): boolean {
  if (robots.disallowAll) return false;
  const u = new URL(url);
  const path = u.pathname + u.search;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of robots.rules) {
    if (!patternMatches(r.path, path)) continue;
    if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) best = { allow: r.allow, len: r.path.length };
  }
  return best?.allow ?? true;
}

/* ------------------------------------------------------------------ */
/* Limits: timeout and size cap                                        */
/* ------------------------------------------------------------------ */

/** One hanging host must not stall a worker until the job ends. */
export const REQUEST_TIMEOUT_MS = 60_000;
/** No CDS comes near this; a bigger body is a mistake or a trap. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** A request that hit the timeout or the size cap: aborted, and recorded by the caller like a network error. */
export class HttpLimitError extends Error {
  readonly limit: "timeout" | "size";
  readonly url: string;
  constructor(limit: "timeout" | "size", url: string, message: string) {
    super(message);
    this.name = "HttpLimitError";
    this.limit = limit;
    this.url = url;
  }
}

/** Reads a body up to `max` bytes; past it (or a Content-Length over it) the stream is cancelled and an `HttpLimitError` thrown. */
export async function readCapped(res: Response, url: string, max = MAX_DOCUMENT_BYTES): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new HttpLimitError("size", url, `${url}: ${declared} bytes is over the ${max}-byte cap; not read`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new HttpLimitError("size", url, `${url}: body passed the ${max}-byte cap; aborted`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Statuses whose Response may not carry a body. */
const NULL_BODY = new Set([101, 204, 205, 304]);

/* ------------------------------------------------------------------ */
/* Per-host pacing                                                     */
/* ------------------------------------------------------------------ */

export interface HttpDeps {
  fetch: FetchFn;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Minimum gap between two requests to one host (default 1,000 ms). */
  minDelayMs: number;
  log: (msg: string) => void;
  /** Per-request deadline, headers and body together (default REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Largest body read (default MAX_DOCUMENT_BYTES). */
  maxBytes?: number;
}

/** Fetches with robots.txt and per-host pacing. One instance per run, shared by every college. */
export class PoliteHttp {
  private deps: HttpDeps;
  private robots = new Map<string, Promise<RobotsRules>>();
  /** Hosts already logged as not responding, so a probe of many paths logs each once. */
  private unreachableLogged = new Set<string>();
  /** Per host: the tail of its request queue and when the last request started. */
  private queues = new Map<string, { tail: Promise<void>; last: number }>();
  /** Every refusal this run, in order (Decision 8). */
  private blocked: BlockedObservation[] = [];

  constructor(deps: HttpDeps) {
    this.deps = deps;
  }

  /** Runs `fn` when the host's turn comes: requests to one host go one at a time, spaced by the crawl delay. */
  private async paced<T>(host: string, delayMs: number, fn: () => Promise<T>): Promise<T> {
    const q = this.queues.get(host) ?? { tail: Promise.resolve(), last: -Infinity };
    this.queues.set(host, q);
    const run = q.tail.then(async () => {
      const wait = q.last + delayMs - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
      q.last = this.deps.now();
      return fn();
    });
    q.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private robotsFor(origin: string): Promise<RobotsRules> {
    let p = this.robots.get(origin);
    if (!p) {
      const host = new URL(origin).host;
      p = this.paced(host, this.deps.minDelayMs, async () => {
        try {
          const { res } = await this.limited(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
          if (res.ok) return parseRobots(await res.text());
          if (res.status >= 500) return { rules: [], crawlDelayMs: null, disallowAll: true, unreachable: "server-error" as const };
          return { rules: [], crawlDelayMs: null };
        } catch {
          return { rules: [], crawlDelayMs: null, disallowAll: true, unreachable: "no-response" as const };
        }
      });
      this.robots.set(origin, p);
    }
    return p;
  }

  /**
   * GET `url` politely. Returns null (and logs) when robots.txt disallows it; otherwise the response, which may be a
   * 304 when `conditional` headers matched. Throws on a network error, the timeout, or the size cap.
   */
  async get(url: string, conditional: { etag?: string; last_modified?: string } = {}): Promise<Response | null> {
    const u = new URL(url);
    const robots = await this.robotsFor(u.origin);
    if (!robotsAllows(robots, url)) {
      // A probed host that doesn't exist (most IR-host guesses) is not a robots.txt refusal: say which it was, once per host.
      if (robots.unreachable === "no-response") {
        if (!this.unreachableLogged.has(u.host)) this.deps.log(`  ${u.host} didn't respond; skipped`);
        this.unreachableLogged.add(u.host);
      } else if (robots.unreachable === "server-error") this.deps.log(`  ${u.host} returned a server error for robots.txt; ${url} skipped`);
      else this.deps.log(`  robots.txt disallows ${url}; skipped`);
      return null;
    }
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (conditional.etag) headers["If-None-Match"] = conditional.etag;
    if (conditional.last_modified) headers["If-Modified-Since"] = conditional.last_modified;
    const delay = Math.max(this.deps.minDelayMs, robots.crawlDelayMs ?? 0);
    const { res, head } = await this.paced(u.host, delay, () => this.limited(url, { headers, redirect: "follow" }));
    const status = blockedStatusOf(res.status, res.headers, head);
    if (status !== null) this.blocked.push({ host: u.host, url, status });
    return res;
  }

  /** The `Sitemap:` URLs in the origin's robots.txt (fetched once per run and shared with every `get`). */
  async sitemaps(url: string): Promise<string[]> {
    return (await this.robotsFor(new URL(url).origin)).sitemaps ?? [];
  }

  /** Refusals seen this run, for data/reference/blocked-hosts.json (`recordBlocked` in ./blocked.mts). */
  blockedSeen(): BlockedObservation[] {
    return [...this.blocked];
  }

  /**
   * One fetch under the deadline, its body read under the size cap and buffered, so the returned Response is complete.
   * The final URL after redirects is kept on `url`; `head` is the decoded start of a text body (for challenge pages).
   */
  private async limited(url: string, init: RequestInit): Promise<{ res: Response; head: string }> {
    const ms = this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const max = this.deps.maxBytes ?? MAX_DOCUMENT_BYTES;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new HttpLimitError("timeout", url, `${url}: no complete answer in ${ms / 1000} s; aborted`));
      }, ms);
    });
    const work = (async () => {
      const raw = await this.deps.fetch(url, { ...init, signal: ctl.signal });
      const bytes = await readCapped(raw, url, max);
      const empty = NULL_BODY.has(raw.status);
      const res = new Response(empty ? null : (bytes as BodyInit), { status: raw.status, statusText: raw.statusText, headers: raw.headers });
      Object.defineProperty(res, "url", { value: raw.url || url });
      const ct = (raw.headers.get("content-type") ?? "").toLowerCase();
      const head = empty || (ct && !/html|text|xml/.test(ct)) ? "" : new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
      return { res, head };
    })();
    work.catch(() => {}); // a late failure after the deadline won must not surface as an unhandled rejection
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Content hashing and the download cache                              */
/* ------------------------------------------------------------------ */

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Saves a download under `.cache/college-docs/<sha256>` (git-ignored) and returns the path. */
export function cacheDocument(cacheDir: string, hash: string, bytes: Uint8Array): string {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, hash);
  if (!existsSync(file)) writeFileSync(file, bytes);
  return file;
}

/** Bot-protection answers we stop at (never work around): challenges, forbidden, rate limited. */
export function isBlocked(res: Response): boolean {
  return res.status === 401 || res.status === 403 || res.status === 429 || (res.status === 503 && !!res.headers.get("cf-mitigated"));
}
