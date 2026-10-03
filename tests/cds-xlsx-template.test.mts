/**
 * The 2025–26 template-workbook reader (scripts/lib/cds-xlsx.mts readTemplate, recordFromTemplate;
 * specs/college-reported-round-3.md Decision 3) on a small in-memory workbook laid out like the real template:
 * a visible form in columns A–Z and a code table from column AA. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { isTemplateWorkbook, quoteOf, readC1, readTemplate, recordFromTemplate, type Cell, type Sheet, type Workbook } from "../scripts/lib/cds-xlsx.mts";

type Row = Record<string, string | number>;
const sheet = (rows: Record<number, Row | undefined>): Sheet =>
  new Map(Object.entries(rows).map(([r, cells]) => [Number(r), Object.entries(cells ?? {}).map(([col, value]): Cell => ({ col, value }))]));
const header: Row = { AA: "Question Number", AB: "Question", AC: "Answer", AD: "Section" };
const code = (c: string, label: string, answer?: string | number): Row => ({ AA: c, AB: label, ...(answer !== undefined ? { AC: answer } : {}) });

/** A Cornell-like workbook: C21's code table one row off, the ANSWER SHEET filling a code the sheet left empty. */
function workbook(opts: { aidYear?: string; form?: boolean } = {}): Workbook {
  const form = opts.form ?? true;
  const book: Workbook = new Map();
  for (const s of "ABDEFGJ") book.set(`CDS-${s}`, sheet({ 1: header }));
  book.set("CDS-A", sheet({ 1: header, 2: code("A.001", "First Name:", "Jane"), 3: code("A.101", "Name of College/University:", "Example University") }));
  book.set("CDS-B", sheet({ 1: header, 203: code("B.2201", "Report the number … who entered in Fall 2024", 0.97), 204: code("B.2202", "… still enrolled … in Fall 2025", 3448) }));
  book.set(
    "CDS-C",
    sheet({
      1: header,
      2: code("C.101", "Total first-time, first-year males who applied", 36834),
      3: code("C.102", "Total first-time, first-year females who applied"), // empty here: the ANSWER SHEET has it
      17: code("C.116", "Total first-time, first-year students who applied", 72523),
      18: code("C.117", "Total first-time, first-year students who were admitted", 6077),
      19: code("C.118", "Total first-time, first-year students who enrolled", 3827),
      20: code("C.119", "Total first-time, first-year who applied", 12978),
      23: code("C.122", "Total first-time, first-year who applied", 40979),
      26: code("C.125", "Total first-time, first-year who applied", 18566),
      29: code("C.128", "Total first-time, first-year who applied", 0),
      103: code("C.901", "Percent Submitting SAT Scores", 0.43),
      226: code("C.1201", "Average high school GPA of all degree-seeking, first-time, first-year students who submitted GPA:", "-"),
      246: code("C.1608", "Other:", "46113"),
      262: code("C.2101", "Does your institution offer an early decision plan", "Yes or No"),
      271: code("C.2110", "Number of early decision applications received by your institution"),
      272: code("C.2111", "Number of applicants admitted under early decision plan", 10057),
      ...(form
        ? {
            11: { B: "Total first-time, first-year males who applied", E: 36834 },
            36: { B: "First-Time, First-Year Student Applicants", E: "In-State", F: "Out-of-State", G: "International", H: "Unknown", I: "Total" },
            37: { B: "Total first-time, first-year (degree-seeking) who applied", E: 12978, F: 40979, G: 18566, H: 0, I: 72523 },
            318: { A: "C21", B: "Does your institution offer an early decision plan?", E: "Yes" },
            326: { B: "Number of early decision applications received by your institution", E: 10057 },
            327: { B: "Number of applicants admitted under early decision plan", E: 1889 },
          }
        : {}),
    })
  );
  book.set("CDS-H", sheet({ 1: header, 2: code("H.101", "Academic Year", opts.aidYear ?? "2025-2026 Estimated"), 3: code("H.105", "Federal", 23877743) }));
  book.set("CDS-I", sheet({ 1: header, 32: code("I.201", "Fall 2025 Student to Faculty ratio", 12.1) }));
  book.set(
    "ANSWER SHEET",
    sheet({
      1: { A: "Sort Order", B: "Question Number", C: "US News PDF Tag", E: "Question", F: "Answer" },
      3: { B: "C.102", E: "Total first-time, first-year females who applied", F: 35687 },
      4: { B: "C.117", E: "Total first-time, first-year students who were admitted", F: 9999 }, // the sheet's value wins
    })
  );
  return book;
}

const record = (book: Workbook) =>
  recordFromTemplate(book, { unit_id: "190415", url: "https://irp.example.edu/cds.xlsx", sha256: "a".repeat(64), retrieved: "2026-10-03", table: CDS_TEMPLATE });

