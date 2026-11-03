/**
 * A document's numbered line text for the Steward (specs/product/data-steward.md "What a run does", step 3): the
 * archive's line sidecar by sha256 when it has one; else the archived bytes; else the document fetched again by URL
 * (`final_url`, then `url`) with our honest user agent through `PoliteHttp`, used only when its sha256 is the one the
 * manifest (`reported.docs`) recorded, as scripts/check-grid-columns.mts does. A fetched document is put in the archive
 * (the local cache on a runner without `COLLEGE_DOCS_REPO`), so a run reads each document once.
 *
 * Lines come from the college-reported pipeline's own builders, so a line id here is the id a record's `line` cites:
 * `layoutDocument` (scripts/lib/college-reported/layout.mts) for model-read types (flattened and scanned PDFs, older
 * workbooks, HTML, class profiles); the workbook's sheets with cell tags for a template workbook (whose items cite a
 * cell, not a line); `pdftotext -layout` (grid-place.mts `gridLayout`) for a form PDF, whose items cite a field.
 *
 * Never throws for a document it can't get: `{ unavailable, reason }` (no manifest entry and no URL, a failed fetch, a
 * sha mismatch, no text), which the Steward turns into a To do row.
 */
import type { DocumentType, ManifestEntry } from "../../../lib/cds-sections.ts";
import type { Archive } from "../college-reported/archive.mts";
import { sha256 as sha256Of } from "../college-reported/http.mts";
import { layoutDocument, linesFromWorkbookBytes } from "../college-reported/layout.mts";
import { gridLayout } from "../college-reported/grid-place.mts";
import { detectDocumentType } from "../college-reported/doctype.mts";

/** What `documentLines` needs: the archive, the manifest, and a polite GET (PoliteHttp `get` with `cdsDocument`). */
export interface DocumentDeps {
  archive: Pick<Archive, "get" | "getLines" | "put" | "putLines">;
  /** The manifest entry for a sha256, or null. */
  manifest(sha256: string): Promise<ManifestEntry | null>;
  /** The manifest entry whose `url` or `final_url` is this URL, or null. */
  manifestByUrl(url: string): Promise<ManifestEntry | null>;
  /** A polite GET: the bytes, or why not. */
  fetchBytes(url: string): Promise<Uint8Array | { error: string }>;
}

export interface DocumentText {
  sha256: string;
  url: string | null;
  type: DocumentType;
  edition: string | null;
  /** Line id n is `lines[n - 1]`. */
  lines: string[];
  /** The page of each line. */
  pages: number[];
  /** Where the text came from. */
  from: "archive-lines" | "archive-bytes" | "fetched";
}

export interface Unavailable {
  unavailable: true;
  reason: string;
  sha256: string | null;
  url: string | null;
}

/** The lines kept in an archive sidecar (scripts/lib/college-reported/phases.mts `ArchivedLines`). */
interface Sidecar {
  lines: string[];
  pages: number[];
}

const MODEL_LAID_OUT: ReadonlySet<DocumentType> = new Set(["pdf-flat", "pdf-scanned", "xlsx-classic", "html", "class-profile"]);
const extOf = (type: DocumentType) => (type.startsWith("xlsx") ? "xlsx" : type === "html" || type === "class-profile" ? "html" : "pdf");

/** Lines and pages from a document's bytes, by the pipeline's own builders; null when there is no text. */
export async function linesFromBytes(bytes: Uint8Array, type: DocumentType): Promise<Sidecar | null> {
  if (MODEL_LAID_OUT.has(type)) {
    const lay = await layoutDocument(bytes, type);
    return lay.lines.length ? { lines: lay.lines, pages: lay.pages } : null;
  }
  if (type === "xlsx-template") {
    const wb = linesFromWorkbookBytes(bytes);
    return wb.lines.length ? wb : null;
  }
  // pdf-form: pdftotext -layout, pages split at form feeds.
  const raw = gridLayout(bytes, type);
  if (!raw) return null;
  const lines: string[] = [];
  const pages: number[] = [];
  let page = 1;
  for (const l of raw) {
    const feeds = (l.match(/\f/g) ?? []).length;
    page += feeds;
    const text = l.replace(/\f/g, "");
    if (!text.trim()) continue;
    lines.push(text);
    pages.push(page);
  }
  return lines.length ? { lines, pages } : null;
}

