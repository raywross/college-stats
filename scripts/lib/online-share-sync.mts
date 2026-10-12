/**
 * sync-data's online-share step (specs/data-expansion/online-share.md). Kept out of scripts/sync-data.mts so that file
 * only calls in. lib/online-share.ts reads each row; this file fetches the newest EF{Y}A_DIST, checks that every row
 * adds up and that the undergraduate counts agree with the snapshot's enrollment, and adds the source to meta.json.
 */
import type { DatasetMeta, School } from "../../lib/types.ts";
import { fetchIpedsTable, type IpedsTable } from "./ipeds.mts";
import { EFA_DIST_COLUMNS, EFA_DIST_WIDE, checkOnlineRows, onlineSharesFrom } from "../../lib/online-share.ts";

/** Level-3 (degree-seeking) undergraduates more than this far from `demographics.undergrad_enrollment` are flagged. */
export const ENROLLMENT_TOLERANCE = 0.1;

/** The newest published EF{Y}A_DIST (fall Y), pivoted to one row per college. Fails if it lacks the columns read. */
export async function fetchOnlineShare(cacheDir: string, thisYear: number): Promise<{ table: IpedsTable; year: number }> {
  for (let y = thisYear; y >= thisYear - 5; y--) {
    const table = await fetchIpedsTable(`EF${y}A_DIST`, { cacheDir, maxAgeDays: 7, wide: EFA_DIST_WIDE });
    if (!table) continue;
    const missing = EFA_DIST_COLUMNS.filter((c) => !table.columns.has(c));
    if (missing.length) throw new Error(`EF${y}A_DIST has no ${missing.join(", ")} column`);
    console.log(`  IPEDS EF${y}A_DIST: ${table.rows.size} institutions (${table.csv}, pivoted by EFDELEV)`);
    return { table, year: y };
  }
  throw new Error(`No EF{Y}A_DIST file is published for ${thisYear - 5}–${thisYear}`);
}

export interface OnlineShareCheck {
  /** Level rows checked for the add-up rule, and the colleges they belong to. */
  checked: number;
  colleges: number;
  /** Rows that don't add up (under 1% of `checked`, or the sync stops). */
  problems: string[];
  /** Colleges whose degree-seeking undergraduates (level 3) are more than 10% from the snapshot's enrollment. */
  flagged: string[];
  /** Colleges compared in the 10% check. */
  compared: number;
}

/**
 * Stops the sync when more than 1% of the file's rows for these colleges don't add up (every course + some + none ≠
 * total: a changed file, not a college's typo). The 10% enrollment comparison only flags: the two counts are the same
 * survey and fall but different snapshots of it (IPEDS revisions, Scorecard's own edits).
 */
export function checkOnlineShare(efaDist: IpedsTable, year: number, schools: readonly School[]): OnlineShareCheck {
  const { checked, colleges, problems } = checkOnlineRows(efaDist.rows, schools.map((s) => s.unit_id));
  if (checked === 0) throw new Error(`EF${year}A_DIST has no rows for any site college`);
  if (problems.length > checked * 0.01) throw new Error(`EF${year}A_DIST rows don't add up (every course + some + none ≠ total) for ${problems.length} of ${checked}:\n  ${problems.slice(0, 10).join("\n  ")}`);
  const flagged: string[] = [];
  let compared = 0;
  for (const s of schools) {
    const degree = onlineSharesFrom(efaDist.rows.get(s.unit_id))?.degree_seeking ?? null;
    // The federal count when a newer CDS fall replaced the shown one (demographics.federal): the same survey's fall.
    const size = s.demographics.federal?.undergrad_enrollment ?? s.demographics.undergrad_enrollment;
    if (degree === null || !size) continue;
    compared++;
    if (Math.abs(degree - size) > size * ENROLLMENT_TOLERANCE) flagged.push(`${s.name} (${s.unit_id}): EF${year}A_DIST level 3 ${degree}, undergrad_enrollment ${size}`);
  }
  return { checked, colleges, problems, flagged, compared };
}

/** The distance-education source and its fall, added to meta.json after buildMeta(). */
export function addOnlineShareMeta(meta: DatasetMeta, efaDist: IpedsTable, year: number): void {
  meta.sources["ipeds-ef-a-dist"] = {
    label: "IPEDS Fall Enrollment survey (distance education)",
    publisher: "National Center for Education Statistics (NCES)",
    edition: `Fall ${year} (${efaDist.name})`,
    url: efaDist.url,
    description:
      "Each college's fall enrollment by level of student, split into students taking every course by distance education, some courses, and none. The site uses all undergraduates.",
  };
  meta.vintages["ipeds-ef-a-dist"] = `Fall ${year}`;
}
