/**
 * State report card adapters for Florida, Illinois, South Carolina and Connecticut (scripts/lib/high-schools/states/
 * {fl,il,sc,ct}.mts and stb-common.mts): the CCD crosswalk, each state's parsing and suppression rules, unmatched
 * rows, the EdSight guest-session download, and the committed state files. Fixture extracts live in
 * tests/fixtures/high-schools/states/{fl,il,sc,ct}/; no network. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HighSchoolStateFile } from "../lib/high-school-types.ts";
import { validateStateFile } from "../lib/high-school-core.ts";
import { STATE_ADAPTERS } from "../scripts/lib/high-schools/states/index.mts";
import type { StateAdapterResult } from "../scripts/lib/high-schools/types.mts";
import {
  StateFileBuilder,
  buildCrosswalk,
  ccdEntriesFromCsv,
  csvRows,
  recordsFrom,
  rowsFromSheetXml,
  shareCell,
  sharedStringsFromXml,
} from "../scripts/lib/high-schools/states/stb-common.mts";
import { buildScFile, scNativeKey, scSchoolId } from "../scripts/lib/high-schools/states/sc.mts";
import { buildIlFile, ilApPassRate, ilNativeKey, ilRcdts } from "../scripts/lib/high-schools/states/il.mts";
import { buildCtFile, ctNativeKey, ctSchoolCode, edsightExport, edsightRecords, satMetOrExceeded } from "../scripts/lib/high-schools/states/ct.mts";
import { buildFlFile, fetpipFromLines, flNativeKey, flSchoolId } from "../scripts/lib/high-schools/states/fl.mts";

const FIX = join(import.meta.dirname, "fixtures", "high-schools", "states");
const DATA = join(import.meta.dirname, "..", "data", "high-schools", "state");
const read = (state: string, file: string) => readFileSync(join(FIX, state, file), "latin1");
const sheet = (state: string, file: string) => csvRows(read(state, file));
const TODAY = "2026-10-05";

function crosswalkFor(state: string, key: (st: string) => string | null, shard?: Map<string, string>) {
  return buildCrosswalk(ccdEntriesFromCsv(read(state.toLowerCase(), "ccd.csv"), state), key, shard);
}

const asFile = (state: string, r: StateAdapterResult): HighSchoolStateFile => ({ state, ...r });

/* ------------------------------------------------------------------ */
/* Crosswalk                                                           */
/* ------------------------------------------------------------------ */

test("CCD extract: one state's rows, grade-12 flag from G_12_OFFERED / GSHI", () => {
  const sc = ccdEntriesFromCsv(read("sc", "ccd.csv"), "SC");
  assert.deepEqual(sc.map((e) => [e.stSchId, e.highSchool]).sort(), [
    ["SC-0160-001", true],
    ["SC-0160-003", true],
    ["SC-0160-007", false],
  ]);
  assert.equal(sc.find((e) => e.stSchId === "SC-0160-001")!.ncessch, "450069000011");
  // Another state's extract yields nothing for SC.
  assert.deepEqual(ccdEntriesFromCsv(read("fl", "ccd.csv"), "SC"), []);
});

test("native keys: each state's file id ↔ CCD ST_SCHID", () => {
  assert.equal(scNativeKey("SC-0160-001"), "0160001");
  assert.equal(scSchoolId("160001"), "0160001");
  assert.equal(scSchoolId("0160001"), "0160001");
  assert.equal(scSchoolId("abc"), null);
  assert.equal(ilNativeKey("IL-11-012-004C-26-11012004C260001"), "11012004C260001");
  assert.equal(ilRcdts("11-012-004C-26-0001"), "11012004C260001");
  assert.equal(ilRcdts("01-009-2620-26"), null);
  assert.equal(ctNativeKey("CT-0020011-0026111"), "0026111");
  assert.equal(ctSchoolCode('="0026111"'), "0026111");
  assert.equal(flNativeKey("FL-01-0151"), "010151");
  assert.equal(flSchoolId("1", "151"), "010151");
  assert.equal(flSchoolId("01", "0151"), "010151");
  assert.equal(scNativeKey("FL-01-0151"), null);
});

