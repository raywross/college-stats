/**
 * Finding a college's essay prompts page (specs/product/essays/prompts.md "Sources"), cheapest first, stopping at the
 * first page that reads like one:
 *   1. the recipe's page from an earlier run (data/essay-prompts/pages.json);
 *   2. the admissions and apply links the dataset already holds (`links.apply`, `links.admissions`), and the essay
 *      links on those pages, best first (`rankLinks`);
 *   3. well-known paths on the admissions host (`/apply/essays`, `/admission/essay-prompts`, …);
 *   4. the site's own index: the `Sitemap:` files its robots.txt names, filtered to essay URLs (the engine's sitemap
 *      step, scripts/lib/college-reported/probe.mts);
 *   5. one cheap model call (Haiku) picking among the links found on the pages fetched so far.
 * Every request goes through the engine's PoliteHttp (robots.txt, pacing, the honest user agent). The model never
 * fetches; it only picks a number from a list of links we found. Pure apart from the injected http and client.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { ROUND3_MODELS } from "../../../lib/reported.ts";
import type { School } from "../../../lib/types.ts";
import { detectFormat, findLinks, htmlToText, safeDecodeUri, type FoundLink } from "../college-reported/documents.mts";
import { estimateTokens } from "../college-reported/llm.mts";
import type { ModelClient } from "../college-reported/models.mts";
import { parseSitemap } from "../college-reported/probe.mts";
import { toWellFormedDeep } from "../college-reported/well-formed.mts";
import { worstCaseUsd, type SpendCap } from "../high-schools/profiles/budget.mts";
import type { FoundVia, PageRecipe } from "./store.mts";

/** Paths colleges use for the page, tried on each admissions host in this order. */
export const ESSAY_PATHS = [
  "/apply/essays",
  "/apply/essay-prompts",
  "/apply/supplemental-essays",
  "/apply/writing-supplement",
  "/admission/essay-prompts",
  "/admission/essays",
  "/admissions/essays",
  "/admissions/essay-prompts",
  "/admissions/supplemental-essays",
  "/admissions/first-year/essays",
  "/admissions/apply/essays",
  "/undergraduate-admissions/essays",
  "/writing-supplement",
  "/essays",
] as const;

/**
 * Request limits per college: pages fetched in all (the well-known paths stop `reserve` short, leaving room for the
 * sitemap and the picker's page), links followed from a page, sitemap files read, links shown to the picker.
 */
export const DISCOVER_LIMITS = { requests: 40, reserve: 8, follow: 4, sitemaps: 3, pickerLinks: 300 } as const;

/** Words that mark a link (its text or URL) as the essay page. */
const STRONG = /essay[\s_-]*(prompt|question|topic)s?|supplement(al)?[\s_-]*(essay|question|writing)s?|writing[\s_-]*supplement|short[\s_-]*answer[\s_-]*(question|prompt)s?|member[\s_-]*questions/i;
const ESSAY_WORD = /\bessays?\b|supplement|short[\s_-]*answer/i;
const APPLY_WORD = /apply|application|requirement|first[\s_-]*year|freshman|how[\s_-]*to/i;
/** Links that talk about essays but aren't the college's prompts. */
const NOT_PROMPTS = /blog|news|\bstor(y|ies)\b|event|podcast|webinar|tips?\b|advice|how[\s_-]*to[\s_-]*write|examples?|essays[\s_-]*that[\s_-]*worked|that[\s_-]*worked|magazine|faculty|course|catalog|library|scholarship|graduate|transfer[\s_-]*credit|\.(jpg|png|gif|mp4)($|\?)/i;

/**
 * How strongly a link points to the essay prompts page. 0 = don't follow. A link whose text or URL names essay prompts
 * or a writing supplement scores highest; "essays" with an apply word next; a page of tips, stories, or a blog never.
 */
