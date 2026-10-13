/**
 * The people line's progress ring (lib/planner/profile-progress.ts; owner, 2026-10-12): a plain count of the
 * student's own profile sections and the one most useful next step, never a score or a percentage. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import { PROFILE_SECTIONS, SECTION_STEP, profileProgress, sectionDone } from "../lib/planner/profile-progress.ts";
import type { ActivityEntry } from "../lib/chances/types.ts";

const act = (kind: ActivityEntry["kind"], name: string): ActivityEntry =>
  ({ id: name, kind, name, years: [10], roles: { 10: "member" }, hoursPerWeek: null, recognition: null, relatedToMajor: false }) as unknown as ActivityEntry;

function full(): StudentProfileData {
  const p = emptyProfile();
  p.basics.highSchool = "Central High";
  p.basics.stateOfResidence = "IN";
  p.academics.gpa = 3.8;
  p.academics.classStanding = "top10";
  p.academics.courses = [{ id: "c1" } as never];
  p.academics.activities = [act("sport", "Soccer"), act("club", "Robotics"), act("work", "Grocery"), act("service", "Food bank")];
  p.tests.focus = "sat";
  p.tests.satTotal = 1400;
  p.plans.intendedMajors = ["engineering" as never];
  return p;
}

test("an empty profile has nothing in and starts with the high school", () => {
  const r = profileProgress(emptyProfile());
  assert.deepEqual(r, { done: 0, total: PROFILE_SECTIONS.length, next: "high_school", nextLabel: "add a high school" });
  assert.equal(profileProgress(null).done, 0);
});

test("a full profile is complete: no next step", () => {
  const r = profileProgress(full());
  assert.equal(r.done, r.total);
  assert.equal(r.next, null);
  assert.equal(r.nextLabel, null);
});

test("the next step follows the owner's order: high school, courses, class standing, test, clubs, sports, major, work, other, state", () => {
  const order: string[] = [];
  const p = emptyProfile();
  // Fill each section in turn and record what the next step was before it.
  const fills: Record<string, (p: StudentProfileData) => void> = {
    high_school: (q) => (q.basics.highSchool = "Central High"),
    courses: (q) => (q.academics.courses = [{ id: "c1" } as never]),
    grades: (q) => {
      q.academics.gpa = 3.5;
      q.academics.classStanding = "no_rank";
    },
    test: (q) => (q.tests.focus = "none"),
    clubs: (q) => (q.academics.activities = [...q.academics.activities, act("club", "Chess")]),
    sports: (q) => (q.academics.activities = [...q.academics.activities, act("sport", "Track")]),
    major: (q) => (q.plans.intendedMajors = ["business" as never]),
    work: (q) => (q.academics.activities = [...q.academics.activities, act("work", "Job")]),
    other: (q) => (q.academics.awards = [{ key: "x" } as never]),
    state: (q) => (q.basics.stateOfResidence = "OH"),
  };
  for (let i = 0; i < PROFILE_SECTIONS.length; i++) {
    const r = profileProgress(p);
    assert.equal(r.done, i);
    order.push(r.next!);
    fills[r.next!](p);
  }
  assert.deepEqual(order, ["high_school", "courses", "grades", "test", "clubs", "sports", "major", "work", "other", "state"]);
  assert.equal(profileProgress(p).nextLabel, null);
});

test("grades: a GPA without class standing asks for class standing; any standing answer or expectation counts", () => {
  const p = full();
  p.academics.classStanding = null;
  p.academics.classRankPercentile = null;
  assert.equal(sectionDone(p, "grades"), false);
  assert.equal(profileProgress(p).nextLabel, "add class standing");
  p.academics.rankExpectation = "valedictorian";
  assert.equal(sectionDone(p, "grades"), true);
  p.academics.rankExpectation = null;
  p.academics.gpa = null;
  p.academics.classStanding = "top5";
  assert.equal(profileProgress(p).nextLabel, "add grades");
});

test("test: a score, a target, or 'not testing' each count", () => {
  const p = emptyProfile();
  assert.equal(sectionDone(p, "test"), false);
  p.tests.target = 1300;
  assert.equal(sectionDone(p, "test"), true);
  const q = emptyProfile();
  q.tests.actComposite = 28;
  assert.equal(sectionDone(q, "test"), true);
});

test("every section opens somewhere: an intake step, or the Numbers page for major and state", () => {
  for (const s of PROFILE_SECTIONS) assert.ok(SECTION_STEP[s] === "numbers" || (typeof SECTION_STEP[s] === "number" && SECTION_STEP[s] >= 0 && SECTION_STEP[s] <= 6), s);
  assert.equal(SECTION_STEP.major, "numbers");
  assert.equal(SECTION_STEP.clubs, 4);
});

test("the ring never shows a percentage or anything from the estimate", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "components", "planner", "PlanPeople.tsx"), "utf8");
  assert.doesNotMatch(src, /%\s*[`"<]|percent|completeness|lib\/chances\/(model|estimate|snapshot)/i);
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, "..", "lib", "planner", "profile-progress.ts"), "utf8"), /from "\.\.\/chances\/(model|estimate|snapshot)/);
});
