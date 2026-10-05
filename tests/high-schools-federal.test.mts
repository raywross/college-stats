/**
 * The federal high school adapters (scripts/lib/high-schools/{ccd,edfacts,crdc}.mts) on small extracts of the real
 * files: the CCD high school filter, membership folding, suppression (source flags and counts under 5), EDFacts
 * ranges, CRDC reserve codes, schools missing from one file, and an end-to-end sync. Each guard has a case that would
 * come out differently if the guard were removed. No network: the fixture cache holds directories named like the zips
 * (federal-csv.mts reads a directory source the way it reads a zip). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HighSchool } from "../lib/high-school-types.ts";
import { validateHighSchoolMeta, validateHighSchoolRow, validateShard } from "../lib/high-school-core.ts";
import { citeHsField } from "../lib/hs-fields.ts";
import { readAllShards, readHsMeta } from "../lib/high-school-store.ts";
import { createAdapterContext } from "../scripts/lib/high-schools/context.mts";
import { ADAPTERS } from "../scripts/lib/high-schools/index.mts";
import { runHighSchoolSync } from "../scripts/lib/high-schools/sync.mts";
import { openQuote, readCsvRecords, schoolYearLabel, splitCsvLine } from "../scripts/lib/high-schools/federal-csv.mts";
import {
  CCD_FILES,
  MembershipAccumulator,
  buildCcdRows,
  ccdCell,
  classifyDirectory,
  completeRow,
  titleIStatus,
  virtualStatus,
  load as loadCcd,
} from "../scripts/lib/high-schools/ccd.mts";
import { buildEdfactsPatch, classOf, edfactsCandidates, normalizeNcessch, load as loadEdfacts } from "../scripts/lib/high-schools/edfacts.mts";
import { CRDC_FILE, buildCrdcPatch, crdcRawTotal, loadCrdcSchools } from "../scripts/lib/high-schools/crdc.mts";

const CACHE = join(import.meta.dirname, "fixtures", "high-schools", "federal", "cache");
const ROOT = join(import.meta.dirname, "..");
const quiet = { log: () => {}, warn: () => {} };
const zipDir = (url: string) => join(CACHE, url.slice(url.lastIndexOf("/") + 1));

const SOURCES = {
  directory: zipDir(CCD_FILES.directory.url),
  membership: zipDir(CCD_FILES.membership.url),
  staff: zipDir(CCD_FILES.staff.url),
  characteristics: zipDir(CCD_FILES.characteristics.url),
  lunch: zipDir(CCD_FILES.lunch.url),
  edge: zipDir(CCD_FILES.edge.url),
  titleI: zipDir(CCD_FILES.titleI.url),
  crdc: zipDir(CRDC_FILE.url),
};

async function ccdRows(): Promise<Map<string, HighSchool>> {
  const { rows } = await buildCcdRows(SOURCES);
  return new Map(rows.map((r) => [r.id, r]));
}

const dirRec = (o: Record<string, string>) => ({
  NCESSCH: "060000100101", SCH_NAME: "Fixture High", UPDATED_STATUS: "1", GSLO: "09", GSHI: "12", LEAID: "0600001", LEA_NAME: "Fixture USD",
  ST_SCHID: "CA-1-2", LCITY: "Town", LZIP: "95000", LSTREET1: "1 Main", CHARTER_TEXT: "No", SCH_TYPE_TEXT: "Regular School", ...o,
});

/* ------------------------------------------------------------------ */
/* CSV reading                                                         */
/* ------------------------------------------------------------------ */

test("CSV lines: quoted commas, doubled quotes, pipes, and open quotes across lines", async () => {
  assert.deepEqual(splitCsvLine('a,"b, c","say ""hi""",'), ["a", "b, c", 'say "hi"', ""]);
  assert.deepEqual(splitCsvLine("1|Name, Inc|x", "|"), ["1", "Name, Inc", "x"]);
  assert.equal(openQuote('a,"open field'), true);
  assert.equal(openQuote('a,"closed",b'), false);
  assert.equal(openQuote('a,mid"quote'), false, "a quote inside an unquoted field doesn't open one");
  assert.equal(schoolYearLabel("2024-2025"), "2024–25");
  assert.equal(schoolYearLabel("2022-23"), "2022–23");
  assert.equal(schoolYearLabel("junk"), null);
  const recs = [];
  for await (const r of readCsvRecords(SOURCES.directory, CCD_FILES.directory.entry)) recs.push(r);
  assert.equal(recs[1].SCH_NAME, "Fixture Charter Academy, Upper School");
  assert.equal(recs.length, 8);
});

