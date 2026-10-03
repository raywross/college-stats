/**
 * Polite HTTP for the college-reported pipeline: our code (not the model) fetches every recipe URL.
 * - Honors robots.txt (RFC 9309): disallowed URLs are skipped and logged, never fetched another way.
 * - At least `minDelayMs` (1 s) between requests to one host, longer when robots.txt sets a Crawl-delay.
 * - Conditional GET (If-None-Match / If-Modified-Since); a 304 means the copy we processed is current.
 * - Identifies itself honestly and never retries with a different user agent to get past bot protection.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
}

/** Parses robots.txt, keeping the group for our user agent if there is one, else the `*` group. */
export function parseRobots(text: string): RobotsRules {
  type Group = { agents: string[]; rules: RobotsRules["rules"]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
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
  return { rules: chosen.flatMap((g) => g.rules), crawlDelayMs: chosen.find((g) => g.delay !== null)?.delay ?? null };
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
/* Per-host pacing                                                     */
/* ------------------------------------------------------------------ */

export interface HttpDeps {
  fetch: FetchFn;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Minimum gap between two requests to one host (default 1,000 ms). */
  minDelayMs: number;
  log: (msg: string) => void;
}

/** Fetches with robots.txt and per-host pacing. One instance per run, shared by every college. */
export class PoliteHttp {
  private deps: HttpDeps;
  private robots = new Map<string, Promise<RobotsRules>>();
  /** Per host: the tail of its request queue and when the last request started. */
  private queues = new Map<string, { tail: Promise<void>; last: number }>();

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
          const res = await this.deps.fetch(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
          if (res.ok) return parseRobots(await res.text());
          if (res.status >= 500) return { rules: [], crawlDelayMs: null, disallowAll: true };
          return { rules: [], crawlDelayMs: null };
        } catch {
          return { rules: [], crawlDelayMs: null, disallowAll: true };
        }
      });
      this.robots.set(origin, p);
    }
    return p;
  }

  /**
   * GET `url` politely. Returns null (and logs) when robots.txt disallows it; otherwise the response, which may be a
   * 304 when `conditional` headers matched.
   */
  async get(url: string, conditional: { etag?: string; last_modified?: string } = {}): Promise<Response | null> {
    const u = new URL(url);
    const robots = await this.robotsFor(u.origin);
    if (!robotsAllows(robots, url)) {
      this.deps.log(`  robots.txt disallows ${url}; skipped`);
      return null;
    }
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (conditional.etag) headers["If-None-Match"] = conditional.etag;
    if (conditional.last_modified) headers["If-Modified-Since"] = conditional.last_modified;
    const delay = Math.max(this.deps.minDelayMs, robots.crawlDelayMs ?? 0);
    return this.paced(u.host, delay, () => this.deps.fetch(url, { headers, redirect: "follow" }));
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
