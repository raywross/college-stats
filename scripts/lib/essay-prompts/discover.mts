/**
 * Finding a college's essay prompts page (specs/product/essays/prompts.md "Sources"), cheapest first, stopping at the
 * first page that reads like one:
 *   1. the recipe's page from an earlier run (data/essay-prompts/pages.json);
 *   2. the admissions and apply links the dataset already holds (`links.apply`, `links.admissions`), then the
 *      first-year "how to apply" pages they link to (one level deeper, `rankApplyLinks`), and the essay links on all
 *      of those pages, best first (`rankLinks`);
 *   3. well-known paths on the admissions host (`/apply/essays`, `/admission/essay-prompts`, …);
 *   4. the site's own index: the `Sitemap:` files its robots.txt names, filtered to essay URLs (the engine's sitemap
 *      step, scripts/lib/college-reported/probe.mts);
 *   5. one cheap model call (Haiku) picking among the links found on the pages fetched so far.
 * A page any step accepts that says its essays are in the application and prints none (`refersOnly`), or a hub that
 * prints none but names the essay page in a link, is looked past one level first (`take`, `rankDeeperLinks`): Cornell's,
 * Dartmouth's, and UW's "how to apply" pages pointed to the form while their prompts pages sat one link away.
 * Graduate, professional-school, and transfer pages (`isGraduateUrl`, `graduateHeading`) are never fetched or taken:
 * a run took Villanova's law school's "how to apply" page for the college's.
 * Every request goes through the engine's PoliteHttp (robots.txt, pacing, the honest user agent). The model never
 * fetches; it only picks a number from a list of links we found. Pages on a shared application platform
 * (PLATFORM_HOSTS) are never the college's: not fetched, not accepted, not offered. Pure apart from the injected http
 * and client.
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
 * sitemap and the picker's page), links followed from a page, links followed one level past a page that only points
 * to the application (`deeper`), sitemap files read, links shown to the picker.
 */
export const DISCOVER_LIMITS = { requests: 40, reserve: 8, follow: 4, applyFollow: 3, deeper: 3, sitemaps: 3, pickerLinks: 300 } as const;

/* ------------------------------------------------------------------ */
/* Graduate and professional schools                                   */
/* ------------------------------------------------------------------ */

/**
 * A path segment (or a host's first label) naming a graduate or professional school. The reader is for first-year
 * applicants: Villanova's run landed on its law school's "how to apply" page ("Personal Statement … maximum 3 pages")
 * and recorded it as the college's essays.
 */
const GRADUATE_SEGMENT = /^(law|law-?school|school-?of-?law|college-?of-?law|medicine|medical|med|school-?of-?medicine|college-?of-?medicine|medical-?school|business|business-?school|school-?of-?business|nursing|school-?of-?nursing|graduate|grad|gradschool|graduate-?school|graduate-?admissions?|graduate-?studies|graduate-?programs?|mba|phd|doctoral|dentistry|dental|pharmacy|veterinary|vetmed|divinity|seminary|transfer)$/i;
const GRADUATE_HOST = /^(law|med|medicine|mba|business|grad|graduate|gradschool|gradadmissions|nursing|dental|pharmacy)\./i;

/** True for a URL under a graduate or professional school's path or host (or a transfer path): never the page. */
export function isGraduateUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (GRADUATE_HOST.test(u.host)) return true;
  return safeDecodeUri(u.pathname)
    .split("/")
    .map((s) => s.replace(/\.(s?html?|php|aspx?)$/i, ""))
    .some((s) => GRADUATE_SEGMENT.test(s) || /^(transfer|graduate)[_-]|[_-](transfer|graduate)$|[_-](transfer|graduate)[_-]/i.test(s));
}