/* ------------------------------------------------------------------ */
/* CCD: the high school filter                                         */
/* ------------------------------------------------------------------ */

test("CCD filter: open schools whose highest grade is 12 or 13, in the 50 states + DC", () => {
  assert.equal(classifyDirectory(dirRec({})).keep, true);
  assert.equal(classifyDirectory(dirRec({ GSHI: "13", GSLO: "07" })).keep, true);
  for (const status of ["3", "4", "5", "8"]) assert.equal(classifyDirectory(dirRec({ UPDATED_STATUS: status })).keep, true, `status ${status} is open`);
  assert.deepEqual(classifyDirectory(dirRec({ UPDATED_STATUS: "2" })), { keep: false, reason: "not open" });
  assert.deepEqual(classifyDirectory(dirRec({ UPDATED_STATUS: "6" })), { keep: false, reason: "not open" });
  assert.deepEqual(classifyDirectory(dirRec({ UPDATED_STATUS: "7" })), { keep: false, reason: "not open" });
  assert.deepEqual(classifyDirectory(dirRec({ GSHI: "08", GSLO: "06" })), { keep: false, reason: "no grade 12" });
  assert.deepEqual(classifyDirectory(dirRec({ GSHI: "UG", GSLO: "09" })), { keep: false, reason: "no grade 12" });
  assert.deepEqual(classifyDirectory(dirRec({ GSHI: "M", GSLO: "M" })), { keep: false, reason: "no grade 12" });
  assert.deepEqual(classifyDirectory(dirRec({ NCESSCH: "720000300301" })), { keep: false, reason: "out-of-scope state" });
  assert.deepEqual(classifyDirectory(dirRec({ NCESSCH: "5900012" })), { keep: false, reason: "bad id" });
});

test("CCD directory fields: location address, district, state id (for state crosswalks), grades, charter, type", () => {
  const v = classifyDirectory(dirRec({ LSTREET2: "Suite 4", CHARTER_TEXT: "Not applicable", SCH_TYPE_TEXT: "Career and Technical School", GSLO: "KG", LZIP: "950" }));
  assert.ok(v.keep);
  const r = v.row;
  assert.equal(r.address, "1 Main, Suite 4");
  assert.equal(r.zip, null, "a ZIP that isn't 5 digits is dropped, not padded");
  assert.deepEqual(r.district, { id: "0600001", name: "Fixture USD" });
  assert.equal(r.state_school_id, "CA-1-2");
  assert.deepEqual(r.grades, { low: "KG", high: "12" });
  assert.equal(r.status.charter, null);
  assert.equal(r.school_type, "Career and technical school");
  assert.deepEqual(validateHighSchoolRow(r), []);
});

test("CCD status codes: Title I runs a program; virtual means exclusively or primarily virtual", () => {
  assert.equal(titleIStatus("SWELIGSWPROG"), true);
  assert.equal(titleIStatus("TGELGBTGPROG"), true);
  assert.equal(titleIStatus("SWELIGTGPROG"), true);
  assert.equal(titleIStatus("SWELIGNOPROG"), false, "eligible without a program isn't a Title I school");
  assert.equal(titleIStatus("NOTTITLE1ELIG"), false);
  assert.equal(titleIStatus("MISSING"), null);
  assert.equal(virtualStatus("FULLVIRTUAL"), true);
  assert.equal(virtualStatus("FACEVIRTUAL"), true);
  assert.equal(virtualStatus("SUPPVIRTUAL"), false);
  assert.equal(virtualStatus("Not reported"), null);
});

/* ------------------------------------------------------------------ */
/* CCD: membership and suppression                                     */
/* ------------------------------------------------------------------ */

