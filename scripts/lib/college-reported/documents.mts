/**
 * Turning a college's documents into what the extraction model reads: HTML → readable text, PDF → text by page
 * (only the pages around the admissions section), and finding new links on index pages.
 */
import type { DocumentFormat, RecipeSource } from "../../../lib/reported.ts";
import type { ReportedSourceKind } from "../../../lib/types";

/* ------------------------------------------------------------------ */
/* Formats                                                             */
/* ------------------------------------------------------------------ */

/** The document's real format, from its first bytes, falling back to the content type and URL. */
export function detectFormat(bytes: Uint8Array, contentType: string | null, url: string): DocumentFormat {
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK")) return "xlsx";
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("spreadsheetml")) return "xlsx";
  if (/\.pdf($|\?)/i.test(url)) return "pdf";
  if (/\.xlsx($|\?)/i.test(url)) return "xlsx";
  return "html";
}

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Readable text from an HTML page: scripts, styles, navigation chrome and comments dropped; headings kept as
 * "## Heading" lines; table rows kept one per line with cells separated by " | ", **empty cells included**: MIT puts
 * each `<td>` on its own source line, so whitespace (and any line break inside a cell) is collapsed within each `<tr>`
 * first, and "Rigor of secondary school record | | X | |" keeps its "X" in the "Important" column.
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<tr\b[\s\S]*?<\/tr>/gi, (row) => row.replace(/<(br|hr)\b[^>]*>|<\/(p|div|li)>/gi, " ").replace(/\s+/g, " "));
  s = s
    .replace(/<h([1-6])\b[^>]*>/gi, "\n\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|table|section|article|ul|ol|dd|dt|caption|blockquote)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").replace(/\s*\|\s*$/, "").trim())
    .filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
    .join("\n")
    .trim();
}

/** Up to `max` characters of `text` centered on the first occurrence of `anchor` (the whole text when it fits). */
export function windowAround(text: string, anchor: string | undefined, max = 60_000): string {
  if (text.length <= max) return text;
  const at = anchor ? text.toLowerCase().indexOf(anchor.toLowerCase()) : -1;
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(max / 4));
  return text.slice(start, start + max);
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/** Text of each page of a PDF (index 0 = page 1), via pdf.js's pure-JS legacy build. */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      } else line += " ";
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"));
  }
  await task.destroy();
  return pages;
}

/** Below this much text a PDF is treated as scanned (images), and sent to the model as a PDF instead. */
export const SCANNED_TEXT_CHARS = 200;
/** Whole documents up to this many pages are sent in full; longer ones only around the admissions section. */
export const WHOLE_PDF_PAGES = 30;

/**
 * Which pages (1-based) to send: all of a short document; otherwise the recipe's pages and every page containing the
 * anchor, each with one page either side. Empty when a long document has neither (the anchor wasn't found).
 */
export function selectPages(pages: string[], hint: number[] | undefined, anchor: string | undefined): number[] {
  if (pages.length <= WHOLE_PDF_PAGES) return pages.map((_, i) => i + 1);
  const picked = new Set<number>();
  const add = (p: number) => {
    for (const q of [p - 1, p, p + 1]) if (q >= 1 && q <= pages.length) picked.add(q);
  };
  for (const p of hint ?? []) add(p);
  if (anchor) {
    const needle = anchor.toLowerCase();
    pages.forEach((t, i) => {
      if (t.toLowerCase().includes(needle)) add(i + 1);
    });
  }
  return [...picked].sort((a, b) => a - b);
}

export function pagesText(pages: string[], which: number[]): string {
  return which.map((p) => `--- Page ${p} ---\n${pages[p - 1]}`).join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Index pages: finding next year's file                               */
/* ------------------------------------------------------------------ */

export interface FoundLink {
  url: string;
  text: string;
}

/** Every <a href> on a page, resolved against the page URL, without fragments; http(s) only. */
export function findLinks(html: string, base: string): FoundLink[] {
  const out: FoundLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
    let url: string;
    try {
      const u = new URL(href, base);
      u.hash = "";
      url = u.toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text: htmlToText(m[4]).replace(/\s+/g, " ").trim() });
  }
  return out;
}

