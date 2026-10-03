/**
 * CDS academics (specs/data-expansion/cds-academics.md): a college's round-3 record (data/cds-records/<unit_id>.json)
 * → `school.reported.academics`: class sections by size (I-3), the college's own student-to-faculty ratio (I-2),
 * special programs offered (E1), and required coursework areas (E3), with one lineage record per block.
 *
 * Which values. Each block comes from the newest document whose items for it **passed**, and only when the block's
 * checks pass (a failing block waits for review and is not merged):
 * - `academics-sections-sum` / `academics-subsections-sum`: the seven bins add up to the printed total within ±1. A
 *   total that didn't pass (an Excel `##`) is replaced by the bins' sum, as the spec says.
 * - `academics-ratio-internal`: the printed ratio is within 0.5 of students ÷ faculty when both are printed.
 * - **No federal check on I.201.** The CDS ratio and IPEDS EF-D's are defined differently (Harvard 11 vs 7, Michigan
 *   15 vs 11), so a gap is expected. `FEDERAL_RATIO_CHECK` is `null` on purpose and a test fails if it isn't.
 * - E1/E3: a key is stored only for a passed `true` mark (blank ≠ no; never `false`). An empty `core_curriculum` (an
 *   open curriculum) is stored only when every E3 item was read blank and the same document marked at least one E1
 *   program, so a section we never reached, or one the college skipped, is never read as "no required core".
 *
 * Pure: type-only imports plus lib/cds-records.ts and ./academics-display.ts (both pure).
 */
import type { CdsCoreAreaKey, CdsProgramKey, ClassSizeBins, LineageRecord, ReportedAcademics, School } from "../types";
import type { CdsCode, CollegeRecord, DocumentRecord } from "../cds-sections.ts";
import { compareDocuments, itemNumber, lineageFromItem, passedItem } from "../cds-records.ts";
import { CORE_AREA_KEYS, PROGRAM_KEYS, assertOfferedOnly } from "./academics-display.ts";

/** Every lineage path this module writes starts with this, so a re-merge can remove the previous ones. */
export const ACADEMICS_LINEAGE_PREFIX = "reported.academics.";

export const SECTION_CODES: readonly CdsCode[] = ["I.301", "I.302", "I.303", "I.304", "I.305", "I.306", "I.307"];
export const SECTIONS_TOTAL: CdsCode = "I.308";
export const SUBSECTION_CODES: readonly CdsCode[] = ["I.309", "I.310", "I.311", "I.312", "I.313", "I.314", "I.315"];
export const SUBSECTIONS_TOTAL: CdsCode = "I.316";
export const RATIO_CODES = { ratio: "I.201", students: "I.202", faculty: "I.203" } as const;

/** E1 codes in scope (E.102, E.115, E.117 come from IPEDS IC as `campus.programs`; E.109, E.119, E.120 are out of scope). */
export const PROGRAM_CODES: Record<CdsProgramKey, CdsCode> = {
  accelerated: "E.101",
  cross_registration: "E.103",
  distance_learning: "E.104",
  double_major: "E.105",
  dual_enrollment: "E.106",
  esl: "E.107",
  exchange: "E.108",
  honors: "E.110",
  independent_study: "E.111",
  internships: "E.112",
  liberal_arts_career: "E.113",
  student_designed_major: "E.114",
  teacher_certification: "E.116",
  weekend_college: "E.118",
};
/** E3 codes in scope (E.313/E.314 are free text, out of scope). */
export const CORE_CODES: Record<CdsCoreAreaKey, CdsCode> = {
  arts: "E.301",
  computer_literacy: "E.302",
  english: "E.303",
  foreign_languages: "E.304",
  history: "E.305",
  physical_education: "E.306",
  humanities: "E.307",
  intensive_writing: "E.308",
  mathematics: "E.309",
  philosophy: "E.310",
  sciences: "E.311",
  social_science: "E.312",
};

