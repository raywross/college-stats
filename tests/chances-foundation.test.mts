/**
 * The admission-chances foundation (specs/chances/; lib/chances/types.ts, catalog.ts, offering.ts, notes.ts,
 * guaranteed.ts, major-admission.ts; the course list in lib/student-profile.ts): course sanitizing and the count-only
 * placeholders, advancedGpa and subjectGpa, the school's offering source order, the catalogs and curated files (each
 * validator accepts the real file and refuses each broken rule), their citations, the note catalog, the glossary
 * terms, and CRDC's "No" stored as 0. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { DatasetMeta, School } from "../lib/types";
import type { HighSchoolDetail } from "../lib/high-school-types";
import * as typesModule from "../lib/chances/types.ts";
import {
  advancedGpa,
  COURSES_MAX,
  courseMark,
  courseRigorCountOf,
  emptyProfile,
  isPlaceholderCourse,
  markPoints,
  reconcileCourseCount,
  sanitizeCourses,
  sanitizeProfile,
  subjectGpa,
} from "../lib/student-profile.ts";
import { AP_CATALOG, IB_CATALOG, apKeysForName, catalogCourse, isCatalogKeyFor, validateCatalogs, type CatalogFile } from "../lib/chances/catalog.ts";
import { profileApList, schoolOffering } from "../lib/chances/offering.ts";
import { INPUT_WORDS, NOTES, isNoteKey, noteText } from "../lib/chances/notes.ts";
import { currentCycle, guaranteedPrograms, programsFor, validateGuaranteed, type GuaranteedFile } from "../lib/chances/guaranteed.ts";
import { majorUnitFor, majorUnitsFor, universityStatement, validateMajorAdmission, type MajorAdmissionFile } from "../lib/chances/major-admission.ts";
import { FIELDS, type FieldPath } from "../lib/fields.ts";
import { lineageFor, sourcesForFields, validateRegistry } from "../lib/lineage.ts";
import { GLOSSARY, isTermKey } from "../lib/glossary.ts";
import { buildCrdcPatch } from "../scripts/lib/high-schools/crdc.mts";

const ROOT = join(import.meta.dirname, "..");
const readJson = <T,>(...p: string[]): T => JSON.parse(readFileSync(join(ROOT, ...p), "utf8")) as T;
const meta = readJson<DatasetMeta>("data", "meta.json");
const schools = readJson<School[]>("data", "schools.json");
const known = new Set(schools.map((s) => s.unit_id));
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const runScript = (name: string) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", name)], { encoding: "utf8" });

/** A course row with defaults. */
function row(o: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "r", kind: "ap", key: "ap_biology", name: null, subject: "science", year: 11, status: "taken", grades: { s1: null, s2: null, final: null }, exam: null, ...o };
}

/* ---- Types ---- */

test("lib/chances/types.ts is types only: nothing runs, nothing ships but types", () => {
  // With every export erased, Node loads the file as an empty CommonJS module: only an empty `default`.
  const mod = typesModule as Record<string, unknown>;
  assert.deepEqual(Object.keys(mod).filter((k) => k !== "default"), []);
  assert.deepEqual(Object.keys((mod.default as object | undefined) ?? {}), []);
});

/* ---- The course list: sanitizing ---- */

test("sanitizeCourses: AP and IB keys must be in the catalog for their kind; dual, honors, and regular need a name", () => {
  const out = sanitizeCourses([
    row({ id: "a" }),
    row({ id: "b", key: "ap_not_a_course" }),
    row({ id: "c", kind: "ib_hl", key: "ib_biology_hl" }),
    row({ id: "d", kind: "ib_hl", key: "ib_biology_sl" }),
    row({ id: "e", kind: "ap", key: "ib_chemistry_hl" }),
    row({ id: "f", kind: "dual", key: null, name: "Calculus I at the community college", subject: "math" }),
    row({ id: "g", kind: "honors", key: null, name: null, subject: "english" }),
    row({ id: "h", kind: "honors", key: null, name: "x".repeat(61), subject: "english" }),
    row({ id: "i", kind: "regular", key: null, name: "Algebra II", subject: "math" }),
    row({ id: "j", kind: "regular", key: null, name: "US History", subject: "history" }),
    row({ id: "k", kind: "bogus" }),
    row({ id: "l", year: 8 }),
    row({ id: "m", status: "maybe" }),
  ]);
  assert.deepEqual(
    out.map((c) => c.id),
    ["a", "c", "f", "i"],
  );
  assert.equal(out[0].subject, "science", "AP rows take the catalog's subject");
  assert.equal(out[2].key, null, "dual has no key");
  assert.equal(out[2].name, "Calculus I at the community college");
  assert.equal(isCatalogKeyFor("ib_sl", "ib_biology_sl"), true);
  assert.equal(isCatalogKeyFor("ib_hl", "ib_biology_sl"), false);
});

