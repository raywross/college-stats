/**
 * Downloading and reading NCES IPEDS bulk files, shared by `npm run sync-data` and `npm run sync-history`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * NCES moved newer releases (from the Dec 2025 provisional release on) to /ipeds/complete-data-files/; older files
 * remain at /ipeds/datacenter/data/. Check both, newest location first, and never trust the listing page.
 */
export const IPEDS_BASES = ["https://nces.ed.gov/ipeds/complete-data-files", "https://nces.ed.gov/ipeds/datacenter/data"];

/**
 * Minimal RFC-4180 CSV reader (IPEDS files quote some fields), calling `onRow` for each record instead of building
 * them all (a completions file has 300,000 rows). Headers are upper-cased (newer files are lower case). A leading
 * byte-order mark is dropped (HD2025 has one; left in, it hides the UNITID column). Returns the header. `keepIds` skips
 * other colleges' rows before building them (most of a file's rows aren't site colleges).
 */
export function forEachCsvRow(input: string, onRow: (row: Record<string, string>) => void, keepIds?: ReadonlySet<string>): string[] {
  const text = input.replace(/^(\uFEFF|ï»¿)/, "");
  let keys: string[] | null = null;
  let idAt = -1;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const emit = () => {
    if (!keys) {
      keys = row.map((h) => h.trim().toUpperCase());
      idAt = keys.indexOf("UNITID");
    } else if (row.length > 1 && !(keepIds && idAt >= 0 && !keepIds.has(row[idAt].trim()))) {
      // Object.fromEntries, not one property at a time: wide files (SFA, ~400 columns) would turn every row into a
      // dictionary-mode object, about three times the memory (history keeps ~200 such files' rows).
      const cells = row;
      onRow(Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? "").trim()])));
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      emit();
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    emit();
  }
  return keys ?? [];
}

/** Every record of a CSV (see forEachCsvRow). */
export function parseCsv(input: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  forEachCsvRow(input, (r) => rows.push(r));
  return rows;
}

/** One IPEDS file, read. */
export interface IpedsTable {
  /** e.g. "ADM2024" */
  name: string;
  url: string;
  /** The CSV used inside the zip. */
  csv: string;
  /** NCES's revised release (`…_rv.csv`) was used. */
  revised: boolean;
  /** Upper-case column names, from the header row (so a column is "present" even when every value is blank). */
  columns: Set<string>;
  rows: Map<string, Record<string, string>>;
}

export interface FetchOptions {
  /** Directory for downloaded zips (reused between runs). */
  cacheDir: string;
  /** Re-download cached zips older than this many days (to pick up NCES revisions). Infinity = never. */
  maxAgeDays?: number;
  /** Only keep these unit IDs (saves memory on the big IC files). */
  keep?: ReadonlySet<string>;
  /** Never touch the network: cached files only, and anything not cached counts as unpublished. */
  offline?: boolean;
  /** Files with several rows per college (GR{Y}_PELL_SSL: one per cohort type) keep only the rows this accepts. */
  keepRow?: (row: Record<string, string>) => boolean;
  /**
   * Files with several rows per college (EF{Y}C: one per home state): pivot them into one row per college, each
   * `values` column becoming `{column}_{row's key value}` (e.g. EFRES01_47). `columns` keeps the file's own header.
   */
  wide?: { key: string; values: readonly string[] };
  /**
   * Files with many rows per college (C{Y}_A completions: one per program, award level, and major): sum them into one
   * row per college, each kept row adding its `value` column into the column `key(row)` names (null skips the row).
   * Sums are stored as strings like every other value; blank, non-numeric, and negative (IPEDS missing) values add
   * nothing.
   */
  sum?: { key: (row: Record<string, string>) => string | null; value: string };
}