/** Bins vs. printed total tolerance (rounding). */
export const SUM_TOLERANCE = 1;
/** Printed ratio vs. students ÷ faculty tolerance. */
export const RATIO_TOLERANCE = 0.5;
/**
 * The federal-agreement check on I.201 that round-3's draft proposed ("within 2 of federal"). Deliberately null: the two
 * ratios are defined differently, so a gap is not an error. tests/cds-academics.test.mts fails if this is set.
 */
export const FEDERAL_RATIO_CHECK: null = null;

export interface AcademicsFailure {
  check: "academics-sections-sum" | "academics-subsections-sum" | "academics-ratio-internal";
  detail: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** The seven bins sum to the printed total within ±1 (no total printed: nothing to check). */
export function binsMatchTotal(bins: readonly number[], total: number | null): boolean {
  return total === null || Math.abs(sum(bins) - total) <= SUM_TOLERANCE;
}

/** The printed ratio is within 0.5 of students ÷ faculty (either count missing: nothing to check). */
export function ratioIsConsistent(ratio: number, students: number | null, faculty: number | null): boolean {
  return students === null || faculty === null || faculty <= 0 || Math.abs(ratio - students / faculty) <= RATIO_TOLERANCE;
}

/** The fall the I items label themselves with ("Fall 2025 Student to Faculty ratio"), else the record's fall label. */
function fallTerm(doc: DocumentRecord): string | null {
  const label = doc.items[RATIO_CODES.ratio]?.quote?.match(/\bFall (\d{4})\b/);
  if (label) return `Fall ${label[1]}`;
  const fall = doc.years.fall;
  return fall && /^Fall \d{4}$/.test(fall) ? fall : null;
}

const bins = (doc: DocumentRecord, codes: readonly CdsCode[]): ClassSizeBins | null => {
  const v = codes.map((c) => itemNumber(doc, c));
  return v.every((x): x is number => x !== null && x >= 0) ? (v as ClassSizeBins) : null;
};

const QUOTE_MAX = 160;
const clip = (q: string) => (q.length <= QUOTE_MAX ? q : `${q.slice(0, QUOTE_MAX - 1)}…`);

type Block<T> = { value: T; lineage: LineageRecord; edition: string } | null;

/** I-3 from one document: the block, or the failures that keep it out, or null when the bins weren't read. */
export function classSectionsFrom(doc: DocumentRecord): { block: NonNullable<ReportedAcademics["class_sections"]>; lineage: LineageRecord } | { failures: AcademicsFailure[] } | null {
  const sections = bins(doc, SECTION_CODES);
  const term = fallTerm(doc);
  if (!sections || !term) return null;
  const failures: AcademicsFailure[] = [];
  const printed = itemNumber(doc, SECTIONS_TOTAL);
  if (!binsMatchTotal(sections, printed)) {
    failures.push({ check: "academics-sections-sum", detail: `class sections add up to ${fmt(sum(sections))}, total ${fmt(printed!)} (${SECTIONS_TOTAL})` });
  }
  const subsections = bins(doc, SUBSECTION_CODES);
  const subPrinted = itemNumber(doc, SUBSECTIONS_TOTAL);
  if (subsections && !binsMatchTotal(subsections, subPrinted)) {
    failures.push({ check: "academics-subsections-sum", detail: `class subsections add up to ${fmt(sum(subsections))}, total ${fmt(subPrinted!)} (${SUBSECTIONS_TOTAL})` });
  }
  if (failures.length) return { failures };
  const sectionsTotal = printed ?? sum(sections);
  // Cite the printed total when it passed (the reader checks it against the bins); else the first bin.
  const anchor = passedItem(doc, SECTIONS_TOTAL) ? SECTIONS_TOTAL : SECTION_CODES[0];
  const rec = lineageFromItem(doc, anchor, { year: term, path: "reported.academics.class_sections" });
  const quote = clip(`Class sections ${SECTION_CODES.map((c, i) => `${["2-9", "10-19", "20-29", "30-39", "40-49", "50-99", "100+"][i]}: ${sections[i]}`).join(", ")}; total ${sectionsTotal}`);
  return {
    block: {
      sections,
      sections_total: sectionsTotal,
      subsections,
      subsections_total: subsections ? (subPrinted ?? sum(subsections)) : null,
      term,
      edition: doc.edition,
    },
    lineage: { ...rec, quote },
  };
}

/** I-2 from one document. */
export function ratioFrom(doc: DocumentRecord): { block: NonNullable<ReportedAcademics["student_faculty_ratio"]>; lineage: LineageRecord } | { failures: AcademicsFailure[] } | null {
  const ratio = itemNumber(doc, RATIO_CODES.ratio);
  const term = fallTerm(doc);
  if (ratio === null || ratio <= 0 || !term) return null;
  const students = itemNumber(doc, RATIO_CODES.students);
  const faculty = itemNumber(doc, RATIO_CODES.faculty);
  if (!ratioIsConsistent(ratio, students, faculty)) {
    return { failures: [{ check: "academics-ratio-internal", detail: `ratio ${ratio} vs ${fmt(students!)} ÷ ${fmt(faculty!)} = ${(students! / faculty!).toFixed(1)}` }] };
  }
  const rec = lineageFromItem(doc, RATIO_CODES.ratio, { year: term, path: "reported.academics.student_faculty_ratio" });
  const parts = [RATIO_CODES.ratio, RATIO_CODES.students, RATIO_CODES.faculty].map((c) => passedItem(doc, c)?.quote).filter(Boolean);
  return { block: { ratio, students, faculty, term }, lineage: { ...rec, quote: clip(parts.join("; ")) } };
}

/** The edition's academic-year label ("2025–26"): E1 and E3 describe the catalog, not a cohort. */
const editionYear = (doc: DocumentRecord) => doc.years.edition ?? null;

/** E1 from one document: the marked programs (null when none in scope is marked). */
export function programsFrom(doc: DocumentRecord): Block<Partial<Record<CdsProgramKey, true>>> {
  const year = editionYear(doc);
  if (!year) return null;
  const marked = PROGRAM_KEYS.filter((k) => passedItem(doc, PROGRAM_CODES[k])?.v === true);
  if (!marked.length) return null;
  const value = Object.fromEntries(marked.map((k) => [k, true])) as Partial<Record<CdsProgramKey, true>>;
  const rec = lineageFromItem(doc, PROGRAM_CODES[marked[0]], { year, path: "reported.academics.programs" });
  const quote = clip(`Special study options marked: ${marked.map((k) => passedItem(doc, PROGRAM_CODES[k])!.quote!.split(" | ")[0]).join("; ")}`);
  return { value, lineage: { ...rec, quote }, edition: doc.edition };
}

/**
 * E3 from one document: the checked areas; `{}` (open curriculum) when every E3 item was read blank and the document
 * marked at least one E1 program (the section was answered); null otherwise (not reached, partly read, or skipped).
 */
export function coreFrom(doc: DocumentRecord): Block<Partial<Record<CdsCoreAreaKey, true>>> {
  const year = editionYear(doc);
  if (!year) return null;
  const checked = CORE_AREA_KEYS.filter((k) => passedItem(doc, CORE_CODES[k])?.v === true);
  if (checked.length) {
    const value = Object.fromEntries(checked.map((k) => [k, true])) as Partial<Record<CdsCoreAreaKey, true>>;
    const rec = lineageFromItem(doc, CORE_CODES[checked[0]], { year, path: "reported.academics.core_curriculum" });
    const quote = clip(`Required coursework marked: ${checked.map((k) => passedItem(doc, CORE_CODES[k])!.quote!.split(" | ")[0]).join("; ")}`);
    return { value, lineage: { ...rec, quote }, edition: doc.edition };
  }
  const allReadBlank = CORE_AREA_KEYS.every((k) => doc.items[CORE_CODES[k]]?.status === "blank");
  // Any E1 mark, including the three the site shows from IPEDS (E.102, E.115, E.117).
  const answeredE1 = [...Object.values(PROGRAM_CODES), "E.102", "E.115", "E.117"].find((c) => passedItem(doc, c)?.v === true);
  if (!allReadBlank || !answeredE1) return null;
  // Cite the section: the E1 mark that shows section E was answered, and what E3 said (nothing checked).
  const rec = lineageFromItem(doc, answeredE1, { year, path: "reported.academics.core_curriculum" });
  return {
    value: {},
    lineage: { ...rec, method: "derived", quote: "Required coursework (E3): no area checked (E.301–E.312 all blank) while section E was answered" },
    edition: doc.edition,
  };
}

export interface AcademicsOutcome {
  block: "class_sections" | "student_faculty_ratio" | "programs" | "core_curriculum";
  edition: string;
  status: "merged" | "failed";
  failures: AcademicsFailure[];
}

/** The block and its lineage from a college's record: each part from the newest document where it passed. */
export function academicsFromRecord(record: CollegeRecord): { block: ReportedAcademics | null; lineage: Record<string, LineageRecord>; outcomes: AcademicsOutcome[] } {
  const docs = [...record.documents].sort(compareDocuments);
  const block: ReportedAcademics = {};
  const lineage: Record<string, LineageRecord> = {};
  const outcomes: AcademicsOutcome[] = [];
  const first = <K extends "class_sections" | "student_faculty_ratio">(key: K, read: (d: DocumentRecord) => ReturnType<typeof classSectionsFrom> | ReturnType<typeof ratioFrom>) => {
    for (const doc of docs) {
      const r = read(doc);
      if (!r) continue;
      if ("failures" in r) {
        outcomes.push({ block: key, edition: doc.edition, status: "failed", failures: r.failures });
        continue;
      }
      (block as Record<string, unknown>)[key] = r.block;
      lineage[`${ACADEMICS_LINEAGE_PREFIX}${key}`] = r.lineage;
      outcomes.push({ block: key, edition: doc.edition, status: "merged", failures: [] });
      return;
    }
  };
  first("class_sections", classSectionsFrom);
  first("student_faculty_ratio", ratioFrom);
  for (const [key, read] of [["programs", programsFrom], ["core_curriculum", coreFrom]] as const) {
    for (const doc of docs) {
      const r = read(doc);
      if (!r) continue;
      (block as Record<string, unknown>)[key] = r.value;
      lineage[`${ACADEMICS_LINEAGE_PREFIX}${key}`] = r.lineage;
      outcomes.push({ block: key, edition: doc.edition, status: "merged", failures: [] });
      break;
    }
  }
  assertOfferedOnly(block.programs, PROGRAM_KEYS, "reported.academics.programs");
  assertOfferedOnly(block.core_curriculum, CORE_AREA_KEYS, "reported.academics.core_curriculum");
  return { block: Object.keys(block).length ? block : null, lineage, outcomes };
}

/**
 * The school with its academics block from `record` (or without one). Idempotent: any previous block and its lineage
 * are removed first, and a school that ends with neither keeps its key order and serializes as before. Nothing in the
 * federal `school.academics.*` is read or changed.
 */
export function mergeAcademics(school: School, record: CollegeRecord | undefined): School {
  const hadLineage = Object.keys(school.lineage ?? {}).some((k) => k.startsWith(ACADEMICS_LINEAGE_PREFIX));
  let out: School = school;
  if (school.reported?.academics || hadLineage) {
    const reported = { ...school.reported };
    delete reported.academics;
    const lineage = Object.fromEntries(Object.entries(school.lineage ?? {}).filter(([k]) => !k.startsWith(ACADEMICS_LINEAGE_PREFIX)));
    out = { ...school, reported, lineage };
    if (!Object.keys(reported).length) delete (out as Partial<School>).reported;
    if (!Object.keys(lineage).length) delete (out as Partial<School>).lineage;
  }
  if (!record) return out;
  const { block, lineage } = academicsFromRecord(record);
  if (!block) return out;
  return { ...out, lineage: { ...out.lineage, ...lineage }, reported: { ...out.reported, academics: block } };
}
