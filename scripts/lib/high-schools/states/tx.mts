/**
 * Texas state report card adapter. Writes data/high-schools/state/tx.json through
 * `npm run sync-hs-states -- --state tx`.
 *
 * Files: Texas Academic Performance Reports (TAPR) data download, all campuses, CSV
 * (rptsvr1.tea.texas.gov/perfreport/tapr/tapr_dd_download.html; the download is TEA's own CSV export, a GET to its
 * report broker, not a scraped page). `--tapr 2025` picks the TAPR edition (2025 = the 2024–25 reports, newest on
 * 2026-10-05). Four datasets:
 *   - TXIHE: graduates enrolled in a Texas public or independent college (Texas Higher Education Coordinating Board)
 *   - APIB: AP/IB results, students above criterion
 *   - STAAR_EOC: end-of-course English II and Algebra I, Meets Grade Level or above
 *   - DROP_ATT: chronic absenteeism (all grades at the campus)
 * Each CSV has a descriptive header row, then a row of TEA column codes, then campuses.
 *
 * Fields: college_going_rate (Texas colleges only; noted), ap_pass_rate (AP and IB combined; noted), ela_proficiency,
 * math_proficiency, chronic_absence. Left out: "College, Career, and Military Ready" (a readiness measure, not
 * enrollment, and not proficiency), SAT/ACT criteria (not a state-test proficiency), Clearinghouse persistence (TEA
 * doesn't publish it by campus).
 * Privacy (TAPR masking rules): -1 = masked small group (denominator 1–4) → suppressed; -2 = abnormal data, -3 = a
 * complementary mask on counts (the rate stays) → read the rate or leave missing; blank = not reported.
 * School ids: the 9-digit campus number, the trailing 9 digits of CCD ST_SCHID ("TX-054901-054901001").
 */
import { readFileSync } from "node:fs";
import type { HsStateField, HsStateSection } from "../../../../lib/high-school-types.ts";
import { forEachCsvRow } from "../../ipeds.mts";
import type { StateAdapter, StateAdapterResult, StateContext } from "../types.mts";
import { StateFileBuilder, flag, loadCrosswalk, retrievedDate, shareOf, type Crosswalk } from "./sta-common.mts";

const CODES = { suppressed: ["-1"] } as const;
export const CAMPUS_WIDTH = 9;
const PAGE = (ccyy: string) => `https://rptsvr1.tea.texas.gov/perfreport/tapr/tapr_dd_download.html?year=${ccyy}`;
const MASKING = (ccyy: string) => `https://rptsvr1.tea.texas.gov/perfreport/tapr/${ccyy}/masking.html`;

export type TaprDataset = "TXIHE" | "APIB" | "STAAR_EOC" | "DROP_ATT";

/** The data elements ("key") to request per dataset; TEA suffixes most with a two-digit data year. */
export function taprKeys(dataset: TaprDataset, ccyy: string): string[] {
  const yy = Number(ccyy.slice(2));
  const two = (n: number) => String(n).padStart(2, "0");
  switch (dataset) {
    case "TXIHE":
      return [`HEE${two(yy - 2)}`];
    case "APIB":
      return [`0BKA${two(yy - 1)}`];
    case "STAAR_EOC":
      return ["00AR212|00AR210", "00AA112|00AA110"];
    case "DROP_ATT":
      return [`CA${two(yy - 1)}`];
  }
}

/** TEA's CSV export of one TAPR campus dataset: numerators, denominators, and rates for every campus. */
export function taprUrl(dataset: TaprDataset, ccyy: string): string {
  const q = new URLSearchParams([
    ["_service", "marykay"], ["_program", "perfrept.perfmast.sas"], ["_debug", "0"], ["tapr", "all_c"], ["ccyy", ccyy],
    ["dsname", dataset], ["sumlev", "C"], ["level", "Campus"], ["id", ""], ["prgopt", "reports/tapr/dd/dd_tapr_step_7.sas"],
    ...taprKeys(dataset, ccyy).map((k) => ["key", k]), ["var_type", "N"], ["var_type", "D"], ["var_type", "R"], ["datafmt", "csv"],
  ]);
  return `https://rptsvr1.tea.texas.gov/cgi/sas/broker?${q}`;
}

interface TaprTable {
  /** Descriptive header text by column code ("CA0BKA24R" → "Campus 2024 AP/IB: All Students (All Subjects) % …"). */
  labels: Map<string, string>;
  rows: Record<string, string>[];
}

