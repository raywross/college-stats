/**
 * sync-data's residence step (specs/data-expansion/residence.md) and the per-college detail files it writes
 * (lib/detail.ts). Kept out of scripts/sync-data.mts so that file only calls in.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../../lib/types.ts";
import { fetchIpedsTable, type IpedsTable } from "./ipeds.mts";
import { homeStatesFrom, residenceCounts } from "../../lib/residence.ts";
import { detailMismatches, formatDetail, validateDetail, type SchoolDetail } from "../../lib/detail.ts";

/** EF{Y}C, pivoted to one row per college (lib/residence.ts reads it). */
export const EFC_WIDE = { key: "EFCSTATE", values: ["EFRES01"] } as const;

/**
 * The newest even-numbered fall's EF{Y}C (residence is required in even years only; odd years cover about half the
 * colleges, so they're never used, even when newer). Fails if the file lacks the columns lib/residence.ts reads.
 */
export async function fetchResidence(cacheDir: string, thisYear: number): Promise<{ table: IpedsTable; year: number }> {
  const even = thisYear % 2 === 0 ? thisYear : thisYear - 1;
  for (let y = even; y >= even - 6; y -= 2) {
    const table = await fetchIpedsTable(`EF${y}C`, { cacheDir, maxAgeDays: 7, wide: EFC_WIDE });
    if (!table) continue;
    const missing = ["EFCSTATE", "EFRES01"].filter((c) => !table.columns.has(c));
    if (missing.length) throw new Error(`EF${y}C has no ${missing.join(", ")} column`);
    console.log(`  IPEDS EF${y}C: ${table.rows.size} institutions (${table.csv})`);
    return { table, year: y };
  }
  throw new Error(`No even-year EF{Y}C file is published for ${even - 6}–${even}`);
}

/**
 * Cross-check against NCES's own derived counts (DRVEF{Y} `RMINSTTN`, `RMOUSTTN`, `RMFRGNCN`): the per-state rows must
 * add up to them. Returns the colleges compared and those that differ.
 */
export async function crossCheckDerived(schools: readonly School[], efc: IpedsTable, year: number, cacheDir: string): Promise<{ checked: number; differ: string[] }> {
  const drv = await fetchIpedsTable(`DRVEF${year}`, { cacheDir, maxAgeDays: 7 });
  if (!drv) throw new Error(`DRVEF${year} isn't published, so EF${year}C can't be checked`);
  const missing = ["RMINSTTN", "RMOUSTTN", "RMFRGNCN"].filter((c) => !drv.columns.has(c));
  if (missing.length) throw new Error(`DRVEF${year} has no ${missing.join(", ")} column`);
  let checked = 0;
  const differ: string[] = [];
  for (const s of schools) {
    const c = residenceCounts(efc.rows.get(s.unit_id), s.location.state);
    const d = drv.rows.get(s.unit_id);
    if (!c || !d || d.RMINSTTN === "" || d.RMOUSTTN === "" || d.RMFRGNCN === "") continue;
    checked++;
    const theirs = [d.RMINSTTN, d.RMOUSTTN, d.RMFRGNCN].map(Number);
    const ours = [c.in_state, c.out_of_state, c.international];
    if (ours.some((v, i) => v !== theirs[i])) differ.push(`${s.name} (${s.unit_id}): ours ${ours.join("/")}, DRVEF ${theirs.join("/")}`);
  }
  return { checked, differ };
}

/** The residence source and release year, added to meta.json after buildMeta(). */
export function addResidenceMeta(meta: DatasetMeta, efc: IpedsTable, year: number): void {
  meta.sources["ipeds-ef-c"] = {
    label: "IPEDS Fall Enrollment survey (part C, residence of first-time students)",
    publisher: "National Center for Education Statistics (NCES)",
    edition: `Fall ${year} (${efc.name})`,
    url: efc.url,
    description:
      "Where each college's first-time undergraduates lived when they were admitted: each U.S. state, DC, and territory, and foreign countries. Colleges must report it in even-numbered falls; in odd years it's optional, so the site uses even years.",
  };
  meta.vintages["ipeds-ef-c"] = `Fall ${year}`;
}

/** Every college's detail file: tables only where there's data (no file for a college without any). */
export function buildDetails(schools: readonly School[], efc: IpedsTable, meta: DatasetMeta): SchoolDetail[] {
  const year = meta.vintages["ipeds-ef-c"];
  if (!year) throw new Error("meta.json has no ipeds-ef-c year");
  const out: SchoolDetail[] = [];
  for (const s of schools) {
    if (!s.demographics.residence) continue;
    const rows = homeStatesFrom(efc.rows.get(s.unit_id));
    if (!Object.keys(rows).length) continue;
    out.push({ unit_id: s.unit_id, tables: { home_states: { source: "ipeds-ef-c", vintage: "ipeds-ef-c", year, rows } } });
  }
  return out;
}

/** Problems with the built files; sync-data writes nothing if there are any. */
export function detailProblems(schools: readonly School[], details: readonly SchoolDetail[], meta: DatasetMeta): string[] {
  const ids = new Set(schools.map((s) => s.unit_id));
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  return details.flatMap((d) => [...validateDetail(d, meta, ids), ...detailMismatches(byId.get(d.unit_id)!, d)]);
}

/** Replace data/detail/schools/ with these files (colleges without a file lose any old one). */
export function writeDetails(dir: string, details: readonly SchoolDetail[]): void {
  mkdirSync(dir, { recursive: true });
  const keep = new Set(details.map((d) => `${d.unit_id}.json`));
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".json") && !keep.has(f)) rmSync(join(dir, f));
  for (const d of details) writeFileSync(join(dir, `${d.unit_id}.json`), formatDetail(d));
}