/** Words in a page's title or heading that name a graduate or professional program. */
const GRADUATE_PROGRAM = /\b(school of law|law school|college of law|J\.?D\.? (program|application)|juris doctor|LL\.?M|M\.?B\.?A\b|graduate (admissions?|school|programs?|studies|applicants?)|medical school|school of medicine|college of medicine|M\.?D\.? program|doctoral|Ph\.?D|master'?s (program|degree|applicants?)|DNP\b|LSAT|GMAT|MCAT)/i;

/**
 * True when a page's title (its first line) or one of its first headings names a graduate or professional program.
 * Only the head of the page: an undergraduate page's menu names the law and business schools too.
 */
export function graduateHeading(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = [lines[0] ?? "", ...lines.filter((l) => l.startsWith("## ")).slice(0, 4)];
  return head.some((l) => GRADUATE_PROGRAM.test(l));
}

/* ------------------------------------------------------------------ */
/* A page that only points to the application                          */
/* ------------------------------------------------------------------ */

/**
 * Words saying the essays live inside the application: "as part of your Common Application, you'll be asked to fill
 * out the Cornell University supplement", "There are five required short-answer questions", "Detailed instructions can
 * be found on the application".
 */
const REFERS_TO_FORM = /\bas part of (your|the) (common |coalition )?app(lication)?\b|\b(with|in|within|on|through) (the|your) (common |coalition )?app(lication)?\b[^.]{0,80}\b(essays?|supplement|questions?|prompts?)|\b(essays?|supplement|questions?|prompts?)\b[^.]{0,120}\b(with|in|within|on|through|part of) (the|your) (common |coalition |online )?app(lication)?\b|\b(fill out|complete|submit)\b[^.]{0,80}\b(writing supplement|supplement(al)? (essays?|questions?)|[A-Z][\w.]* (University|College) (supplement|questions))|\b(\d+|two|three|four|five|six|seven|eight) required (short[\s-]answer |essay |supplemental )?(questions|prompts)\b|\binstructions can be found (on|in) the application\b|\b(applicant|application) portal\b[^.]{0,80}\b(supplement|essays?|questions?)/i;

/** A line that reads like a prompt: a question of eight words or more, or a sentence that starts by asking to write. */
const PROMPT_START = /^(?:-\s*)?(?:(?:prompt|question|option)\s*(?:\d+|[a-h]|one|two|three|four|five|six|seven|eight)\s*[:.)-]\s*|\d{1,2}[.)]\s+|[A-H][.)]\s+)?(?:please\s+|briefly\s+)?(describe|tell us|explain|share|discuss|reflect|recount|introduce yourself|using your|elaborate|imagine|think about|write about|consider)\b/i;

/** A question asked of the applicant ("How will … enable you to contribute?"), not a question the applicant asks. */
const PROMPT_QUESTION = /\b(you|your|yourself)\b/i;
/**
 * An FAQ entry or a form field: first person ("How do I monitor …?", "Can I change my application …?"), a yes/no
 * question about the process ("Do you accept AP …?", "Are you willing to study …?"), or an instruction quoting the
 * form ("Select Yes when asked …").
 */
const FAQ_QUESTION = /\b(I|I.m|my|me|we)\b|^(-\s*)?(do|does|are|is|can|will|when|where|should|may)\b|\b(asked|select|check the box)\b/i;

/**
 * Whether a page prints prompts (cheap, before any model): two prompt-like lines, or one beside a stated limit. Lines
 * that are a link's whole text don't count (a list of FAQ questions, a blog post's title).
 */
