/**
 * Notices (specs/college-reported-fall-figures.md Decisions 1, 5, 7, 9): which links on a college's news listing are
 * announcements about an entering term, and which hosts are never a source. Pure: no I/O. The pipeline
 * (./phases.mts) fetches the listing pages (step 0 of a season pass, free) and the pages a season search names, and
 * hands their HTML here; every link this returns becomes a `notice` source on the recipe.
 */
import type { CdsUrlEntry, DocumentFormat, NoticeForm, RecipeSource } from "../../../lib/reported.ts";
import { fallYear } from "../../../lib/reported.ts";
import { noticePatterns } from "../../../lib/seasons.ts";
import { findLinks, safeDecodeUri } from "./documents.mts";

/**
 * Student newspapers (Decision 9: never a source, however exact their numbers look). A publication the university runs
 * (a magazine, the Gazette, a provost's update) is a source; a student paper is not. Any host with both "daily" and
 * "student" in it is treated as one too.
 */
export const STUDENT_PAPER_HOSTS: readonly string[] = ["thecrimson.com", "cornellsun.com", "cavalierdaily.com", "huntnewsnu.com", "dailybruin.com", "dailycal.org", "studlife.com"];

/** Whether a URL is on a student newspaper's host (Decision 9). An unparseable URL is not. */
export function isStudentPaper(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (STUDENT_PAPER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return host.includes("daily") && host.includes("student");
}

/** One link on a listing page that announces figures for the term. */
export interface NoticeLink {
  url: string;
  text: string;
  /** ISO date from a `/YYYY/MM/DD/` path, when the URL carries one. */
  published?: string;
}

/** "…/2026/09/18/…" → "2026-09-18"; undefined when the URL names no full date. */
export function dateInUrl(url: string): string | undefined {
  const m = /(?<!\d)(20\d{2})[/-](\d{2})[/-](\d{2})(?!\d)/.exec(url);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** A sort key for "newest-looking": the URL's full date, else its year and month, else its newest year, else nothing. */
function recency(url: string): string {
  const full = dateInUrl(url);
  if (full) return full;
  const ym = /(?<!\d)(20\d{2})\/(\d{2})(?!\d)/.exec(url);
  if (ym) return `${ym[1]}-${ym[2]}-00`;
  const years = [...url.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map((m) => m[1]).sort();
  return years.length ? `${years[years.length - 1]}-00-00` : "";
}

/**
 * Whether a link's text and URL name the term as an announcement would: a specific token ("Fall 2026", "Class of
 * 2030") alone, or the bare year together with a notice phrase ("record applications", "welcomes", "admits"). The
 * bare year alone ("2026 commencement speakers") isn't enough: lib/seasons.ts `noticePatterns(term).text` matches a
 * token or a phrase, so the year is stripped before the phrase is looked for.
 */
export function namesTerm(hay: string, term: string): boolean {
  const { tokens, text } = noticePatterns(term);
  const year = fallYear(term)!;
  // A URL spells the term with hyphens or underscores ("fall-2026-profile", "class_of_2030").
  const lower = hay.toLowerCase().replace(/%20|[_+-]/g, " ");
  const has = (t: string) => new RegExp(`(?<![\\d])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d])`).test(lower);
  const specific = tokens.slice(0, -1).some(has);
  if (specific) return true;
  if (!has(String(year))) return false;
  const stripped = lower.replaceAll(String(year), " ").replaceAll(String(year + 4), " ");
  return text.test(stripped);
}

/**
 * Links on a news listing (or any page) that announce figures for `term`, newest-looking first, at most `limit` (3):
 * the link's text or URL must name the term (`namesTerm`). Links in `exclude` (the recipe's sources and dropped URLs),
 * the page itself, and student newspapers are left out. Decision 5, step 0.
 */
export function noticeLinksFromPage(html: string, pageUrl: string, term: string, o: { exclude?: Iterable<string>; limit?: number } = {}): NoticeLink[] {
  const exclude = new Set(o.exclude ?? []);
  exclude.add(pageUrl);
  const out: (NoticeLink & { order: number })[] = [];
  findLinks(html, pageUrl).forEach((l, order) => {
    if (exclude.has(l.url) || isStudentPaper(l.url)) return;
    if (!namesTerm(`${safeDecodeUri(l.url)} ${l.text}`, term)) return;
    const published = dateInUrl(l.url);
    out.push({ url: l.url, text: l.text, ...(published ? { published } : {}), order });
  });
  return out
    .sort((a, b) => recency(b.url).localeCompare(recency(a.url)) || a.order - b.order)
    .slice(0, o.limit ?? 3)
    .map((l) => ({ url: l.url, text: l.text, ...(l.published ? { published: l.published } : {}) }));
}

/** A notice's format and form from its URL: a `.pdf` is a PDF; anything else an HTML release. */
export function noticeShape(url: string): { format: DocumentFormat; form: NoticeForm } {
  return /\.pdf($|[?#])/i.test(url) ? { format: "pdf", form: "pdf" } : { format: "html", form: "release" };
}

/** A recipe source for a notice link (Decision 1). */
export function noticeSource(link: Pick<NoticeLink, "url" | "published">, term: string, found_by: NonNullable<RecipeSource["found_by"]>): RecipeSource {
  const { format, form } = noticeShape(link.url);
  return { kind: "notice", url: link.url, format, term, ...(link.published ? { published: link.published } : {}), form, found_by };
}

/**
 * A notice from the owner's list (the reference document `cds-urls`, an entry of kind "notice"; found_by "manual"):
 * its term from the entry's note ("UC system sheet, Fall 2026"), else its URL, else the year the owner added it. A note
 * that says "system" marks a system fact sheet (Decision 9's exception: each campus's row, cited to the system office).
 */
export function manualNoticeSource(e: Pick<CdsUrlEntry, "url" | "note" | "added">): RecipeSource {
  const term = termIn(e.note) ?? termIn(e.url) ?? `Fall ${e.added.slice(0, 4)}`;
  const src = noticeSource({ url: e.url, published: dateInUrl(e.url) }, term, "manual");
  return /\bsystem\b/i.test(e.note ?? "") ? { ...src, form: "system-sheet" } : src;
}

/**
 * The term a piece of text names: "Class of 2030" → "Fall 2026", "Fall 2026" → "Fall 2026"; null when it names
 * neither (a manual notice entry's note or URL, which the owner's list doesn't otherwise date).
 */
export function termIn(text: string | null | undefined): string | null {
  const t = safeDecodeUri(text ?? "");
  const cls = /class(?:[\s_-]|%20)*(?:of(?:[\s_-]|%20)*)?(20\d{2})(?!\d)/i.exec(t);
  if (cls) return `Fall ${Number(cls[1]) - 4}`;
  const fall = /fall[\s_-]*(20\d{2})(?!\d)/i.exec(t);
  return fall ? `Fall ${fall[1]}` : null;
}
