/**
 * The polite crawl context every adapter gets (specs/campus-directories.md). Built on the college-reported pipeline's
 * PoliteHttp (robots.txt, Crawl-delay, per-host pacing, timeouts, size cap), with this crawler's own identity, a floor
 * of 2 s between requests to a host, an on-disk cache, and refusal detection that throws `Blocked`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PoliteHttp, type FetchFn } from "../college-reported/http.mts";
import { blockedStatusOf } from "../college-reported/blocked.mts";
import { Blocked, HttpError, type CrawlContext, type FetchOptions } from "./contract.mts";

export const DIRECTORY_USER_AGENT = "college-stats-research/0.1 (+https://college-stats-nine.vercel.app/data)";
const UA_TOKEN = "college-stats-research";
/** Floor between two requests to one host; robots.txt's Crawl-delay raises it. */
export const MIN_HOST_DELAY_MS = 2_000;
export const DEFAULT_MAX_AGE_DAYS = 30;

export interface ContextDeps {
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** .cache/directories (git-ignored). */
  cacheDir: string;
  /** Cached copies younger than this are reused without a request. */
  maxAgeDays?: number;
  /** Ignore the cache (still writes it). */
  refresh?: boolean;
  today: string;
  log?: (msg: string) => void;
  /** One PoliteHttp shared by every adapter in a run, so pacing holds across organizations on one host. */
  http?: PoliteHttp;
}

interface CacheEntry {
  url: string;
  final_url: string;
  fetched: number;
  status: number;
  body: string;
}

const LOGIN_PATH = /\/(log-?in|sign-?in|signon|sso|auth|account\/login|users\/sign_in|wp-login\.php)\b/i;

/** The PoliteHttp a run shares: our identity and the 2 s floor. */
export function directoryHttp(deps: Pick<ContextDeps, "fetch" | "now" | "sleep" | "log"> = {}): PoliteHttp {
  return new PoliteHttp({
    fetch: deps.fetch ?? globalThis.fetch,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    minDelayMs: MIN_HOST_DELAY_MS,
    log: deps.log ?? ((m) => console.log(m)),
    userAgent: DIRECTORY_USER_AGENT,
    uaToken: UA_TOKEN,
  });
}

/** Why an answer refuses us, or null. Exported for tests. */
export function refusalOf(requested: string, res: Response, body: string): Blocked["reason"] | null {
  const status = blockedStatusOf(res.status, res.headers, body.slice(0, 64 * 1024));
  if (status === "challenge") return "challenge";
  if (status === 401) return "unauthorized";
  if (status === 403 || status === 405) return "forbidden";
  if (status === 429) return "rate-limited";
  const final = res.url || requested;
  if (final !== requested && LOGIN_PATH.test(new URL(final).pathname) && !LOGIN_PATH.test(new URL(requested).pathname)) return "login";
  return null;
}

export function createContext(org: string, deps: ContextDeps): CrawlContext {
  const log = deps.log ?? ((m: string) => console.log(m));
  const now = deps.now ?? Date.now;
  const http = deps.http ?? directoryHttp({ ...deps, log });
  const dir = join(deps.cacheDir, org);

  const cachePath = (url: string, headers?: Record<string, string>) =>
    join(dir, `${createHash("sha256").update(`${url}\n${JSON.stringify(headers ?? {})}`).digest("hex").slice(0, 32)}.json`);

  async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
    const file = cachePath(url, options.headers);
    const maxAgeMs = (options.maxAgeDays ?? deps.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 86_400_000;
    if (!deps.refresh && existsSync(file)) {
      const hit = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
      if (now() - hit.fetched < maxAgeMs) return hit.body;
    }
    const res = await http.get(url, {}, options.headers);
    if (!res) throw new Blocked(url, "robots", "robots.txt disallows it (or the host didn't answer for robots.txt)");
    const body = res.status === 304 ? "" : await res.text();
    const refusal = refusalOf(url, res, body);
    if (refusal) throw new Blocked(url, refusal, `HTTP ${res.status}`);
    if (!res.ok) throw new HttpError(url, res.status);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ url, final_url: res.url || url, fetched: now(), status: res.status, body } satisfies CacheEntry));
    return body;
  }

  return {
    org,
    today: deps.today,
    fetchText,
    async fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
      const text = await fetchText(url, { ...options, headers: { Accept: "application/json", ...(options?.headers ?? {}) } });
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`${url}: not JSON (${text.slice(0, 80).replace(/\s+/g, " ")}…)`);
      }
    },
    log: (m) => log(`  [${org}] ${m}`),
  };
}
