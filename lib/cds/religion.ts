/**
 * CDS religion facts (specs/religious-life.md, phase 1): a college's round-3 record (data/cds-records/<unit_id>.json)
 * → `school.reported.religion`, one lineage record per stored value. C7's religion row (C.715) is read by
 * lib/cds/admissions.ts into `reported.admission_profile.factors.religious` and is not copied here.
 *
 * - H14 (H.1409 non-need, H.1418 need-based): the college's own scholarships consider religious affiliation. Read
 *   from the same document as the rest of H14 (`pickProcessRecord`, the newest edition with any aid-process fact), so
 *   the Cost page's "Applying for aid" and this block can't disagree. Year: the aid cycle ("Fall 2026 entrants").
 * - F2 (F.201): campus ministries among the activities offered. The newest document that read section F (the item
 *   isn't "not-read" or "failed"); a blank box there means nothing is stored, never an older edition's mark. Year:
 *   the edition ("2025–26").
 *
 * Only marked boxes are stored: an unmarked CDS box is "not marked", never "no" (the same rule as H14 on the Cost
 * page). Pure: type-only imports plus lib/cds-records.ts and lib/cds/financial-aid.ts.
 */
import type { LineageRecord, ReportedReligion, School } from "../types";
import type { CdsCode, CollegeRecord, DocumentRecord, ItemResult } from "../cds-sections.ts";
import { compareDocuments, editionLabel, lineageFromItem, passedItem } from "../cds-records.ts";
import { cycleLabel, pickProcessRecord } from "./financial-aid.ts";

/** Every lineage path this module writes starts with this, so a re-merge can remove the previous ones. */
export const RELIGION_LINEAGE_PREFIX = "reported.religion.";

export const RELIGION_CODES = { aidNonNeed: "H.1409", aidNeed: "H.1418", ministries: "F.201" } as const satisfies Record<string, CdsCode>;

/** A checked box: true, or a mark typed into a text cell (H.1418 is typed "Text" in the template). */
const isMark = (v: ItemResult["v"] | undefined): boolean => v === true || (typeof v === "string" && /^\s*(x|✔|✓|☒|y|yes)\s*$/i.test(v));
const marked = (doc: DocumentRecord, code: CdsCode): boolean => isMark(passedItem(doc, code)?.v);

/** The newest document whose section F was read (F.201 passed or blank, not "not-read", "not-found", or "failed"). */
function ministriesDocument(record: CollegeRecord): DocumentRecord | null {
  return [...record.documents].sort(compareDocuments).find((d) => ["passed", "blank"].includes(d.items[RELIGION_CODES.ministries]?.status ?? "")) ?? null;
}

/** The block and its lineage, or nulls when nothing is marked. */
export function religionFromRecord(record: CollegeRecord): { religion: ReportedReligion | null; lineage: Record<string, LineageRecord> } {
  const religion: ReportedReligion = {};
  const lineage: Record<string, LineageRecord> = {};

  const proc = pickProcessRecord(record);
  if (proc) {
    const nonNeed = marked(proc, RELIGION_CODES.aidNonNeed);
    const need = marked(proc, RELIGION_CODES.aidNeed);
    if (nonNeed || need) {
      const path = `${RELIGION_LINEAGE_PREFIX}aid_by_affiliation`;
      religion.aid_by_affiliation = { non_need: nonNeed, need };
      // One record: the non-need mark when there is one (the more common), else the need-based one.
      lineage[path] = lineageFromItem(proc, nonNeed ? RELIGION_CODES.aidNonNeed : RELIGION_CODES.aidNeed, { year: cycleLabel(proc.edition), path });
    }
  }

  const f = ministriesDocument(record);
  if (f && marked(f, RELIGION_CODES.ministries)) {
    const path = `${RELIGION_LINEAGE_PREFIX}campus_ministries`;
    religion.campus_ministries = true;
    lineage[path] = lineageFromItem(f, RELIGION_CODES.ministries, { year: editionLabel(f.edition), path });
  }

  return { religion: Object.keys(religion).length ? religion : null, lineage };
}

/**
 * The RECORD_STEPS step (lib/reported-merge.ts): removes any previous `reported.religion` and its lineage, then adds
 * the record's. Idempotent: merging twice gives the same school (tests/religion.test.mts).
 */
export function mergeReligion(school: School, record: CollegeRecord | undefined): School {
  const ours = (k: string) => k.startsWith(RELIGION_LINEAGE_PREFIX);
  let out: School = school;
  if (school.reported?.religion || Object.keys(school.lineage ?? {}).some(ours)) {
    const reported = { ...school.reported };
    delete reported.religion;
    const lineage = Object.fromEntries(Object.entries(school.lineage ?? {}).filter(([k]) => !ours(k)));
    out = { ...school, reported, lineage };
    if (!Object.keys(reported).length) delete (out as Partial<School>).reported;
    if (!Object.keys(lineage).length) delete (out as Partial<School>).lineage;
  }
  if (!record) return out;
  const { religion, lineage } = religionFromRecord(record);
  if (!religion) return out;
  return { ...out, lineage: { ...out.lineage, ...lineage }, reported: { ...out.reported, religion } };
}
