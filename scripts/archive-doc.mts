/**
 * The owner's manual document drop (specs/college-reported-round-3.md Decision 8):
 *
 *   npm run archive-doc -- --college <unit_id> --file <path> --url <original url>
 *     [--kind cds|class-profile] [--edition 2025-26] [--retrieved YYYY-MM-DD] [--add-url] [--note "…"]
 *
 * Puts the file in the archive (local `.cache/college-docs/archive/`, or the private release repo when
 * COLLEGE_DOCS_REPO is set) and in data/college-docs.json exactly as a fetch would. A 2025–26 template workbook is read
 * into data/cds-records/<unit_id>.json at once, with no model call; other types are extracted from the archive by the
 * pipeline's next run. `--add-url` also lists the URL in data/reference/cds-urls.json (discovery step 0).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { School } from "../lib/types";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { createArchive } from "./lib/college-reported/archive.mts";
import { archiveDoc } from "./lib/college-reported/archive-doc.mts";

const ROOT = join(import.meta.dirname, "..");
const USAGE =
  "usage: npm run archive-doc -- --college <unit_id> --file <path> --url <original url> [--kind cds|class-profile] [--edition 2025-26] [--retrieved YYYY-MM-DD] [--add-url] [--note text]";

const { values } = parseArgs({
  options: {
    college: { type: "string" },
    file: { type: "string" },
    url: { type: "string" },
    kind: { type: "string", default: "cds" },
    edition: { type: "string" },
    retrieved: { type: "string" },
    "add-url": { type: "boolean", default: false },
    note: { type: "string" },
  },
});
if (!values.college || !values.file || !values.url) {
  console.error(USAGE);
  process.exit(2);
}
if (values.kind !== "cds" && values.kind !== "class-profile") {
  console.error(`--kind must be cds or class-profile\n${USAGE}`);
  process.exit(2);
}
if (values.retrieved && !/^\d{4}-\d{2}-\d{2}$/.test(values.retrieved)) {
  console.error(`--retrieved must be YYYY-MM-DD\n${USAGE}`);
  process.exit(2);
}
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const school = schools.find((s) => s.unit_id === values.college);
if (!school) throw new Error(`college ${values.college} isn't in data/schools.json`);

const archive = createArchive({ log: console.log });
const { entry, record, addedUrl } = await archiveDoc({
  unit_id: values.college,
  file: values.file,
  url: values.url,
  kind: values.kind,
  edition: values.edition,
  retrieved: values.retrieved,
  addUrl: values["add-url"],
  note: values.note,
  dataDir: join(ROOT, "data"),
  archive,
  table: CDS_TEMPLATE,
  today: new Date().toISOString().slice(0, 10),
});

console.log(`${school.name} (${values.college}): ${entry.type} ${entry.edition ?? "edition unknown"}, ${entry.sha256.slice(0, 12)}… → ${entry.archive}`);
if (record) {
  const counts: Record<string, number> = {};
  for (const it of Object.values(record.items)) counts[it.status] = (counts[it.status] ?? 0) + 1;
  console.log(`  read with no model: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}`);
} else {
  console.log("  archived; the pipeline's next run extracts it from the archive");
}
if (!entry.edition) console.log("  no edition found in the document: pass --edition 2025-26");
if (addedUrl) console.log("  added to data/reference/cds-urls.json");
