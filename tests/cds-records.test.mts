/**
 * CDS records: the helpers display specs read them with, the records validator (each rule shown to fail when broken),
 * the committed records, and the lineage guard's acceptance of `derived` college values
 * (lib/cds-records.ts, specs/college-reported-round-3.md Decision 2). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { BatchesFile, BlockedHostsFile, CdsUrlsFile } from "../lib/reported";
import type { CollegeDocsFile, CollegeRecord, DocumentRecord } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import {
  editionFallYear,
  editionLabel,
  indexRecords,
  itemBoolean,
  itemMonthDay,
  itemNumber,
  itemShare,
  itemText,
  itemValue,
  itemYear,
  lineageFromItem,
  newestPassed,
  validateCdsRecords,
} from "../lib/cds-records.ts";
import { validateSchool } from "../lib/lineage.ts";
import { readManifest, readRecords, serializeRecord } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const T = CDS_TEMPLATE;

/* ---- A small fixture: one college, two editions ---- */

function doc(edition: string, sha: string, items: DocumentRecord["items"], years: DocumentRecord["years"] = { edition: edition, fall: `Fall ${edition.slice(0, 4)}`, "aid-year": "2024–25 final", "next-cycle": `Fall ${Number(edition.slice(0, 4)) + 1} cycle` }): DocumentRecord {
  return {
    sha256: sha.padEnd(64, "0"),
    edition,
    type: "xlsx-template",
    url: `https://ir.example.edu/cds-${edition}.xlsx`,
    retrieved: "2026-10-03",
    reads: { deterministic: { schema_version: 1, read_by: "xlsx-template", mode: "deterministic", extracted: "2026-10-03" } },
    years,
    items,
  };
}

function fixture(): { record: CollegeRecord; manifest: CollegeDocsFile } {
  const newer = doc("2025-26", "aa", {
    "C.116": { v: 48196, status: "passed", cell: "CDS-C!AC17", quote: "Total first-time, first-year students who applied | 48196" },
    "C.117": { v: 2593, status: "passed", cell: "CDS-C!AC18", quote: "Total first-time, first-year students who were admitted | 2593" },
    "C.1201": { status: "blank" },
    "C.901": { v: 0.24, status: "passed", cell: "CDS-C!AC103", quote: "Percent Submitting SAT Scores | 0.24" },
    "C.2101": { v: true, status: "passed", cell: "CDS-C!AC262", quote: "Does your institution offer an early decision plan | Yes" },
    "C.1402": { v: 1, status: "passed", cell: "CDS-C!AC234", quote: "Application closing date (fall): Month | 1" },
    "C.1403": { v: 5, status: "passed", cell: "CDS-C!AC235", quote: "Application closing date (fall): Day | 5" },
    "C.1608": { v: "--04-01", status: "passed", cell: "CDS-C!AC246", quote: "Other: | 46113" },
    "C.701": { v: "Very Important", status: "passed", cell: "CDS-C!AC69", quote: "Rigor of secondary school record | Very Important" },
    "B.2201": { v: 0.97, status: "failed", cell: "CDS-B!AC203", quote: "… | 0.97", failures: [{ check: "type-range", detail: "count 0.97 is not a whole number ≥ 0" }] },
  });
  const older = doc("2023-24", "bb", {
    "C.116": { v: 46000, status: "passed", cell: "CDS-C!AC17", quote: "Total first-time, first-year students who applied | 46000" },
    "C.1201": { v: 3.9, status: "passed", page: 12, line: 455, quote: "Average high school GPA … | 3.90" },
  });
  const record: CollegeRecord = { unit_id: "221999", documents: [newer, older] };
  const manifest: CollegeDocsFile = {
    updated: "2026-10-03",
    documents: record.documents.map((d) => ({ sha256: d.sha256, unit_id: "221999", url: d.url, kind: "cds", type: d.type, edition: d.edition, retrieved: d.retrieved, bytes: 1000, archive: null })),
  };
  return { record, manifest };
}

/* ---- Editions ---- */

test("editions: fall year and display label", () => {
  assert.equal(editionFallYear("2025-26"), 2025);
  assert.equal(editionFallYear("2025–2026"), 2025);
  assert.equal(editionFallYear("Fall 2025"), null);
  assert.equal(editionLabel("2025-26"), "2025–26");
  assert.throws(() => editionLabel("2025"), /not a CDS edition/);
});

/* ---- Newest passed ---- */

