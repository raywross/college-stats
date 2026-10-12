/**
 * The Plan's intake guide (lib/planner/intake.ts; specs/planner/redesign/intake.md): class-year chips, GPA scale
 * detection and its hints, the score and target checks, step validity, the "Which year?" chips and the status they
 * derive, the AP search with its aliases, the draft read from a profile and the profile the save writes (non-AP rows
 * kept, unchanged rows kept as saved), the high-school pick, the guardian merge that keeps a private saved score
 * unless the guardian picks a new one, the server's refusal of bad input, and when the intake shows. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyIntake,
  apName,
  classYearOptions,
  courseSummary,
  detectScale,
  draftFromProfile,
  effectiveScale,
  gpaCheck,
  intakeNeeded,
  intakeToSave,
  parseIntakeSave,
  POPULAR_AP,
  reviewLines,
  scaleLabel,
  scoreCheck,
  searchAp,
  stepValid,
  targetCheck,
  yearOptions,
  yearStatus,
  type IntakeDraft,
  type IntakeSave,
} from "../lib/planner/intake.ts";
import { mergeCoursesForSave } from "../lib/chances/courses.ts";
import { isCatalogKeyFor } from "../lib/chances/catalog.ts";
import { emptyProfile, gpaMaxFor, sanitizeProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { CourseEntry } from "../lib/chances/types.ts";

const TODAY = "2026-10-11";

const draft = (over: Partial<IntakeDraft> = {}): IntakeDraft => ({
  classYear: 2027,
  gpa: "3.82",
  scaleOverride: null,
  weightedGpa: "",
  classStanding: null,
  classRankPercentile: null,
  rankExpectation: null,
  test: "sat",
  score: "1390",
  practice: false,
  target: "",
  highSchool: null,
  highSchoolId: null,
  courses: [],
  activities: [],
  ...over,
});

const course = (over: Partial<CourseEntry>): CourseEntry => ({
  id: "c1",
  kind: "ap",
  key: "ap_biology",
  name: null,
  subject: "science",
  year: 11,
  status: "taken",
  grades: { s1: null, s2: null, final: null },
  exam: null,
  ...over,
});

/* ------------------------------------------------------------------ */
/* Class of                                                            */
/* ------------------------------------------------------------------ */

test("classYearOptions: four years from the current senior class; July on is next year's; a stored outlier is a fifth chip", () => {
  assert.deepEqual(classYearOptions(TODAY, null), [2027, 2028, 2029, 2030]);
  assert.deepEqual(classYearOptions("2026-06-30", null), [2026, 2027, 2028, 2029]);
  assert.deepEqual(classYearOptions("2026-07-01", null), [2027, 2028, 2029, 2030]);
  assert.deepEqual(classYearOptions(TODAY, 2028), [2027, 2028, 2029, 2030]);
  assert.deepEqual(classYearOptions(TODAY, 2031), [2027, 2028, 2029, 2030, 2031]);
  assert.deepEqual(classYearOptions(TODAY, 2026), [2026, 2027, 2028, 2029, 2030]);
});

/* ------------------------------------------------------------------ */
/* GPA                                                                 */
/* ------------------------------------------------------------------ */

test("detectScale: empty or above 10 is 100-point; above 4 to 10 is 5.0 weighted; up to 4 is 4.0", () => {
  assert.equal(detectScale(""), "100");
  assert.equal(detectScale("92.5"), "100");
  assert.equal(detectScale("108"), "100");
  assert.equal(detectScale("10.5"), "100");
  assert.equal(detectScale("4.4"), "5.0");
  assert.equal(detectScale("10"), "5.0");
  assert.equal(detectScale("3.82"), "4.0");
  assert.equal(detectScale("4"), "4.0");
  assert.equal(detectScale("abc"), "100");
  assert.equal(effectiveScale({ gpa: "3.82", scaleOverride: "5.0" }), "5.0");
  assert.equal(effectiveScale({ gpa: "3.82", scaleOverride: null }), "4.0");
  assert.deepEqual(["100", "4.0", "5.0"].map((s) => scaleLabel(s as "100")), ["100-point scale", "4.0 scale", "5.0 weighted"]);
});

