/**
 * Trend indicators (specs/trend-indicators.md): the diversity summary in school.trends, the steady bands, the
 * applicant floor, and the Explore filter parameters. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School, SchoolTrends } from "../lib/types";
import { simpsonIndex } from "../lib/derive.ts";
import { RACE_SERIES, diversityChange, diversityIndexAt, type SchoolHistory } from "../lib/history.ts";
import { INDICATORS, INDICATOR_KEYS, changeText, detailText, indicatorOf, indicatorsOf, matchesIndicators } from "../lib/indicators.ts";
import { FILTER_KEYS, countActiveFilters, parseFilters } from "../lib/params.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

const LATEST = { latest: { fall: 2024, academic: 2023, cohort: 2018 } };

/**
 * A history with the same race shares every fall from `start`, except overrides by year (shares in RACE_SERIES
 * order, "other" last), and a steady undergrad count.
 */
function raceHistory(start: number, end: number, shares: number[], byYear: Record<number, number[]> = {}, undergrads = 1000): SchoolHistory {
  const keys = Object.values(RACE_SERIES);
  const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const series = Object.fromEntries(keys.map((k, j) => [k, { start, values: years.map((y) => (byYear[y] ?? shares)[j]) }]));
  series.undergrads = { start, values: years.map(() => undergrads) };
  return { unit_id: "1", series } as unknown as SchoolHistory;
}

const school = (trends: SchoolTrends): School => ({ unit_id: "1", name: "Test", trends }) as unknown as School;
const t = (change: number, from = 1000, to = 1000) => ({ since: 2014, from, to, change });

test("diversity index from history matches the snapshot formula", () => {
  const h = raceHistory(2010, 2024, [0.5, 0.2, 0.1, 0.1, 0.05, 0.03, 0.02]);
  assert.equal(diversityIndexAt(h, 2024), simpsonIndex([0.5, 0.2, 0.1, 0.1, 0.05, 0.03, 0.02]));
  assert.equal(diversityIndexAt(h, 2009), null);
});

test("diversity change: window start, up to 2 years late, else nothing", () => {
  const before = [0.8, 0.1, 0.05, 0.05, 0, 0, 0];
  const after = [0.5, 0.2, 0.1, 0.1, 0.05, 0.03, 0.02];
  const onTime = diversityChange(raceHistory(2012, 2024, after, { 2014: before }), LATEST)!;
  assert.equal(onTime.since, 2014);
  assert.ok(Math.abs(onTime.change - (simpsonIndex(after)! - simpsonIndex(before)!)) < 1e-12);
  assert.equal(diversityChange(raceHistory(2016, 2024, after), LATEST)!.since, 2016);
  assert.equal(diversityChange(raceHistory(2017, 2024, after), LATEST), null, "3 years late is a different window");
  assert.equal(diversityChange(raceHistory(2010, 2023, after), LATEST), null, "needs the latest fall");
});

test("diversity change: none for small colleges or when other/unknown shifts more than 10 points", () => {
  const before = [0.8, 0.1, 0.05, 0.05, 0, 0, 0];
  const after = [0.5, 0.2, 0.1, 0.1, 0.05, 0.03, 0.02];
  assert.ok(diversityChange(raceHistory(2010, 2024, after, { 2014: before }, 300), LATEST), "300 undergrads is enough");
  assert.equal(diversityChange(raceHistory(2010, 2024, after, { 2014: before }, 299), LATEST), null);
  // Lane College-like: the change is students whose race went unrecorded.
  const unknownShift = [0.6, 0, 0, 0.1, 0, 0, 0.3];
  assert.equal(diversityChange(raceHistory(2010, 2024, unknownShift, { 2014: [0.9, 0, 0, 0.1, 0, 0, 0] }), LATEST), null);
  const steadyOther = [0.5, 0, 0.1, 0.1, 0, 0, 0.3];
  assert.ok(diversityChange(raceHistory(2010, 2024, steadyOther, { 2014: [0.6, 0, 0.05, 0.05, 0, 0, 0.3] }), LATEST), "a large but steady other share is fine");
});