/** fetch with retries on network errors and 5xx (NCES drops connections under load). */
async function fetchRetry(url: string, attempts = 4): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500 || i >= attempts) return res;
    } catch (err) {
      if (i >= attempts) throw new Error(`${url}: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
}

/**
 * Download a zip from either NCES location into the cache. Returns its URL, or null when NCES doesn't have it.
 * Throws when NCES can't be reached, since "unreachable" must never be mistaken for "not published".
 */
async function download(name: string, zip: string): Promise<string | null> {
  for (const base of IPEDS_BASES) {
    const url = `${base}/${name}.zip`;
    const res = await fetchRetry(url);
    if (!res.ok) continue;
    const tmp = `${zip}.part`;
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    renameSync(tmp, zip);
    return url;
  }
  return null;
}

/** Where a cached zip came from (written beside it, since the two NCES locations differ by year). */
const urlFile = (zip: string) => `${zip}.url`;

/**
 * Any NCES zip by name (e.g. "IC2025_Dict", a data dictionary), cached like the data files: the local path and its
 * URL, or null when NCES hasn't published it. A stale copy is used when NCES can't be reached.
 */
export async function fetchIpedsZip(name: string, cacheDir: string, maxAgeDays = 7): Promise<{ zip: string; url: string } | null> {
  mkdirSync(cacheDir, { recursive: true });
  const zip = join(cacheDir, `${name}.zip`);
  const cached = existsSync(zip) && existsSync(urlFile(zip));
  if (cached && Date.now() - statSync(zip).mtimeMs < maxAgeDays * 86_400_000) return { zip, url: readFileSync(urlFile(zip), "utf8").trim() };
  let url: string | null;
  try {
    url = await download(name, zip);
  } catch (err) {
    if (!cached) throw err;
    console.warn(`\n  ${name}: NCES unreachable, using the cached copy (${err instanceof Error ? err.message : err})`);
    return { zip, url: readFileSync(urlFile(zip), "utf8").trim() };
  }
  if (!url) return null;
  writeFileSync(urlFile(zip), url);
  return { zip, url };
}

/**
 * An IPEDS file by name (e.g. "IC2013_AY"), from the cache when fresh enough. Null when NCES hasn't published it.
 * Prefers the revised CSV (`_rv`) when the zip has one.
 */
export async function fetchIpedsTable(name: string, opts: FetchOptions): Promise<IpedsTable | null> {
  mkdirSync(opts.cacheDir, { recursive: true });
  const zip = join(opts.cacheDir, `${name}.zip`);
  const maxAge = (opts.maxAgeDays ?? Infinity) * 86_400_000;
  const cached = existsSync(zip) && existsSync(urlFile(zip));
  let url: string | null = null;
  if (cached && (opts.offline || Date.now() - statSync(zip).mtimeMs < maxAge)) {
    url = readFileSync(urlFile(zip), "utf8").trim();
  } else if (opts.offline) {
    return null;
  } else {
    try {
      url = await download(name, zip);
    } catch (err) {
      // A stale copy beats no copy when NCES is down; a file never downloaded can't be judged, so that fails.
      if (!cached) throw err;
      console.warn(`\n  ${name}: NCES unreachable, using the cached copy (${err instanceof Error ? err.message : err})`);
      url = readFileSync(urlFile(zip), "utf8").trim();
    }
    if (!url) return null;
    writeFileSync(urlFile(zip), url);
  }
  const files = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter((f) => /\.csv$/i.test(f));
  const rv = files.find((f) => /_rv\.csv$/i.test(f));
  const csv = rv ?? files[0];
  if (!csv) throw new Error(`${name}.zip has no CSV (${files.join(", ")})`);
  // Older files are latin-1; decoding everything as latin-1 is safe because only names use non-ASCII.
  const text = execFileSync("unzip", ["-p", zip, csv], { encoding: "latin1", maxBuffer: 1024 * 1024 * 1024 });
  const rows = new Map<string, Record<string, string>>();
  const header = forEachCsvRow(text, (r) => {
    if (opts.keep && !opts.keep.has(r.UNITID)) return;
    if (opts.keepRow && !opts.keepRow(r)) return;
    if (opts.sum) {
      const key = opts.sum.key(r);
      const n = Number(r[opts.sum.value]);
      // IPEDS codes missing values as -1, -2, -3: never added in as numbers.
      if (key === null || r[opts.sum.value] === "" || !Number.isFinite(n) || n < 0) return;
      const row = rows.get(r.UNITID) ?? rows.set(r.UNITID, { UNITID: r.UNITID }).get(r.UNITID)!;
      row[key] = String((Number(row[key]) || 0) + n);
      return;
    }
    if (!opts.wide) {
      rows.set(r.UNITID, r);
      return;
    }
    const row = rows.get(r.UNITID) ?? rows.set(r.UNITID, { UNITID: r.UNITID }).get(r.UNITID)!;
    const k = String(Number(r[opts.wide.key]));
    for (const v of opts.wide.values) row[`${v}_${k}`] = r[v] ?? "";
  }, opts.keep);
  const columns = new Set(header);
  return { name, url, csv, revised: !!rv, columns, rows };
}
