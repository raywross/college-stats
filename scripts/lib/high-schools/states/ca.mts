/**
 * California state report card adapter. Writes data/high-schools/state/ca.json through
 * `npm run sync-hs-states -- --state ca`.
 *
 * Files (California Department of Education downloads; the newest on 2026-10-05, override with the flags):
 *   - College-Going Rate, 12 months: www3.cde.ca.gov/demo-downloads/cgr/cgr12mo{yy}.txt (tab-delimited)  --cgr 23
 *   - CAASPP Smarter Balanced research file, all students: caaspp-elpac.ets.org …/sb_ca{yyyy}_1_csv_v1.zip
 *     (caret-delimited)                                                                       --caaspp 2025
 *   - Chronic absenteeism: www3.cde.ca.gov/demo-downloads/attendance/chronicabsenteeism{yy}.txt   --absence 25
 *
 * Fields: college_going_rate, ela_proficiency, math_proficiency (grade 11), chronic_absence (grades 9–12).
 * Not delivered: ap_pass_rate (CDE stopped publishing AP results files after 2018–19), the Dashboard's College/Career
 * Indicator (a different measure: "prepared", not enrolled), Clearinghouse persistence (not published by school).
 * Privacy: CDE prints "*" for groups of 10 or fewer students; those cells are suppressed.
 * School ids: the 7-digit school code (last part of the CDS code), unique statewide; matched to the trailing 7 digits of
 * CCD ST_SCHID (charters there carry their school code as the district: "CA-0130625-0130625"). `unmatched` shows the
 * full 14-digit CDS code.
 */
import { readFileSync } from "node:fs";
import type { HsStateField, HsStateSection } from "../../../../lib/high-school-types.ts";
import type { StateAdapter, StateAdapterResult, StateContext } from "../types.mts";
import { StateFileBuilder, flag, forEachDelimitedRow, loadCrosswalk, retrievedDate, schoolYear, shareOf, springYear, type Crosswalk, type Share } from "./sta-common.mts";

const CODES = { suppressed: ["*"] } as const;
/** California's 7-digit school code (the last part of the CDS code), unique statewide. */
export const SCHOOL_CODE_WIDTH = 7;
/** CDE's placeholder school codes: district office (0000000) and nonpublic, nonsectarian schools (0000001). */
const NOT_A_SCHOOL = /^000000[01]$/;

export const CA_URLS = {
  cgr: (yy: string) => `https://www3.cde.ca.gov/demo-downloads/cgr/cgr12mo${yy}.txt`,
  caaspp: (yyyy: string) => `https://caaspp-elpac.ets.org/caaspp/researchfiles/sb_ca${yyyy}_1_csv_v1.zip`,
  absence: (yy: string) => `https://www3.cde.ca.gov/demo-downloads/attendance/chronicabsenteeism${yy}.txt`,
};
const PAGES = {
  cgr: "https://www.cde.ca.gov/ds/ad/filescgr12.asp",
  caaspp: "https://caaspp-elpac.ets.org/caaspp/ResearchFileListSB",
  absence: "https://www.cde.ca.gov/ds/ad/filesabd.asp",
};

const cds = (county: string, district: string, school: string) => `${county.padStart(2, "0")}${district.padStart(5, "0")}${school.padStart(7, "0")}`;

/**
 * File a school row's value by its school code. Skipped: CDE's placeholders (district office, nonpublic schools) and
 * CAASPP's "District Level Program" rows, whose school code repeats the county-district code ("0161119 0161119").
 */
function file(b: StateFileBuilder, cdsCode: string, name: string, field: HsStateField, share: Share): void {
  const code = cdsCode.slice(-SCHOOL_CODE_WIDTH);
  if (NOT_A_SCHOOL.test(code) || code === cdsCode.slice(0, 7)) return;
  b.set(code, name, field, share, { hsOnly: true, stateId: cdsCode });
}

