/**
 * The one merge of `data/college-reported.json` into the dataset, shared by `scripts/sync-data.mts` (which builds
 * `schools` fresh every run, so stripping is a no-op there) and `scripts/merge-reported.mts` (which re-merges into
 * the committed `data/schools.json`, where a college dropped from `college-reported.json` since the last merge must
 * lose its block and get its previous funnel back). Each merged college's `reported` block then replaces its older
 * admissions figures in `admissions.*` (`lib/newest.ts#applyNewest`), and its CDS record (data/cds-records/, round 3)
 * adds the wave-4 blocks. Pure: no file I/O. See Decisions 1 and 5 of specs/college-reported-round-2.md and
 * specs/college-reported-round-3.md Decision 2.
 */
import type { DatasetMeta, School } from "./types";
import { REPORTED_PATHS } from "./fields.ts";
import { applyNewest, restoreFederal } from "./newest.ts";
import type { ReportedFile } from "./reported.ts";
import { reportedToPatch } from "./reported-checks.ts";
import type { CollegeRecord, TemplateTable } from "./cds-sections.ts";
import { indexRecords } from "./cds-records.ts";
import { applyNewestGroups, federalYears } from "./newest-groups.ts";
import { lineageFall } from "./score-bands.ts";
import { studentBodyFromRecord } from "./cds/student-body.ts";
import { withAdmissionProfile } from "./cds/admissions.ts";
import { mergeTestScores } from "./cds/test-scores.ts";
import { mergeResidency } from "./cds/residency.ts";
import { applyCostAndDebt } from "./cds/cost-and-debt.ts";
import { applyFinancialAid } from "./cds/financial-aid.ts";
import { mergeAcademics } from "./cds/academics.ts";
import { mergeTransfer } from "./cds/transfer.ts";
import { mergeApplicationLogistics } from "./cds/application-logistics.ts";

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

/** What the round-3 CDS records need to merge. Every field but `records` has a default derived from `meta`. */
export interface CdsMergeInputs {
  records: readonly CollegeRecord[];
  /** `data/meta.json` vintages: the federal year each newest group compares against. Without it no group replaces. */
  meta?: Pick<DatasetMeta, "vintages">;
  /** The template table (lib/cds-template.ts CDS_TEMPLATE); the admissions profile needs it for labels and years. */
  table?: TemplateTable;
  /** The federal admissions release year (IPEDS ADM fall) the six shared C7 factors compare against. Default: from meta. */
  factorsYear?: number | null;
  /** The fall the dataset's IPEDS ADM test policy describes, which a newer CDS C8 policy may replace. Default: from meta. */
  federalPolicyYear?: number | null;
}

/** The fall year of the IPEDS ADM vintage ("Fall 2024" → 2024), or null when meta doesn't say. */
function admissionsYear(meta: Pick<DatasetMeta, "vintages"> | undefined): number | null {
  const m = /\d{4}/.exec(meta?.vintages?.["ipeds-adm"] ?? "");
  return m ? Number(m[0]) : null;
}

/**
 * The round-3 CDS blocks each display spec adds from a college's record, applied in this order after C1 and the
 * newest groups. Each step is that spec's own module and leaves a school without a record untouched.
 */
const RECORD_STEPS: readonly ((school: School, record: CollegeRecord | undefined) => School)[] = [
  // specs/data-expansion/cds-residency-admissions.md: admit rates and yields by residency.
  mergeResidency,
  // specs/data-expansion/cds-cost-and-debt.md: next year's price and graduates' debt, beside the federal figures.
  applyCostAndDebt,
  // specs/data-expansion/cds-financial-aid.md: aid forms, deadlines, need met, merit, international aid.
  applyFinancialAid,
  // specs/data-expansion/cds-academics.md: class sizes, the college's own ratio, programs, coursework.
  mergeAcademics,
  // specs/data-expansion/cds-transfer.md: transfer applicants, admits, and what transfers need.
  mergeTransfer,
  // specs/data-expansion/cds-application-logistics.md: deadlines, notification, reply, deposit, gap year, units.
  mergeApplicationLogistics,
];

/**
 * Strips every school (`stripReported`), then re-applies the current entries in `reported.entries` (through
 * `reportedToPatch`, exactly as `sync-data` does); adds the CDS admissions profile (lib/cds/admissions.ts) and the
 * C8/C9 test blocks (lib/cds/test-scores.ts); runs `applyNewest`, so each college's newer published figures, factor
 * answers, test policy, and scores replace its older ones in `admissions.*`, with lineage and the federal values
 * kept; then, from the record, the newest groups (enrollment, race, retention, graduation; lib/newest-groups.ts,
 * every federal comparison against the stripped baseline) and the wave-4 blocks under `school.reported`
 * (`RECORD_STEPS`).
 */
export function mergeReported(schools: School[], reported: ReportedFile, cds?: CdsMergeInputs): MergeReportedResult {
  const byUnitId = new Map(reported.entries.map((e) => [e.unit_id, e]));
  const byRecord = indexRecords(cds?.records ?? []);
  const years = cds?.meta ? federalYears(cds.meta) : null;
  const factorsYear = cds?.factorsYear ?? admissionsYear(cds?.meta);
  const federalPolicyYear = cds?.federalPolicyYear ?? (cds?.meta ? lineageFall(cds.meta.vintages["ipeds-adm"]) : null);
  let merged = 0;
  let removed = 0;
  const profiled = (s: School): School => (cds?.table ? withAdmissionProfile(s, byRecord.get(s.unit_id), cds.table) : s);
  const withTests = (s: School): School => (cds ? mergeTestScores(s, byRecord.get(s.unit_id), federalPolicyYear) : s);
  const groups = (s: School, baseline: School): School => {
    const record = byRecord.get(s.unit_id);
    return record && years ? applyNewestGroups(s, studentBodyFromRecord(record, baseline).found, years) : s;
  };
  const fromRecords = (s: School): School => {
    const record = byRecord.get(s.unit_id);
    return RECORD_STEPS.reduce((acc, step) => step(acc, record), s);
  };
  const result = schools.map((school) => {
    const hadReported = school.reported?.admissions != null;
    const stripped = stripReported(school);
    const entry = byUnitId.get(school.unit_id);
    let withC1 = stripped;
    if (!entry) {
      if (hadReported) removed++;
    } else {
      merged++;
      const { reported: reportedData, lineage: entryLineage } = reportedToPatch(entry);
      withC1 = { ...stripped, reported: reportedData, lineage: { ...stripped.lineage, ...entryLineage } };
    }
    const newest = applyNewest(withTests(profiled(withC1)), { factorsYear });
    return fromRecords(groups(newest, stripped));
  });
  return { schools: result, merged, removed };
}
