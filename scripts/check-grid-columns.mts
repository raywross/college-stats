/**
 * Places every model-read C7 and C8A mark in the committed records under its column heading from the document's own
 * layout (scripts/lib/college-reported/grid-place.mts; the pipeline does the same right after each read), and records
 * the result on the item (`column`). A differing reading is corrected to the heading. Rows it can't place are left
 * alone, and the grid-column check holds them. No model call.
 *
 *   npm run check-grid-columns [-- --unit <unit_id>] [--dry-run]
 *
 * Needs `pdftotext` (poppler) on the PATH. Each document comes from the local archive (.cache/college-docs/archive) or
 * is fetched again from its URL and used only when its sha256 is the one the record was read from. Then run
 * `npm run check-cds-records` to re-judge, and the usual rebuilds.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import type { DocumentRecord } from "../lib/cds-sections.ts";
import { readRecords, writeRecord } from "./lib/college-reported/records.mts";
import { USER_AGENT, sha256 } from "./lib/college-reported/http.mts";
import { gridCodes, gridLayout, placeGridMarks } from "./lib/college-reported/grid-place.mts";

const ROOT = join(import.meta.dirname, "..");
const RECORDS = join(ROOT, "data", "cds-records");
const ARCHIVE = join(ROOT, ".cache", "college-docs", "archive");
const today = new Date().toISOString().slice(0, 10);

const { values } = parseArgs({ options: { unit: { type: "string" }, "dry-run": { type: "boolean", default: false } } });

/** The document's bytes: the local archive copy, or a fresh fetch that still hashes to the record's sha256. */
async function docBytes(doc: DocumentRecord): Promise<Uint8Array | string> {
  const cached = join(ARCHIVE, `${doc.sha256}.${doc.type.startsWith("xlsx") ? "xlsx" : "pdf"}`);
  if (existsSync(cached)) return new Uint8Array(readFileSync(cached));
  const url = doc.final_url ?? doc.url;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return `HTTP ${res.status}`;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (sha256(bytes) !== doc.sha256) return "the file at its URL has changed since it was read";
    mkdirSync(ARCHIVE, { recursive: true });
    writeFileSync(cached, bytes);
    return bytes;
  } catch (err) {
    return `fetch failed (${(err as Error).message})`;
  }
}

const tally = { documents: 0, confirmed: 0, corrected: 0, unplaced: 0, skipped: 0 };
for (const record of readRecords(RECORDS)) {
  if (values.unit && record.unit_id !== values.unit) continue;
  let changed = false;
  for (let i = 0; i < record.documents.length; i++) {
    const doc = record.documents[i];
    const codes = gridCodes(doc, CDS_TEMPLATE);
    if (!codes.length) continue;
    tally.documents++;
    const label = `${record.unit_id} ${doc.edition}`;
    if (!doc.type.startsWith("pdf") && !doc.type.startsWith("xlsx")) {
      tally.skipped += codes.length;
      console.log(`${label}: ${doc.type}, not a PDF or workbook; ${codes.length} marks left held`);
      continue;
    }
    const bytes = await docBytes(doc);
    const lines = typeof bytes === "string" ? null : gridLayout(bytes, doc.type);
    if (!lines) {
      tally.skipped += codes.length;
      console.log(`${label}: ${typeof bytes === "string" ? bytes : "no layout text"}; ${codes.length} marks left held`);
      continue;
    }
    const p = placeGridMarks(doc, lines, CDS_TEMPLATE, today);
    if (p.confirmed || p.corrected.length) (record.documents[i] = p.doc), (changed = true);
    tally.confirmed += p.confirmed;
    tally.corrected += p.corrected.length;
    tally.unplaced += p.unplaced;
    console.log(`${label}: ${codes.length} marks, ${p.corrected.length} corrected${p.corrected.length ? `: ${p.corrected.join("; ")}` : ""}`);
  }
  if (changed && !values["dry-run"]) writeRecord(RECORDS, record);
}
console.log(JSON.stringify(tally));
