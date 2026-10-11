/**
 * Rigor in context (specs/chances/rigor-in-context.md; the rules are method/rigor-reading.md): the thresholds in
 * lib/chances/rigor-rules.ts, the five readings and their sentences (lib/chances/rigor.ts), planned vs taken wording,
 * honors and other kinds named, unnamed placeholder rows, the grade and exam sentences, the core-subject answers
 * (stored in the profile and pre-checked from the list), the You column, what a guardian sees and saves, the STEM gate
 * for the picker's math and science rows, and the proprietary rule: no client code imports the rules, and no sentence
 * names a threshold. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { join, relative, resolve, dirname } from "node:path";

// rigor-rules.ts and rigor.ts start with `import "server-only"`, which only Next.js resolves; stand in an empty module.
// (module.registerHooks is in Node 24; the installed @types/node predates it.)
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

const { RIGOR_RULES, isStrong, placeRigor } = await import("../lib/chances/rigor-rules.ts");
const { rigorReading } = await import("../lib/chances/rigor.ts");
const { NOTES, noteText } = await import("../lib/chances/notes.ts");
const { offeringLines, sentencesFrom } = await import("../lib/chances/rigor-view.ts");
const { apCourses, ibCourses } = await import("../lib/chances/catalog.ts");
const {
  coreCount,
  gradeNow,
  groupByYear,
  isStemMajor,
  listSuggests,
  mergeCoursesForSave,
  newCourse,
  resolveCore,
  STEM_FAMILIES,
  thirdPerson,
  usualYear,
  defaultStatus,
  withoutExams,
  youText,
  youYears,
} = await import("../lib/chances/courses.ts");
const { MAJOR_FAMILIES } = await import("../lib/majors.ts");
const { coreAnswered, emptyCoreAtTopLevel, emptyProfile, placeholderCourse, sanitizeCoreAtTopLevel, sanitizeProfile } = await import("../lib/student-profile.ts");
import type { CoreAtTopLevel } from "../lib/student-profile.ts";
import type { CourseEntry, Mark, SchoolOffering } from "../lib/chances/types.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ---- Fixtures ---- */

const AP_KEYS = apCourses().map((c) => c.key);
let n = 0;
function course(o: Partial<CourseEntry> = {}): CourseEntry {
  n += 1;
  return { id: `t${n}`, kind: "ap", key: null, name: null, subject: "other", year: 11, status: "taken", grades: { s1: null, s2: null, final: null }, exam: null, ...o };
}
/** `count` distinct AP rows, each with the given final grade (and exam). */
function aps(count: number, o: { final?: Mark | null; status?: CourseEntry["status"]; exam?: CourseEntry["exam"]; year?: CourseEntry["year"]; offset?: number } = {}): CourseEntry[] {
  return Array.from({ length: count }, (_, i) =>
    course({ kind: "ap", key: AP_KEYS[(o.offset ?? 0) + i], subject: "other", year: o.year ?? 11, status: o.status ?? "taken", grades: { s1: null, s2: null, final: o.status === "planned" ? null : (o.final ?? null) }, exam: o.exam ?? null }),
  );
}
function offering(apCount: number | null, o: Partial<SchoolOffering> = {}): SchoolOffering {
  return { apCount, apKeys: null, ib: null, dual: null, source: apCount === null ? null : "crdc", field: apCount === null ? null : "rigor.ap_courses", ...o };
}
const NO_CORE = emptyCoreAtTopLevel();
const reading = (courses: CourseEntry[], off: SchoolOffering | null, o: { core?: CoreAtTopLevel; grade?: number | null; linked?: boolean } = {}) =>
  rigorReading({ courses, coreAtTopLevel: o.core ?? NO_CORE, grade: o.grade ?? null }, off, { linked: o.linked });
const sentences = (r: ReturnType<typeof rigorReading>) => sentencesFrom(r.notes);

/* ---- The thresholds (rigor-rules.ts) ---- */

