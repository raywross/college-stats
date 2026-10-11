/**
 * The course plan (specs/chances/course-plan.md): each reason (a unit's required course or gate, the list's C8
 * recommendation, the school's top level in a core subject, the intended major) in the spec's order; every guardrail
 * (weak advanced grades suppress everything, the yearly cap, at most two, already as demanding as allowed, seniors,
 * nothing outside the school's list, the 9th and 10th grade path); prerequisites and usual grade levels; the
 * "what it changes" line with and without a group move and when the endpoint is absent; the cycle-file entries (course
 * requests, AP ordering/exams/scores) and the "send AP scores for credit" task; the editorial major expectations; the
 * proprietary rule (no client code reaches the rules, no sentence names one). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, relative, resolve } from "node:path";

// course-plan-rules.ts, course-plan.ts, and rigor-rules.ts start with `import "server-only"`, which only Next.js
// resolves; stand in an empty module (as tests/chances-rigor.test.mts does).
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});

const { coursePlan, eligibleCourses, pathFor } = await import("../lib/chances/course-plan.ts");
const { COURSE_PLAN_RULES, gradeCheck } = await import("../lib/chances/course-plan-rules.ts");
const { inRegistrationWindow, nextYearOf, planSeason } = await import("../lib/chances/course-plan-view.ts");
const { groupChangeLine, whatItChanges, endpointFetch } = await import("../lib/chances/course-plan-estimate.ts");
const { NOTES, noteText } = await import("../lib/chances/notes.ts");
const { catalogCourse } = await import("../lib/chances/catalog.ts");
const { majorUnitFor } = await import("../lib/chances/major-admission.ts");
const { MAJOR_EXPECTATIONS, expectationsFor, validateExpectations } = await import("../lib/chances/major-course-expectations.ts");
const { emptyCoreAtTopLevel, emptyProfile, sanitizeCoursePlan, sanitizeProfile, sanitizeSchoolOffers } = await import("../lib/student-profile.ts");
const { applies, loadCycle, validateCycleFile } = await import("../lib/planner/cycle.ts");
const { generate: offersGen } = await import("../lib/planner/generators/offers.ts");
const { schoolOffering } = await import("../lib/chances/offering.ts");
const cycleFile = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "application-cycle.json"), "utf8"));

import type { CourseEntry, EstimateResult } from "../lib/chances/types.ts";
import type { PlanCollege, PlanInput } from "../lib/chances/course-plan.ts";
import type { GeneratorInput, PlanItem, PlanSchool } from "../lib/planner/types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let n = 0;
function ap(key: string, over: Partial<CourseEntry> = {}): CourseEntry {
  n += 1;
  const c = catalogCourse(key)!;
  return { id: `c${n}`, kind: "ap", key, name: null, subject: c.subject, year: 11, status: "taken", grades: { s1: null, s2: null, final: "A" }, exam: null, ...over };
}
function plain(subject: CourseEntry["subject"], year: CourseEntry["year"], over: Partial<CourseEntry> = {}): CourseEntry {
  n += 1;
  return { id: `c${n}`, kind: "regular", key: null, name: "Course", subject, year, status: "taken", grades: { s1: null, s2: null, final: "A" }, exam: null, ...over };
}
const offers = (...keys: string[]) => schoolOffering({ school: null, detail: { ap_courses: keys.map((k) => catalogCourse(k)!.name), ib_courses: [] } });
const college = (id: string, name: string, over: Partial<PlanCollege> = {}): PlanCollege => ({ unitId: id, name, dream: false, recommended: {}, unit: null, ...over });

function input(over: Partial<PlanInput> & { courses?: CourseEntry[]; grade?: number | null; majors?: string[]; satMath?: number | null } = {}): PlanInput {
  return {
    student: { courses: over.courses ?? [], coreAtTopLevel: emptyCoreAtTopLevel(), grade: over.grade === undefined ? 11 : over.grade, majors: over.majors ?? [], satMath: over.satMath ?? null, actMath: null },
    offering: over.offering ?? offers("ap_calculus_ab"),
    linked: true,
    colleges: over.colleges ?? [],
    reading: over.reading ?? null,
    dismissed: over.dismissed,
  };
}
const text = (s: { note: { key: string; values: Record<string, string | number> } }) => noteText(s.note);

/* ------------------------------------------------------------------ */
/* The reasons                                                         */
/* ------------------------------------------------------------------ */

