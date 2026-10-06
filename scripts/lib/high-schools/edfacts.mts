/**
 * Four-year adjusted cohort graduation rate (ACGR), school level: the newest class becomes `grad_rate`, every class the
 * files hold becomes `grad_history` (specs/product/high-school-data.md "As built (graduation rates and history)").
 *
 * Two layouts are read:
 *
 * 1. ED Data Express (eddataexpress.ed.gov → Data Library), where the files have lived since ed.gov's EDFacts data-files
 *    page went away: folders named like `SY2021_FS150_FS151_DG695_DG696_SCH_data_files/` holding
 *    `SY2021_FS150_FS151_DG695_DG696_SCH.csv` (plus a README and a data_notes CSV). Only `_SCH_` files are school level;
 *    `_LEA_` (district) and `_SEA_` (state) folders are ignored. A file may hold several school years (`SY1018_…`
 *    covers 2010–11 to 2017–18); the "School Year" column, not the name, says which. Columns: "School Year", State,
 *    "NCES LEA ID", LEA, School, "NCES SCH ID", "Data Group", "Data Description", Value, Numerator, Denominator,
 *    Population, Subgroup, …. Only Subgroup "All Students in School" (older files: "All Students") is read; Value is
 *    the rate ("93%", "80-84%", ">=90%", "<50%", "<=10%", "S"), Denominator the cohort count.
 * 2. The old EDFacts long file `acgr-sch-sy{YYYY}-{YY}-long.csv` (SCHOOL_YEAR, NCESSCH, CATEGORY, COHORT, RATE, …),
 *    CATEGORY "ALL" only. One school year per file; only the newest cached file is read.
 *
 * Ranges stay ranges (parseRateRange, never a midpoint); "S" / "PS" are suppressed; blank, "NA", "." missing; cohort
 * counts under 5 are suppressed (small-cell rule). Excel-mangled ranges in older files ("14-Oct" for 10–14) are
 * repaired before parsing.
 *
 * Where the files come from, in order:
 *   1. `--edfacts-file <path>`: one CSV (either layout, told apart by its header), or a .zip holding an old long file;
 *   2. `--edfacts-dir <dir>`: every Data Express `*_SCH.csv` in that folder or its `SY*_SCH_data_files/` subfolders;
 *   3. `.cache/high-schools/SY*_SCH_data_files/*_SCH.csv` (every school-level folder the owner downloaded);
 *   4. an old long file already in `.cache/high-schools/` (newest year wins), then a download from ed.gov (which now
 *      mostly answers 403/404; the sync never works around a bot challenge).
 * To add a year: download the school-level file from ED Data Express, unzip its folder into `.cache/high-schools/`,
 * and rerun `npm run sync-high-schools -- --only edfacts --offline`.
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { HighSchool, HsGradHistoryEntry, HsSourceInfo } from "../../../lib/high-school-types.ts";
import { parseRateRange, suppress } from "../../../lib/high-school-core.ts";
import { retrievedOf } from "./crdc.mts";
import { readCsvRecords, schoolYearLabel } from "./federal-csv.mts";
import type { AdapterContext, AdapterInfo, AdapterResult, HighSchoolPatch } from "./types.mts";

export const info: AdapterInfo = {
  key: "edfacts",
  role: "enrichment",
  rowKind: "public",
  owns: ["grad_rate", "grad_history"],
  sources: ["edfacts"],
  vintages: ["edfacts-acgr", "edfacts-acgr-history"],
};

export const EDFACTS_LANDING = "https://www.ed.gov/data/edfacts-initiative/edfacts-data-files";
export const DATA_EXPRESS_URL = "https://eddataexpress.ed.gov/download/data-library";
const EDFACTS_BASE = "https://www.ed.gov/sites/ed/files/about/inits/ed/edfacts/data-files";
export const EDFACTS_FILE_RE = /^acgr-sch-sy(\d{4})-(\d{2})-long\.(csv|zip)$/i;
/** A Data Express school-level file: `SY2021_FS150_FS151_DG695_DG696_SCH.csv` (never `_LEA` / `_SEA`). */
export const DATA_EXPRESS_FILE_RE = /^SY\d{4}_.*_SCH\.csv$/i;
export const DATA_EXPRESS_DIR_RE = /^SY\d{4}_.*_SCH_data_files$/i;

/** "acgr-sch-sy2022-23-long.csv" for the school year starting in 2022. */
export function edfactsFileName(startYear: number): string {
  return `acgr-sch-sy${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}-long.csv`;
}

