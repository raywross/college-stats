/**
 * "How Quad reads your record" (lib/planner/record-reading.ts; specs/planner/record/reading.md): `readingLines`
 * over several planted plans — a full record, a bare one, an empty list, and no record at all — plus the level-count
 * line and the input-kind helpers. Guards: no percentage, multiple, or the word "odds" ever reaches a line (reading.md
 * "Rules" — the estimate's inputs and outputs only), and the "not yet" prompt always resolves to a real record
 * section. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readingLines, usedInputKinds, usedInputsCount } from "../lib/planner/record-reading.ts";
import { RECORD_STEPS, type RecordSection } from "../lib/planner/record.ts";

type EstimateResult = import("../lib/chances/types.ts").EstimateResult;
type EstimateStudent = import("../lib/chances/types.ts").EstimateStudent;
type EstimateNote = import("../lib/chances/types.ts").EstimateNote;
type CourseEntry = import("../lib/chances/types.ts").CourseEntry;

const SECTIONS: ReadonlySet<RecordSection> = new Set(RECORD_STEPS.map((s) => s.section));

function student(o: Partial<EstimateStudent> = {}): EstimateStudent {
  const gpa = o.gpa ?? null;
  return {
    gpa,
    gpaScale: "4.0",
    gpaRange: gpa !== null ? [gpa, gpa] : null,
    test: null,
    satMath: null,
    actMath: null,
    classRankPercentile: null,
    courses: [],
    state: null,
    majors: [],
    round: null,
    highSchoolId: null,
    ...o,
  };
}

const note = (key: string, values: EstimateNote["values"] = {}): EstimateNote => ({ key, values });

function result(unitId: string, o: Partial<EstimateResult> = {}): EstimateResult {
  return { unitId, group: null, label: null, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, closeness: null, ed: null, modelVersion: "test", ...o };
}

function course(kind: CourseEntry["kind"]): CourseEntry {
  return { id: `c-${kind}`, kind, key: kind === "ap" ? "ap_calculus_bc" : null, name: kind === "ap" ? null : "Course", subject: "math", year: 11, status: "taken", grades: { s1: null, s2: null, final: null }, exam: null };
}

const item = (unit_id: string, withdrawn_on: string | null = null) => ({ unit_id, withdrawn_on });

/* ------------------------------------------------------------------ */
/* No record at all: hasNumbers is false                               */
/* ------------------------------------------------------------------ */

test("readingLines: no grades and no test reads as the no_record empty state", () => {
  const lines = readingLines({ estimates: {}, items: [], profile: null, student: student() });
  assert.deepEqual(lines, { workingFrom: null, notYet: null, listLine: null, empty: "no_record" });
});

/* ------------------------------------------------------------------ */
/* Has numbers, but no list                                            */
/* ------------------------------------------------------------------ */

test("readingLines: numbers entered but no college on the list reads as the no_list empty state", () => {
  const lines = readingLines({ estimates: {}, items: [], profile: null, student: student({ gpa: 3.7 }) });
  assert.deepEqual(lines, { workingFrom: null, notYet: null, listLine: null, empty: "no_list" });
});

test("readingLines: every row withdrawn reads the same as an empty list", () => {
  const estimates = { "1": result("1", { group: "target", used: ["gpa"] }) };
  const lines = readingLines({ estimates, items: [item("1", "2026-09-01")], profile: null, student: student({ gpa: 3.7 }) });
  assert.equal(lines.empty, "no_list");
});

/* ------------------------------------------------------------------ */
/* A bare record: one college, nothing missing                         */
/* ------------------------------------------------------------------ */

test("readingLines: a bare record (one college, nothing missing) has a working-from and a list line, no not-yet", () => {
  const estimates = { "1": result("1", { group: "likely", used: ["gpa"] }) };
  const lines = readingLines({ estimates, items: [item("1")], profile: null, student: student({ gpa: 3.5 }) });
  assert.ok(lines.workingFrom?.includes("GPA"));
  assert.equal(lines.notYet, null);
  assert.equal(lines.listLine, "1 Likely");
  assert.equal(lines.empty, null);
});

/* ------------------------------------------------------------------ */
/* A full record: several colleges, a missing input, every level       */
/* ------------------------------------------------------------------ */

function fullPlan() {
  const missingMajor = [note("estimate.missing_input", { input: "intended major" })];
  const estimates: Record<string, EstimateResult> = {
    "1": result("1", { group: "likely", used: ["gpa", "test"], missing: ["major"], notes: missingMajor }),
    "2": result("2", { group: "target", used: ["gpa", "courses"], missing: ["major"], notes: missingMajor }),
    "3": result("3", { group: "target", used: ["gpa"] }),
    "4": result("4", { group: "reach", used: ["gpa", "test", "courses", "activities"] }),
    "5": result("5", { group: "reach", used: ["gpa"] }),
    "6": result("6", { group: "high_reach", used: ["gpa", "test"] }),
  };
  const items = Object.keys(estimates).map((id) => item(id));
  const s = student({ gpa: 3.7, test: { kind: "sat", score: 1350 }, courses: [course("ap"), course("ap")] });
  return { estimates, items, student: s };
}