export function printsPrompts(text: string, linkTexts: readonly string[] = []): boolean {
  const links = new Set(linkTexts.map((t) => t.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean));
  let n = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("##") || line.length < 40 || line.length > 1500) continue;
    if (links.has(line.replace(/^-\s*/, "").toLowerCase())) continue;
    const words = line.split(/\s+/).length;
    if (words < 8) continue;
    if (PROMPT_START.test(line) || (/\?\s*["”]?$/.test(line) && PROMPT_QUESTION.test(line) && !FAQ_QUESTION.test(line))) n++;
  }
  const limit = /\b\d{2,4}\s*(-|–)?\s*(words?|characters?)\b|\b\d{2,4}-word\b/i.test(text);
  return n >= 2 || (n >= 1 && limit);
}

/** True for a page that says its essays are in the application and prints none of them: worth one more level. */
export function refersOnly(text: string, linkTexts: readonly string[] = []): boolean {
  return REFERS_TO_FORM.test(text) && !printsPrompts(text, linkTexts);
}

/** Words in an anchor (its text or URL) that name the essays, one level past a page that only points to the form. */
const DEEPER_WORD = /\bessays?\b|prompts?\b|writing[\s_-]*(supplement|section|requirement)s?|short[\s_-]*answers?|\bquestions?\b|supplement(al)?[\s_-]*(essay|question|writing)s?/i;

/**
 * Links worth one more fetch past a page that only points to the application, best first: the college's own hosts,
 * never a platform, a graduate or transfer page, tips, or an FAQ; a first-year URL before others.
 */
export function rankDeeperLinks(links: readonly FoundLink[], origins: readonly string[]): FoundLink[] {
  const seen = new Set<string>();
  return links
    .map((l, i) => {
      let path = l.url;
      try {
        const u = new URL(l.url);
        path = u.pathname + u.search;
      } catch {
        // as written
      }
      const hay = `${l.text} ${safeDecodeUri(path)}`;
      let s = essayLinkScore(l);
      if (!s && DEEPER_WORD.test(hay) && !NOT_PROMPTS.test(hay) && !/faq|frequently|ask(ed)? questions|contact|glossary-question/i.test(hay)) s = 1;
      if (s && FIRST_YEAR.test(hay)) s += 0.5;
      return { l, i, s };
    })
    .filter(({ l, s }) => s > 0 && origins.includes(origin(l.url) ?? "") && !isPlatformUrl(l.url) && !isGraduateUrl(l.url) && !seen.has(l.url) && (seen.add(l.url), true))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ l }) => l);
}

/** Words that mark a link as a first-year "how to apply" page: one level deeper, where the essay link usually is. */
const FIRST_YEAR = /first[\s_-]*year|freshm[ae]n|first[\s_-]*time/i;
// Not a bare "apply": every link under /apply/ would qualify, and "Apply now" leads to the portal.
const HOW_TO_APPLY = /how[\s_-]*to[\s_-]*apply|application[\s_-]*(process|requirements|checklist|instructions)|admission[\s_-]*requirements|applying[\s_-]*(as|to)|what[\s_-]*(we|you)[\s_-]*(need|require|look)/i;

/**
 * How strongly a link points to a first-year application page worth fetching for its links (0 = don't). A link that
 * names first-year applicants and applying scores highest; graduate, transfer, and tips pages never.
 */
export function applyLinkScore(link: FoundLink): number {
  if (isGraduateUrl(link.url)) return 0;
  let path = link.url;
  try {
    path = new URL(link.url).pathname;
  } catch {
    // not a URL: score it as written
  }
  const hay = `${link.text} ${safeDecodeUri(path)}`;
  if (NOT_PROMPTS.test(hay) || /(?<!under)graduate|transfer|international|visit|tour|deposit|financial|tuition|housing|faq/i.test(hay)) return 0;
  const fy = FIRST_YEAR.test(hay);
  const how = HOW_TO_APPLY.test(hay);
  if (fy && how) return 3;
  if (fy) return 2;
  if (how) return 1;
  return 0;
}

/** First-year application pages worth one fetch each, best first, on the college's own hosts only. */
export function rankApplyLinks(links: readonly FoundLink[], origins: readonly string[]): FoundLink[] {
  const seen = new Set<string>();
  return links
    .map((l, i) => ({ l, i, s: applyLinkScore(l) }))
    .filter(({ l, s }) => s > 0 && origins.includes(origin(l.url) ?? "") && !isPlatformUrl(l.url) && !seen.has(l.url) && (seen.add(l.url), true))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ l }) => l);
}