test("gpaCheck: hints and captions for empty, detected, overridden, and out-of-range GPAs", () => {
  assert.deepEqual(gpaCheck({ gpa: "", scaleOverride: null }), { ok: false, hint: "Enter it the way your transcript shows it. We'll work out the scale.", tone: "muted", caption: "Default" });
  assert.deepEqual(gpaCheck({ gpa: "3.82", scaleOverride: null }), { ok: true, hint: "Looks like a 4.0 scale. Change it if that's wrong.", tone: "muted", caption: "Detected" });
  assert.deepEqual(gpaCheck({ gpa: "3.82", scaleOverride: "5.0" }), { ok: true, hint: "Using a 5.0 weighted.", tone: "muted", caption: "Scale" });
  assert.equal(gpaCheck({ gpa: "108", scaleOverride: null }).ok, true, "over 100 is fine on a 100-point scale");
  assert.equal(gpaCheck({ gpa: "120", scaleOverride: null }).ok, true);
  const high = gpaCheck({ gpa: "121", scaleOverride: null });
  assert.equal(high.ok, false);
  assert.equal(high.tone, "amber");
  assert.equal(high.hint, "On a 100-point scale, enter a number like 92.5. Over 100 is fine.");
  assert.equal(gpaCheck({ gpa: "30", scaleOverride: null }).ok, false, "100-point starts at 40");
  const four = gpaCheck({ gpa: "4.3", scaleOverride: "4.0" });
  assert.deepEqual(four, { ok: false, hint: "On a 4.0 scale, GPA goes up to 4.0.", tone: "amber", caption: "Scale" });
  assert.equal(gpaCheck({ gpa: "4.3", scaleOverride: null }).ok, true, "4.3 is detected as 5.0 weighted");
  assert.equal(gpaCheck({ gpa: "92", scaleOverride: "5.0" }).ok, false);
});

test("gpaMaxFor: a 100-point GPA may run to 120 everywhere the profile is sanitized", () => {
  assert.equal(gpaMaxFor("100"), 120);
  assert.equal(sanitizeProfile({ academics: { gpa: 108, gpaScale: "100" } }).academics.gpa, 108);
  assert.equal(sanitizeProfile({ academics: { gpa: 121, gpaScale: "100" } }).academics.gpa, null);
});

/* ------------------------------------------------------------------ */
/* Test and target                                                     */
/* ------------------------------------------------------------------ */

test("scoreCheck: whole numbers in the test's range; the range message on a bad score", () => {
  assert.deepEqual(scoreCheck("sat", "1390"), { ok: true, hint: "Your best single sitting." });
  assert.deepEqual(scoreCheck("sat", ""), { ok: false, hint: "Your best single sitting." });
  assert.deepEqual(scoreCheck("sat", "1700"), { ok: false, hint: "SAT scores run from 400 to 1600." });
  assert.deepEqual(scoreCheck("sat", "1390.5"), { ok: false, hint: "SAT scores run from 400 to 1600." });
  assert.deepEqual(scoreCheck("act", "31"), { ok: true, hint: "Your best single sitting." });
  assert.deepEqual(scoreCheck("act", "40"), { ok: false, hint: "ACT scores run from 1 to 36." });
});

test("targetCheck: optional; out of range blocks; at or below the score is allowed with a note", () => {
  assert.deepEqual(targetCheck("sat", "1390", ""), { ok: true, hint: null, tone: "muted" });
  assert.deepEqual(targetCheck("sat", "1390", "1700"), { ok: false, hint: "SAT scores run from 400 to 1600.", tone: "amber" });
  assert.deepEqual(targetCheck("sat", "1390", "1350"), { ok: true, hint: "That's at or below your current score.", tone: "muted" });
  assert.deepEqual(targetCheck("sat", "1390", "1390"), { ok: true, hint: "That's at or below your current score.", tone: "muted" });
  assert.deepEqual(targetCheck("sat", "1390", "1450"), { ok: true, hint: "We'll show which colleges a 1450 would move.", tone: "muted" });
  assert.deepEqual(targetCheck("act", "29", "37"), { ok: false, hint: "ACT scores run from 1 to 36.", tone: "amber" });
});

