/**
 * Where each year's values live in NCES's files (specs/trends-data.md#pipeline-npm-run-sync-history). NCES moves
 * data between surveys, renames files, and changes column suffixes; every one of those changes is an era here, so
 * the build reads one table instead of guessing. Every listed column must exist in its file, or the build stops.
 *
 * Probed 2026-09-28:
 *   - Admissions: IC2001–IC2013 (IC2001 only by gender), then ADM2014 on.
 *   - Prices: IC{Y}_AY holds Y–Y+1 in `…AY3` (e.g. IC2013_AY CHG2AY3 = Vanderbilt 2013–14, $42,978).
 *     COST1_{Y+1} holds Y–Y+1 in `…AY2` and Y+1–Y+2 in `…AY3`. Both exist for 2023–24; the IC file wins, as in
 *     sync-data.
 *   - Aid: SFA{yy}{yy+1}. Residency from 2001–02, grants and the aid cohort from 2007–08, total grant dollars and
 *     net price from 2008–09. From 2023–24, residency and net price moved to COST2_{Y+1}.
 */
import type { HistoryFamily } from "../../lib/history.ts";
import { FACTOR_COLUMNS } from "../../lib/derive.ts";
import { OM_COLUMNS, OM_FIRST_FILE, OM_LAG, OM_PIVOT } from "../../lib/outcome-measures.ts";
import { GR_PELL_COHORT_TYPE, GR_PELL_COLUMNS } from "../../lib/graduation-groups.ts";

/** A value read from one row: a column, or the sum of parts (IC2001 splits admissions by gender). */
export type ColumnSpec = string | { sum: readonly string[] };

export interface FileChoice {
  /** File name without .zip */
  name: string;
  /** Price files: which column suffix holds this year. */
  suffix?: "2" | "3";
}

export interface Era {
  family: HistoryFamily;
  years: readonly [number, number];
  /** Candidate files for a year, preferred first. */
  files: (year: number) => FileChoice[];
  /** Named values this era provides (admissions), each from a column or a sum of columns. */
  values?: Record<string, ColumnSpec>;
  /** Columns that must exist in the file's header (in addition to those in `values`). */
  required: (choice: FileChoice) => readonly string[];
  /** A second file merged under the first (a college's row in both is combined, the first file winning). */
  supplement?: (year: number) => string;
  /** Columns that must exist in the supplement. */
  supplementRequired?: readonly string[];
  /** Several rows per college: merge them into one, suffixing each column with this column's code (scripts/lib/om.mts). */
  pivot?: string;
  /** Files with several rows per college: the row to keep (GR{Y}_PELL_SSL keeps the total cohort). */
  keepRow?: (row: Record<string, string>) => boolean;
  /** The file for year Y is published as year Y + lag (graduation files follow a class 6 years on), for the refresh age. */
  lag?: number;
  /** Read every `step` years from `years[0]` (residence: even-numbered falls only). Default 1. */
  step?: number;
  /** Several rows per college, pivoted into one (scripts/lib/ipeds.mts `wide`). */
  wide?: { key: string; values: readonly string[] };
}

const yy = (y: number) => String(y % 100).padStart(2, "0");
const OPEN = 9999;

export const ADMISSIONS_VALUES = ["applicants", "admitted", "enrolled"] as const;

/**
 * Scores, submission rates, and test policy: the same column names in IC2001–IC2013 and ADM2014 on (probed
 * 2026-09-28). SATVR is Critical Reading before fall 2017 and Evidence-Based Reading & Writing after (see SAT_BREAK).
 * ADMCON7: 1 required, 2 recommended, 3 neither (from fall 2022: not considered), 5 considered but not required
 * (from fall 2016); 4 (don't know) and negatives are treated as not reported.
 */
const SCORES: Record<string, ColumnSpec> = {
  satvr25: "SATVR25",
  satvr75: "SATVR75",
  satmt25: "SATMT25",
  satmt75: "SATMT75",
  act25: "ACTCM25",
  act75: "ACTCM75",
  satpct: "SATPCT",
  actpct: "ACTPCT",
  policy: "ADMCON7",
};

/** Men's and women's applicants and admits: the same columns from IC2001 on (probed 2026-09-29). */
const BY_SEX: Record<string, ColumnSpec> = {
  applicants_men: "APPLCNM",
  applicants_women: "APPLCNW",
  admitted_men: "ADMSSNM",
  admitted_women: "ADMSSNW",
};

/** True medians: ADM2022 on only (absent through ADM2021, probed 2026-09-29). */
const MEDIANS: Record<string, ColumnSpec> = { satvr50: "SATVR50", satmt50: "SATMT50", act50: "ACTCM50" };

/**
 * Admission factors (specs/data-expansion/admission-factors.md), keyed `factor_{name}` as in lib/derive.ts
 * FACTOR_COLUMNS. Probed 2026-09-29: ADMCON1–6 and 8 in every file, ADMCON9 from IC2005, ADMCON10–12 from ADM2022.
 */