/**
 * `decodeURIComponent` that never throws: a link with a stray "%" or a non-UTF-8 escape ("%E9") is read as written.
 * A raw decode threw "URI malformed" out of the whole probe step for 38 colleges in the October 2026 runs (Western
 * Carolina among them), failing their discovery over one odd link.
 */
export function safeDecodeUri(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const CDS_LINK = /common[\s_-]*data[\s_-]*set|(^|[^a-z])cds([^a-z]|$)/i;
const PROFILE_LINK = /class[\s_-]*of[\s_-]*20\d\d|class[\s_-]*profile|first[\s_-]*year[\s_-]*profile|incoming[\s_-]*class|entering[\s_-]*class|admissions[\s_-]*statistics/i;

/** What kind of admissions document a link points to, if any. CDS links must be a file (PDF or Excel). */
export function linkKind(link: FoundLink): ReportedSourceKind | null {
  const hay = `${safeDecodeUri(link.url)} ${link.text}`;
  if (CDS_LINK.test(hay) && /\.(pdf|xlsx)($|\?)/i.test(link.url)) return "cds";
  if (PROFILE_LINK.test(hay)) return "class-profile";
  return null;
}

/**
 * The fall a link or URL describes: a CDS edition "2025-26" / "2025_2026" → 2025; "Class of 2030" → 2026 (four
 * years before graduation); a lone "Fall 2026" → 2026. Null when it names no year.
 */
export function entryYearOf(text: string): number | null {
  const t = safeDecodeUri(text);
  // The file name first: a URL's folders often hold an upload date ("…/uploads/2026/09/CDS_2025-2026.xlsx") that
  // isn't the edition. Then the whole text.
  const name = t.split(/[?#]/)[0].split("/").pop() ?? "";
  return yearIn(name) ?? yearIn(t);
}

function yearIn(t: string): number | null {
  const classOf = /class[\s_-]*of[\s_-]*(20\d\d)/i.exec(t);
  if (classOf) return Number(classOf[1]) - 4;
  // Every range, not just the first: "2026/09" (a date) must not hide "2025-2026" (the edition) after it.
  for (const range of t.matchAll(/(20\d\d)\s*[-–_/]\s*(?:20)?(\d\d)(?!\d)/g)) {
    if (Number(range[2]) === (Number(range[1]) + 1) % 100) return Number(range[1]);
  }
  const fall = /fall[\s_-]*(20\d\d)/i.exec(t);
  if (fall) return Number(fall[1]);
  const lone = [...t.matchAll(/(?<!\d)(20\d\d)(?!\d)/g)].map((m) => Number(m[1]));
  return lone.length ? Math.max(...lone) : null;
}

/**
 * Links on an index page that are a newer edition than anything the recipe already has of the same kind (e.g.
 * `CDS_2026-27.pdf` when the recipe holds 2025-26). Each becomes a new recipe source.
 */
export function newSourcesFromIndex(html: string, indexUrl: string, existing: RecipeSource[]): RecipeSource[] {
  return newSourcesFromLinks(findLinks(html, indexUrl), existing);
}

/** `newSourcesFromIndex` over links found anywhere (an index page, a sitemap's `<loc>` entries). */
export function newSourcesFromLinks(links: FoundLink[], existing: RecipeSource[]): RecipeSource[] {
  const known = new Set(existing.map((s) => s.url));
  const newest = (kind: ReportedSourceKind) =>
    Math.max(-Infinity, ...existing.filter((s) => s.kind === kind).map((s) => entryYearOf(s.url) ?? -Infinity));
  const found: RecipeSource[] = [];
  for (const link of links) {
    if (known.has(link.url)) continue;
    const kind = linkKind(link);
    if (!kind) continue;
    const year = entryYearOf(`${link.url} ${link.text}`);
    if (year === null || year <= newest(kind)) continue;
    if (found.some((f) => f.kind === kind && (entryYearOf(f.url) ?? 0) >= year)) continue;
    const format: DocumentFormat = /\.pdf($|\?)/i.test(link.url) ? "pdf" : /\.xlsx($|\?)/i.test(link.url) ? "xlsx" : "html";
    const anchor = existing.find((s) => s.kind === kind && s.format === format)?.anchor;
    for (let i = found.length - 1; i >= 0; i--) if (found[i].kind === kind) found.splice(i, 1);
    found.push({ kind, url: link.url, format, ...(anchor ? { anchor } : {}) });
  }
  return found;
}