test("stepValid: grades need a class and a valid GPA; the test step a choice, a score, and a valid target; review both; AP courses and activities never block", () => {
  assert.equal(stepValid(draft(), 0), true);
  assert.equal(stepValid(draft({ classYear: null }), 0), false);
  assert.equal(stepValid(draft({ gpa: "" }), 0), false);
  assert.equal(stepValid(draft(), 1), true);
  assert.equal(stepValid(draft({ test: null }), 1), false);
  assert.equal(stepValid(draft({ test: "none", score: "" }), 1), true);
  assert.equal(stepValid(draft({ score: "" }), 1), false);
  assert.equal(stepValid(draft({ target: "1700" }), 1), false);
  assert.equal(stepValid(draft({ courses: [{ id: "x", key: "ap_biology", year: null, exam: null }] }), 2), true, "AP courses never block");
  assert.equal(stepValid(draft({ gpa: "" }), 3), true, "the optional 'More about you' step never blocks, even with an invalid grades step");
  assert.equal(stepValid(draft(), 4), true);
  assert.equal(stepValid(draft({ gpa: "" }), 4), false);
  assert.equal(stepValid(draft(), 5), true);
});

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */

test("yearOptions and yearStatus: the four chips' school years, and whether each is over, current, or ahead — owner feedback 2026-10-11, class of 2028 on 2026-10-11", () => {
  assert.deepEqual(yearOptions(2028), [
    { year: 9, label: "Freshman", sub: "24–25" },
    { year: 10, label: "Sophomore", sub: "25–26" },
    { year: 11, label: "Junior", sub: "26–27" },
    { year: 12, label: "Senior", sub: "27–28" },
  ]);
  // Without a class year, grade names only.
  assert.deepEqual(
    yearOptions(null).map((o) => o.sub),
    [null, null, null, null],
  );
  assert.equal(yearStatus(9, 2028, TODAY), "taken");
  assert.equal(yearStatus(10, 2028, TODAY), "taken");
  assert.equal(yearStatus(11, 2028, TODAY), "in_progress");
  assert.equal(yearStatus(12, 2028, TODAY), "planned");
});

test("courseSummary: the pill text for a taken, current, future, and unpicked year, and the guardian's hidden-score state", () => {
  // For a class of 2028 on 2026-10-11 (see the test above): Freshman and Sophomore are over, Junior is this year,
  // Senior is still ahead.
  const c = { id: "x", key: "ap_biology" };
  assert.deepEqual(courseSummary({ ...c, year: 10, exam: "4" }, 2028, TODAY), { text: "Sophomore · Score 4", incomplete: false });
  assert.deepEqual(courseSummary({ ...c, year: 9, exam: "pending" }, 2028, TODAY), { text: "Freshman · Score pending", incomplete: false });
  assert.deepEqual(courseSummary({ ...c, year: 12, exam: null }, 2028, TODAY), { text: "Senior year", incomplete: false });
  assert.deepEqual(courseSummary({ ...c, year: 11, exam: null }, 2028, TODAY), { text: "Taking now", incomplete: false });
  assert.deepEqual(courseSummary({ ...c, year: 10, exam: null }, 2028, TODAY), { text: "Choose", incomplete: true });
  assert.deepEqual(courseSummary({ ...c, year: null, exam: null }, 2028, TODAY), { text: "Choose", incomplete: true });
});

/* ------------------------------------------------------------------ */
/* AP search                                                           */
/* ------------------------------------------------------------------ */

test("POPULAR_AP: the design's eight, all AP catalog keys", () => {
  assert.equal(POPULAR_AP.length, 8);
  for (const k of POPULAR_AP) assert.ok(isCatalogKeyFor("ap", k), k);
  assert.deepEqual(POPULAR_AP.map(apName), ["English Language", "US History", "Calculus AB", "Psychology", "Biology", "Statistics", "Human Geography", "Environmental Science"]);
});

test("searchAp: popular with no query (later ones fill in), name and alias matches A–Z, added courses never shown", () => {
  assert.deepEqual(searchAp("", []).map((c) => c.key), [...POPULAR_AP]);
  const fill = searchAp("", ["ap_us_history"]).map((c) => c.key);
  assert.equal(fill.length, 8);
  assert.ok(!fill.includes("ap_us_history"));
  assert.equal(fill[7], "ap_world_history_modern");
  const keys = (q: string, ex: string[] = []) => searchAp(q, ex).map((c) => c.key);
  assert.deepEqual(keys("calc"), ["ap_calculus_ab", "ap_calculus_bc", "ap_precalculus"]);
  assert.deepEqual(keys("calc", ["ap_calculus_ab"]), ["ap_calculus_bc", "ap_precalculus"]);
  assert.deepEqual(keys("apush"), ["ap_us_history"]);
  assert.deepEqual(keys("APUSH"), ["ap_us_history"]);
  assert.ok(keys("lang").includes("ap_english_language"));
  assert.ok(keys("lit").includes("ap_english_literature"));
  assert.ok(keys("csp").includes("ap_computer_science_principles"));
  assert.ok(keys("csa").includes("ap_computer_science_a"));
  assert.deepEqual(keys("euro"), ["ap_european_history"]);
  assert.deepEqual(keys("hug"), ["ap_human_geography"]);
  assert.deepEqual(keys("whap"), ["ap_world_history_modern"]);
  assert.deepEqual(keys("apes"), ["ap_environmental_science"]);
  assert.deepEqual(keys("gov"), ["ap_comparative_government", "ap_us_government"]);
  assert.ok(keys("physics").includes("ap_physics_c_electricity_and_magnetism"));
  assert.ok(keys("physics").includes("ap_physics_1"));
  assert.ok(keys("ap").length <= 10, "at most 10 matches");
  assert.equal(searchAp("ap", [], 3).length, 3);
  assert.deepEqual(searchAp("zzz", []), []);
  assert.deepEqual(searchAp("bio", [])[0], { key: "ap_biology", name: "Biology" });
});