/** Download candidates, newest first: the school year ending two to five years before `now`. */
export function edfactsCandidates(now: Date): string[] {
  const y = now.getUTCFullYear();
  return [y - 3, y - 4, y - 5, y - 6].map((start) => `${EDFACTS_BASE}/${edfactsFileName(start)}`);
}

/** 2020 for "2020-2021" / "2020-21" (the year the school year starts). */
export function schoolYearStart(schoolYear: string): number | null {
  const m = /^(\d{4})\s*[-–]\s*(\d{2}|\d{4})$/.exec(schoolYear.trim());
  return m ? Number(m[1]) : null;
}

/** "Class of 2023" for "2022-2023" / "2022-23": the cohort that graduated at the end of that school year. */
export function classOf(schoolYear: string): string | null {
  const start = schoolYearStart(schoolYear);
  return start === null ? null : `Class of ${start + 1}`;
}

/** "Class of 2021", or "Classes of 2011–2021" when the files span several classes. */
export function classSpan(startYears: readonly number[]): string | null {
  if (!startYears.length) return null;
  const lo = Math.min(...startYears) + 1;
  const hi = Math.max(...startYears) + 1;
  return lo === hi ? `Class of ${hi}` : `Classes of ${lo}–${hi}`;
}

/** "2020–21 school year", or "2010–11 to 2020–21 school years". */
function schoolYearSpan(startYears: readonly number[]): string {
  const label = (y: number) => schoolYearLabel(`${y}-${y + 1}`)!;
  const lo = Math.min(...startYears);
  const hi = Math.max(...startYears);
  return lo === hi ? `${label(hi)} school year` : `${label(lo)} to ${label(hi)} school years`;
}

export function edfactsSourceInfo(url: string, retrieved: string, schoolYear: string): HsSourceInfo {
  return {
    name: `EDFacts four-year adjusted cohort graduation rates, ${schoolYear.replace("-", "–")} school year`,
    publisher: "U.S. Department of Education, EDFacts",
    url,
    retrieved,
  };
}

export function dataExpressSourceInfo(retrieved: string, startYears: readonly number[]): HsSourceInfo {
  return {
    name: `ED Data Express, four-year adjusted-cohort graduation rate and cohort count (EDFacts FS150/FS151), school level, ${schoolYearSpan(startYears)}`,
    publisher: "U.S. Department of Education, ED Data Express (EDFacts)",
    url: DATA_EXPRESS_URL,
    retrieved,
  };
}

export const EDFACTS_SUPPRESSED = ["PS", "S", "*"];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * A rate cell as the source meant it. Older ED Data Express files went through a spreadsheet that turned some ranges
 * into dates ("10-14" → "14-Oct", "6-9" → "9-Jun", "11-19" → "19-Nov"); those become the range again.
 */
export function repairRateCell(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  const m = /^(\d{1,2})-([A-Za-z]{3})$/.exec(t) ?? /^([A-Za-z]{3})-(\d{1,2})$/.exec(t);
  if (!m) return t;
  const [day, mon] = /^\d/.test(m[1]) ? [Number(m[1]), m[2]] : [Number(m[2]), m[1]];
  const month = MONTHS.indexOf(mon.toUpperCase()) + 1;
  if (!month) return t;
  return `${Math.min(month, day)}-${Math.max(month, day)}`;
}

/** One school's reported cell for one school year, from either layout. */
export interface AcgrCell {
  id: string;
  /** "2020-2021" as the file writes it. */
  schoolYear: string;
  rate: string;
  cohort: string;
}

interface ParsedCell {
  /** null when the cell is missing (nothing reported): such a class is left out. */
  grad: NonNullable<HighSchool["grad_rate"]> | null;
  rateSuppressed: boolean;
  cohortSuppressed: boolean;
}

function parseCell(c: Pick<AcgrCell, "rate" | "cohort">): ParsedCell {
  const rate = parseRateRange(repairRateCell(c.rate), EDFACTS_SUPPRESSED);
  const cohortCell = suppress(c.cohort, { kind: "count", suppressedCodes: EDFACTS_SUPPRESSED });
  if (rate.suppressed) return { grad: { value: null, low: null, high: null, cohort: cohortCell.value }, rateSuppressed: true, cohortSuppressed: cohortCell.suppressed };
  if (rate.value !== null || rate.low !== null) {
    return { grad: { value: rate.value, low: rate.low, high: rate.high, cohort: cohortCell.value }, rateSuppressed: false, cohortSuppressed: cohortCell.suppressed };
  }
  return { grad: null, rateSuppressed: false, cohortSuppressed: false };
}