test("reason 1: a unit's required course comes first, with the college's own words in the sentence", () => {
  const unit = majorUnitFor("190415", "14");
  assert.ok(unit?.review?.required_courses.length, "Cornell Engineering requires courses in the curated data");
  const plan = coursePlan(input({ majors: ["14"], courses: [ap("ap_calculus_ab", { year: 11 })], offering: offers("ap_physics_1", "ap_chemistry", "ap_calculus_bc"), colleges: [college("190415", "Cornell University", { unit })] }));
  assert.equal(plan.kind, "suggestions");
  assert.equal(plan.suggestions[0].reason, "required");
  assert.equal(plan.suggestions[0].key, "ap_physics_1");
  assert.equal(text(plan.suggestions[0]), `Cornell Duffield College of Engineering requires physics. ${catalogCourse("ap_physics_1")!.name} is offered at your school and fits next year.`);
  assert.deepEqual(plan.suggestions[0].units, ["190415"]);
});

test("reason 1: a score gate a course's exam can give (UT Austin Engineering) names the course, unless a route is already met", () => {
  const unit = majorUnitFor("228778", "14");
  assert.ok(unit?.review?.gate);
  const base = { majors: ["14"], courses: [plain("math", 11)], offering: offers("ap_calculus_ab", "ap_calculus_bc"), colleges: [college("228778", "UT Austin", { unit })] };
  const open = coursePlan(input(base));
  const first = open.suggestions[0];
  assert.equal(first.reason, "required");
  assert.match(text(first), /^Cockrell School of Engineering asks applicants for a math score\. AP Calculus (AB|BC) is offered at your school and fits next year/);
  const met = coursePlan(input({ ...base, satMath: 760 }));
  assert.ok(met.suggestions.every((s) => s.reason !== "required"), "a met SAT Math route closes the gate");
});

test("reason 2: the list's C8 recommendations, 'N of your M colleges', and a fourth year with the AP course named", () => {
  const rec4 = { science: 4 };
  const colleges = [college("1", "A", { recommended: rec4 }), college("2", "B", { recommended: rec4 }), college("3", "C", { recommended: rec4 }), college("4", "D", { recommended: rec4 }), college("5", "E"), college("6", "F"), college("7", "G")];
  const courses = [plain("science", 9), plain("science", 10), plain("science", 11)];
  const plan = coursePlan(input({ courses, colleges, offering: offers("ap_environmental_science") }));
  const s = plan.suggestions.find((x) => x.reason === "recommended")!;
  assert.equal(text(s), "4 of your 7 colleges recommend 4 years of science; you're on track for 3. AP Environmental Science would make it 4.");
  assert.deepEqual(s.units, ["1", "2", "3", "4"]);
  // No AP course fits: a fourth year of the subject, no course to add.
  const bare = coursePlan(input({ courses, colleges, offering: offers("ap_calculus_ab") }));
  const sub = bare.suggestions.find((x) => x.reason === "recommended")!;
  assert.equal(sub.key, null);
  assert.equal(sub.id, "subject:science");
  assert.match(text(sub), /A fourth year of science would make it 4\.$/);
  assert.equal(sub.name, "A fourth year of science");
});

test("reason 2: fewer than half the colleges don't count, unless the Dream recommends it", () => {
  const courses = [plain("science", 9), plain("science", 10), plain("science", 11)];
  const few = [college("1", "A", { recommended: { science: 4 } }), college("2", "B"), college("3", "C"), college("4", "D")];
  assert.equal(coursePlan(input({ courses, colleges: few, offering: offers("ap_environmental_science") })).suggestions.filter((s) => s.reason === "recommended").length, 0);
  const dream = [college("1", "Dreamy U", { dream: true, recommended: { science: 4 } }), college("2", "B"), college("3", "C"), college("4", "D")];
  const s = coursePlan(input({ courses, colleges: dream, offering: offers("ap_environmental_science") })).suggestions.find((x) => x.reason === "recommended")!;
  assert.equal(text(s), "Dreamy U recommends 4 years of science; you're on track for 3. AP Environmental Science would make it 4.");
});

test("reason 3: the school's top level in a core subject with no advanced course next year", () => {
  const plan = coursePlan(input({ courses: [plain("math", 11)], offering: offers("ap_calculus_ab") }));
  assert.equal(plan.suggestions[0].reason, "top_level");
  assert.equal(text(plan.suggestions[0]), "AP Calculus AB would put your math at your school's top level next year.");
  // Another course follows it at the school: the sentence doesn't claim the top.
  const step = coursePlan(input({ courses: [plain("math", 11)], offering: offers("ap_calculus_ab", "ap_calculus_bc") }));
  assert.equal(step.suggestions[0].key, "ap_calculus_bc");
  // An advanced math course already planned for next year: nothing to suggest in math.
  const have = coursePlan(input({ courses: [ap("ap_calculus_ab", { year: 12, status: "planned", grades: { s1: null, s2: null, final: null } })], offering: offers("ap_calculus_bc") }));
  assert.ok(have.suggestions.every((s) => s.subject !== "math"));
});