test("apName: the design's short names, else the catalog's without AP", () => {
  assert.equal(apName("ap_calculus_ab"), "Calculus AB");
  assert.equal(apName("ap_us_history"), "US History");
  assert.equal(apName("ap_physics_c_electricity_and_magnetism"), "Physics C: E&M");
  assert.equal(apName("ap_physics_c_mechanics"), "Physics C: Mechanics");
  assert.equal(apName("ap_research"), "Research");
});

/* ------------------------------------------------------------------ */
/* Draft ↔ profile                                                     */
/* ------------------------------------------------------------------ */

function sampleProfile(): StudentProfileData {
  const p = emptyProfile();
  p.basics.gradYear = 2027;
  p.academics.gpa = 3.82;
  p.academics.gpaScale = "4.0";
  p.academics.courses = [
    course({ id: "lang", key: "ap_english_language", subject: "english", year: 11, status: "taken", exam: 4, grades: { s1: "A", s2: "A-", final: "A" } }),
    course({ id: "calc", key: "ap_calculus_ab", subject: "math", year: 12, status: "in_progress", term: "full" }),
    course({ id: "ib", kind: "ib_hl", key: "ib_biology_hl", subject: "science", year: 12, status: "in_progress" }),
    course({ id: "honors", kind: "honors", key: null, name: "Honors Chemistry", subject: "science", year: 10, status: "taken" }),
    course({ id: "placeholder-1", kind: "ap", key: null, name: null, subject: "other", year: 11, status: "taken" }),
  ];
  p.tests.focus = "sat";
  p.tests.satTotal = 1390;
  p.tests.actComposite = 28;
  p.tests.target = 1450;
  return sanitizeProfile(p);
}

test("draftFromProfile: an empty profile opens empty; a saved one opens filled, AP rows only", () => {
  assert.deepEqual(draftFromProfile(null, 2028, TODAY), {
    classYear: 2028,
    gpa: "",
    scaleOverride: null,
    weightedGpa: "",
    classStanding: null,
    classRankPercentile: null,
    rankExpectation: null,
    test: null,
    score: "",
    practice: false,
    target: "",
    highSchool: null,
    highSchoolId: null,
    courses: [],
    activities: [],
  });
  const d = draftFromProfile(sampleProfile(), 2027, TODAY);
  assert.equal(d.classYear, 2027);
  assert.equal(d.gpa, "3.82");
  assert.equal(d.scaleOverride, null);
  assert.equal(d.test, "sat");
  assert.equal(d.score, "1390");
  assert.equal(d.target, "1450");
  assert.equal(d.highSchool, null);
  // The saved year carries over directly; status (taken vs taking/planned) is derived, not stored.
  assert.deepEqual(d.courses, [
    { id: "lang", key: "ap_english_language", year: 11, exam: "4" },
    { id: "calc", key: "ap_calculus_ab", year: 12, exam: null },
  ]);
  assert.deepEqual(reviewLines(d, TODAY), [
    { step: 0, label: "Class", value: "Class of 2027" },
    { step: 0, label: "GPA", value: "3.82 · 4.0 scale" },
    { step: 0, label: "Weighted GPA", value: "Not set" },
    { step: 0, label: "Class standing", value: "Not set" },
    { step: 0, label: "Rank expectation", value: "None" },
    { step: 0, label: "School", value: "Not set" },
    { step: 1, label: "Test", value: "SAT 1390 · aiming for 1450" },
    { step: 2, label: "AP courses", value: "1 taken · 1 taking or planned" },
    { step: 3, label: "Activities", value: "None" },
  ]);
});

