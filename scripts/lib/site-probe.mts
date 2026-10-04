/**
 * The site probe (specs/school-identity/links.md, implementation step 2 and "As built: the probe"; "The homepage probe"
 * in specs/school-identity/README.md): one polite pass over each college's homepage and admissions page, through the
 * college-reported crawler's HTTP client (`PoliteHttp`: robots.txt honored, at least a second between requests to one
 * host, an honest user agent), collecting
 *   - the campus visit page from the admissions page's links (`pickVisit`), and a virtual tour when it is the only one
 *   - the homepage's links to the college's social accounts (`socialLinks`; read by lib/social.ts)
 *   - the homepage's icon candidates (`iconCandidates`; downloaded and processed by the brand step)
 *   - the liveness of every stored link (`checkLink`: HEAD, then GET), for data/link-issues.json
 * and writing data/site-probe.json (`SiteProbeEntry`, lib/identity-files.ts) and data/link-issues.json, then re-applying
 * identity to data/schools.json (`mergeIdentity`; lib/site-probe.ts sets the links). HTTP only; the Haiku picker for
 * colleges the scorer misses runs only when a `VisitPicker` is passed (`--picker`, off by default, capped in USD).
 *
 *   npm run probe-sites              scripts/probe-sites.mts
 *   npm run sync-data -- --links     the same probe, after the sync writes data/schools.json
 */
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { School, SocialNetwork } from "../../lib/types";
import type { FoundLink, LinkCheck, LinkIssue, ProbedPage, SiteProbeEntry } from "../../lib/identity-files";
import { FAILURES_TO_NULL, PROBE_LINK_FIELDS, liveness, nextLinkIssues, type ProbeLinkField } from "../../lib/site-probe.ts";
import { applyLinks, normalizeUrl } from "../../lib/links.ts";
import { PoliteHttp, errorCode } from "./college-reported/http.mts";
import { blockedStatusOf } from "./college-reported/blocked.mts";
import { decodeEntities } from "./college-reported/documents.mts";
import { collegeDomain } from "./college-reported/probe.mts";
import { PICKER_MAX_CHARS, estimateTokens } from "./college-reported/llm.mts";
import { ROUND3_MODELS, costOf, priceOf, type ModelClient } from "./college-reported/models.mts";
import { fetchIpedsTable } from "./ipeds.mts";
import { mergeIdentity } from "./identity-sync.mts";

/* ------------------------------------------------------------------ */
/* HTML: every link with its landmark, and the head's <link> tags      */
/* ------------------------------------------------------------------ */

/**
 * A link on a page: its absolute URL (the fragment kept, since `twitter.com/#!/handle` is an old profile link), its text
 * (else its aria-label, title, or image alt), and whether it sits inside a <nav>, <header>, or <footer> (or an element
 * with the ARIA role navigation, banner, or contentinfo). `findLinks` in documents.mts gives neither the landmark nor
 * every occurrence, which the visit scorer and the footer rule need.
 */
export interface PageAnchor {
  url: string;
  text: string;
  nav: boolean;
  header: boolean;
  footer: boolean;
}

/** A <link> in the page's <head>, its href resolved; `rel` lower-cased. */
export interface HeadLink {
  rel: string;
  href: string;
  sizes: string | null;
  type: string | null;
}

