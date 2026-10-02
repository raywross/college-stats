/**
 * Graduation by group (specs/data-expansion/graduation-by-group.md): the GR{Y}_PELL_SSL and Scorecard readers, the
 * 30-student suppression, the gap and its filter and chip, the rolling average, and the stored values and history.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import {
  MIN_GROUP_COHORT,
  RACE_GROUPS,
  aidGroupGradFrom,
  gapPhrase,
  gradRateCell,
  groupRate,
  hasSmallPellGap,
  pellGap,
  pellGraduateAtSameRate,
  raceGradFrom,
  rawPellGap,
  rollingRate,
  scorecardRaceCohortField,
  scorecardRaceRateField,
} from "../lib/graduation-groups.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { lastYear, pellGapChange, valueAt, type HistoryMeta, type SchoolHistory } from "../lib/history.ts";
import { gradByGroupMismatches } from "../scripts/history/graduation-groups.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const hmeta: HistoryMeta = JSON.parse(readFileSync(join(ROOT, "data", "history", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;
const shard = (id: string): SchoolHistory => JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", `${id}.json`), "utf8"));

/** Vanderbilt's GR2024_PELL_SSL total-cohort row (PSGRTYPE 1), as published. */
const VANDERBILT_ROW = {
  UNITID: "221999", PSGRTYPE: "1",
  PGADJCT: "244", PGCMTOT: "218", SSADJCT: "34", SSCMTOT: "33", NRADJCT: "1316", NRCMTOT: "1240", TTADJCT: "1594", TTCMTOT: "1491",
};

test("the GR Pell/SSL reader: total-cohort row only, completers ÷ adjusted cohort, nothing under 30 students", () => {
  const g = aidGroupGradFrom(VANDERBILT_ROW)!;
  assert.deepEqual(g.rates, { pell: 0.8934, loan_no_pell: 0.9706, no_pell_no_loan: 0.9422, total: 0.9354 });
  assert.deepEqual(g.cohorts, { pell: 244, loan_no_pell: 34, no_pell_no_loan: 1316, total: 1594 });
  // The bachelor's-seeking sub-cohort row (PSGRTYPE 2) is a different denominator.
  assert.equal(aidGroupGradFrom({ ...VANDERBILT_ROW, PSGRTYPE: "2" }), null);
  assert.equal(aidGroupGradFrom(undefined), null);
  const small = aidGroupGradFrom({ ...VANDERBILT_ROW, SSADJCT: "29", SSCMTOT: "29" })!;
  assert.equal(small.rates.loan_no_pell, null, "29 students: suppressed");
  assert.equal(small.cohorts.loan_no_pell, 29, "but the class size is kept");
  assert.equal(groupRate(30, 30), 1);
  assert.equal(groupRate(31, 30), null, "more completers than students can't be right");
  for (const v of ["-1", "-2", "", "."]) assert.equal(aidGroupGradFrom({ ...VANDERBILT_ROW, PGADJCT: v })!.rates.pell, null, `"${v}" is missing, never 0`);
});

test("race/ethnicity rates from Scorecard keep only groups of 30 or more, with their cohorts", () => {
  const values: Record<string, number> = {
    [scorecardRaceRateField("black")]: 0.8889, [scorecardRaceCohortField("black")]: 189,
    [scorecardRaceRateField("aian")]: 1, [scorecardRaceCohortField("aian")]: 5,
  };
  const g = raceGradFrom((f) => values[f])!;
  assert.equal(g.rates.black, 0.8889);
  assert.equal(g.rates.aian, null);
  assert.equal(g.cohorts.aian, 5);
  assert.equal(g.rates.white, null);
  assert.equal(raceGradFrom(() => null), null);
});