test("crosswalk: directory entries by native id; shard entries win and count as high schools", () => {
  const cw = crosswalkFor("SC", scNativeKey);
  assert.deepEqual(cw.get("0160001"), { ncessch: "450069000011", highSchool: true, name: "Abbeville High" });
  assert.equal(cw.get("0160007")!.highSchool, false);
  const withShard = crosswalkFor("SC", scNativeKey, new Map([["SC-0160-007", "450069000999"], ["SC-9999-001", "450000009999"]]));
  assert.deepEqual(withShard.get("0160007"), { ncessch: "450069000999", highSchool: true, name: "John C. Calhoun Elementary" });
  assert.equal(withShard.get("9999001")!.ncessch, "450000009999");
});

test("builder: values, suppressed cells, not-high-school rows skipped, unmatched listed only with a value", () => {
  const b = new StateFileBuilder(crosswalkFor("SC", scNativeKey));
  assert.equal(b.set("chronic_absence", "0160001", "Abbeville High", { value: 0.2, suppressed: false }, true), "450069000011");
  b.set("ela_proficiency", "0160001", "Abbeville High", { value: null, suppressed: true }, true);
  assert.equal(b.set("chronic_absence", "0160007", "Calhoun Elementary", { value: 0.1, suppressed: false }, true), null);
  b.set("chronic_absence", "9999001", "No Such School", { value: 0.3, suppressed: false }, true);
  b.set("chronic_absence", "9999002", "No Such Elementary", { value: 0.3, suppressed: false }, false);
  b.set("chronic_absence", "9999003", "All Stars", { value: null, suppressed: true }, true);
  const r = b.result([{ key: "x", source: "state-sc", label: "x", year: "2024–25", url: "https://example.org/", retrieved: TODAY, fields: ["ela_proficiency", "chronic_absence"] }]);
  assert.deepEqual(r.schools, { "450069000011": { ela_proficiency: null, chronic_absence: 0.2, suppressed: ["ela_proficiency"] } });
  assert.deepEqual(r.unmatched, [{ stateId: "9999001", name: "No Such School", reason: "no CCD school with this state id" }]);
  assert.deepEqual(b.stats.get("chronic_absence"), { rows: 5, matched: 1, notHigh: 1, unmatched: 3 });
});

test("xlsx sheet reader: shared strings, inline strings, numbers, gaps keep their columns", () => {
  const shared = sharedStringsFromXml('<sst><si><t>SCHOOLID</t></si><si><r><t>Abbeville</t></r><r><t xml:space="preserve"> High</t></r></si><si><t>A &amp; B</t></si></sst>');
  assert.deepEqual(shared, ["SCHOOLID", "Abbeville High", "A & B"]);
  const xml =
    '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>PctChronic_ALL</t></is></c></row>' +
    '<row r="2"><c r="A2"><v>160001</v></c><c r="B2" t="s"><v>1</v></c><c r="C2"><v>23.3</v></c></row><row r="3"/>' +
    '<row r="4"><c r="B4" t="s"><v>2</v></c><c r="C4" t="str"><v>*</v></c></row></sheetData>';
  assert.deepEqual(rowsFromSheetXml(xml, shared), [["SCHOOLID", "", "PctChronic_ALL"], ["160001", "Abbeville High", "23.3"], [], ["", "A & B", "*"]]);
  assert.deepEqual(recordsFrom(rowsFromSheetXml(xml, shared), ["SCHOOLID"])[0], { SCHOOLID: "160001", "": "Abbeville High", PctChronic_ALL: "23.3" });
});

test("shareCell: shares already on 0–1", () => {
  assert.deepEqual(shareCell("0.26928895612708017", ["*"]), { value: 0.2693, suppressed: false });
  assert.deepEqual(shareCell("*", ["*"]), { value: null, suppressed: true });
  assert.deepEqual(shareCell("29", ["*"]), { value: null, suppressed: false });
  assert.deepEqual(shareCell("", ["*"]), { value: null, suppressed: false });
});

/* ------------------------------------------------------------------ */
/* South Carolina                                                      */
/* ------------------------------------------------------------------ */