test("readingLines: a full record names what's working, the most useful missing input and its section, and every level", () => {
  const { estimates, items, student: s } = fullPlan();
  const lines = readingLines({ estimates, items, profile: null, student: s });

  assert.match(lines.workingFrom ?? "", /GPA 3\.70/);
  assert.match(lines.workingFrom ?? "", /SAT 1350/);
  assert.match(lines.workingFrom ?? "", /2 advanced courses/);
  assert.match(lines.workingFrom ?? "", /activities/);

  assert.ok(lines.notYet);
  assert.match(lines.notYet!.text, /major/);
  assert.equal(lines.notYet!.section, "major");
  assert.ok(SECTIONS.has(lines.notYet!.section));

  assert.equal(lines.listLine, "1 Likely · 2 Targets · 2 Reaches · 1 High reach");
  assert.equal(lines.empty, null);
});

test("readingLines: never a percentage, a multiple, or the word odds in any line", () => {
  const { estimates, items, student: s } = fullPlan();
  const lines = readingLines({ estimates, items, profile: null, student: s });
  const strings = [lines.workingFrom, lines.notYet?.text ?? null, lines.listLine];
  for (const text of strings) {
    if (!text) continue;
    assert.doesNotMatch(text, /%/);
    assert.doesNotMatch(text, /\bodds\b/i);
    assert.doesNotMatch(text, /\d+x\b/i);
  }
});

/* ------------------------------------------------------------------ */
/* Level counts: unsorted rows (no group) don't count toward any level  */
/* ------------------------------------------------------------------ */

test("readingLines: an unsorted row (no group yet) doesn't count toward any level", () => {
  const estimates = { "1": result("1", { group: "likely", used: ["gpa"] }), "2": result("2", { group: null, used: [] }) };
  const lines = readingLines({ estimates, items: [item("1"), item("2")], profile: null, student: student({ gpa: 3.7 }) });
  assert.equal(lines.listLine, "1 Likely");
});

/* ------------------------------------------------------------------ */
/* The input-kind helpers                                              */
/* ------------------------------------------------------------------ */

test("usedInputKinds/usedInputsCount: the union of every result's used kinds, once each", () => {
  const estimates = { "1": result("1", { used: ["gpa", "test"] }), "2": result("2", { used: ["gpa", "courses"] }) };
  assert.deepEqual(new Set(usedInputKinds(Object.values(estimates))), new Set(["gpa", "test", "courses"]));
  assert.equal(usedInputsCount(estimates), 3);
});

/* ------------------------------------------------------------------ */
/* Guard: the missing-input section mapping never points outside the thirteen record sections                     */
/* ------------------------------------------------------------------ */

const EACH_PROMPTED_INPUT: readonly { input: string; missing: EstimateResult["missing"][number] }[] = [
  { input: "GPA", missing: "gpa" },
  { input: "courses", missing: "courses" },
  { input: "class rank", missing: "class_rank" },
  { input: "math and science grades", missing: "subject_grades" },
  { input: "intended major", missing: "major" },
  { input: "state", missing: "state" },
  { input: "high school", missing: "high_school" },
  { input: "activities", missing: "activities" },
  { input: "test score", missing: "test" },
];

test("readingLines: every input mostUsefulMissing can name resolves to one of the thirteen record sections", () => {
  for (const { input, missing } of EACH_PROMPTED_INPUT) {
    const estimates = { "1": result("1", { used: ["gpa"], missing: [missing], notes: [note("estimate.missing_input", { input })] }) };
    const lines = readingLines({ estimates, items: [item("1")], profile: null, student: student({ gpa: 3.7 }) });
    assert.ok(lines.notYet, `expected a not-yet line for ${input}`);
    assert.ok(SECTIONS.has(lines.notYet!.section), `${input} -> ${lines.notYet!.section} is not a record section`);
  }
});

/** Proves the guard above actually checks something: a prompt note naming an input the catalog doesn't know (so
 * `mostUsefulMissing` can't resolve it to a kind at all) correctly yields no "not yet" line, rather than a
 * section picked from thin air. */
test("readingLines: a prompt note the catalog can't resolve yields no not-yet line (the guard isn't vacuous)", () => {
  const estimates = { "1": result("1", { used: ["gpa"], missing: ["gpa"], notes: [note("estimate.missing_input", { input: "something new" })] }) };
  const lines = readingLines({ estimates, items: [item("1")], profile: null, student: student({ gpa: 3.7 }) });
  assert.equal(lines.notYet, null);
});
