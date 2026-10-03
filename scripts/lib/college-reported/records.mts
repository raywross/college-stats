/**
 * Reading and writing round 3's committed records (specs/college-reported-round-3.md Decisions 1–2; shapes in
 * lib/cds-sections.ts): data/cds-records/<unit_id>.json, one file per college, and the manifest
 * data/college-docs.json. Key order is fixed and items are in template order, one per line, so a run's diff shows
 * exactly which values changed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compareCodes, type CollegeDocsFile, type CollegeRecord, type DocumentRecord, type ItemResult, type ManifestEntry } from "../../../lib/cds-sections.ts";
import { compareDocuments } from "../../../lib/cds-records.ts";
import { linesJson } from "./files.mts";

function write(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Every record in a directory (empty when the directory doesn't exist yet). */
export function readRecords(dir: string): CollegeRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort()
    .map((f) => {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as CollegeRecord;
      if (`${rec.unit_id}.json` !== f) throw new Error(`${f}: file name doesn't match unit_id ${rec.unit_id}`);
      return rec;
    });
}

export function readRecord(dir: string, unitId: string): CollegeRecord | null {
  const file = join(dir, `${unitId}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CollegeRecord) : null;
}

const ITEM_KEYS: (keyof ItemResult)[] = ["v", "status", "page", "line", "lines", "cell", "field", "quote", "method", "failures", "form"];
const DOC_KEYS: (keyof DocumentRecord)[] = ["sha256", "edition", "type", "url", "final_url", "retrieved", "reads", "years"];

const ordered = <T extends object>(o: T, keys: (keyof T)[]) =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** A record as text: fixed key order, documents newest first, items in template order, one item per line. */
export function serializeRecord(record: CollegeRecord): string {
  const docs = [...record.documents].sort(compareDocuments).map((doc) => {
    const head = JSON.stringify(ordered(doc, DOC_KEYS));
    const items = Object.keys(doc.items)
      .sort(compareCodes)
      .map((code) => `      ${JSON.stringify(code)}: ${JSON.stringify(ordered(doc.items[code], ITEM_KEYS))}`);
    return `    ${head.slice(0, -1)}, "items": {\n${items.join(",\n")}\n    } }`;
  });
  return `{ "unit_id": ${JSON.stringify(record.unit_id)}, "documents": [\n${docs.join(",\n")}\n] }\n`;
}

/** Writes one college's record to <dir>/<unit_id>.json, replacing the file. */
export function writeRecord(dir: string, record: CollegeRecord): string {
  const file = join(dir, `${record.unit_id}.json`);
  write(file, serializeRecord(record));
  return file;
}

/** Adds or replaces one document in a college's record (by sha256) and writes it. */
export function upsertDocument(dir: string, unitId: string, doc: DocumentRecord): CollegeRecord {
  const rec = readRecord(dir, unitId) ?? { unit_id: unitId, documents: [] };
  rec.documents = [...rec.documents.filter((d) => d.sha256 !== doc.sha256), doc].sort(compareDocuments);
  writeRecord(dir, rec);
  return rec;
}

/* ------------------------------------------------------------------ */
/* The manifest                                                        */
/* ------------------------------------------------------------------ */

export function readManifest(file: string): CollegeDocsFile {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CollegeDocsFile) : { updated: null, documents: [] };
}

const MANIFEST_KEYS: (keyof ManifestEntry)[] = [
  "sha256", "unit_id", "url", "final_url", "kind", "type", "edition", "edition_from", "retrieved", "bytes", "pages",
  "body_chars", "definitions_from_page", "sections", "archive",
];

/** One document per line, sorted by college, then newest edition first. */
export function writeManifest(file: string, f: CollegeDocsFile) {
  const docs = [...f.documents]
    .sort((a, b) => a.unit_id.localeCompare(b.unit_id) || (b.edition ?? "").localeCompare(a.edition ?? "") || a.sha256.localeCompare(b.sha256))
    .map((d) => ordered(d, MANIFEST_KEYS));
  write(file, linesJson(f.updated, "documents", docs));
}

/** Adds or replaces (by sha256) one manifest entry. */
export function upsertManifest(file: string, entry: ManifestEntry, updated: string): CollegeDocsFile {
  const f = readManifest(file);
  const next = { updated, documents: [...f.documents.filter((d) => d.sha256 !== entry.sha256), entry] };
  writeManifest(file, next);
  return next;
}