test("reason 4: the intended major, with the editorial expectation (a core subject's first reason is the top level)", () => {
  const plan = coursePlan(input({ majors: ["11"], courses: [plain("math", 11), ap("ap_calculus_ab", { year: 12, status: "planned", grades: { s1: null, s2: null, final: null } })], offering: offers("ap_computer_science_a") }));
  const s = plan.suggestions.find((x) => x.reason === "major")!;
  assert.equal(s.key, "ap_computer_science_a");
  assert.match(text(s), /programs commonly expect math through calculus, some computer science; AP Computer Science A fits next year\.$/);
  assert.ok(expectationsFor("11")!.sources.length > 0, "the expectation names its published sources");
  // The same course for a student whose sequence it continues: 'is next in your … sequence'.
  const seq = coursePlan(input({ majors: ["11"], courses: [ap("ap_computer_science_principles", { year: 10 }), ap("ap_calculus_ab", { year: 12, status: "planned", grades: { s1: null, s2: null, final: null } })], offering: offers("ap_computer_science_a") }));
  assert.equal(seq.suggestions[0].reason, "major");
});

test("the reasons come in the spec's order (required, recommended, top level, major) and never more than two show", () => {
  const unit = majorUnitFor("190415", "14");
  const rec = { language: 4 };
  const colleges = [college("190415", "Cornell University", { unit, recommended: rec }), college("2", "B", { recommended: rec })];
  const courses = [ap("ap_calculus_ab", { year: 12, status: "planned", grades: { s1: null, s2: null, final: null } }), plain("language", 9), plain("language", 10), plain("language", 11), plain("english", 11)];
  const offering = offers("ap_physics_1", "ap_chemistry", "ap_english_literature", "ap_us_government", "ap_spanish_language");
  const plan = coursePlan(input({ majors: ["14"], courses, colleges, offering }));
  assert.equal(plan.suggestions.length, COURSE_PLAN_RULES.maxSuggestions);
  assert.deepEqual(plan.suggestions.map((s) => s.reason), ["required", "recommended"]);
  assert.equal(new Set(plan.suggestions.map((s) => s.subject)).size, 2, "one suggestion per subject");
});

/* ------------------------------------------------------------------ */
/* The guardrails                                                      */
/* ------------------------------------------------------------------ */

test("guardrail 1: weak grades in advanced courses suppress every suggestion, and the card says what they are", () => {
  const offering = offers("ap_calculus_ab");
  // A low average (three Bs: 3.0), no grade below B−.
  const lowAvg = coursePlan(input({ courses: [ap("ap_us_history", { year: 10, grades: { s1: null, s2: null, final: "B" } }), ap("ap_world_history_modern", { year: 10, grades: { s1: null, s2: null, final: "B" } }), ap("ap_biology", { year: 11, grades: { s1: null, s2: null, final: "B" } })], offering }));
  assert.equal(lowAvg.kind, "guardrail");
  assert.equal(lowAvg.guardrail, "weak_grades");
  assert.equal(lowAvg.suggestions.length, 0);
  assert.equal(noteText(lowAvg.notes[0]), "Strong grades in the advanced courses you have count for more than adding another. Your grades in them: 3.0.");
  // A high average but a recent grade below B−.
  const recent = coursePlan(input({ courses: [ap("ap_us_history", { year: 10 }), ap("ap_world_history_modern", { year: 10 }), ap("ap_biology", { year: 11 }), ap("ap_chemistry", { year: 11 }), ap("ap_statistics", { year: 11, grades: { s1: "C+", s2: null, final: null } })], offering }));
  assert.equal(recent.guardrail, "weak_grades");
  // The same grade two years back is history, not a reason to stop.
  const old = coursePlan(input({ courses: [ap("ap_human_geography", { year: 9, grades: { s1: null, s2: null, final: "C+" } }), ap("ap_us_history", { year: 10 }), ap("ap_world_history_modern", { year: 10 }), ap("ap_biology", { year: 11 }), ap("ap_chemistry", { year: 11 }), ap("ap_statistics", { year: 11 }), ap("ap_psychology", { year: 11 }), ap("ap_computer_science_principles", { year: 11 })], offering }));
  assert.notEqual(old.guardrail, "weak_grades");
  // Planned courses have no grades and never count against the student; a B− is not below B−.
  assert.equal(gradeCheck([ap("ap_calculus_ab", { year: 12, status: "planned", grades: { s1: null, s2: null, final: null } })], 11).weak, false);
  assert.equal(gradeCheck([ap("ap_biology", { year: 11, grades: { s1: null, s2: null, final: "B-" } }), ap("ap_chemistry", { year: 11 }), ap("ap_statistics", { year: 11 })], 11).weak, false);
  assert.equal(gradeCheck([ap("ap_biology", { year: 11, grades: { s1: null, s2: null, final: "C+" } })], 11).weak, true);
});

