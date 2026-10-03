/**
 * Reads a 2025–26 CDS template workbook into a college's record, with no model call (specs/college-reported-round-3.md
 * Decisions 1–3), and lists the file in the manifest.
 *
 *   npm run cds-records-from-workbooks -- --workbook <file.xlsx> --unit <unit_id> --url <where the college publishes it>
 *     [--retrieved YYYY-MM-DD] [--edition 2025-26]
 *
 * Writes data/cds-records/<unit_id>.json (the document replaces one with the same sha256) and adds or replaces its
 * entry in data/college-docs.json (sha256 of the bytes, type xlsx-template, `archive: null` until the archive exists).
 * The unit id must be a college in data/schools.json. Re-running on the same file gives the same record, so a reader
 * change is applied by re-running over the kept workbooks.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { School } from "../lib/types";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { isTemplateWorkbook, readWorkbook, recordFromTemplate, workbookEdition } from "./lib/cds-xlsx.mts";
import { upsertDocument, upsertManifest } from "./lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const RECORDS = join(ROOT, "data", "cds-records");
const MANIFEST = join(ROOT, "data", "college-docs.json");

const { values } = parseArgs({
  options: {
    workbook: { type: "string" },
    unit: { type: "string" },
    url: { type: "string" },
    retrieved: { type: "string", default: new Date().toISOString().slice(0, 10) },
    edition: { type: "string" },
  },
});
if (!values.workbook || !values.unit || !values.url) {
  console.error("usage: npm run cds-records-from-workbooks -- --workbook <file.xlsx> --unit <unit_id> --url <url> [--retrieved YYYY-MM-DD] [--edition 2025-26]");
  process.exit(2);
}
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const school = schools.find((s) => s.unit_id === values.unit);
if (!school) throw new Error(`unit ${values.unit} isn't in data/schools.json`);

const bytes = readFileSync(values.workbook);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const book = readWorkbook(values.workbook);
if (!isTemplateWorkbook(book)) throw new Error(`${values.workbook} isn't a 2025–26 template workbook; it needs the model path`);
const doc = recordFromTemplate(book, { unit_id: values.unit, url: values.url, sha256, retrieved: values.retrieved, table: CDS_TEMPLATE, edition: values.edition });

upsertDocument(RECORDS, values.unit, doc);
upsertManifest(
  MANIFEST,
  {
    sha256,
    unit_id: values.unit,
    url: values.url,
    kind: "cds",
    type: "xlsx-template",
    edition: doc.edition,
    edition_from: values.edition ? "manual" : workbookEdition(book) ? "workbook" : "items",
    retrieved: values.retrieved,
    bytes: bytes.length,
    archive: null,
  },
  values.retrieved
);

const counts: Record<string, number> = {};
for (const it of Object.values(doc.items)) counts[it.status] = (counts[it.status] ?? 0) + 1;
console.log(`${school.name} (${values.unit}) ${doc.edition}: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}`);
for (const [code, it] of Object.entries(doc.items)) {
  if (it.status === "failed") console.log(`  ${code} failed: ${it.failures!.map((f) => `${f.check}: ${f.detail}`).join("; ")}`);
}
