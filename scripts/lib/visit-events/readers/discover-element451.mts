/**
 * Finding a college's Element451 events site (specs/product/visit-events.md, "Round 3", "Element451: the protocol";
 * research/element451.md section 4). A site is reachable three ways, all serving the identical app: the visit page
 * may itself be the site (a custom domain, `visit.cookman.edu`); or it links (or quotes in a script, Slate's own
 * embed pattern) an `event451.sites.451.io` host; or, rarely, a different linked host turns out to run the same app.
 * Every candidate is confirmed the same way: fetch its root and look for the `event451-state` blob (`hasElementState`).
 * Unlike Slate, there is no separate search endpoint to also confirm against — the blob's presence is the whole test.
 */
import { pageUrls, type ReaderHttp } from "../discover.mts";
import { hasElementState, parseElementState } from "./element451.mts";

export interface ElementDiscovered {
  host: string;
  /** The page the site was found on: the visit page itself, or its final URL after redirects. */
  foundOn: string;
  /** `slate_hosts.config` for an Element451 row: the confirmed site's own host, and its client token. */
  config: { site: string; client: string | null };
}

/** `event451.sites.451.io` hosts linked (or script-quoted) on the page, before any other linked host. */
const ELEMENT_SITES_HOST = /\.event451\.sites\.451\.io$/i;

/** Hosts a page points to, other than its own, best first: `event451.sites.451.io` hosts before any other linked host. */
export function elementCandidateHosts(html: string, pageUrl: string): string[] {
  const own = new URL(pageUrl).host.toLowerCase();
  const hosts = new Set<string>();
  for (const u of pageUrls(html, pageUrl)) {
    const host = u.host.toLowerCase();
    if (host !== own) hosts.add(host);
  }
  return [...hosts].sort((a, b) => {
    const aSite = ELEMENT_SITES_HOST.test(a) ? 0 : 1;
    const bSite = ELEMENT_SITES_HOST.test(b) ? 0 : 1;
    return aSite - bSite || a.localeCompare(b);
  });
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

/** The client token from a confirmed page's own state blob (`configState.client.token`), or null if it parses oddly. */
function clientToken(html: string): string | null {
  try {
    return parseElementState(html).configState?.client?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * The college's Element451 site, the page it was found on, and its `config`; null when neither the visit page itself
 * nor any host it links (ranked, `event451.sites.451.io` hosts first) answers with the `event451-state` blob. The
 * apply link is the fallback when the visit page gives nothing, the same order Slate's `discoverSlateHost` tries
 * `visitUrl` then `applyUrl` (specs/product/visit-events.md, "Discovery"): a college whose visit link 404s, or whose
 * visit page links only a chat shell, may still link (or itself be) the events site from its apply page.
 */
export async function discoverElementSite(
  unitId: string,
  visitUrl: string | null,
  applyUrl: string | null,
  http: ReaderHttp,
  opts: { maxCandidates?: number; log?: (msg: string) => void } = {},
): Promise<ElementDiscovered | null> {
  const log = opts.log ?? (() => {});
  const maxCandidates = opts.maxCandidates ?? 8;
  for (const start of [visitUrl, applyUrl]) {
    if (!start) continue;
    try {
      new URL(start);
    } catch {
      continue;
    }
    const page = await text(http, start);
    if (!page) continue;

    // The link may itself be the Element451 site (visit.cookman.edu): no hop needed.
    const ownHost = new URL(page.finalUrl).host;
    if (hasElementState(page.html)) {
      log(`  ${unitId}: ${ownHost} is itself an Element451 events site`);
      return { host: ownHost, foundOn: start, config: { site: ownHost, client: clientToken(page.html) } };
    }

    for (const host of elementCandidateHosts(page.html, page.finalUrl).slice(0, maxCandidates)) {
      const root = await text(http, `https://${host}/`);
      if (!root || !hasElementState(root.html)) {
        log(`  ${unitId}: ${host} rejected (no event451-state blob; linked from ${page.finalUrl})`);
        continue;
      }
      log(`  ${unitId}: ${host} (found on ${page.finalUrl})`);
      return { host, foundOn: start, config: { site: host, client: clientToken(root.html) } };
    }
  }
  return null;
}