/**
 * One school's graduation rate patch from its CATEGORY=ALL record (old long layout). A missing rate (blank, "NA")
 * gives a null grad_rate; "PS" gives an empty rate (with the cohort when reported) listed as suppressed.
 */
export function buildEdfactsPatch(rec: Record<string, string>): HighSchoolPatch | null {
  const id = normalizeNcessch(rec.NCESSCH);
  if (!id) return null;
  return patchFor(id, [{ start: 0, cell: parseCell({ rate: rec.RATE, cohort: rec.COHORT }) }], 0);
}

/** A school's patch from its cells by school year: the newest year → grad_rate, every reported year → grad_history. */
function patchFor(id: string, cells: { start: number; cell: ParsedCell }[], newest: number): HighSchoolPatch {
  const sorted = [...cells].sort((a, b) => a.start - b.start);
  const current = sorted.find((c) => c.start === newest)?.cell ?? null;
  const suppressed: string[] = [];
  let grad: HighSchool["grad_rate"] = null;
  if (current?.grad) {
    grad = current.grad;
    if (current.rateSuppressed) suppressed.push("grad_rate");
    else if (current.cohortSuppressed) suppressed.push("grad_rate.cohort");
  }
  const entries: HsGradHistoryEntry[] = sorted
    .filter((c) => c.cell.grad)
    .map(({ start, cell }) => ({ year: `Class of ${start + 1}`, ...cell.grad!, ...(cell.rateSuppressed ? { suppressed: true as const } : {}) }));
  const history = entries.length >= 2 ? entries : null;
  return { id, values: { grad_rate: grad, grad_history: history }, ...(suppressed.length ? { suppressed } : {}) };
}

export interface AcgrBuild {
  patches: HighSchoolPatch[];
  /** School years seen (start years), ascending. */
  years: number[];
  newest: number | null;
  /** Records for a school and year already seen (first wins). */
  duplicates: number;
  /** Rate cell shapes per school year: { 2020: { "N%": 5962, ">=N%": 7099, S: 1143, … } }. */
  codes: Record<number, Record<string, number>>;
  /** Records whose school year couldn't be read. */
  badYear: number;
}

/** Shape of a rate cell for the run's notes: digits → N ("80-84%" → "N-N%"). */
const shape = (raw: string) => (raw.trim() ? raw.trim().toUpperCase().replace(/\d+(\.\d+)?/g, "N") : "(blank)");

/** Cells (any layout, any years, in file order) → one patch per school. */
export function buildAcgr(cells: Iterable<AcgrCell>): AcgrBuild {
  const bySchool = new Map<string, Map<number, ParsedCell>>();
  const codes: Record<number, Record<string, number>> = {};
  const years = new Set<number>();
  let duplicates = 0;
  let badYear = 0;
  for (const c of cells) {
    const start = schoolYearStart(c.schoolYear);
    if (start === null) {
      badYear++;
      continue;
    }
    years.add(start);
    const k = shape(c.rate);
    (codes[start] ??= {})[k] = (codes[start][k] ?? 0) + 1;
    let m = bySchool.get(c.id);
    if (!m) bySchool.set(c.id, (m = new Map()));
    if (m.has(start)) {
      duplicates++;
      continue;
    }
    m.set(start, parseCell(c));
  }
  const sortedYears = [...years].sort((a, b) => a - b);
  const newest = sortedYears.length ? sortedYears[sortedYears.length - 1] : null;
  const patches = [...bySchool.entries()].map(([id, m]) => patchFor(id, [...m.entries()].map(([start, cell]) => ({ start, cell })), newest ?? -1));
  return { patches, years: sortedYears, newest, duplicates, codes, badYear };
}

/** EDFacts writes NCESSCH as a number in some releases (leading zero dropped): pad to 12 digits. */
export function normalizeNcessch(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!/^\d{11,12}$/.test(t)) return null;
  return t.padStart(12, "0");
}

/** Subgroups that mean "every student in the school" (Data Express names it "All Students in School"; older files "All Students"). */
const ALL_STUDENTS = new Set(["ALL STUDENTS IN SCHOOL", "ALL STUDENTS"]);

