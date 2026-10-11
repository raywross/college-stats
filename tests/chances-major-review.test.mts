/**
 * How the major is read (specs/chances/major-and-grades.md; lib/chances/major-review.ts): each `review` kind's notes
 * ("no" quoted, a unit's pool, a university-level pool, pool and emphasis with and without subject grades), required
 * courses checked against the course list (planned counts; a missing one is named; "Pre-Calculus" isn't calculus), a
 * gate met by an exam, by a section score, not yet met, pending, and closed, undecided, no major, no review at all,
 * every note rendering and citing a registered field, and the major-admission check's `published_rate` rules (each
 * broken on purpose). Units are the curated file's own entries. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { CourseEntry } from "../lib/chances/types.ts";
import { checkGate, isStemFamily, majorMatters, majorReviewFor, meetsLevel, UNDECIDED_MAJOR, type MajorReviewStudent } from "../lib/chances/major-review.ts";
import { majorUnitById, validateMajorAdmission, type MajorAdmissionFile } from "../lib/chances/major-admission.ts";
import { noteText } from "../lib/chances/notes.ts";
import { isFieldPath } from "../lib/fields.ts";

const ROOT = join(import.meta.dirname, "..");
const readJson = <T,>(...p: string[]): T => JSON.parse(readFileSync(join(ROOT, ...p), "utf8")) as T;
const schools = readJson<School[]>("data", "schools.json");
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const known = new Set(schools.map((s) => s.unit_id));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const school = (id: string) => ({ unit_id: id, name: byId.get(id)!.name });
const student = (o: Partial<MajorReviewStudent> = {}): MajorReviewStudent => ({ majors: [], courses: [], satMath: null, actMath: null, ...o });
let n = 0;
const course = (o: Partial<CourseEntry>): CourseEntry => ({
  id: `c${++n}`,
  kind: "regular",
  key: null,
  name: null,
  subject: "math",
  year: 11,
  status: "taken",
  grades: { s1: null, s2: null, final: null },
  exam: null,
  ...o,
});
const keys = (r: { notes: { key: string }[] }) => r.notes.map((x) => x.key);
const texts = (r: { notes: { key: string; values: Record<string, string | number> }[] }) => r.notes.map((x) => noteText(x));

test("no major, or no statement at the college: nothing is said", () => {
  assert.deepEqual(majorReviewFor(student(), school("228778")).notes, []);
  const harvard = majorReviewFor(student({ majors: ["14"] }), school("166027"));
  assert.deepEqual(harvard.notes, []);
  assert.equal(harvard.considered, null);
  assert.equal(harvard.unit, null);
  assert.deepEqual(harvard.facts, []);
});

test('"the major doesn\'t affect admission" is quoted from the college itself', () => {
  const wm = majorReviewFor(student({ majors: ["26"] }), school("231624"));
  assert.equal(wm.considered, "no");
  assert.equal(wm.source?.unit_id, "231624");
  assert.deepEqual(texts(wm), ["The major you list doesn't affect admission here (William & Mary says so)."]);
  assert.deepEqual(wm.facts, ["reported.major_admission.review.major_considered"]);
  assert.equal(majorReviewFor(student({ majors: ["52"] }), school("139959")).considered, "no");
});

test("a unit that compares applicants within it, and a university that says so for every college", () => {
  const uw = majorReviewFor(student({ majors: ["11"] }), school("236948"));
  assert.equal(uw.considered, "pool");
  assert.equal(uw.unit?.unit_id, "236948:computer-science");
  assert.deepEqual(texts(uw), ["Paul G. Allen School of Computer Science & Engineering admits separately here; you're compared with other computer science applicants."]);
  // Illinois's statement covers a major with no unit of its own (English): the general line.
  const il = majorReviewFor(student({ majors: ["23"] }), school("145637"));
  assert.equal(il.unit, null);
  assert.equal(il.considered, "pool");
  assert.deepEqual(keys(il), ["major.line.pool"]);
  // At Illinois, engineering's unit has a rate but no review: the university's statement still applies.
  assert.equal(majorReviewFor(student({ majors: ["14"] }), school("145637")).considered, "pool");
});

test("pool and emphasis: the subjects the college names, with the student's own subject GPAs or a prompt to add them", () => {
  const courses = [
    course({ kind: "ap", key: "ap_calculus_bc", subject: "math", grades: { s1: "A", s2: "A", final: "A" } }),
    course({ kind: "honors", name: "Honors Algebra II", subject: "math", grades: { s1: null, s2: null, final: "B+" } }),
    course({ kind: "ap", key: "ap_physics_1", subject: "science", grades: { s1: null, s2: null, final: "A-" } }),
    course({ kind: "ap", key: "ap_english_language", subject: "english", grades: { s1: null, s2: null, final: "C" } }),
  ];
  const r = majorReviewFor(student({ majors: ["14"], courses }), school("110635"));
  assert.equal(r.considered, "pool_and_emphasis");
  assert.deepEqual(r.emphasis, ["math", "science"]);
  assert.deepEqual(keys(r), ["major.pool", "major.emphasis"]);
  assert.ok(r.subjectGpas.math! > 3.6 && r.subjectGpas.math! < 3.7);
  assert.equal(r.subjectGpas.science, 3.7);
  assert.equal(texts(r)[1], `Berkeley College of Engineering applicants here get an extra look at math and science grades. Yours: math ${Math.round(r.subjectGpas.math! * 100) / 100}, science 3.7.`);
  assert.ok(r.facts.includes("reported.major_admission.review.emphasis"));
  // No graded math or science yet.
  const none = majorReviewFor(student({ majors: ["14"] }), school("110635"));
  assert.deepEqual(keys(none), ["major.pool", "major.emphasis_no_grades"]);
  assert.equal(texts(none)[1], "Berkeley College of Engineering applicants here get an extra look at math and science grades; add yours to see them here.");
  // One subject graded: the other says so.
  const mathOnly = majorReviewFor(student({ majors: ["14"], courses: courses.slice(0, 1) }), school("110635"));
  assert.match(texts(mathOnly)[1], /Yours: math 4, science not entered yet\.$/);
});

test("required courses: taken, in progress, or planned counts; a missing one is named; Pre-Calculus isn't calculus", () => {
  const courses = [
    course({ kind: "ap", key: "ap_calculus_bc", subject: "math", year: 12, status: "planned" }),
    course({ kind: "ap", key: "ap_physics_c_mechanics", subject: "science", status: "in_progress" }),
  ];
  const r = majorReviewFor(student({ majors: ["14"], courses }), school("190415"));
  assert.equal(r.unit?.unit_id, "190415:engineering");
  assert.deepEqual(r.requiredCourses.map((c) => [c.level, c.met]), [["calculus", true], ["physics", true], ["chemistry", false]]);
  // Cornell's university line (apply to one college) gives the pool line; then the three course lines.
  assert.deepEqual(keys(r), ["major.line.pool", "major.required_met", "major.required_met", "major.required_missing"]);
  assert.equal(texts(r)[3], "Cornell Duffield College of Engineering expects chemistry; it isn't on your list.");
  assert.equal(noteText(r.unitRequires!), "Cornell Duffield College of Engineering also requires: calculus, physics, chemistry.");
  assert.ok(r.facts.includes("reported.major_admission.review.required_courses"));

  assert.equal(meetsLevel(course({ kind: "honors", name: "Honors Pre-Calculus" }), "math", "calculus"), false);
  assert.equal(meetsLevel(course({ kind: "ap", key: "ap_precalculus" }), "math", "calculus"), false);
  assert.equal(meetsLevel(course({ kind: "dual", name: "Calculus I (MATH 151)" }), "math", "calculus"), true);
  assert.equal(meetsLevel(course({ kind: "ib_hl", key: "ib_math_aa_hl" }), "math", "calculus"), true);
  assert.equal(meetsLevel(course({ kind: "regular", name: "Chemistry", subject: "science" }), "science", "chemistry"), true);
  // A placeholder row (no key, no name) meets nothing.
  assert.equal(meetsLevel(course({ kind: "ap", subject: "other" }), "science", "physics"), false);
});

test("a gate: met by an exam, met by a section score, not yet met, pending a course, and closed", () => {
  const ut = school("228778");
  const byExam = majorReviewFor(student({ majors: ["14"], courses: [course({ kind: "ap", key: "ap_calculus_ab", exam: 4 })] }), ut);
  assert.equal(byExam.gate?.status, "met");
  assert.deepEqual(texts(byExam), ["You meet The University of Texas at Austin's math requirement for engineering through AP Calculus AB (4)."]);

  const bySat = majorReviewFor(student({ majors: ["11"], satMath: 650 }), ut);
  assert.equal(bySat.unit?.unit_id, "228778:computer-science");
  assert.equal(bySat.gate?.metBy?.via, "SAT Math (650)");
  assert.match(texts(bySat)[0], /for computer science through SAT Math \(650\)\.$/);

  const below = majorReviewFor(student({ majors: ["14"], satMath: 600, actMath: 24 }), ut);
  assert.equal(below.gate?.status, "not_yet");
  assert.deepEqual(below.gate?.routes.map((r) => r.status), ["below", "below", "absent", "absent", "absent", "absent"]);
  assert.equal(
    texts(below)[0],
    "To be considered for engineering at The University of Texas at Austin you'll need one of: SAT Math 620+, ACT Math 26+, AP Calculus AB 3+, AP Calculus BC 3+, IB Mathematics: Analysis and Approaches HL 4+, IB Mathematics: Applications and Interpretation HL 4+.",
  );

  // A planned course has no score yet: that route is pending. A low exam score is below.
  const gate = majorUnitById("228778:engineering")!.review!.gate!;
  const pending = checkGate(gate, student({ courses: [course({ kind: "ap", key: "ap_calculus_bc", status: "planned" }), course({ kind: "ap", key: "ap_calculus_ab", exam: 2 })] }));
  assert.equal(pending.status, "not_yet");
  assert.deepEqual(pending.routes.slice(2, 4).map((r) => [r.status, r.value]), [["below", 2], ["pending", null]]);

  // Testing over and nothing met: closed.
  const closed = majorReviewFor(student({ majors: ["14"], satMath: 600 }), ut, { testingClosed: true });
  assert.equal(closed.gate?.status, "closed");
  assert.deepEqual(texts(closed), ["Engineering at The University of Texas at Austin isn't open to this application."]);
  // Met stays met when testing is over.
  assert.equal(checkGate(gate, student({ actMath: 27 }), { testingClosed: true }).status, "met");
});

test("undecided: at colleges where the major matters, the student is told it will; elsewhere nothing", () => {
  const il = majorReviewFor(student({ majors: [UNDECIDED_MAJOR] }), school("145637"));
  assert.equal(il.undecided, true);
  assert.equal(il.family, null);
  assert.deepEqual(texts(il), ["You're undecided; at University of Illinois Urbana-Champaign you'd apply to a specific college, and that choice is compared within its own pool."]);
  assert.deepEqual(majorReviewFor(student({ majors: [UNDECIDED_MAJOR] }), school("231624")).notes, []);
  assert.deepEqual(majorReviewFor(student({ majors: [UNDECIDED_MAJOR] }), school("166027")).notes, []);
  assert.equal(majorMatters("228778"), true);
  assert.equal(majorMatters("231624"), false);
});

test("every note renders from the catalog and cites a registered field", () => {
  const cases: [MajorReviewStudent, string][] = [
    [student({ majors: ["26"] }), "231624"],
    [student({ majors: ["11"] }), "236948"],
    [student({ majors: ["14"] }), "110635"],
    [student({ majors: ["14"] }), "190415"],
    [student({ majors: ["14"], satMath: 700 }), "228778"],
    [student({ majors: ["14"] }), "228778"],
    [student({ majors: [UNDECIDED_MAJOR] }), "110422"],
  ];
  for (const [st, id] of cases) {
    const r = majorReviewFor(st, school(id));
    assert.ok(r.notes.length > 0, id);
    for (const x of [...r.notes, ...(r.unitRequires ? [r.unitRequires] : [])]) {
      const t = noteText(x);
      assert.ok(t.length > 0 && !/undefined|\$\{|NaN/.test(t), `${x.key}: ${t}`);
      assert.ok(x.cite && isFieldPath(x.cite), `${x.key} cites ${x.cite}`);
    }
  }
});

test("STEM families get the regular math and science rows", () => {
  for (const f of ["11", "14", "15", "26", "27", "40", "51"]) assert.ok(isStemFamily(f), f);
  for (const f of ["23", "52", "54", null]) assert.equal(isStemFamily(f), false, String(f));
});

/* ---- The major-admission check's published_rate rules ---- */

