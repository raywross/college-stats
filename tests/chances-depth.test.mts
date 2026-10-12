/**
 * Depth (specs/chances/depth.md "Course tracks", "Activities"): every reading on fixtures, the top-two rule (a long
 * list of one-year entries neither helps nor hurts), trajectory, the major-track slot, recognition as the best of
 * activities and awards, a related-research activity adding a track year, the not-offered family, and that nothing
 * meant for a snapshot carries an activity's or course's name. Pure module, no server-only import. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { activitiesReading, courseTracks, depthSnapshot, DEPTH_FAMILIES, TRACK_LEVEL } from "../lib/chances/depth.ts";
import { noteText } from "../lib/chances/notes.ts";
import { emptyCoreAtTopLevel } from "../lib/student-profile.ts";
import type { CoreAtTopLevel } from "../lib/student-profile.ts";
import type { ActivityEntry, AwardEntry, CourseEntry, SchoolOffering } from "../lib/chances/types.ts";

/* ---- Fixtures ---- */

let idc = 0;
function course(over: Partial<CourseEntry> & Pick<CourseEntry, "kind" | "subject" | "year">): CourseEntry {
  idc += 1;
  return {
    id: `c${idc}`,
    key: null,
    name: null,
    status: "taken",
    grades: { s1: null, s2: null, final: null },
    exam: null,
    ...over,
  };
}

let ida = 0;
function activity(over: Partial<ActivityEntry> & Pick<ActivityEntry, "years">): ActivityEntry {
  ida += 1;
  return {
    id: `a${ida}`,
    name: `Activity ${ida}`,
    kind: "club",
    roles: {},
    hoursPerWeek: null,
    recognition: null,
    relatedToMajor: false,
    ...over,
  };
}

function award(over: Partial<AwardEntry> & Pick<AwardEntry, "tier">): AwardEntry {
  return { id: "w1", key: null, name: "Award", year: null, ...over };
}

const NO_OFFERING: SchoolOffering = { apCount: null, apKeys: null, ib: null, dual: null, source: null, field: null };
const CORE_NONE: CoreAtTopLevel = emptyCoreAtTopLevel();

const ENGINEERING = ["14"]; // math through calculus; physics and chemistry (data/reference/major-course-expectations.json)

/* ---- Course tracks ---- */

test("courseTracks: Deep — rising to AP, senior year, 3+ years, major family", () => {
  const courses: CourseEntry[] = [
    course({ kind: "honors", subject: "math", year: 9, name: "Algebra II" }),
    course({ kind: "honors", subject: "math", year: 10, name: "Precalculus" }),
    course({ kind: "ap", subject: "math", year: 11, key: "ap_calculus_ab" }),
    course({ kind: "ap", subject: "math", year: 12, key: "ap_calculus_bc", status: "planned" }),
  ];
  const offering: SchoolOffering = { ...NO_OFFERING, apKeys: ["ap_calculus_ab", "ap_calculus_bc", "ap_physics_1"], apCount: 3 };
  const result = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering, majors: ENGINEERING, activities: [] });
  const math = result.families.find((f) => f.family === "math")!;
  assert.equal(math.reading, "deep");
  assert.equal(math.years, 4);
  assert.equal(math.rising, true);
  assert.equal(math.senior, true);
  assert.equal(math.expected, true);
  assert.match(noteText(math.note), /a deep track for your major/);
  assert.match(noteText(math.note), /AP Calculus BC \(planned\)/);
});

test("courseTracks: Steady — two years, no senior course, names the major's expected top course", () => {
  const courses: CourseEntry[] = [
    course({ kind: "honors", subject: "math", year: 10, name: "Algebra II" }),
    course({ kind: "honors", subject: "math", year: 11, name: "Precalculus" }),
  ];
  const result = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [] });
  const math = result.families.find((f) => f.family === "math")!;
  assert.equal(math.reading, "steady");
  assert.equal(math.years, 2);
  assert.equal(math.senior, false);
  const text = noteText(math.note);
  assert.match(text, /a steady track/);
  assert.match(text, /Most engineering programs expect AP Calculus AB senior year/);
});

test("courseTracks: Light — one year, outside the major's expected families", () => {
  const courses: CourseEntry[] = [course({ kind: "ap", subject: "history", year: 11, key: "ap_us_history" })];
  const result = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [] });
  const history = result.families.find((f) => f.family === "history")!;
  assert.equal(history.reading, "light");
  assert.equal(history.years, 1);
  assert.equal(history.expected, false);
  assert.match(noteText(history.note), /isn't among the subjects your major usually expects/);
});