test("sanitizeCourses: a planned course has no final grade and no exam; exams are AP only; marks are checked", () => {
  const [planned, ib, taken] = sanitizeCourses([
    row({ id: "p", status: "planned", grades: { s1: "A", s2: null, final: "A" }, exam: 5 }),
    row({ id: "q", kind: "ib_sl", key: "ib_history_sl", exam: 4, grades: { s1: "Z", s2: "B+", final: null } }),
    row({ id: "t", key: "ap_chemistry", exam: 4, grades: { s1: "A-", s2: "B", final: "A" } }),
  ]);
  assert.equal(planned.grades.final, null);
  assert.equal(planned.exam, null);
  assert.equal(ib.exam, null, "IB has no AP exam score");
  assert.deepEqual(ib.grades, { s1: null, s2: "B+", final: null }, "an unknown mark is dropped");
  assert.equal(taken.exam, 4);
  assert.deepEqual(taken.grades, { s1: "A-", s2: "B", final: "A" });
});

test("sanitizeCourses: at most 40 rows, a catalog course listed once, ids unique, the subject from the catalog", () => {
  const many = Array.from({ length: 60 }, (_, i) => row({ id: `h${i}`, kind: "honors", key: null, name: `Honors ${i}`, subject: "english" }));
  assert.equal(sanitizeCourses(many).length, COURSES_MAX);
  const dup = sanitizeCourses([row({ id: "x" }), row({ id: "x", key: "ap_biology", year: 12 }), row({ id: "x", key: "ap_chemistry", subject: "arts" })]);
  assert.deepEqual(
    dup.map((c) => [c.id, c.key, c.subject]),
    [
      ["x", "ap_biology", "science"],
      ["x-2", "ap_chemistry", "science"],
    ],
  );
  assert.deepEqual(sanitizeCourses("nope"), []);
});

test("a profile saved before the list: its count becomes that many unnamed AP rows, and the count is derived from rows", () => {
  const legacy = sanitizeProfile({ academics: { gpa: 3.8, courseRigorCount: 5 } });
  assert.equal(legacy.academics.courses.length, 5);
  assert.ok(legacy.academics.courses.every(isPlaceholderCourse));
  assert.equal(legacy.academics.courseRigorCount, 5);
  // Saving it again changes nothing (the derived count matches the rows).
  assert.deepEqual(sanitizeProfile(legacy), legacy);
  // No count and no list: nothing.
  const empty = sanitizeProfile({ academics: { gpa: 3.8 } });
  assert.deepEqual(empty.academics.courses, []);
  assert.equal(empty.academics.courseRigorCount, null);
  assert.equal(empty.academics.apExamsPrivate, true, "exam scores are private by default");
  assert.equal(sanitizeProfile({ academics: { apExamsPrivate: false } }).academics.apExamsPrivate, false);
  assert.deepEqual(emptyProfile().academics.courses, []);
});

