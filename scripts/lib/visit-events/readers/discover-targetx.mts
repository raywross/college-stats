/**
 * Finding a college's TargetX events site (specs/product/visit-events.md, "TargetX: the protocol", Discovery): from
 * the visit page, links (or quoted URLs) on `*.my.salesforce-sites.com`, `*.my.site.com`, or `*.force.com`, and the
 * visit URL itself when it is one. Each candidate site (host plus first path segment) is fetched once: a page with a
 * `TargetX_Eventsb` remoting descriptor is a **legacy** site (`config.site` is the segment), a page with the
 * `var a = '[…ERx_Events__…]'` literal an **erx** site (`config.site` keeps the path and the non-tracking query, since
 * `?eventfilter=UAA` picks one campus of a shared org). An Experience Cloud `/s/` page whose path names events, visits,
 * or tours is returned as **lightning**, unfetched, so the CLI stores it `off` (never read). Nothing is posted here;
 * every request goes through `PoliteHttp`.
 */
import { pageUrls, type ReaderHttp } from "../discover.mts";
import { erxLiteral, parseRemotingDescriptor, type TargetxConfig } from "./targetx.mts";

export interface DiscoveredTargetx {
  host: string;
  foundOn: string;
  config: TargetxConfig;
}

export const SALESFORCE_HOST = /(^|\.)(my\.salesforce-sites\.com|my\.site\.com|force\.com)$/i;
/** Paths that are never an events site: chat, sign-in, applications, inquiry and request forms. */
const NOT_EVENTS = /ESW|chat|login|TX_Site|CommunitiesSelfReg|SelfReg|Portal_Login|TargetX_Portal|InquiryForm|\/(forms?|rfi|inquiry|apply|applicantportal|onlineapp)\b|\.(css|js|png|jpe?g|gif|svg|ico)$/i;
/** A Lightning (`/s/`) path that names an events calendar, not a portal. */
const LIGHTNING_EVENTS = /event|visit|tour|session/i;
/** A first path segment that looks like an events site, tried first. */
const EVENTS_SEGMENT = /event|visit|tour|calendar/i;
const TRACKING = /^(utm_|_gl$|gclid$|fbclid$|mc_|_ga$|amp;)/i;

/** The site path (and, kept for ERx, the query) a candidate link names. */
export function candidateSite(u: URL): { key: string; segment: string; pathAndQuery: string } | null {
  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const segment = parts[0];
  const q = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (!TRACKING.test(k)) q.append(k, v);
  const query = parts.length === 1 && q.toString() ? `?${q.toString()}` : "";
  return { key: `${u.host.toLowerCase()}/${segment.toLowerCase()}`, segment, pathAndQuery: `${segment}${query}` };
}

/** Whether a URL is a Lightning (Experience Cloud) page: a `/s/` path segment. */
export function isLightningPath(u: URL): boolean {
  return /(^|\/)s(\/|$)/.test(u.pathname.replace(/^\/+/, ""));
}

/** The Salesforce candidate URLs a page points to (and the page itself when it is one), events-looking first. */
export function salesforceLinks(html: string, pageUrl: string): URL[] {
  const out: URL[] = [];
  const seen = new Set<string>();
  for (const u of [new URL(pageUrl), ...pageUrls(html, pageUrl)]) {
    if (!SALESFORCE_HOST.test(u.host)) continue;
    const href = u.href.replace(/^http:/, "https:");
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(new URL(href));
  }
  const rank = (u: URL) => (EVENTS_SEGMENT.test(u.pathname.split("/")[1] ?? "") ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** What a fetched candidate page is: a legacy events site, an ERx listing, or neither. */
export function classifyTargetxPage(html: string): "legacy" | "erx" | null {
  const desc = parseRemotingDescriptor(html);
  if (desc && /TargetX_Eventsb/i.test(desc.action)) return "legacy";
  const lit = erxLiteral(html);
  if (lit != null && /ERx_Events__/.test(lit)) return "erx";
  return null;
}

async function fetchText(http: ReaderHttp, url: string): Promise<string | null> {
  try {
    const res = await http.get(url);
    if (!res || !res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * The college's TargetX events site, or null. Legacy and ERx sites are confirmed by their page; a Lightning events
 * site is returned (flavour `lightning`) only when no readable site is found.
 */
export async function discoverTargetxSite(
  unitId: string,
  visitUrl: string | null,
  http: ReaderHttp,
  opts: { isBlocked?: (host: string) => boolean; log?: (msg: string) => void; maxCandidates?: number } = {},
): Promise<DiscoveredTargetx | null> {
  const log = opts.log ?? (() => {});
  const blocked = opts.isBlocked ?? (() => false);
  if (!visitUrl) return null;
  let start: URL;
  try {
    start = new URL(visitUrl);
  } catch {
    return null;
  }
  if (blocked(start.host)) return null;
  let html = "";
  let foundOn = visitUrl;
  try {
    const res = await http.get(visitUrl);
    if (res?.ok) {
      html = await res.text();
      foundOn = res.url || visitUrl;
    }
  } catch {
    /* the visit URL itself may still be a candidate */
  }
  const links = salesforceLinks(html, foundOn);
  let lightning: DiscoveredTargetx | null = null;
  const tried = new Set<string>();
  for (const u of links) {
    if (blocked(u.host)) continue;
    if (isLightningPath(u)) {
      if (!lightning && LIGHTNING_EVENTS.test(u.pathname) && !NOT_EVENTS.test(u.pathname)) {
        lightning = { host: u.host.toLowerCase(), foundOn, config: { site: u.pathname.replace(/^\/+/, ""), flavour: "lightning" } };
      }
      continue;
    }
    if (NOT_EVENTS.test(u.pathname)) continue;
    const site = candidateSite(u);
    if (!site || tried.has(site.key)) continue;
    if (tried.size >= (opts.maxCandidates ?? 4)) break;
    tried.add(site.key);
    const url = `https://${u.host.toLowerCase()}/${site.pathAndQuery}`;
    const page = await fetchText(http, url);
    const flavour = page ? classifyTargetxPage(page) : null;
    if (!flavour) {
      log(`  ${unitId}: ${url} rejected (${page == null ? "no answer, or robots.txt disallows it" : "no TargetX events descriptor or ERx listing"})`);
      continue;
    }
    const config: TargetxConfig = { site: flavour === "legacy" ? site.segment : site.pathAndQuery, flavour };
    log(`  ${unitId}: TargetX ${flavour} site ${u.host.toLowerCase()}/${config.site} (found on ${foundOn})`);
    return { host: u.host.toLowerCase(), foundOn, config };
  }
  if (lightning) log(`  ${unitId}: TargetX Lightning site ${lightning.host}/${lightning.config.site} (not readable; stored off)`);
  return lightning;
}