test("courseTracks: Light in an expected family names the expectation, not the generic sentence", () => {
  const courses: CourseEntry[] = [course({ kind: "ap", subject: "science", year: 10, key: "ap_biology" })];
  const result = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [] });
  const science = result.families.find((f) => f.family === "science")!;
  assert.equal(science.reading, "light");
  assert.equal(science.expected, true);
  assert.match(noteText(science.note), /physics and chemistry/);
  assert.doesNotMatch(noteText(science.note), /isn't among the subjects your major usually expects/);
});

test("courseTracks: not offered — the school's AP list has none in the subject and the student has none either", () => {
  const offering: SchoolOffering = { ...NO_OFFERING, apKeys: ["ap_calculus_ab"], apCount: 1, ib: false, dual: false };
  const result = courseTracks({ courses: [], coreAtTopLevel: CORE_NONE, offering, majors: ENGINEERING, activities: [] });
  const cs = result.families.find((f) => f.family === "cs");
  // "cs" isn't one of engineering's expected families and the student has no cs courses, so it isn't in the list at all...
  assert.equal(cs, undefined);
  // ...but add a cs-major student with no cs offered to see the reading itself.
  const result2 = courseTracks({ courses: [], coreAtTopLevel: CORE_NONE, offering, majors: ["11"], activities: [] });
  const cs2 = result2.families.find((f) => f.family === "cs")!;
  assert.equal(cs2.reading, "not_offered");
  assert.equal(noteText(cs2.note), "Your school offers no advanced courses in Computer science, so none is expected.");
});

test("courseTracks: coreAtTopLevel adds 11th/12th-grade years without an advanced course on the list", () => {
  const core: CoreAtTopLevel = { 11: { english: false, math: false, science: false, history: false, language: false }, 12: { english: false, math: false, science: false, history: false, language: false } };
  core[11].english = true;
  core[12].english = true;
  const courses: CourseEntry[] = [course({ kind: "honors", subject: "english", year: 9, name: "English I" })];
  const result = courseTracks({ courses, coreAtTopLevel: core, offering: NO_OFFERING, majors: [], activities: [] });
  const english = result.families.find((f) => f.family === "english")!;
  assert.equal(english.years, 3); // 9 (honors) + 11 + 12 (core at top level)
});

test("courseTracks: majorDeep and lightExpected", () => {
  const deepMath: CourseEntry[] = [
    course({ kind: "ap", subject: "math", year: 10, key: "ap_calculus_ab" }),
    course({ kind: "ap", subject: "math", year: 11, key: "ap_calculus_ab" }),
    course({ kind: "ap", subject: "math", year: 12, key: "ap_calculus_bc" }),
  ];
  const lightScience: CourseEntry[] = [course({ kind: "ap", subject: "science", year: 10, key: "ap_biology" })];
  const result = courseTracks({ courses: [...deepMath, ...lightScience], coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [] });
  assert.equal(result.majorDeep, false); // science is Light, so not every expected family is Deep
  assert.deepEqual(result.lightExpected, ["science"]);

  const deepScience: CourseEntry[] = [
    course({ kind: "ap", subject: "science", year: 10, key: "ap_chemistry" }),
    course({ kind: "ap", subject: "science", year: 11, key: "ap_chemistry" }),
    course({ kind: "ap", subject: "science", year: 12, key: "ap_biology" }),
  ];
  const allDeep = courseTracks({ courses: [...deepMath, ...deepScience], coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [] });
  assert.equal(allDeep.majorDeep, true);
  assert.deepEqual(allDeep.lightExpected, []);
});

test("courseTracks: a related-research activity with 3+ years adds a track year to the major's science family", () => {
  const courses: CourseEntry[] = [course({ kind: "ap", subject: "science", year: 11, key: "ap_chemistry" }), course({ kind: "ap", subject: "science", year: 12, key: "ap_biology" })];
  const research = activity({ name: "Science Olympiad", kind: "research", years: [10, 11, 12], relatedToMajor: true, roles: { 10: "member", 11: "member", 12: "leader" } });
  const withoutActivity = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [] });
  const withActivity = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [research] });
  const scienceBefore = withoutActivity.families.find((f) => f.family === "science")!;
  const scienceAfter = withActivity.families.find((f) => f.family === "science")!;
  assert.equal(scienceBefore.years, 2);
  assert.equal(scienceAfter.years, 3); // the activity's year 10 is new
  assert.match(noteText(scienceAfter.note), /plus 3 years of Science Olympiad/);
  // Under 3 years, or not relatedToMajor, adds nothing.
  const short = activity({ name: "Science Fair", kind: "research", years: [11, 12], relatedToMajor: true });
  const withShort = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [short] });
  assert.equal(withShort.families.find((f) => f.family === "science")!.years, 2);
});

