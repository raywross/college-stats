/**
 * Document types and the fillable-PDF reader (specs/college-reported-round-3.md Decision 3; tests 3 and 4):
 * scripts/lib/college-reported/doctype.mts and form-pdf.mts. Fixtures: a widget list cut from Howard's 2025–26 form
 * (tests/fixtures/cds/howard-widgets.tsv), small generated PDFs (tests/helpers/tiny-pdf.mts), and, when the 2026-10-03
 * inventory is on this machine, Howard's real PDF. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { validateCdsRecords } from "../lib/cds-records.ts";
import type { DocumentType } from "../lib/cds-sections.ts";
import { DETERMINISTIC_TYPES, detectDocumentType, inspectPdf, needsModel, typeOfDocument } from "../scripts/lib/college-reported/doctype.mts";
import { formFields, readFormPdf, readFormWidgets, recordFromForm, type FormWidget } from "../scripts/lib/college-reported/form-pdf.mts";
import { layoutDocument } from "../scripts/lib/college-reported/layout.mts";
import { tinyPdf, type TinyText } from "./helpers/tiny-pdf.mts";

const FIX = join(import.meta.dirname, "fixtures", "cds");
const INVENTORY = "/private/tmp/claude-501/-Users-raymondross-Projects-college-stats-college-stats--claude-worktrees-cr2/2bb2276a-cba1-46a0-950b-762026d91617/scratchpad/inventory/cds-gap/docs";
const HOWARD_PDF = join(INVENTORY, "howard.pdf");
const opts = { unit_id: "131520", url: "https://example.edu/cds.pdf", sha256: "a".repeat(64), retrieved: "2026-10-03", table: CDS_TEMPLATE };

/** The fixture's rows as FormWidgets: page, field name, type (Tx/Btn/Ch), button kind, export value, field value. */
function fixtureWidgets(): FormWidget[] {
  return readFileSync(join(FIX, "howard-widgets.tsv"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [page, name, type, kind, exportValue, fieldValue] = l.split("\t");
      const value = fieldValue?.trim() ? fieldValue.trim() : null;
      const p = Number(page.slice(1));
      if (kind === "radio") return { page: p, name, kind: "radio", value, export: exportValue.trim() };
      if (kind === "check") return { page: p, name, kind: "check", value: value && value !== "Off" ? "X" : null };
      return { page: p, name, kind: type === "Ch" ? "choice" : "text", value };
    });
}

/* ------------------------------------------------------------------ */
/* Type detection                                                      */
/* ------------------------------------------------------------------ */

const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n"));
const ZIP = new Uint8Array(Buffer.from("PK\u0003\u0004"));
const TEMPLATE_SHEETS = [..."ABCDEFGHIJ"].map((s) => `CDS-${s}`).concat("ANSWER SHEET");

test("type detection: from the bytes, filled widgets first, template sheets decide Excel", () => {
  assert.equal(detectDocumentType(ZIP, { sheets: TEMPLATE_SHEETS }), "xlsx-template");
  assert.equal(detectDocumentType(ZIP, { sheets: TEMPLATE_SHEETS.filter((s) => s !== "ANSWER SHEET") }), "xlsx-classic");
  assert.equal(detectDocumentType(ZIP, { sheets: ["CDS-A", "CDS-B", "CDS-C", "CDS DEFINITIONS"] }), "xlsx-classic");
  // Howard: a text layer of labels only (~97 K characters) and 759 filled widgets.
  assert.equal(detectDocumentType(PDF, { widgets: 759, textChars: 97_000 }), "pdf-form");
  assert.equal(detectDocumentType(PDF, { widgets: 0, textChars: 97_000 }), "pdf-flat");
  assert.equal(detectDocumentType(PDF, { widgets: 0, textChars: 120 }), "pdf-scanned");
  assert.equal(detectDocumentType(PDF, { widgets: 3, textChars: 0 }), "pdf-form");
  assert.equal(detectDocumentType(new Uint8Array(Buffer.from("<!doctype html><html>")), {}), "html");
  // Junk before the header still reads as a PDF; missing evidence is an error, not a guess.
  assert.equal(detectDocumentType(new Uint8Array(Buffer.from("\n\n%PDF-1.4")), { widgets: 0, textChars: 500 }), "pdf-flat");
  assert.throws(() => detectDocumentType(PDF, {}), /widget and text counts/);
  assert.throws(() => detectDocumentType(ZIP, {}), /sheet names/);
});