/** A TAPR download: line 1 describes each column, line 2 holds TEA's codes (the keys used here), then one row per campus. */
export function readTapr(text: string): TaprTable {
  const nl = text.indexOf("\n");
  if (nl < 0) throw new Error("TAPR file is empty or has no header");
  const describe = splitCsvLine(text.slice(0, nl).replace(/\r$/, ""));
  const rows: Record<string, string>[] = [];
  // forEachCsvRow upper-cases headers; TEA's codes are upper case already.
  const codes = forEachCsvRow(text.slice(nl + 1), (r) => rows.push(r));
  return { labels: new Map(codes.map((c, i) => [c, describe[i] ?? ""])), rows };
}

/** One CSV line → cells (quoted fields, doubled quotes). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") out.push(field), (field = "");
    else field += c;
  }
  out.push(field);
  return out;
}

/** The single column matching `re` (all students), e.g. /^CA0BKA(\d\d)R$/; throws when TEA renamed it. */
function column(t: TaprTable, re: RegExp): { code: string; label: string } {
  const code = [...t.labels.keys()].find((c) => re.test(c));
  if (!code) throw new Error(`TAPR file has no column matching ${re}`);
  return { code, label: t.labels.get(code) ?? "" };
}

interface Measure {
  field: HsStateField;
  num: RegExp;
  den: RegExp;
  rate: RegExp;
  hsOnly: boolean;
}

function fileMeasures(t: TaprTable, b: StateFileBuilder, measures: readonly Measure[]): Record<string, string> {
  const cols = measures.map((m) => ({ m, num: column(t, m.num).code, den: column(t, m.den).code, rate: column(t, m.rate) }));
  for (const r of t.rows) {
    if (!/^\d{9}$/.test(r.CAMPUS ?? "")) continue;
    for (const c of cols) b.set(r.CAMPUS, r.CAMPNAME ?? "", c.m.field, shareOf({ num: r[c.num], den: r[c.den], pct: r[c.rate.code] }, CODES), { hsOnly: c.m.hsOnly });
  }
  return Object.fromEntries(cols.map((c) => [c.m.field, c.rate.label]));
}

/** TXIHE: graduates enrolled in Texas higher education. Year label from "TX IHE 2023: 2022 … Graduates" → "Class of 2022". */
export function parseTxIhe(text: string, b: StateFileBuilder): string {
  const t = readTapr(text);
  const labels = fileMeasures(t, b, [{ field: "college_going_rate", num: /^CAHEE\d\dN$/, den: /^CAHEE\d\dD$/, rate: /^CAHEE\d\dR$/, hsOnly: true }]);
  const m = /:\s*(\d{4}) All Graduates/.exec(t.labels.get(column(t, /^CAHEE\d\dD$/).code) ?? "") ?? /(\d{4})\s+All Graduates/.exec(labels.college_going_rate);
  if (!m) throw new Error("TXIHE: can't read the graduating class from the header");
  return `Class of ${m[1]}`;
}

/** APIB: share of AP/IB examinees with a score at or above criterion. "Campus 2024 AP/IB" → "2023–24". */
export function parseApIb(text: string, b: StateFileBuilder): string {
  const t = readTapr(text);
  fileMeasures(t, b, [{ field: "ap_pass_rate", num: /^CA0BKA\d\dN$/, den: /^CA0BKA\d\dD$/, rate: /^CA0BKA\d\dR$/, hsOnly: true }]);
  const yy = Number(column(t, /^CA0BKA(\d\d)R$/).code.slice(6, 8));
  return `20${String(yy - 1).padStart(2, "0")}–${String(yy).padStart(2, "0")}`;
}

/** STAAR_EOC: English II and Algebra I tests at Meets Grade Level or above. "SY 2024-25" → "2024–25". */
export function parseEoc(text: string, b: StateFileBuilder): string {
  const t = readTapr(text);
  fileMeasures(t, b, [
    { field: "ela_proficiency", num: /^CDA00AR212\d\dN$/, den: /^CDA00AR210\d\dD$/, rate: /^CDA00AR212\d\dR$/, hsOnly: true },
    { field: "math_proficiency", num: /^CDA00AA112\d\dN$/, den: /^CDA00AA110\d\dD$/, rate: /^CDA00AA112\d\dR$/, hsOnly: true },
  ]);
  const m = /SY (\d{4})-(\d{2})/.exec(column(t, /^CDA00AR212\d\dR$/).label);
  if (!m) throw new Error("STAAR_EOC: can't read the school year from the header");
  return `${m[1]}–${m[2]}`;
}

/** DROP_ATT: chronic absenteeism, all students at the campus. "2024 campus Chronic Absenteeism" → "2023–24". */
export function parseAbsence(text: string, b: StateFileBuilder): string {
  const t = readTapr(text);
  // All grades at a campus (elementary campuses too): rows the crosswalk can't map aren't listed as unmatched.
  fileMeasures(t, b, [{ field: "chronic_absence", num: /^CA0CA\d\dN$/, den: /^CA0CA\d\dD$/, rate: /^CA0CA\d\dR$/, hsOnly: false }]);
  const yy = Number(column(t, /^CA0CA(\d\d)R$/).code.slice(5, 7));
  return `20${String(yy - 1).padStart(2, "0")}–${String(yy).padStart(2, "0")}`;
}

