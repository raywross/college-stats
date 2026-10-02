/**
 * IPEDS files with several rows per college (Outcome Measures: one per cohort), read as one row per college.
 * `fetchIpedsTable` keys rows by UNITID, so it keeps only the last of them; this downloads and caches the file the same
 * way, then re-reads the CSV and pivots: each column becomes `{COLUMN}_{code}`, e.g. `OMACHRT_50`.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fetchIpedsTable, parseCsv, type FetchOptions, type IpedsTable } from "./ipeds.mts";

/** Rows with the same UNITID merged into one, each column suffixed with the row's `pivot` code (parsed as a number). */
export function pivotRows(rows: readonly Record<string, string>[], pivot: string, keep?: ReadonlySet<string>): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const r of rows) {
    if (keep && !keep.has(r.UNITID)) continue;
    const code = Number(r[pivot]);
    if (!Number.isFinite(code)) continue;
    const merged = out.get(r.UNITID) ?? { UNITID: r.UNITID };
    for (const [k, v] of Object.entries(r)) if (k !== "UNITID" && k !== pivot) merged[`${k}_${code}`] = v;
    out.set(r.UNITID, merged);
  }
  return out;
}

/**
 * An IPEDS file pivoted on `pivot` (see above), or null when NCES hasn't published it. `columns` keeps the file's own
 * header names (e.g. OMACHRT), so header checks work unchanged.
 */
export async function fetchPivotedTable(name: string, pivot: string, opts: FetchOptions): Promise<IpedsTable | null> {
  // Download (or reuse the cache) without keeping any rows: they'd collapse by UNITID.
  const table = await fetchIpedsTable(name, { ...opts, keep: new Set() });
  if (!table) return null;
  const text = execFileSync("unzip", ["-p", join(opts.cacheDir, `${name}.zip`), table.csv], { encoding: "latin1", maxBuffer: 1024 * 1024 * 1024 });
  const parsed = parseCsv(text);
  if (parsed.length && !(pivot in parsed[0])) throw new Error(`${name} has no ${pivot} column to pivot on`);
  return { ...table, rows: pivotRows(parsed, pivot, opts.keep) };
}
