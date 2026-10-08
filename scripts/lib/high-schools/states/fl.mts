/**
 * Florida state report card adapter: Florida Department of Education downloads. Writes data/high-schools/state/fl.json
 * through `npm run sync-hs-states -- --state fl`.
 *
 * Files:
 *   - School Grades (SchoolGrades{yy}.xlsx, Accountability Reporting): "English Language Arts Achievement" and
 *     "Mathematics Achievement", the state's school-level proficiency components.
 *   - Students Absent 21+ Days and Absent 10% or More Comparison, by school (PK-12 public school data publications).
 *   - FETPIP (Florida Education and Training Placement Information Program) "Public High School Graduates - Standard
 *     Diploma, by district by school" (a PDF, one page per school): graduates continuing their education in Florida
 *     the fall after graduating.
 * Ids: district (2 digits) + school (4), "010151"; CCD's ST_SCHID is "FL-01-0151".
 * Codes: "*" (absence file, groups under 10) and "****" (FETPIP, small counts) = suppressed; blank = not reported
 * (School Grades leave a component blank when too few students take it); FETPIP "-" = none.
 *
 * www.fldoe.org answers automated requests from some networks with 403 (an Akamai rule); the same files are served
 * from origin.fldoe.org, which the adapter falls back to. Sections cite the www URLs.
 *
 * Not delivered: AP pass rates (FLDOE publishes no per-school AP results file); Clearinghouse measures (Florida's
 * postsecondary follow-up is FETPIP, Florida institutions only). Chronic absence uses "Absent 10% or More". To move
 * years, change FILES below.
 */
import type { HsStateSection } from "../../../../lib/high-school-types.ts";
import { suppress, type Suppressed } from "../../../../lib/high-school-core.ts";
import { formatRow, rowsFromItems, type TextItem } from "../../college-reported/layout.mts";
import type { StateAdapter, StateAdapterResult, StateContext } from "../types.mts";
import { StateFileBuilder, readXlsxSheet, recordsFrom, shareCell, stateCrosswalk, type Crosswalk } from "./stb-common.mts";
import { readFileSync } from "node:fs";

const WWW = "https://www.fldoe.org";
const ORIGIN = "https://origin.fldoe.org";
export const FILES = {
  grades: { path: "/file/18534/SchoolGrades26.xlsx", year: "2025–26", page: `${WWW}/accountability/accountability-reporting/school-grades/` },
  absence: {
    path: "/file/7584/2425ABS21Days10Comparison.xlsx",
    year: "2024–25",
    page: `${WWW}/accountability/data-sys/edu-info-accountability-services/pk-12-public-school-data-pubs-reports/students.stml`,
  },
  fetpip: {
    path: "/file/7592/2324HS-SDGrad656ByDistBySchl.pdf",
    year: "Class of 2024 (fall 2024)",
    page: `${WWW}/accountability/fl-edu-training-placement-info-program/high-school-reports.stml`,
  },
};

/** "FL-01-0151" → "010151". */
export function flNativeKey(stSchId: string): string | null {
  const m = /^FL-(\d{2})-([0-9A-Z]{4})$/i.exec(stSchId.trim());
  return m ? (m[1] + m[2]).toUpperCase() : null;
}

/** District and school numbers (as text or Excel numbers) → "010151". */
export function flSchoolId(district: string, school: string): string | null {
  const d = district.trim().replace(/\.0+$/, "");
  const s = school.trim().replace(/\.0+$/, "");
  if (!/^\d{1,2}$/.test(d) || !/^[0-9A-Z]{1,4}$/i.test(s)) return null;
  return d.padStart(2, "0") + s.padStart(4, "0").toUpperCase();
}

const pct = (raw: string | undefined) => suppress(raw ?? null, { kind: "share", percent: true, suppressedCodes: ["*"] });

/* ------------------------------------------------------------------ */
/* FETPIP pages                                                        */
/* ------------------------------------------------------------------ */

