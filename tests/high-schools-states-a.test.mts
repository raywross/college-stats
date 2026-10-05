/**
 * State report card adapters for California, Texas, and New York (scripts/lib/high-schools/states/{ca,tx,ny}.mts and
 * sta-common.mts): parsing each state's files, its privacy codes, the CCD crosswalk (state id → ncessch, high schools
 * only), `unmatched`, section citations, and validateStateFile catching a broken file. Small extracts of the real
 * files live in tests/fixtures/high-schools/states/{ca,tx,ny}/ (TX adds one made-up campus that isn't in CCD); no
 * network, no mdbtools. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HighSchool, HighSchoolStateFile } from "../lib/high-school-types.ts";
import { blankHighSchool, validateStateFile } from "../lib/high-school-core.ts";
import { STATE_ADAPTERS } from "../scripts/lib/high-schools/states/index.mts";
import {
  StateFileBuilder,
  crosswalkFromCcd,
  crosswalkFromShards,
  localSchoolId,
  schoolYear,
  shareOf,
  springYear,
  type Crosswalk,
} from "../scripts/lib/high-schools/states/sta-common.mts";
import { SCHOOL_CODE_WIDTH, buildCa } from "../scripts/lib/high-schools/states/ca.mts";
import { CAMPUS_WIDTH, buildTx, taprKeys, taprUrl } from "../scripts/lib/high-schools/states/tx.mts";
import { AP_MIN_COVERAGE, BEDS_WIDTH, NY_URLS, buildNy, isSchoolBeds, parseChronic } from "../scripts/lib/high-schools/states/ny.mts";

const FIX = join(import.meta.dirname, "fixtures", "high-schools", "states");
const read = (state: string, file: string) => readFileSync(join(FIX, state, file), "latin1");
const xw = (state: string, width: number) => crosswalkFromCcd(read(state, "ccd.csv"), state.toUpperCase(), width);

function asFile(state: string, out: Pick<HighSchoolStateFile, "sections" | "schools" | "unmatched">): HighSchoolStateFile {
  return { state, sections: out.sections, schools: out.schools, unmatched: out.unmatched };
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

test("localSchoolId takes the state's own id from CCD ST_SCHID, whatever the prefix", () => {
  assert.equal(localSchoolId("CA-1975309-1995786", 7), "1995786");
  assert.equal(localSchoolId("CA-0130625-0130625", 7), "0130625", "a California charter: school code as the district");
  assert.equal(localSchoolId("19-64733-1900001", 7), "1900001");
  assert.equal(localSchoolId("TX-054901-054901001", 9), "054901001");
  assert.equal(localSchoolId("NY-211003040000-211003040002", 12), "211003040002");
  assert.equal(localSchoolId("TX-12", 9), null);
});

test("shareOf: exact ratio from counts, privacy codes, small denominators, and the printed percent as a fallback", () => {
  const codes = { suppressed: ["*", "-1", "s"] };
  assert.deepEqual(shareOf({ num: "8", den: "14", pct: "57.1" }, codes), { value: 0.5714, suppressed: false });
  assert.deepEqual(shareOf({ num: "*", den: "*", pct: "*" }, codes), { value: null, suppressed: true });
  assert.deepEqual(shareOf({ num: "s", den: "3", pct: "s" }, codes), { value: null, suppressed: true });
  assert.deepEqual(shareOf({ num: "2", den: "4", pct: "50" }, codes), { value: null, suppressed: true }, "fewer than 5 students");
  assert.deepEqual(shareOf({ num: "0", den: "0", pct: "" }, codes), { value: null, suppressed: false }, "no students: missing");
  assert.deepEqual(shareOf({ num: "-3", den: "-3", pct: "88.9" }, codes), { value: 0.889, suppressed: false }, "TEA's complementary mask keeps the rate");
  assert.deepEqual(shareOf({ num: "8", den: "6", pct: "-2" }, codes), { value: null, suppressed: false }, "numerator above denominator: abnormal");
  assert.deepEqual(shareOf({ pct: "40" }, codes), { value: 0.4, suppressed: false });
  assert.deepEqual(shareOf({ pct: "140" }, codes), { value: null, suppressed: false });
  assert.deepEqual(shareOf({ num: "1,204", den: "2,000" }, codes), { value: 0.602, suppressed: false });
  assert.deepEqual(shareOf({}, codes), { value: null, suppressed: false });
});

test("school years: '2022-23' and spring years become labels", () => {
  assert.equal(schoolYear("2022-23"), "2022–23");
  assert.equal(schoolYear("2024-2025"), "2024–25");
  assert.equal(schoolYear("2025"), "2024–25");
  assert.equal(springYear("2022-23"), "2023");
  assert.throws(() => schoolYear("Class of 2024"));
});

test("crosswalk from CCD keeps state ids, flags closed schools and schools without grade 12, prefers an open duplicate", () => {
  const csv = [
    "ST,ST_SCHID,NCESSCH,SCH_NAME,SY_STATUS,GSLO,GSHI,G_12_OFFERED",
    "TX,TX-000001-000001001,480000000001,Old High,2,M,M,No",
    "TX,TX-000001-000001001,480000000002,New High,1,09,12,Yes",
    "TX,TX-000001-000001041,480000000003,A Middle,1,06,08,No",
    "TX,TX-000001-000001042,480000000004,K-12 Academy,1,KG,12,",
    "TX,TX-000001-000001043,480000000005,Closed High,6,09,12,Yes",
    "CA,CA-0000001-0000099,060000000099,Elsewhere,1,09,12,Yes",
  ].join("\n");
  const x = crosswalkFromCcd(csv, "TX", 9);
  assert.equal(x.from, "ccd");
  assert.equal(x.schools.size, 4);
  assert.deepEqual(x.schools.get("000001001"), { ncessch: "480000000002", name: "New High", highSchool: true, open: true });
  assert.equal(x.schools.get("000001041")!.highSchool, false);
  assert.equal(x.schools.get("000001042")!.highSchool, true, "a GSLO–GSHI span through 12 counts when G_12_OFFERED is blank");
  assert.equal(x.schools.get("000001043")!.open, false);
});

test("crosswalk from the shards (once the federal sync has run) uses ctx.crosswalk and treats every row as a high school", () => {
  const row: HighSchool = { ...blankHighSchool("480000000002", "public", "New High", "TX"), state_school_id: "TX-000001-000001001", grades: { low: "9", high: "12" } };
  const x = crosswalkFromShards({ crosswalk: new Map([["TX-000001-000001001", "480000000002"]]), rows: [row] }, 9);
  assert.equal(x.from, "shards");
  assert.deepEqual(x.schools.get("000001001"), { ncessch: "480000000002", name: "New High", highSchool: true, open: true });
});

test("StateFileBuilder files values by ncessch, lists unmapped high-school rows, counts the rest", () => {
  const x: Crosswalk = {
    from: "ccd",
    schools: new Map([
      ["1", { ncessch: "480000000001", name: "H", highSchool: true, open: true }],
      ["2", { ncessch: "480000000002", name: "M", highSchool: false, open: true }],
      ["3", { ncessch: "480000000003", name: "C", highSchool: true, open: false }],
    ]),
  };
  const b = new StateFileBuilder(x);
  b.set("1", "H", "ap_pass_rate", { value: 0.5, suppressed: false }, { hsOnly: true });
  b.set("1", "H", "chronic_absence", { value: null, suppressed: true }, { hsOnly: false });
  b.set("1", "H", "ela_proficiency", { value: null, suppressed: false }, { hsOnly: true });
  b.set("2", "M", "math_proficiency", { value: 0.4, suppressed: false }, { hsOnly: true });
  b.set("3", "C", "math_proficiency", { value: 0.4, suppressed: false }, { hsOnly: true });
  b.set("9", "Gone", "ap_pass_rate", { value: 0.2, suppressed: false }, { hsOnly: true, stateId: "TX-9" });
  b.set("8", "Elementary", "chronic_absence", { value: 0.2, suppressed: false }, { hsOnly: false });
  const { schools, unmatched } = b.result();
  assert.deepEqual(schools, { "480000000001": { ap_pass_rate: 0.5, chronic_absence: null, suppressed: ["chronic_absence"] } });
  assert.deepEqual(unmatched, [{ stateId: "TX-9", name: "Gone", reason: "no CCD school with this state id" }]);
  assert.equal(b.stats.math_proficiency.notHighSchool, 1);
  assert.equal(b.stats.math_proficiency.closed, 1);
  assert.equal(b.stats.chronic_absence.noMatch, 1);
  assert.equal(b.suppressedShare("chronic_absence"), 1);
});

/* ------------------------------------------------------------------ */
/* California                                                          */
/* ------------------------------------------------------------------ */

