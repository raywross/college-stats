/**
 * Outcome Measures (specs/data-expansion/outcome-measures.md): the OM pivot and reader, suppression of small cohorts,
 * the Explore sort, and the stored values and history. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { MIN_COHORT, OM_COLUMNS, OM_PIVOT, completion8, eightYearFrom, isShown, leaversElsewhere, outcomeHeadline } from "../lib/outcome-measures.ts";
import { pivotRows } from "../scripts/lib/om.mts";
import { ERAS, requiredColumns } from "../scripts/history/registry.mts";
import { lastPointMismatches } from "../scripts/history/build.mts";
import { parseFilters } from "../lib/params.ts";
import type { SchoolHistory } from "../lib/history.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

/** One OM file row: cohort code plus adjusted cohort, awards, still here, elsewhere, unknown. */
const omRow = (id: string, chrt: string, n: number, award: number, still: number, elsewhere: number, unknown: number) => ({
  UNITID: id,
  OMCHRT: chrt,
  OMACHRT: String(n),
  OMAWDN8: String(award),
  OMENRYI: String(still),
  OMENRAI: String(elsewhere),
  OMENRUN: String(unknown),
});

test("pivotRows merges a college's cohort rows into one, suffixing columns with the numeric code", () => {
  const rows = pivotRows([omRow("1", "50", 100, 80, 2, 10, 8), omRow("1", "010", 60, 50, 1, 5, 4), omRow("2", "50", 5, 5, 0, 0, 0)], OM_PIVOT, new Set(["1"]));
  assert.equal(rows.size, 1, "keep limits the colleges");
  const r = rows.get("1")!;
  assert.equal(r.OMACHRT_50, "100");
  assert.equal(r.OMACHRT_10, "60", "zero-padded codes normalize");
  assert.equal(r.OMCHRT_50, undefined, "the pivot column itself isn't copied");
});

test("eightYearFrom: shares of the adjusted cohort, first-time and transfer-in groups summed full- and part-time", () => {
  const row = pivotRows(
    [
      omRow("1", "50", 200, 150, 4, 30, 16),
      omRow("1", "10", 100, 85, 1, 10, 4),
      omRow("1", "20", 20, 10, 1, 4, 5),
      omRow("1", "30", 70, 50, 2, 12, 6),
      omRow("1", "40", 10, 5, 0, 4, 1),
      omRow("1", "51", 50, 30, 1, 12, 7),
      omRow("1", "52", 150, 120, 3, 18, 9),
    ],
    OM_PIVOT
  ).get("1");
  const o = eightYearFrom(row, 2016)!;
  assert.equal(o.entering_year, 2016);
  assert.deepEqual(o.all, { cohort: 200, award: 0.75, still_enrolled: 0.02, transferred: 0.15, unknown: 0.08 });
  assert.deepEqual(o.first_time, { cohort: 120, award: 0.7917, still_enrolled: 0.0167, transferred: 0.1167, unknown: 0.075 });
  assert.equal(o.transfer_in!.cohort, 80);
  assert.equal(o.transfer_in!.award, 0.6875);
  assert.deepEqual(o.pell, { cohort: 50, award: 0.6 });
  assert.deepEqual(o.non_pell, { cohort: 150, award: 0.8 });
  assert.equal(outcomeHeadline(o.all), "75 of 100 students who start here earn a degree or certificate here within 8 years; 15 more are enrolled at another college.");
  assert.equal(completion8({ outcomes: { eight_year: o } as School["outcomes"] }), 0.75);
});

test("cohorts under 30 keep their size but no rates; missing colleges and groups are null, never 0", () => {
  const row = pivotRows([omRow("1", "50", 40, 30, 0, 6, 4), omRow("1", "10", 29, 22, 0, 4, 3), omRow("1", "51", MIN_COHORT, 20, 0, 6, 4)], OM_PIVOT).get("1");
  const o = eightYearFrom(row, 2016)!;
  assert.deepEqual(o.first_time, { cohort: 29, award: null, still_enrolled: null, transferred: null, unknown: null });
  assert.ok(!isShown(o.first_time));
  assert.equal(o.pell!.award, 0.6667, "exactly 30 is shown");
  assert.equal(o.transfer_in, null, "no transfer rows: no group");
  assert.equal(o.non_pell, null);
  assert.equal(eightYearFrom(undefined, 2016), null, "not in the file");
  // A blank count in a present row is unreadable, not zero.
  const blank = pivotRows([{ ...omRow("1", "50", 100, 80, 2, 10, 8), OMAWDN8: "" }], OM_PIVOT).get("1");
  assert.equal(eightYearFrom(blank, 2016), null);
});