export interface ParsedPage {
  /** What relative URLs resolve against: the page's final URL, or its <base href>. */
  base: string;
  anchors: PageAnchor[];
  head: HeadLink[];
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
type Landmark = "nav" | "header" | "footer";
const ROLE_LANDMARK: Record<string, Landmark> = { navigation: "nav", banner: "header", contentinfo: "footer" };

/** Named entities link text uses that `decodeEntities` (documents.mts) doesn't know ("Visit &raquo;"). */
const MORE_ENTITIES: Record<string, string> = { raquo: "»", laquo: "«", rsaquo: "›", lsaquo: "‹", rarr: "→", larr: "←", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™", eacute: "é", ntilde: "ñ", aacute: "á", iacute: "í", oacute: "ó", uacute: "ú" };
const decodeText = (s: string) => decodeEntities(s.replace(/&([a-z]+);/gi, (m, name: string) => MORE_ENTITIES[name.toLowerCase()] ?? m));

/** A tag's attributes: names lower-cased, values entity-decoded; the first of a repeated name wins. */
export function parseAttributes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decodeText(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** An href resolved against `base`; null for anything that isn't an http(s) link. */
function resolve(href: string, base: string): string | null {
  const h = href.trim();
  if (!h || /^(javascript|mailto|tel|sms|data):/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A link's visible text, tags dropped and entities decoded; else its aria-label, title, or first image's alt. */
function anchorText(inner: string, attrs: Record<string, string>): string {
  const text = decodeText(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 300);
  const img = /<img\b([^>]*)>/i.exec(inner);
  const alt = img ? parseAttributes(img[1]).alt : undefined;
  return (attrs["aria-label"] || attrs.title || alt || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Every link on a page (each occurrence, in page order) with its landmark, and the head's <link> tags. Comments,
 * scripts, styles, templates, and inline SVG are dropped first. Landmarks are tracked with a stack of open elements: a
 * closing tag closes everything opened after its match (so unclosed <li> and <p> don't leak), and a stray one is ignored.
 */
export function parsePage(html: string, pageUrl: string): ParsedPage {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const headEnd = clean.search(/<\/head\s*>|<body\b/i);
  const headHtml = headEnd < 0 ? clean : clean.slice(0, headEnd);
  let base = pageUrl;
  const baseTag = /<base\b([^>]*)>/i.exec(headHtml);
  const baseHref = baseTag ? parseAttributes(baseTag[1]).href : undefined;
  if (baseHref) base = resolve(baseHref, pageUrl) ?? pageUrl;

  const head: HeadLink[] = [];
  for (const m of headHtml.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttributes(m[1]);
    const href = a.href ? resolve(a.href, base) : null;
    if (!a.rel || !href) continue;
    head.push({ rel: a.rel.trim().toLowerCase().replace(/\s+/g, " "), href, sizes: a.sizes?.trim() || null, type: a.type?.trim().toLowerCase() || null });
  }

  const anchors: PageAnchor[] = [];
  const stack: { tag: string; mark: Landmark | null }[] = [];
  const open: Record<Landmark, number> = { nav: 0, header: 0, footer: 0 };
  let cur: { href: string | null; attrs: Record<string, string>; start: number; at: Pick<PageAnchor, Landmark> } | null = null;
  const finish = (end: number) => {
    if (cur?.href) anchors.push({ url: cur.href, text: anchorText(clean.slice(cur.start, end), cur.attrs), ...cur.at });
    cur = null;
  };
  for (const m of clean.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "a") {
      finish(m.index);
      if (!closing) {
        const attrs = parseAttributes(m[3]);
        cur = { href: attrs.href ? resolve(attrs.href, base) : null, attrs, start: m.index + m[0].length, at: { nav: open.nav > 0, header: open.header > 0, footer: open.footer > 0 } };
      }
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue;
        for (let j = stack.length - 1; j >= i; j--) {
          const mark = stack[j].mark;
          if (mark) open[mark]--;
        }
        stack.length = i;
        break;
      }
      continue;
    }
    if (VOID_TAGS.has(tag) || /\/\s*$/.test(m[3])) continue;
    const mark: Landmark | null =
      tag === "nav" || tag === "header" || tag === "footer" ? tag : /\brole\s*=/i.test(m[3]) ? (ROLE_LANDMARK[(parseAttributes(m[3]).role ?? "").trim().toLowerCase()] ?? null) : null;
    stack.push({ tag, mark });
    if (mark) open[mark]++;
  }
  finish(clean.length);
  return { base, anchors, head };
}

/* ------------------------------------------------------------------ */
/* The college's site                                                  */
/* ------------------------------------------------------------------ */

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * The registrable domains that count as the college's own site: its homepage's and admissions page's, as stored and
 * where their redirects ended (MIT's admissions office is mitadmissions.org; Texas Tech's, gototexastech.com).
 */
export function siteDomains(urls: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const u of urls) {
    const h = hostOf(u);
    if (h) out.add(collegeDomain(h));
  }
  return out;
}

/** A found link's URL without its fragment or tracking parameters (utm_*, _ga, gclid, …), or null when it doesn't parse. */
function cleanUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return null;
  }
}

/** Two URLs name the same document: same origin, path (ignoring a trailing slash), and query. */
function sameDocument(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "") && x.search === y.search;
  } catch {
    return false;
  }
}

function decodedPath(u: URL): string {
  try {
    return decodeURIComponent(u.pathname);
  } catch {
    return u.pathname;
  }
}

/* ------------------------------------------------------------------ */
/* Social links (social-accounts.md, "The college's homepage")         */
/* ------------------------------------------------------------------ */

/** The network a host belongs to (www., m., mobile., and LinkedIn's country subdomains included). */
export function socialNetworkOf(url: string): SocialNetwork | null {
  const host = hostOf(url)?.replace(/^(www|m|mobile)\./, "");
  if (!host) return null;
  if (host === "x.com" || host === "twitter.com") return "x";
  if (host === "instagram.com" || host === "instagr.am") return "instagram";
  if (host === "facebook.com" || host === "fb.com") return "facebook";
  if (host === "youtube.com") return "youtube";
  if (host === "tiktok.com") return "tiktok";
  if (host === "linkedin.com" || /^[a-z]{2}\.linkedin\.com$/.test(host)) return "linkedin";
  return null;
}

/** Other social and media sites: never a visit page. */
const OTHER_SOCIAL = /(^|\.)(pinterest\.com|flickr\.com|snapchat\.com|vimeo\.com|threads\.net|bsky\.app|youtu\.be|fb\.me|tumblr\.com|spotify\.com|soundcloud\.com|reddit\.com)$/;

const X_RESERVED = new Set(["intent", "share", "home", "hashtag", "search", "i", "explore", "settings", "login", "signup", "messages", "notifications", "compose", "tos", "privacy"]);
const INSTAGRAM_RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct", "about", "developer", "legal"]);
const YOUTUBE_RESERVED = new Set(["watch", "embed", "playlist", "results", "shorts", "feed", "redirect", "live", "hashtag", "t", "about", "account", "premium", "kids", "gaming", "post"]);
const FACEBOOK_RESERVED = new Set([
  "sharer",
  "sharer.php",
  "share",
  "share.php",
  "dialog",
  "plugins",
  "login",
  "login.php",
  "events",
  "hashtag",
  "watch",
  "photo",
  "photo.php",
  "photos",
  "story.php",
  "permalink.php",
  "groups",
  "help",
  "policies",
  "privacy",
  "legal",
  "tr",
  "l.php",
  "home.php",
  "search",
  "marketplace",
  "gaming",
  "video.php",
  "ads",
  "business",
]);

/**
 * The network of a link to an account's profile, or null: share buttons, posts, videos, hashtags, and searches are not
 * profiles. An old `twitter.com/#!/handle` link is read through its fragment.
 */
export function socialProfile(url: string): SocialNetwork | null {
  const network = socialNetworkOf(url);
  if (!network) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const path = network === "x" && u.hash.startsWith("#!/") ? u.hash.slice(2) : u.pathname;
  const segs = path.split("/").filter(Boolean);
  const first = (segs[0] ?? "").toLowerCase();
  switch (network) {
    case "x":
      return segs.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(segs[0]) && !X_RESERVED.has(first) ? network : null;
    case "instagram":
      return segs.length === 1 && /^[A-Za-z0-9_.]{1,30}$/.test(segs[0]) && !INSTAGRAM_RESERVED.has(first) ? network : null;
    case "tiktok":
      return segs.length === 1 && /^@[A-Za-z0-9_.]{1,30}$/.test(segs[0]) ? network : null;
    case "youtube":
      if (first === "channel" || first === "user" || first === "c") return segs.length >= 2 ? network : null;
      return first.startsWith("@") || (segs.length === 1 && !YOUTUBE_RESERVED.has(first)) ? network : null;
    case "facebook":
      if (!first || FACEBOOK_RESERVED.has(first)) return null;
      return first === "profile.php" ? (u.searchParams.get("id") ? network : null) : network;
    case "linkedin":
      return (first === "school" || first === "company") && segs.length >= 2 ? network : null;
  }
}

/** Social networks in the order lib/social.ts shows them, so each entry's keys come out in one order. */
const NETWORK_ORDER: readonly SocialNetwork[] = ["instagram", "youtube", "tiktok", "x", "facebook", "linkedin"];

/**
 * The homepage's link to each network, as found (the fragment dropped, except an old `#!/handle`, rewritten to the
 * path form so a handle can be read): the first profile link in a <footer> or <header>, else the first on the page.
 */
export function socialLinks(anchors: readonly PageAnchor[]): Partial<Record<SocialNetwork, string>> {
  const found = new Map<SocialNetwork, string>();
  for (const inLandmark of [true, false]) {
    for (const a of anchors) {
      if (inLandmark && !(a.footer || a.header)) continue;
      const network = socialProfile(a.url);
      if (!network || found.has(network)) continue;
      const u = new URL(a.url);
      if (network === "x" && u.hash.startsWith("#!/")) u.pathname = u.hash.slice(2);
      u.hash = "";
      found.set(network, u.toString());
    }
  }
  return Object.fromEntries(NETWORK_ORDER.filter((n) => found.has(n)).map((n) => [n, found.get(n)!]));
}

/* ------------------------------------------------------------------ */
/* Icon candidates (brand.md, "Source: marks")                         */
/* ------------------------------------------------------------------ */

export type IconCandidate = SiteProbeEntry["icons"][number];

/** A candidate's size for ordering: scalable ("any" or SVG) first, then its largest declared side; undeclared last. */
function iconPx(c: Pick<IconCandidate, "url" | "sizes" | "type">): number {
  const sizes = (c.sizes ?? "").toLowerCase();
  if (sizes.split(/\s+/).includes("any") || (c.type ?? "").includes("svg") || /\.svg($|\?)/i.test(c.url)) return 1e6;
  let max = 0;
  for (const m of sizes.matchAll(/(\d+)\s*x\s*(\d+)/g)) max = Math.max(max, Number(m[1]), Number(m[2]));
  return max;
}

/**
 * The homepage's icons, best first: apple-touch-icon (largest `sizes` first), then icon (largest first), then the
 * conventional /apple-touch-icon.png and /favicon.ico at the site's root (`rel: "fallback"`) unless the head declared
 * them. Ties keep page order; a URL appears once. `pageUrl` is the page's final URL (fallbacks resolve against it).
 */
export function iconCandidates(head: readonly HeadLink[], pageUrl: string | null): IconCandidate[] {
  const touch: IconCandidate[] = [];
  const icons: IconCandidate[] = [];
  for (const l of head) {
    const tokens = l.rel.split(" ");
    const kind = tokens.includes("apple-touch-icon") || tokens.includes("apple-touch-icon-precomposed") ? "apple-touch-icon" : tokens.includes("icon") ? "icon" : null;
    if (!kind) continue;
    (kind === "apple-touch-icon" ? touch : icons).push({ url: l.href, rel: kind, sizes: l.sizes, type: l.type });
  }
  const bySize = (a: IconCandidate, b: IconCandidate) => iconPx(b) - iconPx(a);
  const out: IconCandidate[] = [];
  const seen = new Set<string>();
  for (const c of [...touch.sort(bySize), ...icons.sort(bySize)]) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  if (pageUrl) {
    for (const path of ["/apple-touch-icon.png", "/favicon.ico"]) {
      const url = new URL(path, pageUrl).toString();
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, rel: "fallback", sizes: null, type: null });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The visit page (links.md, "The college's own site: the visit page")  */
/* ------------------------------------------------------------------ */

/**
 * "visit", but not "visitor(s)" (visitor information, a Board of Visitors) or a visiting student, scholar, or professor
 * ("Visiting Undergraduate Students", "Visiting Medical Students": non-degree programs). Measured on 60 colleges and then
 * all 1,893 (2026-10-04), those were the scorer's commonest wrong picks.
 */
const VISIT = /visit(?!ors?(?![a-z])|ing[\s_-]+(?:[a-z]+[\s_-]+)?(?:students?|scholars?|faculty|professors?|researchers?)(?![a-z]))/i;
const TOUR = /tours?(?![a-z])/i;
const OPEN_HOUSE = /open[\s_-]*houses?|admitted[\s_-]*students?/i;
const VIRTUAL = /virtual/i;
const DOCUMENT = /\.(pdf|docx?|xlsx?|pptx?|zip)$/i;
/**
 * Visits that aren't a prospective student's, and "visit" as a verb for some other page: never the visit page. From the
 * full run's wrong picks: "Accreditation Review Visit", "Patient Home Visits", "Visit the Newsroom", "Visit the Library
 * Page", "Visit Site", a clinic.
 */
const NOT_A_CAMPUS_VISIT = /accredit|patients?(?![a-z])|clinics?(?![a-z])|cl[íi]nica|newsroom|visit[\s_-]+(?:(?:the|our)[\s_-]+)?(?:news|library|web[\s_-]*site|site|page|blog|store|shop|bookstore)(?![a-z])/i;
/** A graduate-only page (UCLA's graduate division, "Graduate Visit"): the site's visitors are choosing an undergraduate college. */
const GRADUATE = /(?<!under)graduate|(?<![a-z])grads?(?![a-z])/i;
const UNDERGRADUATE = /undergrad/i;
/** A campus map or directions page labeled "Visit" ("Visit Campus" → /campus-map): a weaker match than a visit page. */
const MAP_PAGE = /(?<![a-z])maps?(?![a-z])|directions|parking/i;
/** Tracking parameters dropped from a found link (they make no different page). */
const TRACKING = /^(utm_[a-z]+|_ga|_gl|gclid|fbclid|mc_cid|mc_eid)$/i;

/** The minimum score of a visit page (links.md step 4). */
export const VISIT_MIN_SCORE = 3;

/**
 * A link's visit score (links.md step 3): "visit" in the text or path +3; "tour" +2; "open house" or "admitted
 * student" +1; "virtual" −1; inside a <nav> or <header> +1; and, measured on the full run, −2 for a map, directions,
 * or parking page whose path doesn't name a visit or tour. −Infinity when it can't be the visit page: off the college's
 * registrable domains, a document (PDF, Word, Excel, slides), a social or media site, a site's front page ("Visit our
 * main site") unless the host itself is for visits or tours, a visit that isn't a prospective student's
 * (NOT_A_CAMPUS_VISIT), or a graduate-only page.
 */
export function visitScore(a: PageAnchor, domains: ReadonlySet<string>): number {
  let u: URL;
  try {
    u = new URL(a.url);
  } catch {
    return -Infinity;
  }
  const host = u.hostname.toLowerCase();
  if (!domains.has(collegeDomain(host)) || DOCUMENT.test(u.pathname) || socialNetworkOf(a.url) || OTHER_SOCIAL.test(host)) return -Infinity;
  const path = decodedPath(u);
  if (!path.replace(/\/+$/, "") && !/visit|tour/i.test(host)) return -Infinity;
  const hay = `${a.text}\n${path}`;
  const withHost = `${a.text}\n${host}${path}`;
  if (NOT_A_CAMPUS_VISIT.test(hay) || (GRADUATE.test(withHost) && !UNDERGRADUATE.test(withHost))) return -Infinity;
  let score = 0;
  if (VISIT.test(hay)) score += 3;
  if (TOUR.test(hay)) score += 2;
  if (OPEN_HOUSE.test(hay)) score += 1;
  if (VIRTUAL.test(hay)) score -= 1;
  if (MAP_PAGE.test(path) && !VISIT.test(path) && !TOUR.test(path)) score -= 2;
  if (a.nav || a.header) score += 1;
  return score;
}

export interface VisitFind {
  visit: FoundLink | null;
  virtual_tour: FoundLink | null;
}

/** A path as a folder: no trailing slash or index file, so /visit/index.html and /visit/ are the same page. */
const folderOf = (path: string) => path.replace(/\/(index|default)\.(html?|php|aspx?)$/i, "").replace(/\/+$/, "");

/** Whether `hub` is a visit section's own page and `page` sits inside it (same host, a folder below). */
function inside(page: URL, hub: URL): boolean {
  if (page.host !== hub.host) return false;
  const h = folderOf(decodedPath(hub));
  if (!VISIT.test(h) && !TOUR.test(h) && !(h === "" && /visit|tour/i.test(hub.hostname))) return false;
  return folderOf(decodedPath(page)).startsWith(`${h}/`);
}

/**
 * The visit page among a page's links (links.md step 4): the best-scoring link that isn't a virtual one, when it scores
 * at least 3. Three refinements measured on 60 colleges (2026-10-04): a visit section's own page beats the pages inside
 * it (/visit/ over /visit/admitted/, whose "admitted student" +1 would otherwise win); a tie goes to a link on the
 * page's own host (Pitt's admissions page lists every campus's visit page), then to the first in page order. A virtual
 * link ("virtual" in its text, or in the path of a link without text) that names a visit or tour is kept as
 * `virtual_tour` only when no visit page was found. Links to the page itself, and URLs in `exclude` (found dead), are
 * skipped; fragments and tracking parameters are dropped.
 */
export function pickVisit(anchors: readonly PageAnchor[], foundOn: string, domains: ReadonlySet<string>, exclude: ReadonlySet<string> = new Set()): VisitFind {
  const pageHost = hostOf(foundOn);
  const candidates = new Map<string, FoundLink>();
  let virtual: FoundLink | null = null;
  for (const a of anchors) {
    const url = cleanUrl(a.url);
    if (!url || sameDocument(url, foundOn) || exclude.has(url)) continue;
    const score = visitScore(a, domains);
    if (!Number.isFinite(score)) continue;
    const path = decodedPath(new URL(url));
    const found: FoundLink = { url, found_on: foundOn, text: a.text.slice(0, 200), score };
    if (VIRTUAL.test(a.text) || (!a.text && VIRTUAL.test(path))) {
      if ((VISIT.test(`${a.text}\n${path}`) || TOUR.test(`${a.text}\n${path}`)) && (!virtual || score > virtual.score)) virtual = found;
    } else if (score >= VISIT_MIN_SCORE && (candidates.get(url)?.score ?? -Infinity) < score) candidates.set(url, found);
  }
  const all = [...candidates.values()];
  const urls = new Map(all.map((c) => [c, new URL(c.url)]));
  let visit: FoundLink | null = null;
  for (const c of all) {
    if (all.some((h) => h !== c && inside(urls.get(c)!, urls.get(h)!))) continue;
    const better = !visit || c.score > visit.score || (c.score === visit.score && hostOf(c.url) === pageHost && hostOf(visit.url) !== pageHost);
    if (better) visit = c;
  }
  return { visit, virtual_tour: visit ? null : virtual };
}

/* ------------------------------------------------------------------ */
/* Fetching: pages and the liveness check                              */
/* ------------------------------------------------------------------ */

/**
 * Why a request has no usable answer: robots.txt disallows it ("robots") or answered 5xx ("robots-error", which RFC 9309
 * treats as disallow-all), or asks for more than MAX_CRAWL_DELAY_MS between requests ("crawl-delay": not requested);
 * the host doesn't exist ("dns", confirmed by `HostLookup` when the run has one); no complete answer in time
 * ("timeout"); a certificate or TLS failure ("tls");
 * connection refused or reset; the body passed the size cap; a bot-protection page ("challenge"); any other network
 * error ("network"); or a URL that doesn't parse ("invalid"). Only "dns" counts as a failure (lib/site-probe.ts
 * `liveness`).
 */
export type ProbeError = "robots" | "robots-error" | "crawl-delay" | "dns" | "timeout" | "tls" | "refused" | "reset" | "size" | "challenge" | "network" | "invalid";

/**
 * The longest gap between requests a host may ask for (robots.txt Crawl-delay) and still be probed. `PoliteHttp` honors
 * any delay, so a host asking for minutes would hold the run for hours: 2026-10-04's first full run stalled on hosts
 * asking for 1,000 s (caldwell.edu), 600 s (mbu.edu, pvamu.edu, thomasmorecollege.edu), 300 s, and 120 s (several
 * course catalogs). Their URLs are skipped instead, never requested faster.
 */
export const MAX_CRAWL_DELAY_MS = 30_000;

/** A failed request's ProbeError, from its `errorCode`. */
export function probeError(code: string): ProbeError {
  if (code === "ENOTFOUND") return "dns";
  if (code === "timeout" || code === "ETIMEDOUT" || code.includes("TIMEOUT")) return "timeout";
  if (code === "size") return "size";
  if (/^(CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|EPROTO$|ERR_OSSL)/.test(code)) return "tls";
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ECONNRESET" || code === "EPIPE" || code === "UND_ERR_SOCKET") return "reset";
  return "network";
}

/** The slice of `PoliteHttp` the probe uses (tests pass a real PoliteHttp over a fake fetch). */
export interface ProbeHttp {
  get(url: string): Promise<Response | null>;
  head(url: string): Promise<Response | null>;
  skipReason(url: string): Promise<{ reason: "robots" | "server-error" | "no-response"; cause?: string } | null>;
  crawlDelayMs(url: string): Promise<number | null>;
}

type Skip = NonNullable<Awaited<ReturnType<ProbeHttp["skipReason"]>>>;
const skipError = (skip: Skip): ProbeError => (skip.reason === "robots" ? "robots" : skip.reason === "server-error" ? "robots-error" : probeError(skip.cause ?? ""));

/**
 * Whether a host exists: "no" only when the resolver says so (ENOTFOUND) on every one of a few tries. Under load the
 * system resolver answers ENOTFOUND for real hosts now and then: in the first full run (2026-10-04), 130 of the 147 hosts
 * reported missing resolved a minute later (npc.collegeboard.org, www.pomona.edu, www.csun.edu), and since `PoliteHttp`
 * keeps a failed robots.txt for the whole run, one bad answer made every link on the host look dead.
 */
export type HostLookup = (host: string) => Promise<"yes" | "no" | "unknown">;

/** The system resolver (or `resolve`, in tests), asked up to three times (now, after 1 s, after 3 s more), once per host per run. */
export function systemHostLookup(
  resolve: (host: string) => Promise<unknown> = (host) => lookup(host),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): HostLookup {
  const cache = new Map<string, Promise<"yes" | "no" | "unknown">>();
  return (host) => {
    let answer = cache.get(host);
    if (!answer) {
      answer = (async () => {
        let other = false;
        for (const wait of [0, 1000, 3000]) {
          if (wait) await sleep(wait);
          try {
            await resolve(host);
            return "yes" as const;
          } catch (err) {
            if ((err as { code?: string }).code !== "ENOTFOUND") other = true;
          }
        }
        return other ? ("unknown" as const) : ("no" as const);
      })();
      cache.set(host, answer);
    }
    return answer;
  };
}

/** A request's error, with "dns" read as a passing failure when the resolver found the host a moment ago. */
const confirmed = (error: ProbeError, exists: "yes" | "no" | "unknown"): ProbeError => (error === "dns" && exists === "yes" ? "network" : error);

/**
 * Why the probe won't request `url` at all: its host doesn't exist (checked with `hosts` when given), robots.txt refuses
 * it, its host didn't answer robots.txt, or it asks too long a gap. Also returns what `hosts` said, for `confirmed`.
 */
async function notRequested(http: ProbeHttp, url: string, hosts?: HostLookup): Promise<{ error: ProbeError | null; exists: "yes" | "no" | "unknown" }> {
  const exists = hosts ? await hosts(new URL(url).hostname) : "unknown";
  if (exists === "no") return { error: "dns", exists };
  const skip = await http.skipReason(url);
  if (skip) return { error: confirmed(skipError(skip), exists), exists };
  return { error: ((await http.crawlDelayMs(url)) ?? 0) > MAX_CRAWL_DELAY_MS ? "crawl-delay" : null, exists };
}

/** A page the probe read: what to record about it, and its links and head when it answered with HTML. */
export interface FetchedPage {
  page: ProbedPage;
  parsed: ParsedPage | null;
}

const isHtml = (res: Response) => {
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  return !type || /html|xml/.test(type);
};

/** GETs a page (robots.txt, pacing) and parses it when it answers 2xx with HTML that isn't a bot-protection page. */
export async function fetchPage(http: ProbeHttp, url: string, hosts?: HostLookup): Promise<FetchedPage> {
  const none = (error: ProbeError): FetchedPage => ({ page: { url, final_url: null, status: null, error }, parsed: null });
  if (!hostOf(url)) return none("invalid");
  const { error, exists } = await notRequested(http, url, hosts);
  if (error) return none(error);
  try {
    const res = await http.get(url);
    if (!res) return none("robots");
    const final = res.url || url;
    const html = isHtml(res) ? await res.text() : "";
    const challenge = blockedStatusOf(res.status, res.headers, html.slice(0, 64 * 1024)) === "challenge";
    const page: ProbedPage = { url, final_url: final, status: res.status, ...(challenge ? { error: "challenge" } : {}) };
    return { page, parsed: res.ok && !challenge && html ? parsePage(html, final) : null };
  } catch (err) {
    return none(confirmed(probeError(errorCode(err)), exists));
  }
}

/** A liveness result from a response (`final_url` only when redirects changed the URL). */
function answered(url: string, status: number, final: string | null, error?: ProbeError): LinkCheck {
  return { url, status, final_url: final && final !== url ? final : null, ...(error ? { error } : {}) };
}

/** A page fetch read as a liveness result, so a page the probe already fetched isn't requested again. */
export function pageCheck(page: ProbedPage): LinkCheck {
  return page.status === null ? { url: page.url, status: null, final_url: null, ...(page.error ? { error: page.error } : {}) } : answered(page.url, page.status, page.final_url, page.error as ProbeError | undefined);
}

/**
 * One link's liveness: HEAD, then GET when HEAD isn't answered with a 2xx (405, a refusal, a 404 some servers give HEAD
 * alone, or a network error), through `PoliteHttp`, so robots.txt and the one-request-a-second gap apply to both.
 */
export async function checkLink(http: ProbeHttp, url: string, hosts?: HostLookup): Promise<LinkCheck> {
  if (!hostOf(url)) return { url, status: null, final_url: null, error: "invalid" };
  const { error, exists } = await notRequested(http, url, hosts);
  if (error) return { url, status: null, final_url: null, error };
  try {
    const res = await http.head(url);
    if (res && res.status >= 200 && res.status < 300) return answered(url, res.status, res.url || null);
  } catch {
    // A server that drops HEAD may still answer GET.
  }
  try {
    const res = await http.get(url);
    if (!res) return { url, status: null, final_url: null, error: "robots" };
    const body = isHtml(res) ? (await res.text()).slice(0, 64 * 1024) : "";
    return answered(url, res.status, res.url || null, blockedStatusOf(res.status, res.headers, body) === "challenge" ? "challenge" : undefined);
  } catch (err) {
    return { url, status: null, final_url: null, error: confirmed(probeError(errorCode(err)), exists) };
  }
}

/* ------------------------------------------------------------------ */
/* The Haiku picker (links.md step 4; off unless --picker)             */
/* ------------------------------------------------------------------ */

/** A link the picker can choose. */
export interface PickerLink {
  text: string;
  url: string;
}

export interface VisitPickerInput {
  college: { unit_id: string; name: string };
  links: readonly PickerLink[];
}

export const VISIT_PICKER_MAX_TOKENS = 64;

const VISIT_PICKER_SYSTEM = `You pick one link for a site that helps students explore U.S. colleges. You get a numbered list of links found on one college's admissions web page (link text and URL). Answer with the number of the link to the page where a prospective student plans or books an in-person campus visit or tour (daily tours, visit days, open houses, scheduling a visit). Answer 0 when no link is such a page; never pick a general page such as the admissions home page, a news story, or an application portal. Choose only from the list.`;

const VISIT_PICKER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["visit"],
  properties: { visit: { type: "integer", description: "Number of the link to the campus visit page, or 0 when no link is one" } },
} as const;

/** The college's own links worth showing the picker: on its site, not a document or a social site, each URL once. */
export function pickerLinks(anchors: readonly PageAnchor[], domains: ReadonlySet<string>): PickerLink[] {
  const out: PickerLink[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    const url = cleanUrl(a.url);
    if (!url || seen.has(url)) continue;
    const u = new URL(url);
    if (!domains.has(collegeDomain(u.hostname)) || DOCUMENT.test(u.pathname) || socialNetworkOf(url)) continue;
    seen.add(url);
    out.push({ text: a.text, url });
  }
  return out;
}

/** The picker's request: numbered links (text and URL), deduplicated, capped at ~4 K tokens like the CDS picker's. */
export function buildVisitPickerRequest(
  input: VisitPickerInput,
  model: string = ROUND3_MODELS.picker,
): { params: Anthropic.MessageCreateParamsNonStreaming; links: PickerLink[]; estimated_input_tokens: number } {
  priceOf(model);
  const links: PickerLink[] = [];
  const rows: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const l of input.links) {
    if (!/^https?:\/\//.test(l.url) || seen.has(l.url)) continue;
    const row = `${links.length + 1} | ${l.text.replace(/\s+/g, " ").trim().slice(0, 120)} | ${l.url}`;
    if (chars + row.length > PICKER_MAX_CHARS) break;
    seen.add(l.url);
    links.push(l);
    rows.push(row);
    chars += row.length + 1;
  }
  const user = `College: ${input.college.name} (IPEDS unit ${input.college.unit_id})\n\nLinks:\n${rows.join("\n")}`;
  return {
    params: {
      model,
      max_tokens: VISIT_PICKER_MAX_TOKENS,
      system: VISIT_PICKER_SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: VISIT_PICKER_SCHEMA as unknown as Record<string, unknown> } },
    },
    links,
    estimated_input_tokens: estimateTokens(VISIT_PICKER_SYSTEM.length + user.length),
  };
}