function ca() {
  return buildCa(
    {
      cgr: { text: read("ca", "cgr12mo23.txt"), url: "https://www3.cde.ca.gov/demo-downloads/cgr/cgr12mo23.txt", retrieved: "2026-10-05" },
      caaspp: { text: read("ca", "sb_ca2025_1.txt"), entities: read("ca", "sb_ca2025entities.txt"), url: "https://caaspp-elpac.ets.org/caaspp/researchfiles/sb_ca2025_1_csv_v1.zip", retrieved: "2026-10-05" },
      absence: { text: read("ca", "chronicabsenteeism25.txt"), url: "https://www3.cde.ca.gov/demo-downloads/attendance/chronicabsenteeism25.txt", retrieved: "2026-10-05" },
    },
    xw("ca", SCHOOL_CODE_WIDTH),
  );
}

test("CA: college-going, grade 11 CAASPP, and grades 9–12 chronic absence by ncessch, with CDE's * suppressed", () => {
  const out = ca();
  assert.deepEqual(out.schools["069105109264"], {
    college_going_rate: 0.5714, // 8 of 14 completers
    ela_proficiency: null,
    math_proficiency: null,
    chronic_absence: 0.1744, // grades 9–12 (15 of 86), not the school total (15 of 93)
    suppressed: ["ela_proficiency", "math_proficiency"],
  });
  assert.deepEqual(out.schools["069105106830"], { college_going_rate: 0.5, ela_proficiency: 0.0909, math_proficiency: null, chronic_absence: 0.8785, suppressed: ["math_proficiency"] });
  assert.deepEqual(out.schools["060780000750"], { college_going_rate: null, chronic_absence: 0.3333, suppressed: ["college_going_rate"] });
  assert.deepEqual(out.schools["060163508674"], { college_going_rate: 0.2683 }, "a charter CCD files under its own code (CA-0130625-0130625) still matches");
  assert.equal(out.schools["060155611883"], undefined, "a K–9 school (no grade 12) is left out");
  assert.equal(Object.keys(out.schools).length, 4);
  assert.deepEqual(out.unmatched, [{ stateId: "19101990100776", name: "North Valley Military Institute College Preparatory Academy", reason: "no CCD school with this state id" }]);
  assert.ok(!out.unmatched!.some((u) => /District (Office|Level Program)/.test(u.name)), "district rows aren't schools, so they aren't unmatched");
});

