/**
 * The Plan's intake guide (lib/planner/intake.ts; specs/planner/redesign/intake.md): class-year chips, GPA scale
 * detection and its hints, the score and target checks, step validity, the "When?" term chips and labels, the AP
 * search with its aliases, the draft read from a profile and the profile the save writes (non-AP rows kept, unchanged
 * rows kept as saved), the guardian merge that keeps private exam scores, the server's refusal of bad input, and when
 * the intake shows. Pure. `npm test`.
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
  termLabel,
  termOptions,
  type IntakeDraft,
  type IntakeSave,
} from "../lib/planner/intake.ts";
import { mergeCoursesForSave, withoutExams } from "../lib/chances/courses.ts";
import { isCatalogKeyFor } from "../lib/chances/catalog.ts";
import { emptyProfile, gpaMaxFor, sanitizeProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { CourseEntry } from "../lib/chances/types.ts";

const TODAY = "2026-10-11";

const draft = (over: Partial<IntakeDraft> = {}): IntakeDraft => ({
  classYear: 2027,
  gpa: "3.82",
  scaleOverride: null,
  test: "sat",
  score: "1390",
  practice: false,
  target: "",
  courses: [],
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

test("stepValid: grades need a class and a valid GPA; the test step a choice, a score, and a valid target; review both", () => {
  assert.equal(stepValid(draft(), 0), true);
  assert.equal(stepValid(draft({ classYear: null }), 0), false);
  assert.equal(stepValid(draft({ gpa: "" }), 0), false);
  assert.equal(stepValid(draft(), 1), true);
  assert.equal(stepValid(draft({ test: null }), 1), false);
  assert.equal(stepValid(draft({ test: "none", score: "" }), 1), true);
  assert.equal(stepValid(draft({ score: "" }), 1), false);
  assert.equal(stepValid(draft({ target: "1700" }), 1), false);
  assert.equal(stepValid(draft({ courses: [{ id: "x", key: "ap_biology", status: null, exam: null, term: null }] }), 2), true, "AP courses never block");
  assert.equal(stepValid(draft(), 3), true);
  assert.equal(stepValid(draft({ gpa: "" }), 3), false);
  assert.equal(stepValid(draft(), 4), true);
});

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */

test("termOptions: from this school year until graduation; this year's full year is just 'Full year'", () => {
  assert.deepEqual(termOptions(2027, TODAY), [
    { value: "2026-27:full", label: "Full year" },
    { value: "2026-27:fall", label: "Fall 2026" },
    { value: "2026-27:spring", label: "Spring 2027" },
  ]);
  assert.deepEqual(
    termOptions(2029, TODAY).map((o) => o.label),
    ["Full year", "Fall 2026", "Spring 2027", "Full year 27–28", "Fall 2027", "Spring 2028", "Full year 28–29", "Fall 2028", "Spring 2029"],
  );
  // A class already graduating still gets this year's three.
  assert.equal(termOptions(2026, TODAY).length, 3);
  // Before August, the school year is still last year's.
  assert.equal(termOptions(2027, "2026-06-01")[0].value, "2025-26:full");
});