/** Words that mark a link (its text or URL) as the essay page. */
const STRONG = /essay[\s_-]*(prompt|question|topic)s?|supplement(al)?[\s_-]*(essay|question|writing)s?|writing[\s_-]*supplement|short[\s_-]*answer[\s_-]*(question|prompt)s?|member[\s_-]*questions/i;
const ESSAY_WORD = /\bessays?\b|supplement|short[\s_-]*answer/i;
const APPLY_WORD = /apply|application|requirement|first[\s_-]*year|freshman|how[\s_-]*to/i;
/**
 * Links that talk about essays but aren't the college's prompts. "graduate" never inside "undergraduate": every link
 * under Villanova's /undergraduate-admission/ scored zero, so the only first-year-looking link left was the law
 * school's "how to apply".
 */
const NOT_PROMPTS = /blog|news|\bstor(y|ies)\b|event|podcast|webinar|tips?\b|advice|how[\s_-]*to[\s_-]*write|examples?|essays[\s_-]*that[\s_-]*worked|that[\s_-]*worked|magazine|faculty|course|catalog|library|scholarship|(?<!under)graduate|\btransfer\b|supplemental[\s_-]*(instruction|pay|funds?|income|insurance|retirement)|tutoring|financial[\s_-]*aid|payroll|human[\s_-]*resources|stipend|comptroller|contest|\.(jpg|png|gif|mp4)($|\?)/i;

/**
 * How strongly a link points to the essay prompts page. 0 = don't follow. A link whose text or URL names essay prompts
 * or a writing supplement scores highest; "essays" with an apply word next; a page of tips, stories, or a blog never.
 */
export function essayLinkScore(link: FoundLink): number {
  if (isGraduateUrl(link.url)) return 0;
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
  // "Supplement" alone is not enough: supplemental instruction, pay, and funds pages all say it.
  if (!/essay|short[\s-]answer|supplement(al)?\s+(essay|question|writing|prompt)|writing\s+(supplement|section|requirement)|personal\s+(statement|insight)/i.test(text)) return false;
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
  /** Pages never to return (a page already read this run that listed no prompts): the ladder looks past them. */
  skip?: readonly string[];
}

type DiscoverSchool = Pick<School, "unit_id" | "name" | "links">;

const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

/**
 * Shared application platforms and system-wide application portals. A page on one of them is never a college's own
 * essay page: a Common App member's apply link points at commonapp.org, whose homepage reads like "the prompts are in
 * the form" (the first run recorded twelve colleges that way). Never a start page, never accepted, never offered to
 * the picker. The UC's shared admissions site is not here: its personal insight questions page is the campuses' own.
 */
export const PLATFORM_HOSTS = /(^|\.)(commonapp\.org|coalitionforcollegeaccess\.org|mycoalition\.org|scoir\.com|applytexas\.org|calstate\.edu|suny\.edu|applyweb\.com|universalcollegeapp\.com|questbridge\.org)$/i;

/** True for a URL on a shared application platform (PLATFORM_HOSTS). */
export function isPlatformUrl(url: string): boolean {
  try {
    return PLATFORM_HOSTS.test(new URL(url).host);
  } catch {
    return false;
  }
}