/** The chosen link, or null for 0, a number outside the list (no invented links), unreadable JSON, or a refusal. */
export function parseVisitPickerResponse(message: Anthropic.Message, links: readonly PickerLink[]): PickerLink | null {
  if (message.stop_reason === "refusal") return null;
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  let n: unknown;
  try {
    n = (JSON.parse(text) as { visit?: unknown }).visit;
  } catch {
    return null;
  }
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= links.length ? links[n - 1] : null;
}

/**
 * Asks Haiku for the visit page of colleges the scorer missed, under a cost cap in US dollars: before each call its
 * worst case (estimated input × 1.2 at the input price, plus max_tokens at the output price) is reserved, and a call
 * that wouldn't fit under the cap with what is spent and reserved is skipped. Errors are counted and skipped.
 */
export class VisitPicker {
  readonly model: string;
  readonly capUsd: number;
  spent = 0;
  calls = 0;
  skipped = 0;
  errors = 0;
  private reserved = 0;
  private client: ModelClient;
  private log: (msg: string) => void;

  constructor(client: ModelClient, opts: { capUsd: number; model?: string; log?: (msg: string) => void }) {
    this.client = client;
    this.capUsd = opts.capUsd;
    this.model = opts.model ?? ROUND3_MODELS.picker;
    this.log = opts.log ?? (() => {});
    priceOf(this.model);
  }