test("CCD cells: numbers, the Suppressed flag, and missing flags", () => {
  assert.deepEqual(ccdCell("812", "Derived"), { value: 812, suppressed: false });
  assert.deepEqual(ccdCell("", "Suppressed"), { value: null, suppressed: true });
  assert.deepEqual(ccdCell("", "Missing"), { value: null, suppressed: false });
  assert.deepEqual(ccdCell("", "Not reported"), { value: null, suppressed: false });
});

test("CCD membership: total without adult ed, grades 9–12, race summed over sexes, female summed over races", async () => {
  const rows = await ccdRows();
  const a = rows.get("060000100101")!;
  assert.equal(a.enrollment.total, 812, "the total minus adult education, not the 830 education unit total");
  assert.deepEqual(a.enrollment.by_grade, { "9": 210, "10": 205, "11": 200, "12": 197 });
  assert.deepEqual(a.enrollment.by_race, { american_indian: null, asian: 38, black: 7, hispanic: 610, pacific_islander: 0, two_or_more: 31, white: 122 });
  assert.equal(a.enrollment.female, 399);
  // Small cells: 1 + 1 American Indian students (2) is suppressed; 3 + 4 Black students (7) is shown; zero is shown.
  assert.deepEqual(a.suppressed, ["enrollment.by_race.american_indian"]);
});

test("CCD suppression: a Suppressed flag or a count under 5 → null and listed; missing → null, not listed", async () => {
  const rows = await ccdRows();
  const b = rows.get("060000100102")!;
  assert.equal(b.enrollment.total, null);
  assert.equal(b.enrollment.by_grade["12"], null);
  assert.equal(b.enrollment.by_race?.white, null);
  assert.equal(b.enrollment.female, null);
  assert.deepEqual(b.suppressed, ["enrollment.by_grade.12", "enrollment.by_race.white", "enrollment.female", "enrollment.total"]);
  assert.equal(b.student_teacher_ratio, null, "no ratio from a suppressed total (it would reveal it)");
  const e = rows.get("480000200201")!;
  assert.equal(e.enrollment.by_grade["9"], null);
  assert.equal(e.enrollment.by_grade["12"], 0, "zero identifies nobody: shown");
  assert.equal(e.enrollment.by_race?.asian, null, "a missing part makes the sum missing");
  assert.equal(e.enrollment.female, null);
  assert.equal(e.suppressed, undefined, "missing cells aren't suppressed cells");
});

test("CCD membership accumulator ignores other rows and other schools", () => {
  const acc = new MembershipAccumulator((id) => id === "060000100101");
  const base = { NCESSCH: "060000100101", GRADE: "No Category Codes", RACE_ETHNICITY: "No Category Codes", SEX: "No Category Codes", DMS_FLAG: "Reported" };
  acc.add({ ...base, TOTAL_INDICATOR: "Education Unit Total", STUDENT_COUNT: "999" });
  acc.add({ ...base, TOTAL_INDICATOR: "Category Set A - By Race/Ethnicity; Sex; Grade", GRADE: "Grade 9", RACE_ETHNICITY: "White", SEX: "Male", STUDENT_COUNT: "50" });
  acc.add({ ...base, NCESSCH: "060000100999", TOTAL_INDICATOR: "Derived - Education Unit Total minus Adult Education Count", STUDENT_COUNT: "10" });
  assert.equal(acc.entries.size, 0);
  acc.add({ ...base, TOTAL_INDICATOR: "Derived - Education Unit Total minus Adult Education Count", STUDENT_COUNT: "10" });
  assert.deepEqual(acc.entries.get("060000100101")?.total, { value: 10, suppressed: false });
});