test("thresholds: share of the reachable courses, with the cap at ten and the boundaries inclusive", () => {
  const base = { entered: true, core: 0, advancedGpa: null, lowestFinal: null };
  const at = (offered: number, advanced: number) => placeRigor({ ...base, offered, advanced }).reading;
  assert.equal(at(14, 7), "most", "7 of the 10 reachable is the boundary of most");
  assert.equal(at(14, 6), "much");
  assert.equal(at(14, 4), "much", "4 of 10 is the boundary of much");
  assert.equal(at(14, 3), "some");
  assert.equal(at(30, 7), "most", "a 30-course catalog is still measured against ten");
  assert.equal(at(30, 3), "some");
  assert.equal(at(5, 4), "most", "a school with five courses: four is 80%");
  assert.equal(at(5, 2), "much");
  assert.equal(at(5, 1), "some");
  assert.equal(RIGOR_RULES.reachableCap, 10);
});

test("thresholds: the core-subject answers can carry a schedule with no AP at all", () => {
  const base = { offered: 12, advanced: 0, entered: true, advancedGpa: null, lowestFinal: null };
  assert.equal(placeRigor({ ...base, core: 8 }).reading, "most");
  assert.equal(placeRigor({ ...base, core: 7 }).reading, "much");
  assert.equal(placeRigor({ ...base, core: 5 }).reading, "much");
  assert.equal(placeRigor({ ...base, core: 4 }).reading, "some");
});

test("thresholds: strong grades keep a most schedule, weak ones demote it to much and say so", () => {
  const base = { offered: 9, advanced: 8, entered: true, core: 0 };
  assert.equal(placeRigor({ ...base, advancedGpa: 3.3, lowestFinal: 3.0 }).reading, "most", "3.3 is strong");
  const weak = placeRigor({ ...base, advancedGpa: 3.29, lowestFinal: 3.0 });
  assert.deepEqual([weak.reading, weak.weak], ["much", true]);
  assert.equal(placeRigor({ ...base, advancedGpa: 3.8, lowestFinal: 2.0 }).reading, "most", "a C is not below C");
  assert.equal(placeRigor({ ...base, advancedGpa: 3.8, lowestFinal: 1.7 }).reading, "much", "a C- final keeps it from most");
  assert.equal(placeRigor({ ...base, advancedGpa: null, lowestFinal: null }).reading, "most", "no grades yet is not weak");
  assert.equal(isStrong({ advancedGpa: 3.3, lowestFinal: null }), true);
  assert.equal(RIGOR_RULES.strongAdvancedGpa, 3.3);
});

test("thresholds: few offered needs a school with at most three AP courses and a student who took what there was", () => {
  const base = { entered: true, core: 0, advancedGpa: null, lowestFinal: null };
  assert.equal(placeRigor({ ...base, offered: 2, advanced: 2 }).reading, "few_offered");
  assert.equal(placeRigor({ ...base, offered: 3, advanced: 3 }).reading, "few_offered");
  assert.equal(placeRigor({ ...base, offered: 0, advanced: 0 }).reading, "few_offered", "a school with none");
  assert.equal(placeRigor({ ...base, offered: 3, advanced: 2 }).reading, "much", "took two of three: read by share");
  assert.equal(placeRigor({ ...base, offered: 4, advanced: 4 }).reading, "most", "four courses is not a few");
});

test("thresholds: can't place without an offering on record or without anything entered", () => {
  assert.equal(placeRigor({ offered: null, advanced: 5, entered: true, core: 0, advancedGpa: null, lowestFinal: null }).reading, "cant_place");
  assert.equal(placeRigor({ offered: 14, advanced: 0, entered: false, core: 0, advancedGpa: null, lowestFinal: null }).reading, "cant_place");
});

/* ---- The five readings and their sentences ---- */

test("most: the spec's sentence, with the AP count capped at what the school offers", () => {
  const r = reading(aps(8, { final: "A" }), offering(9));
  assert.equal(r.reading, "most");
  assert.equal(sentences(r)[0], "You've taken or planned 8 of the 9 AP courses your school offers, about as demanding a schedule as it allows.");
});

