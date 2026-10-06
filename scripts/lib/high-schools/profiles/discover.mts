/**
 * Finding a high school's profile (CCD has no website column). A ladder like the college-reported engine's
 * (scripts/lib/college-reported/discovery.mts), cheapest first, stopping at the first confirmed profile:
 *
 *   0 known    the recipe's profile URL, fetched conditionally (a 304 or the same hash skips the model)
 *   1 scan     free: the recipe's school site and pages, and their links one level down to counseling / college pages;
 *              a link that reads like a profile (PDF, Drive file, or page) is fetched and gated (document.mts)
 *   2 seeds    candidate URLs from outside the pipeline (the owner, or a hand search; `--seeds`), confirmed the same way
 *   3 search   paid: Sonnet with web search only (≤ 2 searches, no fetch) returns candidate links on the school's or
 *              district's own site; our code fetches and gates them, and scans a returned site or counseling page
 *   4 picker   paid: Haiku picks the profile link from the links of the pages already fetched
 *
 * Every request goes through PoliteHttp (robots.txt, per-host delays, our own user agent, no retries past refusals).
 * A Drive share link is rewritten to its direct download (college-reported probe.mts). Findability is recorded per
 * school: the step that found it and the kind of host it sat on.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { findLinks, type FoundLink } from "../../college-reported/documents.mts";
import { rewriteShareLink } from "../../college-reported/probe.mts";
import { sha256 } from "../../college-reported/http.mts";
import type { ModelClient } from "../../college-reported/models.mts";
import { estimateTokens } from "../../college-reported/llm.mts";
import { looksLikeProfile, readProfileDocument, type ProfileDocument, type ProfileGate } from "./document.mts";
import { PROFILE_MODELS } from "./extract.mts";
import { worstCaseUsd, type SpendCap } from "./budget.mts";

export type FoundVia = "known" | "scan" | "seed" | "search" | "picker";
export type HostKind = "school-site" | "district-site" | "file-host" | "other";

export interface Attempt {
  step: FoundVia;
  at: string;
  result: "found" | "none" | "unchanged" | "failed" | "skipped" | "blocked";
  detail?: string;
  cost_usd?: number;
}

/** One school's entry in data/high-schools/profile-recipes.json. */
export interface ProfileRecipe {
  id: string;
  name: string;
  profile?: {
    url: string;
    format: "pdf" | "html";
    etag?: string;
    last_modified?: string;
    hash: string;
    edition?: string | null;
    checked: string;
  };
  /** The school's homepage, once known (a search result or the profile's own host). */
  site?: string;
  /** Pages that link the profile (re-scanned for next year's link). */
  pages?: string[];
  found_via?: FoundVia;
  host_kind?: HostKind;
  tried: Attempt[];
  none_found?: true;
  /** Free text: what the school publishes (e.g. "profile behind a counselor login"). */
  notes?: string;
}

export interface RecipesFile {
  updated: string;
  recipes: Record<string, ProfileRecipe>;
}

/** The polite client's slice discovery uses (PoliteHttp fits; tests pass a fake). */
export interface DiscoverHttp {
  get(url: string, conditional?: { etag?: string; last_modified?: string }): Promise<Response | null>;
}

export interface DiscoverSchool {
  id: string;
  name: string;
  city: string | null;
  state: string;
  district: string | null;
  kind: "public" | "private";
}

export interface Found {
  url: string;
  via: FoundVia;
  doc: ProfileDocument;
  bytes: Uint8Array;
  hash: string;
  etag?: string;
  last_modified?: string;
  page?: string;
  gate: ProfileGate;
}

export interface DiscoverResult {
  found: Found | null;
  /** Step 0 answered 304 or the same hash: the processed copy is current. */
  unchanged: boolean;
  recipe: ProfileRecipe;
  requests: number;
  cost_usd: number;
  /** Not found, but candidates robots.txt disallows were located (the profile exists; we may not fetch it). */
  blocked: string[];
}

/* ------------------------------------------------------------------ */
/* Links that read like a profile                                       */
/* ------------------------------------------------------------------ */

