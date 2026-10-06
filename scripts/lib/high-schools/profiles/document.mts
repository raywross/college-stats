/**
 * A fetched school profile as numbered lines for the model (and for the hand-read answer key): PDFs keep their layout
 * (rows by position, cells joined with " | ", pages marked), HTML pages become text. The model cites line ids; quotes
 * are built from those lines by our code (lib/cds-quotes.ts), so every quote is the document's own text.
 *
 * `looksLikeProfile` is the gate a candidate document must pass before any model reads it: it names the school and
 * carries at least two of a profile's markers (a CEEB code, a GPA, AP or IB, SAT/ACT, a class of a year, "profile").
 */
import { pdfTextItems, linesFromItems, type TextItem } from "../../college-reported/layout.mts";
import { htmlToText } from "../../college-reported/documents.mts";
import { isPdfBytes } from "../../college-reported/doctype.mts";
import { lineText, type NumberedLine } from "../../../../lib/cds-quotes.ts";

/** Profiles run one to six pages; a longer PDF is cut here (a handbook or a course catalog is not a profile). */
export const MAX_PAGES = 8;
export const MAX_LINES = 1500;

export interface ProfileDocument {
  format: "pdf" | "html";
  lines: NumberedLine[];
  pageCount: number;
  /** Characters of text (0 for a scanned PDF without a text layer). */
  chars: number;
}

export function numberLines(rows: { text: string; page: number }[]): NumberedLine[] {
  return rows
    .filter((r) => lineText(r.text).trim())
    .slice(0, MAX_LINES)
    .map((r, i) => ({ id: i + 1, page: r.page, text: r.text }));
}

/** Lines from PDF text items (pages already read), first MAX_PAGES pages. */
export function linesFromPdfItems(pages: readonly TextItem[][]): NumberedLine[] {
  const { lines, pages: pageOf } = linesFromItems(pages.slice(0, MAX_PAGES));
  return numberLines(lines.map((text, i) => ({ text, page: pageOf[i] })));
}

export function linesFromHtml(html: string): NumberedLine[] {
  return numberLines(htmlToText(html).split("\n").map((text) => ({ text, page: 1 })));
}

export async function readProfileDocument(bytes: Uint8Array, contentType = ""): Promise<ProfileDocument> {
  if (isPdfBytes(bytes)) {
    const pages = await pdfTextItems(bytes);
    const lines = linesFromPdfItems(pages);
    return { format: "pdf", lines, pageCount: pages.length, chars: lines.reduce((n, l) => n + lineText(l.text).length, 0) };
  }
  if (/html|text/i.test(contentType) || /<html|<body|<!doctype/i.test(new TextDecoder().decode(bytes.subarray(0, 2048)))) {
    const lines = linesFromHtml(new TextDecoder().decode(bytes));
    return { format: "html", lines, pageCount: 1, chars: lines.reduce((n, l) => n + lineText(l.text).length, 0) };
  }
  throw new Error(`not a PDF or HTML document (${contentType || "unknown type"})`);
}

/** The document's plain text, lines joined (tags stripped). */
export function documentText(lines: readonly NumberedLine[]): string {
  return lines.map((l) => lineText(l.text)).join("\n");
}

/** Lines rendered for the model: "--- Page N ---" markers and "id| text". */
export function renderProfileLines(lines: readonly NumberedLine[]): string {
  const out: string[] = [];
  let page: number | null = null;
  for (const l of lines) {
    if (l.page !== page) {
      out.push(`--- Page ${l.page} ---`);
      page = l.page;
    }
    out.push(`${l.id}| ${l.text}`);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Is it this school's profile?                                         */
/* ------------------------------------------------------------------ */

const STOP = new Set(["high", "school", "the", "of", "and", "for", "at", "h", "s", "hs", "academy", "secondary", "senior", "charter", "upper", "preparatory", "prep", "college", "early", "a", "in", "de", "la", "el", "st", "saint"]);

/** The distinctive words of a school's name ("FORT HAMILTON HIGH SCHOOL" → fort, hamilton). */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Share of the school's distinctive name words found in `text` (1 when the name has none: nothing to test). */
export function nameCoverage(schoolName: string, text: string): number {
  const toks = nameTokens(schoolName);
  if (!toks.length) return 1;
  const hay = ` ${text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ")} `;
  return toks.filter((t) => hay.includes(` ${t} `)).length / toks.length;
}

export const PROFILE_MARKERS: { key: string; re: RegExp }[] = [
  { key: "profile", re: /\bprofile\b/i },
  { key: "ceeb", re: /\bCEEB\b|\bschool code\b|\bCB code\b|\bACT code\b/i },
  { key: "gpa", re: /\bGPA\b|grade point/i },
  { key: "ap-ib", re: /\bAdvanced Placement\b|\bAP\b|\bIB\b|International Baccalaureate/ },
  { key: "tests", re: /\bSAT\b|\bACT\b|\bPSAT\b/ },
  { key: "class-of", re: /class of 20\d\d|graduating class|senior class/i },
  { key: "colleges", re: /college acceptances|matriculat|colleges? (?:attended|admitted|accepted)|where (?:our )?graduates/i },
];

export interface ProfileGate {
  ok: boolean;
  markers: string[];
  name_coverage: number;
  reason?: string;
}

/** Whether a document is plausibly this school's profile (before any model call). */
export function looksLikeProfile(doc: Pick<ProfileDocument, "lines" | "chars" | "pageCount"> & { format?: ProfileDocument["format"] }, schoolName: string): ProfileGate {
  if (doc.chars < 200) return { ok: false, markers: [], name_coverage: 0, reason: doc.pageCount ? "no text layer (scanned PDF?)" : "empty document" };
  const text = documentText(doc.lines);
  const markers = PROFILE_MARKERS.filter((m) => m.re.test(text)).map((m) => m.key);
  const name_coverage = nameCoverage(schoolName, text);
  if (name_coverage < 0.5) return { ok: false, markers, name_coverage, reason: "doesn't name this school" };
  if (markers.length < 3) return { ok: false, markers, name_coverage, reason: `only ${markers.length} profile marker(s)` };
  // Web pages carry navigation and news that hit markers by chance (a district's school page): ask for more.
  if (doc.format === "html" && (markers.length < 4 || !markers.includes("gpa") || !markers.includes("class-of"))) {
    return { ok: false, markers, name_coverage, reason: `a web page with markers ${markers.join(", ")}: not enough for a profile page` };
  }
  return { ok: true, markers, name_coverage };
}