/** CGR 12-month file: school rows, all students, all completers. Returns the class label ("Class of 2023"). */
export function parseCgr(text: string, b: StateFileBuilder): string {
  let year = "";
  forEachDelimitedRow(text, "\t", (r) => {
    if (r.AggregateLevel !== "S" || r.ReportingCategory !== "TA" || r.CompleterType !== "TA") return;
    year ||= r.AcademicYear;
    const share = shareOf({ num: r["Enrolled In College - Total (12 Months)"], den: r["High School Completers"], pct: r["College Going Rate - Total (12 Months)"] }, CODES);
    file(b, cds(r.CountyCode, r.DistrictCode, r.SchoolCode), r.SchoolName, "college_going_rate", share);
  });
  if (!year) throw new Error("CGR file has no school rows (ReportingCategory TA, CompleterType TA)");
  return `Class of ${springYear(year)}`;
}

/** CAASPP research file: school rows, all students (group 1), grade 11, Smarter Balanced ELA (test 1) and math (test 2). */
export function parseCaaspp(text: string, b: StateFileBuilder, names: ReadonlyMap<string, string> = new Map()): string {
  let year = "";
  forEachDelimitedRow(text, "^", (r) => {
    if (r["Student Group ID"] !== "1" || r.Grade !== "11" || r["Test Type"] !== "B") return;
    const field = r["Test ID"] === "1" ? "ela_proficiency" : r["Test ID"] === "2" ? "math_proficiency" : null;
    if (!field) return;
    year ||= r["Test Year"];
    const id = cds(r["County Code"], r["District Code"], r["School Code"]);
    const share = shareOf({ num: r["Count Standard Met and Above"], den: r["Total Students Tested with Scores"], pct: r["Percentage Standard Met and Above"] }, CODES);
    file(b, id, names.get(id) ?? "", field, share);
  });
  if (!year) throw new Error("CAASPP file has no grade 11 school rows");
  return schoolYear(year);
}

/** CAASPP entities file (school names; the score file leaves them out): CDS → name. */
export function parseCaasppEntities(text: string): Map<string, string> {
  const names = new Map<string, string>();
  forEachDelimitedRow(text, "^", (r) => {
    if (!/^0+$/.test(r["School Code"] ?? "0")) names.set(cds(r["County Code"], r["District Code"], r["School Code"]), r["School Name"]);
  });
  return names;
}

/** Chronic absenteeism file: school rows, students in grades 9–12 (reporting category GR912). */
export function parseAbsence(text: string, b: StateFileBuilder): string {
  let year = "";
  forEachDelimitedRow(text, "\t", (r) => {
    if (r["Aggregate Level"] !== "S" || r["Reporting Category"] !== "GR912") return;
    year ||= r["Academic Year"];
    const share = shareOf({ num: r.ChronicAbsenteeismCount, den: r.ChronicAbsenteeismEligibleCumulativeEnrollment, pct: r.ChronicAbsenteeismRate }, CODES);
    file(b, cds(r["County Code"], r["District Code"], r["School Code"]), r["School Name"], "chronic_absence", share);
  });
  if (!year) throw new Error("chronic absenteeism file has no grade 9–12 school rows");
  return schoolYear(year);
}

export interface CaInputs {
  cgr: { text: string; url: string; retrieved: string };
  caaspp: { text: string; entities: string; url: string; retrieved: string };
  absence: { text: string; url: string; retrieved: string };
}