test("the major-admission check: the real file passes; a printed rate needs its percentage in the quote, a share, and no counts beside it", () => {
  const file = readJson<MajorAdmissionFile>("data", "major-admission.json");
  assert.deepEqual(validateMajorAdmission(file, known), []);
  const grainger = clone(file.units.find((u) => u.unit_id === "145637:engineering")!);
  const run = (u: unknown) => validateMajorAdmission({ checked: "2026-10-11", units: [u] } as MajorAdmissionFile, known);
  const cases: [string, unknown, RegExp][] = [
    ["percentage not in the quote", { ...grainger, published_rate: { ...grainger.published_rate!, rate: 0.25 } }, /percentage \(25%\) must appear/],
    ["not a share", { ...grainger, published_rate: { ...grainger.published_rate!, rate: 21.2 } }, /share from 0 to 1/],
    ["beside counts", { ...grainger, admit_rate: { admitted: 212, applied: 1000, year: "Fall 2025", quote: "212 of 1,000", source_url: "https://example.edu" } }, /drop it beside admit_rate/],
    ["no page", { ...grainger, published_rate: { ...grainger.published_rate!, source_url: "http://example.edu" } }, /https page/],
    ["nothing quoted", { ...grainger, published_rate: null }, /needs a review or an admit rate/],
  ];
  for (const [what, u, re] of cases) {
    const errors = run(u);
    assert.ok(errors.some((e) => re.test(e)), `${what}: ${errors.join("; ")}`);
  }
});