test("courseTracks: an AP exam score of 4 or 5 confirms the grade in its sentence", () => {
  const courses: CourseEntry[] = [course({ kind: "ap", subject: "math", year: 10, key: "ap_calculus_ab", exam: 5, grades: { s1: null, s2: null, final: "A" } })];
  const result = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: [], activities: [] });
  const math = result.families.find((f) => f.family === "math")!;
  assert.match(noteText(math.note), /scored a 4 or 5, confirming the grade/);
});

test("courseTracks: DEPTH_FAMILIES excludes 'other', and TRACK_LEVEL matches the spec's constant", () => {
  assert.equal(DEPTH_FAMILIES.includes("other" as never), false);
  assert.equal(TRACK_LEVEL.regular, 0);
  assert.equal(TRACK_LEVEL.honors, 1);
  assert.equal(TRACK_LEVEL.ib_sl, 1.5);
  assert.equal(TRACK_LEVEL.ap, 2);
  assert.equal(TRACK_LEVEL.ib_hl, 2);
  assert.equal(TRACK_LEVEL.dual, 2);
});

/* ---- Activities ---- */

test("activitiesReading: Focused — two 3+-year activities, one with a leader role", () => {
  const soccer = activity({ name: "Soccer", kind: "sport", years: [9, 10, 11, 12], roles: { 9: "member", 10: "member", 11: "officer", 12: "leader" } });
  const robotics = activity({ name: "Robotics", kind: "club", years: [10, 11, 12], roles: { 10: "member", 11: "member", 12: "officer" } });
  const r = activitiesReading([soccer, robotics], []);
  assert.equal(r.reading, "focused");
  assert.deepEqual(r.topTwo.map((a) => a.name), ["Soccer", "Robotics"]);
  assert.match(noteText(r.notes[0]), /Soccer, 4 years, leader this year; Robotics, 3 years, officer this year/);
  assert.match(noteText(r.notes[0]), /Two things carried through high school/);
});

test("activitiesReading: Building — one 3+-year activity", () => {
  const robotics = activity({ name: "Robotics", kind: "club", years: [10, 11, 12], roles: { 12: "officer" } });
  const oneYear = activity({ name: "Yearbook", kind: "club", years: [11] });
  const r = activitiesReading([robotics, oneYear], []);
  assert.equal(r.reading, "building");
  assert.match(noteText(r.notes[0]), /Robotics, 3 years, officer this year/);
  assert.match(noteText(r.notes[0]), /One activity carried through/);
});

test("activitiesReading: Building — two 2-year activities with a rising role (trajectory) in one", () => {
  const debate = activity({ name: "Debate", kind: "club", years: [11, 12], roles: { 11: "member", 12: "officer" } });
  const art = activity({ name: "Art club", kind: "club", years: [11, 12] });
  const r = activitiesReading([debate, art], []);
  assert.equal(r.reading, "building");
  assert.equal(r.trajectory, true);
});

test("activitiesReading: trajectory is false for a flat or falling role", () => {
  const flat = activity({ name: "Chess", kind: "club", years: [10, 11], roles: { 10: "member", 11: "member" } });
  const falling = activity({ name: "Band", kind: "club", years: [10, 11], roles: { 10: "leader", 11: "member" } });
  assert.equal(activitiesReading([flat], []).trajectory, false);
  assert.equal(activitiesReading([falling], []).trajectory, false);
});

test("activitiesReading: Sampling — a long list of one-year entries neither helps nor hurts", () => {
  const many = Array.from({ length: 8 }, (_, i) => activity({ name: `Club ${i}`, kind: "club", years: [11] }));
  const r = activitiesReading(many, []);
  assert.equal(r.reading, "sampling");
  assert.equal(r.topTwo.length, 2);
  assert.match(noteText(r.notes[0]), /^8 activities, each for a year or two\./);
  // A ninth one-year entry still reads Sampling: it neither helps nor hurts.
  const more = [...many, activity({ name: "Club 9", kind: "club", years: [11] })];
  assert.equal(activitiesReading(more, []).reading, "sampling");
});