test("the count-only entry: a new count adds or removes unnamed rows, never named ones", () => {
  const named = sanitizeCourses([row({ id: "a" }), row({ id: "b", key: "ap_chemistry" }), row({ id: "h", kind: "honors", key: null, name: "Honors English", subject: "english" })]);
  const up = reconcileCourseCount(named, 4);
  assert.equal(courseRigorCountOf(up), 4);
  assert.equal(up.filter(isPlaceholderCourse).length, 2);
  const down = reconcileCourseCount(up, 3);
  assert.equal(down.filter(isPlaceholderCourse).length, 1);
  const floor = reconcileCourseCount(up, 0);
  assert.deepEqual(
    floor.map((c) => c.id),
    ["a", "b", "h"],
    "named rows stay even below the count",
  );
  // Through sanitizeProfile: the list plus a matching count is left alone; a count of null leaves the rows as they are.
  const p = sanitizeProfile({ academics: { courses: named, courseRigorCount: 2 } });
  assert.equal(p.academics.courses.length, 3);
  assert.equal(p.academics.courseRigorCount, 2, "honors isn't counted");
  assert.equal(sanitizeProfile({ academics: { courses: named, courseRigorCount: null } }).academics.courses.length, 3);
  // An empty list (the student removed everything) stays empty: placeholders come only from a count.
  assert.deepEqual(sanitizeProfile({ academics: { courses: [], courseRigorCount: null } }).academics.courses, []);
});

/* ---- The course list: helpers ---- */

test("markPoints and courseMark: the 4.0 scale, P ignored; the final grade, else the latest semester", () => {
  const expected: [string, number | null][] = [
    ["A+", 4.0], ["A", 4.0], ["A-", 3.7], ["B+", 3.3], ["B", 3.0], ["B-", 2.7], ["C+", 2.3], ["C", 2.0], ["C-", 1.7], ["D+", 1.3], ["D", 1.0], ["D-", 0.7], ["F", 0], ["P", null],
  ];
  for (const [m, pts] of expected) assert.equal(markPoints(m as never), pts, m);
  assert.equal(markPoints(null), null);
  assert.equal(courseMark({ grades: { s1: "B", s2: "A-", final: "A" } }), "A");
  assert.equal(courseMark({ grades: { s1: "B", s2: "A-", final: null } }), "A-");
  assert.equal(courseMark({ grades: { s1: "B", s2: null, final: null } }), "B");
  assert.equal(courseMark({ grades: { s1: null, s2: null, final: null } }), null);
});

test("advancedGpa: AP, IB, and dual only; final else latest semester; P ignored; null with no grades", () => {
  const courses = sanitizeCourses([
    row({ id: "1", grades: { s1: "B", s2: null, final: "A" } }), // 4.0
    row({ id: "2", key: "ap_chemistry", status: "in_progress", grades: { s1: "B+", s2: null, final: null } }), // 3.3
    row({ id: "3", kind: "dual", key: null, name: "Calc I", subject: "math", grades: { s1: null, s2: null, final: "A-" } }), // 3.7
    row({ id: "4", kind: "ib_sl", key: "ib_history_sl", grades: { s1: null, s2: null, final: "P" } }), // ignored
    row({ id: "5", kind: "honors", key: null, name: "Honors English", subject: "english", grades: { s1: null, s2: null, final: "C" } }), // not advanced
    row({ id: "6", key: "ap_statistics", status: "planned" }), // no grade
  ]);
  assert.equal(advancedGpa(courses), 3.67);
  assert.equal(advancedGpa([]), null);
  assert.equal(advancedGpa(sanitizeCourses([row({ status: "planned" })])), null);
});

test("subjectGpa: every row in the subject, advanced, honors, and regular together", () => {
  const courses = sanitizeCourses([
    row({ id: "1", key: "ap_calculus_ab", grades: { s1: null, s2: null, final: "A" } }),
    row({ id: "2", kind: "regular", key: null, name: "Algebra II", subject: "math", grades: { s1: null, s2: null, final: "B" } }),
    row({ id: "3", kind: "honors", key: null, name: "Honors Geometry", subject: "math", grades: { s1: "B+", s2: null, final: null } }),
    row({ id: "4", key: "ap_physics_1", grades: { s1: null, s2: null, final: "C+" } }),
  ]);
  assert.equal(subjectGpa(courses, "math"), 3.43);
  assert.equal(subjectGpa(courses, "science"), 2.3);
  assert.equal(subjectGpa(courses, "english"), null);
});

