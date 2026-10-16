/**
 * The Choose next year's APs guide's own view of the course list (lib/planner/courses-guide.ts; specs/planner/v3/
 * guides/ap-choices.md "What you've taken"): rows per subject family and year, the major's families first, the
 * next-year slot by class year and today, `nextYearCourses`, `kindMark`, and that nothing the row builder returns
 * ever carries an AP exam score (a guardian's redaction: the shape itself has no `exam` field). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { courseRows, kindMark, nextYearCourses } from "../lib/planner/courses-guide.ts";
import { newCourse } from "../lib/chances/courses.ts";
import type { CourseEntry } from "../lib/chances/types.ts";

const TODAY = "2027-03-01"; // junior spring for a class of 2028

function course(o: Partial<CourseEntry>): CourseEntry {
  return {
    id: o.id ?? `c${Math.random()}`,
    kind: o.kind ?? "ap",
    key: o.key ?? null,
    name: o.name ?? null,
    subject: o.subject ?? "science",
    year: o.year ?? 11,
    status: o.status ?? "in_progress",
    grades: o.grades ?? { s1: null, s2: null, final: null },
    exam: o.exam ?? null,
  };
}

test("courseRows: one row per subject the student has courses in, each cell only the years with a course", () => {
  const courses: CourseEntry[] = [
    course({ id: "bio", key: null, name: "Biology", kind: "honors", subject: "science", year: 9, status: "taken" }),
    course({ id: "chem", key: null, name: "Chemistry", kind: "honors", subject: "science", year: 10, status: "taken" }),
    course({ id: "apchem", key: "ap_chemistry", subject: "science", year: 11, status: "in_progress" }),
    course({ id: "alg2", key: null, name: "Algebra II", kind: "honors", subject: "math", year: 10, status: "taken" }),
  ];
  const rows = courseRows(courses, 2028, TODAY);
  const science = rows.find((r) => r.family === "science")!;
  assert.equal(science.label, "Science");
  assert.deepEqual(science.cells.map((c) => c.year), [9, 10, 11]);
  assert.equal(science.cells[2].courses[0].name, "AP Chemistry");
  assert.equal(science.cells[2].courses[0].status, "in_progress");
  const math = rows.find((r) => r.family === "math")!;
  assert.deepEqual(math.cells.map((c) => c.year), [10]);
  // No row for a family with no course.
  assert.equal(rows.some((r) => r.family === "arts"), false);
});

test("courseRows: the major's families come first, then depth's order", () => {
  const courses: CourseEntry[] = [
    course({ id: "e", key: null, name: "English 10", kind: "regular", subject: "english", year: 10, status: "taken" }),
    course({ id: "m", key: null, name: "Precalculus", kind: "honors", subject: "math", year: 11, status: "in_progress" }),
    course({ id: "s", key: null, name: "Chemistry", kind: "honors", subject: "science", year: 10, status: "taken" }),
  ];
  // Without a major: depth's own order (english, math, science, history, language, cs, arts) filtered to what's present.
  const plain = courseRows(courses, 2028, TODAY);
  assert.deepEqual(plain.map((r) => r.family), ["english", "math", "science"]);
  // Engineering's families (math, science) come first when given, even though depth would put math after English.
  const withMajor = courseRows(courses, 2028, TODAY, ["math", "science"]);
  assert.deepEqual(withMajor.map((r) => r.family), ["math", "science", "english"]);
});

test("courseRows: status is worked out fresh from the year and today, not read off the saved row", () => {
  // A row saved as "planned" whose year has since arrived reads "in_progress" today, exactly as the intake's own
  // `yearStatus` would say (intake.md "AP courses": status never drifts from what was actually picked).
  const stale = course({ id: "c1", key: "ap_calculus_ab", subject: "math", year: 11, status: "planned" });
  const rows = courseRows([stale], 2028, TODAY);
  const math = rows.find((r) => r.family === "math")!;
  assert.equal(math.cells[0].courses[0].status, "in_progress");
});

test("courseRows: the next-year slot follows the class year and today — none for a senior", () => {
  const courses: CourseEntry[] = [course({ id: "c1", key: null, name: "Biology", kind: "honors", subject: "science", year: 9, status: "taken" })];
  assert.equal(courseRows(courses, 2028, TODAY)[0].nextYear, 12, "a junior (class of 2028) on 2027-03-01 gets a senior-year slot");
  assert.equal(courseRows(courses, 2027, TODAY)[0].nextYear, null, "a senior gets no next-year slot");
  assert.equal(courseRows(courses, null, TODAY)[0].nextYear, null, "no class year, no slot");
});

test("kindMark: the mark printed after a course's name", () => {
  assert.equal(kindMark("honors"), "(H)");
  assert.equal(kindMark("ap"), "AP");
  assert.equal(kindMark("ib_hl"), "IB");
  assert.equal(kindMark("ib_sl"), "IB");
  assert.equal(kindMark("dual"), "DE");
  assert.equal(kindMark("regular"), "");
});

test("nextYearCourses: only the courses on the list for that year; empty without one", () => {
  const courses: CourseEntry[] = [
    course({ id: "c1", key: "ap_chemistry", year: 11, status: "in_progress" }),
    course({ id: "c2", key: "ap_calculus_ab", year: 12, status: "planned" }),
    course({ id: "c3", key: "ap_biology", year: 12, status: "planned" }),
  ];
  assert.deepEqual(
    nextYearCourses(courses, 12).map((c) => c.id),
    ["c2", "c3"],
  );
  assert.deepEqual(nextYearCourses(courses, null), []);
});

test("adding a suggested or searched course writes a planned row for the right year (the builder the guide saves through saveCourses)", () => {
  // The suggestion path: grade is the student's current grade (CoursePlanView.grade), year is the suggestion's year.
  const suggested = newCourse({ kind: "ap", key: "ap_physics_1", grade: 11, year: 12 });
  assert.equal(suggested.year, 12);
  assert.equal(suggested.status, "planned");
  assert.equal(suggested.key, "ap_physics_1");

  // The search box path (CoursesGuide.tsx AddAnythingElse): grade is nextYear - 1, never null (null would read
  // "taken" from newCourse's defaultStatus, which is wrong for a course being added for next year).
  const nextYear = 12 as const;
  const searched = newCourse({ kind: "ap", key: "ap_statistics", grade: nextYear - 1, year: nextYear });
  assert.equal(searched.year, 12);
  assert.equal(searched.status, "planned");
});

test("a guardian's redaction: the row shape the guide renders never carries an AP exam score", () => {
  const withScore = course({ id: "c1", key: "ap_chemistry", subject: "science", year: 11, status: "taken", exam: 5 });
  const rows = courseRows([withScore], 2028, TODAY);
  const found = rows.find((r) => r.family === "science")!.cells[0].courses[0];
  assert.deepEqual(Object.keys(found).sort(), ["id", "kind", "name", "status"]);
  assert.equal("exam" in found, false);
});
