/**
 * The adapter contract for national directories (specs/campus-directories.md). One adapter per organization's list,
 * one file each in ./adapters/<key>.mts with `export default defineAdapter({...})`; the registry lists the folder, so
 * adding an adapter never touches a shared file.
 *
 * An adapter only reads its list and returns raw entries. It never matches colleges, writes files, or retries past a
 * refusal: the runner (./run.mts) matches every entry to IPEDS unit ids, records `Blocked` refusals in
 * data/directories/blocked.json, and writes data/directories/<key>.json.
 */
import type { Classification, DirectoryTier } from "../../../lib/directories.ts";

/** One campus entry as the directory prints it. Free text; the matcher does the rest. */
export interface RawEntry {
  /** The campus as listed: "University of Texas, Austin", "Boston Area (Boston University, Northeastern)". */
  campus: string;
  /** When the list names several colleges for one chapter, each one (the matcher maps the entry to all of them). */
  campuses?: string[];
  city?: string;
  /** Two-letter postal code or full state name, as listed. */
  state?: string;
  /** Chapter or group name: "Rho Chapter", "OCF at UT Austin". */
  name?: string;
  /** The chapter's own page, when the list links one (also a matching signal when it's on the college's domain). */
  url?: string;
  /** As listed: "active", "colony", "provisional". */
  status?: string;
  /** A fact the list states for the campus ("2,750 Jewish undergraduates"); set `tier: "C"` for an estimate. */
  fact?: string;
  /** Short quote supporting `fact` or the listing (≤ 160 characters). Never a copy of the page. */
  quote?: string;
  /** Only to mark an entry as an organization estimate (tier C) inside a tier D list. */
  tier?: DirectoryTier;
}

export interface FetchOptions {
  /** Reuse a cached copy younger than this (default: the run's max age, 30 days). */
  maxAgeDays?: number;
  /** Extra request headers (Accept, …). The User-Agent is always ours. */
  headers?: Record<string, string>;
}

/** What `crawl` gets: polite, cached fetches, and a logger. Nothing else touches the network. */
export interface CrawlContext {
  /** The adapter's key. */
  readonly org: string;
  /** ISO date of this run. */
  readonly today: string;
  /**
   * GET a page as text: robots.txt obeyed (a disallowed URL throws `Blocked` with reason "robots"), ≥ 2 s between
   * requests to a host (longer when Crawl-delay says so), cached under .cache/directories/. A bot challenge,
   * 401/403/429, or a redirect to a login page throws `Blocked`; any other non-2xx throws `HttpError`.
   */
  fetchText(url: string, options?: FetchOptions): Promise<string>;
  /** `fetchText` parsed as JSON. */
  fetchJson<T = unknown>(url: string, options?: FetchOptions): Promise<T>;
  log(message: string): void;
}

/** Everything an adapter declares about its list: who publishes it, where, its tier, and what its entries are. */
export type DirectoryAdapter = {
  /** File name without .mts: lowercase letters, digits, hyphens ("ocf", "gamma-rho-lambda"). */
  key: string;
  /** "Orthodox Christian Fellowship" */
  organization: string;
  /** Who publishes the list (often the organization itself). */
  publisher: string;
  /** The list page a reader can open (https); shown in every listing's credit. */
  listUrl: string;
  /** B: a college's own directory; C: an organization's per-campus estimates; D: a national list of its chapters. */
  tier: DirectoryTier;
  /** Reads the list. Return every entry, including ones that may not be colleges: the matcher decides. */
  crawl(ctx: CrawlContext): Promise<RawEntry[]>;
} & Classification;

/** A site refused us or its robots.txt disallows the page. Recorded in data/directories/blocked.json, never bypassed. */
export class Blocked extends Error {
  readonly url: string;
  readonly reason: "robots" | "challenge" | "login" | "forbidden" | "rate-limited" | "unauthorized" | "terms";
  constructor(url: string, reason: Blocked["reason"], detail = "") {
    super(`${url}: blocked (${reason})${detail ? `: ${detail}` : ""}`);
    this.name = "Blocked";
    this.url = url;
    this.reason = reason;
  }
}

/** A non-2xx answer that isn't a refusal (404, 500, …): the org's run fails; its previous data file is kept. */
export class HttpError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`${url}: HTTP ${status}`);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
  }
}

/** Identity function that type-checks an adapter (use as `export default defineAdapter({...})`). */
export function defineAdapter(adapter: DirectoryAdapter): DirectoryAdapter {
  return adapter;
}