test("CA: sections cite CDE with years read from the files", () => {
  const { sections } = ca();
  assert.deepEqual(sections.map((s) => [s.key, s.year, s.fields]), [
    ["college-going", "Class of 2023", ["college_going_rate"]],
    ["caaspp", "2024–25", ["ela_proficiency", "math_proficiency"]],
    ["chronic-absence", "2024–25", ["chronic_absence"]],
  ]);
  assert.ok(sections.every((s) => s.source === "state-ca" && s.notes && s.notes.includes("https://")));
  assert.deepEqual(validateStateFile(asFile("CA", ca())), []);
});

/* ------------------------------------------------------------------ */
/* Texas                                                               */
/* ------------------------------------------------------------------ */

function tx() {
  return buildTx(
    {
      ccyy: "2025",
      retrieved: "2026-10-05",
      files: { TXIHE: read("tx", "tapr-txihe.csv"), APIB: read("tx", "tapr-apib.csv"), STAAR_EOC: read("tx", "tapr-staar_eoc.csv"), DROP_ATT: read("tx", "tapr-drop_att.csv") },
    },
    xw("tx", CAMPUS_WIDTH),
  );
}

test("TX: TAPR datasets by ncessch, -1 masks suppressed, middle and elementary campuses left out", () => {
  const out = tx();
  assert.deepEqual(out.schools["483405003788"], { college_going_rate: 0.3991, ap_pass_rate: 0.9091, ela_proficiency: 0.5709, math_proficiency: 0.4636, chronic_absence: 0.1518 });
  assert.deepEqual(out.schools["481977001939"], { college_going_rate: 0.4222, ap_pass_rate: null, ela_proficiency: 0.7121, math_proficiency: 0.2264, chronic_absence: 0.1612, suppressed: ["ap_pass_rate"] });
  assert.equal(out.schools["480828000194"].ap_pass_rate, 0.2222, "4 of 18 examinees: a small numerator over a denominator of 5+ is shown");
  assert.equal(Object.keys(out.schools).length, 3, "Elkhart Middle (Algebra I) and Cayuga Elementary (absence) aren't high schools");
  assert.deepEqual(out.unmatched, [{ stateId: "999999901", name: "FIXTURE CAMPUS NOT IN CCD", reason: "no CCD school with this state id" }]);
  assert.equal(out.builder.stats.chronic_absence.noMatch, 1, "an all-grades measure counts unmapped campuses without listing them");
});