export interface FetpipSchool {
  id: string;
  name: string;
  /** Graduates (TOTAL INDIVIDUALS); null when suppressed. */
  total: number | null;
  cell: Suppressed;
}

const fetpipCount = (raw: string | undefined): number | "suppressed" | null => {
  const t = (raw ?? "").trim();
  if (/^\*+$/.test(t)) return "suppressed";
  if (t === "-") return 0;
  const n = Number(t.replace(/,/g, ""));
  return t && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * One FETPIP page's lines (cells joined with " | ") → the school and its share continuing their education: TOTAL
 * CONTINUING THEIR EDUCATION (Unduplicated) ÷ TOTAL INDIVIDUALS. Pure.
 */
export function fetpipFromLines(lines: readonly string[]): FetpipSchool | null {
  let id: string | null = null;
  let name = "";
  let total: ReturnType<typeof fetpipCount> = null;
  let cont: ReturnType<typeof fetpipCount> = null;
  for (const line of lines) {
    const cells = line.split(" | ").map((c) => c.trim());
    for (let i = 0; i < cells.length; i++) {
      const m = /^(\d{6})\s+(.+)$/.exec(cells[i]);
      if (!id && m) [id, name] = [m[1], m[2]];
      if (/^TOTAL INDIVIDUALS$/i.test(cells[i])) total = fetpipCount(cells[i + 1]);
      if (/^TOTAL CONTINUING THEIR EDUCATION/i.test(cells[i])) cont = fetpipCount(cells[i + 1]);
    }
  }
  if (!id) return null;
  let cell: Suppressed;
  if (total === "suppressed" || cont === "suppressed") cell = { value: null, suppressed: true };
  else if (total === null || cont === null || total === 0 || cont > total) cell = { value: null, suppressed: false };
  else cell = { value: Math.round((cont / total) * 1e4) / 1e4, suppressed: false };
  return { id, name, total: typeof total === "number" ? total : null, cell };
}

/**
 * Each page's lines (cells joined with " | "), via pdf.js. FETPIP pages are landscape text on a rotated page (text
 * matrix [0, s, −s, 0, e, f]), so x and y are taken from the rotated axes before rows are rebuilt.
 */
export async function fetpipPages(pdf: Uint8Array): Promise<string[][]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: pdf, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const [a, b, , , e, f] = it.transform as number[];
      const rotated = Math.abs(a) < 1e-6 && b > 0;
      items.push({ str: it.str, x: rotated ? f : e, y: rotated ? -e : f, width: it.width ?? 0 });
    }
    pages.push(rowsFromItems(items).map((r) => formatRow(r, { x: false })));
  }
  await task.destroy();
  return pages;
}

/* ------------------------------------------------------------------ */
/* The file                                                            */
/* ------------------------------------------------------------------ */

export function flSections(retrieved: string): HsStateSection[] {
  return [
    {
      key: "fetpip",
      source: "state-fl",
      label: "FETPIP Public High School Graduates (standard diploma) by school: continuing education, fall 2024",
      year: FILES.fetpip.year,
      url: WWW + FILES.fetpip.path,
      retrieved,
      fields: ["college_going_rate"],
      notes:
        "TOTAL CONTINUING THEIR EDUCATION (Unduplicated) ÷ TOTAL INDIVIDUALS: of the school's 2023–24 standard-diploma " +
        "graduates, the share found enrolled the fall after graduating in Florida postsecondary education (a district " +
        "postsecondary program, a Florida College System institution, a state university, or a private Florida college or " +
        "university reporting to FETPIP). Out-of-state enrollment isn't counted, so it runs lower than measures that " +
        "include it. \"****\" (small counts) is suppressed.",
    },
    {
      key: "school-grades",
      source: "state-fl",
      label: `Florida School Grades ${FILES.grades.year}: achievement components`,
      year: FILES.grades.year,
      url: WWW + FILES.grades.path,
      retrieved,
      fields: ["ela_proficiency", "math_proficiency"],
      notes:
        "\"English Language Arts Achievement\" and \"Mathematics Achievement\": the share of the school's tested students " +
        "scoring Level 3 or above on Florida's statewide assessments (FAST ELA through grade 10; FAST math, Algebra 1 and " +
        "Geometry end-of-course tests), as whole percents. Combination schools (e.g. grades 6–12) include their younger " +
        "grades. Blank when too few students tested.",
    },
    {
      key: "chronic-absence",
      source: "state-fl",
      label: `FLDOE Students Absent 21+ Days and Absent 10% or More, by school, ${FILES.absence.year} (Final Survey 5)`,
      year: FILES.absence.year,
      url: WWW + FILES.absence.path,
      retrieved,
      fields: ["chronic_absence"],
      notes:
        "\"% of Students Absent 10% or More\": students absent 10% or more of the days they were enrolled (days absent ÷ " +
        "days absent plus present), among students enrolled 10 or more days. \"*\" (groups under 10) is suppressed.",
    },
  ];
}