test("termLabel and courseSummary", () => {
  assert.equal(termLabel("2026-27:full", TODAY), "Full year");
  assert.equal(termLabel("2027-28:full", TODAY), "Full year 27–28");
  assert.equal(termLabel("2026-27:spring", TODAY), "Spring 2027");
  assert.equal(termLabel("2026-28:fall", TODAY), "");
  assert.equal(termLabel("junk", TODAY), "");
  const c = { id: "x", key: "ap_biology" };
  assert.deepEqual(courseSummary({ ...c, status: "took", exam: "4", term: null }, TODAY), { text: "Score 4", incomplete: false });
  assert.deepEqual(courseSummary({ ...c, status: "took", exam: "pending", term: null }, TODAY), { text: "Score pending", incomplete: false });
  assert.deepEqual(courseSummary({ ...c, status: "took", exam: null, term: null }, TODAY), { text: "Choose", incomplete: true });
  assert.deepEqual(courseSummary({ ...c, status: "took", exam: null, term: null }, TODAY, { examsHidden: true }), { text: "Score hidden", incomplete: false });
  assert.deepEqual(courseSummary({ ...c, status: "plan", exam: null, term: "2026-27:spring" }, TODAY), { text: "Spring 2027", incomplete: false });
  assert.deepEqual(courseSummary({ ...c, status: "plan", exam: null, term: null }, TODAY), { text: "Choose", incomplete: true });
  assert.deepEqual(courseSummary({ ...c, status: null, exam: null, term: null }, TODAY), { text: "Choose", incomplete: true });
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
  assert.deepEqual(draftFromProfile(null, 2028, TODAY), { classYear: 2028, gpa: "", scaleOverride: null, test: null, score: "", practice: false, target: "", courses: [] });
  const d = draftFromProfile(sampleProfile(), 2027, TODAY);
  assert.equal(d.classYear, 2027);
  assert.equal(d.gpa, "3.82");
  assert.equal(d.scaleOverride, null);
  assert.equal(d.test, "sat");
  assert.equal(d.score, "1390");
  assert.equal(d.target, "1450");
  assert.deepEqual(d.courses, [
    { id: "lang", key: "ap_english_language", status: "took", exam: "4", term: null },
    { id: "calc", key: "ap_calculus_ab", status: "plan", exam: null, term: "2026-27:full" },
  ]);
  assert.deepEqual(reviewLines(d, TODAY), [
    { step: 0, label: "Class", value: "Class of 2027" },
    { step: 0, label: "GPA", value: "3.82 · 4.0 scale" },
    { step: 1, label: "Test", value: "SAT 1390 · aiming for 1450" },
    { step: 2, label: "AP courses", value: "1 taken · 1 taking or planned" },
  ]);
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

test("applyIntake: maps took / taking / planned onto the course list and the numbers onto the profile", () => {
  const p = sampleProfile();
  const d = draftFromProfile(p, 2027, TODAY);
  d.gpa = "95";
  d.test = "act";
  d.score = "31";
  d.target = "33";
  d.practice = true;
  d.courses = [
    { ...d.courses[0], exam: "5" },
    { id: "bio", key: "ap_biology", status: "took", exam: "pending", term: null },
    { id: "stats", key: "ap_statistics", status: "plan", exam: null, term: "2026-27:spring" },
    { id: "skip", key: "ap_psychology", status: null, exam: null, term: null },
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
  // A new taken course: the most recently finished grade (a senior → 11th), score pending.
  assert.equal(by.bio.status, "taken");
  assert.equal(by.bio.year, 11);
  assert.equal(by.bio.exam, null);
  assert.equal(by.bio.subject, "science");
  // This school year's spring: in progress, 12th grade for the class of 2027.
  assert.equal(by.stats.status, "in_progress");
  assert.equal(by.stats.year, 12);
  assert.equal(by.stats.term, "spring");
  // A course with nothing chosen isn't saved.
  assert.equal(by.skip, undefined);
  // The count follows the list (lang, bio, stats, the IB course, the placeholder); no placeholder is re-added for calc.
  assert.equal(out.academics.courseRigorCount, 5);
  assert.equal(out.academics.courses.length, 6);
});

test("applyIntake: a later school year is planned; years follow the class; a 9th grader's taken course is 9th", () => {
  const p = emptyProfile();
  const save: IntakeSave = {
    classYear: 2029,
    gpa: 3.5,
    gpaScale: "4.0",
    focus: "none",
    score: null,
    practice: false,
    target: null,
    courses: [
      { id: "a", key: "ap_calculus_bc", status: "plan", exam: null, term: "2028-29:full" },
      { id: "b", key: "ap_chemistry", status: "plan", exam: null, term: "2027-28:fall" },
      { id: "c", key: "ap_human_geography", status: "took", exam: "3", term: null },
    ],
  };
  const out = applyIntake(p, save, TODAY);
  const by = Object.fromEntries(out.academics.courses.map((c) => [c.id, c]));
  assert.equal(by.a.status, "planned");
  assert.equal(by.a.year, 12);
  assert.equal(by.a.term, "full");
  assert.equal(by.b.status, "planned");
  assert.equal(by.b.year, 11);
  assert.equal(by.b.term, "fall");
  assert.equal(by.c.year, 9, "a 10th grader's most recently finished grade is 9th");
  const fresh: IntakeSave = { ...save, classYear: 2030, courses: [{ id: "c", key: "ap_human_geography", status: "took", exam: "3", term: null }] };
  assert.equal(applyIntake(p, fresh, TODAY).academics.courses[0].year, 9, "9th for a student in 9th");
  assert.equal(out.tests.focus, "none");
  assert.equal(out.tests.target, null);
});

test("a guardian's save keeps exam scores the student keeps private (mergeCoursesForSave)", () => {
  const p = sampleProfile();
  assert.equal(p.academics.apExamsPrivate, true);
  // The guardian's copy has no exam scores (load.ts strips them), so the draft shows the taken course as pending.
  const guardianView = { ...p, academics: { ...p.academics, courses: withoutExams(p.academics.courses) } };
  const d = draftFromProfile(guardianView, 2027, TODAY);
  assert.equal(d.courses[0].exam, "pending");
  d.courses.push({ id: "bio", key: "ap_biology", status: "took", exam: "5", term: null });
  const next = applyIntake(p, intakeToSave(d)!, TODAY);
  const merged = mergeCoursesForSave(p.academics, next.academics, "guardian");
  const by = Object.fromEntries(merged.courses.map((c) => [c.id, c]));
  assert.equal(by.lang.exam, 4, "the private score survives");
  assert.equal(by.bio.exam, null, "a guardian can't set a score while scores are private");
  assert.equal(merged.apExamsPrivate, true);
});

/* ------------------------------------------------------------------ */
/* Save validation                                                     */
/* ------------------------------------------------------------------ */

const GOOD: IntakeSave = {
  classYear: 2027,
  gpa: 3.82,
  gpaScale: "4.0",
  focus: "sat",
  score: 1390,
  practice: false,
  target: 1450,
  courses: [{ id: "c1", key: "ap_biology", status: "took", exam: "4", term: null }],
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
    { ...GOOD, courses: [{ id: "c1", key: "ib_biology_hl", status: "took", exam: "4", term: null }] },
    { ...GOOD, courses: [{ id: "c1", key: "ap_nope", status: "took", exam: "4", term: null }] },
    { ...GOOD, courses: [{ id: "c1", key: "ap_biology", status: "maybe", exam: null, term: null }] },
    { ...GOOD, courses: [{ id: "c1", key: "ap_biology", status: "took", exam: "6", term: null }] },
    { ...GOOD, courses: [{ id: "c1", key: "ap_biology", status: "plan", exam: null, term: "2026-28:full" }] },
    { ...GOOD, courses: [{ id: "", key: "ap_biology", status: "took", exam: "4", term: null }] },
    { ...GOOD, courses: [GOOD.courses[0], { ...GOOD.courses[0], id: "c2" }] },
    { ...GOOD, courses: [GOOD.courses[0], { ...GOOD.courses[0], key: "ap_chemistry" }] },
  ];
  for (const b of bad) assert.equal(parseIntakeSave(b), null, JSON.stringify(b));
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
