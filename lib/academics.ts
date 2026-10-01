/**
 * Academics (specs/data-expansion/student-faculty-ratio.md): how the IPEDS Fall Enrollment part D row becomes the stored
 * ratio. Pure: sync-data, history, and tests share it, so history's last point always matches the snapshot.
 */
type Row = Record<string, string> | undefined;

/** `STUFACR`: whole students per faculty member ("8" = 8 to 1); 0 or less, blank, or "." is unreported. */
export function studentFacultyRatioFrom(row: Row): number | null {
  const raw = row?.STUFACR;
  if (raw === undefined || raw === "" || raw === ".") return null;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** "8 to 1". */
export const ratioLabel = (v: number): string => `${Math.round(v)} to 1`;

/** Explore's max-ratio chips: at most this many students per faculty member. */
export const MAX_RATIO_OPTIONS = [8, 10, 12, 15] as const;

/** Explore's max-ratio filter: a reported ratio at or under the cap. An unreported ratio never matches (it isn't a small one). */
export function withinMaxRatio(s: { academics?: { student_faculty_ratio: number | null } }, max: number): boolean {
  const v = s.academics?.student_faculty_ratio;
  return v != null && v <= max;
}
