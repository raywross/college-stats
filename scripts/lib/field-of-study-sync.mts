/**
 * sync-data's Field of Study step (specs/data-expansion/field-of-study.md) and the `programs` detail table it adds
 * to data/detail/schools/{unitid}.json (lib/detail.ts, lib/field-of-study.ts). Kept out of scripts/sync-data.mts so
 * that file only calls in, like scripts/lib/residence-sync.mts.
 *
 * Unlike the IPEDS files scripts/lib/ipeds.mts fetches, this is a College Scorecard bulk CSV served from a dated
 * URL that changes every release (no stable filename), so it's discovered by reading the data page's own links
 * rather than guessed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SchoolDetail } from "../../lib/detail.ts";
import { hasEarnings, isPlausibleCip4, toCip4, type ProgramEarnings } from "../../lib/field-of-study.ts";
import type { DatasetMeta, School } from "../../lib/types.ts";

const DATA_PAGE = "https://collegescorecard.ed.gov/data/";

const NEEDED_COLUMNS = ["UNITID", "MAIN", "CIPCODE", "CIPDESC", "CREDLEV", "IPEDSCOUNT1", "IPEDSCOUNT2", "EARN_MDN_1YR", "EARN_MDN_4YR", "EARN_MDN_4YR_NAT", "EARN_PELL_WNE_MDN_4YR", "EARN_NOPELL_WNE_MDN_4YR", "DEBT_ALL_STGP_EVAL_MDN"] as const;

/**
 * A narrow CSV reader for this one file only: ~228,000 rows × ~190 columns (unlike the IPEDS files
 * scripts/lib/ipeds.mts reads, which are far smaller). `parseCsv` there keeps every column of every row, which is
 * fine for those files but OOMs here; this tokenizes each row and keeps only `NEEDED_COLUMNS`, dropping
 * non-bachelor's/non-main rows (the large majority) before ever allocating an object for them.
 */
function readNeededColumns(text: string, needed: readonly string[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let i = 0;
  const n = text.length;
  // Header row: same quote handling as a data row, but we only need the column names.
  const header: string[] = [];
  {
    let field = "";
    let quoted = false;
    for (; i < n; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        header.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        header.push(field);
        i++;
        break;
      } else field += c;
    }
  }
  const cols = header.map((h) => h.trim().toUpperCase().replace(/^(﻿|ï»¿)/, ""));
  const wantIdx = new Map(needed.map((name) => [name, cols.indexOf(name)]));
  for (const [name, idx] of wantIdx) if (idx < 0) throw new Error(`Field of Study CSV has no ${name} column`);
  const credLevIdx = wantIdx.get("CREDLEV")!;
  const mainIdx = wantIdx.get("MAIN")!;

  let field = "";
  let quoted = false;
  let col = 0;
  let sawAny = false;
  const want = new Map<number, string>([...wantIdx.entries()].map(([name, idx]) => [idx, name]));
  const row = new Map<number, string>();
  const flushField = () => {
    if (want.has(col)) row.set(col, field);
    field = "";
    col++;
    sawAny = true;
  };
  const flushRow = () => {
    // Bachelor's (CREDLEV 3), main-campus (MAIN 1) only: the large majority of rows are dropped here, before any
    // per-column object is built for them.
    if (sawAny && row.get(credLevIdx) === "3" && row.get(mainIdx) === "1") {
      const rec: Record<string, string> = {};
      for (const [idx, name] of want) rec[name] = row.get(idx) ?? "";
      out.push(rec);
    }
    row.clear();
    col = 0;
    sawAny = false;
  };
  for (; i < n; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") flushField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      flushField();
      flushRow();
    } else field += c;
  }
  if (field || col > 0) {
    flushField();
  }
  if (sawAny) flushRow();
  return out;
}

export interface FosData {
  /** Where this run's copy came from (cited in meta.json). */
  url: string;
  /** Bachelor's (CREDLEV 3), main-campus (MAIN 1) rows, by unit id. */
  rows: Map<string, Record<string, string>[]>;
}

/**
 * The Field of Study bulk CSV's current download link. The file lives at
 * https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Field-of-Study_{date}.zip, where the
 * date changes every release, so it's scraped from the data page rather than hard-coded (see the spec's "Refresh
 * and maintenance").
 */
