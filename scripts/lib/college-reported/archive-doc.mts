/**
 * The owner's manual document drop (specs/college-reported-round-3.md Decision 8): a file a person downloaded in a
 * browser (a blocked host, a share link the resolvers can't open) goes into the archive and the manifest exactly as a
 * fetch would, with `retrieved` set to the day it was added. A 2025–26 template workbook is read at once into the
 * college's record (no model); any other type waits in the archive for the pipeline's next run to extract it.
 * CLI: scripts/archive-doc.mts (`npm run archive-doc`).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocumentRecord, DocumentType, ManifestEntry, TemplateTable } from "../../../lib/cds-sections.ts";
import type { School } from "../../../lib/types.ts";
import { applyChecks } from "../../../lib/cds-checks.ts";
import { restoreFederal } from "../../../lib/newest.ts";
import { findBySha, manifestEntryFor } from "../../../lib/cds-reads.ts";
import type { CdsUrlEntry, CdsUrlsFile } from "../../../lib/reported.ts";
import { isTemplateWorkbook, readWorkbook, recordFromTemplate, workbookEdition, type Workbook } from "../cds-xlsx.mts";
import type { Archive } from "./archive.mts";
import { SCANNED_TEXT_CHARS } from "./documents.mts";
import { sha256 } from "./http.mts";
import { readManifest, upsertDocument, upsertManifest } from "./records.mts";

/** What the bytes say about a document, before any reader runs. */
export interface Sniffed {
  type: DocumentType;
  /** PDFs: page count, text characters, first page of the "Common Data Set Definitions", the cover's edition. */
  pages?: number;
  body_chars?: number;
  definitions_from_page?: number;
  edition?: string;
  /** Excel: the parsed workbook. */
  book?: Workbook;
}

/** Filled widgets above this make a PDF a fillable form (Howard: 759 filled of 1,263). */
const FORM_WIDGETS = 10;

/**
 * The document type from the bytes, never the URL (Decision 3). Minimal: `%PDF` → form (filled widgets) / scanned
 * (under 200 characters of text) / flat; `PK` → template workbook (CDS-A…J + ANSWER SHEET) or classic; else HTML.
 * TODO(cds3-readers): replace with scripts/lib/college-reported/doctype.mts when the readers track lands; keep this
 * signature's result shape (type, pages, body_chars, definitions_from_page, edition) for the manifest.
 */
export async function sniffType(bytes: Uint8Array, opts: { file: string; kind: ManifestEntry["kind"] }): Promise<Sniffed> {
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  if (head.startsWith("%PDF")) return sniffPdf(bytes);
  if (head.startsWith("PK")) {
    const book = readWorkbook(opts.file);
    return { type: isTemplateWorkbook(book) ? "xlsx-template" : "xlsx-classic", book };
  }
  return { type: opts.kind === "class-profile" ? "class-profile" : "html" };
}

const COVER_EDITION = /common\s+data\s+set[\s:]*(20\d\d)\s*[-–_/]\s*(?:20)?(\d\d)(?!\d)/i;

async function sniffPdf(bytes: Uint8Array): Promise<Sniffed> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  let chars = 0;
  let filled = 0;
  let definitions: number | undefined;
  let edition: string | undefined;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const text = (await page.getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" ");
    chars += text.replace(/\s+/g, "").length;
    if (definitions === undefined && /common\s+data\s+set\s+definitions/i.test(text)) definitions = p;
    if (!edition && p <= 2) {
      const m = COVER_EDITION.exec(text);
      if (m && Number(m[2]) === (Number(m[1]) + 1) % 100) edition = `${m[1]}-${m[2]}`;
    }
    for (const a of (await page.getAnnotations()) as { subtype?: string; fieldValue?: unknown }[]) {
      const v = a.fieldValue;
      if (a.subtype === "Widget" && v !== undefined && v !== null && v !== "" && v !== "Off") filled++;
    }
  }
  const pages = doc.numPages;
  await task.destroy();
  const type: DocumentType = filled >= FORM_WIDGETS ? "pdf-form" : chars < SCANNED_TEXT_CHARS ? "pdf-scanned" : "pdf-flat";
  return { type, pages, body_chars: chars, ...(definitions ? { definitions_from_page: definitions } : {}), ...(edition ? { edition } : {}) };
}

export const extOf = (type: DocumentType) => (type.startsWith("xlsx") ? "xlsx" : type.startsWith("pdf") ? "pdf" : "html");

