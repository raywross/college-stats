/**
 * Loans and repayment (specs/data-expansion/loans-and-repayment.md): the band parser, the repayment groups, the
 * "few students borrow" filter, and the stored values in data/schools.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { parseShareBand } from "../lib/derive.ts";
import { FEW_LOANS_MAX, REPAYMENT_STATUSES, hasFewLoans, rangeLabel, repaymentGroups } from "../lib/repayment.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

test("Scorecard share bands parse to ranges; anything else is null", () => {
  assert.deepEqual(parseShareBand("0.27-0.28"), { low: 0.27, high: 0.28 });
  assert.deepEqual(parseShareBand("<=0.02"), { low: 0, high: 0.02 });
  assert.deepEqual(parseShareBand(">=0.98"), { low: 0.98, high: 1 });
  assert.deepEqual(parseShareBand("0.31"), { low: 0.31, high: 0.31 });
  assert.deepEqual(parseShareBand(0.4), { low: 0.4, high: 0.4 });
  for (const bad of ["PrivacySuppressed", "", null, undefined, "1.5", "0.3-0.2", "-0.1", 2]) assert.equal(parseShareBand(bad), null, String(bad));
});

const exact = (v: number) => ({ low: v, high: v });
const withRepayment = (r: Record<string, { low: number; high: number }>) => ({ outcomes: { repayment_3yr: r } }) as unknown as School;
const full = {
  paid_in_full: exact(0.3), making_progress: exact(0.3), not_making_progress: exact(0.1), deferment: exact(0.1),
  forbearance: exact(0.1), delinquent: exact(0.05), default: exact(0.03), discharged: exact(0.02),
};

test("repayment groups need all eight categories and add to 100%", () => {
  const g = repaymentGroups(withRepayment(full))!;
  assert.equal(g.length, 6);
  assert.ok(Math.abs(g.reduce((a, x) => a + x.share, 0) - 1) < 1e-9, "bar widths add to exactly 100%");
  assert.deepEqual(g.find((x) => x.key === "paused"), { key: "paused", label: "Payments paused", color: "var(--muted-foreground)", low: 0.2, high: 0.2, share: 0.2 });
  const missing = { ...full } as Record<string, { low: number; high: number }>;
  delete missing.discharged;
  assert.equal(repaymentGroups(withRepayment(missing)), null, "a missing category means no chart");
  assert.equal(repaymentGroups(withRepayment({ ...full, paid_in_full: exact(0.6) })), null, "sums far from 100% mean no chart");
  assert.equal(rangeLabel({ low: 0.31, high: 0.32 }), "31–32%");
  assert.equal(rangeLabel({ low: 0.3, high: 0.3 }), "30%");
  assert.equal(REPAYMENT_STATUSES.length, 8);
});

test("the few-borrowers filter keeps colleges at or under 20%, never unreported ones", () => {
  const at = (r: number | null) => ({ outcomes: { federal_loan_rate: r } }) as unknown as School;
  assert.equal(FEW_LOANS_MAX, 0.2);
  assert.equal(hasFewLoans(at(0.2)), true);
  assert.equal(hasFewLoans(at(0.2001)), false);
  assert.equal(hasFewLoans(at(null)), false);
  assert.equal(parseFilters({ fewLoans: "1" }).fewLoans, true);
  assert.equal(countActiveFilters({ fewLoans: "1" }), 1);
});

test("Vanderbilt matches the Scorecard values probed for the spec", () => {
  const o = schools.find((s) => s.unit_id === "221999")!.outcomes!;
  assert.equal(o.federal_loan_rate, 0.0956);
  assert.equal(o.median_debt_pell, 9500);
  assert.deepEqual(o.median_debt_by_income, { low: 7500, mid: 11981, high: 14000 });
  assert.deepEqual(o.repayment_3yr?.paid_in_full, { low: 0.31, high: 0.32 });
});

test("stored loan values are in range, and most colleges' repayment charts", () => {
  const bad: string[] = [];
  for (const s of schools) {
    const o = s.outcomes;
    if (o?.federal_loan_rate != null && (o.federal_loan_rate < 0 || o.federal_loan_rate > 1)) bad.push(`${s.unit_id} loan rate`);
    for (const r of Object.values(o?.repayment_3yr ?? {})) if (r.low < 0 || r.high > 1 || r.low > r.high) bad.push(`${s.unit_id} repayment band`);
  }
  assert.deepEqual(bad, []);
  const charted = schools.filter((s) => repaymentGroups(s)).length;
  assert.ok(charted > 1500, `repayment charted for ${charted} colleges`);
});
