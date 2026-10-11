/**
 * Layout-aware text for model-read documents (specs/college-reported-round-3.md, Decision 3): flattened PDFs, older
 * Excel workbooks, and HTML CDS pages become numbered lines that keep values beside their labels and grid marks under
 * their column headers.
 *
 * PDFs: pdf.js's content-stream order separates values from labels (Harvard's C11, Baylor's C21 "Yes 11/1 12/15 566
 * 453") and loses every grid's columns (C7, C8, D5, F3, H14). Rebuilding rows by y (±2.5 pt), sorting each row by x,
 * and joining items with " | " where there is a gap (> 8 pt) puts every value beside its label; an `@x` tag on each cell
 * lets code and the model place lone values and check marks under their headers (Harvard C7: "Considered" at x=425,
 * its mark at 450).
 *
 * Then, for every type: the definitions are dropped (from the first "Common Data Set Definitions" heading on), the body
 * lines are numbered for citation (lib/cds-quotes.ts), the edition comes from the cover or item text (never page
 * headers: USC and Loyola print "Common Data Set 2024-2025" atop their 2025–26 pages), and the body is split into the
 * two model calls' parts at the C1 and D1 item markers.
 *
 * Every function but the readers (`pdfTextItems`, `layoutDocument`) is pure.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeValue, parseEdition, parseNumber, readMark, type CdsSection, type DocumentType } from "../../../lib/cds-sections.ts";
import { joinSplitDigits, lineText, type LineId } from "../../../lib/cds-quotes.ts";
import { classicSheetText, readWorkbook } from "../cds-xlsx.mts";
import { htmlToText, safeDecodeUri } from "./documents.mts";

/* ------------------------------------------------------------------ */
/* Rows from positioned text                                           */
/* ------------------------------------------------------------------ */

/** One positioned piece of PDF text (pdf.js's `str`, `transform[4]`, `transform[5]`, `width`). */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

/** A cell of a layout line: its x (NaN when the line carries no tags) and text. */
export interface Cell {
  x: number;
  text: string;
}

export interface Row {
  y: number;
  cells: Cell[];
}

/** Items within this many points of a row's y are on that row. */
export const ROW_TOLERANCE = 2.5;
/** A horizontal gap wider than this starts a new cell. */
export const CELL_GAP = 8;

/**
 * Rows by y (top first, ±2.5 pt), each sorted by x; items closer than 8 pt join one cell with a space, wider gaps start
 * a new cell. Split digits inside a cell are joined ("$3 4 , 604" → "$34,604").
 */
export function rowsFromItems(items: readonly TextItem[]): Row[] {
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const it of [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= ROW_TOLERANCE);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const cells: Cell[] = [];
      let end = -Infinity;
      for (const it of r.items.sort((a, b) => a.x - b.x)) {
        const str = it.str.replace(/\s+/g, " ").trim();
        if (cells.length && it.x - end <= CELL_GAP) cells[cells.length - 1].text += ` ${str}`;
        else cells.push({ x: it.x, text: str });
        end = it.x + (it.width || 0);
      }
      return { y: r.y, cells: cells.map((c) => ({ x: c.x, text: joinSplitDigits(c.text) })) };
    });
}

/** "@78 Rigor of secondary school record | @450 X" (or without the tags). */
export function formatRow(row: Row, opts: { x?: boolean } = {}): string {
  const withX = opts.x ?? true;
  return row.cells.map((c) => (withX && Number.isFinite(c.x) ? `@${Math.round(c.x)} ${c.text}` : c.text)).join(" | ");
}

/** The cells of a layout line; x is NaN for untagged cells and for workbook cells ("@C101"). */
export function parseCells(line: string): Cell[] {
  return line.split(" | ").map((part) => {
    const m = /^\s*@(\d+)(?:\s(.*))?$/.exec(part);
    return m ? { x: Number(m[1]), text: (m[2] ?? "").trim() } : { x: NaN, text: lineText(part) };
  });
}

