/**
 * CDS Greek life (specs/greek-life.md phase 1): a college's round-3 record (data/cds-records/<unit_id>.json) →
 * `school.reported.greek`: F1's two participation percentages (men in fraternities, women in sororities, each for
 * first-years and all undergrads) and F4's fraternity/sorority housing checkbox, with one lineage record per field.
 *
 * Which values. F1 and F4 are read independently (round-3 Decision 9: a block's own checks, never blocking
 * another): the newest document with any F1 answer supplies all four percentages it has; the newest document with
 * F.408 answered supplies housing. A college can publish F1 without F4, or a newer F4 without a newer F1.
 *
 * Blank is not 0 (spec Rules): an item that didn't pass (blank, failed, not read) stores null, never 0 — Princeton's
 * blank F1 rows (eating clubs, not recognized Greek chapters) read as "not reported", the same as a college that
 * never answered. F.408 follows the E1/E3 convention (lib/cds/academics.ts): a checked box stores `true`; an
 * unchecked or blank box stores nothing (never `false`), because a CDS checkbox left blank isn't provably "no".
 *
 * Percent-vs-fraction ambiguity (spec Rules; "Howard's '0.61'"). The generic percent reader (lib/cds-sections.ts
 * `percentShare`) already resolves most of this: a PDF form field is read with `percentPoints: true` (a bare number
 * is always points, so "0.61" there means 0.61%), and an Excel cell holds a true fraction. What's left or a column
 * this module can check on its own: first-years and all-undergrads for the same organization (fraternities or
 * sororities) should be the same order of magnitude — `greek-f1-ratio` drops a pair when one side is more than
 * `GREEK_RATIO_MAX` times the other (a units mix-up, not a real gap: deferred recruitment already reads as a
 * legitimate near-zero first-year share next to a normal undergrad share, which this allows).
 *
 * Years (lineage): F1's four percentages are the document's fall (`years.fall`, e.g. "Fall 2025"); F4 is the
 * edition ("2025–26"), matching the template's year rules (scripts/build-cds-template.mts SCOPE).
 *
 * Pure: type-only imports plus lib/cds-records.ts and lib/cds-sections.ts (both pure).
 */
import type { LineageRecord, ReportedGreek, School } from "../types";
import type { CdsCode, CollegeRecord, DocumentRecord } from "../cds-sections.ts";
import { compareDocuments, editionLabel, itemBoolean, itemShare, lineageFromItem, passedItem } from "../cds-records.ts";

/** Every lineage path this module writes starts with this, so a re-merge can remove the previous ones. */
export const GREEK_LINEAGE_PREFIX = "reported.greek.";

/** F1 codes (2025–26 template): first-years (F.102/F.103), all undergraduates (F.110/F.111). */
export const F1 = {
  frat_pct_first_year: "F.102",
  frat_pct_undergrad: "F.110",
  sor_pct_first_year: "F.103",
  sor_pct_undergrad: "F.111",
} as const satisfies Record<keyof Omit<ReportedGreek, "housing">, CdsCode>;
export const F1_CODES: readonly CdsCode[] = Object.values(F1);

/** F4's fraternity/sorority housing checkbox. */
export const F4_HOUSING: CdsCode = "F.408";

/** An F1 pair (first-year, undergrad) more than this many times apart is a likely units mix-up, not a real gap. */
export const GREEK_RATIO_MAX = 20;

export type GreekCheck = "greek-f1-ratio";

export interface GreekFailure {
  check: GreekCheck;
  detail: string;
}

