/**
 * Admissions detail (specs/data-expansion/admissions-detail.md): acceptance rates by sex, the gap rule, true medians,
 * and the stored values in data/schools.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School, SexCounts } from "../lib/types";
import { admitRatesBySex, satMedian } from "../lib/derive.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const counts = (applicants: number | null, admitted: number | null): SexCounts => ({ applicants, admitted, enrolled: null });
const withBySex = (men: SexCounts, women: SexCounts) => ({ admissions: { by_sex: { men, women } } }) as unknown as School;

test("rates by sex use the overall rate's rule: none under 10 applicants", () => {
  assert.deepEqual(admitRatesBySex(withBySex(counts(200, 50), counts(9, 3))), { men: 0.25, women: null });
  assert.deepEqual(admitRatesBySex(withBySex(counts(null, 5), counts(10, 10))), { men: null, women: 1 });
  assert.deepEqual(admitRatesBySex({ admissions: { by_sex: null } } as unknown as School), { men: null, women: null });
});

test("the SAT median adds the section medians, and needs both", () => {
  assert.equal(satMedian({ admissions: { sat_reading_median: 750, sat_math_median: 790 } } as unknown as School), 1540);
  assert.equal(satMedian({ admissions: { sat_reading_median: 750, sat_math_median: null } } as unknown as School), null);
});

test("Vanderbilt matches its ADM2024 row (the spec's worked example)", () => {
  const vu = schools.find((s) => s.unit_id === "221999")!;
  assert.deepEqual(vu.admissions.by_sex, {
    men: { applicants: 20851, admitted: 1238, enrolled: 744 },
    women: { applicants: 24553, admitted: 1424, enrolled: 886 },
  });
  // Its 2025–26 CDS C9 now replaces the SAT and ACT blocks (cds-test-scores-and-policy.md, Decision 2); the ADM2024
  // values are kept in admissions.federal_tests.
  const kept = vu.admissions.federal_tests!;
  assert.equal(kept.sat?.sat_reading_median, 750);
  assert.equal(kept.sat?.sat_math_median, 790);
  assert.equal(kept.act?.act_composite_median, 35);
  assert.deepEqual(kept.act?.act_english_25_75, [35, 36]);
  assert.deepEqual(kept.act?.act_math_25_75, [32, 35]);
});

test("stored admissions detail is internally consistent", () => {
  const bad: string[] = [];
  for (const s of schools) {
    const a = s.admissions;
    const b = a.by_sex;
    // Men and women can't outnumber the total (another gender and unknown make up the rest). CDS overrides replace the
    // totals with a college's own report, so only federal totals are compared.
    if (b && !s.lineage?.["admissions.applicants"] && a.applicants !== null) {
      const both = (b.men.applicants ?? 0) + (b.women.applicants ?? 0);
      if (both > a.applicants) bad.push(`${s.unit_id} applicants by sex ${both} > total ${a.applicants}`);
    }
    for (const side of b ? [b.men, b.women] : []) {
      if (side.applicants !== null && side.admitted !== null && side.admitted > side.applicants) bad.push(`${s.unit_id} admitted > applied`);
    }
    for (const [k, r, lo, hi] of [
      ["act_english", a.act_english_25_75, 1, 36],
      ["act_math", a.act_math_25_75, 1, 36],
    ] as const) {
      if (r && (r[0] > r[1] || r[0] < lo || r[1] > hi)) bad.push(`${s.unit_id} ${k} ${r}`);
    }
    if (a.act_composite_median != null && (a.act_composite_median < 1 || a.act_composite_median > 36)) bad.push(`${s.unit_id} act median`);
    // A federal median sits inside its own federal middle 50% (the profile draws one on the other).
    for (const [k, median, range] of [
      ["sat_reading", a.sat_reading_median, a.sat_reading_25_75],
      ["sat_math", a.sat_math_median, a.sat_math_25_75],
      ["act", a.act_composite_median, a.act_composite_25_75],
    ] as const) {
      const field = k === "act" ? "admissions.act_composite_25_75" : `admissions.${k}_25_75`;
      if (median == null || !range || s.lineage?.[field as keyof NonNullable<School["lineage"]>]) continue;
      if (median < range[0] || median > range[1]) bad.push(`${s.unit_id} ${k} median ${median} outside ${range}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(schools.filter((s) => s.admissions.by_sex).length > 1400, "by-sex counts for most colleges with admissions data");
  assert.ok(schools.filter((s) => s.admissions.sat_reading_median != null).length > 700, "true SAT medians for hundreds of colleges");
});