test("steady band: exactly the band is steady; beyond it moves", () => {
  assert.equal(indicatorOf(school({ avg_paid_all: t(0.05) }), "cost")!.direction, "steady");
  assert.equal(indicatorOf(school({ avg_paid_all: t(-0.05) }), "cost")!.direction, "steady");
  assert.equal(indicatorOf(school({ avg_paid_all: t(0.0501) }), "cost")!.direction, "up");
  assert.equal(indicatorOf(school({ avg_paid_all: t(-0.12) }), "cost")!.direction, "down");
  assert.equal(indicatorOf(school({ diversity: t(0.031) }), "diversity")!.direction, "up");
  assert.equal(indicatorOf(school({ diversity: t(0.03) }), "diversity")!.direction, "steady");
});

test("selectivity is the acceptance rate inverted, and needs 200+ applicants at both ends", () => {
  const apps = t(0.2, 5000, 6000);
  assert.equal(indicatorOf(school({ acceptance_rate: t(-0.07, 0.13, 0.06), applicants: apps }), "selectivity")!.direction, "up");
  assert.equal(indicatorOf(school({ acceptance_rate: t(0.1, 0.5, 0.6), applicants: apps }), "selectivity")!.direction, "down");
  assert.equal(indicatorOf(school({ acceptance_rate: t(-0.07), applicants: t(0.5, 150, 5000) }), "selectivity"), null);
  assert.equal(indicatorOf(school({ acceptance_rate: t(-0.07) }), "selectivity"), null, "no applicant counts, no indicator");
  assert.equal(indicatorOf(school({ applicants: t(0.5, 199, 300) }), "applications"), null);
  assert.equal(indicatorOf(school({}), "cost"), null);
});

test("text: signed changes with a true minus, and from → to where a percent would mislead", () => {
  const apps = t(0.2, 5000, 6000);
  assert.equal(changeText(indicatorOf(school({ avg_paid_all: t(-0.123) }), "cost")!), "−12%");
  assert.equal(detailText(indicatorOf(school({ avg_paid_all: t(0.2) }), "cost")!), "+20% after inflation");
  assert.equal(detailText(indicatorOf(school({ applicants: t(1.5, 1000, 2500) }), "applications")!), "+150%");
  assert.equal(detailText(indicatorOf(school({ acceptance_rate: t(-0.07, 0.13, 0.06), applicants: apps }), "selectivity")!), "admit rate 13% → 6%");
  assert.equal(detailText(indicatorOf(school({ diversity: t(0.14, 0.629, 0.773) }), "diversity")!), "index 0.63 → 0.77");
});

test("filter: every chosen indicator must match; colleges without one drop out", () => {
  const s = school({ avg_paid_all: t(-0.2), diversity: t(0.1) });
  assert.ok(matchesIndicators(s, { cost: ["down"] }));
  assert.ok(matchesIndicators(s, { cost: ["down", "steady"], diversity: ["up"] }));
  assert.ok(!matchesIndicators(s, { cost: ["up"] }));
  assert.ok(!matchesIndicators(s, { selectivity: ["steady"] }), "no applicant data");
  assert.ok(matchesIndicators(s, {}));
});

test("URL: directions parse per indicator, junk is dropped, and each counts as one filter", () => {
  const f = parseFilters({ costTrend: "down,steady,down", selTrend: "sideways", divTrend: "up" });
  assert.deepEqual(f.trends, { cost: ["down", "steady"], diversity: ["up"] });
  assert.equal(parseFilters({}).trends, undefined);
  for (const k of INDICATOR_KEYS) assert.ok((FILTER_KEYS as readonly string[]).includes(INDICATORS[k].param), `${k} param is a filter key`);
  assert.equal(countActiveFilters({ costTrend: "down", appsTrend: "up,steady" }), 2);
  assert.equal(new Set(INDICATOR_KEYS.map((k) => INDICATORS[k].param)).size, INDICATOR_KEYS.length);
});

test("committed data: most colleges get indicators, and every direction occurs", () => {
  const withAny = schools.filter((s) => indicatorsOf(s).length > 0).length;
  assert.ok(withAny / schools.length > 0.8, `only ${withAny} of ${schools.length} colleges have an indicator`);
  for (const k of INDICATOR_KEYS) {
    const seen = new Set(schools.map((s) => indicatorOf(s, k)?.direction).filter(Boolean));
    assert.deepEqual([...seen].sort(), ["down", "steady", "up"], `${k} uses all three directions`);
  }
});