test("leaversElsewhere: share of those who left without a credential who enrolled elsewhere; null when few left", () => {
  assert.ok(Math.abs(leaversElsewhere({ cohort: 100, award: 0.6, still_enrolled: 0, transferred: 0.3, unknown: 0.1 })! - 0.75) < 1e-9);
  assert.equal(leaversElsewhere({ cohort: 100, award: 0.97, still_enrolled: 0, transferred: 0.02, unknown: 0.01 }), null);
  assert.equal(leaversElsewhere({ cohort: 10, award: null, still_enrolled: null, transferred: null, unknown: null }), null);
});

test("the history era reads every OM column it needs, from OM2017 (fall 2009)", () => {
  const era = ERAS.find((e) => e.family === "om")!;
  assert.equal(era.years[0], 2009);
  assert.equal(era.files(2016)[0].name, "OM2024");
  assert.equal(era.pivot, OM_PIVOT);
  for (const c of OM_COLUMNS) assert.ok(requiredColumns(era, era.files(2016)[0]).includes(c), c);
});

test("Explore sorts by 8-year completion", () => {
  assert.equal(parseFilters({ sortBy: "completion_8yr" }).sortBy, "completion_8yr");
});

test("stored 8-year outcomes: wide coverage, shares sum to 1, small cohorts suppressed, Vanderbilt matches OM2024", () => {
  const withRates = schools.filter((s) => s.outcomes?.eight_year?.all.award != null);
  assert.ok(withRates.length > 0.9 * schools.length, `${withRates.length}`);
  for (const s of schools) {
    const o = s.outcomes?.eight_year;
    if (!o) continue;
    for (const g of [o.all, o.first_time, o.transfer_in]) {
      if (!g) continue;
      if (g.cohort < MIN_COHORT) assert.equal(g.award, null, `${s.name}: a cohort of ${g.cohort} must be suppressed`);
      if (isShown(g)) assert.ok(Math.abs(g.award + g.still_enrolled + g.transferred + g.unknown - 1) < 1e-3, s.name);
    }
    for (const g of [o.pell, o.non_pell]) if (g && g.cohort < MIN_COHORT) assert.equal(g.award, null, s.name);
  }
  // Vanderbilt, OM2024 cohort 50: 1,690 of 1,816 earned an award; 85 enrolled elsewhere. Pell: 204 of 233.
  const v = byId("221999").outcomes!.eight_year!;
  assert.equal(v.all.cohort, 1816);
  assert.equal(v.all.award, 0.9306);
  assert.equal(v.all.transferred, 0.0468);
  assert.equal(v.pell!.award, 0.8755);
  assert.equal(meta.vintages["ipeds-om"], `Students entering fall ${v.entering_year}`);
});

test("history: Vanderbilt's series start with the fall 2009 class and end on the snapshot (rule 1)", () => {
  const h: SchoolHistory = JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", "221999.json"), "utf8"));
  const s = byId("221999");
  const o = s.outcomes!.eight_year!;
  assert.equal(h.series.om_award!.start, 2009);
  assert.equal(h.series.om_award!.values.at(-1), o.all.award);
  assert.equal(h.series.om_transfer!.values.at(-1), o.all.transferred);
  assert.equal(h.series.om_award_pell!.values.at(-1), o.pell!.award);
  // The end-point check catches a snapshot that drifts from history.
  const latest = { fall: 2024, academic: 2023 };
  const only = (list: string[]) => list.filter((m) => m.includes(" om_"));
  assert.deepEqual(only(lastPointMismatches([s], new Map([[s.unit_id, h]]), latest)), []);
  const broken = structuredClone(s);
  broken.outcomes!.eight_year!.all.award = 0.5;
  assert.equal(only(lastPointMismatches([broken], new Map([[s.unit_id, h]]), latest)).length, 1);
});
