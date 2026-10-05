/**
 * EDFacts four-year adjusted cohort graduation rate (ACGR), school level, from the U.S. Department of Education's
 * EDFacts data files (`acgr-sch-sy{YYYY}-{YY}-long.csv`, long format since SY 2019–20; columns SCHOOL_YEAR, STNAM,
 * FIPST, LEAID, ST_LEAID, LEANM, NCESSCH, ST_SCHID, SCHNAM, CATEGORY, COHORT, RATE, DATE_CUR). Only CATEGORY "ALL"
 * (all students) is read.
 *
 * RATE is a whole percent, or a range EDFacts publishes instead to protect small cohorts ("90-94", "GE80", "LT50"):
 * ranges stay ranges (parseRateRange, never a midpoint). "PS" (and "S", "*") is suppressed; blank, ".", "NA" missing.
 *
 * Where the file comes from, in order:
 *   1. `--edfacts-file <path>` (a .csv, or a .zip holding one);
 *   2. a file named `acgr-sch-sy{YYYY}-{YY}-long.csv` (or .zip) already in `.cache/high-schools/` (newest year wins);
 *   3. a download from ed.gov, trying the newest school years first.
 * www.ed.gov answers scripted requests with a bot challenge (HTTP 403) from some networks; the sync never works around
 * it. Then: download the file in a browser from https://www.ed.gov/data/edfacts-initiative/edfacts-data-files into
 * `.cache/high-schools/` and rerun `npm run sync-high-schools -- --only edfacts`. Until a file is available the adapter
 * loads nothing and graduation rates stay as the shards have them.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { HighSchool, HsSourceInfo } from "../../../lib/high-school-types.ts";
import { parseRateRange, suppress } from "../../../lib/high-school-core.ts";
import { retrievedOf } from "./crdc.mts";
import { readCsvRecords } from "./federal-csv.mts";
import type { AdapterContext, AdapterInfo, AdapterResult, HighSchoolPatch } from "./types.mts";

export const info: AdapterInfo = {
  key: "edfacts",
  role: "enrichment",
  rowKind: "public",
  owns: ["grad_rate"],
  sources: ["edfacts"],
  vintages: ["edfacts-acgr"],
};

export const EDFACTS_LANDING = "https://www.ed.gov/data/edfacts-initiative/edfacts-data-files";
const EDFACTS_BASE = "https://www.ed.gov/sites/ed/files/about/inits/ed/edfacts/data-files";
export const EDFACTS_FILE_RE = /^acgr-sch-sy(\d{4})-(\d{2})-long\.(csv|zip)$/i;

/** "acgr-sch-sy2022-23-long.csv" for the school year starting in 2022. */
export function edfactsFileName(startYear: number): string {
  return `acgr-sch-sy${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}-long.csv`;
}

/** Download candidates, newest first: the school year ending two to five years before `now`. */
export function edfactsCandidates(now: Date): string[] {
  const y = now.getUTCFullYear();
  return [y - 3, y - 4, y - 5, y - 6].map((start) => `${EDFACTS_BASE}/${edfactsFileName(start)}`);
}

/** "Class of 2023" for "2022-2023" / "2022-23": the cohort that graduated at the end of that school year. */
export function classOf(schoolYear: string): string | null {
  const m = /^(\d{4})\s*[-–]\s*(\d{2}|\d{4})$/.exec(schoolYear.trim());
  if (!m) return null;
  return `Class of ${Number(m[1]) + 1}`;
}

export function edfactsSourceInfo(url: string, retrieved: string, schoolYear: string): HsSourceInfo {
  return {
    name: `EDFacts four-year adjusted cohort graduation rates, ${schoolYear.replace("-", "–")} school year`,
    publisher: "U.S. Department of Education, EDFacts",
    url,
    retrieved,
  };
}

export const EDFACTS_SUPPRESSED = ["PS", "S", "*"];

/**
 * One school's graduation rate patch from its CATEGORY=ALL record. A missing rate (blank, "NA") gives a null
 * grad_rate; "PS" gives an empty rate (with the cohort when reported) listed as suppressed.
 */
export function buildEdfactsPatch(rec: Record<string, string>): HighSchoolPatch | null {
  const id = normalizeNcessch(rec.NCESSCH);
  if (!id) return null;
  const rate = parseRateRange(rec.RATE, EDFACTS_SUPPRESSED);
  const cohortCell = suppress(rec.COHORT, { kind: "count", suppressedCodes: EDFACTS_SUPPRESSED });
  const suppressed: string[] = [];
  let grad: HighSchool["grad_rate"] = null;
  if (rate.suppressed) {
    grad = { value: null, low: null, high: null, cohort: cohortCell.value };
    suppressed.push("grad_rate");
  } else if (rate.value !== null || rate.low !== null) {
    grad = { value: rate.value, low: rate.low, high: rate.high, cohort: cohortCell.value };
    if (cohortCell.suppressed) suppressed.push("grad_rate.cohort");
  }
  return { id, values: { grad_rate: grad }, ...(suppressed.length ? { suppressed } : {}) };
}