export async function discoverFieldOfStudyUrl(): Promise<string> {
  const res = await fetch(DATA_PAGE);
  if (!res.ok) throw new Error(`${DATA_PAGE}: HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/https:\/\/ed-public-download\.scorecard\.network\/downloads\/Most-Recent-Cohorts-Field-of-Study_\d+\.zip/);
  if (!m) throw new Error(`Couldn't find the Field of Study bulk CSV link on ${DATA_PAGE} (the page's markup may have changed)`);
  return m[0];
}

/**
 * Downloads (or reuses a cached) Field of Study CSV and keeps bachelor's, main-campus rows, grouped by unit id.
 * Throws if Scorecard renamed a column this reads to, or if the file can't be reached and nothing is cached.
 */
export async function fetchFieldOfStudy(cacheDir: string, opts: { maxAgeDays?: number; offline?: boolean } = {}): Promise<FosData> {
  mkdirSync(cacheDir, { recursive: true });
  const zip = join(cacheDir, "field-of-study.zip");
  const urlFile = `${zip}.url`;
  const maxAge = (opts.maxAgeDays ?? 7) * 86_400_000;
  const cached = existsSync(zip) && existsSync(urlFile);
  let url: string;
  if (cached && (opts.offline || Date.now() - statSync(zip).mtimeMs < maxAge)) {
    url = readFileSync(urlFile, "utf8").trim();
  } else if (opts.offline) {
    if (!cached) throw new Error("No cached Field of Study CSV and --offline was set");
    url = readFileSync(urlFile, "utf8").trim();
  } else {
    try {
      url = await discoverFieldOfStudyUrl();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const tmp = `${zip}.part`;
      writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      renameSync(tmp, zip);
      writeFileSync(urlFile, url);
    } catch (err) {
      if (!cached) throw err;
      console.warn(`  Field of Study: couldn't refresh (${err instanceof Error ? err.message : err}), using the cached copy`);
      url = readFileSync(urlFile, "utf8").trim();
    }
  }
  const files = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter((f) => /\.csv$/i.test(f));
  const csv = files[0];
  if (!csv) throw new Error(`${zip} has no CSV inside`);
  const text = execFileSync("unzip", ["-p", zip, csv], { encoding: "latin1", maxBuffer: 1024 * 1024 * 1024 });
  // Column names come straight off the header; a renamed/missing needed column throws inside readNeededColumns.
  const parsed = readNeededColumns(text, NEEDED_COLUMNS);
  const rows = new Map<string, Record<string, string>[]>();
  for (const r of parsed) {
    (rows.get(r.UNITID) ?? rows.set(r.UNITID, []).get(r.UNITID)!).push(r);
  }
  return { url, rows };
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One college's bachelor's programs, keyed by 4-digit CIP. "PS" (privacy-suppressed) and "NA" (not available) both
 * become null — never 0 — per data-lineage.md; the UI shows null earnings as "Too few graduates to report" (every
 * null in this table has that cause, by construction: a row only exists because NCES/NSLDS recognized the program).
 */
export function programEarningsFrom(rows: readonly Record<string, string>[]): Record<string, ProgramEarnings> {
  const out: Record<string, ProgramEarnings> = {};
  for (const r of rows) {
    const g1 = num(r.IPEDSCOUNT1);
    const g2 = num(r.IPEDSCOUNT2);
    const cip4 = toCip4(r.CIPCODE);
    if (!isPlausibleCip4(cip4)) continue; // shouldn't happen; CIPCODE is always 4 digits in this file
    out[cip4] = {
      title: r.CIPDESC.replace(/\.\s*$/, ""),
      graduates: g1 === null && g2 === null ? null : (g1 ?? 0) + (g2 ?? 0),
      earnings: {
        y1: num(r.EARN_MDN_1YR),
        y4: num(r.EARN_MDN_4YR),
        y4_national: num(r.EARN_MDN_4YR_NAT),
        y4_pell: num(r.EARN_PELL_WNE_MDN_4YR),
        y4_non_pell: num(r.EARN_NOPELL_WNE_MDN_4YR),
      },
      debt_median: num(r.DEBT_ALL_STGP_EVAL_MDN),
    };
  }
  return out;
}

/**
 * The source, added to meta.json after buildMeta(). `vintages["scorecard-fos"]` is left null, like
 * scorecard-latest: each column here is Scorecard's latest calculation for that one metric, and different metrics
 * pool different completion cohorts (see the spec's "As built" for the exact cohort years, read from Scorecard's
 * data dictionary), so there's no single release year to show.
 */
export function addFieldOfStudyMeta(meta: DatasetMeta, fos: FosData): void {
  meta.sources["scorecard-fos"] = {
    label: "College Scorecard Field of Study data",
    publisher: "U.S. Department of Education",
    edition: "Most recent release",
    url: fos.url,
    description:
      "Earnings and federal loan debt by detailed field of study (4-digit CIP) and credential level, bachelor's programs only, among each college's federal financial aid recipients. Each column is Scorecard's latest calculation for that one metric, and different columns pool different completion cohorts a few years apart, so a program's figures aren't all one snapshot (see the Field of Study spec for the exact years).",
  };
  meta.vintages["scorecard-fos"] = null;
}

/**
 * Adds a `programs` table to every school with Field of Study data, creating a new detail file for a school that
 * doesn't have one yet from residence. Returns each school's count of programs with earnings data, for
 * `academics.programs_with_earnings`.
 */
export function addProgramDetails(details: SchoolDetail[], schools: readonly School[], fos: FosData, meta: DatasetMeta): Map<string, number> {
  const byId = new Map(details.map((d) => [d.unit_id, d]));
  const counts = new Map<string, number>();
  const year = meta.vintages["scorecard-fos"] ?? null;
  for (const s of schools) {
    const rows = fos.rows.get(s.unit_id);
    if (!rows?.length) continue;
    const programs = programEarningsFrom(rows);
    if (!Object.keys(programs).length) continue;
    counts.set(s.unit_id, Object.values(programs).filter(hasEarnings).length);
    let d = byId.get(s.unit_id);
    if (!d) {
      d = { unit_id: s.unit_id, tables: {} };
      details.push(d);
      byId.set(s.unit_id, d);
    }
    d.tables.programs = { source: "scorecard-fos", vintage: "scorecard-fos", year, rows: programs };
  }
  return counts;
}