test("guardrail 2: a yearly cap, and the plan never suggests past it", () => {
  const cap = COURSE_PLAN_RULES.maxAdvancedPerYear;
  const planned = (i: number) => ap("ap_us_history", { year: 12, status: "planned", grades: { s1: null, s2: null, final: null }, id: `p${i}` });
  const offering = offers("ap_calculus_ab", "ap_english_literature", "ap_physics_1");
  const full = coursePlan(input({ courses: Array.from({ length: cap }, (_, i) => planned(i)), offering }));
  assert.equal(full.kind, "guardrail");
  assert.equal(full.guardrail, "full_load");
  assert.equal(full.suggestions.length, 0);
  const room = coursePlan(input({ courses: Array.from({ length: cap - 1 }, (_, i) => planned(i)), offering, majors: ["14"] }));
  assert.equal(room.suggestions.length, 1, "one slot left under the cap, one suggestion");
  assert.equal(COURSE_PLAN_RULES.maxSuggestions, 2);
});

test("guardrail 3: already as demanding as the school allows", () => {
  const input1 = input({ courses: [plain("math", 11)], offering: offers("ap_calculus_ab"), reading: "most" });
  const core12 = { english: true, math: true, science: true, history: true, language: true };
  input1.student = { ...input1.student, coreAtTopLevel: { ...emptyCoreAtTopLevel(), 12: core12 } };
  const plan = coursePlan(input1);
  assert.equal(plan.kind, "guardrail");
  assert.equal(plan.guardrail, "already");
  assert.equal(noteText(plan.notes[0]), "Your schedule is already about as demanding as your school allows. Keep the grades up.");
  // The reading alone isn't enough: a core subject unchecked for next year keeps the suggestions.
  assert.notEqual(coursePlan(input({ courses: [plain("math", 11)], offering: offers("ap_calculus_ab"), reading: "most" })).guardrail, "already");
});

test("guardrail 4: from September of senior year the schedule is set", () => {
  const plan = coursePlan(input({ grade: 12, courses: [plain("math", 11)] }));
  assert.equal(plan.kind, "late");
  assert.equal(plan.suggestions.length, 0);
  assert.equal(noteText(plan.notes[0]), "Senior grades still count: colleges see midyear grades, and an offer can depend on finishing the year well.");
  assert.equal(coursePlan(input({ grade: null })).kind, "none");
});

