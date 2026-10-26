/**
 * Whether a college admits everyone who applies (IPEDS Institutional Characteristics, OPENADMP), stored as
 * `admissions.open_admission` (specs/product/admin-health-views.md "Open admission"). It tells a college that publishes
 * no admit rate because it has none (open admission) from one whose rate is missing: the data-health view marks the
 * second Failing.
 *
 * NCES releases IC{Y} in July with OPENADMP left blank until its revision, so the newest file with answers is used
 * (in October 2026, IC2024 rather than IC2025). It is its own release in data/meta.json (`ipeds-ic-open`), so the
 * citation names that file and its year.
 *
 * Pure (type-only imports), shared by `npm run sync-data` and `npm run backfill-open-admission`.
 */
import type { School, SourceInfo } from "./types.ts";

export const OPEN_ADMISSION_COLUMN = "OPENADMP";

/** OPENADMP: 1 = open admission, 2 = not; anything else (-1 not reported, -2 not applicable, blank) is unknown. */
export function openAdmissionFrom(row: Record<string, string> | undefined): boolean | null {
  const v = row?.[OPEN_ADMISSION_COLUMN]?.trim();
  return v === "1" ? true : v === "2" ? false : null;
}

/** Whether a file's rows answer OPENADMP at all (a just-released IC file leaves it blank). */
export function hasOpenAdmissionAnswers(rows: Iterable<Record<string, string>>): boolean {
  for (const r of rows) if (openAdmissionFrom(r) !== null) return true;
  return false;
}

/** "IC2024" → "2024–25", the academic year an IC file describes. */
export function icFileYear(name: string): string {
  const y = Number(name.slice(2, 6));
  return `${y}–${String(y + 1).slice(2)}`;
}

/** The file's entry in data/meta.json: its source (`sources["ipeds-ic-open"]`) and its year (`vintages`). */
export function openAdmissionMeta(file: { name: string; url: string }): { source: SourceInfo; vintage: string } {
  return {
    source: {
      label: "IPEDS Institutional Characteristics survey (open admission)",
      publisher: "National Center for Education Statistics (NCES)",
      edition: `${icFileYear(file.name)} (${file.name})`,
      url: file.url,
      description:
        "Whether the college admits everyone who applies (an open-admission policy). From the newest Institutional Characteristics file that answers it: NCES leaves the answer blank in a new file until it revises it.",
    },
    vintage: icFileYear(file.name),
  };
}

/**
 * Sets `admissions.open_admission` on each school from one IC file's rows (null when the file doesn't answer for the
 * college). Returns how many were set to true, false, and null.
 */
export function applyOpenAdmission(schools: School[], rows: ReadonlyMap<string, Record<string, string>>): { open: number; notOpen: number; unknown: number } {
  const counts = { open: 0, notOpen: 0, unknown: 0 };
  for (const s of schools) {
    const v = openAdmissionFrom(rows.get(s.unit_id));
    s.admissions.open_admission = v;
    if (v === true) counts.open++;
    else if (v === false) counts.notOpen++;
    else counts.unknown++;
  }
  return counts;
}