test("CCD ratio and FRL: computed from membership; implausible values are dropped, not stored", async () => {
  const rows = await ccdRows();
  const a = rows.get("060000100101")!;
  assert.equal(a.student_teacher_ratio, 20.05);
  assert.equal(a.frl_share, 0.4926);
  const e = rows.get("480000200201")!;
  assert.equal(e.student_teacher_ratio, null, "450 students ÷ 1,000 teachers is a reporting error");
  assert.equal(e.frl_share, null, "more FRL-eligible students than enrolled is a reporting error");
  // Guard proof: the same row with sane inputs gets values.
  const fixed = completeRow({ ...e, suppressed: undefined }, { membership: { total: { value: 450, suppressed: false }, grades: {}, race: {}, female: { sum: 0, parts: 0, suppressed: false, missing: false } }, teachers: { value: 30, suppressed: false }, frl: { value: 300, suppressed: false } });
  assert.equal(fixed.student_teacher_ratio, 15);
  assert.equal(fixed.frl_share, 0.6667);
});

test("CCD flags from other files: Title I (2021–22) and magnet (CRDC) carry lineage; geocodes from EDGE", async () => {
  const rows = await ccdRows();
  const a = rows.get("060000100101")!;
  assert.deepEqual(a.status, { charter: false, magnet: false, title_i: true, virtual: false });
  assert.deepEqual(a.lineage, { "status.magnet": { source: "crdc" }, "status.title_i": { source: "nces-ccd", year: "2021–22" } });
  assert.equal(a.lat, 37.123456);
  assert.equal(a.lng, -121.654321);
  assert.equal(a.locale, "Suburb: Large");
  const b = rows.get("060000100102")!;
  assert.deepEqual(b.status, { charter: true, magnet: true, title_i: false, virtual: true });
  assert.equal(b.address, "200 Oak Ave, Suite 4");
  const e = rows.get("480000200201")!;
  assert.deepEqual(e.status, { charter: null, magnet: null, title_i: null, virtual: null });
  assert.equal(e.lineage, undefined, "no lineage for a value that isn't there");
  assert.equal(e.lat, null, "blank coordinates stay null");
  assert.equal(e.locale, "Rural: Remote");
  assert.deepEqual(e.grades, { low: "7", high: "13" });
});

test("CCD build: only high schools come out, all valid", async () => {
  const { rows, skipped, schoolYear } = await buildCcdRows(SOURCES);
  assert.deepEqual(rows.map((r) => r.id).sort(), ["060000100101", "060000100102", "480000200201"]);
  assert.deepEqual(skipped, { "not open": 2, "no grade 12": 2, "out-of-scope state": 1 });
  assert.equal(schoolYear, "2024–25");
  for (const r of rows) assert.deepEqual(validateHighSchoolRow(r), [], r.id);
});

/* ------------------------------------------------------------------ */
/* EDFacts                                                             */
/* ------------------------------------------------------------------ */

const acgr = (rate: string, cohort = "120", id = "060000100101") => buildEdfactsPatch({ NCESSCH: id, CATEGORY: "ALL", RATE: rate, COHORT: cohort });

test("EDFacts rates: exact percents, ranges kept as ranges, suppressed and missing cells", () => {
  assert.deepEqual(acgr("87")?.values.grad_rate, { value: 0.87, low: null, high: null, cohort: 120 });
  assert.deepEqual(acgr("90-94")?.values.grad_rate, { value: null, low: 0.9, high: 0.94, cohort: 120 });
  assert.deepEqual(acgr("GE80")?.values.grad_rate, { value: null, low: 0.8, high: 1, cohort: 120 });
  assert.deepEqual(acgr("LT50")?.values.grad_rate, { value: null, low: 0, high: 0.49, cohort: 120 });
  const ps = acgr("PS", "3")!;
  assert.deepEqual(ps.values.grad_rate, { value: null, low: null, high: null, cohort: null });
  assert.deepEqual(ps.suppressed, ["grad_rate"]);
  assert.deepEqual(acgr("")?.values.grad_rate, null);
  assert.deepEqual(acgr("NA")?.values.grad_rate, null);
  assert.equal(acgr("87", "120", "bad"), null);
  // A range never becomes a point: the validator refuses a row that has both.
  const row = { ...classifyDirectoryRow(), grad_rate: { value: 0.92, low: 0.9, high: 0.94, cohort: 50 } };
  assert.ok(validateHighSchoolRow(row).some((p) => /exact .* or a range/.test(p)));
});