/** The all-students rate records of one Data Express CSV. */
export async function* readDataExpressCells(path: string): AsyncGenerator<AcgrCell> {
  for await (const rec of readCsvRecords(dirname(path), basename(path))) {
    if (!ALL_STUDENTS.has((rec.SUBGROUP ?? "").toUpperCase())) continue;
    const pop = (rec.POPULATION ?? "").toUpperCase();
    if (pop && pop !== "ALL STUDENTS") continue;
    if (rec["DATA GROUP"] && !rec["DATA GROUP"].split(/[|,]/).includes("695")) continue;
    const id = normalizeNcessch(rec["NCES SCH ID"]);
    if (!id) continue;
    yield { id, schoolYear: rec["SCHOOL YEAR"] ?? "", rate: rec.VALUE ?? "", cohort: rec.DENOMINATOR ?? "" };
  }
}

/** The CATEGORY=ALL records of one old long file (a CSV, or a zip / directory holding it). */
export async function* readLongCells(source: string, entry: string): AsyncGenerator<AcgrCell> {
  for await (const rec of readCsvRecords(source, entry, { encoding: "latin1" })) {
    if ((rec.CATEGORY ?? "").toUpperCase() !== "ALL") continue;
    const id = normalizeNcessch(rec.NCESSCH);
    if (!id) continue;
    yield { id, schoolYear: rec.SCHOOL_YEAR ?? "", rate: rec.RATE ?? "", cohort: rec.COHORT ?? "" };
  }
}

/** Whether a CSV is a Data Express file (its header names "NCES SCH ID"). */
export function isDataExpressCsv(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n).toString("utf8").split(/\r?\n/)[0].toUpperCase();
    return head.includes("NCES SCH ID");
  } finally {
    closeSync(fd);
  }
}

/** Every Data Express school-level CSV in `dir` itself or its `SY*_SCH_data_files/` subfolders, newest name first. */
export function findDataExpressFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (DATA_EXPRESS_FILE_RE.test(name)) out.push(p);
    else if (DATA_EXPRESS_DIR_RE.test(name) && statSync(p).isDirectory()) {
      for (const inner of readdirSync(p)) if (DATA_EXPRESS_FILE_RE.test(inner)) out.push(join(p, inner));
    }
  }
  // Newest release first, so where two files hold the same school year the later release wins.
  return out.sort((a, b) => (basename(b) < basename(a) ? -1 : basename(b) > basename(a) ? 1 : 0));
}

interface LocatedLong {
  path: string;
  url: string;
  startYear: number | null;
}

function yearOfName(name: string): number | null {
  const m = EDFACTS_FILE_RE.exec(name);
  return m ? Number(m[1]) : null;
}

type Located = { kind: "data-express"; files: string[] } | ({ kind: "long" } & LocatedLong);

/** Find the files: flags, then Data Express folders in the cache, then an old long file, then a download. */
export async function locateEdfacts(ctx: AdapterContext): Promise<Located | null> {
  const flag = ctx.flags["edfacts-file"];
  if (typeof flag === "string") {
    const path = resolve(process.cwd(), flag);
    if (!existsSync(path)) throw new Error(`--edfacts-file ${flag}: no such file`);
    if (/\.csv$/i.test(path) && isDataExpressCsv(path)) return { kind: "data-express", files: [path] };
    const y = yearOfName(basename(path));
    return { kind: "long", path, url: y !== null ? `${EDFACTS_BASE}/${edfactsFileName(y)}` : EDFACTS_LANDING, startYear: y };
  }
  const dirFlag = ctx.flags["edfacts-dir"];
  if (typeof dirFlag === "string") {
    const dir = resolve(process.cwd(), dirFlag);
    const files = findDataExpressFiles(dir);
    if (!files.length) throw new Error(`--edfacts-dir ${dirFlag}: no ED Data Express school-level file (SY…_SCH.csv) there`);
    return { kind: "data-express", files };
  }
  const express = findDataExpressFiles(ctx.cacheDir);
  if (express.length) return { kind: "data-express", files: express };
  const cached = existsSync(ctx.cacheDir)
    ? readdirSync(ctx.cacheDir).filter((f) => EDFACTS_FILE_RE.test(f)).sort((a, b) => (yearOfName(b) ?? 0) - (yearOfName(a) ?? 0))
    : [];
  if (cached.length) {
    const y = yearOfName(cached[0])!;
    return { kind: "long", path: join(ctx.cacheDir, cached[0]), url: `${EDFACTS_BASE}/${edfactsFileName(y)}`, startYear: y };
  }
  for (const url of edfactsCandidates(ctx.now)) {
    try {
      const path = await ctx.fetchCached(url);
      return { kind: "long", path, url, startYear: yearOfName(basename(url)) };
    } catch (err) {
      ctx.log(`  edfacts: ${(err as Error).message}`);
    }
  }
  return null;
}