  async pick(input: VisitPickerInput): Promise<PickerLink | null> {
    const built = buildVisitPickerRequest(input, this.model);
    if (!built.links.length) return null;
    const rate = priceOf(this.model).interactive;
    const worst = (built.estimated_input_tokens * 1.2 * rate.input + VISIT_PICKER_MAX_TOKENS * rate.output) / 1e6;
    if (this.spent + this.reserved + worst > this.capUsd) {
      this.skipped++;
      return null;
    }
    this.reserved += worst;
    try {
      const res = await this.client.messages.create(built.params);
      this.calls++;
      this.spent += costOf(res.model || this.model, res.usage);
      return parseVisitPickerResponse(res, built.links);
    } catch (err) {
      this.errors++;
      this.log(`  picker failed for ${input.college.unit_id}: ${err instanceof Error ? err.message : err}`);
      return null;
    } finally {
      this.reserved -= worst;
    }
  }
}

/* ------------------------------------------------------------------ */
/* One college                                                         */
/* ------------------------------------------------------------------ */

/** What the probe needs about a college: the links the dataset stores (or will store) for it. */
export interface ProbeTarget {
  unit_id: string;
  name: string;
  links: Partial<Record<ProbeLinkField, string | null>>;
}

/** The IPEDS directory columns of the stored links (links.md, "IPEDS directory HD{Y}"). */
const HD_LINK_COLUMNS: Record<Exclude<ProbeLinkField, "visit" | "virtual_tour">, string> = {
  website: "WEBADDR",
  admissions: "ADMINURL",
  apply: "APPLURL",
  financial_aid: "FAIDURL",
  price_calculator: "NPRICURL",
  veterans: "VETURL",
  disability_services: "DISAURL",
};