/* ---- The school's offering ---- */

const DETAIL = readJson<HighSchoolDetail>("data", "high-schools", "detail", "362505003470.json");
const rigor = (o: Partial<NonNullable<School["admissions"]>> & Record<string, number | null> = {}) => ({
  rigor: { ap_courses: 14, ap_enrolled: 300, ap_exam_takers: null, ap_passed_some: null, ib_enrolled: null, dual_enrolled: 40, enrollment: 1500, ...o },
});

test("schoolOffering: the profile's list first, then the pooled list, the student's marks, the CRDC count, nothing", () => {
  const school = rigor();
  const profile = schoolOffering({ school, detail: DETAIL, studentMarks: ["ap_biology"] }, ["ap_latin"]);
  assert.equal(profile.source, "profile");
  assert.equal(profile.field, "detail.ap_courses");
  assert.ok(profile.apKeys!.includes("ap_calculus_bc") && profile.apKeys!.includes("ap_physics_2"));
  const pooled = schoolOffering({ school, detail: { ap_courses: null, ib_courses: null }, studentMarks: ["ap_biology"] }, ["ap_latin", "ap_seminar", "ib_biology_hl", "nope"]);
  assert.deepEqual([pooled.source, pooled.apCount, pooled.apKeys, pooled.field], ["pooled", 2, ["ap_latin", "ap_seminar"], null]);
  const marks = schoolOffering({ school, studentMarks: ["ap_biology", "ap_biology"] }, []);
  assert.deepEqual([marks.source, marks.apCount, marks.apKeys], ["student", 1, ["ap_biology"]]);
  const crdc = schoolOffering({ school }, null);
  assert.deepEqual([crdc.source, crdc.apCount, crdc.apKeys, crdc.field], ["crdc", 14, null, "rigor.ap_courses"]);
  const none = schoolOffering({ school: rigor({ ap_courses: 0, ap_enrolled: 0 }) });
  assert.deepEqual([none.source, none.apCount], ["crdc", 0], "a school that offers no AP reads 0, not unknown");
  const unknown = schoolOffering({ school: rigor({ ap_courses: null }) });
  assert.deepEqual([unknown.source, unknown.apCount, unknown.dual], [null, null, true]);
  assert.deepEqual(schoolOffering(null), { apCount: null, apKeys: null, ib: null, dual: null, source: null, field: null });
});

test("schoolOffering: IB from the profile's list, else CRDC; dual enrollment from CRDC (0 is 'not offered')", () => {
  assert.equal(schoolOffering({ school: rigor({ ib_enrolled: null }), detail: { ap_courses: null, ib_courses: ["Biology HL"] } }).ib, true);
  assert.equal(schoolOffering({ school: rigor({ ib_enrolled: 25 }) }).ib, true);
  assert.equal(schoolOffering({ school: rigor({ ib_enrolled: 0, dual_enrolled: 0 }) }).ib, false);
  assert.equal(schoolOffering({ school: rigor({ dual_enrolled: 0 }) }).dual, false);
  assert.equal(schoolOffering({ school: null }).dual, null);
});

test("a profile's printed AP names match catalog keys; a combined line is two courses; a variant is the course", () => {
  assert.deepEqual(apKeysForName("Calculus AB"), ["ap_calculus_ab"]);
  assert.deepEqual(apKeysForName("AP Calculus BC"), ["ap_calculus_bc"]);
  assert.deepEqual(apKeysForName("Physics 1 & 2"), ["ap_physics_1", "ap_physics_2"]);
  assert.deepEqual(apKeysForName("Physics C E & M"), ["ap_physics_c_electricity_and_magnetism"]);
  assert.deepEqual(apKeysForName("2D Art and Design (Photo)"), ["ap_2d_art_and_design"]);
  assert.deepEqual(apKeysForName("Pre-Calculus"), ["ap_precalculus"]);
  assert.deepEqual(apKeysForName("Underwater Basket Weaving"), []);
  // The pilot school's real list: every printed name is recognized, and duplicates count once.
  const list = profileApList(DETAIL.ap_courses!);
  for (const n of DETAIL.ap_courses!) assert.ok(apKeysForName(n).length > 0, `unrecognized: ${n}`);
  assert.equal(list.count, list.keys.length);
  assert.equal(list.keys.length, 27, "27 printed lines: Physics 1 & 2 is two, the two 2-D lines are one");
});

