/**
 * Layout-aware text (specs/college-reported-round-3.md Decision 3; tests 5 and 6): scripts/lib/college-reported/
 * layout.mts, classicSheetText (scripts/lib/cds-xlsx.mts), and htmlToText's empty cells (documents.mts). Fixtures are
 * cut from the 2026-10-03 inventory's real documents (tests/fixtures/cds/), plus small generated PDFs. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classicSheetText, type Sheet } from "../scripts/lib/cds-xlsx.mts";
import { htmlToText, pdfPages } from "../scripts/lib/college-reported/documents.mts";
import {
  dropDefinitions,
  editionFromBody,
  gridColumns,
  layoutDocument,
  linesFor,
  linesFromItems,
  overflowTotal,
  pagesFromLayoutText,
  placeCells,
  placeGridMarks,
  rowsFromItems,
  splitCD,
  type LaidOutDocument,
} from "../scripts/lib/college-reported/layout.mts";
import { tinyPdf } from "./helpers/tiny-pdf.mts";

const FIX = join(import.meta.dirname, "fixtures", "cds");
const fixture = (f: string) => readFileSync(join(FIX, f), "utf8").split("\n").filter((l) => !l.startsWith("# ")).join("\n");
/** A fixture laid out again from its positioned cells, as layoutDocument does a PDF. */
const laid = (f: string) => layoutDocument(pagesFromLayoutText(fixture(f)), "pdf-flat");
const lineWith = (doc: Pick<LaidOutDocument, "lines">, text: string) => {
  const l = doc.lines.find((x) => x.includes(text));
  assert.ok(l, `no line with "${text}"`);
  return l;
};

/* ------------------------------------------------------------------ */
/* Rows from positioned text                                           */
/* ------------------------------------------------------------------ */

