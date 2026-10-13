/**
 * Revision 3 of the estimate's method (specs/chances/method/standing.md "Revision 3"), the pure parts: the broad depth
 * groups (data/reference/depth-groups.json and its check), the group tracks and themes, "connected to my major"
 * computed rather than asked, the target score and graduation year carried from the profile and validated in a
 * request, and the snapshot recording the state the estimate used. The model's rules are pinned in
 * tests/chances-model.test.mts. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { activityGroups, courseGroups, DEPTH_GROUPS, majorGroups, relatedToMajor, validateDepthGroups, type DepthGroupsFile } from "../lib/chances/depth-groups.ts";
import { courseThemes, courseTracks, groupTrack } from "../lib/chances/depth.ts";
import { estimateInputFromProfile } from "../lib/chances/estimate-input.ts";
import { sanitizeEstimateStudent } from "../lib/chances/estimate-request.ts";
import { buildSnapshot } from "../lib/chances/snapshot.ts";
import { emptyCoreAtTopLevel, emptyProfile } from "../lib/student-profile.ts";
import type { ActivityEntry, CourseEntry, EstimateResult } from "../lib/chances/types.ts";

let n = 0;
const course = (o: Partial<CourseEntry> & Pick<CourseEntry, "subject" | "year">): CourseEntry => ({
  id: `c${++n}`,
  kind: "ap",
  key: null,
  name: null,
  status: "taken",
  grades: { s1: null, s2: null, final: "A" },
  exam: null,
  ...o,
});
const activity = (o: Partial<ActivityEntry> & Pick<ActivityEntry, "years">): ActivityEntry => ({
  id: `a${++n}`,
  name: `Activity ${n}`,
  kind: "club",
  roles: {},
  hoursPerWeek: null,
  recognition: null,
  relatedToMajor: false,
  ...o,
});
const CORE = emptyCoreAtTopLevel();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/* ---- The groups file ---- */

test("depth groups: the reviewed file passes its check, and each kind of mistake is caught", () => {
  assert.deepEqual(validateDepthGroups(DEPTH_GROUPS), []);
  const broken: [string, (f: DepthGroupsFile) => void][] = [
    ["a subject left out", (f) => delete f.course_families.history],
    ["an unknown group", (f) => (f.course_families.math = ["quantitative"])],
    ["a course not in the catalog", (f) => f.courses.push({ key: "ap_underwater_basket_weaving", groups: ["arts"], why: "a made-up course" })],
    ["a course without a reason", (f) => (f.courses[0].why = "")],
    ["an activity family left out", (f) => delete f.activity_families.business],
    ["athletics given a course group", (f) => (f.activity_families.athletics = ["stem"])],
    ["a family with no group that isn't outside", (f) => (f.activity_families.media = [])],
    ["an art club apart from art courses", (f) => (f.activity_families.arts = ["humanities"])],
    ["no sources", (f) => (f.sources = [])],
    ["a fourth group", (f) => f.groups.push({ key: "trades", name: "Trades", words: "the trades" })],
  ];
  for (const [name, breakIt] of broken) {
    const f = clone(DEPTH_GROUPS);
    breakIt(f);
    assert.ok(validateDepthGroups(f).length > 0, name);
  }
});

test("depth groups: courses by subject unless named; activities by family; business in two groups, athletics in none", () => {
  assert.deepEqual(courseGroups({ key: "ap_biology", subject: "science" }), ["stem"]);
  assert.deepEqual(courseGroups({ key: null, subject: "history" }), ["humanities"]);
  assert.deepEqual(courseGroups({ key: "ap_psychology", subject: "history" }).sort(), ["humanities", "stem"]);
  assert.deepEqual(courseGroups({ key: "ap_statistics", subject: "math" }).sort(), ["humanities", "stem"]);
  assert.deepEqual(courseGroups({ key: "ap_macroeconomics", subject: "history" }).sort(), ["humanities", "stem"]);
  assert.deepEqual(courseGroups({ key: "ap_art_history", subject: "arts" }).sort(), ["arts", "humanities"]);
  assert.deepEqual(courseGroups({ key: null, subject: "other" }), []);
  assert.deepEqual(activityGroups("business")?.sort(), ["humanities", "stem"]);
  assert.deepEqual(activityGroups("athletics"), []);
  assert.deepEqual(activityGroups("engineering"), ["stem"]);
  assert.equal(activityGroups(null), null);
  assert.equal(activityGroups("other"), null);
  assert.deepEqual(majorGroups("14"), ["stem"], "engineering expects math and science");
  assert.equal(majorGroups(null), null);
});