test("SC: EOC shares, Clearinghouse fall enrollment, chronic absence; '*' suppressed, N/AV missing, type H only", () => {
  const { result } = buildScFile({ eoc: sheet("sc", "eoc.csv"), college: sheet("sc", "college.csv"), chronic: sheet("sc", "chronic.csv") }, crosswalkFor("SC", scNativeKey), TODAY);
  assert.deepEqual(result.schools["450069000011"], { ela_proficiency: 0.593, math_proficiency: 0.685, nsc_enrolled_fall: 0.57, chronic_absence: 0.233 });
  // Dixie: math "*" (suppressed), college "N/AV" (missing, so absent), chronic "*"; its middle-school (M) row is ignored.
  assert.deepEqual(result.schools["450069000012"], {
    ela_proficiency: 0.838,
    math_proficiency: null,
    chronic_absence: null,
    suppressed: ["math_proficiency", "chronic_absence"],
  });
  // The elementary school maps to a CCD school without grade 12: not in the file, not unmatched.
  assert.equal(Object.keys(result.schools).length, 2);
  assert.deepEqual(result.unmatched?.map((u) => u.stateId), ["9999001"]);
  assert.deepEqual(validateStateFile(asFile("SC", result)), []);
  assert.deepEqual(result.sections.map((s) => s.fields), [["ela_proficiency", "math_proficiency"], ["nsc_enrolled_fall"], ["chronic_absence"]]);
});

/* ------------------------------------------------------------------ */
/* Illinois                                                            */
/* ------------------------------------------------------------------ */

test("IL: AP pass rate = exams scored 3+ ÷ exams taken over grades 9–12; any '*' suppresses; no exams is missing", () => {
  const row = (cells: Record<string, string>) => cells;
  assert.deepEqual(
    ilApPassRate(row({ "Total AP Exams Taken Grade 9": "58", "Total AP Exams Eligible to Earn College Credit Grade 9": "58", "Total AP Exams Taken Grade 12": "42", "Total AP Exams Eligible to Earn College Credit Grade 12": "21" })),
    { value: 0.79, suppressed: false },
  );
  assert.deepEqual(ilApPassRate(row({ "Total AP Exams Taken Grade 11": "15", "Total AP Exams Eligible to Earn College Credit Grade 11": "11", "Total AP Exams Taken Grade 10": "*" })), { value: null, suppressed: true });
  assert.deepEqual(ilApPassRate(row({})), { value: null, suppressed: false });
});

test("IL: postsecondary, AP, ACT proficiency, chronic absence by RCDTS; district/state rows ignored", () => {
  const { result } = buildIlFile({ general: sheet("il", "general.csv"), act: sheet("il", "act.csv") }, crosswalkFor("IL", ilNativeKey), TODAY);
  const ac = Object.entries(result.schools).find(([, v]) => v.chronic_absence === 0.253)!;
  assert.deepEqual(ac[1], { college_going_rate: 0.679, ap_pass_rate: null, ela_proficiency: 0.407, math_proficiency: 0.259, chronic_absence: 0.253, suppressed: ["ap_pass_rate"] });
  const stevenson = Object.values(result.schools).find((v) => v.college_going_rate === 0.873)!;
  assert.equal(stevenson.ap_pass_rate, Math.round(((58 + 1470 + 3929 + 5716) / (58 + 1512 + 4126 + 6152)) * 1e4) / 1e4);
  assert.deepEqual(stevenson.suppressed, ["math_proficiency"]);
  assert.equal(Object.keys(result.schools).length, 2, "the elementary school (no grade 12 in CCD) is skipped");
  // The unknown high school carries a value (chronic absence) and is listed; the unknown elementary isn't.
  assert.deepEqual(result.unmatched?.map((u) => [u.stateId, u.name]), [["999999999260001", "Fixture High Not In CCD"]]);
  assert.deepEqual(validateStateFile(asFile("IL", result)), []);
});

/* ------------------------------------------------------------------ */
/* Connecticut                                                         */
/* ------------------------------------------------------------------ */

test("CT: EdSight export records carry school names into continuation rows; SAT Level 3&4 % found by its group", () => {
  const recs = edsightRecords(read("ct", "sat.csv"), { met: satMetOrExceeded });
  assert.equal(recs.length, 6);
  assert.deepEqual([recs[1].School, recs[1]["School Code"], recs[1].Subject, recs[1].met], ["Ansonia High School", '="0026111"', "Math", "9.9"]);
  assert.equal(recs[2].met, "85.4");
});

