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
}

const yy = (y: number) => String(y % 100).padStart(2, "0");
const OPEN = 9999;

export const ADMISSIONS_VALUES = ["applicants", "admitted", "enrolled"] as const;

export const ERAS: readonly Era[] = [
  {
    family: "ic-admissions",
    years: [2001, 2001],
    files: (y) => [{ name: `IC${y}` }],
    values: {
      applicants: { sum: ["APPLCNM", "APPLCNW"] },
      admitted: { sum: ["ADMSSNM", "ADMSSNW"] },
      enrolled: { sum: ["ENRLFTM", "ENRLFTW", "ENRLPTM", "ENRLPTW"] },
    },
    required: () => [],
  },
  {
    family: "ic-admissions",
    years: [2002, 2013],
    files: (y) => [{ name: `IC${y}` }],
    values: { applicants: "APPLCN", admitted: "ADMSSN", enrolled: "ENRLT" },
    required: () => [],
  },
  {
    family: "adm",
    years: [2014, OPEN],
    files: (y) => [{ name: `ADM${y}` }],
    values: { applicants: "APPLCN", admitted: "ADMSSN", enrolled: "ENRLT" },
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
export const FAMILY_ORDER: readonly HistoryFamily[] = ["ic-admissions", "adm", "prices", "sfa"];

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