test("depth groups: a group's courses read together, by the track rules", () => {
  // One year of science and one of math: each family Light, STEM Steady.
  const two = [course({ subject: "science", year: 10 }), course({ subject: "math", year: 11 })];
  assert.equal(groupTrack("stem", two, CORE).reading, "steady");
  assert.equal(groupTrack("humanities", two, CORE).reading, "light");
  // Rising to AP over three years with a senior-year course: Deep.
  const deep = [course({ kind: "honors", subject: "science", year: 10 }), course({ subject: "math", year: 11 }), course({ subject: "cs", year: 12 })];
  assert.equal(groupTrack("stem", deep, CORE).reading, "deep");
  // The core answers count for the core subjects in the group.
  const core = emptyCoreAtTopLevel();
  core[11].english = true;
  core[12].history = true;
  assert.equal(groupTrack("humanities", [], core).years, 2);
  // A theme needs an activity of two or more years in the group.
  const t = courseThemes({ courses: two, coreAtTopLevel: CORE, activities: [activity({ years: [11, 12], catalogKey: "deca" })] });
  assert.deepEqual(t.themes, ["stem"]);
  assert.deepEqual(courseThemes({ courses: two, coreAtTopLevel: CORE, activities: [activity({ years: [12], catalogKey: "deca" })] }).themes, []);
  assert.deepEqual(courseThemes({ courses: two, coreAtTopLevel: CORE, activities: [activity({ years: [10, 11], family: "athletics" })] }).themes, []);
});

/* ---- Rule 6: connected to the major, computed ---- */

test("rule 6: connected to the major is computed (the stored checkbox is ignored)", () => {
  assert.equal(relatedToMajor("arts", []), true, "no intended major: assumed related");
  assert.equal(relatedToMajor(null, ["14"]), true, "an activity whose group isn't known: assumed related");
  assert.equal(relatedToMajor("science", ["14"]), true);
  assert.equal(relatedToMajor("business", ["14"]), true, "business is in STEM too");
  assert.equal(relatedToMajor("arts", ["14"]), false, "the arts clearly differ from engineering");
  assert.equal(relatedToMajor("athletics", ["14"]), false, "a sport sits outside every course group");
  // Through the course track: a three-year research activity adds a year to the engineering major's science track
  // with the checkbox unticked; an arts one doesn't, with it ticked.
  const courses = [course({ subject: "science", year: 11, key: "ap_chemistry" }), course({ subject: "science", year: 12, key: "ap_biology" })];
  const science = (a: ActivityEntry[]) => courseTracks({ courses, coreAtTopLevel: CORE, offering: null, majors: ["14"], activities: a }).families.find((f) => f.family === "science")!.years;
  assert.equal(science([]), 2);
  assert.equal(science([activity({ kind: "research", years: [10, 11, 12], relatedToMajor: false })]), 3, "unticked but connected");
  assert.equal(science([activity({ kind: "research", years: [10, 11, 12], relatedToMajor: true, family: "arts" })]), 2, "ticked but clearly another group");
  assert.equal(science([activity({ kind: "club", years: [10, 11, 12], family: "science" })]), 3, "a science club");
  assert.equal(science([activity({ kind: "club", years: [10, 11, 12], family: "athletics" })]), 2);
});

/* ---- Rule 3: the target and graduation year, from the profile and a request ---- */

test("rule 3: the profile's target on the focus test and graduation year reach the estimate's student; a request validates them", () => {
  const p = emptyProfile();
  p.tests.focus = "act";
  p.tests.actComposite = 29;
  p.tests.target = 34;
  p.basics.gradYear = 2028;
  const s = estimateInputFromProfile(p, "221999", null).student;
  assert.deepEqual(s.testTarget, { kind: "act", score: 34 });
  assert.equal(s.gradYear, 2028);
  assert.deepEqual(s.test, { kind: "act", score: 29 }, "the actual score stays the student's test; the model decides");
  p.tests.focus = "none";
  assert.equal(estimateInputFromProfile(p, "221999", null).student.testTarget, null);
  assert.equal(estimateInputFromProfile(null, "221999", null).student.testTarget, null);

  assert.deepEqual(sanitizeEstimateStudent({ testTarget: { kind: "sat", score: 1450 }, gradYear: 2028 }).testTarget, { kind: "sat", score: 1450 });
  assert.equal(sanitizeEstimateStudent({ testTarget: { kind: "act", score: 40 } }).testTarget, null, "out of the test's range");
  assert.equal(sanitizeEstimateStudent({ testTarget: { kind: "psat", score: 1200 } }).testTarget, null);
  assert.equal(sanitizeEstimateStudent({ testTarget: 34 }).testTarget, null);
  assert.equal(sanitizeEstimateStudent({ gradYear: 2028 }).gradYear, 2028);
  assert.equal(sanitizeEstimateStudent({ gradYear: "2028" }).gradYear, null);
  assert.equal(sanitizeEstimateStudent({ gradYear: 3000 }).gradYear, null);
});

/* ---- Rule 7: the snapshot records the state used ---- */

test("rule 7: a snapshot records the state the estimate used when the student entered none", () => {
  const p = emptyProfile();
  const input = estimateInputFromProfile(p, "221999", "rd");
  const result = { unitId: "221999", group: "reach", label: "elite", used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, closeness: null, ed: null, modelVersion: "x" } as EstimateResult;
  const row = (stateUsed: string | null, state: string | null = null) =>
    buildSnapshot({ input: { ...input, student: { ...input.student, state } }, estimate: { result, detail: { stateUsed } }, offering: null, admitRate: null, studentGroup: null }).state;
  assert.equal(row("NY"), "NY");
  assert.equal(row(null), null);
  assert.equal(row("NY", "TN"), "TN", "the student's own state wins");
  assert.equal(row("New York"), null, "only a USPS code");
});