const PROFILE_LINK = /school[\s_-]*profile|profile[\s_-]*(?:20\d\d|\d\d[\s_-]?\d\d)|(?:20\d\d|class)[\s_-]*(?:of[\s_-]*20\d\d[\s_-]*)?profile|college[\s_-]*profile|counsel\w*[\s_-]*profile|\bprofile\b/i;
const NOT_PROFILE = /tableau|psal\.org|athlet|staff|teacher|alumni|donor|faculty|student[\s_-]*profile|grad(?:uate)?[\s_-]*profile|portrait|linkedin|facebook|instagram|twitter|youtube|login|signin|sign-in|edit[\s_-]*profile|my[\s_-]*profile|user[\s_-]*profile|parent[\s_-]*profile/i;
const SUBPAGE = /counsel|college|guidance|career|post[\s_-]*secondary|academics|school[\s_-]*profile|about|admission/i;

export function isProfileLink(l: FoundLink): boolean {
  const hay = `${decodeURIComponent(l.url)} ${l.text}`;
  return PROFILE_LINK.test(hay) && !NOT_PROFILE.test(hay);
}

/** Links worth one more fetch while scanning a school's site: same site, counseling / college / about pages. */
export function isSubpageLink(l: FoundLink, base: string): boolean {
  let u: URL;
  try {
    u = new URL(l.url);
  } catch {
    return false;
  }
  if (registrable(u.host) !== registrable(new URL(base).host)) return false;
  if (/\.(pdf|docx?|xlsx?|jpg|png|zip)($|\?)/i.test(u.pathname)) return false;
  return SUBPAGE.test(`${decodeURIComponent(u.pathname)} ${l.text}`) && !NOT_PROFILE.test(l.text);
}

const WEBSITE_TEXT = /^(?:visit )?(?:the |our )?(?:school(?:'s)? )?(?:web ?site|home ?page)$|^official (?:web ?site|site)$/i;

/** A directory page's link to the school's own site: text like "School Website", on another site. */
export function isWebsiteLink(l: FoundLink, base: string): boolean {
  try {
    return WEBSITE_TEXT.test(l.text.trim()) && registrable(new URL(l.url).host) !== registrable(new URL(base).host);
  } catch {
    return false;
  }
}

/** "www.lausd.org" → "lausd.org"; "fhs.fortworthisd.net" → "fortworthisd.net"; keeps k12.xx.us style hosts whole. */
export function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length >= 4 && parts[parts.length - 1] === "us") return parts.slice(-4).join(".");
  return parts.slice(-2).join(".");
}

const FILE_HOSTS = /(^|\.)(drive\.google\.com|docs\.google\.com|amazonaws\.com|finalsite\.net|edlio\.com|edlioschool\.com|schoolwires\.net|cmsv2\.com|smartsitecms\.com|squarespace(?:-cdn)?\.com|wp\.com|blackbaud\.com|myschoolapp\.com|box\.com|sharepoint\.com|dropbox\.com|thrillshare\.com|apptegy\.net|core-docs\.s3\.amazonaws\.com|cdn\.\w+\.com)$/i;
const DISTRICT_HOST = /isd\.|usd\.|unified|k12\.|schools\.nyc\.gov|lausd|cisd\.|\.k12\.|district|publicschools|\bps\./i;

export function hostKind(url: string, school: Pick<DiscoverSchool, "kind">, site?: string): HostKind {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return "other";
  }
  if (FILE_HOSTS.test(host)) return "file-host";
  if (site && registrable(new URL(site).host) === registrable(host)) {
    return school.kind === "public" && DISTRICT_HOST.test(host) ? "district-site" : "school-site";
  }
  if (school.kind === "public" && DISTRICT_HOST.test(host)) return "district-site";
  return "school-site";
}

/* ------------------------------------------------------------------ */
/* Fetching and confirming                                              */
/* ------------------------------------------------------------------ */

interface Ctx {
  http: DiscoverHttp;
  school: DiscoverSchool;
  log: (m: string) => void;
  requests: number;
  /** URLs already fetched this run for this school (never twice). */
  seen: Set<string>;
  /** Links of the pages fetched (the picker reads them). */
  links: FoundLink[];
  /** Candidate documents robots.txt keeps us from (located, never fetched). */
  blocked: string[];
}

