/**
 * Earnings and debt by major (specs/data-expansion/field-of-study.md): the bulk-CSV reader, the `programs` detail
 * table (lib/detail.ts) and its guards, display helpers, and the committed data. `npm test`.
 * Fixture values are Vanderbilt's (221999) bachelor's Computer Science row, probed 2026-10-02.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { hasEarnings, isPlausibleCip4, programsWithEarnings, toCip4, topEarningPrograms, type ProgramEarnings } from "../lib/field-of-study.ts";
import { programEarningsFrom } from "../scripts/lib/field-of-study-sync.mts";
import { DETAIL_TABLES, detailMismatches, validateDetail, type SchoolDetail } from "../lib/detail.ts";
import { FIELDS } from "../lib/fields.ts";
import { readDetails } from "../scripts/lib/publish-details.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

/* ---- CIP code formatting and shape check ---- */

test("toCip4 pads the bulk CSV's code and adds the dot; isPlausibleCip4 is a shape check only", () => {
  assert.equal(toCip4("1107"), "11.07");
  assert.equal(toCip4("101"), "01.01");
  assert.equal(toCip4("101"), "01.01");
  assert.ok(isPlausibleCip4("11.07"));
  assert.ok(!isPlausibleCip4("1107"), "needs the dot");
  assert.ok(!isPlausibleCip4("11.0701"), "4-digit only, not 6");
  assert.ok(!isPlausibleCip4("99"), "institution-total code isn't a field");
});

/* ---- Bulk CSV reader: "PS" and "NA" both become null, never 0 ---- */

const row = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  UNITID: "221999",
  MAIN: "1",
  CIPCODE: "1107",
  CIPDESC: "Computer Science.",
  CREDLEV: "3",
  IPEDSCOUNT1: "205",
  IPEDSCOUNT2: "198",
  EARN_MDN_1YR: "122244",
  EARN_MDN_4YR: "160021",
  EARN_MDN_4YR_NAT: "107009",
  EARN_PELL_WNE_MDN_4YR: "126718",
  EARN_NOPELL_WNE_MDN_4YR: "189399",
  DEBT_ALL_STGP_EVAL_MDN: "14500",
  ...over,
});

test("Vanderbilt's Computer Science bachelor's row matches the spec's probed numbers", () => {
  const programs = programEarningsFrom([row()]);
  assert.deepEqual(programs["11.07"], {
    title: "Computer Science",
    graduates: 403,
    earnings: { y1: 122244, y4: 160021, y4_national: 107009, y4_pell: 126718, y4_non_pell: 189399 },
    debt_median: 14500,
  });
});

test("privacy-suppressed (\"PS\") and not-available (\"NA\") values both become null, never 0 or dropped", () => {
  const programs = programEarningsFrom([row({ EARN_MDN_4YR: "PS", EARN_MDN_1YR: "NA", DEBT_ALL_STGP_EVAL_MDN: "PS", IPEDSCOUNT2: "NA" })]);
  const p = programs["11.07"];
  assert.equal(p.earnings.y4, null);
  assert.equal(p.earnings.y1, null);
  assert.equal(p.debt_median, null);
  // One year's count missing doesn't drop the whole figure; both missing does.
  assert.equal(p.graduates, 205);
  assert.equal(programEarningsFrom([row({ IPEDSCOUNT1: "NA", IPEDSCOUNT2: "NA" })])["11.07"].graduates, null);
  assert.ok(!hasEarnings(p), "no 1- or 4-year figure left");
});

test("the trailing period on CIPDESC is stripped; blank earnings columns are null like PS/NA", () => {
  const p = programEarningsFrom([row({ CIPDESC: "Psychology, General." })])["11.07"];
  assert.equal(p.title, "Psychology, General");
  const blank = programEarningsFrom([row({ EARN_MDN_4YR: "" })])["11.07"];
  assert.equal(blank.earnings.y4, null);
});

/* ---- Display helpers ---- */

const prog = (y1: number | null, y4: number | null): ProgramEarnings => ({
  title: "x",
  graduates: 50,
  earnings: { y1, y4, y4_national: null, y4_pell: null, y4_non_pell: null },
  debt_median: null,
});

test("topEarningPrograms ranks by 4-year earnings, falls back to 1-year, and drops programs with neither", () => {
  const rows = { "11.07": prog(100, 200), "52.01": prog(80, null), "42.01": prog(null, null) };
  const top = topEarningPrograms(rows, 5);
  assert.deepEqual(top.map((p) => p.cip4), ["11.07", "52.01"]);
  assert.equal(topEarningPrograms(undefined).length, 0);
});