const fmt = (n: number) => (n * 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * True when `a` and `b` are far enough apart (more than `GREEK_RATIO_MAX`×) that one side is probably a points/
 * fraction mix-up rather than a real difference. Either side null, or either exactly 0 (deferred recruitment, a
 * college with no first-year Greek life), never fails.
 */
export function ratioInconsistent(a: number | null, b: number | null): boolean {
  if (a === null || b === null || a === 0 || b === 0) return false;
  const ratio = a > b ? a / b : b / a;
  return ratio > GREEK_RATIO_MAX;
}

/** One organization's F1 pair (first-year, undergrad), read and checked together. */
function readPair(
  doc: DocumentRecord,
  firstYearCode: CdsCode,
  undergradCode: CdsCode,
  label: string
): { firstYear: number | null; undergrad: number | null; failures: GreekFailure[] } {
  const firstYear = itemShare(doc, firstYearCode);
  const undergrad = itemShare(doc, undergradCode);
  if (ratioInconsistent(firstYear, undergrad)) {
    return {
      firstYear: null,
      undergrad: null,
      failures: [
        {
          check: "greek-f1-ratio",
          detail: `${label}: first-year ${fmt(firstYear!)}% vs. all-undergrad ${fmt(undergrad!)}% (${firstYearCode}, ${undergradCode}) are more than ${GREEK_RATIO_MAX}x apart`,
        },
      ],
    };
  }
  return { firstYear, undergrad, failures: [] };
}

/** A document has any F1 answer this module reads. */
const hasF1 = (doc: DocumentRecord) => F1_CODES.some((c) => passedItem(doc, c));

export interface GreekOutcome {
  /** The document F1's percentages came from, or null when none has any. */
  participationEdition: string | null;
  /** The document F.408 came from, or null when none answered it. */
  housingEdition: string | null;
  failures: GreekFailure[];
}

/**
 * The block and its lineage from a college's record: F1's percentages from the newest document with any F1 answer
 * (each organization's pair checked on its own), F4's housing checkbox from the newest document that answered it.
 * Returns a null block when neither group has anything to show.
 */
export function greekFromRecord(record: CollegeRecord): { block: ReportedGreek | null; lineage: Record<string, LineageRecord>; outcome: GreekOutcome } {
  const docs = [...record.documents].sort(compareDocuments);
  const lineage: Record<string, LineageRecord> = {};
  const outcome: GreekOutcome = { participationEdition: null, housingEdition: null, failures: [] };
  const P = (k: keyof ReportedGreek) => `${GREEK_LINEAGE_PREFIX}${k}`;

  let frat_pct_first_year: number | null = null;
  let frat_pct_undergrad: number | null = null;
  let sor_pct_first_year: number | null = null;
  let sor_pct_undergrad: number | null = null;

  const f1Doc = docs.find(hasF1);
  if (f1Doc) {
    const fall = f1Doc.years.fall ?? null;
    outcome.participationEdition = f1Doc.edition;
    if (fall) {
      const frat = readPair(f1Doc, F1.frat_pct_first_year, F1.frat_pct_undergrad, "Fraternities");
      outcome.failures.push(...frat.failures);
      frat_pct_first_year = frat.firstYear;
      frat_pct_undergrad = frat.undergrad;
      if (frat_pct_first_year !== null) lineage[P("frat_pct_first_year")] = lineageFromItem(f1Doc, F1.frat_pct_first_year, { year: fall, path: P("frat_pct_first_year") });
      if (frat_pct_undergrad !== null) lineage[P("frat_pct_undergrad")] = lineageFromItem(f1Doc, F1.frat_pct_undergrad, { year: fall, path: P("frat_pct_undergrad") });

      const sor = readPair(f1Doc, F1.sor_pct_first_year, F1.sor_pct_undergrad, "Sororities");
      outcome.failures.push(...sor.failures);
      sor_pct_first_year = sor.firstYear;
      sor_pct_undergrad = sor.undergrad;
      if (sor_pct_first_year !== null) lineage[P("sor_pct_first_year")] = lineageFromItem(f1Doc, F1.sor_pct_first_year, { year: fall, path: P("sor_pct_first_year") });
      if (sor_pct_undergrad !== null) lineage[P("sor_pct_undergrad")] = lineageFromItem(f1Doc, F1.sor_pct_undergrad, { year: fall, path: P("sor_pct_undergrad") });
    }
  }

  let housing: boolean | null = null;
  const housingDoc = docs.find((d) => passedItem(d, F4_HOUSING));
  if (housingDoc) {
    outcome.housingEdition = housingDoc.edition;
    const edition = housingDoc.years.edition ?? editionLabel(housingDoc.edition);
    if (itemBoolean(housingDoc, F4_HOUSING) === true) {
      housing = true;
      lineage[P("housing")] = lineageFromItem(housingDoc, F4_HOUSING, { year: edition, path: P("housing") });
    }
  }

  const block: ReportedGreek = { frat_pct_first_year, frat_pct_undergrad, sor_pct_first_year, sor_pct_undergrad, housing };
  const any = Object.values(block).some((v) => v !== null);
  return { block: any ? block : null, lineage: any ? lineage : {}, outcome };
}

/**
 * The school with its Greek-life block from `record` (or without one). Idempotent: any previous block and its
 * lineage are removed first, and a school that ends with neither keeps its key order and serializes as before.
 */
export function mergeGreek(school: School, record: CollegeRecord | undefined): School {
  const hadLineage = Object.keys(school.lineage ?? {}).some((k) => k.startsWith(GREEK_LINEAGE_PREFIX));
  let out: School = school;
  if (school.reported?.greek || hadLineage) {
    const reported = { ...school.reported };
    delete reported.greek;
    const lineage = Object.fromEntries(Object.entries(school.lineage ?? {}).filter(([k]) => !k.startsWith(GREEK_LINEAGE_PREFIX)));
    out = { ...school, reported, lineage };
    if (!Object.keys(reported).length) delete (out as Partial<School>).reported;
    if (!Object.keys(lineage).length) delete (out as Partial<School>).lineage;
  }
  if (!record) return out;
  const { block, lineage } = greekFromRecord(record);
  if (!block) return out;
  return { ...out, lineage: { ...out.lineage, ...lineage }, reported: { ...out.reported, greek: block } };
}