test("guardrail 5: nothing outside the school's list; a count alone names no course; a major's top course not offered is said once", () => {
  const offering = offers("ap_physics_1", "ap_calculus_ab", "ap_english_literature");
  const colleges = [college("1", "A", { recommended: { language: 4, history: 4, science: 4, math: 4, english: 4 } })];
  const plan = coursePlan(input({ majors: ["14"], courses: [plain("math", 11), plain("science", 11)], offering, colleges }));
  for (const s of plan.suggestions) if (s.key) assert.ok(offering.apKeys!.includes(s.key), `${s.key} is on the school's list`);
  // Only a count on record (CRDC): subject-level, no course to add.
  const crdc = coursePlan(input({ courses: [plain("math", 11)], offering: { apCount: 9, apKeys: null, ib: null, dual: null, source: "crdc", field: "rigor.ap_courses" } }));
  assert.equal(crdc.suggestions.length, 1);
  assert.equal(crdc.suggestions[0].key, null);
  assert.match(text(crdc.suggestions[0]), /^Your school offers AP courses\. A course in math at its top level/);
  // No list at all: asks for one.
  const none = coursePlan(input({ offering: { apCount: null, apKeys: null, ib: null, dual: null, source: null, field: null } }));
  assert.equal(none.needsList, true);
  assert.equal(none.suggestions.length, 0);
  assert.equal(noteText(none.notes[0]), "We don't have your school's course list yet. Mark the courses it offers to see suggestions.");
  // A major whose top course isn't offered: said once.
  const missing = coursePlan(input({ majors: ["14"], courses: [plain("math", 11)], offering: offers("ap_calculus_ab") }));
  assert.equal(missing.notes.filter((x) => x.key === "course_plan.not_offered").length, 1);
  assert.match(noteText(missing.notes.find((x) => x.key === "course_plan.not_offered")!), /^If your school doesn't offer it, colleges know\./);
});

test("guardrail 6: 9th and 10th graders get a path, not suggestions", () => {
  const offering = offers("ap_calculus_ab", "ap_physics_1");
  const tenth = coursePlan(input({ grade: 10, majors: ["14"], courses: [plain("math", 9)], offering }));
  assert.equal(tenth.kind, "path");
  assert.equal(tenth.suggestions.length, 0);
  assert.ok(tenth.path.map(noteText).includes("To take AP Calculus AB as a senior, take Precalculus by 11th grade."));
  assert.equal(coursePlan(input({ grade: 9, majors: ["14"], offering })).kind, "path");
  // Only subjects tied to the major, and nothing without one.
  assert.equal(coursePlan(input({ grade: 10, majors: [], offering })).kind, "none");
  assert.equal(coursePlan(input({ grade: 10, majors: ["14"], offering: offers("ap_us_history") })).kind, "none", "a top course the school doesn't offer isn't a path");
  const direct = pathFor({ courses: [], coreAtTopLevel: emptyCoreAtTopLevel(), grade: 10, majors: ["14"], satMath: null, actMath: null }, offering);
  assert.ok(direct.length >= 1);
});

test("dismissed suggestions come out for the season; the next one steps up; all dismissed says so", () => {
  const base = { courses: [plain("math", 11), plain("science", 11)], offering: offers("ap_calculus_ab", "ap_physics_1") };
  const all = coursePlan(input(base));
  assert.deepEqual(all.suggestions.map((s) => s.key).sort(), ["ap_calculus_ab", "ap_physics_1"]);
  const one = coursePlan(input({ ...base, dismissed: ["ap_calculus_ab"] }));
  assert.deepEqual(one.suggestions.map((s) => s.key), ["ap_physics_1"]);
  const none = coursePlan(input({ ...base, dismissed: ["ap_calculus_ab", "ap_physics_1"] }));
  assert.equal(none.kind, "set");
  assert.equal(none.allDismissed, true);
  assert.equal(noteText(none.notes[0]), "You've set these aside for this season.");
});

/* ------------------------------------------------------------------ */
/* Candidates: prerequisites, grade levels, successors                 */
/* ------------------------------------------------------------------ */

test("a course needs its catalog prerequisites on the list (taken or in progress) and a usual grade level that includes next year", () => {
  const offering = offers("ap_physics_2", "ap_physics_1", "ap_english_language", "ap_english_literature");
  const student = (courses: CourseEntry[]) => ({ courses, coreAtTopLevel: emptyCoreAtTopLevel(), grade: 11, majors: [], satMath: null, actMath: null });
  const keys = (courses: CourseEntry[]) => eligibleCourses(student(courses), offering, 12).map((c) => c.key);
  assert.ok(!keys([]).includes("ap_physics_2"), "Physics 2 needs Physics 1");
  assert.ok(!keys([ap("ap_physics_1", { year: 12, status: "planned" })]).includes("ap_physics_2"), "a planned prerequisite isn't met");
  assert.ok(keys([ap("ap_physics_1", { year: 11, status: "in_progress" })]).includes("ap_physics_2"));
  assert.ok(!keys([]).includes("ap_english_language"), "AP English Language is a junior-year course");
  assert.ok(keys([]).includes("ap_english_literature"));
  assert.ok(!keys([ap("ap_physics_1", { year: 11 })]).includes("ap_physics_1"), "already on the list");
  // The usual successor already on the list: Calculus BC taken, so AB isn't suggested.
  const calc = eligibleCourses(student([ap("ap_calculus_bc", { year: 11 })]), offers("ap_calculus_ab"), 12);
  assert.equal(calc.length, 0);
});

/* ------------------------------------------------------------------ */
/* What it changes                                                     */
/* ------------------------------------------------------------------ */

const res = (group: EstimateResult["group"], label: EstimateResult["label"] = null): EstimateResult => ({ unitId: "", group, label, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, modelVersion: "t" });

test("the what-it-changes line: one college, 'if your grades stay strong', never a percentage, never for a Reach for everyone", () => {
  const names = { "1": "Elon", "2": "Furman" };
  assert.equal(groupChangeLine({ "1": res("target"), "2": res("reach") }, { "1": res("likely"), "2": res("target") }, names), "At Elon: Target → Likely, if your grades stay strong.");
  assert.equal(groupChangeLine({ "1": res("target") }, { "1": res("target") }, names), null, "no move, no line");
  assert.equal(groupChangeLine({ "1": res("likely") }, { "1": res("target") }, names), null, "a move down is never claimed");
  assert.equal(groupChangeLine({ "1": res(null, "reach-for-everyone") }, { "1": res("target") }, names), null);
  assert.equal(groupChangeLine({ "1": res("reach", "reach-for-everyone") }, { "1": res("target") }, names), null);
  assert.doesNotMatch(groupChangeLine({ "1": res("target") }, { "1": res("likely") }, names)!, /%/);
});

test("the line asks the endpoint twice (as is, and with the course planned) and renders nothing when it is absent or errors", async () => {
  const profile = emptyProfile();
  const course = ap("ap_calculus_ab", { year: 12, status: "planned", grades: { s1: null, s2: null, final: null } });
  const colleges = [{ unitId: "1", name: "Elon" }];
  const bodies: unknown[] = [];
  const ok = await whatItChanges({
    profile,
    colleges,
    course,
    fetchEstimate: async (body) => {
      bodies.push(body);
      const added = (body as { counterfactual?: unknown }).counterfactual !== undefined;
      return { "1": res(added ? "likely" : "target") };
    },
  });
  assert.equal(ok, "At Elon: Target → Likely, if your grades stay strong.");
  assert.equal(bodies.length, 2);
  assert.equal((bodies[1] as { counterfactual: { addCourse: CourseEntry } }).counterfactual.addCourse.key, "ap_calculus_ab");
  // Absent endpoint: a fetch that 404s, or throws, or answers nonsense.
  const missing = (impl: () => Promise<Response>) => endpointFetch(impl as unknown as typeof fetch);
  for (const f of [missing(async () => new Response("", { status: 404 })), missing(async () => { throw new Error("offline"); }), missing(async () => new Response("{}", { status: 200 })), missing(async () => new Response("nope", { status: 200 }))]) {
    assert.equal(await whatItChanges({ profile, colleges, course, fetchEstimate: f }), null);
  }
  assert.equal(await whatItChanges({ profile, colleges: [], course, fetchEstimate: async () => ({}) }), null);
});

/* ------------------------------------------------------------------ */
/* The calendar                                                        */
/* ------------------------------------------------------------------ */

test("cycle file: course requests for 9th to 11th graders, AP ordering (Nov 13, 2026), exams (May), scores (early July), each sourced", () => {
  assert.deepEqual(validateCycleFile(cycleFile), []);
  for (const cycle of ["2027-28", "2028-29"]) {
    const e = loadCycle(cycle).entries.find((x) => x.key === "choose_courses_2027")!;
    assert.ok(e, `${cycle} has the course-request window`);
    assert.equal(e.label, "Choose next year's courses");
    assert.deepEqual(e.window, ["2027-02-01", "2027-04-30"]);
    assert.match(e.detail!, /check your school's dates/);
    assert.equal(e.applies, "all");
  }
  assert.ok(loadCycle("2028-29").entries.some((x) => x.key === "choose_courses_2028"), "a sophomore chooses again as a junior");
  assert.ok(!loadCycle("2026-27").entries.some((x) => x.key.startsWith("choose_courses")), "a senior chooses nothing");
  for (const cycle of ["2026-27", "2027-28", "2028-29"]) {
    const entries = loadCycle(cycle).entries;
    const order = entries.find((x) => x.key === "ap_order_deadline")!;
    assert.equal(order.label, "Sign up for AP exams by your school's deadline");
    assert.equal(order.date, "2026-11-13");
    assert.equal(order.source, "https://apcentral.collegeboard.org/about-ap/ap-coordinators/calendar-deadlines");
    assert.match(order.detail!, /\$40/);
    assert.match(order.detail!, /March 12, 2027/);
    assert.match(order.detail!, /AP coordinator's date is usually earlier/);
    assert.deepEqual(entries.find((x) => x.key === "ap_exams_2027")!.window, ["2027-05-03", "2027-05-14"]);
    const scores = entries.find((x) => x.key === "ap_scores_2027")!;
    assert.match(scores.label, /projected/);
    assert.ok(scores.window![0].startsWith("2027-07"));
    for (const k of ["ap_order_deadline", "ap_exams_2027", "ap_scores_2027"]) assert.match(entries.find((x) => x.key === k)!.source, /^https:\/\//);
  }
});

test("AP entries apply to students with an AP course now (ordering, exams) or behind them (scores)", () => {
  const profile = (courses: CourseEntry[]) => ({ ...emptyProfile(), academics: { ...emptyProfile().academics, courses } });
  const facts = (courses: CourseEntry[]) => ({ items: [], schools: {}, profile: profile(courses) });
  const inProgress = [ap("ap_biology", { status: "in_progress" })];
  const taken = [ap("ap_biology", { status: "taken" })];
  const planned = [ap("ap_biology", { status: "planned" })];
  assert.equal(applies({ applies: "ap_in_progress" }, facts(inProgress)), true);
  assert.equal(applies({ applies: "ap_in_progress" }, facts(taken)), false);
  assert.equal(applies({ applies: "ap_in_progress" }, facts(planned)), false);
  assert.equal(applies({ applies: "ap_in_progress" }, { items: [], schools: {}, profile: null }), false);
  assert.equal(applies({ applies: "has_ap_course" }, facts(taken)), true);
  assert.equal(applies({ applies: "has_ap_course" }, facts(inProgress)), true);
  assert.equal(applies({ applies: "has_ap_course" }, facts(planned)), false);
});

const LIST = "11111111-1111-4111-8111-111111111111";
const item = (id: number, over: Partial<PlanItem> = {}) =>
  ({ id: String(id).repeat(8) + "-1111-4111-8111-111111111111", list_id: LIST, unit_id: String(100 + id), position: id, status: "decided", outcome: "admitted", enrolling: true, committed_on: "2027-04-20", withdrawn_on: null, round: "rd", ...over }) as unknown as PlanItem;
const planSchool = (id: number, name: string, acceptsApCredit: boolean | null) => ({ unit_id: String(100 + id), name, logistics: null, cites: {}, acceptsApCredit, cycleStartYear: 2026 }) as unknown as PlanSchool;
function generatorInput(school: PlanSchool, courses: CourseEntry[], over: Partial<PlanItem> = {}): GeneratorInput {
  const profile = { ...emptyProfile(), academics: { ...emptyProfile().academics, courses } };
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "List", is_default: true } as unknown as GeneratorInput["list"],
    items: [item(1, over)],
    schools: { [school.unit_id]: school },
    profile,
    cycle: loadCycle("2026-27"),
    grade: "senior_spring",
    today: "2027-04-20",
    visits: [],
    offers: [],
  };
}
const sendAp = (tasks: ReturnType<typeof offersGen>) => tasks.filter((t) => t.key.endsWith(":summer:send_ap_scores"));

test("'Send your AP scores for credit' appears once the student commits to a college that gives AP credit", () => {
  const tasks = sendAp(offersGen(generatorInput(planSchool(1, "Michigan", true), [ap("ap_biology")])));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Send your AP scores to Michigan for credit");
  assert.equal(tasks[0].kind, "summer");
  assert.equal(tasks[0].source_field, "admissions.accepts_ap_credit");
  assert.equal(tasks[0].assignee, "student");
  assert.match(tasks[0].detail!, /early July/);
  // No credit policy, an unknown one, no commitment, or a list that says no AP course was taken: nothing.
  assert.equal(sendAp(offersGen(generatorInput(planSchool(1, "Michigan", false), [ap("ap_biology")]))).length, 0);
  assert.equal(sendAp(offersGen(generatorInput(planSchool(1, "Michigan", null), [ap("ap_biology")]))).length, 0);
  assert.equal(sendAp(offersGen(generatorInput(planSchool(1, "Michigan", true), [ap("ap_biology")], { enrolling: false, committed_on: null }))).length, 0);
  assert.equal(sendAp(offersGen(generatorInput(planSchool(1, "Michigan", true), [plain("math", 11)]))).length, 0);
  // A student who hasn't entered courses may still have AP scores to send.
  assert.equal(sendAp(offersGen(generatorInput(planSchool(1, "Michigan", true), []))).length, 1);
});

/* ------------------------------------------------------------------ */
/* Editorial data, profile storage, dates                              */
/* ------------------------------------------------------------------ */

test("major course expectations: every family sourced, tops in the catalog, and a bad file fails", () => {
  assert.deepEqual(validateExpectations(MAJOR_EXPECTATIONS), []);
  const broken = structuredClone(MAJOR_EXPECTATIONS);
  broken.families[0].sources = [];
  assert.match(validateExpectations(broken).join("\n"), /at least one published source/);
  const badTop = structuredClone(MAJOR_EXPECTATIONS);
  badTop.families[0].expects[0].top = "ap_nope";
  assert.match(validateExpectations(badTop).join("\n"), /isn't a catalog course/);
  const wrongSubject = structuredClone(MAJOR_EXPECTATIONS);
  wrongSubject.families[0].expects[0].top = "ap_biology";
  assert.match(validateExpectations(wrongSubject).join("\n"), /is a science course, not math/);
});

test("the profile keeps dismissals for a season and the student's school marks, sanitized", () => {
  assert.deepEqual(sanitizeCoursePlan({ season: "2026-27", dismissed: ["ap_calculus_ab", "ap_calculus_ab", "bogus id", "subject:science", 7], done: true }), { season: "2026-27", dismissed: ["ap_calculus_ab", "subject:science"], done: true });
  assert.equal(sanitizeCoursePlan({ season: "2026-27", dismissed: [], done: false }), null);
  assert.equal(sanitizeCoursePlan({ season: "last year", dismissed: ["ap_calculus_ab"] }), null);
  assert.deepEqual(sanitizeSchoolOffers(["ap_calculus_ab", "ap_nope", "ib_math_aa_hl", "ap_calculus_ab", 3]), ["ap_calculus_ab"], "AP catalog keys only, each once");
  const p = sanitizeProfile({ academics: { coursePlan: { season: "2026-27", dismissed: ["ap_biology"] }, schoolOffers: ["ap_biology", "x"] } });
  assert.deepEqual(p.academics.schoolOffers, ["ap_biology"]);
  assert.deepEqual(p.academics.coursePlan?.dismissed, ["ap_biology"]);
  assert.deepEqual(emptyProfile().academics.schoolOffers, []);
});

test("the student's own marks are an offering source after the profile and the pooled list", () => {
  const school = { rigor: { ap_courses: 12, ib_enrolled: null, dual_enrolled: null } } as never;
  const marked = schoolOffering({ school, studentMarks: ["ap_calculus_ab", "ap_biology"] });
  assert.equal(marked.source, "student");
  assert.deepEqual(marked.apKeys, ["ap_calculus_ab", "ap_biology"]);
  assert.equal(schoolOffering({ school, studentMarks: ["ap_calculus_ab"] }, ["ap_chemistry", "ap_physics_1"]).source, "pooled", "pooled outranks the student's marks");
  assert.equal(schoolOffering({ school }).source, "crdc");
});

test("dates: the season turns over in August, next year is the next grade, the request window is February to April", () => {
  assert.equal(planSeason("2026-10-11"), "2026-27");
  assert.equal(planSeason("2027-03-01"), "2026-27");
  assert.equal(planSeason("2027-08-01"), "2027-28");
  assert.equal(nextYearOf(11), 12);
  assert.equal(nextYearOf(9), 10);
  assert.equal(nextYearOf(12), null);
  assert.equal(nextYearOf(null), null);
  assert.equal(inRegistrationWindow("2027-02-01"), true);
  assert.equal(inRegistrationWindow("2027-04-30"), true);
  assert.equal(inRegistrationWindow("2027-05-01"), false);
  assert.equal(inRegistrationWindow("2026-10-11"), false);
});

/* ------------------------------------------------------------------ */
/* The migration (SQL text; the behavior is tested in chances-course-counts-policies.test.mts)       */
/* ------------------------------------------------------------------ */

test("the migration reads through a security-definer function with the three-student threshold, and the table has no reader", () => {
  const sql = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "20261011120000_school_course_counts.sql"), "utf8");
  assert.match(sql, /create table public\.school_course_counts/);
  assert.match(sql, /create or replace function public\.school_course_list\(p_high_school_id text\)\s+returns setof text[\s\S]*security definer/);
  assert.match(sql, /c\.students >= 3/);
  assert.match(sql, /revoke all on public\.school_course_counts from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant select on public\.school_course_counts/);
  assert.match(sql, /create trigger student_profiles_course_counts\s+after insert or update of data or delete on public\.student_profiles/);
  assert.match(sql, /grant execute on function public\.school_course_list\(text\) to anon, authenticated, service_role/);
});

/* ------------------------------------------------------------------ */
/* The proprietary rule                                                */
/* ------------------------------------------------------------------ */

const ROOT = resolve(import.meta.dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const importsOf = (file: string): string[] => {
  const src = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    let base: string | null = null;
    if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(file), spec);
    if (!base) continue;
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".mts"]) {
      try {
        if (statSync(base + ext).isFile()) {
          found.push(base + ext);
          break;
        }
      } catch {
        /* try the next extension */
      }
    }
  }
  return found;
};

