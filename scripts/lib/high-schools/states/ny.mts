/**
 * New York state report card adapter. Writes data/high-schools/state/ny.json through
 * `npm run sync-hs-states -- --state ny`.
 *
 * Files (NYSED data downloads, data.nysed.gov/downloads.php; newest on 2026-10-05, `--year 2025` = 2024–25):
 *   - Report Card Database (ESSA), files/essa/24-25/SRC2025.zip: tables "Postsecondary Enrollment",
 *     "Total Cohort Regents Exams", "ACC HS Chronic Absenteeism"
 *   - AP/IB Assessment Database, files/apib/2425/APIB25.zip: AP exams by school, subject, and grade
 * Both ship as Microsoft Access databases; the tables are read with `mdb-export` from mdbtools (install it:
 * `brew install mdbtools`, `apt install mdbtools`), like the system `unzip` the other adapters use. The databases are
 * extracted into the cache once (about 2 GB).
 *
 * Fields: college_going_rate (16 months, any U.S. college), ela_proficiency and math_proficiency (Regents, share of
 * the 4-year cohort), ap_pass_rate (share of AP exams scored 3+; noted), chronic_absence (grades 9–12).
 * Left out: graduation pathways (no matching field), the College, Career, and Civic Readiness index (a readiness
 * index, not enrollment), IB results (the field is AP), Clearinghouse persistence (not published by school).
 * Privacy: NYSED prints "s" for suppressed cells (fewer than 5 students, and the next smallest group) → suppressed.
 * School ids: the 12-digit BEDS code (ENTITY_CD), the trailing 12 digits of CCD ST_SCHID
 * ("NY-211003040000-211003040002"). State (111111111111), district (…0000), and aggregate (0000…) rows are skipped.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import type { HsStateSection } from "../../../../lib/high-school-types.ts";
import { SMALL_CELL, round } from "../../../../lib/high-school-core.ts";
import { forEachCsvRow } from "../../ipeds.mts";
import type { StateAdapter, StateAdapterResult, StateContext } from "../types.mts";
import { StateFileBuilder, flag, loadCrosswalk, retrievedDate, schoolYear, shareOf, type Crosswalk, type Share } from "./sta-common.mts";

const CODES = { suppressed: ["s"] } as const;
export const BEDS_WIDTH = 12;
const PAGE = "https://data.nysed.gov/downloads.php";

export const NY_URLS = {
  src: (yyyy: string) => `https://data.nysed.gov/files/essa/${Number(yyyy.slice(2)) - 1}-${yyyy.slice(2)}/SRC${yyyy}.zip`,
  apib: (yyyy: string) => `https://data.nysed.gov/files/apib/${Number(yyyy.slice(2)) - 1}${yyyy.slice(2)}/APIB${yyyy.slice(2)}.zip`,
};

/** A school's BEDS code: 12 digits, not the state (111111111111), an aggregate (0000…), or a district (…0000). */
export function isSchoolBeds(code: string): boolean {
  return /^\d{12}$/.test(code) && code !== "111111111111" && !code.startsWith("0000") && !code.endsWith("0000");
}

/** Rows of the newest value of `key` ("YEAR", "COHORT") among rows passing `keep`. */
function newest(rows: Record<string, string>[], key: string, keep: (r: Record<string, string>) => boolean): { rows: Record<string, string>[]; value: string } {
  const kept = rows.filter(keep);
  const value = kept.reduce((m, r) => (r[key] > m ? r[key] : m), "");
  return { rows: kept.filter((r) => r[key] === value), value };
}

/** Postsecondary Enrollment: newest class, all students. Returns "Class of 2024". */
export function parsePostsecondary(csv: string, b: StateFileBuilder): string {
  const all: Record<string, string>[] = [];
  forEachCsvRow(csv, (r) => all.push(r));
  const { rows } = newest(all, "YEAR", (r) => r.SUBGROUP_NAME === "All Students" && isSchoolBeds(r.ENTITY_CD));
  if (!rows.length) throw new Error("Postsecondary Enrollment has no school rows");
  for (const r of rows) {
    b.set(r.ENTITY_CD, r.ENTITY_NAME, "college_going_rate", shareOf({ num: r.TOT_ENROLL_CNT, den: r.TOTAL_GRAD_COUNT, pct: r.PER_TOT_ENROLL }, CODES), { hsOnly: true });
  }
  return rows[0].MEMBERSHIP_DESC.trim();
}

/** Total Cohort Regents Exams: newest cohort (the 4-year one), all students, ELA and MATH. Returns the cohort year. */
export function parseCohortRegents(csv: string, b: StateFileBuilder): string {
  const all: Record<string, string>[] = [];
  forEachCsvRow(csv, (r) => {
    if (r.SUBGROUP_NAME === "All Students" && (r.SUBJECT === "ELA" || r.SUBJECT === "MATH") && isSchoolBeds(r.ENTITY_CD)) all.push(r);
  });
  const { rows, value } = newest(all, "COHORT", () => true);
  if (!rows.length) throw new Error("Total Cohort Regents Exams has no school ELA/MATH rows");
  for (const r of rows) {
    const field = r.SUBJECT === "ELA" ? "ela_proficiency" : "math_proficiency";
    b.set(r.ENTITY_CD, r.ENTITY_NAME, field, shareOf({ num: r.PROF_COUNT, den: r.COHORT_COUNT, pct: r["PROF_%COHORT"] }, CODES), { hsOnly: true });
  }
  return value;
}

