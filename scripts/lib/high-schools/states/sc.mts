/**
 * South Carolina state report card adapter: the SC Department of Education's report card data files (screportcards.com
 * "Data Files"), which carry the Education Oversight Committee's accountability measures. Writes
 * data/high-schools/state/sc.json through `npm run sync-hs-states -- --state sc`.
 *
 * Files (both .xlsx, one row per school per report card type; high schools are type "H"):
 *   - "Report Cards Data for Researchers 2024-25": sheet 2b (End-of-Course tests, high schools).
 *   - "Report Cards Data Additional Info for 2024-25": sheet 4c (college enrollment, from the National Student
 *     Clearinghouse report the EOC buys for every high school) and 5b (chronic absenteeism).
 * Ids: the files' 7-digit SCHOOLID is CCD's ST_SCHID without dashes ("SC-0160-001" → "0160001").
 * Codes: "*" = suppressed by the state (too few students); "N/AV" (not available) and "N/A" (not applicable) = missing.
 *
 * Not delivered (no downloadable per-school file): college persistence (on the web report card only; the EOC's
 * Clearinghouse persistence and completion files go to schools through a password-protected portal, and the public
 * dashboards are Tableau views); AP pass rate (AP_PctPass is "*" for every school in the 2023–24 and 2024–25 files, so
 * it isn't published, not suppressed). To move to a newer report card, change REPORT_CARD below.
 */
import type { HsStateSection } from "../../../../lib/high-school-types.ts";
import { suppress } from "../../../../lib/high-school-core.ts";
import type { StateAdapter, StateAdapterResult, StateContext } from "../types.mts";
import { StateFileBuilder, readXlsxSheet, recordsFrom, stateCrosswalk, type Crosswalk } from "./stb-common.mts";

const BASE = "https://screportcards.com/files";
export const REPORT_CARD = {
  /** The report card's school year and the folder year on screportcards.com. */
  schoolYear: "2024–25",
  folder: "2025",
  slug: "2024-25",
  /** Graduates whose fall college enrollment the card reports: the prior year's on-time cohort. */
  collegeClass: "Class of 2024 (fall 2024)",
};
const researchersUrl = `${BASE}/${REPORT_CARD.folder}/data-files/report-cards-data-for-researchers-${REPORT_CARD.slug}/`;
const additionalUrl = `${BASE}/${REPORT_CARD.folder}/data-files/report-cards-data-additional-info-for-${REPORT_CARD.slug}/`;

const SUPPRESSED = ["*"];
const MISSING = ["N/AV", "N/A", "N/R", "I/S"];

/** "SC-0160-001" → "0160001". */
export function scNativeKey(stSchId: string): string | null {
  const m = /^SC-(\d{4})-(\d{3})$/.exec(stSchId.trim());
  return m ? m[1] + m[2] : null;
}

/** The files' SCHOOLID ("0160001", or 160001 where Excel stored it as a number) → 7 digits. */
export function scSchoolId(raw: string): string | null {
  const t = raw.trim().replace(/\.0+$/, "");
  return /^\d{5,7}$/.test(t) ? t.padStart(7, "0") : null;
}

const pct = (raw: string | undefined) => suppress(raw ?? null, { kind: "share", percent: true, suppressedCodes: SUPPRESSED, missingCodes: MISSING });

