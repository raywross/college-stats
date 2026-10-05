/**
 * The PSS (private school) adapter (scripts/lib/high-schools/pss.mts): CSV parsing, the grade-12 filter, grade/race/
 * affiliation code decoding, and the private id format. `parsePssCsv` is pure (no network, no zip), so these build a
 * small in-memory CSV shaped like the real 2023–24 public-use file (same column names and code values, confirmed
 * against the live file on 2026-10-05) and check what comes out. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHighSchoolId, validateHighSchoolRow } from "../lib/high-school-core.ts";
import { parsePssCsv } from "../scripts/lib/high-schools/pss.mts";

const HEADER =
  "PPIN,PINST,PADDRS,PCITY,PSTABB,PZIP,LATITUDE24,LONGITUDE24,ULOCALE24,LOGR2024,HIGR2024,RELIG,ORIENT," +
  "NUMSTUDS,NUMTEACH,STTCH_RT,MALES,P270,P280,P290,P300,P320,P330,P325,P316,P318,P310,P332";

/** One PSS data row, defaults shaped like a typical grade 9–12 private high school; override columns by name. */
function pssRow(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    PPIN: "A2370015",
    PINST: "HOLY FAMILY CRISTO REY CATHOLIC HIGH SCHOOL",
    PADDRS: "1832 CENTER WAY S",
    PCITY: "BIRMINGHAM",
    PSTABB: "AL",
    PZIP: "35205",
    LATITUDE24: "33.487776",
    LONGITUDE24: "-86.829296",
    ULOCALE24: "12",
    LOGR2024: "14",
    HIGR2024: "17",
    RELIG: "1",
    ORIENT: "1",
    NUMSTUDS: "154",
    NUMTEACH: "17.3",
    STTCH_RT: "8.901734104",
    MALES: "64",
    P270: "40",
    P280: "28",
    P290: "41",
    P300: "45",
    P320: "14",
    P330: "1",
    P325: "137",
    P316: "0",
    P318: "0",
    P310: "0",
    P332: "2",
  };
  return { ...base, ...overrides };
}

function csvOf(rows: Record<string, string>[]): string {
  const cols = HEADER.split(",");
  return [HEADER, ...rows.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n") + "\n";
}

/* ------------------------------------------------------------------ */
/* Id format                                                           */
/* ------------------------------------------------------------------ */

test("isPrivateHighSchoolId accepts real PSS ppin shapes (letter-prefixed and all-digit), rejects everything else", () => {
  assert.ok(isPrivateHighSchoolId("A2370015"), "letter + 7 digits (the common PSS shape)");
  assert.ok(isPrivateHighSchoolId("00001026"), "8 digits (schools NCES assigned a numeric ppin)");
  assert.ok(isPrivateHighSchoolId("BB000073"));
  assert.ok(!isPrivateHighSchoolId("060000100001"), "a 12-digit ncessch is public, not private");
  assert.ok(!isPrivateHighSchoolId("A237001"), "7 characters");
  assert.ok(!isPrivateHighSchoolId("A23700155"), "9 characters");
  assert.ok(!isPrivateHighSchoolId("a2370015"), "lower-case: the real file is all upper-case");
  assert.ok(!isPrivateHighSchoolId("A237-015"), "punctuation");
});

/* ------------------------------------------------------------------ */
/* Parsing a basic row                                                 */
/* ------------------------------------------------------------------ */

test("parses a grade 9–12 Catholic high school: directory fields, grades, enrollment, race, ratio, affiliation", () => {
  const { rows, belowGrade12, droppedId, droppedState, droppedGrade } = parsePssCsv(csvOf([pssRow()]));
  assert.equal(belowGrade12 + droppedId + droppedState + droppedGrade, 0);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.id, "A2370015");
  assert.equal(row.kind, "private");
  assert.equal(row.name, "Holy Family Cristo Rey Catholic High School", "all-caps PINST is title-cased");
  assert.equal(row.city, "Birmingham");
  assert.equal(row.address, "1832 Center Way S");
  assert.equal(row.state, "AL");
  assert.equal(row.zip, "35205");
  assert.equal(row.lat, 33.487776);
  assert.equal(row.lng, -86.829296);
  assert.equal(row.locale, "City: Midsize", "ULOCALE24=12 decodes like the CCD locale codes");
  assert.deepEqual(row.grades, { low: "9", high: "12" }, "LOGR2024=14 -> 9th, HIGR2024=17 -> 12th");
  assert.equal(row.affiliation, "Roman Catholic", "ORIENT=1");
  assert.equal(row.school_type, null, "PSS has no CCD school type");
  assert.deepEqual(row.status, { charter: null, magnet: null, title_i: null, virtual: null });
  assert.equal(row.district, null);
  assert.equal(row.state_school_id, null);
  assert.equal(row.enrollment.total, 154);
  assert.deepEqual(row.enrollment.by_grade, { "9": 40, "10": 28, "11": 41, "12": 45 });
  assert.deepEqual(row.enrollment.by_race, {
    american_indian: 0, asian: 0, black: 137, hispanic: 14, pacific_islander: 0, two_or_more: 2, white: 1,
  });
  assert.equal(row.enrollment.female, 154 - 64);
  assert.equal(row.student_teacher_ratio, 8.9, "rounded to 2 places by normalizeHighSchool");
  assert.equal(row.frl_share, null, "PSS has no free/reduced lunch data");
  assert.equal(row.grad_rate, null, "private schools aren't in EDFacts");
  assert.equal(row.rigor, null, "private schools aren't in CRDC");
  assert.equal(row.suppressed, undefined, "the public-use file doesn't suppress; nothing is marked suppressed");
  assert.deepEqual(validateHighSchoolRow(row), [], "passes the shared row validator");
});