/** Each page's text items, via pdf.js's pure-JS legacy build. */
export async function pdfTextItems(bytes: Uint8Array): Promise<TextItem[][]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: TextItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width ?? 0 });
    }
    pages.push(items);
  }
  await task.destroy();
  return pages;
}

/**
 * Text items from layout text ("=== Page N ===" then "@x text | @x text" lines, the format the inventory and the
 * archive's line-text sidecar use): each tagged cell becomes an item at its x, one row per line. Fixtures use it.
 */
export function pagesFromLayoutText(text: string): TextItem[][] {
  const pages: TextItem[][] = [];
  let y = 0;
  for (const raw of text.split("\n")) {
    if (/^=== Page \d+ ===$/.test(raw.trim())) {
      pages.push([]);
      y = 780;
      continue;
    }
    if (!pages.length) pages.push([]);
    y -= 12;
    for (const cell of parseCells(raw)) {
      if (!cell.text) continue;
      pages[pages.length - 1].push({ str: cell.text, x: Number.isFinite(cell.x) ? cell.x : 0, y, width: 0 });
    }
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* The body: definitions, headers, edition, the C/D split              */
/* ------------------------------------------------------------------ */

/** A line's text with its tags and leading empty cells removed: what item markers and headings are matched on. */
const bare = (line: string) => lineText(line).replace(/^[\s|]+/, "").replace(/^##\s*/, "").trim();

/** The 0-based index of the first "Common Data Set Definitions" heading, or null (Loyola and UW–Eau Claire have none). */
export function definitionsStart(lines: readonly string[]): number | null {
  const i = lines.findIndex((l) => /^common data set definitions\b\s*:?$/i.test(bare(l)));
  return i < 0 ? null : i;
}

/** The lines before the definitions (about 8.4 K tokens of identical boilerplate in 9 of 11 PDFs). */
export function dropDefinitions(lines: readonly string[]): string[] {
  const at = definitionsStart(lines);
  return at === null ? [...lines] : lines.slice(0, at);
}

/** Line texts printed on three or more pages: running headers and footers ("Common Data Set 2024-2025", "CDS-C"). */
export function repeatedLines(lines: readonly string[], pages: readonly number[]): Set<string> {
  const seen = new Map<string, Set<number>>();
  lines.forEach((l, i) => {
    const t = bare(l).toLowerCase();
    if (!t) return;
    if (!seen.has(t)) seen.set(t, new Set());
    seen.get(t)!.add(pages[i]);
  });
  return new Set([...seen].filter(([, p]) => p.size >= 3).map(([t]) => t));
}

const COVER = [
  /common data set[\s,:–-]*(20\d{2})\s*[-–]\s*((?:20)?\d{2})(?!\d)/i,
  /(20\d{2})\s*[-–]\s*((?:20)?\d{2})(?!\d)\s+common data set/i,
  // A cover whose "Common Data Set" is an image prints only the years as text (Marquette 2025–26: "2025-2026").
  /^(20\d{2})\s*[-–]\s*((?:20)?\d{2})$/,
];
/**
 * Item text naming the edition's own fall: C21/C22's "For the Fall 2025 entering class" and B22's "enrollment date in
 * Fall 2025" (Michigan wraps it onto its own line). Not B22's "Fall 2024 entering cohort": that is last year's cohort.
 */
const ITEM_FALL = [/fall (20\d{2}) entering class/i, /enrollment date in fall (20\d{2})/i];

export interface EditionFound {
  edition: string;
  /** The cover or item text; `url` = the file name (editionFromUrl), used only when the body states none. */
  from: "cover" | "items" | "url";
  /** When the cover and the item text disagree: what the other said. */
  conflict?: string;
}

/**
 * The edition the document states about itself: the cover ("Common Data Set 2025-2026", "2025-26 Common Data Set") on
 * the first page, else the item text ("For the Fall 2025 entering class", "enrollment date in Fall 2025", by
 * majority). Never a running header: a line printed on three or more pages doesn't count, so USC's and Loyola's
 * "Common Data Set 2024-2025" page headers can't override their 2025–26 covers. Documents without pages (HTML, Excel)
 * use their first 40 lines as the cover.
 */
export function editionFromBody(lines: readonly string[], pages: readonly number[]): EditionFound | null {
  const headers = repeatedLines(lines, pages);
  const paged = new Set(pages).size > 1;
  let cover: string | null = null;
  for (let i = 0; i < lines.length && !cover; i++) {
    if (paged ? pages[i] !== pages[0] : i >= 40) break;
    const t = bare(lines[i]);
    if (headers.has(t.toLowerCase())) continue;
    for (const re of COVER) {
      const m = re.exec(t);
      const ed = m && parseEdition(`${m[1]}-${m[2]}`);
      if (ed) {
        cover = ed.key;
        break;
      }
    }
  }
  const votes = new Map<string, number>();
  for (const l of lines) {
    const t = bare(l);
    for (const re of ITEM_FALL) {
      const m = re.exec(t);
      const ed = m && parseEdition(`${m[1]}-${Number(m[1]) + 1}`);
      if (ed) votes.set(ed.key, (votes.get(ed.key) ?? 0) + 1);
    }
  }
  const items = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (cover) return items && items !== cover ? { edition: cover, from: "cover", conflict: items } : { edition: cover, from: "cover" };
  return items ? { edition: items, from: "items" } : null;
}

/**
 * The edition a CDS file's name states, for a document whose body states none: "cds-2025-2026_final.pdf",
 * "CDS_2024-25.pdf", "CDS-25-26.pdf", "cds2526.pdf", "CDS_202526.pdf", "2024-2025-Common-Data-Set.pdf". Only the file
 * name (the last path segment) counts: folders often hold an upload date ("/2026/04/") that isn't the edition. The two
 * years must be consecutive; a lone year ("common-data-set-2025") names no edition. Null when the name states none.
 */
export function editionFromUrl(url: string): EditionFound | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // not a URL: read it as a path
  }
  const name = safeDecodeUri(path.replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase();
  const next = (a: number, b: number) => b === (a + 1) % 100 || b === a + 1;
  const tries: [RegExp, (m: RegExpMatchArray) => number | null][] = [
    // 2025-2026, 2025_26, 2025 – 26, 2025/26, "2025_-26"
    [/(?<!\d)(20\d{2})[\s_–-]*[-–_/ ][\s_–-]*((?:20)?\d{2})(?!\d)/g, (m) => (next(Number(m[1]), Number(m[2])) ? Number(m[1]) : null)],
    // 202526
    [/(?<!\d)(20\d{2})(\d{2})(?!\d)/g, (m) => (next(Number(m[1]), Number(m[2])) ? Number(m[1]) : null)],
    // CDS-25-26, cds_22-23, cds2526: two-digit years only right after "cds" ("cds2021" is a year, not 2020-21)
    [/cds[\s_-]*(\d{2})([\s_-]?)(\d{2})(?!\d)/g, (m) => (next(Number(m[1]), Number(m[3])) && !(m[1] === "20" && !m[2]) ? 2000 + Number(m[1]) : null)],
  ];
  for (const [re, start] of tries) {
    for (const m of name.matchAll(re)) {
      const y = start(m);
      const ed = y !== null ? parseEdition(`${y}-${y + 1}`) : null;
      if (ed) return { edition: ed.key, from: "url" };
    }
  }
  return null;
}

/** An inclusive range of 1-based line ids. */
export type LineRange = [LineId, LineId];

export interface CDSplit {
  /** Section C: from the C1 marker to the line before D1. */
  C: LineRange;
  /** Everything else in scope (A, B before C; D–J after). */
  rest: LineRange[];
  /** True when a marker wasn't found: both calls get the whole body. */
  fallback: boolean;
}

const C1 = /^C1(?:\s*[-–]\s*C\d+)?(?:[.:]|\s|$)/;
const D1 = /^D1(?:\s*[-–]\s*D\d+)?(?:[.:]|\s|$)/;

/**
 * The two model calls' parts (Decision 4), split at the first C1 item marker ("C1-C2: Applications", "C1", "C1. First-
 * time…") and the first D1 marker after it. Section order never varied in the sample; when either marker is missing,
 * both calls get the whole body (`fallback`).
 */
export function splitCD(lines: readonly string[]): CDSplit {
  const all: LineRange = [1, Math.max(1, lines.length)];
  const c = lines.findIndex((l) => C1.test(bare(l)));
  const d = c < 0 ? -1 : lines.findIndex((l, i) => i > c && D1.test(bare(l)));
  if (c < 0 || d < 0) return { C: all, rest: [all], fallback: true };
  const rest: LineRange[] = [];
  if (c > 0) rest.push([1, c]);
  rest.push([d + 1, lines.length]);
  return { C: [c + 1, d], rest, fallback: false };
}

/** The page range each section's items were found on (the manifest's `sections`, next year's page hint). */
export function sectionPages(lines: readonly string[], pages: readonly number[]): Partial<Record<CdsSection, [number, number]>> {
  const starts: [CdsSection, number][] = [];
  for (const s of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as CdsSection[]) {
    const re = new RegExp(`^${s}1(?:\\s*[-–]\\s*${s}\\d+)?(?:[.:]|\\s|$)`);
    const at = lines.findIndex((l, i) => (starts.length ? i > starts[starts.length - 1][1] : true) && re.test(bare(l)));
    if (at >= 0) starts.push([s, at]);
  }
  const out: Partial<Record<CdsSection, [number, number]>> = {};
  starts.forEach(([s, at], k) => {
    const end = k + 1 < starts.length ? starts[k + 1][1] : lines.length - 1;
    out[s] = [pages[at], pages[Math.max(at, end)]];
  });
  return out;
}

/** A laid-out document: what the model calls read and what quotes are built from. */
export interface LaidOutDocument {
  /** Body lines (definitions dropped); line id n is `lines[n - 1]`. */
  lines: string[];
  /** The page of each line (PDF page; 1 for HTML; the sheet's position for Excel). */
  pages: number[];
  edition: EditionFound | null;
  split: CDSplit | null;
  /** The page the definitions start on, or null when there are none. */
  definitionsFrom: number | null;
  pageCount: number;
  bodyChars: number;
  sections: Partial<Record<CdsSection, [number, number]>>;
}

/**
 * Numbered text of the given line ranges (the whole body by default), "412: @78 Total … | @450 37,270", with an
 * unnumbered "--- Page 9 ---" marker wherever the page changes.
 */
export function linesFor(doc: Pick<LaidOutDocument, "lines" | "pages">, ranges?: LineRange | LineRange[]): string {
  const list: LineRange[] = !ranges ? [[1, doc.lines.length]] : typeof ranges[0] === "number" ? [ranges as LineRange] : (ranges as LineRange[]);
  const out: string[] = [];
  let page: number | null = null;
  for (const [from, to] of list) {
    for (let id = Math.max(1, from); id <= Math.min(to, doc.lines.length); id++) {
      if (doc.pages[id - 1] !== page) {
        page = doc.pages[id - 1];
        out.push(`--- Page ${page} ---`);
      }
      out.push(`${id}: ${doc.lines[id - 1]}`);
    }
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Grids: marks and lone values under their column headers             */
/* ------------------------------------------------------------------ */

/** A column header: its left x and its text (lines of a wrapped header joined top to bottom). */
export interface Column {
  x: number;
  text: string;
}

/** Cells of different header lines within this many points of each other are one column ("Not" over "Considered"). */
const COLUMN_JOIN = 30;
/** A cell belongs to the rightmost column starting at most this far right of it (marks sit under a header's middle). */
const COLUMN_SLACK = 10;

/** Column headers from one or more header lines (top to bottom); a wrapped header's pieces are joined. */
export function gridColumns(headerLines: string | readonly string[]): Column[] {
  const cols: { xs: number[]; parts: string[] }[] = [];
  for (const line of typeof headerLines === "string" ? [headerLines] : headerLines) {
    for (const c of parseCells(line)) {
      if (!c.text || !Number.isFinite(c.x)) continue;
      const col = cols.find((k) => k.xs.some((x) => Math.abs(x - c.x) <= COLUMN_JOIN));
      if (col) {
        col.xs.push(c.x);
        col.parts.push(c.text);
      } else cols.push({ xs: [c.x], parts: [c.text] });
    }
  }
  return cols.map((k) => ({ x: Math.min(...k.xs), text: k.parts.join(" ") })).sort((a, b) => a.x - b.x);
}

const MARK = /^(?:x|✔|✓|☒|☑|☐|✗)$/i;
/** A check-mark cell: "X", "x", "✔", ☒ (☐ is an unchecked box), or a private-use glyph (Spelman's check font). */
export function isMarkGlyph(text: string): boolean {
  const s = text.trim();
  return MARK.test(s) || (s.length === 1 && s.charCodeAt(0) >= 0xe000 && s.charCodeAt(0) <= 0xf8ff);
}

export interface PlacedCell {
  x: number;
  text: string;
  /** The header the cell sits under, or null when there are no columns. */
  header: string | null;
}

export interface PlacedRow {
  /** The row's label (the leading text cell), or "" when the label is on another line. */
  label: string;
  cells: PlacedCell[];
}

/**
 * Places a line's cells under the header columns: each cell goes to the rightmost column starting no more than 10 pt
 * right of it (a mark at 450 sits under "Considered" at 425, not "Not Considered" at 497). A leading text cell is the
 * row's label, and header cells at the label's x (the grid's own label column, "Academic") aren't columns. `columns`
 * keeps only the rightmost N columns, for grids whose header line starts with a label ("Factors").
 */
export function placeCells(header: string | readonly string[], line: string, opts: { columns?: number } = {}): PlacedRow {
  let cols = gridColumns(header);
  const cells = parseCells(line).filter((c) => c.text && Number.isFinite(c.x));
  let label = "";
  const first = cells[0];
  if (first && cells.length > 1 && !isMarkGlyph(first.text) && parseNumber(first.text) === null && cols.length && first.x <= cols[0].x + COLUMN_JOIN) {
    label = first.text;
    cells.shift();
    cols = cols.filter((c) => c.x > first.x + COLUMN_JOIN);
  }
  if (opts.columns !== undefined) cols = cols.slice(-opts.columns);
  const columnAt = (x: number) => [...cols].reverse().find((c) => c.x <= x + COLUMN_SLACK) ?? cols[0] ?? null;
  return { label, cells: cells.map((c) => ({ x: c.x, text: c.text, header: columnAt(c.x)?.text ?? null })) };
}

export interface GridMarks {
  label: string;
  marks: (PlacedCell & { checked: boolean })[];
  /** Headers of the checked marks: one for a well-formed grid row; none or two send the row to review. */
  checked: string[];
}

/**
 * The check marks of one grid row (C7, C8, D5, F3, H14) under their headers: "X", "x", "✔", ☒, and private-use glyphs
 * are checked; ☐ is an unchecked box.
 */
export function placeGridMarks(header: string | readonly string[], markLine: string, opts: { columns?: number } = {}): GridMarks {
  const row = placeCells(header, markLine, opts);
  const marks = row.cells.filter((c) => isMarkGlyph(c.text)).map((c) => ({ ...c, checked: readMark(c.text) === true }));
  return { label: row.label, marks, checked: marks.filter((m) => m.checked && m.header).map((m) => m.header!) };
}

/**
 * A total printed as "##" (Excel's overflow marks, Loyola's C1 residency rows: "362 ##") summed from the row's printed
 * parts, to be recorded with `method: "derived"`. Null when the row has no overflow mark or no parts.
 */
export function overflowTotal(line: string): { v: number; parts: number[] } | null {
  const cells = parseCells(line);
  const tokens = cells.slice(1).flatMap((c) => c.text.split(/\s+/)).filter(Boolean);
  if (!tokens.some((t) => normalizeValue({ value_type: "count" }, t).status === "overflow")) return null;
  const parts = tokens.map((t) => parseNumber(t)).filter((n): n is number => n !== null);
  return parts.length ? { v: parts.reduce((a, b) => a + b, 0), parts } : null;
}

/* ------------------------------------------------------------------ */
/* Laying out a document                                               */
/* ------------------------------------------------------------------ */

/** Lines and their pages from PDF text items: one line per row, tagged with `@x`. */
export function linesFromItems(pages: readonly TextItem[][]): { lines: string[]; pages: number[] } {
  const lines: string[] = [];
  const pageOf: number[] = [];
  pages.forEach((items, i) => {
    for (const row of rowsFromItems(items)) {
      lines.push(formatRow(row));
      pageOf.push(i + 1);
    }
  });
  return { lines, pages: pageOf };
}

/** Lines of an older or custom workbook: a "Sheet CDS-C" line, then each row with cell tags and empty cells kept. */
export function linesFromWorkbookBytes(bytes: Uint8Array): { lines: string[]; pages: number[] } {
  const dir = mkdtempSync(join(tmpdir(), "cds-xlsx-"));
  try {
    const file = join(dir, "book.xlsx");
    writeFileSync(file, bytes);
    const book = readWorkbook(file);
    const lines: string[] = [];
    const pages: number[] = [];
    let n = 0;
    for (const [name, sheet] of book) {
      if (/DEFINITION|WELCOME/i.test(name)) continue;
      n++;
      for (const l of [`Sheet ${name}`, ...classicSheetText(sheet).split("\n").filter(Boolean)]) {
        lines.push(l);
        pages.push(n);
      }
    }
    return { lines, pages };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Lays out a model-read document: PDF rows by position (from bytes, or from text items already read), an older
 * workbook's sheets with cell tags, or an HTML page's text with empty cells kept; then drops the definitions, numbers
 * the body, finds the edition, and splits it for the two calls. Template workbooks and form PDFs never come here:
 * their readers need no model.
 */
export async function layoutDocument(input: Uint8Array | readonly TextItem[][], type: DocumentType): Promise<LaidOutDocument> {
  let all: { lines: string[]; pages: number[] };
  if (type === "pdf-flat" || type === "pdf-scanned") {
    all = linesFromItems(input instanceof Uint8Array ? await pdfTextItems(input) : input);
  } else if (input instanceof Uint8Array && type === "xlsx-classic") {
    all = linesFromWorkbookBytes(input);
  } else if (input instanceof Uint8Array && (type === "html" || type === "class-profile")) {
    const lines = htmlToText(new TextDecoder().decode(input)).split("\n");
    all = { lines, pages: lines.map(() => 1) };
  } else {
    throw new Error(`layoutDocument: can't lay out a ${type} document from ${input instanceof Uint8Array ? "bytes" : "text items"}`);
  }
  const at = definitionsStart(all.lines);
  const lines = at === null ? all.lines : all.lines.slice(0, at);
  const pages = all.pages.slice(0, lines.length);
  return {
    lines,
    pages,
    edition: editionFromBody(lines, pages),
    split: lines.length ? splitCD(lines) : null,
    definitionsFrom: at === null ? null : all.pages[at],
    pageCount: all.pages.length ? Math.max(...all.pages) : 0,
    bodyChars: lines.reduce((n, l) => n + l.length + 1, 0),
    sections: sectionPages(lines, pages),
  };
}