/** ACC HS Chronic Absenteeism (grades 9–12): newest year, all students. ENROLLMENT "s" means zero students. */
export function parseChronic(csv: string, b: StateFileBuilder): string {
  const all: Record<string, string>[] = [];
  forEachCsvRow(csv, (r) => all.push(r));
  const { rows, value } = newest(all, "YEAR", (r) => r.SUBGROUP_NAME === "All Students" && isSchoolBeds(r.ENTITY_CD));
  if (!rows.length) throw new Error("ACC HS Chronic Absenteeism has no school rows");
  for (const r of rows) {
    if (r.ENROLLMENT === "s") continue; // no students: nothing to report (not a privacy suppression)
    b.set(r.ENTITY_CD, r.ENTITY_NAME, "chronic_absence", shareOf({ num: r.ABSENT_COUNT, den: r.ENROLLMENT, pct: r.ABSENT_RATE }, CODES), { hsOnly: true });
  }
  return schoolYear(value);
}

/** Exams a school's suppressed cells may hide before its AP pass rate is withheld (the reported cells cover less). */
export const AP_MIN_COVERAGE = 0.9;

/**
 * AP_IB_ASSESMENT: per school, all students, AP only, summed over every exam and grade: exams scored 3 or higher ÷
 * exams taken. NYSED suppresses a cell (one exam, one grade) when fewer than 5 students took it; the sum uses the
 * reported cells, and the school's rate is suppressed when those cover under 90% of its exams or it has under 5.
 */
export function parseApExams(csv: string, b: StateFileBuilder): string {
  const bySchool = new Map<string, { name: string; tested: number; reportedTested: number; proficient: number }>();
  let year = "";
  forEachCsvRow(csv, (r) => {
    if (r.AGGREGATION_TYPE !== "Public School" || r.SUBGROUP_NAME !== "All Students" || r.APIB_IND !== "AP" || !isSchoolBeds(r.AGGREGATION_CODE)) return;
    year ||= r.REPORT_SCHOOL_YEAR;
    const tested = Number(r.TESTED_STUDENT_CNT);
    if (!Number.isFinite(tested) || tested <= 0) return;
    const s = bySchool.get(r.AGGREGATION_CODE) ?? { name: r.AGGREGATION_NAME, tested: 0, reportedTested: 0, proficient: 0 };
    s.tested += tested;
    const prof = r.PROFICIENT_STUDENT_CNT.trim();
    if (/^\d+$/.test(prof)) {
      s.reportedTested += tested;
      s.proficient += Number(prof);
    }
    bySchool.set(r.AGGREGATION_CODE, s);
  });
  if (!year) throw new Error("AP/IB assessment table has no school AP rows");
  for (const [id, s] of bySchool) {
    const share: Share =
      s.tested < SMALL_CELL || s.reportedTested < s.tested * AP_MIN_COVERAGE || s.reportedTested === 0
        ? { value: null, suppressed: true }
        : { value: round(s.proficient / s.reportedTested, 4), suppressed: false };
    b.set(id, s.name, "ap_pass_rate", share, { hsOnly: true });
  }
  return schoolYear(year);
}

export interface NyInputs {
  src: { postsecondary: string; cohort: string; chronic: string; url: string; retrieved: string };
  apib: { exams: string; url: string; retrieved: string };
}