test("newestPassed: the newest document where all (or any) codes passed, within the editions allowed", () => {
  const { record } = fixture();
  assert.equal(newestPassed(record, ["C.116", "C.117"])!.document.edition, "2025-26");
  // C.1201 is blank in 2025–26, so the block comes from 2023–24 …
  const gpa = newestPassed(record, ["C.1201"])!;
  assert.equal(gpa.document.edition, "2023-24");
  assert.deepEqual(Object.keys(gpa.items), ["C.1201"]);
  // … unless the spec allows only one edition back.
  assert.equal(newestPassed(record, ["C.1201"], { maxEditionsBack: 1 }), null);
  assert.equal(newestPassed(record, ["C.1201"], { maxEditionsBack: 2 })!.document.edition, "2023-24");
  // all: both must pass in one document (only 2023–24 has both); any: one is enough.
  assert.equal(newestPassed(record, ["C.116", "C.1201"])!.document.edition, "2023-24");
  assert.equal(newestPassed(record, ["C.117", "C.1201"]), null);
  assert.equal(newestPassed(record, ["C.116", "C.1201"], { mode: "any" })!.document.edition, "2025-26");
  // A failed item never counts.
  assert.equal(newestPassed(record, ["B.2201"]), null);
  // Order in the file doesn't matter: documents are taken newest first.
  const reversed = { ...record, documents: [...record.documents].reverse() };
  assert.equal(newestPassed(reversed, ["C.116"])!.document.edition, "2025-26");
  assert.equal(indexRecords([record]).get("221999"), record);
});

test("typed accessors return null for anything not passed or not of their type", () => {
  const d = fixture().record.documents[0];
  assert.equal(itemNumber(d, "C.116"), 48196);
  assert.equal(itemShare(d, "C.901"), 0.24);
  assert.equal(itemBoolean(d, "C.2101"), true);
  assert.equal(itemText(d, "C.701"), "Very Important");
  assert.deepEqual(itemMonthDay(d, "C.1608"), { month: 4, day: 1 });
  assert.deepEqual(itemMonthDay(d, "C.1402", "C.1403"), { month: 1, day: 5 });
  assert.equal(itemNumber(d, "B.2201"), null); // failed
  assert.equal(itemNumber(d, "C.1201"), null); // blank
  assert.equal(itemNumber(d, "C.701"), null); // text, not a number
  assert.equal(itemShare(d, "C.116"), null); // a count isn't a share
  assert.equal(itemValue(d, "Z.999"), null);
});

/* ---- Lineage ---- */

test("lineageFromItem builds a college-site record with year, edition, quote, and cell or page", () => {
  const { record } = fixture();
  const d = record.documents[0];
  assert.equal(itemYear(d, T, "C.116"), "Fall 2025");
  assert.deepEqual(lineageFromItem(d, "C.116", { year: itemYear(d, T, "C.116")! }), {
    source: "college-site",
    method: "extracted",
    year: "Fall 2025",
    edition: "2025–26",
    url: "https://ir.example.edu/cds-2025-26.xlsx",
    retrieved: "2026-10-03",
    quote: "Total first-time, first-year students who applied | 48196",
    cell: "CDS-C!AC17",
  });
  const old = lineageFromItem(record.documents[1], "C.1201", { year: "Fall 2023", method: "derived" });
  assert.equal(old.page, 12);
  assert.equal(old.method, "derived");
  assert.equal(old.edition, "2023–24");
  assert.throws(() => lineageFromItem(d, "B.2201", { year: "Fall 2024", path: "reported.x" }), /reported\.x.*failed, not passed/);
  assert.throws(() => lineageFromItem(d, "C.1201", { year: "Fall 2025" }), /blank, not passed/);
  const noQuote = structuredClone(d);
  delete noQuote.items["C.116"].quote;
  assert.throws(() => lineageFromItem(noQuote, "C.116", { year: "Fall 2025" }), /no quote/);
});

// Princeton: a real federal baseline and no CDS override (as in tests/reported-checks.test.mts).
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
function princetonWithReported(method: "extracted" | "derived" | "reported", quote: string | undefined): School {
  const s = structuredClone(schools.find((x) => x.unit_id === "186131")!);
  s.reported = { admissions: { entering_term: "Fall 2026", year: 2026, applicants: 46618, admitted: 1865, enrolled: 1500, acceptance_rate: 0.04, source_kind: "cds" } };
  const rec = { source: "college-site" as const, method: "extracted" as const, year: "Fall 2026", url: "https://ir.example.edu/cds.xlsx", retrieved: "2026-10-03", quote: "x | 1", edition: "2026–27", cell: "CDS-C!AC17" };
  s.lineage = {
    ...(s.lineage ?? {}),
    "reported.admissions.entering_term": rec,
    "reported.admissions.year": rec,
    "reported.admissions.applicants": rec,
    "reported.admissions.admitted": rec,
    "reported.admissions.enrolled": rec,
    "reported.admissions.source_kind": rec,
    "reported.admissions.acceptance_rate": { ...rec, method, quote },
  };
  return s;
}