test("a template workbook is recognized by its sheets", () => {
  assert.equal(isTemplateWorkbook(workbook()), true);
  const classic = workbook();
  classic.delete("ANSWER SHEET");
  assert.equal(isTemplateWorkbook(classic), false);
  assert.throws(() => record(classic), /not a 2025–26 template workbook/);
});

test("code tables first, then the ANSWER SHEET for what they leave empty", () => {
  const t = readTemplate(workbook());
  assert.deepEqual(t.items["C.116"], { raw: 72523, cell: "CDS-C!AC17", sheet: "CDS-C", source: "code-table", label: "Total first-time, first-year students who applied" });
  assert.equal(t.items["C.102"].raw, 35687);
  assert.equal(t.items["C.102"].source, "answer-sheet");
  assert.equal(t.items["C.102"].cell, "ANSWER SHEET!F3");
  assert.equal(t.items["C.117"].raw, 6077);
  assert.equal(t.edition, "2025-26"); // from I.201's "Fall 2025"
});

test("Cornell's off-by-one C21 fails form-vs-code, keeping both values", () => {
  const t = readTemplate(workbook());
  assert.deepEqual(t.formVsCode.map((m) => m.code).sort(), ["C.2101", "C.2110", "C.2111"]);
  const r = record(workbook());
  assert.equal(r.items["C.2111"].status, "failed");
  assert.equal(r.items["C.2111"].v, 10057);
  assert.deepEqual(r.items["C.2111"].form, { v: 1889, cell: "CDS-C!E327" });
  assert.equal(r.items["C.2111"].failures![0].check, "form-vs-code");
  assert.deepEqual(r.items["C.2110"].form, { v: 10057, cell: "CDS-C!E326" });
  assert.deepEqual(r.items["C.2101"].form, { v: true, cell: "CDS-C!E318" }); // "Yes or No" in the code table is no answer
  // Rows that agree pass: C1 by sex and the residency grid.
  assert.equal(r.items["C.101"].status, "passed");
  assert.equal(r.items["C.119"].status, "passed");
  assert.equal(r.items["C.116"].status, "passed");
  // Break: without the visible form, 10,057 would publish as ED admits.
  assert.equal(record(workbook({ form: false })).items["C.2111"].status, "passed");
});

test("records: universal type checks, blanks, dates, quotes, cells, and years", () => {
  const r = record(workbook());
  assert.equal(r.edition, "2025-26");
  assert.equal(r.type, "xlsx-template");
  assert.deepEqual(r.reads, { deterministic: { schema_version: 1, read_by: "xlsx-template", mode: "deterministic", extracted: "2026-10-03" } });
  assert.deepEqual(r.items["C.116"], { status: "passed", v: 72523, cell: "CDS-C!AC17", quote: "Total first-time, first-year students who applied | 72523" });
  assert.equal(r.items["B.2201"].status, "failed"); // 0.97 in a count
  assert.equal(r.items["B.2201"].failures![0].check, "type-range");
  assert.deepEqual(r.items["C.1201"], { status: "blank" }); // "-"
  assert.deepEqual(r.items["C.1608"].v, "--04-01"); // Excel serial in a date cell
  assert.equal(r.items["C.901"].v, 0.43);
  assert.equal(r.items["A.101"].quote, undefined); // store-only: cell, no quote
  assert.equal(r.items["A.101"].cell, "CDS-A!AC3");
  assert.deepEqual(r.items["A.001"], { status: "not-read" }); // the respondent's name isn't kept
  assert.equal(r.items["J.101"].status, "blank"); // every template code has an entry
  assert.equal(Object.keys(r.items).length, CDS_TEMPLATE.items.length);
  assert.equal(r.years.fall, "Fall 2025");
  assert.equal(r.years["aid-year"], "2025–26 estimated");
  assert.equal(r.items["H.105"].status, "passed");
});

test("an aid year that doesn't parse holds every aid-year item back", () => {
  const r = record(workbook({ aidYear: "2023" })); // Howard's answer
  assert.equal(r.years["aid-year"], undefined);
  assert.equal(r.items["H.105"].status, "failed");
  assert.equal(r.items["H.105"].failures![0].check, "aid-year");
  assert.equal(r.items["H.101"].status, "failed");
  assert.equal(r.items["C.116"].status, "passed"); // other groups publish
});

test("readC1 still reads the totals by label", () => {
  const c1 = readC1(workbook());
  assert.equal(c1.applicants, 72523);
  assert.equal(c1.admitted, 6077);
  assert.equal(c1.enrolled, 3827);
});

test("quotes stay under 160 characters and always show the value", () => {
  const q = quoteOf("A very long question ".repeat(12), 1609);
  assert.ok(q.length <= 160, String(q.length));
  assert.match(q, /… \| 1609$/);
  assert.equal(quoteOf("Total", 1809), "Total | 1809");
});