/* ------------------------------------------------------------------ */
/* The grade-12 filter                                                 */
/* ------------------------------------------------------------------ */

test("drops a K-8 school (HIGR2024=13, eighth grade) and keeps a 6-12 school (HIGR2024=17)", () => {
  const { rows } = parsePssCsv(
    csvOf([
      pssRow({ PPIN: "A0000001", LOGR2024: "3", HIGR2024: "13" }), // kindergarten through 8th
      pssRow({ PPIN: "A0000002", LOGR2024: "11", HIGR2024: "17" }), // 6th through 12th
    ]),
  );
  assert.deepEqual(rows.map((r) => r.id), ["A0000002"]);
});

test("drops an all-ungraded school (LOGR2024=HIGR2024=1): grade 12 coverage isn't knowable from that code", () => {
  const { rows, belowGrade12 } = parsePssCsv(csvOf([pssRow({ PPIN: "A0000003", LOGR2024: "1", HIGR2024: "1" })]));
  assert.equal(rows.length, 0);
  assert.equal(belowGrade12, 1);
});

test("a school offering grade 12 with lower grades missing blank enrollment cells (valid skip, not suppressed)", () => {
  const { rows } = parsePssCsv(
    csvOf([
      pssRow({ PPIN: "A0000004", LOGR2024: "17", HIGR2024: "17", P270: "", P280: "", P290: "" }), // grade 12 only
    ]),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].enrollment.by_grade, { "9": null, "10": null, "11": null, "12": 45 });
  assert.equal(rows[0].suppressed, undefined, "a blank 'not offered' cell is missing, not suppressed");
});

/* ------------------------------------------------------------------ */
/* Guards: each proven to catch a broken row                           */
/* ------------------------------------------------------------------ */

test("guard: a malformed ppin is dropped, not passed through with a bad id", () => {
  const { rows, droppedId } = parsePssCsv(csvOf([pssRow({ PPIN: "bad-id!!" })]));
  assert.equal(rows.length, 0);
  assert.equal(droppedId, 1);
});

test("guard: a non-US-state PSTABB (e.g. a territory) is dropped, not folded into the 50 states + DC", () => {
  const { rows, droppedState } = parsePssCsv(csvOf([pssRow({ PSTABB: "PR" })]));
  assert.equal(rows.length, 0);
  assert.equal(droppedState, 1);
});

test("guard: an unrecognized grade recode code is dropped rather than guessed at", () => {
  const { rows, droppedGrade } = parsePssCsv(csvOf([pssRow({ HIGR2024: "99" })]));
  assert.equal(rows.length, 0);
  assert.equal(droppedGrade, 1);
});

test("guard: female is left null, not negative, when noise-infused MALES exceeds NUMSTUDS", () => {
  const { rows } = parsePssCsv(csvOf([pssRow({ NUMSTUDS: "8", MALES: "20" })]));
  assert.equal(rows[0].enrollment.female, null);
});

/* ------------------------------------------------------------------ */
/* Code decoding                                                       */
/* ------------------------------------------------------------------ */

test("decodes a Nonsectarian school and a Jewish day school", () => {
  const { rows } = parsePssCsv(
    csvOf([
      pssRow({ PPIN: "A0000005", RELIG: "3", ORIENT: "30" }),
      pssRow({ PPIN: "A0000006", RELIG: "2", ORIENT: "18" }),
    ]),
  );
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.equal(by.get("A0000005")!.affiliation, "Nonsectarian");
  assert.equal(by.get("A0000006")!.affiliation, "Jewish");
});

test("transitional kindergarten (LOGR2024=4) and transitional first grade (LOGR2024=5) map to the nearest ordinary grade", () => {
  const { rows } = parsePssCsv(
    csvOf([
      pssRow({ PPIN: "A0000007", LOGR2024: "4", HIGR2024: "17" }),
      pssRow({ PPIN: "A0000008", LOGR2024: "5", HIGR2024: "17" }),
    ]),
  );
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.equal(by.get("A0000007")!.grades.low, "KG");
  assert.equal(by.get("A0000008")!.grades.low, "1");
});

test("a blank zip is left null rather than stored malformed", () => {
  const { rows } = parsePssCsv(csvOf([pssRow({ PZIP: "" })]));
  assert.equal(rows[0].zip, null);
});