/**
 * The links a college will store, so the probe checks the same URLs the sync writes: the school's links after
 * `applyLinks` with its directory row (lib/links.ts, the same call sync-data makes), and, for any field that left
 * unset, the row's column through `normalizeUrl`. The visit pages are found again on every run, so they aren't taken
 * from the school.
 */
export function probeTarget(school: School, hdRow?: Record<string, string>): ProbeTarget {
  const clone = structuredClone(school);
  applyLinks(clone, hdRow);
  const stored = (clone.links ?? {}) as Partial<Record<ProbeLinkField, string | null>>;
  const links: Partial<Record<ProbeLinkField, string | null>> = {};
  for (const [field, column] of Object.entries(HD_LINK_COLUMNS) as [ProbeLinkField, string][]) {
    const value = stored[field] !== undefined ? stored[field] : normalizeUrl(hdRow?.[column]);
    if (value !== undefined) links[field] = value;
  }
  return { unit_id: school.unit_id, name: school.name, links };
}

/** What every college's probe shares in a run. */
export interface ProbeContext {
  http: ProbeHttp;
  /** ISO date of the run. */
  today: string;
  picker?: VisitPicker | null;
  /** Confirms a host is missing before a link counts as dead for it (`systemHostLookup` in a real run). */
  hosts?: HostLookup;
  /** Run-wide caches by URL, so a page or link several colleges share (a system's pages, a price calculator host) is requested once. */
  pages: Map<string, Promise<FetchedPage>>;
  checks: Map<string, Promise<LinkCheck>>;
}