const factorValues = (cols: readonly number[]): Record<string, ColumnSpec> =>
  Object.fromEntries(
    (Object.entries(FACTOR_COLUMNS) as [string, string][]).filter(([, c]) => cols.includes(Number(c.replace("ADMCON", "")))).map(([k, c]) => [`factor_${k}`, c])
  );
const FACTORS_2001 = factorValues([1, 2, 3, 4, 5, 6, 8]);
const FACTORS_2005 = factorValues([1, 2, 3, 4, 5, 6, 8, 9]);
const FACTORS_2022 = factorValues([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);

export const ERAS: readonly Era[] = [
  {
    family: "ic-admissions",
    years: [2001, 2001],
    files: (y) => [{ name: `IC${y}` }],
    values: {
      applicants: { sum: ["APPLCNM", "APPLCNW"] },
      admitted: { sum: ["ADMSSNM", "ADMSSNW"] },
      enrolled: { sum: ["ENRLFTM", "ENRLFTW", "ENRLPTM", "ENRLPTW"] },
      ...SCORES,
      ...BY_SEX,
      ...FACTORS_2001,
    },
    required: () => [],
  },
  {
    family: "ic-admissions",
    years: [2002, 2004],
    files: (y) => [{ name: `IC${y}` }],
    values: { applicants: "APPLCN", admitted: "ADMSSN", enrolled: "ENRLT", ...SCORES, ...BY_SEX, ...FACTORS_2001 },
    required: () => [],
  },
  {
    family: "ic-admissions",
    years: [2005, 2013],
    files: (y) => [{ name: `IC${y}` }],
    values: { applicants: "APPLCN", admitted: "ADMSSN", enrolled: "ENRLT", ...SCORES, ...BY_SEX, ...FACTORS_2005 },
    required: () => [],
  },
  {
    family: "adm",
    years: [2014, 2021],
    files: (y) => [{ name: `ADM${y}` }],
    values: { applicants: "APPLCN", admitted: "ADMSSN", enrolled: "ENRLT", ...SCORES, ...BY_SEX, ...FACTORS_2005 },
    required: () => [],
  },
  {
    family: "adm",
    years: [2022, OPEN],
    files: (y) => [{ name: `ADM${y}` }],
    values: { applicants: "APPLCN", admitted: "ADMSSN", enrolled: "ENRLT", ...SCORES, ...BY_SEX, ...MEDIANS, ...FACTORS_2022 },
    required: () => [],
  },
  {
    family: "prices",
    years: [2000, OPEN],
    files: (y) => [
      { name: `IC${y}_AY`, suffix: "3" },
      { name: `COST1_${y + 1}`, suffix: "2" },
    ],
    required: (c) => ["CHG1AY", "CHG2AY", "CHG3AY", "CHG4AY", "CHG5AY", "CHG6AY"].map((k) => `${k}${c.suffix}`),
  },
  // Housing and application fee (specs/data-expansion/housing-and-policies.md; probed 2026-09-29): IC{Y} holds Y–Y+1
  // through IC2023; NCES then moved them into COST1_{Y+1} (IC2024 is a one-row stub).
  {
    family: "characteristics",
    years: [2001, 2023],
    files: (y) => [{ name: `IC${y}` }],
    required: () => ["ROOM", "ROOMCAP", "APPLFEEU"],
  },
  {
    family: "characteristics",
    years: [2024, OPEN],
    files: (y) => [{ name: `COST1_${y + 1}` }],
    required: () => ["ROOM", "ROOMCAP", "APPLFEEU"],
  },
  // Athletics and ROTC (specs/data-expansion/campus-services.md): IC{Y} every year, including IC2024 on (unlike housing).
  // From 2014: every conference code site colleges used since then has a name (lib/conferences.ts).
  // Student-to-faculty ratio (specs/data-expansion/student-faculty-ratio.md): EF{Y}D, fall Y; STUFACR from EF2009D.
  {
    family: "ef-d",
    years: [2009, OPEN],
    files: (y) => [{ name: `EF${y}D` }],
    required: () => ["STUFACR"],
  },
  // 8-year outcomes (specs/data-expansion/outcome-measures.md): OM{Y} follows the class entering fall Y - 8, one row per
  // cohort. OM2017 (fall 2009) is the first with Pell cohorts and the 8-year status split; OM2015-16 used other codes.
  {
    family: "om",
    years: [OM_FIRST_FILE - OM_LAG, OPEN],
    files: (y) => [{ name: `OM${y + OM_LAG}` }],
    required: () => [OM_PIVOT, ...OM_COLUMNS],
    pivot: OM_PIVOT,
  },
  // Graduation by Pell and loan status (specs/data-expansion/graduation-by-group.md): GR{Y+6}_PELL_SSL follows the class
  // that entered fall Y. GR2016 is the first file (probed 2026-10-02: GR2015_PELL_SSL doesn't exist); same columns since.
  {
    family: "gr-pell",
    years: [2010, OPEN],
    files: (y) => [{ name: `GR${y + 6}_PELL_SSL` }],
    required: () => GR_PELL_COLUMNS,
    keepRow: (r) => r.PSGRTYPE === GR_PELL_COHORT_TYPE,
    lag: 6,
  },
  // Faculty salary (specs/data-expansion/faculty.md): SAL{Y}_IS, all-ranks row (ARANK 7). Starts 2016, the first year
  // with the equated 9-month column (SAEQ9AT); lib/academics.ts facultySalaryFrom asserts ARANK 7 itself.
  {
    family: "ipeds-sal",
    years: [2016, OPEN],
    files: (y) => [{ name: `SAL${y}_IS` }],
    required: () => ["ARANK", "SAEQ9AT"],
    keepRow: (r) => r.ARANK === "7",
  },
  // Residence (specs/data-expansion/residence.md): EF{Y}C, fall Y, one row per college per home state. Probed
  // 2026-10-02: EFCSTATE/EFRES01 in every file EF2002C–EF2024C with the same codes; even years (required) cover ~1,800
  // site colleges, odd years ~1,000, so only even years. From fall 2004, as the spec says.
  {
    family: "ef-c",
    years: [2004, OPEN],
    step: 2,
    files: (y) => [{ name: `EF${y}C` }],
    required: () => ["EFCSTATE", "EFRES01"],
    wide: { key: "EFCSTATE", values: ["EFRES01"] },
  },
  {
    family: "services",
    years: [2014, OPEN],
    files: (y) => [{ name: `IC${y}` }],
    required: () => ["ATHASSOC", "ASSOC1", "ASSOC2", "SPORT1", "SPORT2", "SPORT3", "SPORT4", "CONFNO1", "CONFNO2", "CONFNO3", "CONFNO4", "SLO5"],
  },
  {
    family: "sfa",
    years: [2001, 2006],
    files: (y) => [{ name: `SFA${yy(y)}${yy(y + 1)}` }],
    required: () => ["SCFA11P", "SCFA12P", "SCFA13P"],
  },
  {
    family: "sfa",
    years: [2007, 2007],
    files: (y) => [{ name: `SFA${yy(y)}${yy(y + 1)}` }],
    required: () => ["SCFA11P", "SCFA12P", "SCFA13P", "SCUGFFN", "AGRNT_N", "AGRNT_P", "AGRNT_A"],
  },
  {
    family: "sfa",
    years: [2008, 2022],
    files: (y) => [{ name: `SFA${yy(y)}${yy(y + 1)}` }],
    required: () => [
      "SCFA11P", "SCFA12P", "SCFA13P", "SCUGFFN", "AGRNT_N", "AGRNT_P", "AGRNT_A", "AGRNT_T",
      "NPIST2", "NPGRN2", "NPIS412", "NPIS452", "NPT412", "NPT452",
    ],
  },
  {
    family: "sfa",
    years: [2023, OPEN],
    files: (y) => [{ name: `SFA${yy(y)}${yy(y + 1)}` }],
    required: () => ["SCUGFFN", "AGRNT_N", "AGRNT_P", "AGRNT_A", "AGRNT_T"],
    supplement: (y) => `COST2_${y + 1}`,
    supplementRequired: ["SCFA11P", "SCFA12P", "SCFA13P", "NPIST2", "NPGRN2", "NPIS412", "NPIS452", "NPT412", "NPT452"],
  },
];

export function eraFor(family: HistoryFamily, year: number): Era | null {
  return ERAS.find((e) => e.family === family && year >= e.years[0] && year <= e.years[1]) ?? null;
}

/** Families by the kind of year they describe, and the first year each can start. */
export const FAMILY_ORDER: readonly HistoryFamily[] = ["ic-admissions", "adm", "prices", "sfa", "characteristics", "services", "ef-d", "ef-c", "om", "gr-pell", "ipeds-sal"];

/** Columns a value spec reads. */
export function specColumns(spec: ColumnSpec): readonly string[] {
  return typeof spec === "string" ? [spec] : spec.sum;
}

/** Read a value spec from a row. A sum counts the parts reported (single-gender colleges leave the other blank). */
export function readSpec(row: Record<string, string> | undefined, spec: ColumnSpec): number | null {
  if (!row) return null;
  const num = (k: string) => {
    const v = row[k];
    if (!v || v === ".") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  if (typeof spec === "string") return num(spec);
  const parts = spec.sum.map(num).filter((v): v is number => v !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

/** Every column an era needs from a file, for the header check. */
export function requiredColumns(era: Era, choice: FileChoice): string[] {
  return [...new Set([...Object.values(era.values ?? {}).flatMap(specColumns), ...era.required(choice)])];
}