test("activitiesReading: top-two rule — the rest are reported, not scored", () => {
  const top = activity({ name: "Top", kind: "sport", years: [9, 10, 11, 12], roles: { 12: "leader" } });
  const second = activity({ name: "Second", kind: "club", years: [10, 11, 12], roles: { 12: "officer" } });
  const rest = Array.from({ length: 5 }, (_, i) => activity({ name: `Extra ${i}`, kind: "club", years: [11] }));
  const withExtras = activitiesReading([top, second, ...rest], []);
  const withoutExtras = activitiesReading([top, second], []);
  assert.deepEqual(withExtras.topTwo.map((a) => a.name), ["Top", "Second"]);
  assert.equal(withExtras.reading, withoutExtras.reading);
});

test("activitiesReading: recognition is the best (lowest) tier across activities and awards", () => {
  const a = activity({ name: "Orchestra", kind: "arts", years: [10, 11], recognition: 2 });
  const noRecognitionActivity = activity({ name: "Club", kind: "club", years: [9] });
  const nationalAward = award({ name: "National essay prize", tier: 1 });
  const r1 = activitiesReading([a, noRecognitionActivity], []);
  assert.equal(r1.recognition, 2);
  assert.match(noteText(r1.notes.find((n) => n.key === "depth.activities.recognition")!), /Orchestra \(state-level recognition\)/);
  const r2 = activitiesReading([a, noRecognitionActivity], [nationalAward]);
  assert.equal(r2.recognition, 1); // the award's tier 1 beats the activity's tier 2
});

test("activitiesReading: work and family hours and workInTopTwo", () => {
  const job = activity({ name: "Job", kind: "work", years: [11, 12], hoursPerWeek: 15 });
  const family = activity({ name: "Caring for siblings", kind: "family", years: [10, 11, 12], hoursPerWeek: 20 });
  const club = activity({ name: "Club", kind: "club", years: [9, 10, 11, 12], roles: { 12: "leader" } });
  const r = activitiesReading([job, family, club], []);
  assert.equal(r.workHours, 20);
  assert.equal(r.workInTopTwo, true); // family (20h, 3 years) outranks the one-role-bump job

  const r2 = activitiesReading([job], []);
  assert.equal(r2.workHours, 15);
});

test("activitiesReading: no activities entered reads null, not a reading", () => {
  const r = activitiesReading([], []);
  assert.equal(r.reading, null);
  assert.equal(r.topTwo.length, 0);
  assert.equal(noteText(r.notes[0]), "Add your activities to see how colleges that rate them would read your record.");
});

/* ---- Snapshots never carry a name ---- */

test("depthSnapshot: readings binned as words and counts, never a course or activity name", () => {
  const courses: CourseEntry[] = [
    course({ kind: "ap", subject: "math", year: 10, key: "ap_calculus_ab" }),
    course({ kind: "ap", subject: "math", year: 11, key: "ap_calculus_ab" }),
    course({ kind: "ap", subject: "math", year: 12, key: "ap_calculus_bc" }),
  ];
  const tracks = courseTracks({ courses, coreAtTopLevel: CORE_NONE, offering: NO_OFFERING, majors: ENGINEERING, activities: [] });
  const soccer = activity({ name: "Varsity Soccer Team", kind: "sport", years: [9, 10, 11, 12] });
  const robotics = activity({ name: "FIRST Robotics Club", kind: "club", years: [10, 11, 12] });
  const activitiesResult = activitiesReading([soccer, robotics], []);
  const snap = depthSnapshot(tracks, [soccer, robotics], activitiesResult);

  const text = JSON.stringify(snap);
  assert.doesNotMatch(text, /Soccer/);
  assert.doesNotMatch(text, /Robotics/);
  assert.doesNotMatch(text, /Varsity/);
  assert.equal(snap.courseReadings.math, "deep");
  assert.equal(snap.majorDeep, false); // science isn't tracked at all here, so not every expected family reads Deep
  assert.equal(snap.activitiesReading, "building");
  assert.equal(snap.activitiesCount, 2);
  assert.deepEqual(snap.topTwoYears, [4, 3]);
});