test("the lineage guard accepts a college value derived from quoted counts, and only with its citation", () => {
  assert.deepEqual(validateSchool(princetonWithReported("extracted", "rate | 4.0%"), meta), []);
  assert.deepEqual(validateSchool(princetonWithReported("derived", "admitted | 1865"), meta), []);
  assert.match(validateSchool(princetonWithReported("derived", undefined), meta).join("\n"), /acceptance_rate is derived from the college's document but lacks quote/);
  assert.match(validateSchool(princetonWithReported("reported", "x"), meta).join("\n"), /acceptance_rate must have method "extracted" or "derived"/);
});

/* ---- The records validator: each rule fails when broken ---- */

test("the fixture passes the validator", () => {
  const { record, manifest } = fixture();
  assert.deepEqual(validateCdsRecords([record], manifest, T), []);
});

const broken: [string, (r: CollegeRecord, m: CollegeDocsFile) => void, RegExp][] = [
  ["a passed value without a cell, line, or field", (r) => delete r.documents[0].items["C.116"].cell, /C\.116 passed without a page and line, cell, or field/],
  ["a page without a line", (r) => delete r.documents[1].items["C.1201"].line, /C\.1201 passed without a page and line/],
  ["an owned item without a quote", (r) => delete r.documents[0].items["C.117"].quote, /C\.117 is shown by college-reported-data but has no quote/],
  ["a quote over 160 characters", (r) => (r.documents[0].items["C.117"].quote = "x".repeat(161)), /quote is over 160/],
  ["a passed item with no value", (r) => delete r.documents[0].items["C.117"].v, /C\.117 passed with no value/],
  ["a document missing from the manifest", (_r, m) => m.documents.splice(0, 1), /sha256 isn't in data\/college-docs\.json/],
  ["a manifest entry for another college", (_r, m) => (m.documents[0].unit_id = "190415"), /lists this document for 190415/],
  ["a missing item-group year", (r) => delete r.documents[0].years.fall, /need a year for group "fall"/],
  ["a model call at an unknown schema version", (r) => (r.documents[0].reads.C = { schema_version: 2, read_by: "claude-haiku-4-5", mode: "batch", extracted: "2026-10-06" }), /call C has unknown schema_version 2/],
  ["an unknown deterministic reader", (r) => (r.documents[0].reads.deterministic!.read_by = "xlsx-guess"), /unknown deterministic read/],
  ["no reads at all", (r) => (r.documents[0].reads = {}), /no reads/],
  ["an unknown code", (r) => (r.documents[0].items["C.999"] = { status: "blank" }), /C\.999 isn't a 2025-26 template code/],
  ["an unknown status", (r) => (r.documents[0].items["C.117"].status = "ok" as never), /unknown status "ok"/],
  ["a failed item that doesn't say why", (r) => delete r.documents[0].items["B.2201"].failures, /B\.2201 failed without saying why/],
  ["documents out of order", (r) => r.documents.reverse(), /aren't newest first/],
  ["an edition that isn't one", (r) => (r.documents[1].edition = "Fall 2023"), /isn't an edition/],
  ["a unit id that isn't an IPEDS id", (r) => (r.unit_id = "vanderbilt"), /isn't an IPEDS id/],
];
for (const [what, breakIt, message] of broken) {
  test(`the validator rejects ${what}`, () => {
    const { record, manifest } = fixture();
    breakIt(record, manifest);
    assert.match(validateCdsRecords([record], manifest, T).join("\n"), message);
  });
}

/* ---- The committed records ---- */

const records = readRecords(join(ROOT, "data", "cds-records"));
const manifest = readManifest(join(ROOT, "data", "college-docs.json"));
const by = indexRecords(records);
const newest = (id: string) => by.get(id)!.documents[0];

test("the committed records pass the validator and round-trip byte for byte", () => {
  assert.deepEqual(validateCdsRecords(records, manifest, T), []);
  for (const r of records) assert.equal(serializeRecord(r), readFileSync(join(ROOT, "data", "cds-records", `${r.unit_id}.json`), "utf8"), r.unit_id);
  // The four template workbooks of the foundation are always there; a pipeline run adds more.
  for (const id of ["145637", "190415", "221999", "231624"]) assert.ok(records.some((r) => r.unit_id === id), id);
  assert.deepEqual(records.map((r) => r.unit_id), [...records.map((r) => r.unit_id)].sort(), "one file per college, in id order");
});

test("the four template workbooks give their real totals with no model call", () => {
  // Vanderbilt, Cornell, William & Mary, Illinois: C1 applied / admitted / enrolled.
  const c1: Record<string, [number, number, number]> = {
    "221999": [48196, 2593, 1635],
    "190415": [72523, 6077, 3827],
    "231624": [16895, 6245, 1639],
    "145637": [83045, 30384, 9207],
  };
  for (const [id, [applied, admitted, enrolled]] of Object.entries(c1)) {
    const d = newest(id);
    assert.deepEqual([itemNumber(d, "C.116"), itemNumber(d, "C.117"), itemNumber(d, "C.118")], [applied, admitted, enrolled], id);
    assert.equal(d.reads.deterministic?.read_by, "xlsx-template");
    assert.equal(d.edition, "2025-26");
  }
  assert.equal(itemNumber(newest("231624"), "C.1201"), 4.34); // weighted GPA
  assert.equal(itemNumber(newest("221999"), "C.1201"), 3.895);
  assert.equal(itemNumber(newest("221999"), "I.308"), 1809); // class sections total
  assert.equal(itemNumber(newest("231624"), "I.301"), 171);
  assert.deepEqual(itemMonthDay(newest("231624"), "C.1608"), { month: 4, day: 1 }); // the Excel serial 46113
});

test("the committed records keep the colleges' own errors as failures", () => {
  // Vanderbilt typed 0.97 into B22's cohort count.
  assert.equal(newest("221999").items["B.2201"].failures![0].check, "type-range");
  // Cornell's C21 code table is wired one row off (10,057 applications sit in the "admitted" cell). The visible form
  // passes every C21 check (lib/cds-checks.ts), so it is published, with the code table's value kept beside it.
  const cu = newest("190415").items["C.2111"];
  assert.equal(cu.status, "passed");
  assert.equal(cu.v, 1889);
  assert.equal(cu.cell, "CDS-C!E327");
  assert.deepEqual(cu.code_table, { v: 10057, cell: "CDS-C!AC272", quote: "Number of applicants admitted under early decision plan | 10057" });
  // Illinois's residency code cells are misfiled while its visible grid is consistent: the grid is published.
  assert.equal(newest("145637").items["C.120"].status, "passed");
  assert.equal(newest("145637").items["C.120"].v, 14509);
  assert.equal(newest("145637").items["C.120"].code_table!.v, 32702);
  // Illinois swapped C1's full-/part-time cells: the sex-sum check fails them, and only them.
  for (const k of ["C.110", "C.111", "C.112", "C.113"]) assert.equal(newest("145637").items[k].failures![0].check, "parts-sum", k);
  assert.equal(newest("145637").items["C.118"].status, "passed");
  // The aid year differs by college within one edition.
  assert.equal(newest("190415").years["aid-year"], "2025–26 estimated");
  assert.equal(newest("231624").years["aid-year"], "2024–25 final");
  // The respondent's personal details aren't kept.
  for (const r of records) for (const c of ["A.001", "A.002", "A.012", "A.013"]) assert.equal(r.documents[0].items[c].status, "not-read");
});

/* ---- Empty state files other tracks build on ---- */

test("the round-3 state files exist with their shapes", () => {
  // Empty at first; a pipeline run fills them (open batches, blocked hosts), so their shape is what's checked.
  const read = <T,>(p: string): T => JSON.parse(readFileSync(join(ROOT, "data", p), "utf8"));
  const batches = read<BatchesFile>("college-batches.json");
  assert.ok(Array.isArray(batches.batches) && (batches.updated === null || typeof batches.updated === "string"));
  const blocked = read<BlockedHostsFile>("reference/blocked-hosts.json");
  assert.ok(Array.isArray(blocked.hosts));
  for (const h of blocked.hosts) assert.ok(h.host && h.status, JSON.stringify(h));
  const urls = read<CdsUrlsFile>("reference/cds-urls.json");
  assert.ok(Array.isArray(urls.entries));
  for (const e of urls.entries) assert.ok(e.unit_id && e.url, JSON.stringify(e));
});
