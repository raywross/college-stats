/**
 * Month/day dates in a Common Data Set (lib/cds-dates.ts; specs/data-expansion/cds-application-logistics.md "Date
 * handling"): every format in the spec, the Excel serial, the unparseable case, the valid-date check's outcomes, and
 * ordering within a cycle. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareInCycle, cycleOrder, dateCheck, formatCdsDate, isConcrete, parseCdsDate, splitCdsDate } from "../lib/cds-dates.ts";

const md = (month: number | null, day: number | null) => ({ month, day });

test("split month/day cells (the template's native form)", () => {
  assert.deepEqual(splitCdsDate(1, 2), md(1, 2));
  assert.deepEqual(splitCdsDate(11, 1), md(11, 1));
  assert.deepEqual(splitCdsDate(null, 5), md(null, null));
  assert.deepEqual(splitCdsDate("varies", 5), md(null, null), "text in a month cell is not a date");
});

test("one free-text cell: 11/1, 1-Nov, Nov 1st, 8/1, and the stored --MM-DD", () => {
  assert.deepEqual(parseCdsDate("11/1"), md(11, 1));
  assert.deepEqual(parseCdsDate("1-Nov"), md(11, 1));
  assert.deepEqual(parseCdsDate("Nov 1st"), md(11, 1));
  assert.deepEqual(parseCdsDate("8/1"), md(8, 1));
  assert.deepEqual(parseCdsDate("--04-01"), md(4, 1));
});

test("Excel serial: William & Mary's C.1608 46113 is April 1, only in a workbook", () => {
  assert.deepEqual(parseCdsDate("46113", { excel: true }), md(4, 1));
  assert.deepEqual(parseCdsDate(46113, { excel: true }), md(4, 1));
  // Break: the same digits outside a workbook (PDF or HTML text) are never a date.
  assert.deepEqual(parseCdsDate("46113"), md(null, null));
});

test("text that isn't a date keeps nothing parsed (the quote holds it) and never throws", () => {
  assert.deepEqual(parseCdsDate("11 months 1 day"), md(null, null));
  assert.deepEqual(parseCdsDate("Early April"), md(null, null));
  assert.deepEqual(parseCdsDate(undefined), md(null, null));
  assert.deepEqual(parseCdsDate({}), md(null, null));
  assert.equal(isConcrete(parseCdsDate("Early April")), false);
});

test("valid-date: free text is unparsed (not a failure); numeric out of range is invalid; Feb 30 is invalid", () => {
  assert.equal(dateCheck("11/1"), "valid");
  assert.equal(dateCheck("11 months 1 day"), "unparsed");
  assert.equal(dateCheck("1/34"), "invalid");
  assert.equal(dateCheck("13/1"), "invalid");
  assert.equal(dateCheck([2, 30]), "invalid");
  assert.equal(dateCheck([1, 34]), "invalid");
  assert.equal(dateCheck([1, 5]), "valid");
  assert.equal(dateCheck(["varies", null]), "unparsed");
  assert.equal(dateCheck([null, null]), "blank");
  assert.equal(dateCheck(""), "blank");
});

test("ordering within a cycle: November comes before January; display reads 'January 5'", () => {
  assert.ok(compareInCycle({ month: 11, day: 1 }, { month: 1, day: 5 }) < 0);
  assert.ok(compareInCycle({ month: 5, day: 1 }, { month: 4, day: 1 }) > 0);
  assert.equal(compareInCycle({ month: 1, day: 5 }, { month: 1, day: 5 }), 0);
  assert.ok(cycleOrder({ month: 8, day: 15 }) < cycleOrder({ month: 12, day: 1 }));
  assert.equal(formatCdsDate({ month: 1, day: 5 }), "January 5");
  assert.equal(formatCdsDate({ month: null, day: null }), null);
});