/* ---- The catalogs ---- */

test("the AP catalog has every current course, including the new ones, and the real files pass the check", () => {
  assert.deepEqual(validateCatalogs(AP_CATALOG, IB_CATALOG), []);
  assert.equal(AP_CATALOG.courses.length, 42);
  for (const key of ["ap_precalculus", "ap_african_american_studies", "ap_business_personal_finance", "ap_cybersecurity", "ap_seminar", "ap_research"]) assert.ok(catalogCourse(key), key);
  // The sequences the course plan reads.
  assert.ok(catalogCourse("ap_precalculus")!.next.includes("ap_calculus_ab"));
  assert.ok(catalogCourse("ap_calculus_ab")!.next.includes("ap_calculus_bc"));
  assert.ok(catalogCourse("ap_physics_1")!.next.includes("ap_physics_c_mechanics"));
  assert.ok(catalogCourse("ap_english_language")!.next.includes("ap_english_literature"));
  assert.ok(catalogCourse("ap_computer_science_principles")!.next.includes("ap_computer_science_a"));
  assert.ok(IB_CATALOG.courses.every((c) => c.key.endsWith(`_${c.level}`)));
  const r = runScript("check-course-catalog.mts");
  assert.equal(r.status, 0, r.stderr);
});

test("the catalog check refuses each broken rule", () => {
  const broken = (edit: (ap: CatalogFile, ib: CatalogFile) => void) => {
    const ap = clone(AP_CATALOG);
    const ib = clone(IB_CATALOG) as CatalogFile;
    edit(ap, ib);
    return validateCatalogs(ap, ib);
  };
  const cases: [string, (ap: CatalogFile, ib: CatalogFile) => void, RegExp][] = [
    ["duplicate key", (ap) => ap.courses.push(clone(ap.courses[0])), /duplicate key/],
    ["bad key prefix", (ap) => (ap.courses[0].key = "ib_drawing"), /key must be "ap_"/],
    ["unknown subject", (ap) => ((ap.courses[0] as { subject: string }).subject = "gym"), /subject "gym"/],
    ["next doesn't resolve", (ap) => ap.courses[0].next.push("ap_time_travel"), /next "ap_time_travel"/],
    ["next is itself", (ap) => ap.courses[0].next.push(ap.courses[0].key), /names the course itself/],
    ["prereq is neither", (ap) => ap.courses[0].prereqs.push("algebra"), /prereq "algebra"/],
    ["unknown major family", (ap) => ap.courses[0].majors.push("99"), /major "99"/],
    ["grades out of range", (ap) => (ap.courses[0].grades = [8]), /grades/],
    ["http page", (ap) => (ap.courses[0].url = "http://example.com"), /https/],
    ["IB level doesn't match key", (_ap, ib) => ((ib.courses[0] as unknown as { level: string }).level = "sl"), /must end in "_sl"/],
    ["no editorial note", (ap) => (ap.editorial = ""), /editorial/],
  ];
  for (const [what, edit, re] of cases) {
    const errors = broken(edit);
    assert.ok(errors.some((e) => re.test(e)), `${what}: ${errors.join("; ")}`);
  }
});

/* ---- Automatic admission ---- */

const GUARANTEED = readJson<GuaranteedFile>("data", "guaranteed-admission.json");
const TODAY = new Date("2026-10-11T12:00:00Z");

