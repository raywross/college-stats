/**
 * lib/student-profile-form.ts: turning the /me form's FormData into sanitizeProfile()'s raw shape. Pure module, no
 * database or server needed. `npm test`.
 *
 * The groups this proves don't get wiped (household-hub.md "Household cleanup (2026-10-12)", "Trim to only the
 * things we don't have in planner"): grades and GPA, graduation year, tests, courses, activities, and awards moved
 * off this form into the planner's intake, so their inputs are never in the posted FormData at all (not merely
 * blank). A save of the fields that remain (state, high school, fee waiver, first generation, majors, early-round
 * interest, preferences) must leave the removed ones exactly as they were saved, not reset them to empty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProfile, sanitizeProfile, type StudentProfileData } from "../lib/student-profile.ts";
import { coursesFor, profileFromForm } from "../lib/student-profile-form.ts";

/** A FormData built from only the fields actually posted — absent means absent, not blank (form.has() matters). */
function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** A fully filled-in saved profile, as if the planner's intake (and this form, before the trim) had set everything. */
function fullProfile(): StudentProfileData {
  const p = emptyProfile();
  p.basics = { gradYear: 2028, stateOfResidence: "TN", highSchool: "Franklin High", highSchoolId: null, feeWaiverEligible: true };
  p.academics = {
    ...p.academics,
    gpa: 3.8,
    gpaScale: "4.0",
    weightedGpa: 4.2,
    classRankPercentile: 10,
    classStanding: "top10",
    rankExpectation: "salutatorian",
    courses: [],
    activities: [{ id: "a1", name: "Debate", kind: "club", years: [11], roles: { 11: "officer" }, catalogKey: null, family: null, titles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false }],
    awards: [{ id: "w1", key: null, name: "National Merit", tier: 1, year: 12 }],
    firstGeneration: true,
  };
  p.tests = {
    ...p.tests,
    satTotal: 1480,
    satReading: 740,
    satMath: 740,
    superscore: true,
    plansTestOptional: false,
    focus: "sat",
    practice: true,
    target: 1520,
    plannedDates: ["sat_2026_12"],
  };
  p.plans = { intendedMajors: ["11"], earlyRoundInterest: "ed" };
  p.preferences = { sizes: ["small"], settings: ["suburb"], types: ["public"], statesOrRegions: ["TN"], maxAverageCost: 30000 };
  return p;
}

/** The trimmed form's own post: only the fields it still has inputs for (student-profile-form.test.mts). */
const TRIMMED_POST = {
  student_id: "s1",
  stateOfResidence: "CA",
  highSchool: "New School",
  feeWaiverEligible: "no",
  firstGeneration: "no",
  intendedMajors: "14",
  earlyRoundInterest: "ea",
  sizes: "large",
};

test("a save with only the trimmed fields keeps every removed field exactly as saved", () => {
  const kept = fullProfile();
  const out = sanitizeProfile(profileFromForm(form(TRIMMED_POST), kept, coursesFor(form(TRIMMED_POST), kept, "self")));

  // The fields still on the form changed, as posted.
  assert.equal(out.basics.stateOfResidence, "CA");
  assert.equal(out.basics.highSchool, "New School");
  assert.equal(out.basics.feeWaiverEligible, false);
  assert.equal(out.academics.firstGeneration, false);
  assert.deepEqual(out.plans.intendedMajors, ["14"]);
  assert.equal(out.plans.earlyRoundInterest, "ea");
  assert.deepEqual(out.preferences.sizes, ["large"]);

  // Everything the planner's intake now owns is untouched, not reset.
  assert.equal(out.basics.gradYear, 2028);
  assert.equal(out.academics.gpa, 3.8);
  assert.equal(out.academics.gpaScale, "4.0");
  assert.equal(out.academics.weightedGpa, 4.2);
  assert.equal(out.academics.classRankPercentile, 10);
  assert.equal(out.academics.classStanding, "top10");
  assert.equal(out.academics.rankExpectation, "salutatorian");
  assert.deepEqual(out.academics.activities.map((a) => a.name), ["Debate"]);
  assert.deepEqual(out.academics.awards.map((a) => a.name), ["National Merit"]);
  assert.equal(out.tests.satTotal, 1480);
  assert.equal(out.tests.satReading, 740);
  assert.equal(out.tests.satMath, 740);
  assert.equal(out.tests.superscore, true);
  assert.equal(out.tests.focus, "sat");
  assert.equal(out.tests.practice, true);
  assert.equal(out.tests.target, 1520);
  assert.deepEqual(out.tests.plannedDates, ["sat_2026_12"]);
});

test("a profile never saved before has nothing to keep: the removed fields read as the ordinary empty defaults", () => {
  const out = sanitizeProfile(profileFromForm(form(TRIMMED_POST), null, coursesFor(form(TRIMMED_POST), null, null)));
  assert.equal(out.basics.gradYear, null);
  assert.equal(out.academics.gpa, null);
  assert.equal(out.academics.classStanding, null);
  assert.deepEqual(out.academics.activities, []);
  assert.deepEqual(out.academics.awards, []);
  assert.equal(out.tests.satTotal, null);
  assert.equal(out.tests.focus, null);
  assert.deepEqual(out.tests.plannedDates, []);
  // The fields the trimmed form does carry still save normally.
  assert.equal(out.basics.stateOfResidence, "CA");
});

test("guard: without the fallback, a field missing from the form reads as the empty default and wipes a save", () => {
  // numField (not numFieldOr) reads a missing field exactly like a blank one: null, regardless of what's saved.
  function numFieldLikeBefore(f: FormData, name: string): number | null {
    const v = f.get(name);
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  assert.equal(numFieldLikeBefore(form(TRIMMED_POST), "gpa"), null, "a form without a gpa field has nothing to read");
  // profileFromForm must not do this for gpa: the real behavior differs from the guard's naive reimplementation.
  const out = sanitizeProfile(profileFromForm(form(TRIMMED_POST), fullProfile(), {}));
  assert.notEqual(out.academics.gpa, null);
});

test("activities/awards posted as malformed JSON still fall back to the saved list, not []", () => {
  const kept = fullProfile();
  const bad = form({ ...TRIMMED_POST });
  bad.set("activities", "{not json");
  const out = sanitizeProfile(profileFromForm(bad, kept, {}));
  assert.deepEqual(out.academics.activities.map((a) => a.name), ["Debate"]);
});

test("coursesFor still keeps the saved courses when the form carries none (unchanged by the trim)", () => {
  const kept = fullProfile();
  kept.academics.courses = [
    { id: "c1", subject: "math", kind: "ap", key: "ap_calculus_bc", name: null, year: 11, status: "taken", exam: 5, grades: { s1: null, s2: null, final: "A" }, term: null },
  ];
  const posted = coursesFor(form(TRIMMED_POST), kept, "self");
  assert.equal((posted.courses as unknown[]).length, 1);
});
