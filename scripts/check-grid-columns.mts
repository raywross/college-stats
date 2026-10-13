/**
 * Places every model-read C7 and C8A mark under its column heading from the document's own layout
 * (lib/grid-columns.ts), and records the result on the item (`column`): the heading, the model's reading when it
 * differed, and the date. A differing reading is corrected to the heading. Rows it can't place are left alone, and the
 * grid-column check holds them. No model call.
 *
 *   npm run check-grid-columns [-- --unit <unit_id>] [--dry-run]
 *
 * Needs `pdftotext` (poppler) on the PATH. Each PDF comes from the local archive (.cache/college-docs/archive) or is
 * fetched again from its URL and used only when its sha256 is the one the record was read from. Then run
 * `npm run check-cds-records` to re-judge, and the usual rebuilds.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { c7Level, isModelRead } from "../lib/cds-checks.ts";
import { policyFromText } from "../lib/test-policy.ts";
import { gridColumns } from "../lib/grid-columns.ts";
import type { DocumentRecord } from "../lib/cds-sections.ts";
import { readRecords, writeRecord } from "./lib/college-reported/records.mts";
import { readWorkbook } from "./lib/cds-xlsx.mts";
import { USER_AGENT, sha256 } from "./lib/college-reported/http.mts";

const ROOT = join(import.meta.dirname, "..");
const RECORDS = join(ROOT, "data", "cds-records");
const ARCHIVE = join(ROOT, ".cache", "college-docs", "archive");
const GRID = /^C\.(7(0[1-9]|1[0-8])|80[2-4])$/;
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

function layoutLines(bytes: Uint8Array): string[] | null {
  try {
    return execFileSync("pdftotext", ["-layout", "-", "-"], { input: bytes, maxBuffer: 1 << 28 }).toString().split("\n");
  } catch {
    return null;
  }
}

/**
 * A workbook as layout text: every cell centered in a fixed-width slot for its column, so a heading cell and the mark
 * cells under it line up exactly, as they do in the sheet. Sheets are separated like PDF pages.
 */
const SLOT = 64;
const colNumber = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function workbookLines(bytes: Uint8Array, sha: string): string[] {
  const file = join(ARCHIVE, `${sha}.xlsx`);
  writeFileSync(file, bytes);
  const out: string[] = [];
  for (const sheet of readWorkbook(file).values()) {
    out.push("\f");
    for (const r of [...sheet.keys()].sort((a, b) => a - b)) {
      let line = "";
      for (const c of sheet.get(r)!) {
        const text = String(c.value).replace(/\s+/g, " ").trim().slice(0, SLOT - 4);
        // Grids sit in the first few dozen columns; a stray cell far to the right would make a megabyte-long line.
        if (!text || colNumber(c.col) > 60) continue;
        const start = colNumber(c.col) * SLOT + Math.floor((SLOT - text.length) / 2);
        line = line.padEnd(start) + text;
      }
      out.push(line);
    }
  }
  return out;
}

/** Whether the model's reading meant the same answer as the heading ("Recommend" and "Recommended" do). */
function sameAnswer(code: string, read: unknown, heading: string): boolean {
  if (typeof read !== "string") return false;
  return code.startsWith("C.7") ? c7Level(read) === c7Level(heading) : policyFromText(read) === policyFromText(heading);
}

const tally = { documents: 0, confirmed: 0, corrected: 0, unplaced: 0, skipped: 0 };
for (const record of readRecords(RECORDS)) {
  if (values.unit && record.unit_id !== values.unit) continue;
  let changed = false;
  for (const doc of record.documents) {
    const codes = Object.keys(doc.items).filter((k) => GRID.test(k) && doc.items[k].v !== undefined && isModelRead(doc, k, CDS_TEMPLATE));
    if (!codes.length) continue;
    tally.documents++;
    const label = `${record.unit_id} ${doc.edition}`;
    const workbook = doc.type.startsWith("xlsx");
    if (!doc.type.startsWith("pdf") && !workbook) {
      tally.skipped += codes.length;
      console.log(`${label}: ${doc.type}, not a PDF or workbook; ${codes.length} marks left held`);
      continue;
    }
    const bytes = await docBytes(doc);
    const lines = typeof bytes === "string" ? null : workbook ? workbookLines(bytes, doc.sha256) : layoutLines(bytes);
    if (!lines) {
      tally.skipped += codes.length;
      console.log(`${label}: ${typeof bytes === "string" ? bytes : "no text layer"}; ${codes.length} marks left held`);
      continue;
    }
    const placed = gridColumns(lines);
    const notes: string[] = [];
    for (const code of codes) {
      const heading = placed.get(code);
      const it = doc.items[code];
      if (!heading) {
        tally.unplaced++;
        continue;
      }
      const read = it.column?.read ?? it.v;
      const failures = it.failures?.filter((f) => f.check !== "misread");
      doc.items[code] = { ...it, v: heading, column: { heading, ...(read !== heading ? { read } : {}), checked: today } };
      if (failures?.length) doc.items[code].failures = failures;
      else delete doc.items[code].failures;
      changed = true;
      if (!sameAnswer(code, read, heading)) {
        tally.corrected++;
        notes.push(`${code} ${JSON.stringify(read)} → ${JSON.stringify(heading)}`);
      } else tally.confirmed++;
    }
    console.log(`${label}: ${codes.length} marks, ${notes.length} corrected${notes.length ? `: ${notes.join("; ")}` : ""}`);
  }
  if (changed && !values["dry-run"]) writeRecord(RECORDS, record);
}
console.log(JSON.stringify(tally));
