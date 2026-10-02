/**
 * Transfers in (specs/data-expansion/transfers.md): how an IPEDS `EF{Y}A` row becomes `demographics.transfer_in`. Pure:
 * sync-data, history, and tests share it, so history's last point always matches the snapshot.
 *
 * EF{Y}A has one row per college per enrollment level (`EFALEVEL`), with the total in `EFTOTLT`. scripts/lib/ipeds.mts
 * pivots them (`wide`) into one row per college with columns like `EFTOTLT_19`. NCES omits zero rows, so a missing level
 * in a college's row is 0 (probed 2026-10-02: DRVEF2024 shows 0 for all 49 site colleges without a transfer-in row).
 */
import type { School, TransferIn } from "./types";

type Row = Record<string, string> | undefined;

/** The levels read, from the EF2024A and EF2008A data dictionaries (undergraduate, degree/certificate-seeking). */
export const EFA_LEVELS = {
  /** First-time (all students). */
  first_time: 4,
  /** Transfer-ins: all students, full-time, part-time. */
  transfer: 19,
  transfer_full_time: 39,
  transfer_part_time: 59,
} as const;

/** EF{Y}A pivoted to one row per college (scripts/lib/ipeds.mts `wide`). */
export const EFA_WIDE = { key: "EFALEVEL", values: ["EFTOTLT"] } as const;
export const EFA_COLUMNS = ["EFALEVEL", "EFTOTLT"] as const;

/** Transfer-in levels exist from EF2008A (EF2006A has none). */
export const EFA_FIRST_YEAR = 2008;

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** A level's total; a missing level is 0 (NCES omits zero rows); a blank or unreadable one is null. */
function level(row: Record<string, string>, code: number): number | null {
  const v = row[`EFTOTLT_${code}`];
  if (v === undefined) return 0;
  if (v === "" || v === ".") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A college's new transfer-in undergraduates this fall; null when it isn't in the file or a count is unreadable. */
export function transferInFrom(row: Row): TransferIn | null {
  if (!row) return null;
  const count = level(row, EFA_LEVELS.transfer);
  const fullTime = level(row, EFA_LEVELS.transfer_full_time);
  const partTime = level(row, EFA_LEVELS.transfer_part_time);
  const firstTime = level(row, EFA_LEVELS.first_time);
  if (count === null || fullTime === null || partTime === null || firstTime === null) return null;
  const newStudents = count + firstTime;
  return { count, full_time: fullTime, part_time: partTime, share_of_new: newStudents > 0 ? round4(count / newStudents) : null };
}

/**
 * The level codes still mean what the dictionary says: transfer-ins add up (19 = 39 + 59) and match NCES's own derived
 * totals (DRVEF{Y} EFUGTRN = level 19, EFUG1ST = level 4). sync-data stops when more than 1% of colleges disagree, so a
 * renumbered or redefined level can't silently change what the site shows.
 */
export function checkTransferLevels(
  efa: ReadonlyMap<string, Record<string, string>>,
  drvef: ReadonlyMap<string, Record<string, string>> | null,
  ids: Iterable<string>,
): { checked: number; problems: string[] } {
  const problems: string[] = [];
  let checked = 0;
  let sumOff = 0;
  let derivedChecked = 0;
  let derivedOff = 0;
  for (const id of ids) {
    const row = efa.get(id);
    if (!row) continue;
    const t = transferInFrom(row);
    if (!t) continue;
    checked++;
    if (t.count !== t.full_time + t.part_time) sumOff++;
    const d = drvef?.get(id);
    if (d && d.EFUGTRN !== undefined && d.EFUGTRN !== "" && d.EFUG1ST !== undefined && d.EFUG1ST !== "") {
      derivedChecked++;
      const first = level(row, EFA_LEVELS.first_time);
      if (Number(d.EFUGTRN) !== t.count || Number(d.EFUG1ST) !== first) derivedOff++;
    }
  }
  if (checked === 0) problems.push("no college has transfer-in data");
  if (sumOff > checked * 0.01) problems.push(`${sumOff} of ${checked} colleges' transfer-ins don't add up (level 19 ≠ 39 + 59)`);
  if (drvef && derivedOff > derivedChecked * 0.01) problems.push(`${derivedOff} of ${derivedChecked} colleges' levels 19/4 don't match DRVEF EFUGTRN/EFUG1ST`);
  return { checked, problems };
}

/** Share of new undergraduates who transferred in (Explore's sort). */
export function transferShare(s: Pick<School, "demographics">): number | null {
  return s.demographics.transfer_in?.share_of_new ?? null;
}