export function essayLinkScore(link: FoundLink): number {
  // The link's text and its path, never its host ("admissions.example.edu" names no examples page).
  let path = link.url;
  try {
    const u = new URL(link.url);
    path = u.pathname + u.search;
  } catch {
    // not a URL: score it as written
  }
  const hay = `${link.text} ${safeDecodeUri(path)}`;
  if (NOT_PROMPTS.test(hay)) return 0;
  if (STRONG.test(hay)) return 3 + (/20\d\d/.test(hay) ? 1 : 0);
  if (ESSAY_WORD.test(hay)) return APPLY_WORD.test(hay) ? 2 : 1;
  return 0;
}

/** Links worth following, best first (ties keep page order); duplicates dropped. */
export function rankLinks(links: readonly FoundLink[]): FoundLink[] {
  const seen = new Set<string>();
  return links
    .map((l, i) => ({ l, i, s: essayLinkScore(l) }))
    .filter(({ l, s }) => s > 0 && !seen.has(l.url) && (seen.add(l.url), true))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ l }) => l);
}

/**
 * Whether a page's text reads like a college's essay prompts page: it names essays or short answers and either a
 * limit ("250 words", "100 characters"), several questions, or says there is no supplement. Cheap, before any model.
 */
export function looksLikeEssayPage(text: string): boolean {
  if (!/essay|short[\s-]answer|supplement|writing\s+(section|requirement)/i.test(text)) return false;
  const limit = /\b\d{2,5}\s*(-|–)?\s*(words?|characters?)\b/i.test(text);
  const questions = (text.match(/\?/g) ?? []).length >= 2;
  const none = /(no|not\s+(require|have)\s+(a|any))\s+(supplemental|additional|writing)\s+(essays?|supplement|questions?)|does\s+not\s+require\s+(a\s+)?(supplemental|additional)\s+essay/i.test(text);
  const refers = /(essay|prompt|question)s?[^.]{0,120}(within|inside|in)\s+the\s+(common\s+app(lication)?|coalition|application|[a-z]+\s+application)/i.test(text);
  return limit || questions || none || refers;
}

export interface DiscoverHttp {
  get(url: string, conditional?: { etag?: string; last_modified?: string }): Promise<Response | null>;
  /** The `Sitemap:` URLs in the origin's robots.txt (PoliteHttp.sitemaps). */
  sitemaps?(url: string): Promise<string[]>;
}

export interface FoundPage {
  url: string;
  final_url: string;
  bytes: Uint8Array;
  format: "html" | "pdf";
  via: FoundVia;
  etag?: string;
  last_modified?: string;
  /** True when a conditional GET answered 304 (the recipe's copy is current; `bytes` is empty). */
  unchanged?: boolean;
}

export interface DiscoverResult {
  found: FoundPage | null;
  /** Every URL requested, in order. */
  tried: string[];
  cost: number;
  /** A host that refused us, when one did. */
  blocked?: string;
}

export interface DiscoverDeps {
  http: DiscoverHttp;
  /** For the picker (step 5); without it the ladder stops after step 4. */
  client?: ModelClient;
  cap?: SpendCap;
  log?: (m: string) => void;
}

type DiscoverSchool = Pick<School, "unit_id" | "name" | "links">;

const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