test("TX: sections, years from TEA's headers, and the TAPR download request", () => {
  const { sections } = tx();
  assert.deepEqual(sections.map((s) => [s.key, s.year, s.fields]), [
    ["tx-ihe", "Class of 2022", ["college_going_rate"]],
    ["ap-ib", "2023–24", ["ap_pass_rate"]],
    ["staar-eoc", "2024–25", ["ela_proficiency", "math_proficiency"]],
    ["chronic-absence", "2023–24", ["chronic_absence"]],
  ]);
  assert.match(sections[0].notes!, /Texas public or independent college/);
  assert.match(sections[1].notes!, /AP and IB are combined/);
  assert.deepEqual(validateStateFile(asFile("TX", tx())), []);
  assert.deepEqual(taprKeys("APIB", "2025"), ["0BKA24"]);
  assert.deepEqual(taprKeys("TXIHE", "2025"), ["HEE23"]);
  const url = new URL(taprUrl("STAAR_EOC", "2025"));
  assert.equal(url.host, "rptsvr1.tea.texas.gov");
  assert.deepEqual(url.searchParams.getAll("key"), ["00AR212|00AR210", "00AA112|00AA110"]);
  assert.equal(url.searchParams.get("datafmt"), "csv");
});

/* ------------------------------------------------------------------ */
/* New York                                                            */
/* ------------------------------------------------------------------ */

function ny() {
  return buildNy(
    {
      src: { postsecondary: read("ny", "postsecondary.csv"), cohort: read("ny", "cohort-regents.csv"), chronic: read("ny", "chronic.csv"), url: NY_URLS.src("2025"), retrieved: "2026-10-05" },
      apib: { exams: read("ny", "ap-exams.csv"), url: NY_URLS.apib("2025"), retrieved: "2026-10-05" },
    },
    xw("ny", BEDS_WIDTH),
  );
}

test("NY: newest class, cohort, and year; NYSED's s suppressed; state and district rows skipped", () => {
  const out = ny();
  assert.deepEqual(out.schools["360246000014"], { college_going_rate: 0.567, ela_proficiency: 0.6841, math_proficiency: 0.4726, chronic_absence: 0.3895 });
  assert.deepEqual(out.schools["360094505946"], { college_going_rate: 0.561, ela_proficiency: 0.7656, math_proficiency: 0.3125, chronic_absence: 0.4082 });
  assert.deepEqual(out.schools["360300000076"], { college_going_rate: null, ela_proficiency: 1, math_proficiency: 1, chronic_absence: 0.4, suppressed: ["college_going_rate"] }, "3 graduates: suppressed");
  assert.deepEqual(out.unmatched, [], "the state (111111111111) and districts (…0000) aren't schools");
});

test("NY: AP pass rate sums every exam; withheld when suppressed cells hide too many exams", () => {
  const out = ny();
  assert.equal(out.schools["360007706466"].ap_pass_rate, 0.5, "16 of the 32 reported exams (1 hidden of 33)");
  assert.deepEqual(out.schools["361203006337"], { ap_pass_rate: null, suppressed: ["ap_pass_rate"] }, `13 of 20 exams reported is under ${AP_MIN_COVERAGE * 100}%`);
});