export function probeContext(http: ProbeHttp, today: string, picker?: VisitPicker | null, hosts?: HostLookup): ProbeContext {
  return { http, today, picker: picker ?? null, ...(hosts ? { hosts } : {}), pages: new Map(), checks: new Map() };
}

function page(ctx: ProbeContext, url: string): Promise<FetchedPage> {
  let p = ctx.pages.get(url);
  if (!p) ctx.pages.set(url, (p = fetchPage(ctx.http, url, ctx.hosts)));
  return p;
}

function check(ctx: ProbeContext, url: string): Promise<LinkCheck> {
  const fetched = ctx.pages.get(url);
  if (fetched) return fetched.then((f) => pageCheck(f.page));
  let p = ctx.checks.get(url);
  if (!p) ctx.checks.set(url, (p = checkLink(ctx.http, url, ctx.hosts)));
  return p;
}

/** At most this many found visit pages are tried when the best ones already answer 404, 410, or no host. */
const VISIT_TRIES = 3;

/**
 * Probes one college: its homepage (social links, icon candidates) and its admissions page (else the homepage) for the
 * visit page, falling back to the homepage's links when the admissions page can't be read; the picker, when there is
 * one, for a college the scorer missed; then the liveness of every stored link and the visit pages found. A visit page
 * found today that already fails its check (404, 410, no host) isn't kept: the next best link is tried.
 */