export function buildNy(inputs: NyInputs, crosswalk: Crosswalk): StateAdapterResult & { builder: StateFileBuilder } {
  const b = new StateFileBuilder(crosswalk);
  const cls = parsePostsecondary(inputs.src.postsecondary, b);
  const cohort = parseCohortRegents(inputs.src.cohort, b);
  const chronic = parseChronic(inputs.src.chronic, b);
  const ap = parseApExams(inputs.apib.exams, b);
  const c = Number(cohort);
  const through = `${c + 3}–${String(c + 4).slice(-2)}`;
  const src = { source: "state-ny" as const, url: PAGE, retrieved: inputs.src.retrieved };
  const suppressed = `Cells NYSED suppresses ("s": fewer than 5 students, and the next smallest group) are suppressed here.`;
  const sections: HsStateSection[] = [
    {
      ...src,
      key: "postsecondary",
      label: "New York State Education Department report card, postsecondary enrollment",
      year: cls,
      fields: ["college_going_rate"],
      notes:
        "Share of the school's graduates in the calendar-year class who enrolled at any two- or four-year college (New York public or private, or out of state) within 16 months of graduating. Computed from the file's enrolled and graduate counts. " +
        `Report Card Database ${inputs.src.url}, table Postsecondary Enrollment. ${suppressed}`,
    },
    {
      ...src,
      key: "regents-cohort",
      label: "New York State Education Department report card, Regents exams (total cohort)",
      year: `${cohort} cohort (entered grade 9 in ${c}–${String(c + 1).slice(-2)}, results through ${through})`,
      fields: ["ela_proficiency", "math_proficiency"],
      notes:
        "Share of the school's 4-year total cohort (students who entered grade 9 in the cohort year) who scored proficient (Level 3 or higher) on a Regents exam in English language arts, and in any Regents math exam. Students who never tested count in the denominator. " +
        `Report Card Database ${inputs.src.url}, table Total Cohort Regents Exams. ${suppressed}`,
    },
    {
      ...src,
      key: "chronic-absence",
      label: "New York State Education Department report card, chronic absenteeism, grades 9–12",
      year: chronic,
      fields: ["chronic_absence"],
      notes:
        "Share of the school's students in grades 9–12 (enrolled at least 10 days and present at least one) who were absent for 10% or more of the days they were enrolled. " +
        `Report Card Database ${inputs.src.url}, table ACC HS Chronic Absenteeism. ${suppressed}`,
    },
    {
      key: "ap",
      source: "state-ny",
      label: "New York State Education Department, Advanced Placement exams",
      year: ap,
      url: PAGE,
      retrieved: inputs.apib.retrieved,
      fields: ["ap_pass_rate"],
      notes:
        "Share of AP exams taken by the school's students that scored 3 or higher, summed over every AP subject and grade (exams, not students; IB isn't included). " +
        `NYSED suppresses an exam-and-grade cell with fewer than 5 test takers; the rate uses the reported cells and is withheld (suppressed) when those cover less than ${Math.round(AP_MIN_COVERAGE * 100)}% of the school's exams. ` +
        `AP/IB Assessment Database ${inputs.apib.url}.`,
    },
  ];
  return { sections, ...b.result(), builder: b };
}

/** One table of an Access database as CSV text (mdbtools). */
export function exportAccessTable(db: string, table: string): string {
  try {
    return execFileSync("mdb-export", [db, table], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 * 1024 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error("mdb-export not found: install mdbtools (brew install mdbtools / apt install mdbtools) to read NYSED's Access databases");
    throw err;
  }
}

function accessTables(db: string): string[] {
  return execFileSync("mdb-tables", ["-1", db], { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
}

/** Extract one zip entry into the cache once (re-extract when the zip is newer). */
function extract(zip: string, entry: string, dir: string): string {
  const out = join(dir, entry.split("/").pop()!);
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(zip).mtimeMs) {
    execFileSync("unzip", ["-o", "-q", "-j", zip, entry, "-d", dir]);
    const now = new Date();
    utimesSync(out, now, now); // unzip keeps the archive's date, older than the download
  }
  return out;
}

export const adapter: StateAdapter = {
  state: "NY",
  source: "state-ny",
  name: "New York State Education Department data downloads (Report Card Database, AP/IB Assessment Database)",
  publisher: "New York State Education Department",
  url: PAGE,
  built: true,
  async load(ctx: StateContext) {
    const crosswalk = await loadCrosswalk(ctx, BEDS_WIDTH);
    const year = flag(ctx, "year", "2025");
    const urls = { src: NY_URLS.src(year), apib: NY_URLS.apib(year) };
    const srcZip = await ctx.fetchCached(urls.src);
    const apibZip = await ctx.fetchCached(urls.apib);
    const srcEntry = ctx.listZip(srcZip).find((f) => /\.accdb$/i.test(f)) ?? ctx.listZip(srcZip).find((f) => /\.mdb$/i.test(f));
    const apEntry = ctx.listZip(apibZip).find((f) => /Assessment.*\.accdb$/i.test(f));
    if (!srcEntry || !apEntry) throw new Error("NYSED zips don't hold the expected Access databases");
    ctx.log("  extracting NYSED Access databases (once)");
    const srcDb = extract(srcZip, srcEntry, ctx.cacheDir);
    const apDb = extract(apibZip, apEntry, ctx.cacheDir);
    ctx.log("  reading tables with mdb-export (a minute or two)");
    const apTable = accessTables(apDb).find((t) => /^AP_IB_ASSES/i.test(t));
    if (!apTable) throw new Error(`${apDb}: no AP/IB assessment table`);
    const out = buildNy(
      {
        src: {
          postsecondary: exportAccessTable(srcDb, "Postsecondary Enrollment"),
          cohort: exportAccessTable(srcDb, "Total Cohort Regents Exams"),
          chronic: exportAccessTable(srcDb, "ACC HS Chronic Absenteeism"),
          url: urls.src,
          retrieved: retrievedDate(srcZip),
        },
        apib: { exams: exportAccessTable(apDb, apTable), url: urls.apib, retrieved: retrievedDate(apibZip) },
      },
      crosswalk,
    );
    for (const line of out.builder.report()) ctx.log(line);
    return { sections: out.sections, schools: out.schools, unmatched: out.unmatched };
  },
};