/** The state file from the three files' text (no network; tests call this). */
export function buildCa(inputs: CaInputs, crosswalk: Crosswalk): StateAdapterResult & { builder: StateFileBuilder } {
  const b = new StateFileBuilder(crosswalk);
  const cgrYear = parseCgr(inputs.cgr.text, b);
  const testYear = parseCaaspp(inputs.caaspp.text, b, parseCaasppEntities(inputs.caaspp.entities));
  const absenceYear = parseAbsence(inputs.absence.text, b);
  const sections: HsStateSection[] = [
    {
      key: "college-going",
      source: "state-ca",
      label: "California Department of Education, College-Going Rate (12 months)",
      year: cgrYear,
      url: PAGES.cgr,
      retrieved: inputs.cgr.retrieved,
      fields: ["college_going_rate"],
      notes:
        "Share of the school's high school completers (all completer types) who enrolled in any public or private, in-state or out-of-state U.S. college within 12 months of completing high school, as CDE matches them to college enrollment records (National Student Clearinghouse and California's public college systems). Computed from the file's enrolled and completer counts. " +
        `File: ${inputs.cgr.url}. Groups of 10 or fewer completers are suppressed by CDE (*).`,
    },
    {
      key: "caaspp",
      source: "state-ca",
      label: "California Assessment of Student Performance and Progress (CAASPP), grade 11",
      year: testYear,
      url: PAGES.caaspp,
      retrieved: inputs.caaspp.retrieved,
      fields: ["ela_proficiency", "math_proficiency"],
      notes:
        "Share of the school's grade 11 students tested with scores who met or exceeded the standard on the Smarter Balanced ELA and mathematics tests (all students). " +
        `File: ${inputs.caaspp.url}. Groups of 10 or fewer students tested are suppressed (*).`,
    },
    {
      key: "chronic-absence",
      source: "state-ca",
      label: "California Department of Education, chronic absenteeism, grades 9–12",
      year: absenceYear,
      url: PAGES.absence,
      retrieved: inputs.absence.retrieved,
      fields: ["chronic_absence"],
      notes:
        "Share of the school's students in grades 9–12 enrolled at least 31 days who were absent for 10% or more of the days they were expected to attend (CDE's chronic absenteeism rate, reporting category grades 9–12). " +
        `File: ${inputs.absence.url}. Groups of 10 or fewer students are suppressed (*).`,
    },
  ];
  return { sections, ...b.result(), builder: b };
}

export const adapter: StateAdapter = {
  state: "CA",
  source: "state-ca",
  name: "California Department of Education downloads (College-Going Rate, CAASPP research files, chronic absenteeism)",
  publisher: "California Department of Education",
  url: "https://www.cde.ca.gov/ds/",
  built: true,
  async load(ctx: StateContext) {
    const crosswalk = await loadCrosswalk(ctx, SCHOOL_CODE_WIDTH);
    const urls = { cgr: CA_URLS.cgr(flag(ctx, "cgr", "23")), caaspp: CA_URLS.caaspp(flag(ctx, "caaspp", "2025")), absence: CA_URLS.absence(flag(ctx, "absence", "25")) };
    const cgr = await ctx.fetchCached(urls.cgr);
    const caaspp = await ctx.fetchCached(urls.caaspp);
    const absence = await ctx.fetchCached(urls.absence);
    const scores = ctx.listZip(caaspp).find((f) => /_1_csv_v\d+\.txt$/i.test(f));
    const entities = ctx.listZip(caaspp).find((f) => /entities_csv\.txt$/i.test(f));
    if (!scores || !entities) throw new Error(`${urls.caaspp}: expected a scores file and an entities file inside`);
    const out = buildCa(
      {
        cgr: { text: readFileSync(cgr, "latin1"), url: urls.cgr, retrieved: retrievedDate(cgr) },
        caaspp: { text: ctx.readZipEntry(caaspp, scores), entities: ctx.readZipEntry(caaspp, entities), url: urls.caaspp, retrieved: retrievedDate(caaspp) },
        absence: { text: readFileSync(absence, "latin1"), url: urls.absence, retrieved: retrievedDate(absence) },
      },
      crosswalk,
    );
    for (const line of out.builder.report()) ctx.log(line);
    return { sections: out.sections, schools: out.schools, unmatched: out.unmatched };
  },
};
