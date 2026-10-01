/**
 * Student-to-faculty ratio (specs/data-expansion/student-faculty-ratio.md): the EF part D reader, the Explore filter,
 * and the stored values and history. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { MAX_RATIO_OPTIONS, studentFacultyRatioFrom, withinMaxRatio } from "../lib/academics.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import type { SchoolHistory } from "../lib/history.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

test("STUFACR is a whole number of students per faculty member; 0, negatives, and blanks are unreported", () => {
  assert.equal(studentFacultyRatioFrom({ STUFACR: "8" }), 8);
  assert.equal(studentFacultyRatioFrom({ STUFACR: "12.6" }), 13);
  for (const v of ["0", "-1", "-2", "", "."]) assert.equal(studentFacultyRatioFrom({ STUFACR: v }), null, `"${v}"`);
  assert.equal(studentFacultyRatioFrom({}), null, "no column (before EF2009D)");
  assert.equal(studentFacultyRatioFrom(undefined), null);
});

test("the max-ratio filter parses from the URL and keeps reported ratios at or under the cap", () => {
  assert.equal(parseFilters({ maxRatio: "10" }).maxRatio, 10);
  assert.equal(parseFilters({ maxRatio: "0" }).maxRatio, undefined);
  assert.equal(parseFilters({ maxRatio: "abc" }).maxRatio, undefined);
  assert.equal(countActiveFilters({ maxRatio: "10" }), 1);
  assert.ok(withinMaxRatio({ academics: { student_faculty_ratio: 10 } }, 10));
  assert.ok(!withinMaxRatio({ academics: { student_faculty_ratio: 11 } }, 10));
  assert.ok(!withinMaxRatio({ academics: { student_faculty_ratio: null } }, 10), "unreported is not small");
  assert.ok(!withinMaxRatio({}, 10));
  // Each chip narrows the list, and every chip matches someone.
  const counts = MAX_RATIO_OPTIONS.map((n) => schools.filter((s) => withinMaxRatio(s, n)).length);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
  assert.ok(counts[0] > 0);
});

test("stored ratios cover nearly every college and match history's last point", () => {
  const reported = schools.filter((s) => s.academics?.student_faculty_ratio != null);
  assert.ok(reported.length > 0.95 * schools.length);
  for (const s of reported) assert.ok(Number.isInteger(s.academics!.student_faculty_ratio) && s.academics!.student_faculty_ratio! > 0, s.name);
  assert.equal(byId("221999").academics!.student_faculty_ratio, 8, "Vanderbilt fall 2024 (its CDS I-2 agrees)");
  assert.equal(meta.vintages["ipeds-ef"], "Fall 2024");
  const h: SchoolHistory = JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", "221999.json"), "utf8"));
  const s = h.series.student_faculty_ratio!;
  assert.equal(s.start, 2009, "EF2009D is the first file with STUFACR");
  assert.equal(s.values.at(-1), 8);
});
