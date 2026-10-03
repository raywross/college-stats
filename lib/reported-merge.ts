/**
 * The one merge of `data/college-reported.json` into the dataset, shared by `scripts/sync-data.mts` (which builds
 * `schools` fresh every run, so stripping is a no-op there) and `scripts/merge-reported.mts` (which re-merges into
 * the committed `data/schools.json`, where a college dropped from `college-reported.json` since the last merge must
 * lose its block and get its previous funnel back). Each merged college's `reported` block then replaces its older
 * admissions figures in `admissions.*` (`lib/newest.ts#applyNewest`). Pure: no file I/O. See Decisions 1 and 5 of
 * specs/college-reported-round-2.md.
 */
import type { School } from "./types";
import { REPORTED_PATHS } from "./fields.ts";
import { applyNewest, restoreFederal } from "./newest.ts";
import type { ReportedFile } from "./reported.ts";
import { reportedToPatch } from "./reported-checks.ts";
import { withAdmissionProfile } from "./cds/admissions.ts";
import type { CollegeRecord, TemplateTable } from "./cds-sections.ts";

/**
 * Round 3's CDS records and the template, for the per-spec blocks under `school.reported` (cds-admissions.md), and
 * the fall IPEDS's admission factors describe (the ADM release), for the six-factor newest rule.
 */
export interface CdsProfileInputs {
  records: readonly CollegeRecord[];
  table: TemplateTable;
  factorsYear?: number | null;
}

/**
 * `school` as it was before any merge: its previous admissions funnel restored from `admissions.federal`
 * (`restoreFederal`), and its `reported` block and every `reported.*` lineage record removed. A school that ends up
 * with no lineage gets none (not `{}`), and key order is kept, so a school the merge doesn't touch serializes byte
 * for byte as before and the one-college-per-line diff of data/schools.json shows only the colleges that changed.
 */
export function stripReported(school: School): School {
  const restored = restoreFederal(school);
  if (!restored.reported && !Object.keys(restored.lineage ?? {}).some((k) => k.startsWith("reported."))) return restored;
  const lineage = { ...(restored.lineage ?? {}) };
  for (const path of REPORTED_PATHS) delete lineage[path];
  // Rewrite `lineage` in place (spreading keeps its key position, e.g. before `trends` at a CDS college).
  const out: Partial<School> = { ...restored, lineage };
  delete out.reported;
  if (!Object.keys(lineage).length) delete out.lineage;
  return out as School;
}

export interface MergeReportedResult {
  schools: School[];
  /** Colleges that got (or kept) a `reported` block from this file. */
  merged: number;
  /** Colleges that had a `reported` block before this merge but no entry in the file now. */
  removed: number;
}

/**
 * Strips every school (`stripReported`), then re-applies the current entries in `reported.entries` (through
 * `reportedToPatch`, exactly as `sync-data` does) and `applyNewest`, so each college's newer published figures
 * replace its older ones in `admissions.*`, with lineage and `admissions.federal`.
 */
export function mergeReported(schools: School[], reported: ReportedFile, cds?: CdsProfileInputs): MergeReportedResult {
  const records = new Map((cds?.records ?? []).map((r) => [r.unit_id, r]));
  const byUnitId = new Map(reported.entries.map((e) => [e.unit_id, e]));
  let merged = 0;
  let removed = 0;
  const result = schools.map((school) => {
    const hadReported = school.reported?.admissions != null;
    const stripped = stripReported(school);
    const entry = byUnitId.get(school.unit_id);
    // The CDS admissions profile (specs/data-expansion/cds-admissions.md), after C1, from data/cds-records.
    const profiled = (s: School) => (cds ? withAdmissionProfile(s, records.get(s.unit_id), cds.table) : s);
    if (!entry) {
      if (hadReported) removed++;
      return applyNewest(profiled(stripped), { factorsYear: cds?.factorsYear });
    }
    merged++;
    const { reported: reportedData, lineage: entryLineage } = reportedToPatch(entry);
    return applyNewest(profiled({ ...stripped, reported: reportedData, lineage: { ...stripped.lineage, ...entryLineage } }), { factorsYear: cds?.factorsYear });
  });
  return { schools: result, merged, removed };
}