function classifyDirectoryRow(): HighSchool {
  const v = classifyDirectory(dirRec({}));
  assert.ok(v.keep);
  return v.row;
}

test("EDFacts helpers: 11-digit ids padded, class year, download candidates newest first", () => {
  assert.equal(normalizeNcessch("60000100107"), "060000100107");
  assert.equal(normalizeNcessch("060000100107"), "060000100107");
  assert.equal(normalizeNcessch("6000"), null);
  assert.equal(classOf("2022-2023"), "Class of 2023");
  assert.equal(classOf("2022-23"), "Class of 2023");
  const c = edfactsCandidates(new Date("2026-10-05T00:00:00Z"));
  assert.match(c[0], /acgr-sch-sy2023-24-long\.csv$/);
  assert.match(c[1], /acgr-sch-sy2022-23-long\.csv$/);
});

test("EDFacts load: reads the cached file (CATEGORY ALL only) and cites its year", async () => {
  const ctx = createAdapterContext({ root: ROOT, outDir: tmpdir(), cacheDir: CACHE, offline: true, ...quiet });
  const res = await loadEdfacts(ctx);
  const byId = new Map(res.patches!.map((p) => [p.id, p]));
  assert.deepEqual(byId.get("060000100101")?.values.grad_rate, { value: 0.91, low: null, high: null, cohort: 205 }, "the MBL subgroup's PS doesn't override ALL");
  assert.deepEqual(byId.get("480000200201")?.values.grad_rate, { value: null, low: 0.9, high: 0.94, cohort: 30 });
  assert.ok(byId.has("060000100107"));
  assert.equal(res.vintages["edfacts-acgr"], "Class of 2023");
  assert.match(res.sources.edfacts!.url, /acgr-sch-sy2022-23-long\.csv$/);
});