test("NY: sections and years; zero enrollment ('s' in ENROLLMENT) is missing, not suppressed", () => {
  const { sections } = ny();
  assert.deepEqual(sections.map((s) => [s.key, s.year, s.fields]), [
    ["postsecondary", "Class of 2024", ["college_going_rate"]],
    ["regents-cohort", "2021 cohort (entered grade 9 in 2021–22, results through 2024–25)", ["ela_proficiency", "math_proficiency"]],
    ["chronic-absence", "2024–25", ["chronic_absence"]],
    ["ap", "2024–25", ["ap_pass_rate"]],
  ]);
  assert.deepEqual(validateStateFile(asFile("NY", ny())), []);
  assert.ok(isSchoolBeds("010100010034") && !isSchoolBeds("010100010000") && !isSchoolBeds("111111111111") && !isSchoolBeds("000000000001"));
  const x: Crosswalk = { from: "ccd", schools: new Map([["010100010034", { ncessch: "360246000014", name: "A", highSchool: true, open: true }]]) };
  const b = new StateFileBuilder(x);
  parseChronic('ENTITY_CD,ENTITY_NAME,YEAR,SUBJECT,SUBGROUP_NAME,ENROLLMENT,ABSENT_COUNT,ABSENT_RATE\n"010100010034","A","2025","HS_CA","All Students","s","s","s"\n', b);
  assert.deepEqual(b.result().schools, {});
  assert.equal(NY_URLS.src("2025"), "https://data.nysed.gov/files/essa/24-25/SRC2025.zip");
  assert.equal(NY_URLS.apib("2025"), "https://data.nysed.gov/files/apib/2425/APIB25.zip");
});

/* ------------------------------------------------------------------ */
/* Guards and registry                                                 */
/* ------------------------------------------------------------------ */

test("validateStateFile catches a broken state file built from these adapters", () => {
  const good = asFile("TX", tx());
  const shareOver1 = structuredClone(good);
  shareOver1.schools["483405003788"].ap_pass_rate = 90.9; // a percent, not a share
  assert.ok(validateStateFile(shareOver1).some((p) => /0–1 share/.test(p)));
  const uncited = structuredClone(good);
  uncited.sections = uncited.sections.filter((s) => s.key !== "ap-ib");
  assert.ok(validateStateFile(uncited).some((p) => /ap_pass_rate has no section citing it/.test(p)));
  const wrongState = structuredClone(good);
  wrongState.schools["060163508674"] = { college_going_rate: 0.3 };
  assert.ok(validateStateFile(wrongState).some((p) => /is a CA school/.test(p)));
  const suppressedWithValue = structuredClone(good);
  suppressedWithValue.schools["481977001939"].ap_pass_rate = 0.5;
  assert.ok(validateStateFile(suppressedWithValue).some((p) => /suppressed but has a value/.test(p)));
  const noYear = structuredClone(good);
  noYear.sections[0].year = "";
  assert.ok(validateStateFile(noYear).some((p) => /no year/.test(p)));
});

test("CA, TX, and NY adapters are built and cite their own state source", () => {
  for (const [code, source] of [["ca", "state-ca"], ["tx", "state-tx"], ["ny", "state-ny"]] as const) {
    const a = STATE_ADAPTERS[code];
    assert.equal(a.built, true, code);
    assert.equal(a.source, source);
    assert.equal(a.state, code.toUpperCase());
  }
});

test("the committed CA, TX, and NY state files are valid and carry their sections", () => {
  const dir = join(import.meta.dirname, "..", "data", "high-schools", "state");
  for (const code of ["ca", "tx", "ny"]) {
    const path = join(dir, `${code}.json`);
    if (!existsSync(path)) continue;
    const file = JSON.parse(readFileSync(path, "utf8")) as HighSchoolStateFile;
    assert.deepEqual(validateStateFile(file, { fileName: `${code}.json` }), [], code);
    assert.ok(Object.keys(file.schools).length > 500, `${code}: a full state's high schools`);
    assert.ok(file.sections.some((s) => s.fields.includes("college_going_rate")), `${code}: college-going section`);
  }
});
