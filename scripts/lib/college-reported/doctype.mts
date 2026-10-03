/**
 * The document type, decided from the bytes, never the URL (specs/college-reported-round-3.md, Decision 3):
 *
 * | Bytes | Evidence | Type | Reader | Model? |
 * |---|---|---|---|---|
 * | `PK` | sheets CDS-A … CDS-J plus ANSWER SHEET | `xlsx-template` | code tables (cds-xlsx.mts readTemplate) | no |
 * | `PK` | anything else | `xlsx-classic` | layout lines with cell tags | yes |
 * | `%PDF` | filled form widgets | `pdf-form` | widgets → tags → codes (form-pdf.mts) | no |
 * | `%PDF` | under 200 text characters, no widgets | `pdf-scanned` | the whole file as a document block | yes |
 * | `%PDF` | otherwise | `pdf-flat` | layout lines (layout.mts) | yes |
 * | other | — | `html` | text with empty cells kept | yes |
 *
 * A fillable form's text layer holds labels only, so it passes the 200-character "not scanned" test: the pilot's
 * extraction for Howard (131520) sent a model a form with no answers and got all nulls. Filled widgets decide first.
 * `class-profile` is the recipe's `kind`, not something the bytes say.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentType } from "../../../lib/cds-sections.ts";
import { isTemplateWorkbook, readWorkbook, type Workbook } from "../cds-xlsx.mts";
import { SCANNED_TEXT_CHARS } from "./documents.mts";

/** What the reader saw of a PDF: pages, characters in its text layer, and form widgets (all, and those with a value). */
export interface PdfInspection {
  pages: number;
  textChars: number;
  widgets: number;
  filledWidgets: number;
}

export interface TypeEvidence {
  /** A workbook's sheets (or their upper-cased names): required for `PK` bytes. */
  sheets?: Workbook | readonly string[];
  /** Widgets with a value: required for `%PDF` bytes. */
  widgets?: number;
  /** Characters in the PDF's text layer: required for `%PDF` bytes. */
  textChars?: number;
}

const head = (bytes: Uint8Array, n: number) => Buffer.from(bytes.subarray(0, n)).toString("latin1");

/** `%PDF` within the first 1 KB (some servers prepend junk; readers accept that). */
export const isPdfBytes = (bytes: Uint8Array) => head(bytes, 1024).includes("%PDF");
export const isZipBytes = (bytes: Uint8Array) => head(bytes, 2) === "PK";

/** The document type from the bytes and what a reader found in them. Throws when the evidence a type needs is missing. */
export function detectDocumentType(bytes: Uint8Array, evidence: TypeEvidence = {}): DocumentType {
  if (isZipBytes(bytes)) {
    const { sheets } = evidence;
    if (!sheets) throw new Error("detectDocumentType: a workbook needs its sheet names");
    const book: Pick<Workbook, "has"> = sheets instanceof Map ? sheets : new Set((sheets as readonly string[]).map((s) => s.trim().toUpperCase()));
    return isTemplateWorkbook(book as Workbook) ? "xlsx-template" : "xlsx-classic";
  }
  if (isPdfBytes(bytes)) {
    const { widgets, textChars } = evidence;
    if (widgets === undefined || textChars === undefined) throw new Error("detectDocumentType: a PDF needs its widget and text counts");
    if (widgets > 0) return "pdf-form";
    return textChars < SCANNED_TEXT_CHARS ? "pdf-scanned" : "pdf-flat";
  }
  return "html";
}

/** Types read entirely by code: never sent to a model, on the first read or any re-read (Decision 3). */
export const DETERMINISTIC_TYPES: ReadonlySet<DocumentType> = new Set(["xlsx-template", "pdf-form"]);

/** Whether a document of this type goes to the model calls (Decision 4). */
export const needsModel = (type: DocumentType) => !DETERMINISTIC_TYPES.has(type);

/** A widget annotation counts as filled when it holds a value: text, a checked box, or a selected radio button. */
export function widgetFilled(a: {
  fieldType?: string;
  fieldValue?: unknown;
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: unknown;
}): boolean {
  const v = Array.isArray(a.fieldValue) ? a.fieldValue.join("") : a.fieldValue;
  if (v === undefined || v === null || String(v).trim() === "" || v === "Off") return false;
  if (a.radioButton) return String(v).trim() === String(a.buttonValue ?? "").trim();
  return true;
}

/** Pages, text-layer characters, and widgets of a PDF, via pdf.js (`getAnnotations`; `getFieldObjects` saw none in Howard's form). */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  let textChars = 0;
  let widgets = 0;
  let filledWidgets = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    for (const it of (await page.getTextContent()).items) if ("str" in it) textChars += it.str.replace(/\s+/g, "").length;
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Widget") continue;
      widgets++;
      if (widgetFilled(a)) filledWidgets++;
    }
  }
  const pages = doc.numPages;
  await task.destroy();
  return { pages, textChars, widgets, filledWidgets };
}

/** The sheet names of a workbook held in memory (readWorkbook reads from disk, so the bytes go to a temporary file). */
export function workbookFromBytes(bytes: Uint8Array): Workbook {
  const dir = mkdtempSync(join(tmpdir(), "cds-type-"));
  try {
    const file = join(dir, "book.xlsx");
    writeFileSync(file, bytes);
    return readWorkbook(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Reads what the type needs from the bytes and decides it: the one call a pipeline makes per new document. */
export async function typeOfDocument(bytes: Uint8Array): Promise<{ type: DocumentType; pdf?: PdfInspection; book?: Workbook }> {
  if (isZipBytes(bytes)) {
    const book = workbookFromBytes(bytes);
    return { type: detectDocumentType(bytes, { sheets: book }), book };
  }
  if (isPdfBytes(bytes)) {
    const pdf = await inspectPdf(bytes);
    return { type: detectDocumentType(bytes, { widgets: pdf.filledWidgets, textChars: pdf.textChars }), pdf };
  }
  return { type: "html" };
}
