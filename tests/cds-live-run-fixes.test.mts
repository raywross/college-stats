/**
 * Fixes from the first live round-3 run (runs 20261004-000618-4 and 20261004-002803-5, ten new colleges): printed
 * percents read as points, a bare aid year, and values on lines that carry layout tags and printer-split digits.
 * Each case is a line or value from that run's real documents.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeValue, parseAidYear, yearsForEdition } from "../lib/cds-sections.ts";
import { valueOnLine } from "../lib/cds-checks.ts";

test("a printed percent is points when it came from a model or a form: '0.5' is 0.5%, so a band column sums to 100", () => {
  const pct = { value_type: "percent" as const };
  assert.equal(normalizeValue(pct, "0.5", { percentPoints: true }).v, 0.005);
  assert.equal(normalizeValue(pct, "56", { percentPoints: true }).v, 0.56);
  assert.equal(normalizeValue(pct, "27.4%", { percentPoints: true }).v, 0.274);
  // A workbook cell's fraction is unchanged without the option.
  assert.equal(normalizeValue(pct, 0.274, { excel: true }).v, 0.274);
  // Florida's SAT Math bands as printed (the run read 0.5 as 50% and the column summed to 199%).
  const column = ["56", "33", "9", "1.5", "0.5", "0", "0"].map((v) => normalizeValue(pct, v, { percentPoints: true }).v as number);
  assert.ok(Math.abs(column.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const asShares = ["56", "33", "9", "1.5", "0.5", "0", "0"].map((v) => normalizeValue(pct, v).v as number);
  assert.ok(asShares.reduce((a, b) => a + b, 0) > 1.4, "without the option the small bands become shares (the bug)");
});

test("an aid year printed without 'final' or 'estimated' parses, and labels the H items with the year alone", () => {
  assert.deepEqual(parseAidYear("2025-26"), { start: 2025, status: "unstated" });
  assert.deepEqual(parseAidYear("2024-2025 Final"), { start: 2024, status: "final" });
  assert.equal(parseAidYear("2025"), null);
  assert.equal(yearsForEdition("2025-26", { aidYear: "2025-26" })["aid-year"], "2025–26");
});

test("a value is found on its line past layout tags and printer-split digits, and 'X*' is a mark", () => {
  const count = { value_type: "count" as const };
  // Florida D2 (lines 682–683): "1,2 74" and "96 6" are 1,274 and 966.
  assert.equal(valueOnLine("@77 Males | @188 3,339 | @243 1,2 74 | @301 796", 1274, count), true);
  assert.equal(valueOnLine("@77 Females | @188 3,370 | @243 1,4 44 | @301 96 6", 1444, count), true);
  assert.equal(valueOnLine("@77 Females | @188 3,370 | @243 1,4 44 | @301 96 6", 966, count), true);
  assert.equal(valueOnLine("@77 Females | @188 3,370", 1444, count), false);
  // UNC D3: a footnoted mark.
  assert.equal(valueOnLine("@64 X* | @90 Summer | @164 *(See D11 Note)", true, { value_type: "check" }), true);
});
