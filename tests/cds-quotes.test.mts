/**
 * Line-cited quotes (specs/college-reported-round-3.md Decision 4; test 7): lib/cds-quotes.ts. A model cites line ids;
 * code builds the quote from those lines, verbatim; the value must be on its cited line; a line id outside the
 * document fails; a quote the model wrote is ignored. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { citeAnswer, citedLines, lineText, numberOnLines, numbersOn, QUOTE_MAX, quoteFromLines, stripLayoutTags } from "../lib/cds-quotes.ts";

const LINES = [
  "@86 Common Data Set 2025-2026",
  "@63 Total first-time, first-year (degree-seeking) who applied | @280 20089 | @331 15530 | @389 7973 | @417 362 ##",
  "@78 Total first-time, first-year students who applied | @450 37,270",
  "@78 Percent who had GPA of 4.0 | @540 74.70%",
  "@43 Tuition: Out-of-state: | @256 $3 4 , 604 | @362 $3 4 , 604",
  "@66 Number of early decision applications received by your institution",
  "@353 566",
  "@A233 | @B233 Percent who had GPA between 3.75 and 3.99 | @C233 | @D233 | @E233 | @F233 0.501",
  "@72 Calculate the percentage of the Fall 2025 entering cohort who remained enrolled on the official census date. | @454 95.18%",
];

test("tags are stripped and split digits joined; item names aren't numbers", () => {
  assert.equal(stripLayoutTags(LINES[2]), "Total first-time, first-year students who applied | 37,270");
  assert.equal(stripLayoutTags(LINES[7]), "| Percent who had GPA between 3.75 and 3.99 | | | | 0.501");
  assert.equal(lineText(LINES[4]), "Tuition: Out-of-state: | $34,604 | $34,604");
  assert.deepEqual(numbersOn(LINES[2]), [37270]);
  assert.deepEqual(numbersOn("@53 C11 | @78 H2A | @450 12"), [12]);
  assert.deepEqual(numbersOn(LINES[7]), [3.75, 3.99, 0.501]);
});

test("the quote is built from the cited line(s), verbatim and ≤ 160 characters", () => {
  assert.equal(quoteFromLines(LINES, [3]), "Total first-time, first-year students who applied | 37,270");
  assert.equal(quoteFromLines(LINES, [6, 7]), "Number of early decision applications received by your institution / 566");
  const long = quoteFromLines(LINES, [9], 0.9518);
  assert.ok(long && long.length <= QUOTE_MAX, long ?? "");
  assert.ok(long?.includes("95.18%"), long ?? "");
  // Without a value to keep in view, the end of the line (where values sit) is kept.
  assert.ok(quoteFromLines(LINES, [9])!.endsWith("census date. | 95.18%"));
  // A line id outside the document, or no line at all, gives no quote.
  assert.equal(quoteFromLines(LINES, [0]), null);
  assert.equal(quoteFromLines(LINES, [LINES.length + 1]), null);
  assert.equal(quoteFromLines(LINES, [2.5]), null);
  assert.equal(quoteFromLines(LINES, []), null);
  assert.equal(citedLines(LINES, [1, 99]), null);
});

test("a number must be on its cited line: separators, split digits, and percent forms tolerated", () => {
  assert.equal(numberOnLines(37270, LINES, [3]), true); // printed "37,270"
  assert.equal(numberOnLines(34604, LINES, [5]), true); // printed "$3 4 , 604"
  assert.equal(numberOnLines(0.747, LINES, [4], { percent: true }), true); // printed "74.70%"
  assert.equal(numberOnLines(0.501, LINES, [8], { percent: true }), true); // an Excel share
  assert.equal(numberOnLines(566, LINES, [6, 7]), true); // label and value on two lines
  assert.equal(numberOnLines(15530, LINES, [2]), true);
  // Not on the cited line (it is on another line): fails.
  assert.equal(numberOnLines(37270, LINES, [2]), false);
  assert.equal(numberOnLines(566, LINES, [6]), false);
  assert.equal(numberOnLines(0.747, LINES, [4]), false); // a percent item needs { percent: true }
  assert.equal(numberOnLines(233, LINES, [8]), false); // the row number in a cell tag isn't printed text
  assert.equal(numberOnLines(450, LINES, [3]), false); // nor is an @x position
  // Past the end of the document: fails.
  assert.equal(numberOnLines(37270, LINES, [LINES.length + 1]), false);
});

test("a model answer is cited by code: the model's own quote is ignored, a wrong line fails line-cite", () => {
  const ok = citeAnswer({ v: 37270, lines: [3], quote: "Applicants: 37,270 (invented)" }, LINES, LINES.map((_, i) => (i < 2 ? 9 : 10)));
  assert.deepEqual(ok, { citation: { line: 3, page: 10, quote: "Total first-time, first-year students who applied | 37,270" } });
  assert.deepEqual(citeAnswer({ v: 566, lines: [6, 7, 7] }, LINES, null), {
    citation: { line: 6, lines: [6, 7], quote: "Number of early decision applications received by your institution / 566" },
  });
  const wrong = citeAnswer({ v: 37271, lines: [3], quote: "Total … who applied | 37,271" }, LINES, null);
  assert.equal("failure" in wrong && wrong.failure.check, "line-cite");
  const outside = citeAnswer({ v: 37270, lines: [400] }, LINES, null);
  assert.ok("failure" in outside && /aren't lines 1–9/.test(outside.failure.detail));
  // Words and booleans need only a real line; percents are checked as percents.
  assert.ok("citation" in citeAnswer({ v: "Very Important", lines: [1] }, LINES, null));
  assert.ok("citation" in citeAnswer({ v: 0.9518, lines: [9] }, LINES, null, { percent: true }));
  assert.ok("failure" in citeAnswer({ v: 0.9518, lines: [8] }, LINES, null, { percent: true }));
});
