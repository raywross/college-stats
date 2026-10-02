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

/**
 * Faculty (specs/data-expansion/faculty.md): IPEDS SAL{Y}_IS, all-ranks row (ARANK 7), and College Scorecard's
 * full-time share. Pure: sync-data, history, and tests share these, so history's last point always matches the snapshot.
 */

/**
 * `SAEQ9AT` from the ARANK 7 ("all ranks combined") row: average salary equated to a 9-month contract, nominal
 * dollars. SAL's rows are grouped by college with ARANK ascending (verified 2016–2024: the last row for every
 * reporting college is ARANK 7), so the generic "last row wins" fetch lands on it — but this still checks ARANK
 * itself, so a future layout change fails loudly instead of silently averaging the wrong rank.
 */
export function facultySalaryFrom(row: Row): number | null {
  if (!row || row.ARANK !== "7") return null;
  const raw = row.SAEQ9AT;
  if (raw === undefined || raw === "" || raw === ".") return null;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/**
 * `school.ft_faculty_rate` (College Scorecard, from IPEDS HR): share of faculty who are full-time, fall term.
 * Distinct from `school.faculty_salary` (`AVGFACSAL`), a monthly figure not equated like SAL's — never mix the two.
 */
export function fullTimeFacultyShareFrom(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

/** Explore's full-time-faculty chips: at least this share are full-time. */
export const MIN_FULL_TIME_FACULTY_OPTIONS = [0.5, 0.7, 0.9] as const;

/** Explore's full-time-faculty filter: a reported share at or above the floor. Unreported never matches. */
export function withinMinFullTimeFaculty(s: { academics?: { faculty?: { full_time_share: number | null } | null } }, min: number): boolean {
  const v = s.academics?.faculty?.full_time_share;
  return v != null && v >= min;
}