export function buildFlFile(
  inputs: { grades: readonly string[][]; absence: readonly string[][]; fetpip: readonly (readonly string[])[] },
  crosswalk: Crosswalk,
  retrieved: string,
): { result: StateAdapterResult; builder: StateFileBuilder } {
  const b = new StateFileBuilder(crosswalk);
  for (const page of inputs.fetpip) {
    const s = fetpipFromLines(page);
    if (s) b.set("college_going_rate", s.id, s.name, s.cell, true);
  }
  for (const r of recordsFrom(inputs.grades, ["District Number", "School Number"])) {
    if (r["Virtual Provider Number"]?.trim()) continue; // a virtual provider's row under a district's virtual school
    const id = flSchoolId(r["District Number"], r["School Number"]);
    if (!id) continue;
    const high = ["03", "04", "3", "4"].includes((r["School Type"] ?? "").trim());
    b.set("ela_proficiency", id, r["School Name"] ?? "", pct(r["English Language Arts Achievement"]), high);
    b.set("math_proficiency", id, r["School Name"] ?? "", pct(r["Mathematics Achievement"]), high);
  }
  for (const r of recordsFrom(inputs.absence, ["District #", "School #"])) {
    const id = flSchoolId(r["District #"], r["School #"]);
    if (!id) continue;
    b.set("chronic_absence", id, r["School Name"] ?? "", shareCell(r["% of Students Absent 10% or More"], ["*"]), false);
  }
  return { result: b.result(flSections(retrieved)), builder: b };
}

/** fldoe.org file: www first, origin.fldoe.org when www refuses the request; cached under one name. */
async function fetchFldoe(ctx: StateContext, path: string): Promise<string> {
  const file = `fl-${path.split("/").at(-1)}`;
  try {
    return await ctx.fetchCached(WWW + path, { file });
  } catch (err) {
    if (ctx.offline) throw err;
    ctx.warn(`${WWW}${path}: ${err instanceof Error ? err.message : String(err)}; trying ${ORIGIN}`);
    return ctx.fetchCached(ORIGIN + path, { file });
  }
}

async function load(ctx: StateContext): Promise<StateAdapterResult> {
  const crosswalk = await stateCrosswalk(ctx, flNativeKey);
  const grades = readXlsxSheet(await fetchFldoe(ctx, FILES.grades.path), /^School Grades/i);
  const absence = readXlsxSheet(await fetchFldoe(ctx, FILES.absence.path), /^Schools_/i);
  const fetpip = await fetpipPages(new Uint8Array(readFileSync(await fetchFldoe(ctx, FILES.fetpip.path))));
  const { result, builder } = buildFlFile({ grades, absence, fetpip }, crosswalk, ctx.today);
  for (const line of builder.report()) ctx.log(line);
  return result;
}

export const adapter: StateAdapter = {
  state: "FL",
  source: "state-fl",
  name: "Florida Department of Education school grades, attendance and FETPIP downloads",
  publisher: "Florida Department of Education",
  url: "https://www.fldoe.org/accountability/data-sys/edu-info-accountability-services/",
  built: true,
  load,
};
