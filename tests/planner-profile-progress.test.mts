/**
 * The people line's progress ring (lib/planner/profile-progress.ts; owner, 2026-10-12): a plain count of the
 * student's own profile sections and the one most useful next step, never a score or a percentage. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import { firstMissingSection, LATER_SECTIONS, PROFILE_SECTIONS, SECTION_MOVE_TITLE, SECTION_STEP, profileProgress, sectionDone } from "../lib/planner/profile-progress.ts";
import { redactStoryForGuardian } from "../lib/student-profile.ts";
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
  p.academics.activitiesNone.connections = true;
  p.tests.focus = "sat";
  p.tests.satTotal = 1400;
  p.plans.intendedMajors = ["14"];
  p.preferences.sizes = ["medium"];
  p.story = { narrative: "x".repeat(250), updatedAt: "2026-10-01" };
  p.recommenders = [{ id: "r1", name: "Ms. Ruiz", subject: "English", courseId: null, years: [11], rank: 1, status: "thinking", askedOn: null, agreedOn: null, invitedOn: null }];
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

test("the next step follows the record's order (review note 6): high school, grades, test, courses, the activities, connections, major, basics, where, then story and recommenders from the summer before senior year", () => {
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
    connections: (q) => (q.academics.activitiesNone = { ...q.academics.activitiesNone, connections: true }),
    other: (q) => (q.academics.awards = [{ key: "x" } as never]),
    basics: (q) => (q.basics.stateOfResidence = "OH"),
    where: (q) => (q.preferences.settings = ["suburb"]),
    story: (q) => (q.story = { narrative: "y".repeat(220), updatedAt: null }),
    recommenders: (q) => (q.recommenders = full().recommenders),
  };
  for (let i = 0; i < PROFILE_SECTIONS.length; i++) {
    const r = profileProgress(p, { season: "summer_before_senior" });
    assert.equal(r.done, i);
    order.push(r.next!);
    fills[r.next!](p);
  }
  assert.deepEqual(order, ["high_school", "grades", "test", "courses", "sports", "clubs", "work", "connections", "other", "major", "basics", "where", "story", "recommenders"]);
  assert.equal(profileProgress(p).nextLabel, null);
  assert.equal(PROFILE_SECTIONS.length, 14);
});

test("story and recommenders: never `next` before the summer before senior year (or without a season), still counted in done/total", () => {
  const p = full();
  p.story = null;
  p.recommenders = [];
  for (const season of [undefined, "junior_spring", "freshman", "unknown"] as const) {
    const r = profileProgress(p, { season });
    assert.equal(r.next, null, String(season));
    assert.equal(r.done, r.total - 2);
  }
  assert.equal(profileProgress(p, { season: "summer_before_senior" }).next, "story");
  assert.equal(profileProgress(p, { season: "senior_fall" }).nextLabel, "write your story");
  p.story = full().story;
  assert.equal(profileProgress(p, { season: "senior_fall" }).nextLabel, "add your recommenders");
});

test("firstMissingSection (the profile move's title) never names story or recommenders", () => {
  const p = full();
  p.story = null;
  p.recommenders = [];
  assert.equal(firstMissingSection(p), null);
  p.preferences.sizes = [];
  assert.equal(firstMissingSection(p), "where");
  assert.equal(SECTION_MOVE_TITLE.where, "Add where you'd go");
  assert.equal(SECTION_MOVE_TITLE.major, "Add a major");
  assert.equal(SECTION_MOVE_TITLE.basics, "Add a few basics");
  assert.deepEqual(LATER_SECTIONS, ["story", "recommenders"]);
  assert.equal(firstMissingSection(null), "high_school");
});

test("the new sections (review note 6): major, basics, where, story, recommenders", () => {
  const p = emptyProfile();
  for (const s of ["major", "basics", "where", "story", "recommenders"] as const) assert.equal(sectionDone(p, s), false, s);
  // Basics: the state, or either yes/no answered (a "no" counts).
  p.basics.feeWaiverEligible = false;
  assert.equal(sectionDone(p, "basics"), true);
  const q = emptyProfile();
  q.academics.firstGeneration = true;
  assert.equal(sectionDone(q, "basics"), true);
  // Where: any preference, the cost limit included.
  q.preferences.maxAverageCost = 30000;
  assert.equal(sectionDone(q, "where"), true);
  // Story: 200 characters for the student's copy; a guardian's redacted copy counts once it exists.
  q.story = { narrative: "short", updatedAt: null };
  assert.equal(sectionDone(q, "story"), false);
  q.story = { narrative: "z".repeat(200), updatedAt: null };
  assert.equal(sectionDone(q, "story"), true);
  assert.equal(sectionDone({ ...q, story: redactStoryForGuardian(q.story) }, "story"), true);
  assert.equal(sectionDone({ ...q, story: null }, "story"), false);
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

test("every section opens a step of the record's tour (0–12; no Numbers page any more)", () => {
  for (const s of PROFILE_SECTIONS) assert.ok(typeof SECTION_STEP[s] === "number" && SECTION_STEP[s] >= 0 && SECTION_STEP[s] <= 12, s);
  assert.equal(SECTION_STEP.major, 8);
  assert.equal(SECTION_STEP.basics, 9);
  assert.equal(SECTION_STEP.where, 10);
  assert.equal(SECTION_STEP.story, 11);
  assert.equal(SECTION_STEP.recommenders, 12);
  assert.equal(SECTION_STEP.clubs, 4);
  assert.equal(SECTION_STEP.connections, 6);
  assert.equal(SECTION_STEP.other, 7);
});

test("connections: an entry or a None answer counts; neither doesn't", () => {
  const p = emptyProfile();
  assert.equal(sectionDone(p, "connections"), false);
  p.academics.connections = [{ id: "c1", unitId: "100654", family: ["parent"], recruited: "none" }];
  assert.equal(sectionDone(p, "connections"), true);
  const q = emptyProfile();
  q.academics.activitiesNone.connections = true;
  assert.equal(sectionDone(q, "connections"), true);
});

test("the ring never shows a percentage or anything from the estimate", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "components", "planner", "PlanPeople.tsx"), "utf8");
  assert.doesNotMatch(src, /%\s*[`"<]|percent|completeness|lib\/chances\/(model|estimate|snapshot)/i);
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, "..", "lib", "planner", "profile-progress.ts"), "utf8"), /from "\.\.\/chances\/(model|estimate|snapshot)/);
});