export function scSections(retrieved: string): HsStateSection[] {
  return [
    {
      key: "eocep",
      source: "state-sc",
      label: `South Carolina School Report Card ${REPORT_CARD.schoolYear}: End-of-Course tests (report card data for researchers)`,
      year: REPORT_CARD.schoolYear,
      url: researchersUrl,
      retrieved,
      fields: ["ela_proficiency", "math_proficiency"],
      notes:
        "South Carolina's high school tests are the End-of-Course Examination Program (EOCEP). ELA = the share of students " +
        "scoring A, B or C (70 or higher) on the English EOC test (E_PctABC); math = the same for Algebra 1 (M_PctABC). " +
        "The denominator is every student expected to test, including those not tested. \"*\" (too few students) is suppressed.",
    },
    {
      key: "college-enrollment",
      source: "state-sc",
      label: `South Carolina School Report Card ${REPORT_CARD.schoolYear}: college enrollment (additional information file)`,
      year: REPORT_CARD.collegeClass,
      url: additionalUrl,
      retrieved,
      fields: ["nsc_enrolled_fall"],
      notes:
        "COLLEGE_PctEnrolledCurrYr: the share of the prior year's four-year graduation cohort who earned a regular diploma " +
        "and were enrolled in an in-state or out-of-state two- or four-year college in the fall right after graduating " +
        "(\"Total Enrolled\" ÷ \"Total in the Class\" in the National Student Clearinghouse report; EOC Accountability Manual). " +
        "\"N/AV\" and \"N/A\" are not reported.",
    },
    {
      key: "chronic-absence",
      source: "state-sc",
      label: `South Carolina School Report Card ${REPORT_CARD.schoolYear}: chronic absenteeism (additional information file)`,
      year: REPORT_CARD.schoolYear,
      url: additionalUrl,
      retrieved,
      fields: ["chronic_absence"],
      notes:
        "PctChronic_ALL: the share of all students who were chronically absent, i.e. absent for any reason for 10% or more " +
        "of the days they were enrolled (the EDFacts definition the EOC manual adopts).",
    },
  ];
}

/** Rows of one sheet as records, keeping each school's high-school (type "H") row. Pure over the sheet rows. */
export function scHighSchoolRecords(rows: readonly string[][]): Record<string, string>[] {
  const recs = recordsFrom(rows, ["SCHOOLID"]);
  const typeKey = Object.keys(recs[0] ?? {}).find((k) => /^SCHOOLTYPECD$/i.test(k));
  return recs.filter((r) => (typeKey ? r[typeKey] === "H" : true) && scSchoolId(r.SCHOOLID ?? ""));
}

/** Fills the builder from the three sheets' rows (tests pass small extracts). */
export function buildScFile(
  sheets: { eoc: readonly string[][]; college: readonly string[][]; chronic: readonly string[][] },
  crosswalk: Crosswalk,
  retrieved: string,
): { result: StateAdapterResult; builder: StateFileBuilder } {
  const b = new StateFileBuilder(crosswalk);
  const name = (r: Record<string, string>) => r.SchoolNm ?? r.SCHOOL ?? "";
  for (const r of scHighSchoolRecords(sheets.eoc)) {
    const id = scSchoolId(r.SCHOOLID)!;
    b.set("ela_proficiency", id, name(r), pct(r.E_PctABC), true);
    b.set("math_proficiency", id, name(r), pct(r.M_PctABC), true);
  }
  for (const r of scHighSchoolRecords(sheets.college)) b.set("nsc_enrolled_fall", scSchoolId(r.SCHOOLID)!, name(r), pct(r.COLLEGE_PctEnrolledCurrYr), true);
  for (const r of scHighSchoolRecords(sheets.chronic)) b.set("chronic_absence", scSchoolId(r.SCHOOLID)!, name(r), pct(r.PctChronic_ALL), true);
  return { result: b.result(scSections(retrieved)), builder: b };
}

async function load(ctx: StateContext): Promise<StateAdapterResult> {
  const crosswalk = await stateCrosswalk(ctx, scNativeKey);
  const researchers = await ctx.fetchCached(researchersUrl, { file: `sc-report-card-researchers-${REPORT_CARD.slug}.xlsx` });
  const additional = await ctx.fetchCached(additionalUrl, { file: `sc-report-card-additional-${REPORT_CARD.slug}.xlsx` });
  const { result, builder } = buildScFile(
    {
      eoc: readXlsxSheet(researchers, /^2b\./),
      college: readXlsxSheet(additional, /^4c\./),
      chronic: readXlsxSheet(additional, /^5b\./),
    },
    crosswalk,
    ctx.today,
  );
  for (const line of builder.report()) ctx.log(line);
  return result;
}

export const adapter: StateAdapter = {
  state: "SC",
  source: "state-sc",
  name: "South Carolina School Report Card data files",
  publisher: "South Carolina Department of Education and Education Oversight Committee",
  url: "https://screportcards.com/",
  built: true,
  load,
};