export interface ArchiveDocOptions {
  unit_id: string;
  /** The downloaded file on disk. */
  file: string;
  /** Where the college publishes it (the link a fetch would have used). */
  url: string;
  kind?: ManifestEntry["kind"];
  /** "2025-26", when the document doesn't say (or says wrong). */
  edition?: string;
  /** ISO date the person downloaded it (default today). */
  retrieved?: string;
  /** Also list the URL in data/reference/cds-urls.json (the owner's list, discovery step 0). */
  addUrl?: boolean;
  note?: string;
  /** Holds college-docs.json, cds-records/, reference/cds-urls.json (the repo's data/ by default). */
  dataDir: string;
  archive: Archive;
  table: TemplateTable;
  /** The college as in data/schools.json, for the checks that compare against federal values; null skips those. */
  school?: School | null;
  /** ISO date for the manifest's `updated` (default: retrieved). */
  today?: string;
}

export interface ArchiveDocResult {
  entry: ManifestEntry;
  /** The record document, when the type has a deterministic reader that ran (template workbook). */
  record: DocumentRecord | null;
  /** Whether the URL was newly added to cds-urls.json. */
  addedUrl: boolean;
}

/** Archives one file, lists it in the manifest, and reads it when a deterministic reader exists. Re-running is a no-op change. */
export async function archiveDoc(o: ArchiveDocOptions): Promise<ArchiveDocResult> {
  const retrieved = o.retrieved ?? new Date().toISOString().slice(0, 10);
  const kind = o.kind ?? "cds";
  const manifestFile = join(o.dataDir, "college-docs.json");
  const bytes = new Uint8Array(readFileSync(o.file));
  const sha = sha256(bytes);
  const prior = findBySha(readManifest(manifestFile), sha);
  if (prior && prior.unit_id !== o.unit_id) throw new Error(`${o.file} is already archived for college ${prior.unit_id}`);

  const sniffed = await sniffType(bytes, { file: o.file, kind });
  const location = await o.archive.put(sha, bytes, extOf(sniffed.type));

  let record: DocumentRecord | null = null;
  let edition: string | null = o.edition ?? sniffed.edition ?? null;
  let editionFrom: ManifestEntry["edition_from"] = o.edition ? "manual" : sniffed.edition ? "cover" : undefined;
  if (sniffed.type === "xlsx-template") {
    // The same read and the same per-item checks as scripts/cds-records-from-workbooks.mts, so a dropped file and a
    // fetched one produce identical records.
    const read = recordFromTemplate(sniffed.book!, { unit_id: o.unit_id, url: o.url, sha256: sha, retrieved, table: o.table, edition: o.edition });
    record = applyChecks(read, { table: o.table, school: o.school ? restoreFederal(o.school) : null });
    edition = record.edition;
    editionFrom = o.edition ? "manual" : workbookEdition(sniffed.book!) ? "workbook" : "items";
    upsertDocument(join(o.dataDir, "cds-records"), o.unit_id, record);
  }
  const entry = manifestEntryFor({
    sha256: sha,
    unit_id: o.unit_id,
    url: o.url,
    kind,
    type: sniffed.type,
    edition,
    edition_from: editionFrom,
    retrieved,
    bytes: bytes.length,
    pages: sniffed.pages,
    body_chars: sniffed.body_chars,
    definitions_from_page: sniffed.definitions_from_page,
    archive: location,
  });
  upsertManifest(manifestFile, entry, o.today ?? retrieved);
  const addedUrl = o.addUrl ? addOwnerUrl(join(o.dataDir, "reference", "cds-urls.json"), { unit_id: o.unit_id, url: o.url, kind, ...(o.note ? { note: o.note } : {}), added: retrieved }) : false;
  return { entry, record, addedUrl };
}

/** Adds an entry to the owner's list unless the same college + URL is there; one entry per line, sorted by college. */
export function addOwnerUrl(file: string, entry: CdsUrlEntry): boolean {
  const f: CdsUrlsFile = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { entries: [] };
  if (f.entries.some((e) => e.unit_id === entry.unit_id && e.url === entry.url)) return false;
  const entries = [...f.entries, entry].sort((a, b) => a.unit_id.localeCompare(b.unit_id) || a.added.localeCompare(b.added));
  const body = entries.map((e) => `    ${JSON.stringify(e)}`).join(",\n");
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `{\n  "entries": [\n${body}\n  ]\n}\n`);
  renameSync(tmp, file);
  return true;
}