async function collect(gen: AsyncGenerator<AcgrCell>, into: AcgrCell[]): Promise<number> {
  let n = 0;
  for await (const c of gen) {
    into.push(c);
    n++;
  }
  return n;
}

/** The day the files were downloaded: `--edfacts-retrieved`, else the newest of their folders' dates. */
function retrievedFor(ctx: AdapterContext, files: readonly string[]): string {
  const flag = ctx.flags["edfacts-retrieved"];
  if (typeof flag === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(flag)) throw new Error(`--edfacts-retrieved ${flag}: use YYYY-MM-DD`);
    return flag;
  }
  return files.map((f) => localDate(statSync(dirname(f)).mtime)).sort().at(-1)!;
}

/** YYYY-MM-DD on the machine's own calendar (a folder unzipped at 8:30 pm Pacific was downloaded that day, not the next UTC one). */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function notesFor(label: string, build: AcgrBuild, files: number): string[] {
  const values = build.patches.filter((p) => p.values.grad_rate);
  const withHistory = build.patches.filter((p) => p.values.grad_history).length;
  return [
    `edfacts ${label}: ${files} file(s), school years ${build.years.map((y) => `${y}-${y + 1}`).join(", ") || "none"}; ${build.patches.length} schools, ${values.length} with a newest-class rate or suppressed cell, ${withHistory} with two or more classes${build.duplicates ? `; ${build.duplicates} repeated school-year records ignored` : ""}${build.badYear ? `; ${build.badYear} records without a school year` : ""}`,
    ...build.years.map((y) => `  ${y}-${y + 1} rate cells: ${JSON.stringify(build.codes[y])}`),
  ];
}

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  const found = await locateEdfacts(ctx);
  if (!found) {
    const msg =
      `edfacts: no ACGR school file available. Download the school-level four-year ACGR file (FS150/FS151, SCH) from ` +
      `${DATA_EXPRESS_URL}, unzip its SY…_SCH_data_files folder into ${ctx.cacheDir}, and rerun with --only edfacts; ` +
      `graduation rates unchanged.`;
    ctx.warn(msg);
    return { sources: {}, vintages: {}, notes: [msg] };
  }

  if (found.kind === "data-express") {
    const cells: AcgrCell[] = [];
    const perFile: string[] = [];
    for (const f of found.files) perFile.push(`  ${basename(f)}: ${await collect(readDataExpressCells(f), cells)} all-students records`);
    const build = buildAcgr(cells);
    if (build.newest === null) throw new Error(`edfacts: ${found.files.join(", ")}: no all-students school records (is this a _SCH_ file?)`);
    return {
      patches: build.patches,
      sources: { edfacts: dataExpressSourceInfo(retrievedFor(ctx, found.files), build.years) },
      vintages: { "edfacts-acgr": `Class of ${build.newest + 1}`, "edfacts-acgr-history": classSpan(build.years) },
      notes: [...notesFor("ED Data Express", build, found.files.length), ...perFile],
    };
  }

  let source = found.path;
  let entry = basename(found.path);
  if (/\.zip$/i.test(found.path)) {
    const inner = ctx.listZip(found.path).find((f) => /\.csv$/i.test(f));
    if (!inner) throw new Error(`${found.path}: no CSV inside`);
    entry = inner;
  } else {
    source = join(found.path, "..");
  }
  const cells: AcgrCell[] = [];
  await collect(readLongCells(source, entry), cells);
  const fromName = found.startYear !== null ? `${found.startYear}-${found.startYear + 1}` : null;
  // Files without a SCHOOL_YEAR column take the year from their name.
  const filled = fromName ? cells.map((c) => (c.schoolYear ? c : { ...c, schoolYear: fromName })) : cells;
  const build = buildAcgr(filled);
  if (build.newest === null) throw new Error(`${found.path}: can't tell the school year (no SCHOOL_YEAR column or year in the name)`);
  const schoolYear = `${build.newest}-${build.newest + 1}`;
  return {
    patches: build.patches,
    sources: { edfacts: edfactsSourceInfo(found.url, retrievedOf(found.path), schoolYear) },
    vintages: { "edfacts-acgr": classOf(schoolYear), "edfacts-acgr-history": classSpan(build.years) },
    notes: notesFor(`long file ${basename(found.path)}`, build, 1),
  };
}