test("much: the spec's sentence; with weak grades it adds the grades clause with the number", () => {
  const plain = reading(aps(6), offering(14));
  assert.equal(plain.reading, "much");
  assert.equal(sentences(plain)[0], "You've taken or planned 6 of your school's 14 AP courses.");
  const weak = reading(aps(6, { final: "B-" }), offering(14));
  assert.equal(weak.reading, "much");
  assert.match(sentences(weak)[0], /^You've taken or planned 6 of your school's 14 AP courses; colleges look for strong grades in demanding courses, and your grades in them \(2\.7\) matter as much as how many you take\.$/);
  // A schedule that would read most, with weak grades, reads much.
  const demoted = reading(aps(8, { final: "C+" }), offering(9));
  assert.equal(demoted.reading, "much");
  assert.match(sentences(demoted)[0], /your grades in them \(2\.3\)/);
});

test("some: the spec's sentence", () => {
  const r = reading(aps(2), offering(14));
  assert.equal(r.reading, "some");
  assert.equal(sentences(r)[0], "You've taken or planned 2 of your school's 14 AP courses. At colleges that rate rigor very important, the courses behind a GPA matter as much as the GPA.");
});

test("few offered: both, it, or all; a school with none says so", () => {
  const both = reading(aps(2), offering(2));
  assert.equal(both.reading, "few_offered");
  assert.equal(sentences(both)[0], "Your school offers 2 AP courses and you've taken both. Colleges read rigor against what your school offers; your counselor's report says so.");
  assert.match(sentences(reading(aps(1), offering(1)))[0], /^Your school offers 1 AP course and you've taken it\./);
  assert.match(sentences(reading(aps(3), offering(3)))[0], /^Your school offers 3 AP courses and you've taken them all\./);
  const none = reading(aps(0).concat([course({ kind: "honors", name: "Honors Chemistry", subject: "science" })]), offering(0));
  assert.equal(none.reading, "few_offered");
  assert.match(sentences(none)[0], /^Your school doesn't offer AP courses\./);
});

test("can't place: no school, a school with no list, nothing entered; the list is still counted", () => {
  const none = reading(aps(4), null, { linked: false });
  assert.equal(none.reading, "cant_place");
  assert.deepEqual(sentences(none), ["Add your high school to see your courses against what it offers.", "You've listed 4 advanced courses, taken or planned."]);
  const noData = reading(aps(1), offering(null), { linked: true });
  assert.equal(noData.reading, "cant_place");
  assert.equal(sentences(noData)[0], "We don't have your school's course list yet, so we can't place your courses against it.");
  assert.equal(sentences(noData)[1], "You've listed 1 advanced course, taken or planned.");
  const empty = reading([], offering(14));
  assert.equal(empty.reading, "cant_place");
  assert.deepEqual(sentences(empty), ["Add your courses to see them against what your school offers."]);
});

/* ---- Planned vs taken, kinds, honors, placeholders ---- */

test("a planned course is marked in the sentence; a senior's planned courses are scheduled; none planned says nothing", () => {
  const list = [...aps(5, { final: "A" }), ...aps(3, { status: "planned", offset: 5 })];
  assert.match(sentences(reading(list, offering(9), { grade: 11 }))[0], /8 of the 9 AP courses your school offers \(3 planned\), about as demanding/);
  assert.match(sentences(reading(list, offering(9), { grade: 12 }))[0], /\(3 scheduled\)/);
  assert.doesNotMatch(sentences(reading(aps(8, { final: "A" }), offering(9)))[0], /\(\d+ (planned|scheduled)\)/);
});

test("dual enrollment and IB are named beside AP and count toward the share; honors is shown and never counted", () => {
  const dual = [course({ kind: "dual", name: "College Algebra", subject: "math" }), course({ kind: "dual", name: "Intro Psychology", subject: "history" })];
  const ib = [course({ kind: "ib_hl", key: ibCourses()[0].key })];
  const r = reading([...aps(2), ...dual, ...ib], offering(14));
  assert.match(sentences(r)[0], /2 of your school's 14 AP courses, along with 1 IB course and 2 dual-enrollment courses\./);
  // Three AP + four dual = seven advanced of ten reachable: a most schedule even though only three are AP.
  assert.equal(reading([...aps(3), ...Array.from({ length: 4 }, (_, i) => course({ kind: "dual", name: `Dual ${i}`, subject: "science" }))], offering(10)).reading, "most");
  const honors = Array.from({ length: 4 }, (_, i) => course({ kind: "honors", name: `Honors ${i}`, subject: "english" }));
  const h = reading([...aps(2), ...honors], offering(14));
  assert.equal(h.reading, "some", "honors does not move the reading");
  assert.match(sentences(h)[0], /2 of your school's 14 AP courses, plus 4 honors courses\. At colleges/);
  assert.equal(reading(honors, offering(14)).reading, "some");
});

test("unnamed placeholder rows (counts only) read as AP courses and still count", () => {
  const rows = [1, 2, 3, 4, 5].map((i) => placeholderCourse(`placeholder-${i}`));
  const r = reading(rows, offering(14));
  assert.equal(r.reading, "much");
  assert.equal(sentences(r)[0], "You've taken or planned 5 of your school's 14 AP courses.");
  assert.equal(r.counts.advanced, 5);
});

test("an AP count above what the school offers is shown as the school's count", () => {
  assert.match(sentences(reading(aps(12, { final: "A" }), offering(9)))[0], /^You've taken or planned 9 of the 9 AP courses/);
});

/* ---- Grades and exams ---- */

test("grades: A's among the finished advanced courses with the average; no A's says the average", () => {
  const finals: Mark[] = ["A", "A", "A-", "A", "A-", "B"];
  const list = finals.map((m, i) => course({ kind: "ap", key: AP_KEYS[i], grades: { s1: null, s2: null, final: m } }));
  const r = reading(list, offering(14));
  assert.equal(sentences(r)[1], "A's in 5 of your 6 finished advanced courses (3.7 in them).");
  const bs = reading([course({ key: AP_KEYS[0], grades: { s1: null, s2: null, final: "B" } }), course({ key: AP_KEYS[1], grades: { s1: null, s2: null, final: "B" } })], offering(14));
  assert.equal(sentences(bs)[1], "Your 2 finished advanced courses average 3.0.");
  // A course with only a semester grade is read by the schedule but is not "finished".
  const inProgress = reading([course({ key: AP_KEYS[0], status: "in_progress", grades: { s1: "A", s2: null, final: null } })], offering(14));
  assert.equal(sentences(inProgress).length, 1);
  assert.equal(sentences(reading(aps(2), offering(14))).length, 1, "no grades, no grade sentence");
});

test("exams: 4s or 5s among the exams taken; a course with no exam is never counted against the student", () => {
  const list = [5, 4, 3, 2, null, null].map((e, i) => course({ kind: "ap", key: AP_KEYS[i], exam: e as CourseEntry["exam"] }));
  const r = reading(list, offering(14));
  assert.equal(sentences(r)[1], "4s or 5s on 2 of the 4 AP exams you've taken.");
  assert.equal(sentences(reading(aps(3), offering(14))).length, 1, "no exams, no exam sentence");
  // What a parent sees while exams are private: none.
  assert.equal(sentences(reading(withoutExams(list), offering(14))).length, 1);
});

test("the sentences name no threshold: none holds the rules' numbers, and every filled-in sentence is catalog text", () => {
  const keys = Object.keys(NOTES).filter((k) => k.startsWith("rigor.") || k.startsWith("offering."));
  assert.ok(keys.length >= 20);
  const values = { taken: 6, offered: 14, count: 3, gpa: "3.1", list: "x", extra: "", a: 2, finished: 3, high: 1, college: "C", rating: "r", share: "s" };
  for (const k of keys) {
    const text = noteText({ key: k, values });
    assert.notEqual(text, "", k);
    for (const bad of [/\b3\.3\b/, /\b0?\.7\b/, /\b70%/, /\b40%/, /\bten\b/i, /\b10 courses/]) assert.doesNotMatch(text.replace("3.1", ""), bad, `${k}: ${text}`);
  }
  assert.equal(noteText({ key: "rigor.nope", values: {} }), "", "an unknown key is dropped, never free text");
});

/* ---- The core-subject answers ---- */

test("coreAtTopLevel: stored in the profile, answers kept as given, junk dropped, empty by default", () => {
  assert.deepEqual(emptyProfile().academics.coreAtTopLevel, emptyCoreAtTopLevel());
  assert.equal(coreAnswered(emptyCoreAtTopLevel()), false);
  const p = sanitizeProfile({ academics: { coreAtTopLevel: { 11: { english: true, math: false, science: "yes", art: true }, 12: { language: true }, 10: { english: true } } } });
  const c = p.academics.coreAtTopLevel;
  assert.deepEqual([c[11].english, c[11].math, c[11].science, c[12].language, c[12].english], [true, false, null, true, null]);
  assert.equal(coreAnswered(c), true);
  assert.deepEqual(Object.keys(c), ["11", "12"]);
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(p))).academics.coreAtTopLevel, c, "round trip");
  assert.deepEqual(sanitizeCoreAtTopLevel("junk"), emptyCoreAtTopLevel());
  assert.deepEqual(sanitizeProfile({ academics: { gpa: 3.5 } }).academics.coreAtTopLevel, emptyCoreAtTopLevel(), "an older profile has none");
});

test("the core question is pre-checked from the list, and the student's own answer wins", () => {
  const list = [
    course({ kind: "ap", key: "ap_english_language", subject: "english", year: 11 }),
    course({ kind: "dual", name: "Calculus I", subject: "math", year: 12 }),
    course({ kind: "honors", name: "Honors Chem", subject: "science", year: 11 }),
  ];
  assert.equal(listSuggests(list, 11, "english"), true);
  assert.equal(listSuggests(list, 12, "math"), true);
  assert.equal(listSuggests(list, 11, "science"), false, "honors does not pre-check");
  const r = resolveCore(list, emptyCoreAtTopLevel());
  assert.deepEqual([r[11].english, r[12].math, r[11].science, r[12].english], [true, true, false, false]);
  assert.equal(coreCount(list, emptyCoreAtTopLevel()), 2);
  const mine = sanitizeCoreAtTopLevel({ 11: { english: false, science: true } });
  assert.equal(coreCount(list, mine), 2, "unchecked english, checked science, math from the list");
  assert.equal(resolveCore(list, mine)[11].english, false);
});

test("the core answers alone can read a schedule at a school with no AP in a subject", () => {
  const all: Record<string, boolean> = { english: true, math: true, science: true, history: true, language: true };
  const core = sanitizeCoreAtTopLevel({ 11: all, 12: all });
  const r = reading([course({ kind: "honors", name: "Honors English", subject: "english" })], offering(12), { core });
  assert.equal(r.reading, "most");
  assert.match(sentences(r)[0], /^You've taken or planned 0 of the 12 AP courses your school offers, plus 1 honors course,/);
});

/* ---- The You column ---- */

test("You column: years from the list plus core answers, planned marked, uncountable subjects say so", () => {
  const list = [
    course({ kind: "ap", key: "ap_biology", subject: "science", year: 10 }),
    course({ kind: "ap", key: "ap_chemistry", subject: "science", year: 11 }),
    course({ kind: "ap", key: "ap_physics_1", subject: "science", year: 12, status: "planned" }),
    course({ kind: "honors", name: "Honors English 9", subject: "english", year: 9 }),
  ];
  const core = sanitizeCoreAtTopLevel({ 11: { english: true } });
  const sci = youYears(list, core, "science")!;
  assert.deepEqual(sci, { years: 3, planned: 1 });
  assert.equal(youText(sci), "3 (1 planned)");
  assert.equal(youText({ years: 4, planned: 0 }), "4");
  assert.deepEqual(youYears(list, core, "english"), { years: 2, planned: 0 }, "a 9th grade course and a checked 11th grade year");
  assert.equal(youYears(list, core, "math"), null, "nothing in math: add your courses to compare");
  assert.equal(youYears([], emptyCoreAtTopLevel(), "science"), null);
  // A year with both a planned course and a taken one is firm.
  assert.deepEqual(youYears([...list, course({ kind: "regular", name: "Physics", subject: "science", year: 12 })], core, "science"), { years: 3, planned: 0 });
});

test("the You column and every place that shows a list say 'add your courses to compare' from the catalog", () => {
  assert.equal(noteText({ key: "rigor.you_unknown", values: {} }), "add your courses to compare");
  const table = read("components/school/HsPrepTable.tsx");
  assert.match(table, /rigor\.you_unknown/);
  assert.match(table, /youYears\(/);
  assert.match(read("components/school/HsPrepBox.tsx"), /HsPrepTable/);
});

/* ---- The picker: STEM gate, defaults ---- */

test("regular math and science rows are offered only when the first intended major is math- or science-heavy", () => {
  assert.deepEqual([...STEM_FAMILIES].sort(), ["11", "14", "15", "26", "27", "40", "51"].sort());
  for (const code of STEM_FAMILIES) assert.ok(code in MAJOR_FAMILIES, `${code} is a lib/majors.ts family`);
  assert.equal(isStemMajor(["11"]), true, "computer science");
  assert.equal(isStemMajor(["14", "52"]), true, "engineering first");
  assert.equal(isStemMajor(["52", "14"]), false, "only the first major counts");
  assert.equal(isStemMajor(["23"]), false);
  assert.equal(isStemMajor([]), false);
  assert.equal(isStemMajor(undefined), false);
  const picker = read("components/profile/CoursePicker.tsx");
  assert.match(picker, /const stem = isStemMajor\(majors\)/);
  assert.match(picker, /\{stem && \(/, "the math and science block renders behind the gate");
  assert.match(picker, /Add your other math and science courses/);
});

test("new rows open on the course's usual year and a status that follows from the student's grade", () => {
  assert.equal(usualYear("ap_calculus_bc", 12), 12, "calculus BC for a senior");
  assert.equal(usualYear("ap_calculus_bc", 9), 11, "and the first usual year for a freshman");
  assert.equal(usualYear(null, 10), 10);
  assert.equal(usualYear(null, null), 11);
  assert.equal(defaultStatus(10, 11), "taken");
  assert.equal(defaultStatus(11, 11), "in_progress");
  assert.equal(defaultStatus(12, 11), "planned");
  assert.equal(defaultStatus(12, null), "taken");
  assert.equal(gradeNow(2028, "2026-10-11"), 11, "class of 2028 in fall 2026");
  assert.equal(gradeNow(2028, "2027-05-01"), 11, "and the next spring");
  assert.equal(gradeNow(2028, "2027-09-01"), 12);
  assert.equal(gradeNow(2040, "2026-10-11"), null);
  assert.equal(gradeNow(null, "2026-10-11"), null);
  const c = newCourse({ kind: "ap", key: "ap_biology", grade: 11 });
  assert.deepEqual([c.subject, c.name, c.status, c.exam, c.grades.final], ["science", null, c.year === 11 ? "in_progress" : c.status, null, null]);
  assert.deepEqual(groupByYear([course({ year: 12 }), course({ year: 10 }), course({ kind: "honors", name: "H", year: 10 })]).map((g) => [g.year, g.rows.length, g.rows[0].kind]), [[10, 2, "ap"], [12, 1, "ap"]]);
});

/* ---- Who sees what ---- */

test("a parent sees the list and grades, and exam scores only when the student shares them", () => {
  const list = aps(3, { final: "A", exam: 5 });
  assert.ok(withoutExams(list).every((c) => c.exam === null));
  assert.equal(withoutExams(list)[0].grades.final, "A", "grades stay");
  assert.equal(withoutExams(list).length, 3);
  const load = read("lib/planner/load.ts");
  assert.match(load, /relation === "guardian" && profile\.academics\.apExamsPrivate/, "the plan's loader strips a guardian's copy while private");
  assert.match(load, /withoutExams\(/);
  const numbers = read("components/me/StudentNumbers.tsx");
  assert.match(numbers, /profile\.relation === "guardian" && profile\.data\.academics\.apExamsPrivate/);
});

test("saving as a guardian keeps the student's exam scores and privacy; the student's own post is taken as sent", () => {
  const saved = { courses: aps(2, { final: "A", exam: 5 }), apExamsPrivate: true };
  const posted = { courses: withoutExams(saved.courses), apExamsPrivate: false };
  const asGuardian = mergeCoursesForSave(saved, posted, "guardian");
  assert.deepEqual(asGuardian.courses.map((c) => c.exam), [5, 5], "exam scores put back");
  assert.equal(asGuardian.apExamsPrivate, true, "a parent can't flip the switch");
  const removed = mergeCoursesForSave(saved, { courses: posted.courses.slice(1), apExamsPrivate: true }, "guardian");
  assert.deepEqual(removed.courses.map((c) => c.exam), [5]);
  const added = mergeCoursesForSave(saved, { courses: [...posted.courses, course({ key: AP_KEYS[9] })], apExamsPrivate: true }, "guardian");
  assert.equal(added.courses[2].exam, null, "a parent can't add an exam score");
  const own = mergeCoursesForSave(saved, { courses: [{ ...saved.courses[0], exam: 2 }], apExamsPrivate: false }, "self");
  assert.deepEqual([own.courses[0].exam, own.apExamsPrivate], [2, false]);
  // Shared by the student: a guardian's post is taken as sent.
  const shared = mergeCoursesForSave({ ...saved, apExamsPrivate: false }, { courses: [{ ...saved.courses[0], exam: 3 }], apExamsPrivate: false }, "guardian");
  assert.equal(shared.courses[0].exam, 3);
  // The save paths use it.
  assert.match(read("app/me/actions.ts"), /mergeCoursesForSave\(/);
  assert.match(read("lib/chances/courses-store.ts"), /mergeCoursesForSave\(/);
});

test("a parent reads the same sentences in the third person", () => {
  const list = [...aps(5, { final: "A", exam: 5 }), ...aps(2, { status: "planned", offset: 5 })];
  const all = [
    ...sentences(reading(list, offering(14))),
    ...sentences(reading(aps(2), offering(2))),
    ...sentences(reading(aps(2), offering(14))),
    ...sentences(reading(aps(4, { final: "B-" }), offering(5))),
    ...sentences(reading(aps(3), null)),
    ...offeringLines(offering(14, { source: "profile", ib: true, dual: true })),
  ];
  assert.ok(all.length >= 8);
  for (const t of all) {
    const out = thirdPerson(t, "Maya");
    assert.doesNotMatch(out, /\b[Yy]ou\b|\b[Yy]our\b|\b[Yy]ou've\b/, out);
  }
  assert.equal(thirdPerson("You've taken or planned 6 of your school's 14 AP courses.", "Maya"), "Maya has taken or planned 6 of their school's 14 AP courses.");
  assert.equal(thirdPerson("4s or 5s on 3 of the 4 AP exams you've taken.", null), "4s or 5s on 3 of the 4 AP exams they've taken.");
});

/* ---- The school's offering lines ---- */

test("the offering in sentences: by source, with IB and dual enrollment named", () => {
  assert.deepEqual(offeringLines(offering(14, { source: "profile", field: "detail.ap_courses" })), ["Your school's profile lists 14 AP courses."]);
  assert.deepEqual(offeringLines(offering(9, { ib: true, dual: true })), ["Your school offers 9 AP courses.", "IB and dual enrollment are offered too."]);
  assert.deepEqual(offeringLines(offering(0, { dual: true })), ["Your school doesn't offer AP courses.", "dual enrollment is offered too."]);
  assert.deepEqual(offeringLines(offering(null)), ["We don't have a course list for your school yet."]);
  assert.deepEqual(offeringLines(offering(6, { source: "pooled", field: null })), ["Students at your school have listed these."]);
});

/* ---- The proprietary rule: nothing from the rules reaches a client ---- */

/** Every source file under dir, as path -> text. */
function walk(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|mts)$/.test(name)) out.set(rel, read(rel));
  }
  return out;
}

/**
 * Files a client bundle can reach that are in `forbidden`: starting from every "use client" file, follow its
 * relative and `@/` imports, but stop at "use server" modules (the browser gets a call stub, not their imports).
 * Returns "chain" strings for each forbidden file reached.
 */
function reachedFromClient(files: Map<string, string>, forbidden: string[]): string[] {
  const resolveImport = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = spec.slice(2);
    else if (spec.startsWith(".")) base = relative(ROOT, resolve(ROOT, dirname(from), spec));
    else return null;
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts"), join(base, "index.tsx"), base.replace(/\.js$/, ".ts")]) if (files.has(cand)) return cand;
    return null;
  };
  const found: string[] = [];
  let seen = new Set<string>();
  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = files.get(file) ?? "";
    if (/^\s*["']use server["']/.test(text)) return;
    if (forbidden.includes(file)) found.push([...chain, file].join(" -> "));
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveImport(file, m[1] ?? m[2] ?? m[3]);
      if (target) visit(target, [...chain, file]);
    }
  };
  for (const [file, text] of files) {
    if (!/^\s*["']use client["']/.test(text)) continue;
    seen = new Set();
    visit(file, []);
  }
  return found;
}

const SERVER_ONLY_FILES = ["lib/chances/rigor-rules.ts", "lib/chances/rigor.ts", "lib/chances/rigor-server.ts"];

test("no client component reaches the rigor rules, the reading, or the code that builds it", () => {
  const files = new Map([...walk("components"), ...walk("app"), ...walk("lib")]);
  for (const f of SERVER_ONLY_FILES) assert.ok(files.has(f), f);
  assert.deepEqual(reachedFromClient(files, SERVER_ONLY_FILES), []);
});

test("the guard catches a client file that imports the rules, directly or through a helper", () => {
  const files = new Map<string, string>([
    ["lib/chances/rigor-rules.ts", 'import "server-only";\nexport const X = 1;'],
    ["lib/chances/helper.ts", 'import { X } from "./rigor-rules.ts";\nexport const Y = X;'],
    ["components/a/Direct.tsx", '"use client";\nimport { X } from "@/lib/chances/rigor-rules";\nexport const D = X;'],
    ["components/a/Indirect.tsx", '"use client";\nimport { Y } from "../../lib/chances/helper.ts";\nexport const I = Y;'],
    ["components/a/Fine.tsx", '"use client";\nexport const F = 1;'],
    ["lib/chances/store.ts", '"use server";\nimport { X } from "./rigor-rules.ts";\nexport async function f() { return X; }'],
    ["components/a/ViaAction.tsx", '"use client";\nimport { f } from "@/lib/chances/store";\nexport const V = f;'],
  ]);
  const found = reachedFromClient(files, ["lib/chances/rigor-rules.ts"]);
  assert.equal(found.length, 2);
  assert.ok(found.some((c) => c.startsWith("components/a/Direct.tsx")));
  assert.ok(found.some((c) => c.startsWith("components/a/Indirect.tsx")));
  assert.ok(!found.some((c) => c.includes("ViaAction")), "a Server Action's imports stay on the server");
});

test("the rules and the reading are server-only; only the reading imports the rules, and only the view builder imports the reading", () => {
  for (const f of SERVER_ONLY_FILES) assert.match(read(f), /^import "server-only";/m, f);
  const users = [...walk("components"), ...walk("app"), ...walk("lib")].filter(([f, t]) => /rigor-rules/.test(t) && f !== "lib/chances/rigor-rules.ts" && !/tests\//.test(f)).map(([f]) => f);
  // The course plan's grades test is the reading's own "strong" line (method/rigor-reading.md "Grades"), so its rules file reads it too.
  assert.deepEqual(users, ["lib/chances/course-plan-rules.ts", "lib/chances/rigor.ts"], "only the reading and the course plan's rules import the rules");
  const consumers = [...walk("components"), ...walk("app"), ...walk("lib")].filter(([f, t]) => /chances\/rigor["'.]|\.\/rigor["'.]/.test(t) && f !== "lib/chances/rigor.ts").map(([f]) => f);
  // The course plan's builder reads the reading too (its "already as demanding as allowed" guardrail and "what it changes" line).
  assert.deepEqual(consumers.sort(), ["lib/chances/course-plan-server.ts", "lib/chances/rigor-server.ts"]);
});

test("none of the rigor components or notes spells a threshold or a constant of the rules", () => {
  const files = [
    "components/profile/CoursePicker.tsx",
    "components/profile/CourseRow.tsx",
    "components/profile/CoreSubjects.tsx",
    "components/profile/LocalCoursesSheet.tsx",
    "components/school/RigorLine.tsx",
    "components/school/HsPrepTable.tsx",
    "components/planner/CoursesSection.tsx",
    "components/planner/PlanCoursesSheet.tsx",
    "components/high-schools/MyCoursesLine.tsx",
    "lib/chances/courses.ts",
    "lib/chances/rigor-view.ts",
  ];
  for (const f of files) {
    const text = read(f);
    assert.doesNotMatch(text, /RIGOR_RULES|reachableCap|shareMost|shareMuch|coreMost|coreMuch|strongAdvancedGpa|fewOfferedMax|weakFinalPoints|rigor-rules/, f);
    assert.doesNotMatch(text, /\b3\.3\b|STRONG/, `${f} names no strong-grades cutoff`);
  }
});