test("draftFromProfile and reviewLines: the high school pick round-trips and shows on the Class line", () => {
  const p = sampleProfile();
  p.basics.highSchool = "Lincoln High School";
  p.basics.highSchoolId = "010000500870";
  const d = draftFromProfile(p, 2027, TODAY);
  assert.equal(d.highSchool, "Lincoln High School");
  assert.equal(d.highSchoolId, "010000500870");
  assert.equal(reviewLines(d, TODAY).find((l) => l.label === "School")?.value, "Lincoln High School");
  const saved = intakeToSave(d);
  assert.equal(saved?.highSchool, "Lincoln High School");
  assert.equal(saved?.highSchoolId, "010000500870");
  assert.deepEqual(applyIntake(p, saved!, TODAY).basics, p.basics);
});

test("draftFromProfile: a scale that differs from detection becomes the override; a weighted 4.0 opens on 5.0 weighted", () => {
  const p = emptyProfile();
  p.academics.gpa = 3.9;
  p.academics.gpaScale = "5.0";
  assert.equal(draftFromProfile(p, 2027, TODAY).scaleOverride, "5.0");
  p.academics.gpa = 4.4;
  p.academics.gpaScale = "4.0";
  const w = draftFromProfile(p, 2027, TODAY);
  assert.equal(w.scaleOverride, null);
  assert.equal(effectiveScale(w), "5.0");
  p.academics.gpa = 93;
  p.academics.gpaScale = "100";
  assert.equal(draftFromProfile(p, 2027, TODAY).scaleOverride, null);
  // No focus yet and one score: that test.
  const q = emptyProfile();
  q.tests.actComposite = 30;
  assert.equal(draftFromProfile(q, 2027, TODAY).test, "act");
});

test("round trip: the draft of a saved profile saves back to the same profile (non-AP and unchanged rows kept as saved)", () => {
  const p = sampleProfile();
  const save = intakeToSave(draftFromProfile(p, 2027, TODAY));
  assert.ok(save);
  assert.deepEqual(applyIntake(p, save, TODAY), p);
});

test("round trip: weighted GPA, class standing, and rank expectation save back onto the profile and reopen the same", () => {
  const p = sampleProfile();
  const d = draftFromProfile(p, 2027, TODAY);
  d.weightedGpa = "4.4";
  d.classStanding = "top5";
  d.classRankPercentile = 5;
  d.rankExpectation = "salutatorian";
  const save = intakeToSave(d)!;
  const out = applyIntake(p, save, TODAY);
  assert.equal(out.academics.weightedGpa, 4.4);
  assert.equal(out.academics.classStanding, "top5");
  assert.equal(out.academics.classRankPercentile, 5);
  assert.equal(out.academics.rankExpectation, "salutatorian");
  assert.deepEqual(draftFromProfile(out, 2027, TODAY).weightedGpa, "4.4");
  assert.equal(draftFromProfile(out, 2027, TODAY).classStanding, "top5");
  assert.equal(draftFromProfile(out, 2027, TODAY).rankExpectation, "salutatorian");
});