test("CT: entrance, persistence (one class older), chronic absence, SAT; '*' suppressed, N/A missing", () => {
  const { result } = buildCtFile(
    { entrance: read("ct", "entrance.csv"), persistence: read("ct", "persistence.csv"), chronic: read("ct", "chronic.csv"), sat: read("ct", "sat.csv") },
    crosswalkFor("CT", ctNativeKey),
    TODAY,
  );
  const ansonia = Object.values(result.schools).find((v) => v.chronic_absence === 0.233)!;
  assert.deepEqual(ansonia, { college_going_rate: 0.589, nsc_persisted: 0.775, chronic_absence: 0.233, ela_proficiency: null, math_proficiency: 0.099, suppressed: ["ela_proficiency"] });
  const avon = Object.values(result.schools).find((v) => v.college_going_rate === 0.862)!;
  assert.deepEqual(avon, { college_going_rate: 0.862, nsc_persisted: 0.963, chronic_absence: null, ela_proficiency: 0.854, math_proficiency: 0.693, suppressed: ["chronic_absence"] });
  const prince = Object.values(result.schools).find((v) => v.nsc_persisted === 0.712)!;
  assert.deepEqual(prince.suppressed, ["college_going_rate"]);
  assert.equal(Object.keys(result.schools).length, 3, "Mead School (elementary) and unmapped programs stay out");
  // Windrose isn't in the CCD extract: listed (it has an entrance rate); the all-"*" facility isn't.
  assert.deepEqual(result.unmatched?.map((u) => u.stateId), ["0571511"]);
  assert.deepEqual(validateStateFile(asFile("CT", result)), []);
});

