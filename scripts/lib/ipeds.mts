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
 * Minimal RFC-4180 CSV parser (IPEDS files quote some fields). Headers are upper-cased (newer files are lower case).
 * A leading byte-order mark is dropped (HD2025 has one; left in, it hides the UNITID column).
 */
export function parseCsv(input: string): Record<string, string>[] {
  const text = input.replace(/^(﻿|ï»¿)/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
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
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows;
  const keys = header.map((h) => h.trim().toUpperCase());
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
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
  /**
   * Files with several rows per college (EF{Y}C: one per home state): pivot them into one row per college, each
   * `values` column becoming `{column}_{row's key value}` (e.g. EFRES01_47). `columns` keeps the file's own header.
   */
  wide?: { key: string; values: readonly string[] };
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
  const parsed = parseCsv(text);
  const columns = new Set(Object.keys(parsed[0] ?? {}));
  const rows = new Map<string, Record<string, string>>();
  for (const r of parsed) {
    if (opts.keep && !opts.keep.has(r.UNITID)) continue;
    if (!opts.wide) {
      rows.set(r.UNITID, r);
      continue;
    }
    const row = rows.get(r.UNITID) ?? rows.set(r.UNITID, { UNITID: r.UNITID }).get(r.UNITID)!;
    const k = String(Number(r[opts.wide.key]));
    for (const v of opts.wide.values) row[`${v}_${k}`] = r[v] ?? "";
  }
  return { name, url, csv, revised: !!rv, columns, rows };
}