test("applyIntake: the picked year and score land on the course list; the numbers land on the profile", () => {
  const p = sampleProfile();
  const d = draftFromProfile(p, 2027, TODAY);
  d.gpa = "95";
  d.test = "act";
  d.score = "31";
  d.target = "33";
  d.practice = true;
  d.courses = [
    { ...d.courses[0], exam: "5" },
    { id: "bio", key: "ap_biology", year: 11, exam: "pending" },
    { id: "stats", key: "ap_statistics", year: 12, exam: null },
    { id: "skip", key: "ap_psychology", year: null, exam: null },
  ];
  const s = intakeToSave(d)!;
  assert.equal(s.gpaScale, "100");
  const out = applyIntake(p, s, TODAY);
  assert.equal(out.basics.gradYear, 2027);
  assert.equal(out.academics.gpa, 95);
  assert.equal(out.academics.gpaScale, "100");
  assert.equal(out.tests.focus, "act");
  assert.equal(out.tests.actComposite, 31);
  assert.equal(out.tests.satTotal, 1390, "the other test's score is kept");
  assert.equal(out.tests.target, 33);
  assert.equal(out.tests.practice, true);
  const by = Object.fromEntries(out.academics.courses.map((c) => [c.id, c]));
  // Non-AP rows and the unnamed placeholder are kept untouched.
  assert.deepEqual(by.ib, p.academics.courses.find((c) => c.id === "ib"));
  assert.deepEqual(by.honors, p.academics.courses.find((c) => c.id === "honors"));
  assert.ok(by["placeholder-1"]);
  // A changed exam keeps the row's year and grades.
  assert.equal(by.lang.exam, 5);
  assert.equal(by.lang.year, 11);
  assert.equal(by.lang.grades.final, "A");
  // Calculus was dropped from the list.
  assert.equal(by.calc, undefined);
  // A new taken course (11th, for a senior): score pending.
  assert.equal(by.bio.status, "taken");
  assert.equal(by.bio.year, 11);
  assert.equal(by.bio.exam, null);
  assert.equal(by.bio.subject, "science");
  // 12th grade for the class of 2027 is this school year: in progress.
  assert.equal(by.stats.status, "in_progress");
  assert.equal(by.stats.year, 12);
  assert.equal(by.stats.term, undefined, "sanitizeProfile drops a null term key (CourseEntry.term test)");
  // A course with no year picked isn't saved.
  assert.equal(by.skip, undefined);
  // The count follows the list (lang, bio, stats, the IB course, the placeholder); no placeholder is re-added for calc.
  assert.equal(out.academics.courseRigorCount, 5);
  assert.equal(out.academics.courses.length, 6);
});

test("the 'More about you' step's activities: carried from the profile, sanitized on save, written back, and never block a step", () => {
  const p = sampleProfile();
  p.academics.activities = [{ id: "soccer", name: "Varsity soccer", kind: "sport", years: [10, 11, 12], roles: { 10: "member", 11: "officer", 12: "leader" }, hoursPerWeek: 8, recognition: 3, relatedToMajor: false }];
  const d = draftFromProfile(p, 2027, TODAY);
  assert.deepEqual(d.activities, p.academics.activities);
  // Invalid rows are dropped, not a reason to refuse the step or the whole save (sanitizeActivities' own rule).
  d.activities = [...d.activities, { id: "bad", name: "", kind: "club", years: [], roles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false }];
  const saved = intakeToSave(d)!;
  assert.equal(saved.activities.length, 1, "the unnamed row was dropped");
  assert.deepEqual(parseIntakeSave(saved)?.activities, saved.activities);
  const out = applyIntake(p, saved, TODAY);
  assert.deepEqual(out.academics.activities, p.academics.activities);
});

test("applyIntake: status always derives from the picked year, the class, and today — never stored, never inferred from 'taken'", () => {
  const p = emptyProfile();
  const save: IntakeSave = {
    classYear: 2029,
    gpa: 3.5,
    gpaScale: "4.0",
    weightedGpa: null,
    classStanding: null,
    classRankPercentile: null,
    rankExpectation: null,
    focus: "none",
    score: null,
    practice: false,
    target: null,
    highSchool: null,
    highSchoolId: null,
    courses: [
      { id: "a", key: "ap_calculus_bc", year: 12, exam: null },
      { id: "b", key: "ap_chemistry", year: 11, exam: null },
      { id: "c", key: "ap_human_geography", year: 9, exam: "3" },
    ],
    activities: [],
  };
  const out = applyIntake(p, save, TODAY);
  const by = Object.fromEntries(out.academics.courses.map((c) => [c.id, c]));
  assert.equal(by.a.status, "planned");
  assert.equal(by.a.year, 12);
  assert.equal(by.b.status, "planned");
  assert.equal(by.b.year, 11);
  assert.equal(by.c.status, "taken");
  assert.equal(by.c.year, 9);
  assert.equal(by.c.exam, 3);
  // The same pick (9th) for a class of 2030 is this year, in progress — not "taken" just because it was chosen;
  // the exam a caller sent for it is dropped, since it isn't a taken year.
  const freshman: IntakeSave = { ...save, classYear: 2030, courses: [{ id: "c", key: "ap_human_geography", year: 9, exam: "3" }] };
  const freshOut = applyIntake(p, freshman, TODAY).academics.courses[0];
  assert.equal(freshOut.status, "in_progress");
  assert.equal(freshOut.exam, null);
  assert.equal(out.tests.focus, "none");
  assert.equal(out.tests.target, null);
});