test("the gap, the Explore filter, and the Known-for rule", () => {
  const s = (pell: number | null, neither: number | null, pellN = 200, overall = 0.8) =>
    ({ outcomes: { grad_rate_pell: pell, grad_rate_no_pell_no_loan: neither, grad_rate_ftft: overall, grad_cohorts: { pell: pellN, loan_no_pell: 50, no_pell_no_loan: 500, total: 800 } } }) as unknown as School;
  assert.equal(pellGap(s(0.8934, 0.9422)), 0.0488);
  assert.equal(pellGap(s(null, 0.9)), null);
  assert.equal(pellGap(s(0.99, 0)), null, "99% vs 0%: groups sorted inconsistently, not ranked");
  assert.equal(rawPellGap(s(0.99, 0)), -0.99, "but still known, for the profile's caution");
  assert.ok(!hasSmallPellGap(s(0.99, 0)));
  assert.equal(pellGap(byId("149505")), null, "Trinity Christian (GR2024: Pell 99%, neither 0 of 49)");
  assert.ok(hasSmallPellGap(s(0.9, 0.94)));
  assert.ok(!hasSmallPellGap(s(0.85, 0.9)), "5 points is not under 5");
  assert.ok(hasSmallPellGap(s(0.95, 0.9)), "Pell recipients ahead counts");
  assert.ok(!hasSmallPellGap(s(null, 0.9)), "unreported never matches");
  assert.ok(pellGraduateAtSameRate(s(0.9, 0.92)));
  assert.ok(!pellGraduateAtSameRate(s(0.9, 0.93)), "3 points");
  assert.ok(!pellGraduateAtSameRate(s(0.9, 0.91, 99)), "under 100 Pell students");
  assert.ok(!pellGraduateAtSameRate(s(0.5, 0.5, 200, 0.59)), "overall under 60%");
  assert.equal(parseFilters({ pellGap: "1" }).pellGap, true);
  assert.equal(parseFilters({ pellGap: "0" }).pellGap, undefined);
  assert.equal(parseFilters({ sortBy: "pell_gap" }).sortBy, "pell_gap");
  assert.equal(parseFilters({ sortBy: "pell_gap_change" }).sortBy, "pell_gap_change");
  assert.equal(countActiveFilters({ pellGap: "1" }), 1);
  assert.equal(gapPhrase(0.8934, 0.9422), "5 points below");
  assert.equal(gapPhrase(0.95, 0.94), "1 point above");
  assert.equal(gapPhrase(0.9, 0.9), "the same as");
  assert.equal(gradRateCell(null, 12), "Under 30 students");
  assert.equal(gradRateCell(null, null), null);
});

test("3-class rolling average is weighted by class size and needs two classes", () => {
  const r = rollingRate({ start: 2010, values: [0.5, 1, null, 0.8] }, { start: 2010, values: [100, 300, 50, 100] });
  assert.equal(r.values[0], null, "only one class so far");
  assert.equal(r.values[1], 0.875, "(50 + 300) / 400");
  assert.equal(r.values[2], null, "no rate of its own (suppressed)");
  assert.equal(r.values[3], 0.95, "(300 + 80) / 400, skipping the missing class");
  assert.deepEqual(rollingRate({ start: 2000, values: [0.6, 0.8] }, undefined).values, [null, 0.7], "no cohorts: equal weights");
});