/** The admissions hosts to probe: the apply and admissions links' origins first, then the website's. */
export function startPages(school: DiscoverSchool): string[] {
  const out: string[] = [];
  for (const u of [school.links?.apply, school.links?.admissions, school.links?.website]) {
    if (!u) continue;
    const abs = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    if (origin(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

/** Well-known path URLs on each start page's origin, in ESSAY_PATHS order per origin. */
export function wellKnownUrls(starts: readonly string[]): string[] {
  const origins = [...new Set(starts.map(origin).filter((o): o is string => !!o))];
  return origins.flatMap((o) => ESSAY_PATHS.map((p) => `${o}${p}`));
}

const ESSAY_URL = /essay|supplement|short-answer|writing-requirement/i;

/** Walks the ladder for one college. Never throws on a network error: the URL is noted and the next one tried. */
export async function discoverEssayPage(school: DiscoverSchool, recipe: PageRecipe | undefined, deps: DiscoverDeps): Promise<DiscoverResult> {
  const tried: string[] = [];
  const pageLinks: FoundLink[] = [];
  let cost = 0;
  let blocked: string | undefined;
  const log = deps.log ?? (() => {});

  const fetchPage = async (url: string, via: FoundVia, conditional?: { etag?: string; last_modified?: string }): Promise<{ page: FoundPage; text: string } | null> => {
    if (tried.includes(url) || tried.length >= DISCOVER_LIMITS.requests) return null;
    tried.push(url);
    let res: Response | null;
    try {
      res = await deps.http.get(url, conditional);
    } catch (err) {
      log(`  ${url}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    if (!res) {
      blocked ??= new URL(url).host;
      return null;
    }
    if ([401, 403, 429].includes(res.status)) blocked ??= new URL(url).host;
    const meta = { etag: res.headers.get("etag") ?? undefined, last_modified: res.headers.get("last-modified") ?? undefined };
    if (res.status === 304) return { page: { url, final_url: url, bytes: new Uint8Array(0), format: "html", via, unchanged: true, ...meta }, text: "" };
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const format = detectFormat(bytes, res.headers.get("content-type"), url);
    if (format === "xlsx") return null;
    const final_url = res.url || url;
    if (format === "pdf") return { page: { url, final_url, bytes, format: "pdf", via, ...meta }, text: "" };
    const html = new TextDecoder().decode(bytes);
    pageLinks.push(...findLinks(html, final_url));
    return { page: { url, final_url, bytes, format: "html", via, ...meta }, text: htmlToText(html) };
  };
  const done = (page: FoundPage): DiscoverResult => ({ found: page, tried, cost, ...(blocked ? { blocked } : {}) });
  const accept = (got: { page: FoundPage; text: string } | null) => !!got && (got.page.unchanged || got.page.format === "pdf" || looksLikeEssayPage(got.text));

  // 1. The recipe's page.
  if (recipe?.url) {
    const got = await fetchPage(recipe.url, "recipe", { etag: recipe.etag, last_modified: recipe.last_modified });
    if (got && accept(got)) return done(got.page);
  }

  // 2. The links the dataset holds, and the essay links on them.
  const starts = startPages(school);
  for (const s of starts) {
    const got = await fetchPage(s, "known-link");
    if (got && got.page.format === "html" && STRONG.test(got.text.slice(0, 4000)) && looksLikeEssayPage(got.text)) return done(got.page);
  }
  for (const link of rankLinks(pageLinks).slice(0, DISCOVER_LIMITS.follow)) {
    const got = await fetchPage(link.url, "apply-page-link");
    if (got && accept(got)) return done(got.page);
  }

  // 3. Well-known paths.
  for (const url of wellKnownUrls(starts)) {
    if (tried.length >= DISCOVER_LIMITS.requests - DISCOVER_LIMITS.reserve) break;
    const got = await fetchPage(url, "well-known-path");
    if (got && accept(got)) return done(got.page);
  }

  // 4. The site's sitemaps.
  if (deps.http.sitemaps) {
    const origins = [...new Set(starts.map(origin).filter((o): o is string => !!o))];
    const maps: string[] = [];
    for (const o of origins) maps.push(...(await deps.http.sitemaps(o).catch(() => [] as string[])));
    const locs: FoundLink[] = [];
    for (const m of maps.slice(0, DISCOVER_LIMITS.sitemaps)) {
      if (tried.length >= DISCOVER_LIMITS.requests) break;
      tried.push(m);
      try {
        const res = await deps.http.get(m);
        if (!res?.ok) continue;
        const { index, locs: entries } = parseSitemap(await res.text());
        if (index) continue;
        for (const u of entries) if (ESSAY_URL.test(u)) locs.push({ url: u, text: "" });
      } catch {
        continue;
      }
    }
    for (const link of rankLinks(locs).slice(0, DISCOVER_LIMITS.follow)) {
      const got = await fetchPage(link.url, "sitemap");
      if (got && accept(got)) return done(got.page);
    }
  }

  // 5. The picker.
  if (deps.client && deps.cap && pageLinks.length) {
    const pick = await pickEssayLink(deps.client, deps.cap, school, pageLinks);
    cost += pick.cost;
    if (pick.url) {
      const got = await fetchPage(pick.url, "picker");
      if (got && accept(got)) return done(got.page);
    }
  }
  return { found: null, tried, cost, ...(blocked ? { blocked } : {}) };
}

/* ------------------------------------------------------------------ */
/* The picker (step 5)                                                 */
/* ------------------------------------------------------------------ */

export const PICKER_MODEL = ROUND3_MODELS.picker;
export const PICKER_MAX_TOKENS = 64;
const PICKER_MAX_CHARS = 14_000;

export const PICKER_SYSTEM = `You pick one link for a program that reads U.S. colleges' published essay prompts for first-year applicants. You get a numbered list of links found on one college's own admissions pages (link text and URL). Answer with the number of the link to the college's own page listing its supplemental essay or short-answer prompts (often called "essay prompts", "writing supplement", or "supplemental questions"), or leave "page" out when no link fits. Never pick essay-writing tips, blogs, student stories, or another organization's page. Choose only from the list.`;
const PICKER_SCHEMA = { type: "object", additionalProperties: false, properties: { page: { type: "integer" } } } as const;

/** The picker's request: the links, deduplicated, capped at about 4 K tokens. */
export function buildPickerRequest(school: Pick<School, "unit_id" | "name">, links: readonly FoundLink[]): { params: Anthropic.MessageCreateParamsNonStreaming; links: FoundLink[] } {
  const uniq: FoundLink[] = [];
  const rows: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const l of links.slice(0, DISCOVER_LIMITS.pickerLinks)) {
    if (seen.has(l.url) || !/^https?:\/\//.test(l.url)) continue;
    const row = `${uniq.length + 1} | ${l.text.replace(/\s+/g, " ").trim().slice(0, 100)} | ${l.url}`;
    if (chars + row.length > PICKER_MAX_CHARS) break;
    seen.add(l.url);
    uniq.push(l);
    rows.push(row);
    chars += row.length + 1;
  }
  const params: Anthropic.MessageCreateParamsNonStreaming = toWellFormedDeep({
    model: PICKER_MODEL,
    max_tokens: PICKER_MAX_TOKENS,
    system: PICKER_SYSTEM,
    messages: [{ role: "user", content: `College: ${school.name} (IPEDS unit ${school.unit_id})\n\nLinks:\n${rows.join("\n")}` }],
    output_config: { format: { type: "json_schema", schema: PICKER_SCHEMA as unknown as Record<string, unknown> } },
  });
  return { params, links: uniq };
}

/** One Haiku call naming the essay page among the links, under the spend cap. A number outside the list is ignored. */
export async function pickEssayLink(client: ModelClient, cap: SpendCap, school: Pick<School, "unit_id" | "name">, links: readonly FoundLink[]): Promise<{ url: string | null; cost: number }> {
  const built = buildPickerRequest(school, links);
  if (!built.links.length) return { url: null, cost: 0 };
  const chars = PICKER_SYSTEM.length + JSON.stringify(built.params.messages).length;
  const worst = worstCaseUsd(PICKER_MODEL, estimateTokens(chars) * 1.3, PICKER_MAX_TOKENS);
  const { result, cost } = await cap.run({ school: school.unit_id, job: "picker", model: PICKER_MODEL, worst }, () => client.messages.create(built.params));
  if (result.stop_reason === "refusal") return { url: null, cost };
  const text = result.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  try {
    const n = (JSON.parse(text) as { page?: unknown }).page;
    if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= built.links.length) return { url: built.links[n - 1].url, cost };
  } catch {
    // no answer
  }
  return { url: null, cost };
}
