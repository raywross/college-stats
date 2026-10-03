/**
 * The one merge of `data/college-reported.json` into `school.reported` + `school.lineage`, shared by
 * `scripts/sync-data.mts` (which builds `schools` fresh every run, so stripping is a no-op there) and
 * `scripts/merge-reported.mts` (which re-merges into the committed `data/schools.json`, where a college dropped
 * from `college-reported.json` since the last merge must lose its block). Pure: no file I/O. See Decision 5 of
 * specs/college-reported-round-2.md.
 */
import type { School } from "./types";
import { REPORTED_PATHS } from "./fields.ts";
import type { ReportedFile } from "./reported.ts";
import { reportedToPatch } from "./reported-checks.ts";

/** `school`, with its `reported` block and every `reported.*` lineage record removed. */
export function stripReported(school: School): School {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarding `reported` is the point
  const { reported: _reported, ...rest } = school;
  const lineage = { ...(school.lineage ?? {}) };
  for (const path of REPORTED_PATHS) delete lineage[path];
  return { ...rest, lineage } as School;
}

export interface MergeReportedResult {
  schools: School[];
  /** Colleges that got (or kept) a `reported` block from this file. */
  merged: number;
  /** Colleges that had a `reported` block before this merge but no entry in the file now. */
  removed: number;
}

/**
 * Strips every school's existing `reported` block and `reported.*` lineage, then re-applies the current entries in
 * `reported.entries` (through `reportedToPatch`, exactly as `sync-data` does). Never touches a federal field.
 */
export function mergeReported(schools: School[], reported: ReportedFile): MergeReportedResult {
  const byUnitId = new Map(reported.entries.map((e) => [e.unit_id, e]));
  let merged = 0;
  let removed = 0;
  const result = schools.map((school) => {
    const hadReported = school.reported?.admissions != null;
    const stripped = stripReported(school);
    const entry = byUnitId.get(school.unit_id);
    if (!entry) {
      if (hadReported) removed++;
      return stripped;
    }
    merged++;
    const { reported: reportedData, lineage: entryLineage } = reportedToPatch(entry);
    return { ...stripped, reported: reportedData, lineage: { ...stripped.lineage, ...entryLineage } };
  });
  return { schools: result, merged, removed };
}
