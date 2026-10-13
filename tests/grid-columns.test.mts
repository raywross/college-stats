/**
 * lib/grid-columns.ts: placing C7 and C8A marks under their column headings from layout text, on fixtures cut from
 * real 2025–26 and older CDS PDFs (pdftotext -layout). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { C8_HEADINGS, gridColumns, nearest } from "../lib/grid-columns.ts";

const grid = (text: string) => Object.fromEntries(gridColumns(text.split("\n")));

// Neumann University's 2025-26 C7 (GPA Very Important, the rest Not Considered; a model read them as mixed levels).
const NEUMANN_C7 = `
C7      Relative importance of each of the following academic and nonacademic factors in your first-time, first-
        Academic                              Very Important     Important    Considered               Not
        Rigor of secondary school record                                                                X
        Class rank                                                                                      X
        Academic GPA                                 X
        Nonacademic                           Very Important     Important    Considered               Not
        Alumni/ae relation                                                                              X
        Work experience                                                                                 x
`;

test("C7: each mark goes under the heading above it, \"Not\" alone standing for Not Considered", () => {
  assert.deepEqual(grid(NEUMANN_C7), {
    "C.701": "Not Considered",
    "C.702": "Not Considered",
    "C.703": "Very Important",
    "C.712": "Not Considered",
    "C.717": "Not Considered",
  });
});

// Alabama A&M: an empty box in every column, the check on the line below, "Not / Considered" wrapped around the headings.
const BOXES_C7 = `
C7 Relative importance of each of the following academic and nonacademic factors
                                                                                                       Not
                                            Very Important          Important     Considered
                                                                                                    Considered
      Rigor of secondary school record             տ                    տ              տ
                                                                                       ✔                  տ
      Academic GPA                                 տ
                                                   ✔                    տ              տ                  տ
`;

test("C7: a check on the line below its row, among empty boxes, under a wrapped Not Considered heading", () => {
  assert.deepEqual(grid(BOXES_C7), { "C.701": "Considered", "C.703": "Very Important" });
});

test("C7: a row on the page after its headings isn't placed (positions can shift at a page break)", () => {
  const broken = NEUMANN_C7.replace("        Class rank", "\f        Class rank");
  assert.equal(grid(broken)["C.702"], null);
  assert.equal(grid(broken)["C.703"], null); // still below the break
});

// Bucknell's 2025-26 C8A: the mark is under "Not required … considered if submitted" (a model read Required).
const BUCKNELL_C8 = `
C8A Does your institution make use of SAT or ACT scores in admission decisions for                  Yes
      If yes, place check marks in the appropriate boxes below to reflect your institution’s policies for use in admission for students applying for Fall 2027.
                                                                                                                     Not required for    Not considered
                                                     Required to be
                                                                                                                     admission, but      for admission,
                         Admission                   considered for      Required for some      Recommended
                                                                                                                      considered if          even if
                                                       admission
                                                                                                                       submitted           submitted
      SAT or ACT                                                                                                            ✓
      ACT Only
      SAT Only
C8B Has been removed from the CDS.
`;

test("C8A: the 2025-26 form; the question's own \"SAT or ACT\" isn't a row", () => {
  // The ACT Only and SAT Only rows have no mark: found, not placed (a value read for them stays held).
  assert.deepEqual(grid(BUCKNELL_C8), { "C.802": C8_HEADINGS[3], "C.803": null, "C.804": null });
});

// An older form (2017-18): Require / Recommend / Require for Some / Consider if Submitted / Not Used, "C8A" on each row.
const OLD_C8 = `
C8A If yes, place check marks in the appropriate boxes below to reflect your institution’s policies for use in
    admission for Fall 2019.
C8A                                                                      ADMISSION
C8A                                         Require           Recommend    Require for Some       Consider if      Not
                                                                                                   Submitted      Used
C8A SAT or ACT                                 x
C8A ACT only
C8B If your institution will make use of the ACT in admission decisions
`;

test("C8A: an older form's headings in their own order, with the item code on every row", () => {
  assert.deepEqual(grid(OLD_C8), { "C.802": C8_HEADINGS[0], "C.803": null });
});

// Taylor's 2025-26 C8A: the mark sits between "Required for some" and "Recommended" on the line below its row.
const TAYLOR_C8 = `
C8A
      If yes, place check marks in the appropriate boxes below to reflect your institution’s policies for use in admission for students applying for Fall 2027.
                                                                                                                                           Not
                                                                                                                   Not required for
                                               Required to be                                                                         consider
                                                                                                                   admission, but
                Admission                      considered for       Required for some           Recommended                             admiss
                                                                                                                    considered if
                                                 admission                                                                                even
                                                                                                                     submitted
                                                                                                                                        submit

      SAT or ACT
                                                                                            X
C8B Has been removed from the CDS.
`;

test("C8A: a mark between two headings is left unplaced, not guessed", () => {
  assert.equal(grid(TAYLOR_C8)["C.802"], null);
});

test("nearest: a mark must sit clearly nearer one heading than its neighbours", () => {
  const cols = [
    { heading: "A", center: 10 },
    { heading: "B", center: 30 },
    { heading: "C", center: 50 },
  ];
  assert.equal(nearest(cols, 31), "B");
  assert.equal(nearest(cols, 21), null); // 9 from A, 11 from B: within 40% of the gap of neither
  assert.equal(nearest(cols, 80), null); // far past the last heading
});