test("stored values: Vanderbilt, the 30-student rule, the vintage, and the cohort type (matches Scorecard's 150% rate)", () => {
  const o = byId("221999").outcomes!;
  assert.equal(o.grad_rate_pell, 0.8934);
  assert.equal(o.grad_rate_no_pell_no_loan, 0.9422);
  assert.equal(o.grad_rate_ftft, 0.9354);
  assert.deepEqual(o.grad_cohorts, { pell: 244, loan_no_pell: 34, no_pell_no_loan: 1316, total: 1594 });
  assert.equal(o.grad_rate_by_race!.black, 0.8889);
  assert.equal(o.grad_rate_by_race!.aian, null, "5 students");
  assert.equal(meta.vintages["ipeds-gr"], "Entered fall 2018");
  assert.ok(meta.sources["ipeds-gr"]?.edition.includes("GR2024_PELL_SSL"));

  const withPell = schools.filter((s) => s.outcomes?.grad_rate_pell != null);
  assert.ok(withPell.length > 1300, `${withPell.length} colleges with a Pell rate`);
  for (const s of schools) {
    const out = s.outcomes;
    if (!out) continue;
    for (const [rate, n] of [[out.grad_rate_pell, out.grad_cohorts?.pell], [out.grad_rate_no_pell_no_loan, out.grad_cohorts?.no_pell_no_loan], [out.grad_rate_loan_no_pell, out.grad_cohorts?.loan_no_pell]] as const)
      if (rate != null) assert.ok(n != null && n >= MIN_GROUP_COHORT && rate >= 0 && rate <= 1, `${s.name}: rate on ${n} students`);
    for (const g of RACE_GROUPS) {
      const rate = out.grad_rate_by_race?.[g];
      if (rate != null) assert.ok((out.grad_cohorts_by_race?.[g] ?? 0) >= MIN_GROUP_COHORT, `${s.name} ${g}`);
    }
  }
  // The total-cohort row is what Scorecard's completion_rate_4yr_150nt (history's grad_rate) uses: same entering class.
  let same = 0;
  let compared = 0;
  for (const s of withPell) {
    const h = shard(s.unit_id);
    const v = valueAt(h.series.grad_rate, 2018);
    if (v === null || s.outcomes!.grad_rate_ftft == null) continue;
    compared++;
    if (Math.abs(v - s.outcomes!.grad_rate_ftft) < 1e-4) same++;
  }
  assert.ok(compared > 1000 && same / compared > 0.99, `${same} of ${compared} match`);
});

test("history: Pell series from the class of 2010, race from 2005, and the latest class equals the snapshot", () => {
  const h = shard("221999");
  assert.equal(h.series.grad_rate_pell!.start, 2010, "GR2016_PELL_SSL is the first file");
  assert.equal(h.series.grad_rate_pell!.values.at(-1), 0.8934);
  assert.equal(lastYear(h.series.grad_rate_pell!), hmeta.latest.cohort);
  assert.equal(h.series.grad_rate_black!.start, 2005, "Scorecard key 2011, the first with 2010 race categories");
  assert.equal(h.series.grad_cohort_black!.values.at(-1), 189);
  const files = readdirSync(join(ROOT, "data", "history", "schools")).map((f) => f.replace(/\.json$/, ""));
  const histories = new Map(files.map((id) => [id, shard(id)]));
  assert.deepEqual(gradByGroupMismatches(schools, histories), []);
  // Broken on purpose: a changed snapshot value is caught.
  const broken = structuredClone(byId("221999"));
  broken.outcomes!.grad_rate_pell = 0.5;
  assert.equal(gradByGroupMismatches([broken], histories).length, 1);
  const brokenRace = structuredClone(byId("221999"));
  brokenRace.outcomes!.grad_cohorts_by_race!.black = 1;
  assert.equal(gradByGroupMismatches([brokenRace], histories).length, 1);
});

test("Pell gap change: both ends need 100+ Pell students and both rates", () => {
  const m = { latest: { fall: 2024, academic: 2023, cohort: 2018 } };
  const h = (pell: (number | null)[], neither: (number | null)[], n: (number | null)[]): SchoolHistory => ({
    unit_id: "1",
    series: {
      grad_rate_pell: { start: 2010, values: pell },
      grad_rate_no_pell_no_loan: { start: 2010, values: neither },
      grad_cohort_pell: { start: 2010, values: n },
    },
  });
  const nine = (v: number | null) => Array.from({ length: 9 }, () => v);
  const c = pellGapChange(h([0.7, ...nine(0.75).slice(1, 8), 0.85], nine(0.9), nine(150)), m)!;
  assert.equal(c.since, 2010, "two classes after the window's start (2008)");
  assert.ok(Math.abs(c.change - -0.15) < 1e-9, "20-point gap narrowed to 5");
  assert.equal(pellGapChange(h(nine(0.8), nine(0.9), nine(99)), m), null, "under 100 Pell students");
  assert.equal(byId("221999").trends?.pell_gap?.since, 2010);
});