export async function probeCollege(ctx: ProbeContext, target: ProbeTarget): Promise<SiteProbeEntry> {
  const website = target.links.website ?? null;
  const admissionsUrl = target.links.admissions ?? website;
  const home = website ? await page(ctx, website) : null;
  const adm = admissionsUrl ? await page(ctx, admissionsUrl) : null;
  const domains = siteDomains([website, home?.page.final_url, admissionsUrl, adm?.page.final_url]);
  const dead = async (found: FoundLink | null) => !!found && liveness(await check(ctx, found.url)) === "failed";

  const source = adm?.parsed ? adm : home?.parsed ? home : null;
  let find: VisitFind = { visit: null, virtual_tour: null };
  if (source?.parsed) {
    const foundOn = source.page.final_url ?? source.page.url;
    const rejected = new Set<string>();
    find = pickVisit(source.parsed.anchors, foundOn, domains);
    while (rejected.size < VISIT_TRIES && (await dead(find.visit ?? find.virtual_tour))) {
      rejected.add((find.visit ?? find.virtual_tour)!.url);
      find = pickVisit(source.parsed.anchors, foundOn, domains, rejected);
    }
    if (rejected.size >= VISIT_TRIES && (await dead(find.visit ?? find.virtual_tour))) find = { visit: null, virtual_tour: null };
    if (!find.visit && ctx.picker) {
      const picked = await ctx.picker.pick({ college: target, links: pickerLinks(source.parsed.anchors, domains).filter((l) => !rejected.has(l.url)) });
      if (picked) {
        const anchor = source.parsed.anchors.find((a) => cleanUrl(a.url) === picked.url);
        const score = anchor ? visitScore(anchor, domains) : 0;
        const visit: FoundLink = { url: picked.url, found_on: foundOn, text: picked.text.slice(0, 200), score: Number.isFinite(score) ? score : 0, by: "picker" };
        if (!(await dead(visit))) find = { visit, virtual_tour: null };
      }
    }
  }

  const social = home?.parsed ? socialLinks(home.parsed.anchors) : {};
  // Fallback icons are worth trying wherever the host answered, even when the page itself refused us.
  const hostAnswered = home && (home.page.status !== null || home.page.error === "robots");
  const icons = home?.parsed ? iconCandidates(home.parsed.head, home.page.final_url) : hostAnswered ? iconCandidates([], website) : [];

  const urls: [ProbeLinkField, string][] = [];
  for (const field of PROBE_LINK_FIELDS) {
    const url = field === "visit" ? find.visit?.url : field === "virtual_tour" ? find.virtual_tour?.url : target.links[field];
    if (url) urls.push([field, url]);
  }
  const checked = Object.fromEntries(await Promise.all(urls.map(async ([field, url]) => [field, await check(ctx, url)] as const)));
  return {
    unit_id: target.unit_id,
    retrieved: ctx.today,
    homepage: home?.page ?? null,
    admissions: adm?.page ?? null,
    visit: find.visit,
    virtual_tour: find.virtual_tour,
    social,
    icons,
    checked,
  };
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

/** One row per line, the format of data/schools.json, so diffs stay readable. */
export function formatRows(rows: readonly unknown[]): string {
  return rows.length ? `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n` : "[]\n";
}

/** This run's entries over the previous file's (a partial run keeps the rest), only colleges in `keep`, by unit id. */
export function mergeProbeEntries(previous: readonly SiteProbeEntry[], fresh: readonly SiteProbeEntry[], keep?: ReadonlySet<string>): SiteProbeEntry[] {
  const byId = new Map(previous.map((e) => [e.unit_id, e]));
  for (const e of fresh) byId.set(e.unit_id, e);
  return [...byId.values()].filter((e) => !keep || keep.has(e.unit_id)).sort((a, b) => (a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : 0));
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

/* ------------------------------------------------------------------ */
/* A run                                                               */
/* ------------------------------------------------------------------ */

export interface ProbeSummary {
  colleges: number;
  seconds: number;
  /** Homepages that answered 2xx with HTML we read. */
  homepages: number;
  /** Admissions pages (or the homepage, for colleges without one) read. */
  admissionsPages: number;
  visit: number;
  visitByPicker: number;
  virtualOnly: number;
  social: Record<SocialNetwork, number>;
  anySocial: number;
  /** Colleges by their best icon candidate's kind. */
  icons: { "apple-touch-icon": number; icon: number; fallback: number; none: number };
  /** Liveness results by status or error. */
  checks: { total: number; ok: number; failed: Record<string, number>; unknown: Record<string, number> };
  /** Colleges whose homepage or admissions page robots.txt kept us from, and link checks it refused. */
  robots: { homepages: number; admissions: number; links: number };
  /** Hosts that refused a GET (401, 403, 405, 429, a challenge). */
  blockedHosts: number;
  issues: { total: number; dead: number };
  picker: { calls: number; spent: number; skipped: number; errors: number } | null;
}

const bump = (o: Record<string, number>, k: string) => void (o[k] = (o[k] ?? 0) + 1);

export function summarize(entries: readonly SiteProbeEntry[], extra: { seconds: number; blockedHosts: number; issues: readonly LinkIssue[]; picker: VisitPicker | null }): ProbeSummary {
  const social = Object.fromEntries(NETWORK_ORDER.map((n) => [n, 0])) as Record<SocialNetwork, number>;
  const icons = { "apple-touch-icon": 0, icon: 0, fallback: 0, none: 0 };
  const checks = { total: 0, ok: 0, failed: {} as Record<string, number>, unknown: {} as Record<string, number> };
  const robots = { homepages: 0, admissions: 0, links: 0 };
  let homepages = 0;
  let admissionsPages = 0;
  for (const e of entries) {
    if (e.homepage?.status && e.homepage.status >= 200 && e.homepage.status < 300 && !e.homepage.error) homepages++;
    const adm = e.admissions;
    if (adm?.status && adm.status >= 200 && adm.status < 300 && !adm.error) admissionsPages++;
    if (e.homepage?.error === "robots") robots.homepages++;
    if (adm?.error === "robots") robots.admissions++;
    for (const n of Object.keys(e.social) as SocialNetwork[]) social[n]++;
    const best = e.icons[0]?.rel as keyof typeof icons | undefined;
    icons[best && best in icons ? best : "none"]++;
    for (const c of Object.values(e.checked ?? {})) {
      checks.total++;
      const state = liveness(c);
      const key = c.status !== null ? String(c.status) : (c.error ?? "none");
      if (state === "ok") checks.ok++;
      else bump(state === "failed" ? checks.failed : checks.unknown, c.error === "challenge" ? "challenge" : key);
      if (c.error === "robots") robots.links++;
    }
  }
  return {
    colleges: entries.length,
    seconds: extra.seconds,
    homepages,
    admissionsPages,
    visit: entries.filter((e) => e.visit).length,
    visitByPicker: entries.filter((e) => e.visit?.by === "picker").length,
    virtualOnly: entries.filter((e) => !e.visit && e.virtual_tour).length,
    social,
    anySocial: entries.filter((e) => Object.keys(e.social).length).length,
    icons,
    checks,
    robots,
    blockedHosts: extra.blockedHosts,
    issues: { total: extra.issues.length, dead: extra.issues.filter((i) => i.failures >= FAILURES_TO_NULL).length },
    picker: extra.picker ? { calls: extra.picker.calls, spent: Math.round(extra.picker.spent * 1e6) / 1e6, skipped: extra.picker.skipped, errors: extra.picker.errors } : null,
  };
}

/** A spread sample that stays the same between runs: colleges ordered by a hash of the unit id (FNV-1a). */
export function spreadSample<T extends { unit_id: string }>(items: readonly T[], n: number): T[] {
  const hash = (s: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  };
  return [...items].sort((a, b) => hash(a.unit_id) - hash(b.unit_id)).slice(0, n);
}

/** The newest IPEDS directory file in the download cache (`.cache/ipeds`), or null; never the network. */
export async function cachedDirectory(root: string, ids: ReadonlySet<string>): Promise<{ name: string; rows: Map<string, Record<string, string>> } | null> {
  const year = new Date().getFullYear();
  for (const y of [year + 1, year, year - 1, year - 2]) {
    const t = await fetchIpedsTable(`HD${y}`, { cacheDir: join(root, ".cache", "ipeds"), keep: ids, offline: true }).catch(() => null);
    if (t) return { name: t.name, rows: t.rows };
  }
  return null;
}

export interface RunSiteProbeOptions {
  /** Only these colleges (unit ids); the file keeps everyone else's entries. */
  ids?: readonly string[];
  /** A spread sample of this many colleges (the same ones every run). */
  sample?: number;
  /** Only colleges whose current entry has no visit page (with a picker, the scorer's misses). */
  missing?: boolean;
  /** Colleges probed at a time (default 32). Requests to one host stay one a second whatever this is. */
  concurrency?: number;
  picker?: VisitPicker | null;
  /** The schools to probe: sync-data passes the ones it just wrote; default `root`/data/schools.json. */
  schools?: readonly School[];
  /** IPEDS directory rows by unit id: sync-data passes its own; default the cached HD file, else none. */
  hdRows?: ReadonlyMap<string, Record<string, string>> | null;
  http?: ProbeHttp & { blockedSeen?: () => { host: string }[] };
  /** Confirms missing hosts (default: the system resolver, a few tries; tests pass a fake). */
  hosts?: HostLookup;
  today?: string;
  log?: (msg: string) => void;
  /** Re-apply identity to data/schools.json afterwards (default true). */
  merge?: boolean;
}

/**
 * Probes the colleges, writes data/site-probe.json (this run's entries over the file's) and data/link-issues.json
 * (`nextLinkIssues`), then runs `mergeIdentity`, so the visit pages and nulled links reach data/schools.json in the same
 * change. Returns the run's summary.
 */
export async function runSiteProbe(root: string, opts: RunSiteProbeOptions = {}): Promise<ProbeSummary> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const probePath = join(root, "data", "site-probe.json");
  const issuesPath = join(root, "data", "link-issues.json");
  const schools: readonly School[] = opts.schools ?? JSON.parse(readFileSync(join(root, "data", "schools.json"), "utf8"));
  const datasetIds = new Set(schools.map((s) => s.unit_id));
  const previous = readJson<SiteProbeEntry[]>(probePath, []);

  let chosen = [...schools];
  if (opts.ids?.length) {
    const want = new Set(opts.ids);
    chosen = chosen.filter((s) => want.has(s.unit_id));
  }
  if (opts.missing) {
    const withVisit = new Set(previous.filter((e) => e.visit).map((e) => e.unit_id));
    chosen = chosen.filter((s) => !withVisit.has(s.unit_id));
  }
  if (opts.sample) chosen = spreadSample(chosen, opts.sample);

  let hdRows = opts.hdRows ?? null;
  if (opts.hdRows === undefined) {
    const hd = await cachedDirectory(root, datasetIds);
    if (hd) log(`  links from ${hd.name} (cached) and data/schools.json`);
    else log("  no cached IPEDS HD file: probing the links in data/schools.json only (npm run sync-data -- --links reads HD itself)");
    hdRows = hd?.rows ?? null;
  }
  const targets = chosen.map((s) => probeTarget(s, hdRows?.get(s.unit_id)));

  const quiet: string[] = [];
  const http = opts.http ?? new PoliteHttp({ fetch: globalThis.fetch, now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), minDelayMs: 1000, log: (m) => void quiet.push(m), timeoutMs: 30_000, maxBytes: 10 * 1024 * 1024 });
  const ctx = probeContext(http, today, opts.picker, opts.hosts ?? systemHostLookup());
  const started = Date.now();
  const results: (SiteProbeEntry | undefined)[] = new Array(targets.length);
  let next = 0;
  let done = 0;
  const workers = Math.max(1, Math.min(opts.concurrency ?? 32, targets.length));
  log(`Probing ${targets.length} colleges, ${workers} at a time…`);
  // Once every college has started, say each minute which are still running, so a slow host is named, not guessed.
  const running = new Set<string>();
  const watchdog = setInterval(() => {
    if (next >= targets.length && running.size) log(`  still probing ${running.size}: ${[...running].slice(0, 20).join(", ")}`);
  }, 60_000);
  watchdog.unref();
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < targets.length) {
        const i = next++;
        running.add(targets[i].unit_id);
        try {
          results[i] = await probeCollege(ctx, targets[i]);
        } catch (err) {
          // A bug must not cost the whole run: the college keeps its previous entry.
          log(`  ${targets[i].unit_id}: probe failed (${err instanceof Error ? err.message : err}); previous entry kept`);
        }
        running.delete(targets[i].unit_id);
        done++;
        if (done % 100 === 0 || done === targets.length) {
          const visits = results.filter((e) => e?.visit).length;
          log(`  ${done}/${targets.length} (${Math.round((Date.now() - started) / 1000)} s): visit pages ${visits}`);
        }
      }
    }),
  );
  clearInterval(watchdog);
  const entries = results.filter((e): e is SiteProbeEntry => !!e);

  writeFileSync(probePath, formatRows(mergeProbeEntries(previous, entries, datasetIds)));
  const issues = nextLinkIssues(readJson<LinkIssue[]>(issuesPath, []).filter((i) => datasetIds.has(i.unit_id)), entries, today);
  writeFileSync(issuesPath, formatRows(issues));
  const blockedHosts = new Set((http.blockedSeen?.() ?? []).map((b) => b.host)).size;
  const summary = summarize(entries, { seconds: Math.round((Date.now() - started) / 1000), blockedHosts, issues, picker: opts.picker ?? null });
  log(`  wrote data/site-probe.json (${entries.length} probed) and data/link-issues.json (${issues.length} issues, ${summary.issues.dead} links null after ${FAILURES_TO_NULL} failed runs)`);
  if (opts.merge !== false) {
    const merged = mergeIdentity(root);
    log(`  identity re-applied: ${merged.withVisit} colleges with a visit page`);
  }
  return summary;
}