test("guard: template workbooks and form PDFs are never sent to a model, and layout refuses them", async () => {
  const all: DocumentType[] = ["xlsx-template", "xlsx-classic", "pdf-form", "pdf-flat", "pdf-scanned", "html", "class-profile"];
  assert.deepEqual(all.filter((t) => !needsModel(t)), ["xlsx-template", "pdf-form"]);
  assert.deepEqual([...DETERMINISTIC_TYPES].sort(), ["pdf-form", "xlsx-template"]);
  // The layout (the model's input) is never built for them, whatever a caller passes.
  await assert.rejects(layoutDocument(PDF, "pdf-form"), /can't lay out a pdf-form/);
  await assert.rejects(layoutDocument(ZIP, "xlsx-template"), /can't lay out a xlsx-template/);
});

/* ------------------------------------------------------------------ */
/* The form reader on Howard's widgets                                 */
/* ------------------------------------------------------------------ */

test("form fields: radio groups collapse to their selected export; trailing spaces trimmed", () => {
  const fields = formFields(fixtureWidgets());
  assert.equal(fields.get("Q111_1")?.value, "VI");
  assert.deepEqual(fields.get("Q111_1")?.exports, ["VI", "I", "C", "NC"]);
  assert.equal(fields.get("EXAM_CODE_S1A")?.value, "ADMS_CONSIDER");
  assert.deepEqual(fields.get("ACAD_YR")?.exports, ["2024", "2023", "N/A"]);
  assert.equal(fields.get("AP_ADMT_WAIT_N")?.value, null);
});

test("form reader: Howard's widgets → codes with no model; radio exports become the template's words", () => {
  const rec = recordFromForm(fixtureWidgets(), { ...opts, edition: "2025-26" });
  const it = (c: string) => rec.items[c];
  assert.equal(rec.type, "pdf-form");
  assert.deepEqual(Object.keys(rec.reads), ["deterministic"]);
  assert.equal(rec.reads.deterministic?.read_by, "pdf-form");
  // C1 by sex and the residency grid, with the field name and page as the location.
  assert.deepEqual(it("C.101"), { status: "passed", page: 13, field: "AP_RECD_1ST_MEN_N", v: 10738, quote: "Total first-time, first-year males who applied | 10738" });
  assert.equal(it("C.116").v, 37270);
  assert.equal(it("C.117").v, 15724);
  assert.equal(it("C.120").v, 258);
  // C7 radios: VI / C / NC → the same words a template workbook's code table holds.
  assert.equal(it("C.701").v, "Very Important");
  assert.equal(it("C.702").v, "Considered");
  assert.equal(it("C.707").v, "Not Considered");
  assert.match(it("C.701").quote ?? "", /^Rigor of secondary school record \| Very Important$/);
  // C8: Y/N → booleans; a code export → its words.
  assert.equal(it("C.801").v, true);
  assert.equal(it("C.802").v, "Not required for admission, but considered if submitted");
  assert.equal(it("C.8D").v, false);
  // C9 and C21 (choice lists are month and day cells).
  assert.equal(it("C.901").v, 0.47);
  assert.equal(it("C.905").v, 1050);
  assert.equal(it("C.2101").v, true);
  assert.equal(it("C.2102").v, 11);
  assert.equal(it("C.2103").v, 15);
  assert.equal(it("C.2110").v, 430);
  assert.equal(it("C.2111").v, 363);
  // D5 and F3 codes.
  assert.equal(it("D.503").v, "Required of All");
  assert.equal(it("F.303").v, "At Cooperating Institution");
  // H: H0's year radio (2024 = "2025-2026 Estimated", 2023 = "2024-2025 Final"), checkboxes, money.
  assert.equal(it("H.101").v, "2024-2025 Final");
  assert.equal(rec.years["aid-year"], "2024–25 final");
  assert.equal(it("H.102").v, true);
  assert.equal(it("H.103").status, "blank"); // an unchecked box is blank, never false
  assert.equal(it("H.105").v, 28906749);
  assert.equal(it("H.109").status, "passed");
  assert.equal(it("H.1004").v, true);
  // Empty fields are blank; codes whose field isn't on this form (or that have no tag) aren't read; nor is the respondent.
  assert.equal(it("C.205").status, "not-read");
  assert.equal(it("C.2112").status, "not-read");
  assert.equal(it("C.959").status, "not-read"); // a formula total with no PDF tag
  assert.equal(rec.items["A.001"].status, "not-read");
  assert.equal(JSON.stringify(rec).includes("Respondent"), false);
  // Every passed item is located and quoted where owned: the records validator accepts the document.
  const errors = validateCdsRecords(
    [{ unit_id: "131520", documents: [rec] }],
    { updated: null, documents: [{ sha256: rec.sha256, unit_id: "131520", url: rec.url, kind: "cds", type: "pdf-form", edition: "2025-26", retrieved: "2026-10-03", bytes: 1, archive: null }] },
    CDS_TEMPLATE
  );
  assert.deepEqual(errors, []);
});

test("form reader: an aid-year radio that can't be placed fails aid-year; a value that breaks its type fails type-range", () => {
  const widgets = fixtureWidgets().map((w) => (w.name === "ACAD_YR" ? { ...w, value: "2019" } : w.name === "AP_RECD_1ST_MEN_N" ? { ...w, value: "0.97" } : w));
  const rec = recordFromForm(widgets, { ...opts, edition: "2025-26" });
  assert.equal(rec.items["H.105"].status, "failed");
  assert.equal(rec.items["H.105"].failures?.[0].check, "aid-year");
  assert.equal(rec.years["aid-year"], undefined);
  assert.equal(rec.items["C.101"].failures?.[0].check, "type-range");
});

test("form reader: the edition comes from the cover text, never a page header, and is required", () => {
  const coverLines = { lines: ["@71 Common Data Set 2025-2026", "@74 Welcome to the 2025-2026 Common Data Set collection!", "@55 Common Data Set 2024-2025", "@55 Common Data Set 2024-2025", "@55 Common Data Set 2024-2025"], pages: [1, 1, 2, 3, 4] };
  assert.equal(recordFromForm(fixtureWidgets(), { ...opts, coverLines }).edition, "2025-26");
  assert.throws(() => recordFromForm(fixtureWidgets(), opts), /states no edition/);
});

/* ------------------------------------------------------------------ */
/* A real (generated) fillable PDF, end to end                          */
/* ------------------------------------------------------------------ */

const LABELS: TinyText[] = [
  { x: 71, y: 760, s: "Common Data Set 2025-2026" },
  { x: 54, y: 700, s: "C1. First-time, first-year students: Provide the number of degree-seeking, first-time, first-year students" },
  { x: 54, y: 688, s: "who applied, were admitted, and enrolled (full- or part-time) in Fall 2025." },
  { x: 54, y: 660, s: "Total first-time, first-year males who applied" },
  { x: 54, y: 620, s: "C7. Relative importance of each of the following academic and nonacademic factors" },
  { x: 54, y: 600, s: "Rigor of secondary school record" },
  { x: 54, y: 560, s: "Does your institution make use of SAT or ACT scores in admission decisions?" },
  { x: 54, y: 520, s: "Federal methodology (FM)" },
  { x: 54, y: 505, s: "Institutional methodology (IM)" },
];

function formPdf(withWidgets: boolean): Uint8Array {
  return tinyPdf([
    {
      text: LABELS,
      widgets: withWidgets
        ? [
            { kind: "text", name: "AP_RECD_1ST_MEN_N", value: "10738", x: 400, y: 658 },
            { kind: "radio", name: "Q111_1", options: ["VI", "I", "C", "NC"], value: "VI", x: 300, y: 598 },
            { kind: "radio", name: "ADMS", options: ["Y", "N", "N/A"], value: "Y", x: 400, y: 558 },
            { kind: "check", name: "METH_FM", on: true, x: 40, y: 518 },
            { kind: "check", name: "METH_IM", on: false, x: 40, y: 503 },
          ]
        : [],
    },
  ]);
}

test("form PDF end to end: detected from its widgets, read with no model; its text layer alone has no answers", async () => {
  const bytes = formPdf(true);
  const seen = await inspectPdf(bytes);
  assert.equal(seen.pages, 1);
  assert.ok(seen.textChars >= 200, `labels only, but over the scanned threshold: ${seen.textChars}`);
  assert.equal(seen.widgets, 10); // 1 text field, 4 + 3 radio buttons, 2 checkboxes
  assert.equal(seen.filledWidgets, 4); // the text, one button per radio group, one checked box
  const { type } = await typeOfDocument(bytes);
  assert.equal(type, "pdf-form");
  assert.equal(needsModel(type), false);

  const widgets = await readFormWidgets(bytes);
  assert.deepEqual(
    widgets.filter((w) => w.name === "Q111_1").map((w) => [w.export, w.value]),
    [["VI", "VI"], ["I", "VI"], ["C", "VI"], ["NC", "VI"]]
  );
  const rec = await readFormPdf(bytes, opts);
  assert.equal(rec.edition, "2025-26");
  assert.equal(rec.items["C.101"].v, 10738);
  assert.equal(rec.items["C.701"].v, "Very Important");
  assert.equal(rec.items["C.801"].v, true);
  assert.equal(rec.items["H.102"].v, true);
  assert.equal(rec.items["H.103"].status, "blank");

  // Without the form reader, a model would get labels only: the laid-out text has no answer in it.
  const flat = await layoutDocument(bytes, "pdf-flat");
  assert.ok(flat.lines.some((l) => l.includes("Total first-time, first-year males who applied")));
  assert.equal(flat.lines.join("\n").includes("10738"), false);
  // The same document without filled widgets is a flattened PDF (a model reads it).
  assert.equal((await typeOfDocument(formPdf(false))).type, "pdf-flat");
});

/* ------------------------------------------------------------------ */
/* Howard's real form (when the inventory is on this machine)          */
/* ------------------------------------------------------------------ */

test("Howard's real form: every in-scope code Howard filled is read, with no model", { skip: !existsSync(HOWARD_PDF) && "inventory not on this machine" }, async () => {
  const bytes = new Uint8Array(readFileSync(HOWARD_PDF));
  const { type, pdf } = await typeOfDocument(bytes);
  assert.equal(type, "pdf-form");
  assert.equal(pdf?.widgets, 1263);
  assert.ok((pdf?.filledWidgets ?? 0) >= 700, `filled widgets ${pdf?.filledWidgets}`);
  const widgets = await readFormWidgets(bytes);
  const fields = formFields(widgets);
  const rec = await readFormPdf(bytes, opts);
  assert.equal(rec.edition, "2025-26");
  const tags = new Set(CDS_TEMPLATE.items.map((i) => i.tag?.trim()).filter(Boolean));
  const matched = [...fields.keys()].filter((n) => tags.has(n));
  assert.ok(matched.length >= 1087, `matched ${matched.length} field names`);
  let filled = 0;
  for (const it of CDS_TEMPLATE.items) {
    if (it.call === "store" || !it.tag) continue;
    const f = fields.get(it.tag.trim());
    if (!f || f.value === null || /^n\/a$/i.test(f.value)) continue;
    filled++;
    const r = rec.items[it.code];
    assert.ok(r.status === "passed" || r.status === "failed", `${it.code} (${it.tag} = "${f.value}") is ${r.status}`);
    if (r.v !== undefined) assert.equal(r.field, it.tag.trim(), it.code);
  }
  assert.ok(filled >= 400, `in-scope codes Howard filled: ${filled}`);
  assert.equal(rec.items["C.116"].v, 37270);
  assert.equal(rec.items["C.701"].v, "Very Important");
  assert.equal(rec.items["C.802"].v, "Not required for admission, but considered if submitted");
  const errors = validateCdsRecords(
    [{ unit_id: "131520", documents: [rec] }],
    { updated: null, documents: [{ sha256: rec.sha256, unit_id: "131520", url: rec.url, kind: "cds", type: "pdf-form", edition: "2025-26", retrieved: "2026-10-03", bytes: bytes.length, archive: null }] },
    CDS_TEMPLATE
  );
  assert.deepEqual(errors, []);
});
