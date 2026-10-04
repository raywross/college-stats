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

/* ---- Fourth run (20261004-004725-6) ---- */

test("every code in a call has its own description, so a grid's cells can't be confused", async () => {
  // The model had put Washington University's 33,283 total applicants in the in-state cell: C.116 and C.119 both read
  // "Total first-time, first-year who applied" before the descriptors were added.
  const { CDS_TEMPLATE } = await import("../lib/cds-template.ts");
  const { codeTableText } = await import("../lib/cds-sections.ts");
  for (const call of ["C", "rest"] as const) {
    const lines = codeTableText(CDS_TEMPLATE, call).split("\n");
    const descriptions = lines.map((l) => l.split(" | ").slice(1).join(" | "));
    const shared = descriptions.filter((d, i) => descriptions.indexOf(d) !== i);
    assert.deepEqual(shared, [], `${call}: ${shared.length} shared descriptions`);
  }
  const c = codeTableText(CDS_TEMPLATE, "C");
  assert.match(c, /^C\.119 \| Total first-time, first-year who applied \[In-State\] \| count$/m);
  assert.match(c, /^C\.1111 \| .*NO_SUB/m);
});

test("a document too long for Haiku's context goes to Sonnet 5 whole, not to a rejected request", async () => {
  // Houston's older workbook measured 201,379 tokens and its rest call came back invalid_request.
  const { extractionModelFor, HAIKU_CONTEXT_TOKENS } = await import("../scripts/lib/college-reported/llm.mts");
  assert.equal(extractionModelFor(40_000, "rest"), "claude-haiku-4-5");
  assert.equal(extractionModelFor(150_000, "rest"), "claude-sonnet-5");
  assert.equal(extractionModelFor(HAIKU_CONTEXT_TOKENS, "C"), "claude-sonnet-5");
});

test("an aid year read from the heading its mark sits under is found on the heading's line", () => {
  // Washington University and UC San Diego: "2025-2026 estimated" cited to the line "@370 2025-2026".
  const text = { value_type: "text" as const };
  assert.equal(valueOnLine("@370 2025-2026", "2025-2026 estimated", text), true);
  assert.equal(valueOnLine("@370 2024-2025", "2025-2026 estimated", text), false);
  assert.equal(valueOnLine("@57 Indicate the academic year for which data are reported", "2025-2026", text), false);
});

/* ---- Fifth run (20261004-011421-7) ---- */

test("next year's tuition is read from the cells of the college's own sector: a public's stray private cell is ignored", async () => {
  // Florida's 2025–26 record had its in-state $6,436 in G.101 (the private cell) as well as G.104, and the page showed it
  // as a private college's tuition.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { costAndDebtFromRecord, tuitionSector } = await import("../lib/cds/cost-and-debt.ts");
  const schools = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "schools.json"), "utf8")) as { unit_id: string; type: string }[];
  const uf = schools.find((s) => s.unit_id === "134130")!;
  assert.equal(tuitionSector(uf as never), "public");
  const cell = (v: number) => ({ v, status: "passed", quote: `Tuition | $${v}`, cell: "G1" });
  const record = {
    unit_id: "134130",
    documents: [
      {
        sha256: "f".repeat(64), edition: "2025-26", type: "pdf-flat", url: "https://ir.aa.ufl.edu/cds.pdf", retrieved: "2026-10-04", reads: {},
        years: { "next-year": "2026–27", "graduating-class": "Class of 2025" },
        items: { "G.101": cell(6436), "G.104": cell(6436), "G.105": cell(34616), "G.106": cell(34616), "G.111": cell(1959), "G.112": cell(14190) },
      },
    ],
  };
  const out = costAndDebtFromRecord(record as never, uf as never);
  const tuition = out.cost?.next_year?.first_year.tuition;
  assert.equal(tuition?.kind, "public", JSON.stringify(out.held ?? []));
  assert.equal(tuition?.kind === "public" ? tuition.in_state : null, 6436);
  assert.equal(tuition?.kind === "public" ? tuition.out_of_state : null, 34616);
});
