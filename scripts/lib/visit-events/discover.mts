/**
 * Finding a college's Slate host (specs/product/visit-events.md, "Discovery"): fetch the college's visit page (then
 * its apply link), collect the `https://<host>/portal/…` and `/register/…` links on it, and confirm a host by fetching
 * `/register/?cmd=search&country=US` and finding Slate's standard "Event Registration" page. A visit link that is
 * itself a Slate page needs no hop. The host's portal parts are each `/portal/<page>` on that host the visit page links
 * to, fetched, with the event widgets (`data-service`) each embeds. Every request goes through `PoliteHttp`
 * (robots.txt, a second between requests to a host, the project's user agent); nothing is ever submitted.
 */
import { decodeEntities } from "../college-reported/documents.mts";
import { collegeDomain } from "../college-reported/probe.mts";
import { isSlateEventRegistration, searchUrl } from "./slate-search.mts";
import { findWidgetServices } from "./slate-widget.mts";

/** The slice of `PoliteHttp` the reader uses (tests pass a fake). */
export interface ReaderHttp {
  get(url: string): Promise<Response | null>;
}

export interface PortalPart {
  page: string;
  service: string;
}

export interface Discovered {
  host: string;
  /** The page the host was found on: the visit page, its final URL after redirects, or the apply link. */
  foundOn: string;
  portalParts: PortalPart[];
}

export interface DiscoverOptions {
  /** Hosts never fetched (data/reference/blocked-hosts.json). */
  isBlocked?: (host: string) => boolean;
  log?: (msg: string) => void;
  /** Candidate hosts confirmed per page at most (default 4). */
  maxCandidates?: number;
  /** Portal pages fetched for widgets at most (default 8). */
  maxPortalPages?: number;
}

const SLATE_PATH = /^\/(portal|register)(\/|$)/i;
/**
 * Paths a Slate host also serves (the applicant status page, the application, the account login), weaker evidence:
 * UNC's visit page links its Slate host only as `mycarolina.unc.edu/status`. A link of this kind counts a tenth of a
 * `/portal/` or `/register/` link when ranking, and every candidate is still confirmed by the standard search.
 */
const SLATE_HINT_PATH = /^\/(status|apply|account|manage)(\/|$)/i;

/**
 * Absolute links to Slate-style pages on a page (`/portal/…`, `/register/…`, and the weaker `/status`, `/apply/…`,
 * `/account/…` on another host), the page's own URL resolving relative ones.
 */
export function slateLinks(html: string, pageUrl: string): URL[] {
  const pageHost = new URL(pageUrl).host;
  const out: URL[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(decodeEntities(m[1]).trim(), pageUrl);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (/\.(css|js|png|jpe?g|gif|svg|ico)$/i.test(u.pathname)) continue;
    // A hint path on the page's own host is the college's own site (its /apply page), not a Slate host.
    if (!SLATE_PATH.test(u.pathname) && !(SLATE_HINT_PATH.test(u.pathname) && u.host !== pageHost)) continue;
    out.push(u);
  }
  return out;
}

/**
 * Candidate hosts from the links, best first: hosts on the college's own domain before others (Duke's visit page also
 * links Duke Kunshan's Slate), then by how many links point there (a `/status`-style link counting a tenth).
 */
export function rankHosts(links: readonly URL[], collegeHosts: readonly string[]): string[] {
  const domains = new Set(collegeHosts.map((h) => collegeDomain(h)));
  const count = new Map<string, number>();
  for (const u of links) count.set(u.host.toLowerCase(), (count.get(u.host.toLowerCase()) ?? 0) + (SLATE_PATH.test(u.pathname) ? 1 : 0.1));
  return [...count.entries()]
    .sort((a, b) => {
      const ownA = domains.has(collegeDomain(a[0])) ? 0 : 1;
      const ownB = domains.has(collegeDomain(b[0])) ? 0 : 1;
      return ownA - ownB || b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([h]) => h);
}

/** The `/portal/<page>` paths on `host` among the links, once each, never the widget endpoints themselves. */
export function portalPages(links: readonly URL[], host: string): string[] {
  const out: string[] = [];
  for (const u of links) {
    if (u.host.toLowerCase() !== host || !/^\/portal\/[^/]+/i.test(u.pathname) || /^\/portal\/widget\b/i.test(u.pathname)) continue;
    const page = u.pathname.replace(/\/+$/, "");
    if (!out.includes(page)) out.push(page);
  }
  return out;
}

async function text(http: ReaderHttp, url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await http.get(url);
    if (!res || !res.ok) return null;
    return { html: await res.text(), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Whether a host answers the standard search with Slate's Event Registration page. */
export async function confirmSlateHost(host: string, http: ReaderHttp): Promise<boolean> {
  const page = await text(http, searchUrl(host));
  return !!page && isSlateEventRegistration(page.html);
}

/** Each portal page fetched, with the event widgets it embeds. */
export async function readPortalParts(host: string, pages: readonly string[], http: ReaderHttp, max = 8): Promise<PortalPart[]> {
  const parts: PortalPart[] = [];
  for (const page of pages.slice(0, max)) {
    const got = await text(http, `https://${host}${page}`);
    if (!got) continue;
    for (const service of findWidgetServices(got.html)) {
      if (!parts.some((p) => p.service === service)) parts.push({ page, service });
    }
  }
  return parts;
}

/**
 * The college's Slate host, the page it was found on, and its portal parts; null when neither the visit page nor the
 * apply link leads to one in one hop.
 */
export async function discoverSlateHost(
  unitId: string,
  visitUrl: string | null,
  applyUrl: string | null,
  http: ReaderHttp,
  opts: DiscoverOptions = {},
): Promise<Discovered | null> {
  const log = opts.log ?? (() => {});
  const blocked = opts.isBlocked ?? (() => false);
  const maxCandidates = opts.maxCandidates ?? 4;
  const tried = new Set<string>();
  for (const start of [visitUrl, applyUrl]) {
    if (!start) continue;
    let startUrl: URL;
    try {
      startUrl = new URL(start);
    } catch {
      continue;
    }
    if (blocked(startUrl.host)) {
      log(`  ${unitId}: ${startUrl.host} is a blocked host; skipped`);
      continue;
    }
    const page = await text(http, start);
    const links: URL[] = [];
    // A link that is itself a Slate page counts as a link to its host (no hop needed), before and after redirects.
    for (const u of [startUrl, page ? new URL(page.finalUrl) : null]) if (u && SLATE_PATH.test(u.pathname)) links.push(u);
    if (page) links.push(...slateLinks(page.html, page.finalUrl));
    const own = [startUrl.host, ...(page ? [new URL(page.finalUrl).host] : [])];
    for (const host of rankHosts(links, own).slice(0, maxCandidates)) {
      if (tried.has(host) || blocked(host)) continue;
      tried.add(host);
      if (!(await confirmSlateHost(host, http))) continue;
      const portalParts = await readPortalParts(host, portalPages(links, host), http, opts.maxPortalPages ?? 8);
      log(`  ${unitId}: ${host} (found on ${page?.finalUrl ?? start}; ${portalParts.length} widget${portalParts.length === 1 ? "" : "s"})`);
      return { host, foundOn: page?.finalUrl ?? start, portalParts };
    }
  }
  return null;
}
