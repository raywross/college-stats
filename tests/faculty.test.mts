/**
 * Faculty salary and full-time share (specs/data-expansion/faculty.md): the SAL all-ranks reader, the Scorecard
 * full-time-share reader, the Explore filter, and the stored values and history. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { MIN_FULL_TIME_FACULTY_OPTIONS, facultySalaryFrom, fullTimeFacultyShareFrom, withinMinFullTimeFaculty } from "../lib/academics.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import type { SchoolHistory } from "../lib/history.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

test("SAEQ9AT only reads the ARANK 7 (all ranks combined) row; other ranks, blanks, and zero are unreported", () => {
  assert.equal(facultySalaryFrom({ ARANK: "7", SAEQ9AT: "148484" }), 148484);
  assert.equal(facultySalaryFrom({ ARANK: "1", SAEQ9AT: "221801" }), null, "a single rank, not all ranks combined");
  for (const v of ["0", "-1", "-2", "", "."]) assert.equal(facultySalaryFrom({ ARANK: "7", SAEQ9AT: v }), null, `"${v}"`);
  assert.equal(facultySalaryFrom({}), null);
  assert.equal(facultySalaryFrom(undefined), null);
});

test("ft_faculty_rate is kept only as a share between 0 and 1", () => {
  assert.equal(fullTimeFacultyShareFrom(0.8473), 0.8473);
  assert.equal(fullTimeFacultyShareFrom(0), 0);
  assert.equal(fullTimeFacultyShareFrom(1), 1);
  assert.equal(fullTimeFacultyShareFrom(1.2), null);
  assert.equal(fullTimeFacultyShareFrom(-0.1), null);
  assert.equal(fullTimeFacultyShareFrom(null), null);
  assert.equal(fullTimeFacultyShareFrom(undefined), null);
  assert.equal(fullTimeFacultyShareFrom("0.8"), null, "Scorecard rows send numbers, not strings");
});

test("the full-time-faculty filter parses from a percent in the URL and keeps reported shares at or above the floor", () => {
  assert.equal(parseFilters({ minFullTimeFaculty: "70" }).minFullTimeFaculty, 0.7);
  assert.equal(parseFilters({ minFullTimeFaculty: "0" }).minFullTimeFaculty, undefined);
  assert.equal(parseFilters({ minFullTimeFaculty: "abc" }).minFullTimeFaculty, undefined);
  assert.equal(countActiveFilters({ minFullTimeFaculty: "70" }), 1);
  assert.ok(withinMinFullTimeFaculty({ academics: { faculty: { full_time_share: 0.7 } } }, 0.7));
  assert.ok(!withinMinFullTimeFaculty({ academics: { faculty: { full_time_share: 0.69 } } }, 0.7));
  assert.ok(!withinMinFullTimeFaculty({ academics: { faculty: { full_time_share: null } } }, 0.7), "unreported never matches");
  assert.ok(!withinMinFullTimeFaculty({}, 0.7));
  // Each chip narrows the list (a higher floor matches fewer colleges), and the lowest still matches someone.
  const counts = MIN_FULL_TIME_FACULTY_OPTIONS.map((n) => schools.filter((s) => withinMinFullTimeFaculty(s, n)).length);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  assert.ok(counts[counts.length - 1] > 0);
});

test("stored salary and full-time share cover most colleges, and Vanderbilt matches its known fall 2024 values", () => {
  const withSalary = schools.filter((s) => s.academics?.faculty?.avg_salary_9mo != null);
  const withShare = schools.filter((s) => s.academics?.faculty?.full_time_share != null);
  assert.ok(withSalary.length > 0.9 * schools.length, `${withSalary.length} of ${schools.length}`);
  assert.ok(withShare.length > 0.9 * schools.length, `${withShare.length} of ${schools.length}`);
  for (const s of withSalary) assert.ok(s.academics!.faculty!.avg_salary_9mo! > 0, s.name);
  for (const s of withShare) assert.ok(s.academics!.faculty!.full_time_share! >= 0 && s.academics!.faculty!.full_time_share! <= 1, s.name);

  const vandy = byId("221999");
  assert.equal(vandy.academics?.faculty?.avg_salary_9mo, 148484, "Vanderbilt SAL2024 all ranks (ARANK 7)");
  assert.equal(vandy.academics?.faculty?.full_time_share, 0.8473, "Vanderbilt Scorecard ft_faculty_rate");
  assert.equal(meta.vintages["ipeds-sal"], "Fall 2024");

  const h: SchoolHistory = JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", "221999.json"), "utf8"));
  const salary = h.series.faculty_salary!;
  assert.equal(salary.start, 2016, "SAL2016_IS is the first file with the equated 9-month column");
  assert.equal(salary.values.at(-1), 148484);
  const share = h.series.faculty_full_time_share!;
  assert.equal(share.values.at(-1), 0.8473);
});

test("Scorecard's monthly faculty_salary is never mixed into the SAL-sourced equated figure", () => {
  // Vanderbilt: Scorecard AVGFACSAL (monthly, ~$16,361 x 9 ~= $147,249) is close to but not SAL's $148,484.
  const vandy = byId("221999");
  assert.notEqual(vandy.academics?.faculty?.avg_salary_9mo, 147_249);
  assert.equal(meta.sources["ipeds-sal"]?.label.includes("SAL"), true);
});