/** A profile link named strictly enough to count as located when we may not fetch it ("School Profile", "Profile 2025-26"). */
const STRICT_PROFILE = /school[\s_-]*profile|college[\s_-]*profile|counsel\w*[\s_-]*profile|profile[\s_-]*(?:for[\s_-]*the[\s_-]*)?(?:class|20\d\d|\d\d[\s_-]\d\d)|(?:20\d\d|class[\s_-]*of[\s_-]*20\d\d)[\s_-]*(?:school[\s_-]*)?profile/i;
export const isStrictProfile = (hay: string) => STRICT_PROFILE.test(hay) && !NOT_PROFILE.test(hay);
/** Document viewers with no file behind a plain GET (Issuu, Flipsnack, Scribd). */
const VIEWER_ONLY = /^https?:\/\/(?:www\.)?(?:issuu\.com|flipsnack\.com|scribd\.com|online\.flipbuilder\.com)\//i;

const ROBOTS_ERROR = "robots.txt disallows it (or the host didn't answer)";

async function fetchBytes(c: Ctx, url: string, conditional?: { etag?: string; last_modified?: string }): Promise<{ res: Response; bytes: Uint8Array } | { error: string }> {
  c.requests++;
  let res: Response | null;
  try {
    res = await c.http.get(url, conditional);
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
  }
  if (!res) return { error: ROBOTS_ERROR };
  if (res.status === 304) return { res, bytes: new Uint8Array(0) };
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** Fetches a candidate document and gates it. Drive share links are rewritten to their direct download first. */
export async function confirmProfile(c: Ctx, url: string, via: FoundVia, page?: string, hint = ""): Promise<Found | { error: string; embedded?: FoundLink[] }> {
  if (VIEWER_ONLY.test(url)) {
    if (isStrictProfile(`${decodeURIComponent(url)} ${hint}`) && !c.blocked.includes(url)) c.blocked.push(url);
    return { error: "a viewer page (no file to fetch)" };
  }
  const rw = rewriteShareLink(url);
  if (rw && "manual" in rw) return { error: rw.manual };
  const target = rw && "url" in rw ? rw.url : url;
  if (c.seen.has(target)) return { error: "already tried" };
  c.seen.add(target);
  const got = await fetchBytes(c, target);
  if ("error" in got) {
    if (got.error === ROBOTS_ERROR && isStrictProfile(`${decodeURIComponent(url)} ${hint}`) && !c.blocked.includes(url)) c.blocked.push(url);
    return got;
  }
  let doc: ProfileDocument;
  try {
    doc = await readProfileDocument(got.bytes, got.res.headers.get("content-type") ?? "");
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const gate = looksLikeProfile(doc, c.school.name);
  if (!gate.ok) {
    // A profile page that embeds or links the document (a Google Sites page with a Drive viewer, a page with a PDF link).
    const embedded = doc.format === "html" && gate.name_coverage >= 0.5 ? embeddedDocuments(new TextDecoder().decode(got.bytes), got.res.url || target) : [];
    return { error: `not this school's profile: ${gate.reason}`, embedded };
  }
  return {
    url: target,
    via,
    doc,
    bytes: got.bytes,
    hash: sha256(got.bytes),
    etag: got.res.headers.get("etag") ?? undefined,
    last_modified: got.res.headers.get("last-modified") ?? undefined,
    page,
    gate,
  };
}

/** Documents a page links or embeds: PDF links, and Drive / Docs links or iframes (the profile behind a viewer). */
export function embeddedDocuments(html: string, base: string): FoundLink[] {
  const out: FoundLink[] = [];
  const seen = new Set<string>();
  const push = (href: string, text: string) => {
    let u: string;
    try {
      u = new URL(href, base).toString();
    } catch {
      return;
    }
    if (seen.has(u) || !/^https?:/.test(u)) return;
    if (!/\.pdf($|\?)/i.test(u) && !rewriteShareLink(u) && !/docs\.google\.com\/(?:document|presentation)\//.test(u)) return;
    seen.add(u);
    out.push({ url: u, text });
  };
  for (const m of html.matchAll(/<(?:iframe|embed)\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) push((m[1] ?? m[2]).replace(/&amp;/g, "&"), "embedded");
  for (const l of findLinks(html, base)) push(l.url, l.text);
  // Drive viewer URLs ("/file/d/<id>/preview") resolve through rewriteShareLink; Docs documents export as PDF.
  return out.map((l) => {
    const doc = /^(https:\/\/docs\.google\.com\/(?:document|presentation)\/d\/[\w-]+)/.exec(l.url);
    return doc ? { ...l, url: `${doc[1]}/export?format=pdf` } : l;
  });
}

/** Fetches a page and returns its links (also kept for the picker). */
async function pageLinks(c: Ctx, url: string): Promise<{ links: FoundLink[]; embedded: FoundLink[] } | { error: string }> {
  if (c.seen.has(url)) return { links: [], embedded: [] };
  c.seen.add(url);
  const got = await fetchBytes(c, url);
  if ("error" in got) return got;
  const ct = got.res.headers.get("content-type") ?? "";
  const html = new TextDecoder().decode(got.bytes);
  if (!/html/i.test(ct) && !/<html|<a\s/i.test(html.slice(0, 4096))) return { links: [], embedded: [] };
  const base = got.res.url || url;
  const links = findLinks(html, base);
  c.links.push(...links);
  return { links, embedded: embeddedDocuments(html, base) };
}

/**
 * Scans pages for a profile link: each start page, then up to `subpages` same-site counseling/college pages it links.
 * Returns the first confirmed profile, or null. A start page that is itself a PDF is confirmed directly.
 */
export async function scanPages(c: Ctx, starts: readonly string[], o: { subpages?: number; via?: FoundVia } = {}): Promise<Found | null> {
  const via = o.via ?? "scan";
  let budget = o.subpages ?? 6;
  const queue = [...starts];
  // Start pages, plus a school's own site reached from a directory page ("School Website" on a district or DOE page).
  const startSet = new Set(starts);
  const tryLinks = async (links: FoundLink[], page: string) => {
    for (const l of links.filter((x) => isProfileLink(x) && x.url !== page).slice(0, 4)) {
      const r = await confirmProfile(c, l.url, via, page, l.text);
      if (!("error" in r)) return r;
      c.log(`    ${l.url}: ${r.error}`);
      for (const e of (r.embedded ?? []).slice(0, 3)) {
        const r2 = await confirmProfile(c, e.url, via, l.url, `${e.text} ${l.text} ${l.url}`);
        if (!("error" in r2)) return r2;
        c.log(`    ${e.url}: ${r2.error}`);
      }
    }
    return null;
  };
  for (let i = 0; i < queue.length; i++) {
    const page = queue[i];
    if (/\.pdf($|\?)/i.test(page) || rewriteShareLink(page)) {
      const r = await confirmProfile(c, page, via);
      if (!("error" in r)) return r;
      continue;
    }
    const got = await pageLinks(c, page);
    if ("error" in got) {
      c.log(`    ${page}: ${got.error}`);
      continue;
    }
    const links = got.links;
    // A page whose own address reads like a profile page: try the documents it embeds or links first.
    if (isProfileLink({ url: page, text: "" })) {
      for (const e of got.embedded.slice(0, 3)) {
        const r = await confirmProfile(c, e.url, via, page, `${e.text} ${page}`);
        if (!("error" in r)) return r;
        c.log(`    ${e.url}: ${r.error}`);
      }
    }
    const hit = await tryLinks(links, page);
    if (hit) return hit;
    if (startSet.has(page)) {
      for (const l of links.filter((x) => isWebsiteLink(x, page)).slice(0, 1)) {
        if (queue.includes(l.url)) continue;
        queue.push(l.url);
        startSet.add(l.url);
      }
      for (const l of links.filter((l) => isSubpageLink(l, page))) {
        if (budget <= 0) break;
        if (queue.includes(l.url)) continue;
        queue.push(l.url);
        budget--;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Paid steps                                                           */
/* ------------------------------------------------------------------ */

export const SEARCH_LIMITS = { searches: 2, turns: 4, maxTokens: 3000 } as const;

export interface SearchCandidate {
  kind: "profile" | "site" | "counseling";
  url: string;
}

const CANDIDATES_TOOL: Anthropic.Tool = {
  name: "save_candidates",
  description: "Record candidate links for this high school's profile. Call it exactly once, when done searching.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "none_found"],
    properties: {
      candidates: {
        type: "array",
        description: "At most five links from the search results, best first",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "url"],
          properties: { kind: { type: "string", enum: ["profile", "site", "counseling"] }, url: { type: "string" } },
        },
      },
      none_found: { type: "boolean" },
    },
  },
};

export const SEARCH_SYSTEM = `You find candidate links for a U.S. high school's "school profile": the one-to-four page document (usually a PDF) a high school's counseling office sends to colleges, with its grading scale, GPA distribution, AP/IB courses, test scores, and where graduates enrolled. Search the web at most twice. Do not open pages: the search results' URLs and titles are enough. Use only the school's own website, its district's website, or a file either of them hosts (including Google Drive links they publish); never third-party sites (Niche, GreatSchools, US News, Scribd, test-prep companies). When done, call save_candidates exactly once with up to five links, best first: the profile document itself (kind "profile"), the school's homepage (kind "site"), or its counseling / college center page (kind "counseling"). If nothing fits, call it with none_found true.`;

export function searchParams(messages: Anthropic.MessageParam[], searchesLeft: number, model: string = PROFILE_MODELS.search): Anthropic.MessageStreamParams {
  return {
    model,
    max_tokens: SEARCH_LIMITS.maxTokens,
    system: SEARCH_SYSTEM,
    output_config: { effort: "low" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: Math.max(1, Math.min(SEARCH_LIMITS.searches, searchesLeft)) }, CANDIDATES_TOOL],
    messages,
  };
}

/** Step 3: candidate links from web search (Sonnet 5, ≤ 2 searches, no fetch), every turn under the spend cap. */
export async function searchCandidates(client: ModelClient, cap: SpendCap, school: DiscoverSchool): Promise<{ candidates: SearchCandidate[]; cost: number; searches: number }> {
  const model = PROFILE_MODELS.search;
  const user = [
    `High school: ${school.name}`,
    `Location: ${school.city ?? "?"}, ${school.state}`,
    school.district ? `District: ${school.district}` : `Private school`,
  ].join("\n");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  let searches = 0;
  let cost = 0;
  let nudged = false;
  for (let turn = 0; turn < SEARCH_LIMITS.turns; turn++) {
    const left = SEARCH_LIMITS.searches - searches;
    // Search results come back as input: allow ~25 K tokens a turn in the worst case.
    const worst = worstCaseUsd(model, 25_000 + estimateTokens(JSON.stringify(messages).length), SEARCH_LIMITS.maxTokens, Math.max(0, left));
    const { result: res, cost: c } = await cap.run({ school: school.id, job: "search", model, worst }, () => client.messages.stream(searchParams([...messages], left, model), { signal: AbortSignal.timeout(6 * 60 * 1000) }).finalMessage());
    cost += c;
    searches += res.usage?.server_tool_use?.web_search_requests ?? 0;
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === CANDIDATES_TOOL.name);
    if (call) {
      const input = call.input as { candidates?: SearchCandidate[]; none_found?: boolean };
      return { candidates: (input.candidates ?? []).filter((x) => /^https?:\/\//.test(x.url)).slice(0, 5), cost, searches };
    }
    if (res.stop_reason === "refusal") break;
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn" && searches < SEARCH_LIMITS.searches) continue;
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Call save_candidates now with the links you found (none_found: true if none fit)." });
  }
  return { candidates: [], cost, searches };
}

const PICKER_SYSTEM = `You pick one link for a program that downloads U.S. high schools' "school profile" documents (the PDF a counseling office sends to colleges with the grading scale, courses, test scores, and college list). You get a numbered list of links found on the school's own pages. Answer with the number of the link to the newest school profile, or leave "profile" out when no link fits. Choose only from the list.`;
const PICKER_SCHEMA = { type: "object", additionalProperties: false, properties: { profile: { type: "integer" } } } as const;

/** Step 4: Haiku reads the fetched pages' links and names the profile link, if any. */
export async function pickProfileLink(client: ModelClient, cap: SpendCap, school: DiscoverSchool, links: readonly FoundLink[]): Promise<{ url: string | null; cost: number }> {
  const model = PROFILE_MODELS.picker;
  const uniq: FoundLink[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const l of links) {
    if (seen.has(l.url) || NOT_PROFILE.test(`${l.url} ${l.text}`)) continue;
    const row = `${uniq.length + 1} | ${l.text.replace(/\s+/g, " ").slice(0, 100)} | ${l.url}`;
    if (chars + row.length > 14_000) break;
    seen.add(l.url);
    uniq.push(l);
    chars += row.length + 1;
  }
  if (!uniq.length) return { url: null, cost: 0 };
  const user = `High school: ${school.name} (${school.city ?? "?"}, ${school.state})\n\nLinks:\n${uniq.map((l, i) => `${i + 1} | ${l.text.replace(/\s+/g, " ").slice(0, 100)} | ${l.url}`).join("\n")}`;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 64,
    system: PICKER_SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: PICKER_SCHEMA as unknown as Record<string, unknown> } },
  };
  const worst = worstCaseUsd(model, estimateTokens(PICKER_SYSTEM.length + user.length) * 1.3, 64);
  const { result, cost } = await cap.run({ school: school.id, job: "picker", model, worst }, () => client.messages.create(params));
  const text = result.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  try {
    const n = (JSON.parse(text) as { profile?: unknown }).profile;
    if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= uniq.length) return { url: uniq[n - 1].url, cost };
  } catch {
    // no answer
  }
  return { url: null, cost };
}

/* ------------------------------------------------------------------ */
/* The ladder                                                           */
/* ------------------------------------------------------------------ */

export interface DiscoverDeps {
  http: DiscoverHttp;
  log: (m: string) => void;
  today: string;
  /** Paid steps run only with a client and a cap. */
  client?: ModelClient;
  cap?: SpendCap;
  /** Candidate URLs from outside the pipeline for this school (step 2). */
  seeds?: string[];
  /** Skip the paid steps (a free run). */
  free?: boolean;
}

export async function discoverProfile(school: DiscoverSchool, recipe: ProfileRecipe | undefined, deps: DiscoverDeps): Promise<DiscoverResult> {
  const r: ProfileRecipe = recipe ? structuredClone(recipe) : { id: school.id, name: school.name, tried: [] };
  r.name = school.name;
  const c: Ctx = { http: deps.http, school, log: deps.log, requests: 0, seen: new Set(), links: [], blocked: [] };
  let cost = 0;
  const row = (step: FoundVia, result: Attempt["result"], detail?: string, usd?: number) =>
    r.tried.push({ step, at: deps.today, result, ...(detail ? { detail: detail.slice(0, 300) } : {}), ...(usd ? { cost_usd: Math.round(usd * 10000) / 10000 } : {}) });
  const done = (found: Found | null, unchanged = false): DiscoverResult => {
    if (found) {
      r.profile = {
        url: found.url,
        format: found.doc.format,
        ...(found.etag ? { etag: found.etag } : {}),
        ...(found.last_modified ? { last_modified: found.last_modified } : {}),
        hash: found.hash,
        edition: r.profile?.url === found.url ? r.profile.edition : null,
        checked: deps.today,
      };
      r.found_via = found.via === "known" ? (r.found_via ?? "known") : found.via;
      if (found.page && !(r.pages ?? []).includes(found.page)) r.pages = [...(r.pages ?? []), found.page].slice(-3);
      r.host_kind = hostKind(found.url, school, r.site);
      delete r.none_found;
    } else if (!unchanged) {
      r.none_found = true;
      if (c.blocked.length) r.notes = `robots.txt disallows the profile candidate(s): ${c.blocked.slice(0, 3).join(" ")}`;
    }
    r.tried = r.tried.slice(-12);
    return { found, unchanged, recipe: r, requests: c.requests, cost_usd: cost, blocked: found ? [] : [...c.blocked] };
  };

  // 0. Known.
  if (r.profile?.url) {
    const got = await fetchBytes(c, r.profile.url, { etag: r.profile.etag, last_modified: r.profile.last_modified });
    c.seen.add(r.profile.url);
    if (!("error" in got) && got.res.status === 304) {
      row("known", "unchanged");
      r.profile.checked = deps.today;
      return done(null, true);
    }
    if (!("error" in got)) {
      const hash = sha256(got.bytes);
      if (hash === r.profile.hash) {
        row("known", "unchanged", "same bytes");
        r.profile.checked = deps.today;
        return done(null, true);
      }
      try {
        const doc = await readProfileDocument(got.bytes, got.res.headers.get("content-type") ?? "");
        const gate = looksLikeProfile(doc, school.name);
        if (gate.ok) {
          row("known", "found", "changed");
          return done({ url: r.profile.url, via: "known", doc, bytes: got.bytes, hash, etag: got.res.headers.get("etag") ?? undefined, last_modified: got.res.headers.get("last-modified") ?? undefined, gate });
        }
        row("known", "none", gate.reason);
      } catch (err) {
        row("known", "failed", err instanceof Error ? err.message : String(err));
      }
    } else row("known", "failed", got.error);
  }

  // 1. Scan the school's known pages.
  const starts = [...(r.pages ?? []), ...(r.site ? [r.site] : [])];
  if (starts.length) {
    const hit = await scanPages(c, starts);
    row("scan", hit ? "found" : "none", hit?.url);
    if (hit) return done(hit);
  }

  // 2. Seeds.
  if (deps.seeds?.length) {
    const profiles = deps.seeds.filter((u) => /\.pdf($|\?)/i.test(u) || rewriteShareLink(u));
    const pages = deps.seeds.filter((u) => !profiles.includes(u));
    let hit: Found | null = null;
    for (const u of profiles) {
      const got = await confirmProfile(c, u, "seed");
      if (!("error" in got)) {
        hit = got;
        break;
      }
      deps.log(`    seed ${u}: ${got.error}`);
    }
    if (!hit && pages.length) hit = await scanPages(c, pages, { via: "seed" });
    if (!r.site) r.site = pages[0] ? new URL(pages[0]).origin + "/" : undefined;
    if (!r.site) delete r.site;
    row("seed", hit ? "found" : "none", hit?.url ?? deps.seeds.join(" "));
    if (hit) return done(hit);
  }

  if (deps.free || !deps.client || !deps.cap) return done(null);

  // 3. Search.
  try {
    const s = await searchCandidates(deps.client, deps.cap, school);
    cost += s.cost;
    const isDoc = (u: string) => /\.pdf($|\?)/i.test(u) || !!rewriteShareLink(u);
    const profiles = s.candidates.filter((x) => x.kind === "profile" && isDoc(x.url)).map((x) => x.url);
    const pages = s.candidates.filter((x) => !profiles.includes(x.url)).map((x) => x.url);
    const site = s.candidates.find((x) => x.kind === "site");
    if (site && !r.site) r.site = site.url;
    let hit: Found | null = null;
    for (const u of profiles) {
      const got = await confirmProfile(c, u, "search");
      if (!("error" in got)) {
        hit = got;
        break;
      }
      deps.log(`    search ${u}: ${got.error}`);
    }
    if (!hit && pages.length) hit = await scanPages(c, pages, { via: "search" });
    row("search", hit ? "found" : "none", hit?.url ?? (s.candidates.map((x) => x.url).join(" ") || "no candidates"), s.cost);
    if (hit) return done(hit);
  } catch (err) {
    if ((err as Error).name === "SpendCapReached") throw err;
    row("search", "failed", err instanceof Error ? err.message : String(err));
    return done(null);
  }

  // 4. Picker over the links of the pages fetched.
  if (c.links.length) {
    try {
      const p = await pickProfileLink(deps.client, deps.cap, school, c.links);
      cost += p.cost;
      if (p.url) {
        const got = await confirmProfile(c, p.url, "picker");
        row("picker", "error" in got ? "none" : "found", "error" in got ? `${p.url}: ${got.error}` : p.url, p.cost);
        if (!("error" in got)) return done(got);
      } else row("picker", "none", "no link fits", p.cost);
    } catch (err) {
      if ((err as Error).name === "SpendCapReached") throw err;
      row("picker", "failed", err instanceof Error ? err.message : String(err));
    }
  }
  return done(null);
}