/**
 * The document's lines by sha256 (preferred) or URL. A URL with no manifest entry is fetched and laid out by its own
 * bytes' type, without a sha to check against (the result's `sha256` is the bytes').
 */
export async function documentLines(deps: DocumentDeps, ref: { sha256?: string | null; url?: string | null }): Promise<DocumentText | Unavailable> {
  const entry = ref.sha256 ? await deps.manifest(ref.sha256) : ref.url ? await deps.manifestByUrl(ref.url) : null;
  const sha = entry?.sha256 ?? ref.sha256 ?? null;
  const url = entry ? (entry.final_url ?? entry.url) : (ref.url ?? null);
  const no = (reason: string): Unavailable => ({ unavailable: true, reason, sha256: sha, url });
  if (!sha && !url) return no("no sha256 or url given");
  const base = (type: DocumentType) => ({ sha256: sha!, url, type, edition: entry?.edition ?? null });

  if (sha && entry) {
    const side = await deps.archive.getLines<Sidecar>(sha).catch(() => null);
    if (side?.lines?.length) return { ...base(entry.type), lines: side.lines, pages: side.pages, from: "archive-lines" };
    const bytes = await deps.archive.get(sha).catch(() => null);
    if (bytes) {
      const got = await linesFromBytes(bytes, entry.type).catch(() => null);
      if (!got) return no(`the archived ${entry.type} has no text`);
      if (MODEL_LAID_OUT.has(entry.type)) await deps.archive.putLines(sha, got).catch(() => {});
      return { ...base(entry.type), ...got, from: "archive-bytes" };
    }
  }
  if (ref.sha256 && !entry) return no("no manifest entry for this sha256, so a fetched copy can't be checked");
  if (!url) return no("the archive doesn't hold this document and the manifest has no URL for it");

  const fetched = await deps.fetchBytes(url);
  if (!(fetched instanceof Uint8Array)) return no(`fetch failed: ${fetched.error}`);
  const got256 = sha256Of(fetched);
  if (entry && got256 !== entry.sha256) return no("the file at its URL has changed since it was read (sha256 differs)");
  const type = entry?.type ?? detectDocumentType(fetched);
  await deps.archive.put(got256, fetched, extOf(type)).catch(() => {});
  const got = await linesFromBytes(fetched, type).catch(() => null);
  if (!got) return no(`the fetched ${type} has no text`);
  if (MODEL_LAID_OUT.has(type)) await deps.archive.putLines(got256, got).catch(() => {});
  return { sha256: got256, url, type, edition: entry?.edition ?? null, ...got, from: "fetched" };
}

/** The most text one read returns; more pages are asked for by number. */
export const LINES_MAX_CHARS = 40_000;

/**
 * Numbered text ("412: …", with "--- Page 9 ---" where the page changes) of the given pages (all by default), cut at
 * `maxChars` with a closing line that says which page to ask for next.
 */
export function numberedText(doc: Pick<DocumentText, "lines" | "pages">, pages?: readonly number[] | null, maxChars = LINES_MAX_CHARS): { text: string; truncatedAt: number | null } {
  const want = pages?.length ? new Set(pages) : null;
  const out: string[] = [];
  let page: number | null = null;
  let size = 0;
  for (let i = 0; i < doc.lines.length; i++) {
    const p = doc.pages[i];
    if (want && !want.has(p)) continue;
    const head = p !== page ? `--- Page ${p} ---\n` : "";
    const line = `${head}${i + 1}: ${doc.lines[i]}`;
    if (size + line.length > maxChars) {
      out.push(`… cut at page ${p}; ask for pages from ${p} on`);
      return { text: out.join("\n"), truncatedAt: p };
    }
    page = p;
    size += line.length + 1;
    out.push(line);
  }
  return { text: out.join("\n"), truncatedAt: null };
}

/** The numbered lines from `from` to `to` (ids, inclusive), for a question about one line. */
export function lineWindow(doc: Pick<DocumentText, "lines" | "pages">, line: number, before = 15, after = 3): string {
  const out: string[] = [];
  let page: number | null = null;
  for (let id = Math.max(1, line - before); id <= Math.min(doc.lines.length, line + after); id++) {
    if (doc.pages[id - 1] !== page) {
      page = doc.pages[id - 1];
      out.push(`--- Page ${page} ---`);
    }
    out.push(`${id}: ${doc.lines[id - 1]}`);
  }
  return out.join("\n");
}