test("the guaranteed-admission file passes its check; UT Austin's top 5% applies for the file's cycle", () => {
  assert.deepEqual(validateGuaranteed(GUARANTEED, TODAY, known), []);
  const r = runScript("check-guaranteed-admission.mts");
  assert.equal(r.status, 0, r.stderr);
  const ut = programsFor("228778");
  assert.equal(ut.length, 1);
  assert.equal(ut[0].rule.class_rank_top_pct, 5);
  assert.equal(ut[0].major_guaranteed, false);
  assert.ok(guaranteedPrograms().every((p) => p.fall.includes(GUARANTEED.cycle)));
  assert.equal(currentCycle(new Date("2026-10-11T00:00:00Z")), 2027);
  assert.equal(currentCycle(new Date("2027-03-01T00:00:00Z")), 2027);
  assert.equal(currentCycle(new Date("2027-08-01T00:00:00Z")), 2028);
});

test("the guaranteed-admission check refuses each broken rule, including a past cycle", () => {
  const broken = (edit: (f: GuaranteedFile) => void, today = TODAY) => {
    const f = clone(GUARANTEED);
    edit(f);
    return validateGuaranteed(f, today, known);
  };
  assert.ok(broken(() => {}, new Date("2027-09-01T00:00:00Z")).some((e) => /current or next entering fall/.test(e)), "a year later, the file is stale");
  const cases: [string, (f: GuaranteedFile) => void, RegExp][] = [
    ["a program's falls are past", (f) => (f.programs[0].fall = [2026]), /not the file's cycle/],
    ["unknown college", (f) => (f.programs[0].unit_ids = ["999999"]), /isn't a college in the dataset/],
    ["no threshold", (f) => (f.programs[0].rule = { ...f.programs[0].rule, class_rank_top_pct: null, gpa_min: null }), /threshold/],
    ["threshold not in the quote", (f) => (f.programs[0].rule.class_rank_top_pct = 6), /doesn't appear in the quote/],
    ["no quote", (f) => (f.programs[0].source.quote = ""), /quote/],
    ["http source", (f) => (f.programs[0].source.url = "http://tea.texas.gov/x.pdf"), /https/],
    ["bad scope", (f) => ((f.programs[0] as { scope: string }).scope = "state"), /scope/],
    ["duplicate id", (f) => f.programs.push(clone(f.programs[0])), /duplicate id/],
    ["bad date", (f) => (f.programs[0].source.retrieved = "2026-02-30"), /retrieved/],
  ];
  for (const [what, edit, re] of cases) {
    const errors = broken(edit);
    assert.ok(errors.some((e) => re.test(e)), `${what}: ${errors.join("; ")}`);
  }
});

/* ---- Major admission ---- */

const MAJOR = readJson<MajorAdmissionFile>("data", "major-admission.json");

test("the major-admission file passes its check; Cornell Engineering's required courses are quoted", () => {
  assert.deepEqual(validateMajorAdmission(MAJOR, known), []);
  const r = runScript("check-major-admission.mts");
  assert.equal(r.status, 0, r.stderr);
  const units = majorUnitsFor("190415");
  assert.equal(units.length, 1);
  assert.deepEqual(
    units[0].review!.required_courses.map((c) => c.level),
    ["calculus", "physics", "chemistry"],
  );
  assert.equal(majorUnitFor("190415", "14")?.unit_id, "190415:engineering");
  assert.equal(majorUnitFor("190415", "23"), null);
  assert.equal(universityStatement("190415"), null);
});

test("the major-admission check refuses each broken rule", () => {
  const unit = MAJOR.units[0];
  const withGate = (any_of: unknown[], quote = "SAT Math 620 or ACT Math 26 or AP Calculus 3") => ({ ...clone(unit), review: { ...clone(unit.review!), quote, gate: { any_of } } });
  const broken = (units: unknown[]) => validateMajorAdmission({ checked: "2026-10-11", units } as MajorAdmissionFile, known);
  const cases: [string, unknown, RegExp][] = [
    ["gate number not in the quote", withGate([{ kind: "sat_math", min: 640 }]), /must appear in the review quote/],
    ["gate course not in the catalog", withGate([{ kind: "ap", course: "ap_calculus", min: 3 }]), /AP catalog key/],
    ["gate score out of range", withGate([{ kind: "act_math", min: 40 }], "ACT Math 40"), /1–36/],
    ["university with a slug", { ...clone(unit), unit: "university", cip_families: [] }, /bare IPEDS id/],
    ["school without a slug", { ...clone(unit), unit_id: "190415" }, /needs ":slug"/],
    ["unknown college", { ...clone(unit), unit_id: "999999:engineering" }, /isn't a college in the dataset/],
    ["unknown CIP family", { ...clone(unit), cip_families: ["99"] }, /cip family/],
    ["admitted above applied", { ...clone(unit), admit_rate: { admitted: 500, applied: 400, year: "Fall 2025", quote: "500 of 400", source_url: "https://example.edu" } }, /above applied/],
    ["counts not in the quote", { ...clone(unit), admit_rate: { admitted: 400, applied: 1500, year: "Fall 2025", quote: "about a quarter", source_url: "https://example.edu" } }, /counts must appear/],
    ["emphasis without pool_and_emphasis", { ...clone(unit), review: { ...clone(unit.review!), emphasis: ["math"] } }, /pool_and_emphasis/],
    ["required course without a quote", { ...clone(unit), review: { ...clone(unit.review!), required_courses: [{ subject: "math", level: "calculus", quote: "" }] } }, /needs its quote/],
    ["nothing quoted", { ...clone(unit), review: null, admit_rate: null }, /needs a review or an admit rate/],
    ["duplicate unit", [clone(unit), clone(unit)], /duplicate unit_id/],
  ];
  for (const [what, u, re] of cases) {
    const errors = broken(Array.isArray(u) ? u : [u]);
    assert.ok(errors.some((e) => re.test(e)), `${what}: ${errors.join("; ")}`);
  }
  // A gate whose numbers are all quoted passes.
  assert.deepEqual(broken([withGate([{ kind: "sat_math", min: 620 }, { kind: "act_math", min: 26 }, { kind: "ap", course: "ap_calculus_ab", min: 3 }])]), []);
});

/* ---- Citations ---- */

const PROGRAM_PATHS: FieldPath[] = ["reference.guaranteed_admission.rule", "reference.guaranteed_admission.scope", "reference.guaranteed_admission.major_guaranteed"];
const MAJOR_PATHS: FieldPath[] = [
  "reported.major_admission.direct_admit",
  "reported.major_admission.review.major_considered",
  "reported.major_admission.review.emphasis",
  "reported.major_admission.review.required_courses",
  "reported.major_admission.review.gate",
];

test("program and major-admission fields are registered; citing them resolves to the curated entry's own source and words", () => {
  assert.deepEqual(validateRegistry(meta), []);
  for (const p of [...PROGRAM_PATHS, ...MAJOR_PATHS, "reported.major_admission.admit_rate" as FieldPath]) assert.equal(FIELDS[p].source, "college-site", p);
  const ut = byId.get("228778")!;
  const program = programsFor("228778")[0];
  for (const p of PROGRAM_PATHS) {
    const c = lineageFor(p, ut, meta);
    assert.equal(c.url, program.source.url, p);
    assert.equal(c.retrieved, program.source.retrieved, p);
    assert.equal(c.year, "Fall 2027", p);
    assert.equal(c.quote, program.source.quote, p);
  }
  const cornell = byId.get("190415")!;
  const unit = majorUnitsFor("190415")[0];
  for (const p of MAJOR_PATHS) {
    const c = lineageFor(p, cornell, meta);
    assert.equal(c.url, unit.review!.source_url, p);
    assert.equal(c.retrieved, unit.review!.fetched, p);
    assert.equal(c.quote, unit.review!.quote, p);
  }
  assert.equal(sourcesForFields(MAJOR_PATHS, cornell, meta).length, 1);
  // Cornell publishes no engineering admit rate: nothing to cite. A college with no entries has nothing either.
  assert.deepEqual(sourcesForFields(["reported.major_admission.admit_rate"], cornell, meta), []);
  const other = byId.get("145637")!;
  assert.deepEqual(sourcesForFields([...PROGRAM_PATHS, ...MAJOR_PATHS], other, meta), []);
});

/* ---- Notes ---- */

test("the note catalog: every sentence fills from its values, unknown keys give nothing, no placeholder left behind", () => {
  const values = { taken: 6, offered: 14, gpa: "3.82", count: 4, a: 5, finished: 6, high: 3, college: "Purdue", rating: "very important", share: "71%", program: "Texas automatic admission", pct: "5%", system: "UC", unit: "Engineering", state: "Indiana", rate: "71%", year: "fall 2025", ed: "18%", overall: "6%", applicants: "engineering", subjects: "math and science", yours: "math 3.9, science 3.7", course: "a year of physics", subject: "math", major: "engineering", route: "AP Calculus (4)", routes: "SAT Math 620+, ACT Math 26+", alternate: "a second-choice major", colleges: "Illinois and Purdue", courses: "calculus, physics", position: "in the middle of admitted students", pool: "applicants from Indiana were admitted at 71%", test: "SAT", input: "class rank", list: "GPA 3.85 · SAT 1300", score: 1350, group: "Target", from: "Target", to: "Likely" };
  for (const [key, fn] of Object.entries(NOTES)) {
    const text = fn(values);
    assert.ok(text.trim().length > 0, key);
    assert.ok(!/undefined|\$\{|\{\w+\}/.test(text), `${key}: ${text}`);
  }
  assert.equal(noteText({ key: "rigor.much", values: { taken: 6, offered: 14 } }), "You've taken or planned 6 of your school's 14 AP courses.");
  assert.equal(noteText({ key: "rigor.few_offered", values: { offered: 2 } }), "Your school offers 2 AP courses and you've taken both. Colleges read rigor against what your school offers; your counselor's report says so.");
  assert.equal(noteText({ key: "offering.profile", values: { count: 1 } }), "Your school's profile lists 1 AP course.");
  assert.equal(noteText({ key: "no.such.key", values: {} }), "");
  assert.equal(isNoteKey("estimate.label"), true);
  assert.ok(Object.keys(INPUT_WORDS).length === 10);
});

/* ---- Glossary ---- */

test("the chances glossary terms exist, link to real terms, and state no method", () => {
  for (const key of ["gpa-crowding", "course-rigor", "major-review", "direct-admit", "quads-estimate", "automatic-admission", "holistic-admission"]) {
    assert.ok(isTermKey(key), key);
    const e = GLOSSARY[key];
    for (const r of e.related ?? []) assert.ok(isTermKey(r), `${key} → ${r}`);
    // No percentage cutoffs or weights from specs/chances/method/ (the 3.75 band edge and Texas's 10% law are public facts).
    const text = `${e.short} ${e.long ?? ""} ${e.why ?? ""}`;
    assert.ok(!/\b(20|50|60|70)%|threshold|weight(ed|s)? (of|by)|3\.3\b|RIGOR_CAN_LOWER|REACHABLE_CAP/.test(text), `${key}: ${text}`);
  }
});

/* ---- CRDC "No" → 0 ---- */

test('CRDC: a school that answered "No" to AP or IB stores an explicit 0; -9 stays missing', () => {
  const no = buildCrdcPatch("x", { ap: { SCH_APENR_IND: "No", SCH_APCOURSES: "-9", TOT_APENR_M: "-9", TOT_APENR_F: "-9" }, ib: { SCH_IBENR_IND: "No" } })!;
  assert.equal(no.values.rigor?.ap_courses, 0);
  assert.equal(no.values.rigor?.ap_enrolled, 0);
  assert.equal(no.values.rigor?.ib_enrolled, 0);
  assert.equal(no.suppressed, undefined);
  const notReported = buildCrdcPatch("x", { ap: { SCH_APENR_IND: "-9", SCH_APCOURSES: "-9", TOT_APENR_M: "-9", TOT_APENR_F: "-9" }, ib: { SCH_IBENR_IND: "-9" } })!;
  assert.equal(notReported.values.rigor?.ap_courses, null);
  assert.equal(notReported.values.rigor?.ib_enrolled, null);
  // And the offering reads the 0 as "offers none".
  assert.deepEqual(schoolOffering({ school: { rigor: no.values.rigor! } }).apCount, 0);
});