test("mergeCoursesForSave: a guardian sees, keeps, changes, and clears scores like the student (owner, 2026-10-11)", () => {
  const p = sampleProfile();
  assert.equal(p.academics.apExamsPrivate, true);
  // A guardian's draft carries the real saved score, even while apExamsPrivate is on.
  const d = draftFromProfile(p, 2027, TODAY);
  assert.equal(d.courses[0].exam, "4");
  // Saving untouched keeps it.
  const untouched = mergeCoursesForSave(p.academics, applyIntake(p, intakeToSave(d)!, TODAY).academics, "guardian");
  assert.equal(Object.fromEntries(untouched.courses.map((c) => [c.id, c])).lang.exam, 4);
  // The guardian changes it, and adds a scored course of their own.
  d.courses[0] = { ...d.courses[0], exam: "5" };
  d.courses.push({ id: "bio", key: "ap_biology", year: 11, exam: "5" });
  const merged = mergeCoursesForSave(p.academics, applyIntake(p, intakeToSave(d)!, TODAY).academics, "guardian");
  const by = Object.fromEntries(merged.courses.map((c) => [c.id, c]));
  assert.equal(by.lang.exam, 5);
  assert.equal(by.bio.exam, 5);
  // "Not back yet" from a guardian clears it, as it would from the student.
  d.courses[0] = { ...d.courses[0], exam: "pending" };
  const cleared = mergeCoursesForSave(p.academics, applyIntake(p, intakeToSave(d)!, TODAY).academics, "guardian");
  assert.equal(Object.fromEntries(cleared.courses.map((c) => [c.id, c])).lang.exam, null);
  // Only the student sets the household-privacy switch.
  assert.equal(mergeCoursesForSave(p.academics, { ...merged, apExamsPrivate: false }, "guardian").apExamsPrivate, true);
  assert.equal(mergeCoursesForSave(p.academics, { ...merged, apExamsPrivate: false }, "self").apExamsPrivate, false);
});

/* ------------------------------------------------------------------ */
/* Save validation                                                     */
/* ------------------------------------------------------------------ */

const GOOD: IntakeSave = {
  classYear: 2027,
  gpa: 3.82,
  gpaScale: "4.0",
  weightedGpa: null,
  classStanding: null,
  classRankPercentile: null,
  rankExpectation: null,
  focus: "sat",
  score: 1390,
  practice: false,
  target: 1450,
  highSchool: "Lincoln High School",
  highSchoolId: "010000500870",
  courses: [{ id: "c1", key: "ap_biology", year: 11, exam: "4" }],
  activities: [],
};

test("intakeToSave: null while the grades or test step is invalid; testing fields cleared for Not testing", () => {
  assert.equal(intakeToSave(draft({ gpa: "" })), null);
  assert.equal(intakeToSave(draft({ test: null })), null);
  assert.equal(intakeToSave(draft({ classYear: null })), null);
  const none = intakeToSave(draft({ test: "none", score: "1390", target: "1450", practice: true }))!;
  assert.equal(none.score, null);
  assert.equal(none.target, null);
  assert.equal(none.practice, false);
  assert.deepEqual(parseIntakeSave(none), none);
});

