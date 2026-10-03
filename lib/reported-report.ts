/**
 * Pure helpers behind `npm run report-college-reported` (scripts/report-college-reported.mts): a plain-language
 * snapshot of data/college-reported.json, for both the repo owner and anyone else checking the pipeline's state.
 * See specs/college-reported-setup.md.
 */
import type { ReportedAdmissions, School } from "./types";
import type { ReportedEntry, ReportedFile } from "./reported.ts";

export interface ReportedCollegeRow {
  unit_id: string;
  name: string;
  term: string;
  kind: ReportedAdmissions["source_kind"];
  /** Which of applicants/admitted/enrolled/rate the entry has a value for, in that order. */
  present: string[];
  /** Any URL cited in the entry's lineage. */
  url: string;
  run: string;
}

/** Any URL cited in an entry's lineage records. */
function entryUrl(entry: ReportedEntry): string {
  const rec = Object.values(entry.lineage).find((r) => r?.url);
  return rec?.url ?? "";
}

const PRESENCE_FIELDS: { key: keyof ReportedAdmissions; label: string }[] = [
  { key: "applicants", label: "applicants" },
  { key: "admitted", label: "admitted" },
  { key: "enrolled", label: "enrolled" },
  { key: "acceptance_rate", label: "rate" },
];

/** One readable row per published entry, newest first within a college is not needed — entries are one per college. */
export function collegeRows(reported: ReportedFile, names: Map<string, string>): ReportedCollegeRow[] {
  return reported.entries.map((entry) => ({
    unit_id: entry.unit_id,
    name: names.get(entry.unit_id) ?? entry.unit_id,
    term: entry.admissions.entering_term,
    kind: entry.admissions.source_kind,
    present: PRESENCE_FIELDS.filter(({ key }) => entry.admissions[key] != null).map(({ label }) => label),
    url: entryUrl(entry),
    run: entry.run,
  }));
}

/** Counts by entering term and by source kind, across every published entry. */
export function totals(rows: ReportedCollegeRow[]): { byTerm: Record<string, number>; byKind: Record<string, number> } {
  const byTerm: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const row of rows) {
    byTerm[row.term] = (byTerm[row.term] ?? 0) + 1;
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  }
  return { byTerm, byKind };
}

/** How many colleges in `schools.json` currently carry a `reported` block — whether the merge has happened. */
export function mergedCount(schools: School[]): number {
  return schools.filter((s) => s.reported?.admissions != null).length;
}