test("EDFacts load: no file and no download → nothing loaded (graduation rates untouched), with instructions", async () => {
  const empty = mkdtempSync(join(tmpdir(), "hs-edfacts-"));
  const warnings: string[] = [];
  try {
    const ctx = createAdapterContext({ root: ROOT, outDir: empty, cacheDir: empty, offline: true, log: () => {}, warn: (m) => warnings.push(m) });
    const res = await loadEdfacts(ctx);
    assert.equal(res.patches, undefined);
    assert.match(warnings.join(" "), /--only edfacts/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* CRDC                                                                */
/* ------------------------------------------------------------------ */

test("CRDC totals: male + female (+ nonbinary when collected); a missing part makes the total missing", () => {
  assert.deepEqual(crdcRawTotal({ T_M: "4", T_F: "5", T_X: "-10" }, "T"), { value: 9, suppressed: false });
  assert.deepEqual(crdcRawTotal({ T_M: "4", T_F: "5", T_X: "2" }, "T"), { value: 11, suppressed: false });
  assert.deepEqual(crdcRawTotal({ T_M: "-9", T_F: "5", T_X: "-10" }, "T"), { value: null, suppressed: false });
  assert.deepEqual(crdcRawTotal({ T_M: "-11", T_F: "5" }, "T"), { value: null, suppressed: true });
});

test("CRDC rigor: -9 is not reported (never zero), dual 'No' is zero, courses aren't small-cell suppressed", async () => {
  const schools = await loadCrdcSchools(SOURCES.crdc, () => true);
  const a = buildCrdcPatch("060000100101", schools.get("060000100101")!)!;
  assert.deepEqual(a.values.rigor, { ap_courses: 12, ap_enrolled: 140, ap_exam_takers: null, ap_passed_some: null, ib_enrolled: null, dual_enrolled: 65, enrollment: 810 });
  assert.equal(a.suppressed, undefined);
  const b = buildCrdcPatch("060000100102", schools.get("060000100102")!)!;
  assert.deepEqual(b.values.rigor, { ap_courses: null, ap_enrolled: null, ap_exam_takers: null, ap_passed_some: null, ib_enrolled: null, dual_enrolled: 0, enrollment: null });
  assert.deepEqual(b.suppressed, ["rigor.enrollment"], "3 students: fewer than 5");
  const e = buildCrdcPatch("480000200201", schools.get("480000200201")!)!;
  assert.deepEqual(e.values.rigor, { ap_courses: 3, ap_enrolled: null, ap_exam_takers: null, ap_passed_some: null, ib_enrolled: 22, dual_enrolled: null, enrollment: null });
  assert.deepEqual(e.suppressed, ["rigor.ap_enrolled", "rigor.dual_enrolled"]);
  assert.equal(buildCrdcPatch("x", {}), null);
  // Counts behind an indicator that isn't "Yes" aren't trusted (the -9 indicator means "not reported").
  const gated = buildCrdcPatch("x", { ap: { SCH_APENR_IND: "-9", SCH_APCOURSES: "0", TOT_APENR_M: "0", TOT_APENR_F: "0" }, ib: { SCH_IBENR_IND: "-9", TOT_IBENR_M: "0", TOT_IBENR_F: "0" } })!;
  assert.equal(gated.values.rigor?.ap_courses, null);
  assert.equal(gated.values.rigor?.ap_enrolled, null);
  assert.equal(gated.values.rigor?.ib_enrolled, null);
});

/* ------------------------------------------------------------------ */
/* End to end                                                          */
/* ------------------------------------------------------------------ */

test("sync end to end on the fixture cache: valid shards, meta with sources and years, schools missing from a file", async () => {
  const out = mkdtempSync(join(tmpdir(), "hs-federal-"));
  try {
    const res = await runHighSchoolSync({ root: ROOT, outDir: out, cacheDir: CACHE, offline: true, adapters: ADAPTERS, ...quiet });
    assert.equal(res.written, true);
    const report = Object.fromEntries(res.report.map((r) => [r.key, r]));
    assert.equal(report.ccd.added, 3);
    assert.equal(report.edfacts.unmatched, 1, "a school EDFacts lists that isn't a CCD high school is counted, not added");
    assert.equal(report.crdc.unmatched, 1);
    const shards = readAllShards(out);
    for (const { file, shard } of shards) assert.deepEqual(validateShard(shard, file), []);
    const rows = shards.flatMap((s) => s.shard.schools);
    const meta = readHsMeta(out)!;
    assert.deepEqual(validateHighSchoolMeta(meta, rows), []);
    assert.equal(meta.vintages["ccd-directory"], "2024–25");
    assert.equal(meta.vintages["ccd-enrollment"], "2024–25");
    assert.equal(meta.vintages["edfacts-acgr"], "Class of 2023");
    assert.equal(meta.vintages.crdc, "2023–24");
    for (const k of ["nces-ccd", "edfacts", "crdc"] as const) {
      assert.ok(meta.sources[k]?.url.startsWith("https://"), k);
      assert.match(meta.sources[k]!.retrieved, /^\d{4}-\d{2}-\d{2}$/);
    }
    const b = rows.find((r) => r.id === "060000100102")!;
    assert.deepEqual(b.suppressed, ["enrollment.by_grade.12", "enrollment.by_race.white", "enrollment.female", "enrollment.total", "grad_rate", "rigor.enrollment"]);
    // Citations: Title I cites its own (older) year; magnet cites the CRDC year from meta.
    const a = rows.find((r) => r.id === "060000100101")!;
    assert.equal(citeHsField("status.title_i", a, meta).year, "2021–22");
    assert.equal(citeHsField("status.magnet", a, meta).year, "2023–24");
    assert.equal(citeHsField("enrollment.total", a, meta).year, "2024–25");
    assert.equal(citeHsField("grad_rate", a, meta).year, "Class of 2023");
    assert.ok(readFileSync(join(out, "schools", "CA.json"), "utf8").startsWith('{"state":"CA","schools":[\n'));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("CCD load: notes report coverage and the skipped schools", async () => {
  const ctx = createAdapterContext({ root: ROOT, outDir: tmpdir(), cacheDir: CACHE, offline: true, ...quiet });
  const res = await loadCcd(ctx);
  assert.equal(res.rows?.length, 3);
  assert.match(res.notes![0], /3 public high schools/);
  assert.ok(res.sources.crdc, "magnet cites CRDC, so the CCD run describes that source too");
});
