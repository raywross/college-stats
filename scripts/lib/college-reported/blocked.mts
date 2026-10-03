/**
 * Blocked hosts (specs/college-reported-round-3.md Decision 8): hosts that refuse our honest user agent, kept in
 * data/reference/blocked-hosts.json so no paid discovery step is spent on a college whose only candidates are there.
 * Blocking is per host, never per college: Columbia's `opir.` host serves its CDS while its admissions host returns 403.
 * The pipeline never fetches a blocked host another way and never switches user agents; the owner adds the link to
 * data/reference/cds-urls.json and drops the file with `npm run archive-doc`.
 *
 * Pure: no I/O. `PoliteHttp` (./http.mts) collects observations; the CLI writes the file.
 */
import type { BlockedHost, BlockedHostsFile, BlockedStatus, Recipe } from "../../../lib/reported.ts";

/** One refusal seen during a run. */
export interface BlockedObservation {
  host: string;
  url: string;
  status: BlockedStatus;
  /** The college whose candidate this was, when the caller knows it. */
  unit_id?: string;
}

/**
 * Bot-protection pages: Cloudflare's "Just a moment…" interstitial and its challenge scripts, Cloudflare's "Attention
 * Required!" block page, Incapsula, PerimeterX, DataDome, and Akamai's "Access Denied … Reference #".
 */
const CHALLENGE =
  /<title>\s*just a moment\.{0,3}\s*<\/title>|\/cdn-cgi\/challenge-platform\/|cf-chl-|attention required! \| cloudflare|_incapsula_resource|px-captcha|captcha-delivery\.com|<title>\s*access denied\s*<\/title>[\s\S]{0,2000}reference\s*#/i;

/**
 * How an answer refuses us, or null. `head` is the decoded start of the body (challenges are detected from it, whatever
 * the status). 404-to-tools (Texas A&M: 404 to a tool, 200 to a browser) can't be told from one honest request, so it is
 * only ever entered by the owner.
 */
export function blockedStatusOf(status: number, headers: Headers, head = ""): BlockedStatus | null {
  if (head && CHALLENGE.test(head)) return "challenge";
  if (status === 503 && headers.get("cf-mitigated")) return "challenge";
  if (status === 401 || status === 403 || status === 405 || status === 429) return status;
  return null;
}

/** After this long without being seen again, a host is tried again (sites change their protection). */
export const BLOCK_STALE_DAYS = 365;

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/**
 * The file with this run's observations merged in: a new host gets first and last seen today; a known one gets its
 * latest status and last seen today; unit ids are unioned. Sorted by host so the diff is stable.
 */
export function recordBlocked(file: BlockedHostsFile, observations: BlockedObservation[], today: string): BlockedHostsFile {
  const byHost = new Map<string, BlockedHost>(file.hosts.map((h) => [h.host, { ...h, ...(h.unit_ids ? { unit_ids: [...h.unit_ids] } : {}) }]));
  for (const o of observations) {
    const prev = byHost.get(o.host);
    const ids = new Set([...(prev?.unit_ids ?? []), ...(o.unit_id ? [o.unit_id] : [])]);
    byHost.set(o.host, {
      host: o.host,
      status: o.status,
      first_seen: prev?.first_seen ?? today,
      last_seen: today,
      ...(ids.size ? { unit_ids: [...ids].sort() } : {}),
    });
  }
  return { hosts: [...byHost.values()].sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0)) };
}

/** Whether `host` is listed and was seen refusing us within BLOCK_STALE_DAYS. */
export function isBlockedHost(file: BlockedHostsFile, host: string, today: string): boolean {
  const h = file.hosts.find((x) => x.host === host);
  return !!h && daysBetween(h.last_seen, today) <= BLOCK_STALE_DAYS;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/** What the ladder knows about where a college's documents could be. */
export interface CollegeCandidates {
  recipe?: Recipe;
  /** Hosts that answered steps 0–1 with a page (2xx) or a refusal; a host that only 404s or doesn't resolve isn't one. */
  answered?: string[];
}

/**
 * The blocked hosts when every candidate host of the college is blocked (its recipe's documents and index pages, and
 * every host that answered the free steps), else null. A college with no candidates at all is not "blocked": nothing
 * refused us. Such a college is listed for the owner and no paid discovery step runs (Decision 8).
 */
export function onlyBlockedCandidates(college: CollegeCandidates, blocked: BlockedHostsFile, today: string): string[] | null {
  const urls = [...(college.recipe?.sources.map((s) => s.url) ?? []), ...(college.recipe?.index_urls ?? [])];
  const hosts = new Set([...urls.map(hostOf).filter((h): h is string => !!h), ...(college.answered ?? [])]);
  if (!hosts.size) return null;
  for (const h of hosts) if (!isBlockedHost(blocked, h, today)) return null;
  return [...hosts].sort();
}