test("programsWithEarnings sorts by title and excludes programs with no earnings data", () => {
  const rows = { "11.07": { ...prog(100, 200), title: "Computer Science" }, "52.01": { ...prog(null, null), title: "Business" } };
  assert.deepEqual(
    programsWithEarnings(rows).map((p) => p.title),
    ["Computer Science"]
  );
});

/* ---- Detail table guards (each must fail when broken) ---- */

const sample = (): SchoolDetail => ({
  unit_id: "221999",
  tables: {
    programs: {
      source: "scorecard-fos",
      vintage: "scorecard-fos",
      year: null,
      rows: { "11.07": prog(122244, 160021) },
    },
  },
});

test("validateDetail accepts a good programs table and rejects each kind of mistake", () => {
  assert.deepEqual(validateDetail(sample(), meta), []);
  assert.equal(FIELDS[DETAIL_TABLES.programs.field].source, "scorecard-fos");
  const broken: [string, (d: SchoolDetail) => unknown][] = [
    ["not a 4-digit CIP", (d) => (d.tables.programs!.rows = { "1107": prog(1, 1) })],
    ["no title", (d) => (d.tables.programs!.rows = { "11.07": { ...prog(1, 1), title: "" } })],
    ["negative graduates", (d) => (d.tables.programs!.rows = { "11.07": { ...prog(1, 1), graduates: -5 } })],
    ["fractional graduates", (d) => (d.tables.programs!.rows = { "11.07": { ...prog(1, 1), graduates: 2.5 } })],
    ["zero earnings (should be null, not 0)", (d) => (d.tables.programs!.rows = { "11.07": prog(0, 1) })],
    ["negative debt", (d) => (d.tables.programs!.rows = { "11.07": { ...prog(1, 1), debt_median: -1 } })],
    ["wrong source", (d) => (d.tables.programs!.source = "ipeds-ef-c")],
    ["a year when the vintage has none", (d) => (d.tables.programs!.year = "Fall 2024")],
    ["empty rows", (d) => (d.tables.programs!.rows = {})],
  ];
  for (const [name, breakIt] of broken) {
    const d = sample();
    breakIt(d);
    assert.ok(validateDetail(d, meta).length > 0, name);
  }
});

test("detailMismatches catches academics.programs_with_earnings disagreeing with the detail file", () => {
  const vu = { ...byId("221999"), academics: { ...byId("221999").academics, programs_with_earnings: 1 } } as School;
  assert.deepEqual(detailMismatches(vu, sample()), []);
  const wrong = { ...vu, academics: { ...vu.academics, programs_with_earnings: 0 } } as School;
  assert.ok(detailMismatches(wrong, sample()).length > 0);
});

/* ---- Committed data ---- */

test("stored field-of-study data: Vanderbilt matches the probed Computer Science figures, and nulls never leak as 0", () => {
  const vu = byId("221999");
  const details = readDetails(ROOT)!;
  const vuDetail = details.find((d) => d.unit_id === "221999")!;
  const cs = vuDetail.tables.programs!.rows["11.07"];
  assert.equal(cs.title, "Computer Science");
  assert.equal(cs.earnings.y1, 122244);
  assert.equal(cs.earnings.y4, 160021);
  assert.equal(cs.earnings.y4_national, 107009);
  assert.equal(cs.earnings.y4_pell, 126718);
  assert.equal(cs.earnings.y4_non_pell, 189399);
  assert.equal(cs.debt_median, 14500);
  assert.equal(vu.academics?.programs_with_earnings, Object.values(vuDetail.tables.programs!.rows).filter(hasEarnings).length);

  let checked = 0;
  for (const d of details) {
    const programs = d.tables.programs;
    if (!programs) continue;
    checked++;
    for (const [cip, p] of Object.entries(programs.rows)) {
      assert.ok(isPlausibleCip4(cip), `${d.unit_id} ${cip}`);
      for (const v of Object.values(p.earnings)) assert.ok(v === null || v > 0, `${d.unit_id} ${cip}: earnings must be null or positive, never 0`);
      if (p.debt_median !== null) assert.ok(p.debt_median >= 0);
      if (p.graduates !== null) assert.ok(Number.isInteger(p.graduates) && p.graduates >= 0);
    }
  }
  assert.ok(checked > 1000, `expected well over 1,000 colleges with a programs table, got ${checked}`);
});