export interface TxInputs {
  ccyy: string;
  retrieved: string;
  files: Record<TaprDataset, string>;
}

export function buildTx(inputs: TxInputs, crosswalk: Crosswalk): StateAdapterResult & { builder: StateFileBuilder } {
  const b = new StateFileBuilder(crosswalk);
  const ihe = parseTxIhe(inputs.files.TXIHE, b);
  const ap = parseApIb(inputs.files.APIB, b);
  const eoc = parseEoc(inputs.files.STAAR_EOC, b);
  const absence = parseAbsence(inputs.files.DROP_ATT, b);
  const page = PAGE(inputs.ccyy);
  const masking = `Masked small groups (-1 in TEA's download, denominator 1–4) are suppressed; masking rules: ${MASKING(inputs.ccyy)}.`;
  const edition = `${Number(inputs.ccyy) - 1}–${inputs.ccyy.slice(2)}`;
  const base = { source: "state-tx" as const, url: page, retrieved: inputs.retrieved };
  const sections: HsStateSection[] = [
    {
      ...base,
      key: "tx-ihe",
      label: "Texas Academic Performance Reports, graduates enrolled in Texas higher education",
      year: ihe,
      fields: ["college_going_rate"],
      notes:
        "Share of the campus's graduates who enrolled in a Texas public or independent college or university in the academic year after graduating (Texas Higher Education Coordinating Board records, reported in TAPR). Enrollment outside Texas isn't counted, so this runs lower than a national college-going rate; compare only with other Texas high schools. " +
        `TAPR ${edition} data download, dataset TXIHE. ${masking}`,
    },
    {
      ...base,
      key: "ap-ib",
      label: "Texas Academic Performance Reports, AP/IB results",
      year: ap,
      fields: ["ap_pass_rate"],
      notes:
        "Of the campus's 11th and 12th graders who took at least one AP or IB exam, the share who scored at or above criterion on at least one (3 or higher on AP, 4 or higher on IB). AP and IB are combined in TEA's measure; it counts students, not exams. " +
        `TAPR ${edition} data download, dataset APIB. ${masking}`,
    },
    {
      ...base,
      key: "staar-eoc",
      label: "Texas Academic Performance Reports, STAAR end-of-course exams (English II, Algebra I)",
      year: eoc,
      fields: ["ela_proficiency", "math_proficiency"],
      notes:
        "Share of STAAR end-of-course tests taken at the campus that scored at Meets Grade Level or above: English II for reading/ELA, Algebra I for math. Counts tests, not students. Many students take Algebra I in middle school, so a high school's Algebra I results describe the students who take it there. " +
        `TAPR ${edition} data download, dataset STAAR_EOC. ${masking}`,
    },
    {
      ...base,
      key: "chronic-absence",
      label: "Texas Academic Performance Reports, chronic absenteeism",
      year: absence,
      fields: ["chronic_absence"],
      notes:
        "Share of the campus's students (all grades served) who missed 10% or more of the days they were enrolled. " +
        `TAPR ${edition} data download, dataset DROP_ATT. ${masking}`,
    },
  ];
  return { sections, ...b.result(), builder: b };
}

export const adapter: StateAdapter = {
  state: "TX",
  source: "state-tx",
  name: "Texas Academic Performance Reports (TAPR) data downloads",
  publisher: "Texas Education Agency",
  url: "https://tea.texas.gov/texas-schools/accountability/academic-accountability/performance-reporting/texas-academic-performance-reports",
  built: true,
  async load(ctx: StateContext) {
    const crosswalk = await loadCrosswalk(ctx, CAMPUS_WIDTH);
    const ccyy = flag(ctx, "tapr", "2025");
    const files = {} as Record<TaprDataset, string>;
    let retrieved = "";
    for (const ds of ["TXIHE", "APIB", "STAAR_EOC", "DROP_ATT"] as const) {
      const path = await ctx.fetchCached(taprUrl(ds, ccyy), { file: `tapr-${ccyy}-${ds.toLowerCase()}.csv` });
      files[ds] = readFileSync(path, "latin1");
      const d = retrievedDate(path);
      if (d > retrieved) retrieved = d;
    }
    const out = buildTx({ ccyy, retrieved, files }, crosswalk);
    for (const line of out.builder.report()) ctx.log(line);
    return { sections: out.sections, schools: out.schools, unmatched: out.unmatched };
  },
};