test("parseIntakeSave: accepts a good save and refuses anything off", () => {
  assert.deepEqual(parseIntakeSave(GOOD), GOOD);
  assert.deepEqual(parseIntakeSave({ ...GOOD, gpa: 108, gpaScale: "100" })?.gpa, 108);
  const bad: unknown[] = [
    null,
    "x",
    { ...GOOD, classYear: 1999 },
    { ...GOOD, classYear: 2027.5 },
    { ...GOOD, gpaScale: "6.0" },
    { ...GOOD, gpa: 4.3 },
    { ...GOOD, gpa: 121, gpaScale: "100" },
    { ...GOOD, gpa: "3.8" },
    { ...GOOD, focus: "psat" },
    { ...GOOD, score: 1700 },
    { ...GOOD, score: null },
    { ...GOOD, target: 1700 },
    { ...GOOD, focus: "act", score: 31, target: 1450 },
    { ...GOOD, focus: "none", score: 1390, target: null },
    { ...GOOD, focus: "none", score: null, target: 1450 },
    { ...GOOD, practice: "yes" },
    { ...GOOD, courses: "none" },
    { ...GOOD, courses: [{ id: "c1", key: "ib_biology_hl", year: 11, exam: "4" }] },
    { ...GOOD, courses: [{ id: "c1", key: "ap_nope", year: 11, exam: "4" }] },
    { ...GOOD, courses: [{ id: "c1", key: "ap_biology", year: 13, exam: null }] },
    { ...GOOD, courses: [{ id: "c1", key: "ap_biology", year: 11, exam: "6" }] },
    { ...GOOD, courses: [{ id: "", key: "ap_biology", year: 11, exam: "4" }] },
    { ...GOOD, courses: [GOOD.courses[0], { ...GOOD.courses[0], id: "c2" }] },
    { ...GOOD, courses: [GOOD.courses[0], { ...GOOD.courses[0], key: "ap_chemistry" }] },
    { ...GOOD, highSchoolId: "not-an-id" },
    { ...GOOD, highSchoolId: 12345 },
    { ...GOOD, weightedGpa: 121 },
    { ...GOOD, weightedGpa: -1 },
    { ...GOOD, weightedGpa: "4.4" },
    { ...GOOD, classStanding: "top2" },
    { ...GOOD, classRankPercentile: 0 },
    { ...GOOD, classRankPercentile: 101 },
    { ...GOOD, classRankPercentile: 10.5 },
    { ...GOOD, rankExpectation: "president" },
  ];
  for (const b of bad) assert.equal(parseIntakeSave(b), null, JSON.stringify(b));
  // An overlong free-typed name is dropped, not a reason to refuse the whole save (student-profile.ts's own
  // sanitizer treats basics.highSchool the same way). A private high school id (8 upper-case letters/digits) is as
  // good as a public one; a free-typed name with no pick is fine too.
  assert.equal(parseIntakeSave({ ...GOOD, highSchool: "x".repeat(201) })?.highSchool, null);
  assert.equal(parseIntakeSave({ ...GOOD, highSchool: "Not Listed Yet", highSchoolId: null })?.highSchoolId, null);
  assert.equal(parseIntakeSave({ ...GOOD, highSchoolId: "A9106383" })?.highSchoolId, "A9106383");
  assert.equal(parseIntakeSave({ ...GOOD, weightedGpa: 4.4 })?.weightedGpa, 4.4);
  assert.deepEqual(
    parseIntakeSave({ ...GOOD, classStanding: "top5", classRankPercentile: 5, rankExpectation: "salutatorian" }),
    { ...GOOD, classStanding: "top5", classRankPercentile: 5, rankExpectation: "salutatorian" },
  );
});

/* ------------------------------------------------------------------ */
/* Profile fields                                                      */
/* ------------------------------------------------------------------ */

test("tests.target: kept in the focus test's range, null without a focus test or for Not testing", () => {
  assert.equal(sanitizeProfile({ tests: { focus: "sat", target: 1450 } }).tests.target, 1450);
  assert.equal(sanitizeProfile({ tests: { focus: "sat", target: 1700 } }).tests.target, null);
  assert.equal(sanitizeProfile({ tests: { focus: "act", target: 1450 } }).tests.target, null);
  assert.equal(sanitizeProfile({ tests: { focus: "act", target: 33 } }).tests.target, 33);
  assert.equal(sanitizeProfile({ tests: { focus: "none", target: 33 } }).tests.target, null);
  assert.equal(sanitizeProfile({ tests: { target: 33 } }).tests.target, null);
  assert.equal(emptyProfile().tests.target, null);
});

test("CourseEntry.term: kept when it's one of the three, absent otherwise", () => {
  const rows = (term: unknown) => sanitizeProfile({ academics: { courses: [{ ...course({}), term }] } }).academics.courses[0];
  assert.equal(rows("spring").term, "spring");
  assert.equal(rows("winter").term, undefined);
  assert.equal("term" in rows(null), false);
});

/* ------------------------------------------------------------------ */
/* When the intake shows                                               */
/* ------------------------------------------------------------------ */

test("intakeNeeded: no grad year, or neither a GPA nor a test choice; never for a guardian's own list", () => {
  const student = { id: "s", display_name: "Maya", grad_year: 2027, user_id: null };
  const p = emptyProfile();
  assert.equal(intakeNeeded({ student, profile: null }), true);
  assert.equal(intakeNeeded({ student, profile: p }), true);
  assert.equal(intakeNeeded({ student, profile: { ...p, academics: { ...p.academics, gpa: 3.5 } } }), false);
  assert.equal(intakeNeeded({ student, profile: { ...p, tests: { ...p.tests, focus: "none" } } }), false);
  assert.equal(intakeNeeded({ student: { ...student, grad_year: null }, profile: { ...p, academics: { ...p.academics, gpa: 3.5 } } }), true);
  assert.equal(intakeNeeded({ student: null, profile: null }), false);
});