/** EDFacts writes NCESSCH as a number in some releases (leading zero dropped): pad to 12 digits. */
export function normalizeNcessch(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!/^\d{11,12}$/.test(t)) return null;
  return t.padStart(12, "0");
}

export interface EdfactsRead {
  patches: HighSchoolPatch[];
  schoolYear: string | null;
  duplicates: number;
  codes: Map<string, number>;
}

/** Every CATEGORY=ALL record of a file → patches (first record per school wins; repeats counted). */
export async function readEdfacts(source: string, entry: string): Promise<EdfactsRead> {
  const byId = new Map<string, HighSchoolPatch>();
  const codes = new Map<string, number>();
  let schoolYear: string | null = null;
  let duplicates = 0;
  for await (const rec of readCsvRecords(source, entry, { encoding: "latin1" })) {
    if ((rec.CATEGORY ?? "").toUpperCase() !== "ALL") continue;
    schoolYear ??= rec.SCHOOL_YEAR || null;
    const r = (rec.RATE ?? "").toUpperCase();
    const kind = /^\d+(\.\d+)?$/.test(r) ? "exact" : /^\d+-\d+$/.test(r) ? "range" : /^(GE|GT|LE|LT)\d+$/.test(r) ? r.slice(0, 2) : r || "(blank)";
    codes.set(kind, (codes.get(kind) ?? 0) + 1);
    const p = buildEdfactsPatch(rec);
    if (!p) continue;
    if (byId.has(p.id)) duplicates++;
    else byId.set(p.id, p);
  }
  return { patches: [...byId.values()], schoolYear, duplicates, codes };
}

interface Located {
  path: string;
  url: string;
  startYear: number | null;
}

function yearOfName(name: string): number | null {
  const m = EDFACTS_FILE_RE.exec(name);
  return m ? Number(m[1]) : null;
}

/** Find the file: flag, then the cache, then a download. Null when none is available. */
export async function locateEdfacts(ctx: AdapterContext): Promise<Located | null> {
  const flag = ctx.flags["edfacts-file"];
  if (typeof flag === "string") {
    const path = resolve(process.cwd(), flag);
    if (!existsSync(path)) throw new Error(`--edfacts-file ${flag}: no such file`);
    const name = basename(path);
    const y = yearOfName(name);
    return { path, url: y !== null ? `${EDFACTS_BASE}/${edfactsFileName(y)}` : EDFACTS_LANDING, startYear: y };
  }
  const cached = existsSync(ctx.cacheDir)
    ? readdirSync(ctx.cacheDir).filter((f) => EDFACTS_FILE_RE.test(f)).sort((a, b) => (yearOfName(b) ?? 0) - (yearOfName(a) ?? 0))
    : [];
  if (cached.length) {
    const y = yearOfName(cached[0])!;
    return { path: join(ctx.cacheDir, cached[0]), url: `${EDFACTS_BASE}/${edfactsFileName(y)}`, startYear: y };
  }
  for (const url of edfactsCandidates(ctx.now)) {
    try {
      const path = await ctx.fetchCached(url);
      return { path, url, startYear: yearOfName(basename(url)) };
    } catch (err) {
      ctx.log(`  edfacts: ${(err as Error).message}`);
    }
  }
  return null;
}

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  const found = await locateEdfacts(ctx);
  if (!found) {
    const msg =
      `edfacts: no ACGR school file available (www.ed.gov refused the download or it isn't cached). Download ` +
      `acgr-sch-sy{YYYY}-{YY}-long.csv from ${EDFACTS_LANDING} into ${ctx.cacheDir} and rerun with --only edfacts; ` +
      `graduation rates unchanged.`;
    ctx.warn(msg);
    return { sources: {}, vintages: {}, notes: [msg] };
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
  const read = await readEdfacts(source, entry);
  const fromName = found.startYear !== null ? `${found.startYear}-${found.startYear + 1}` : null;
  const schoolYear = read.schoolYear ?? fromName;
  if (!schoolYear) throw new Error(`${found.path}: can't tell the school year (no SCHOOL_YEAR column or year in the name)`);
  const values = read.patches.filter((p) => p.values.grad_rate);
  return {
    patches: read.patches,
    sources: { edfacts: edfactsSourceInfo(found.url, retrievedOf(found.path), schoolYear) },
    vintages: { "edfacts-acgr": classOf(schoolYear) },
    notes: [
      `edfacts ${schoolYear}: ${read.patches.length} schools (${values.length} with a rate or suppressed cell); RATE codes ${JSON.stringify(Object.fromEntries(read.codes))}${read.duplicates ? `; ${read.duplicates} repeated rows ignored` : ""}`,
    ],
  };
}
