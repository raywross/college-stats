/**
 * Time to degree (specs/data-expansion/time-to-degree.md): the 4/6/8-year steps read from Outcome Measures, the guards
 * that keep them right when NCES publishes a new OM file, and the stored values and history. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { OM_COLUMNS, completion4, eightYearFrom, isCumulative, timeToDegreeCoverage, timeToDegreeHeadline } from "../lib/outcome-measures.ts";
import { ERAS, requiredColumns } from "../scripts/history/registry.mts";
import { lastPointMismatches } from "../scripts/history/build.mts";
import { parseFilters } from "../lib/params.ts";
import type { SchoolHistory } from "../lib/history.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

/** A pivoted OM row for the all-students cohort (50): adjusted cohort, awards by 4/6/8 years, 8-year status. */
const row = (n: number, a4: string, a6: string, a8: number, still = 0, elsewhere = 0) => ({
  OMACHRT_50: String(n),
  OMAWDN4_50: a4,
  OMAWDN6_50: a6,
  OMAWDN8_50: String(a8),
  OMENRYI_50: String(still),
  OMENRAI_50: String(elsewhere),
  OMENRUN_50: String(n - a8 - still - elsewhere),
});

test("the reader turns cumulative 4/6/8-year counts into shares of the cohort", () => {
  const o = eightYearFrom(row(100, "60", "75", 80, 2, 10), 2016)!;
  assert.equal(o.all.award_4, 0.6);
  assert.equal(o.all.award_6, 0.75);
  assert.equal(o.all.award, 0.8);
  assert.equal(timeToDegreeHeadline(o.all), "60 of 100 finish within 4 years, 75 within 6, and 80 within 8.");
});

test("counts that step down (4 > 6 or 6 > 8) drop the 4/6-year shares but keep the 8-year outcomes", () => {
  for (const [a4, a6] of [["70", "65"], ["60", "85"]]) {
    const o = eightYearFrom(row(100, a4, a6, 80, 2, 10), 2016)!;
    assert.equal(o.all.award_4, null, `${a4}/${a6}/80`);
    assert.equal(o.all.award_6, null);
    assert.equal(o.all.award, 0.8, "the 8-year outcome bar is unaffected");
    assert.equal(timeToDegreeHeadline(o.all), null);
  }
  assert.equal(isCumulative(1, 2, 3), true);
  assert.equal(isCumulative(3, 2, 3), false);
  assert.equal(isCumulative(null, 2, 3), false);
});

test("a blank 4- or 6-year count drops only time-to-degree, never the 8-year outcomes", () => {
  const o = eightYearFrom(row(100, "", "75", 80, 2, 10), 2016)!;
  assert.equal(o.all.award_4, null);
  assert.equal(o.all.award, 0.8);
  assert.equal(o.all.transferred, 0.1);
});

test("under 30 students, all three steps are hidden together", () => {
  const o = eightYearFrom(row(20, "10", "14", 15), 2016)!;
  assert.deepEqual([o.all.award_4, o.all.award_6, o.all.award], [null, null, null]);
});

test("a renamed 4- or 6-year column stops sync-data and sync-history instead of going blank", () => {
  assert.ok(OM_COLUMNS.includes("OMAWDN4") && OM_COLUMNS.includes("OMAWDN6"));
  const om = ERAS.find((e) => e.family === "om")!;
  const required = requiredColumns(om, om.files(om.years[0])[0]);
  assert.ok(required.includes("OMAWDN4") && required.includes("OMAWDN6"), "history requires them in every OM file");
});

test("stored values: every shown group is cumulative, and coverage matches the 8-year outcomes", () => {
  let groups = 0;
  for (const s of schools) {
    const o = s.outcomes?.eight_year;
    for (const g of [o?.all, o?.first_time, o?.transfer_in, o?.pell, o?.non_pell]) {
      if (!g || g.award_4 == null || g.award_6 == null || g.award == null) continue;
      groups++;
      assert.ok(g.award_4 <= g.award_6 && g.award_6 <= g.award, `${s.name}: ${g.award_4} ≤ ${g.award_6} ≤ ${g.award}`);
    }
  }
  assert.ok(groups > 4000, `${groups} groups`);
  const { shown, missing } = timeToDegreeCoverage(schools);
  assert.ok(missing <= shown * 0.01, `${missing} of ${shown} shown groups lack 4/6-year shares (sync-data's limit is 1%)`);
  // Vanderbilt, all entering students of fall 2016 (OM2024): 88.7% / 92.8% / 93.1%.
  const v = byId("221999").outcomes!.eight_year!.all;
  assert.deepEqual([v.award_4, v.award_6, v.award], [0.8871, 0.9279, 0.9306]);
  assert.equal(completion4(byId("221999")), 0.8871);
});

test("Explore sorts by finishing within 4 years", () => {
  assert.equal(parseFilters({ sortBy: "completion_4yr" }).sortBy, "completion_4yr");
});

test("history: the 4- and 6-year series cover the same classes as 8 years and end on the snapshot (rule 1)", () => {
  const h: SchoolHistory = JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", "221999.json"), "utf8"));
  const s = byId("221999");
  const o = s.outcomes!.eight_year!;
  assert.equal(h.series.om_award_4!.start, h.series.om_award!.start);
  assert.equal(h.series.om_award_4!.values.length, h.series.om_award!.values.length);
  assert.equal(h.series.om_award_4!.values.at(-1), o.all.award_4);
  assert.equal(h.series.om_award_6!.values.at(-1), o.all.award_6);
  const latest = { fall: 2024, academic: 2023 };
  const only = (list: string[]) => list.filter((m) => / om_award_[46]:/.test(m));
  assert.deepEqual(only(lastPointMismatches([s], new Map([[s.unit_id, h]]), latest)), []);
  const broken = structuredClone(s);
  broken.outcomes!.eight_year!.all.award_4 = 0.5;
  assert.equal(only(lastPointMismatches([broken], new Map([[s.unit_id, h]]), latest)).length, 1, "a drifted snapshot is caught");
});
