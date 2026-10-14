/**
 * The season (specs/planner/next-steps/seasons.md "The season"; lib/planner/seasons.ts): every boundary month on both
 * sides for one class year, the season a date falls in, the bounds round-tripping through seasonOfDate, and the
 * planner's older gradeOf() agreeing with seasonOf() for every month of a cycle. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeForSeason, gradeOf, nextSeason, seasonBounds, seasonOf, seasonOfDate, seasonRank, SEASON_LABELS, SEASONS, type Season } from "../lib/planner/seasons.ts";
import { gradeOf as cycleGradeOf } from "../lib/planner/cycle.ts";

// The class of 2028: S = 2027 (senior year starts in August 2027).
const G = 2028;
const s = (d: string) => seasonOf(G, d);

test("seasonOf: both sides of every boundary for the class of 2028", () => {
  const cases: [string, Season][] = [
    ["2024-07-31", "freshman"], // before high school reads as freshman
    ["2024-08-01", "freshman"],
    ["2025-07-31", "freshman"],
    ["2025-08-01", "sophomore"],
    ["2026-07-31", "sophomore"],
    ["2026-08-01", "junior_fall"],
    ["2026-12-31", "junior_fall"],
    ["2027-01-01", "junior_winter"],
    ["2027-02-28", "junior_winter"],
    ["2027-03-01", "junior_spring"],
    ["2027-05-31", "junior_spring"],
    ["2027-06-01", "summer_before_senior"],
    ["2027-07-31", "summer_before_senior"],
    ["2027-08-01", "senior_fall"],
    ["2027-12-31", "senior_fall"],
    ["2028-01-01", "senior_winter"],
    ["2028-02-29", "senior_winter"],
    ["2028-03-01", "senior_spring"],
    ["2028-05-31", "senior_spring"],
    ["2028-06-01", "summer_after"],
    ["2028-07-31", "summer_after"],
    ["2028-08-01", "graduated"],
    ["2031-01-01", "graduated"],
  ];
  for (const [d, want] of cases) assert.equal(s(d), want, d);
  assert.equal(seasonOf(null, "2026-10-01"), "unknown");
  assert.equal(seasonOf(Number.NaN, "2026-10-01"), "unknown");
});

test("seasonOfDate is seasonOf read for a date", () => {
  assert.equal(seasonOfDate("2027-11-01", G), "senior_fall");
  assert.equal(seasonOfDate("2027-04-15", G), "junior_spring");
  assert.equal(seasonOfDate("2026-10-15", G), "junior_fall");
});

test("seasonBounds: each dated season's first and last day round-trip, and the seasons tile the calendar", () => {
  let prevEnd: string | null = null;
  for (const season of SEASONS) {
    const b = seasonBounds(season, G);
    if (season === "graduated" || season === "unknown") {
      assert.equal(b, null, season);
      continue;
    }
    assert.ok(b, season);
    assert.equal(seasonOfDate(b.start, G), season, `${season} start ${b.start}`);
    assert.equal(seasonOfDate(b.end, G), season, `${season} end ${b.end}`);
    if (prevEnd) {
      const next = new Date(`${prevEnd}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      assert.equal(next.toISOString().slice(0, 10), b.start, `${season} starts the day after the last one ends`);
    }
    prevEnd = b.end;
  }
  assert.deepEqual(seasonBounds("junior_winter", 2028), { start: "2027-01-01", end: "2027-02-28" });
  assert.deepEqual(seasonBounds("senior_winter", 2028), { start: "2028-01-01", end: "2028-02-29" }, "a leap year");
  assert.deepEqual(seasonBounds("senior_fall", 2028), { start: "2027-08-01", end: "2027-12-31" });
});

test("nextSeason, seasonRank, labels", () => {
  assert.equal(nextSeason("freshman"), "sophomore");
  assert.equal(nextSeason("junior_spring"), "summer_before_senior");
  assert.equal(nextSeason("summer_after"), "graduated");
  assert.equal(nextSeason("graduated"), null);
  assert.equal(nextSeason("unknown"), null);
  assert.ok(seasonRank("junior_fall") < seasonRank("senior_fall"));
  assert.equal(seasonRank("unknown"), SEASONS.length - 1);
  for (const season of SEASONS) assert.ok(SEASON_LABELS[season].length > 0);
});

test("the gradeOf shim agrees with seasonOf for every month of a class's high-school years, and cycle.ts re-exports it", () => {
  for (let y = 2024; y <= 2029; y++) {
    for (let m = 1; m <= 12; m++) {
      for (const d of ["01", "15", "28"]) {
        const iso = `${y}-${String(m).padStart(2, "0")}-${d}`;
        assert.equal(gradeOf(G, iso), gradeForSeason(seasonOf(G, iso)), iso);
        assert.equal(cycleGradeOf(G, iso), gradeOf(G, iso), iso);
      }
    }
  }
  assert.equal(gradeOf(G, "2025-10-01"), "earlier");
  assert.equal(gradeOf(G, "2027-02-15"), "junior_fall", "junior winter is the older grade's junior fall");
  assert.equal(gradeOf(G, "2027-08-15"), "senior_fall", "senior fall starts in August now");
  assert.equal(gradeOf(null, "2027-08-15"), "unknown");
});