test("no client code reaches the course plan's rules, the plan, or its server builder", () => {
  const forbidden = new Set(["lib/chances/course-plan-rules.ts", "lib/chances/course-plan.ts", "lib/chances/course-plan-server.ts"].map((f) => join(ROOT, f)));
  const clients = [...walk(join(ROOT, "components")), ...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))].filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8").slice(0, 200)));
  assert.ok(clients.length > 50, "found the client files");
  assert.ok(clients.some((f) => f.endsWith("NextYearCard.tsx")));
  const bad: string[] = [];
  for (const start of clients) {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (forbidden.has(f)) bad.push(`${relative(ROOT, start)} -> ${relative(ROOT, f)}`);
      // A "use server" module is a boundary: the browser gets a reference, not its code.
      if (f !== start && /^\s*["']use server["']/.test(readFileSync(f, "utf8").slice(0, 200))) continue;
      stack.push(...importsOf(f));
    }
  }
  assert.deepEqual(bad, []);
});

test("no sentence in the course plan's notes names a threshold or a cap", () => {
  const keys = Object.keys(NOTES).filter((k) => k.startsWith("course_plan."));
  assert.ok(keys.length >= 15);
  const values = { who: "Cornell Engineering", level: "physics", course: "AP Physics 1", what: "math", count: 4, total: 7, years: 4, subject: "science", have: 3, ordinal: "A fourth", college: "Elon", major: "Engineering", expects: "physics", tail: "fits next year", gpa: "3.1", steps: "Precalculus by 11th grade", senior: "senior", label: "most of what your school offers", recommended: 4 };
  for (const k of keys) {
    const t = noteText({ key: k, values });
    assert.ok(t.length > 0, k);
    assert.doesNotMatch(t, /\b3\.3\b|B−|B-|\bfive\b|\b5 advanced|\bmaximum\b|\bcap\b|threshold|half of/i, `${k}: ${t}`);
  }
});

test("proving the grades guard can fail: break it and a weak-grade student is offered courses", () => {
  const weak = [ap("ap_biology", { year: 11, grades: { s1: null, s2: null, final: "C" } })];
  const real = coursePlan(input({ courses: [plain("math", 11), ...weak] }));
  assert.equal(real.suggestions.length, 0);
  // The same student with the grade fixed is offered a course, so the suppression above is the guard's doing.
  const fixed = coursePlan(input({ courses: [plain("math", 11), ap("ap_biology", { year: 11, grades: { s1: null, s2: null, final: "A" } })] }));
  assert.equal(fixed.suggestions.length, 1);
});
