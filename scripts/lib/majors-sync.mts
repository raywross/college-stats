/**
 * sync-data's majors step (specs/data-expansion/majors.md): the newest IPEDS Completions file (C{Y}_A), read into the
 * snapshot fields and the per-college detail table `majors` (lib/majors.ts, lib/detail.ts). Kept out of
 * scripts/sync-data.mts so that file only calls in.
 */
import type { DatasetMeta, School } from "../../lib/types.ts";
import { fetchIpedsTable, type IpedsTable } from "./ipeds.mts";
import { CIP_TOTAL, cipTitle, isCipField, normalizeCip } from "../../lib/cip.ts";
import { AWLEVEL_BACHELORS, C_COLUMNS, familyColumn, majorColumn, majorRowsFrom, majorsSnapshot, programsFrom, totalRowFrom } from "../../lib/majors.ts";
import type { SchoolDetail } from "../../lib/detail.ts";

/**
 * The sum key for one C{Y}_A row (scripts/lib/ipeds.mts `sum`): bachelor's rows only, `{cip}|{major}` per program and
 * major, `99|1` for the institution's first-major total. `fromCode` maps an older edition's code to CIP 2020
 * (lib/cip.ts fromCip2010) for files before C2020_A. Unknown codes are kept (and fail the title check), never dropped.
 */
export function completionsKey(row: Record<string, string>, fromCode: (code: string) => string | null = normalizeCip): string | null {
  if (Number(row.AWLEVEL) !== AWLEVEL_BACHELORS) return null;
  const major = Number(row.MAJORNUM);
  if (major !== 1 && major !== 2) return null;
  const raw = normalizeCip(row.CIPCODE);
  if (raw === CIP_TOTAL) return major === 1 ? majorColumn(CIP_TOTAL, 1) : null;
  const cip = fromCode(row.CIPCODE);
  return cip ? majorColumn(cip, major) : null;
}

/**
 * History's sum key (lib/majors.ts familyColumn): first-major bachelor's by 2-digit family, codes read through
 * `fromCode` (fromCip2010 for files before C2020_A). The total row and second majors are skipped.
 */
export function familyKey(row: Record<string, string>, fromCode: (code: string) => string | null = normalizeCip): string | null {
  const k = completionsKey(row, fromCode);
  if (!k || !k.endsWith("|1") || k.startsWith(`${CIP_TOTAL}|`)) return null;
  return familyColumn(k.slice(0, 2));
}

/** The newest published C{Y}_A, summed to one row per college. Fails if the file lacks a column the reader needs. */
export async function fetchCompletions(cacheDir: string, thisYear: number, keep?: ReadonlySet<string>): Promise<{ table: IpedsTable; year: number }> {
  for (let y = thisYear; y >= thisYear - 4; y--) {
    const table = await fetchIpedsTable(`C${y}_A`, { cacheDir, maxAgeDays: 7, keep, sum: { key: (r) => completionsKey(r), value: "CTOTALT" } });
    if (!table) continue;
    const missing = C_COLUMNS.filter((c) => !table.columns.has(c));
    if (missing.length) throw new Error(`C${y}_A has no ${missing.join(", ")} column`);
    console.log(`  IPEDS C${y}_A: ${table.rows.size} institutions (${table.csv}, bachelor's summed by program)`);
    return { table, year: y };
  }
  throw new Error(`No C{Y}_A completions file is published for ${thisYear - 4}–${thisYear}`);
}

/** "C2025_A" covers awards from July 2024 to June 2025: "2024–25 graduates". */
export const completionsYearLabel = (year: number) => `${year - 1}–${String(year).slice(2)} graduates`;

/** The snapshot fields for one college (null fields when it isn't in the file). Throws on a code without a title. */
export function majorsFor(table: IpedsTable, unitId: string) {
  return majorsSnapshot(programsFrom(table.rows.get(unitId)), cipTitle);
}

/**
 * Programs vs. IPEDS's own total row (CIPCODE 99): the first-major bachelor's by program must add up to it (exact for
 * every site college in C2014_A–C2025_A, probed 2026-10-02). Returns the colleges compared and those that differ.
 */
export function checkTotals(schools: readonly School[], table: IpedsTable): { checked: number; differ: string[] } {
  let checked = 0;
  const differ: string[] = [];
  for (const s of schools) {
    const row = table.rows.get(s.unit_id);
    const total = totalRowFrom(row);
    const ours = s.academics?.bachelors_awarded ?? null;
    if (total === null || ours === null) continue;
    checked++;
    if (Math.abs(ours - total) > Math.max(1, total * 0.01)) differ.push(`${s.name} (${s.unit_id}): ${ours} by program, ${total} in the total row`);
  }
  return { checked, differ };
}

/** Codes in the file that aren't CIP 2020 fields (a new CIP edition, or a typo NCES let through). */
export function unknownCodes(table: IpedsTable): string[] {
  const out = new Set<string>();
  for (const row of table.rows.values()) for (const k of Object.keys(row)) {
    const cip = k.split("|")[0];
    if (k.includes("|") && cip !== CIP_TOTAL && !isCipField(cip)) out.add(cip);
  }
  return [...out].sort();
}

/** The completions source and release year, added to meta.json after buildMeta(). */
export function addMajorsMeta(meta: DatasetMeta, table: IpedsTable, year: number): void {
  meta.sources["ipeds-c"] = {
    label: "IPEDS Completions survey (degrees awarded by field)",
    publisher: "National Center for Education Statistics (NCES)",
    edition: `${completionsYearLabel(year)} (${table.name})`,
    url: table.url,
    description:
      "Every degree and certificate each college awarded from July through June, by field of study (Classification of Instructional Programs, CIP 2020) and award level. The site counts bachelor's degrees, first and second majors separately.",
  };
  meta.vintages["ipeds-c"] = completionsYearLabel(year);
}

/** Each college's majors table (only colleges with bachelor's degrees in the file). */
export function buildMajorDetails(schools: readonly School[], table: IpedsTable, meta: DatasetMeta): SchoolDetail[] {
  const year = meta.vintages["ipeds-c"];
  if (!year) throw new Error("meta.json has no ipeds-c year");
  const out: SchoolDetail[] = [];
  for (const s of schools) {
    if (!s.academics?.majors_top) continue;
    const programs = programsFrom(table.rows.get(s.unit_id));
    if (!programs?.length) continue;
    out.push({ unit_id: s.unit_id, tables: { majors: { source: "ipeds-c", vintage: "ipeds-c", year, rows: majorRowsFrom(programs) } } });
  }
  return out;
}