test("rows: items within ±2.5 pt are one row, sorted by x; gaps over 8 pt start a cell; split digits joined", () => {
  const rows = rowsFromItems([
    { str: "X", x: 450, y: 680.4, width: 6 },
    { str: "Rigor of secondary", x: 78, y: 680, width: 80 },
    { str: "school record", x: 160, y: 681.9, width: 55 },
    { str: "Class rank", x: 78, y: 665, width: 40 },
    // Georgia Tech's printer splits "$34,604" into pieces a few points apart.
    { str: "Tuition: Out-of-state:", x: 43, y: 600, width: 90 },
    { str: "$3", x: 256, y: 600, width: 9 },
    { str: "4", x: 267, y: 600, width: 5 },
    { str: ",", x: 274, y: 600, width: 2 },
    { str: "604", x: 278, y: 600, width: 15 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.cells),
    [
      [{ x: 78, text: "Rigor of secondary school record" }, { x: 450, text: "X" }],
      [{ x: 78, text: "Class rank" }],
      [{ x: 43, text: "Tuition: Out-of-state:" }, { x: 256, text: "$34,604" }],
    ]
  );
  const lines = linesFromItems([[{ str: "Rigor of secondary school record", x: 78, y: 680, width: 120 }, { str: "X", x: 450, y: 680, width: 6 }]]);
  assert.deepEqual(lines, { lines: ["@78 Rigor of secondary school record | @450 X"], pages: [1] });
});

test("Georgia Tech G1: split digits are joined within a cell, close values aren't merged", async () => {
  const doc = await laid("layout-gatech-g1.txt");
  assert.equal(lineWith(doc, "Out-of-state"), "@43 Tuition: Out-of-state: | @256 $34,604 | @362 $34,604");
  assert.equal(lineWith(doc, "Housing Only"), "@43 Housing Only (on-campus): | @258 $8,318 | @362 $10,922");
  assert.equal(lineWith(doc, "Required Fees"), "@43 Required Fees: | @258 $1,516 | @364 $1,516");
});

/* ------------------------------------------------------------------ */
/* Grids                                                               */
/* ------------------------------------------------------------------ */

/** C7 from laid-out lines: the "Academic" header row and the factor's own row. */
function c7(lines: readonly string[], factor: string): string[] {
  const header = lines.find((l) => /Very Important/.test(l) && /Not Considered/.test(l));
  const row = lines.find((l) => l.includes(factor));
  if (!header || !row) return [];
  return placeGridMarks(header, row).checked;
}

test("Harvard C7: each mark lands under its header (Considered at x=425, Not Considered at 497)", async () => {
  const doc = await laid("layout-harvard-c7.txt");
  assert.deepEqual(gridColumns(lineWith(doc, "@255 Very Important")).map((c) => [c.x, c.text]), [
    [78, "Academic"], [255, "Very Important"], [348, "Important"], [425, "Considered"], [497, "Not Considered"],
  ]);
  assert.deepEqual(c7(doc.lines, "Rigor of secondary school record"), ["Considered"]);
  assert.deepEqual(c7(doc.lines, "Class rank"), ["Not Considered"]);
  const grid = placeGridMarks(lineWith(doc, "@255 Very Important"), lineWith(doc, "Class rank"));
  assert.equal(grid.label, "Class rank");
  assert.deepEqual(grid.marks, [{ x: 532, text: "X", header: "Not Considered", checked: true }]);
});

test("break: plain pdfPages order loses the C7 grid that layout text keeps", async () => {
  // Printed spreadsheets draw the header row, then every mark, then the labels: content-stream order isn't visual order.
  const bytes = tinyPdf([
    {
      text: [
        { x: 78, y: 700, s: "Academic" },
        { x: 255, y: 700, s: "Very Important" },
        { x: 348, y: 700, s: "Important" },
        { x: 425, y: 700, s: "Considered" },
        { x: 497, y: 700, s: "Not Considered" },
        { x: 450, y: 680, s: "X" },
        { x: 532, y: 665, s: "X" },
        { x: 78, y: 680, s: "Rigor of secondary school record" },
        { x: 78, y: 665, s: "Class rank" },
      ],
    },
  ]);
  const doc = await layoutDocument(bytes, "pdf-flat");
  assert.deepEqual(c7(doc.lines, "Rigor of secondary school record"), ["Considered"]);
  assert.deepEqual(c7(doc.lines, "Class rank"), ["Not Considered"]);
  const plain = (await pdfPages(bytes)).join("\n").split("\n");
  assert.notDeepEqual(c7(plain, "Rigor of secondary school record"), ["Considered"]);
  assert.notDeepEqual(c7(plain, "Class rank"), ["Not Considered"]);
});

test("Michigan C7: ☒ is checked, ☐ isn't; a header wrapped over three lines is one column", async () => {
  const doc = await laid("layout-michigan-c7.txt");
  const header = doc.lines.filter((l) => /^@526 Not$|Very Important|^@503 Considered$/.test(l));
  assert.equal(header.length, 3);
  assert.deepEqual(gridColumns(header).map((c) => c.text), ["Factors", "Very Important", "Important", "Considered", "Not Considered"]);
  const rigor = doc.lines[doc.lines.findIndex((l) => l.includes("Rigor of secondary school")) + 1];
  assert.deepEqual(placeGridMarks(header, rigor, { columns: 4 }), {
    label: "",
    marks: [
      { x: 277, text: "☒", header: "Very Important", checked: true },
      { x: 368, text: "☐", header: "Important", checked: false },
      { x: 449, text: "☐", header: "Considered", checked: false },
      { x: 531, text: "☐", header: "Not Considered", checked: false },
    ],
    checked: ["Very Important"],
  });
  assert.deepEqual(placeGridMarks(header, lineWith(doc, "Class rank"), { columns: 4 }).checked, ["Not Considered"]);
  assert.deepEqual(placeGridMarks(header, lineWith(doc, "Standardized test scores"), { columns: 4 }).checked, ["Important"]);
});

test("Spelman-style private-use check glyphs and ✔ count as checked", () => {
  const header = "@78 Academic | @255 Very Important | @348 Important | @425 Considered | @497 Not Considered";
  assert.deepEqual(placeGridMarks(header, "@78 Class rank | @366 ").checked, ["Important"]);
  assert.deepEqual(placeGridMarks(header, "@78 Class rank | @270 ✔").checked, ["Very Important"]);
  assert.deepEqual(placeGridMarks(header, "@78 Class rank | @450 x | @532 X").checked, ["Considered", "Not Considered"]); // two marks: review
});

test("Harvard C11: a lone value keeps its column (all enrolled students), not the first", async () => {
  const doc = await laid("layout-harvard-c11.txt");
  const start = doc.lines.findIndex((l) => l.startsWith("@354 Percent"));
  const end = doc.lines.findIndex((l) => l.includes("scores)"));
  const header = doc.lines.slice(start, end + 1);
  assert.deepEqual(gridColumns(header).map((c) => c.text), [
    "Range",
    "Percent (Students who submitted scores)",
    "Percent (Students who did not submit scores)",
    "Percent (All enrolled students)",
  ]);
  const row = placeCells(header, lineWith(doc, "GPA of 4.0"));
  assert.equal(row.label, "Percent who had GPA of 4.0");
  assert.deepEqual(row.cells, [{ x: 540, text: "74.70%", header: "Percent (All enrolled students)" }]);
  assert.equal(placeCells(header, lineWith(doc, "between 2.0 and 2.49")).cells[0].header, "Percent (All enrolled students)");
});

test("Baylor C21: each value sits on its label's line (plain order printed 'Yes 11/1 12/15 566 453')", async () => {
  const doc = await laid("layout-baylor-c21.txt");
  assert.equal(lineWith(doc, "early decision plan closing date"), "@66 First or only early decision plan closing date | @352 11/1");
  assert.equal(lineWith(doc, "early decision plan notification date"), "@66 First or only early decision plan notification date | @350 12/15");
  assert.equal(lineWith(doc, "applications received"), "@66 Number of early decision applications received by your institution | @353 566");
  assert.equal(lineWith(doc, "admitted under early decision"), "@66 Number of applicants admitted under early decision plan | @353 453");
});

test("Loyola C1: totals printed as ## are summed from their parts", async () => {
  const doc = await laid("layout-loyola-c1.txt");
  assert.deepEqual(overflowTotal(lineWith(doc, "(degree-seeking) who applied")), { v: 20089 + 15530 + 7973 + 362, parts: [20089, 15530, 7973, 362] });
  assert.deepEqual(overflowTotal(lineWith(doc, "who were")), { v: 15546 + 13530 + 3769 + 164, parts: [15546, 13530, 3769, 164] });
  assert.equal(overflowTotal(lineWith(doc, "(degree-seeking) who enrolled"))?.v, 1382 + 1170 + 53);
  assert.equal(overflowTotal("@63 Total first-time, first-year who applied | @280 20089 | @417 43954"), null);
});

/* ------------------------------------------------------------------ */
/* Body: definitions, edition, split, numbering                        */
/* ------------------------------------------------------------------ */

test("the edition comes from the cover, never the page headers that say the year before (USC, Loyola)", async () => {
  const usc = await laid("layout-usc-edition.txt");
  assert.deepEqual(usc.edition, { edition: "2025-26", from: "cover" });
  assert.deepEqual((await laid("layout-loyola-c1.txt")).edition, { edition: "2025-26", from: "cover" });
  // Without its cover page, USC's item text decides ("official enrollment date in Fall 2025").
  const noCover = usc.lines.map((l, i) => [l, usc.pages[i]] as const).filter(([, p]) => p > 1);
  assert.deepEqual(editionFromBody(noCover.map(([l]) => l), noCover.map(([, p]) => p)), { edition: "2025-26", from: "items" });
  // Headers alone name no edition; a running header on page 1 isn't the cover either.
  assert.equal(editionFromBody(["@55 Common Data Set 2024-2025", "@55 Common Data Set 2024-2025", "@55 Common Data Set 2024-2025"], [2, 3, 4]), null);
  assert.deepEqual(
    editionFromBody(
      ["@55 Common Data Set 2024-2025", "@86 Welcome to the 2025-2026 Common Data Set collection!", "@55 Common Data Set 2024-2025", "@55 Common Data Set 2024-2025"],
      [1, 1, 2, 3]
    ),
    { edition: "2025-26", from: "cover" }
  );
  // Michigan prints its edition only as a running header (page 1 too): the item text decides, and B22's "Fall 2024
  // entering cohort" (last year's cohort) doesn't vote.
  assert.deepEqual(
    editionFromBody(
      [
        "@234 Common Data Set 2025-2026",
        "@54 Calculate the percentage of the Fall 2024 entering cohort who remained enrolled on the",
        "@54 Calculate the percentage of the Fall 2024 entering cohort who remained enrolled on the",
        "@234 Common Data Set 2025-2026",
        "@54 enrollment date in Fall 2025.",
        "@234 Common Data Set 2025-2026",
        "@72 For the Fall 2025 entering class:",
      ],
      [1, 1, 1, 2, 2, 3, 3]
    ),
    { edition: "2025-26", from: "items" }
  );
  // A cover that disagrees with the item text is kept and the disagreement reported.
  assert.deepEqual(editionFromBody(["@86 Common Data Set 2025-2026", "@72 the Fall 2024 entering class"], [1, 2]), { edition: "2025-26", from: "cover", conflict: "2024-25" });
});

const BODY = [
  "@86 Common Data Set 2025-2026",
  "@56 B1 | @77 Institutional Enrollment",
  "@78 C1-C2: Applications",
  "@53 C1",
  "@78 Total first-time, first-year males who applied | @450 10,738",
  "@71 D1-D2: Fall Applicants",
  "@46 D1 | @71 Does your institution enroll transfer students?",
  "@60 H1 | @80 Scholarships/Grants",
  "@268 Common Data Set Definitions",
  "@46 Class rank: The relative numerical position of a student in his or her graduating class",
];

test("definitions are dropped; the body splits at the C1 and D1 markers; lines are numbered for citation", async () => {
  assert.equal(dropDefinitions(BODY).length, 8);
  const doc = await layoutDocument(pagesFromLayoutText(["=== Page 1 ===", ...BODY.slice(0, 4), "=== Page 2 ===", ...BODY.slice(4)].join("\n")), "pdf-flat");
  assert.equal(doc.lines.length, 8);
  assert.equal(doc.definitionsFrom, 2);
  assert.equal(doc.lines.some((l) => /Class rank: The relative/.test(l)), false);
  assert.deepEqual(doc.split, { C: [3, 5], rest: [[1, 2], [6, 8]], fallback: false });
  assert.deepEqual(doc.sections, { B: [1, 1], C: [1, 2], D: [2, 2], H: [2, 2] });
  assert.equal(
    linesFor(doc, doc.split!.C),
    ["--- Page 1 ---", "3: @78 C1-C2: Applications", "4: @53 C1", "--- Page 2 ---", "5: @78 Total first-time, first-year males who applied | @450 10,738"].join("\n")
  );
  assert.equal(linesFor(doc, doc.split!.rest).split("\n").filter((l) => /^\d+:/.test(l)).length, 5);
  // No markers: both calls get the whole body.
  assert.deepEqual(splitCD(["@50 B1 enrollment", "@50 H1 aid"]), { C: [1, 2], rest: [[1, 2]], fallback: true });
  assert.deepEqual(splitCD(["@50 C1", "@50 no D section"]).fallback, true);
});

/* ------------------------------------------------------------------ */
/* Older Excel and HTML (test 6)                                       */
/* ------------------------------------------------------------------ */

test("older Excel (Berkeley): column letters and empty cells survive, so a lone value and an x keep their columns", () => {
  const fx = JSON.parse(readFileSync(join(FIX, "berkeley-cds-c.json"), "utf8")) as { rows: Record<string, { col: string; value: string | number }[]> };
  const sheet: Sheet = new Map(Object.entries(fx.rows).map(([r, cells]) => [Number(r), cells]));
  const lines = classicSheetText(sheet).split("\n");
  assert.equal(lines[1], "@A100 | @B100 Academic | @C100 Very Important | @D100 Important | @E100 Considered | @F100 Not Considered");
  assert.equal(lines[2], "@A101 | @B101 Rigor of secondary school record | @C101 x");
  assert.equal(lines[3], "@A102 | @B102 Class rank | @C102 | @D102 | @E102 | @F102 x");
  assert.equal(lines.find((l) => l.includes("3.75")), "@A233 | @B233 Percent who had GPA between 3.75 and 3.99 | @C233 | @D233 | @E233 | @F233 0.501");
  // The column of the x is the column of its header.
  const col = (l: string, text: string) => /@([A-Z]+)\d+ /.exec(l.split(" | ").find((c) => c.endsWith(` ${text}`))!)![1];
  assert.equal(col(lines[3], "x"), col(lines[1], "Not Considered"));
  assert.equal(col(lines[2], "x"), col(lines[1], "Very Important"));
});

test("HTML (MIT): empty <td>s survive as empty cells, so the X column is kept", () => {
  const text = htmlToText(readFileSync(join(FIX, "mit-c7.html"), "utf8"));
  const lines = text.split("\n");
  assert.ok(lines.includes("Academic | Very Important | Important | Considered | Not Considered"), text);
  assert.ok(lines.includes("Rigor of secondary school record | | X | |"), text);
  assert.ok(lines.includes("Class rank | | | X |"), text);
  const cells = (l: string) => l.split("|").map((c) => c.trim());
  const header = cells("Academic | Very Important | Important | Considered | Not Considered");
  assert.equal(header[cells("Class rank | | | X |").indexOf("X")], "Considered");
  // A <br> or <p> inside a cell doesn't break the row either.
  assert.equal(htmlToText("<table><tr><td>Fee<br>waiver</td>\n<td></td>\n<td><p>Yes</p></td></tr></table>"), "Fee waiver | | Yes");
});

test("HTML and older Excel go through layoutDocument too, with an edition from their first lines", async () => {
  const html = `<html><body><h1>2025-26 Common Data Set</h1><p>C1-C2</p><table><tr><td>C1</td><td>Total applied</td><td>33,767</td></tr></table>
  <p>D1-D2</p><p>For the Fall 2025 entering class</p></body></html>`;
  const doc = await layoutDocument(new Uint8Array(Buffer.from(html)), "html");
  assert.deepEqual(doc.edition, { edition: "2025-26", from: "cover" });
  assert.ok(doc.lines.includes("C1 | Total applied | 33,767"));
  assert.deepEqual(doc.split?.fallback, false);
});