/** The admissions hosts to probe: the apply and admissions links' origins first, then the website's; never a platform's. */
export function startPages(school: DiscoverSchool): string[] {
  const out: string[] = [];
  for (const u of [school.links?.apply, school.links?.admissions, school.links?.website]) {
    if (!u) continue;
    const abs = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    if (origin(abs) && !isPlatformUrl(abs) && !out.includes(abs)) out.push(abs);
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

  type Got = { page: FoundPage; text: string; links: FoundLink[] };
  const fetchPage = async (url: string, via: FoundVia, conditional?: { etag?: string; last_modified?: string }): Promise<Got | null> => {
    if (tried.includes(url) || tried.length >= DISCOVER_LIMITS.requests) return null;
    if (isPlatformUrl(url) || deps.skip?.includes(url)) return null;
    // A first-year reader: transfer, graduate, and professional-school pages are never the page (the second look once
    // took Dartmouth's transfer essays for its first-year ones; a run took Villanova's law school's page).
    if (isGraduateUrl(url)) return null;
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
    if (res.status === 304) return { page: { url, final_url: url, bytes: new Uint8Array(0), format: "html", via, unchanged: true, ...meta }, text: "", links: [] };
    if (!res.ok) return null;
    const final_url = res.url || url;
    // A redirect onto a platform ("Apply" → commonapp.org) is not the college's page either.
    if (isPlatformUrl(final_url)) {
      log(`  ${url}: redirects to a platform (${new URL(final_url).host}), skipped`);
      return null;
    }
    if (isGraduateUrl(final_url)) {
      log(`  ${url}: redirects to a graduate, professional, or transfer page, skipped`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const format = detectFormat(bytes, res.headers.get("content-type"), url);
    if (format === "xlsx") return null;
    if (format === "pdf") return { page: { url, final_url, bytes, format: "pdf", via, ...meta }, text: "", links: [] };
    const html = new TextDecoder().decode(bytes);
    const text = htmlToText(html);
    // A page whose title or first headings name a graduate program (a law school's "how to apply") is not the page,
    // and its links lead further into that school.
    if (graduateHeading(text)) {
      log(`  ${url}: a graduate or professional program's page, skipped`);
      return null;
    }
    const links = findLinks(html, final_url);
    pageLinks.push(...links);
    return { page: { url, final_url, bytes, format: "html", via, ...meta }, text, links };
  };
  const done = (page: FoundPage): DiscoverResult => ({ found: page, tried, cost, ...(blocked ? { blocked } : {}) });
  const accept = (got: Got | null) =>
    !!got && !deps.skip?.includes(got.page.final_url) && (got.page.unchanged || got.page.format === "pdf" || looksLikeEssayPage(got.text));
  const pointsToForm = (got: Got) => got.page.format === "html" && !got.page.unchanged && refersOnly(got.text, got.links.map((l) => l.text));
  const starts = startPages(school);
  const origins = [...new Set(starts.map(origin).filter((o): o is string => !!o))];
  /**
   * An accepted page that says the essays are in the application and prints none (Cornell's, Dartmouth's, and
   * UW's "how to apply" pages): its own links that name essays, prompts, a writing supplement, short answers, or
   * questions, on the college's own hosts, are tried first (one level, capped); a page there that reads like an essay
   * page and doesn't only point to the form wins. Otherwise the first page stands, and the read may call it
   * refers_to_form. A hub page that prints no prompts but links to one by name ("First-Year Writing Supplement" on
   * Villanova's "Applying to Villanova") is followed the same way, to a page that prints them.
   */
  const take = async (got: Got): Promise<DiscoverResult> => {
    if (got.page.format !== "html" || got.page.unchanged) return done(got.page);
    const refers = pointsToForm(got);
    const own = [...new Set([...origins, origin(got.page.final_url)].filter((o): o is string => !!o))];
    let links = rankDeeperLinks(got.links, own);
    if (!refers) {
      if (printsPrompts(got.text, got.links.map((l) => l.text))) return done(got.page);
      links = links.filter((l) => essayLinkScore(l) >= 3);
    }
    for (const link of links.slice(0, DISCOVER_LIMITS.deeper)) {
      const next = await fetchPage(link.url, "apply-page-link");
      if (next && accept(next) && !pointsToForm(next) && (refers || next.page.format === "pdf" || printsPrompts(next.text, next.links.map((l) => l.text)))) {
        log(`  ${school.name}: ${got.page.url} ${refers ? "points to the application" : "prints no prompts"}; took ${next.page.final_url} one level on`);
        return done(next.page);
      }
    }
    return done(got.page);
  };

  // 1. The recipe's page.
  if (recipe?.url) {
    const got = await fetchPage(recipe.url, "recipe", { etag: recipe.etag, last_modified: recipe.last_modified });
    if (got && accept(got)) return take(got);
  }

  // 2. The links the dataset holds, and the essay links on them. A start page is taken when it names the essay page
  // near its top, or when it prints the prompts further down (Harvard's application requirements page lists its five
  // questions under "Completing the Harvard supplement questions").
  for (const s of starts) {
    const got = await fetchPage(s, "known-link");
    if (got && got.page.format === "html" && looksLikeEssayPage(got.text) && (STRONG.test(got.text.slice(0, 4000)) || (STRONG.test(got.text) && printsPrompts(got.text, got.links.map((l) => l.text))))) return take(got);
  }
  // 2b. One level deeper: the first-year "how to apply" pages the start pages link to usually hold the essay link the
  // start pages don't (the first runs found no page for half the colleges). Fetched on the college's own hosts for
  // their links, and taken as the page when one reads like it.
  for (const link of rankApplyLinks(pageLinks, origins).slice(0, DISCOVER_LIMITS.applyFollow)) {
    if (tried.length >= DISCOVER_LIMITS.requests - DISCOVER_LIMITS.reserve) break;
    const got = await fetchPage(link.url, "apply-page-link");
    if (got && accept(got)) return take(got);
  }
  for (const link of rankLinks(pageLinks).slice(0, DISCOVER_LIMITS.follow)) {
    const got = await fetchPage(link.url, "apply-page-link");
    if (got && accept(got)) return take(got);
  }

  // 3. Well-known paths.
  for (const url of wellKnownUrls(starts)) {
    if (tried.length >= DISCOVER_LIMITS.requests - DISCOVER_LIMITS.reserve) break;
    const got = await fetchPage(url, "well-known-path");
    if (got && accept(got)) return take(got);
  }

  // 4. The site's sitemaps.
  if (deps.http.sitemaps) {
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
      if (got && accept(got)) return take(got);
    }
  }

  // 5. The picker.
  if (deps.client && deps.cap && pageLinks.length) {
    const pick = await pickEssayLink(deps.client, deps.cap, school, pageLinks);
    cost += pick.cost;
    if (pick.url) {
      const got = await fetchPage(pick.url, "picker");
      if (got && accept(got)) return take(got);
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

export const PICKER_SYSTEM = `You pick one link for a program that reads U.S. colleges' published essay prompts for first-year applicants. You get a numbered list of links found on one college's own admissions pages (link text and URL). Answer with the number of the link to the college's own page listing its supplemental essay or short-answer prompts (often called "essay prompts", "writing supplement", or "supplemental questions"), or leave "page" out when no link fits. Never pick essay-writing tips, blogs, student stories, another organization's page, or a page about something else that shares a word (supplemental instruction or pay, financial aid, an essay contest, a course). Prefer a first-year admissions page that lists the prompts over a general "how to apply" page. Choose only from the list.`;
const PICKER_SCHEMA = { type: "object", additionalProperties: false, properties: { page: { type: "integer" } } } as const;

/** The picker's request: the links, deduplicated, capped at about 4 K tokens. */
export function buildPickerRequest(school: Pick<School, "unit_id" | "name">, links: readonly FoundLink[]): { params: Anthropic.MessageCreateParamsNonStreaming; links: FoundLink[] } {
  const uniq: FoundLink[] = [];
  const rows: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const l of links.slice(0, DISCOVER_LIMITS.pickerLinks)) {
    if (seen.has(l.url) || !/^https?:\/\//.test(l.url) || isPlatformUrl(l.url)) continue;
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
