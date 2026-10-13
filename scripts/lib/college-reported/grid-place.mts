/**
 * Places a document's model-read C7 and C8A marks under their column headings (lib/grid-columns.ts) and records the
 * result on each item (`column`), correcting a value read under the wrong column. Used by the pipeline right after a
 * model read (phases.mts, before the checks) and by `npm run check-grid-columns` over the committed records. A mark it
 * can't place is left as read, and the grid-column check holds it.
 *
 * Layout text: `pdftotext -layout` for a PDF (poppler; the workflow installs it), the cells for a workbook. Without
 * pdftotext, nothing is placed and the marks stay held, as before this step existed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentRecord, TemplateTable } from "../../../lib/cds-sections.ts";
import { c7Level, isModelRead } from "../../../lib/cds-checks.ts";
import { gridColumns } from "../../../lib/grid-columns.ts";
import { policyFromText } from "../../../lib/test-policy.ts";
import { readWorkbook } from "../cds-xlsx.mts";

export const GRID_CODES = /^C\.(7(0[1-9]|1[0-8])|80[2-4])$/;

/** The model-read C7/C8A items with a value: the ones a placement can confirm or correct. */
export const gridCodes = (doc: DocumentRecord, table: TemplateTable) =>
  Object.keys(doc.items).filter((k) => GRID_CODES.test(k) && doc.items[k].v !== undefined && isModelRead(doc, k, table));

function pdfLayout(bytes: Uint8Array): string[] | null {
  try {
    return execFileSync("pdftotext", ["-layout", "-", "-"], { input: bytes, maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "ignore"] }).toString().split("\n");
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
function workbookLayout(bytes: Uint8Array): string[] | null {
  const dir = mkdtempSync(join(tmpdir(), "grid-"));
  try {
    const file = join(dir, "book.xlsx");
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
          line = line.padEnd(colNumber(c.col) * SLOT + Math.floor((SLOT - text.length) / 2)) + text;
        }
        out.push(line);
      }
    }
    return out.length ? out : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Layout text for a document type, or null (HTML, a scanned PDF with no text, pdftotext missing). */
export function gridLayout(bytes: Uint8Array, type: string): string[] | null {
  if (type.startsWith("xlsx")) return workbookLayout(bytes);
  if (type.startsWith("pdf")) return pdfLayout(bytes);
  return null;
}

/** Whether the model's reading meant the same answer as the heading ("Recommend" and "Recommended" do). */
export function sameAnswer(code: string, read: unknown, heading: string): boolean {
  if (typeof read !== "string") return false;
  return code.startsWith("C.7") ? c7Level(read) === c7Level(heading) : policyFromText(read) === policyFromText(heading);
}

export interface Placement {
  doc: DocumentRecord;
  confirmed: number;
  /** "C.702 "Considered" → "Not Considered"" per value that named a different answer. */
  corrected: string[];
  unplaced: number;
}

/** The document with each placeable C7/C8A mark recorded under its heading; a person's `misread` hold is settled by it. */
export function placeGridMarks(doc: DocumentRecord, lines: readonly string[], table: TemplateTable, today: string): Placement {
  const codes = gridCodes(doc, table);
  const placed = gridColumns(lines);
  const items = { ...doc.items };
  const out: Placement = { doc, confirmed: 0, corrected: [], unplaced: 0 };
  for (const code of codes) {
    const heading = placed.get(code);
    if (!heading) {
      out.unplaced++;
      continue;
    }
    const it = items[code];
    const read = it.column?.read ?? it.v;
    const failures = it.failures?.filter((f) => f.check !== "misread");
    items[code] = { ...it, v: heading, column: { heading, ...(read !== heading ? { read } : {}), checked: today } };
    if (failures?.length) items[code].failures = failures;
    else delete items[code].failures;
    if (sameAnswer(code, read, heading)) out.confirmed++;
    else out.corrected.push(`${code} ${JSON.stringify(read)} → ${JSON.stringify(heading)}`);
  }
  out.doc = { ...doc, items };
  return out;
}
