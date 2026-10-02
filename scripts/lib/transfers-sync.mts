/**
 * sync-data's transfers-in step (specs/data-expansion/transfers.md). Kept out of scripts/sync-data.mts so that file
 * only calls in. lib/transfers.ts reads each row; this file fetches the newest EF{Y}A, checks that its level codes
 * still mean what they did, and adds the source to meta.json.
 */
import type { DatasetMeta } from "../../lib/types.ts";
import { fetchIpedsTable, type IpedsTable } from "./ipeds.mts";
import { EFA_COLUMNS, EFA_WIDE, checkTransferLevels } from "../../lib/transfers.ts";

/** The newest published EF{Y}A (fall Y), pivoted to one row per college. Fails if it lacks the columns read. */
export async function fetchTransfers(cacheDir: string, thisYear: number): Promise<{ table: IpedsTable; year: number }> {
  for (let y = thisYear; y >= thisYear - 5; y--) {
    const table = await fetchIpedsTable(`EF${y}A`, { cacheDir, maxAgeDays: 7, wide: EFA_WIDE });
    if (!table) continue;
    const missing = EFA_COLUMNS.filter((c) => !table.columns.has(c));
    if (missing.length) throw new Error(`EF${y}A has no ${missing.join(", ")} column`);
    console.log(`  IPEDS EF${y}A: ${table.rows.size} institutions (${table.csv}, pivoted by EFALEVEL)`);
    return { table, year: y };
  }
  throw new Error(`No EF{Y}A file is published for ${thisYear - 5}–${thisYear}`);
}

/**
 * Stops the sync if EF{Y}A's level codes no longer mean transfer-ins and first-time students: they must add up and agree
 * with NCES's derived DRVEF{Y}. DRVEF can lag EF{Y}A; then only the add-up check runs, with a warning.
 */
export async function checkTransfers(efa: IpedsTable, year: number, ids: readonly string[], cacheDir: string): Promise<number> {
  const drv = await fetchIpedsTable(`DRVEF${year}`, { cacheDir, maxAgeDays: 7 });
  const usable = drv && drv.columns.has("EFUGTRN") && drv.columns.has("EFUG1ST") ? drv : null;
  if (!usable) console.warn(`  DRVEF${year} isn't published (or lacks EFUGTRN/EFUG1ST): EF${year}A checked for consistency only`);
  const { checked, problems } = checkTransferLevels(efa.rows, usable?.rows ?? null, ids);
  if (problems.length) throw new Error(`EF${year}A transfer-in levels failed their checks:\n  ${problems.join("\n  ")}`);
  return checked;
}

export function addTransferMeta(meta: DatasetMeta, efa: IpedsTable, year: number): void {
  meta.sources["ipeds-ef-a"] = {
    label: "IPEDS Fall Enrollment survey (part A, enrollment by level)",
    publisher: "National Center for Education Statistics (NCES)",
    edition: `Fall ${year} (${efa.name})`,
    url: efa.url,
    description:
      "Each college's fall enrollment by level of student, including new transfer-in undergraduates (full-time and part-time) and first-time degree-seeking undergraduates.",
  };
  meta.vintages["ipeds-ef-a"] = `Fall ${year}`;
}