test("CT: edsightExport opens a guest session (cookies across redirects), follows the export link, caches it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hs-ct-"));
  const seen: { url: string; cookie: string | null }[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const cookie = new Headers(init?.headers).get("cookie");
    seen.push({ url, cookie });
    if (url.includes("/guest?")) {
      if (!cookie?.includes("JSESSIONID=abc")) return new Response(null, { status: 302, headers: { location: "/SASLogon/login?service=x", "set-cookie": "JSESSIONID=abc; Path=/" } });
      return new Response('<a TARGET=_self href=https://edsight.ct.gov/SASStoredProcess/do?_program=/X/ChronicAbsenteeismExport&amp;_year=2024-25>Export .csv file</a>');
    }
    if (url.includes("/SASLogon/")) return new Response(null, { status: 302, headers: { location: "https://edsight.ct.gov/SASStoredProcess/guest?_program=again", "set-cookie": "TGC=t; Path=/" } });
    if (url.includes("ChronicAbsenteeismExport")) {
      assert.equal(url, "https://edsight.ct.gov/SASStoredProcess/do?_program=/X/ChronicAbsenteeismExport&_year=2024-25");
      return new Response(cookie?.includes("TGC=t") ? read("ct", "chronic.csv") : "login page");
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    const ctx = { cacheDir: dir, offline: false, log: () => {} };
    const path = await edsightExport(ctx, "ChronicAbsenteeismReport_SiteCore", { _year: "2024-25" }, "ct-test.csv", fake);
    assert.match(readFileSync(path, "latin1"), /Ansonia High School/);
    assert.ok(existsSync(`${path}.url`));
    const calls = seen.length;
    await edsightExport(ctx, "ChronicAbsenteeismReport_SiteCore", { _year: "2024-25" }, "ct-test.csv", fake);
    assert.equal(seen.length, calls, "cached: no second download");
    await assert.rejects(edsightExport({ ...ctx, offline: true }, "R", {}, "missing.csv", fake), /--offline/);
    const noLink = (async () => new Response("<html>no export here</html>")) as unknown as typeof fetch;
    await assert.rejects(edsightExport(ctx, "R", {}, "nolink.csv", noLink), /no export link/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Florida                                                             */
/* ------------------------------------------------------------------ */

test("FL: FETPIP page → continuing ÷ graduates; '****' suppressed; '-' is none", () => {
  const page = (total: string, cont: string) => ["010151 GAINESVILLE HIGH SCHOOL", `TOTAL INDIVIDUALS | ${total} | TOTAL WITH OUTCOME DATA | 279 | 86%`, `EMPLOYED/ALL | 165 | 51% | TOTAL CONTINUING THEIR EDUCATION (Unduplicated) | ${cont} | 62%`];
  assert.deepEqual(fetpipFromLines(page("326", "201")), { id: "010151", name: "GAINESVILLE HIGH SCHOOL", total: 326, cell: { value: 0.6166, suppressed: false } });
  assert.deepEqual(fetpipFromLines(page("1,026", "-"))!.cell, { value: 0, suppressed: false });
  assert.deepEqual(fetpipFromLines(page("****", "-"))!.cell, { value: null, suppressed: true });
  assert.deepEqual(fetpipFromLines(page("40", "****"))!.cell, { value: null, suppressed: true });
  assert.equal(fetpipFromLines(["Division of Public Schools"]), null);
});

test("FL: FETPIP, School Grades achievement, absent 10%+; virtual-provider rows skipped", () => {
  const fetpip = read("fl", "fetpip.txt")
    .split("=== page ===")
    .map((p) => p.split("\n").filter(Boolean))
    .filter((p) => p.length);
  const { result } = buildFlFile({ grades: sheet("fl", "grades.csv"), absence: sheet("fl", "absence.csv"), fetpip }, crosswalkFor("FL", flNativeKey), TODAY);
  assert.deepEqual(result.schools["120003000013"], { college_going_rate: 0.6166, ela_proficiency: 0.58, math_proficiency: 0.5, chronic_absence: 0.2693 });
  const eastside = Object.values(result.schools).find((v) => v.ela_proficiency === 0.47)!;
  assert.deepEqual(eastside, { college_going_rate: 0.5561, ela_proficiency: 0.47, math_proficiency: 0.41, chronic_absence: 0.3974 });
  const quinn = Object.entries(result.schools).find(([, v]) => v.suppressed?.includes("college_going_rate"))!;
  assert.deepEqual(quinn[1], { college_going_rate: null, chronic_absence: null, suppressed: ["college_going_rate", "chronic_absence"] });
  assert.equal(Object.keys(result.schools).length, 3, "the elementary school is skipped in every file");
  assert.deepEqual(result.unmatched?.map((u) => u.stateId), ["990001"]);
  assert.deepEqual(validateStateFile(asFile("FL", result)), []);
});

/* ------------------------------------------------------------------ */
/* Guards and committed files                                          */
/* ------------------------------------------------------------------ */

test("validateStateFile catches a broken state file (percent not share, suppressed with a value, uncited field, wrong source)", () => {
  const good = asFile(
    "SC",
    buildScFile({ eoc: sheet("sc", "eoc.csv"), college: sheet("sc", "college.csv"), chronic: sheet("sc", "chronic.csv") }, crosswalkFor("SC", scNativeKey), TODAY).result,
  );
  assert.deepEqual(validateStateFile(good), []);
  const broken = (mutate: (f: HighSchoolStateFile) => void) => {
    const f = structuredClone(good);
    mutate(f);
    return validateStateFile(f);
  };
  assert.ok(broken((f) => (f.schools["450069000011"].ela_proficiency = 59.3)).some((p) => /0–1 share/.test(p)));
  assert.ok(broken((f) => (f.schools["450069000012"].math_proficiency = 0.5)).some((p) => /suppressed but has a value/.test(p)));
  assert.ok(broken((f) => (f.schools["450069000011"].ap_pass_rate = 0.5)).some((p) => /no section citing it/.test(p)));
  assert.ok(broken((f) => (f.sections[0].source = "state-fl")).some((p) => /cites state-sc/.test(p)));
  assert.ok(broken((f) => (f.schools["120003000013"] = { chronic_absence: 0.2 })).some((p) => /FL school/.test(p)));
  assert.ok(broken((f) => (f.sections[1].fields = ["ela_proficiency"])).some((p) => /already in another section/.test(p)));
});

test("adapters: FL, IL, SC, CT are built", () => {
  for (const code of ["fl", "il", "sc", "ct"]) assert.equal(STATE_ADAPTERS[code].built, true, code);
});

test("committed state files: valid, one per state, every field cited and dated", () => {
  for (const code of ["fl", "il", "sc", "ct"]) {
    const path = join(DATA, `${code}.json`);
    if (!existsSync(path)) continue; // the generated file arrives with the data commit
    const file = JSON.parse(readFileSync(path, "utf8")) as HighSchoolStateFile;
    assert.deepEqual(validateStateFile(file, { fileName: `${code}.json` }), [], code);
    assert.ok(Object.keys(file.schools).length > 100, `${code}: ${Object.keys(file.schools).length} schools`);
    for (const s of file.sections) assert.ok(s.notes && s.notes.length > 40, `${code} ${s.key}: notes record the definition`);
  }
});
