/**
 * The one-time fraction-rate correction (scripts/fix-fraction-rates.mts): a graduation rate printed as a fraction and
 * stored as points is corrected from its own quote, and nothing else is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixFractionRate } from "../scripts/fix-fraction-rates.mts";

test("a fraction stored as points is corrected from the number printed in its quote (Yale, Georgia)", () => {
  // Yale's line H prints "0.945 | 1 | 0.967 | 0.963"; 0.945 was stored as 0.00945 and "1" as 0.01.
  const yale = "H. Six-year graduation rate for 2019 cohort (G divided by C) | 0.945 | 1 | 0.967 | 0.963";
  assert.equal(fixFractionRate("B.429", { v: 0.00945, status: "failed", quote: yale })?.v, 0.945);
  assert.equal(fixFractionRate("B.430", { v: 0.01, status: "failed", quote: yale })?.v, 1);
  // A fillable form's computed field.
  const ga = fixFractionRate("B.429", { v: 0.0084425349, status: "failed", quote: "Recipients of a Federal Pell Grant | 0.844253491", field: "GRS_BACH_PELL_P" });
  assert.ok(ga && Math.abs((ga.v as number) - 0.844253491) < 1e-6);
});

test("nothing else is touched", () => {
  // Not a quotient-rate code.
  assert.equal(fixFractionRate("B.101", { v: 0.005, status: "passed", quote: "x | 0.5" }), null);
  // Already a share.
  assert.equal(fixFractionRate("B.429", { v: 0.945, status: "passed", quote: "x | 0.945" }), null);
  // The quote doesn't print that fraction: never guessed.
  assert.equal(fixFractionRate("B.429", { v: 0.00945, status: "failed", quote: "x | 94.5%" }), null);
  // No quote.
  assert.equal(fixFractionRate("B.429", { v: 0.00945, status: "failed" }), null);
  // Idempotent: a corrected value isn't corrected again.
  const once = fixFractionRate("B.429", { v: 0.00945, status: "failed", quote: "x | 0.945" })!;
  assert.equal(fixFractionRate("B.429", once), null);
});
