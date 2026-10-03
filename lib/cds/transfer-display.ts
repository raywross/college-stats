/**
 * Showing CDS transfer admission (specs/data-expansion/cds-transfer.md): the Admissions page's "Transferring in" card,
 * Compare's "Transfer acceptance rate" cell, and Explore's "Admits transfers" filter. Reads
 * `school.reported.transfer` (stored by lib/cds/transfer.ts) and, for the filter's fallback, the federal transfer-in
 * count (lib/transfers.ts, `demographics.transfer_in`).
 *
 * Partial coverage: none of this feeds METRICS, ranks, medians, percentile strips, sorts, the radar, Key differences,
 * or "Known for" (tests/cds-transfer.test.mts guards it).
 *
 * Pure (imports only pure modules), so client components and Node tests load it directly.
 */
import type { ReportedTransfer, School, TransferMaterials, TransferRequirement, TransferTerm, TransferTermDates } from "../types";
import { pctSmart } from "../format.ts";

/** Card rows, in the template's order. */
export const MATERIAL_LABELS: Record<keyof TransferMaterials, string> = {
  high_school_transcript: "High school transcript",
  college_transcript: "College transcripts",
  essay: "Essay or personal statement",
  interview: "Interview",
  standardized_tests: "Standardized test scores",
  statement_of_good_standing: "Statement of good standing from a prior college",
};

export const REQUIREMENT_LABELS: Record<TransferRequirement, string> = {
  required: "Required",
  required_some: "Required of some",
  recommended: "Recommended",
  recommended_some: "Recommended for some",
  not_required: "Not required",
};

/** Required → recommended → not required, for the checklist's emphasis. */
export const REQUIREMENT_WEIGHT: Record<TransferRequirement, "strong" | "medium" | "none"> = {
  required: "strong",
  required_some: "medium",
  recommended: "medium",
  recommended_some: "medium",
  not_required: "none",
};

const TERM_NAMES: Record<TransferTerm, string> = { fall: "fall", winter: "winter", spring: "spring", summer: "summer" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "March 15". */
export const formatMonthDayLong = (d: { month: number; day: number }) => `${MONTHS[d.month - 1]} ${d.day}`;

/** "fall", "fall and spring", "fall, spring, and summer". */
export function termList(terms: readonly TransferTerm[]): string {
  const t = terms.map((x) => TERM_NAMES[x]);
  return t.length <= 2 ? t.join(" and ") : `${t.slice(0, -1).join(", ")}, and ${t[t.length - 1]}`;
}

/** One row of the deadlines list: "Fall: apply by March 15, decisions on a rolling basis, reply by July 1". */
export function datesSentence(term: TransferTerm, d: TransferTermDates): string {
  const parts: string[] = [];
  if (d.priority) parts.push(`priority date ${formatMonthDayLong(d.priority)}`);
  if (d.closing) parts.push(`apply by ${formatMonthDayLong(d.closing)}`);
  if (d.notification === "rolling") parts.push("decisions on a rolling basis");
  else if (d.notification) parts.push(`decisions by ${formatMonthDayLong(d.notification)}`);
  if (d.reply) parts.push(`reply by ${formatMonthDayLong(d.reply)}`);
  const name = TERM_NAMES[term];
  return `${name[0].toUpperCase()}${name.slice(1)} entry: ${parts.join(", ")}`;
}

export interface TransferCardModel {
  t: ReportedTransfer;
  /** True when the college says (or D2 shows) it enrolls transfers. */
  enrolls: boolean | null;
  /** The transfer rate, or null. */
  rate: number | null;
  /** First-year rate shown beside it (the page's own `admissions.acceptance_rate`), or null. */
  firstYearRate: number | null;
  /** "12% of transfer applicants were admitted" (+ ", vs. 8.4% of first-year applicants" when known). */
  rateSentence: string | null;
  termsSentence: string | null;
  creditsSentence: string | null;
  /** Rows of the checklist that the college marked. */
  materials: { key: keyof TransferMaterials; label: string; level: TransferRequirement }[];
  gpa: { hs: number | null; college: number | null };
  dates: { term: TransferTerm; sentence: string }[];
}

/**
 * The "Transferring in" card: shown when the college's CDS says whether it enrolls transfers, or the transfer admit rate
 * is known. A college that doesn't enroll transfers gets a one-line fact instead of the rest.
 */
export function transferCard(s: Pick<School, "reported" | "admissions">): TransferCardModel | null {
  const t = s.reported?.transfer;
  if (!t || (t.enrolls_transfers === null && t.admit_rate === null)) return null;
  const firstYearRate = s.admissions.acceptance_rate ?? null;
  const rate = t.admit_rate;
  const rateSentence =
    rate === null ? null : `${pctSmart(rate)} of transfer applicants were admitted` + (firstYearRate !== null ? `, vs. ${pctSmart(firstYearRate)} of first-year applicants` : "");
  const order: TransferTerm[] = ["fall", "winter", "spring", "summer"];
  const unit = t.min_credits_unit ? t.min_credits_unit.toLowerCase().replace(/\(s\)$/, "s") : "credits";
  return {
    t,
    enrolls: t.enrolls_transfers,
    rate,
    firstYearRate,
    rateSentence,
    termsSentence: t.terms?.length ? `Transfers may start in the ${termList(t.terms)}.` : null,
    creditsSentence: t.min_credits !== null ? `At least ${t.min_credits} ${t.min_credits === 1 ? unit.replace(/s$/, "") : unit} completed to apply as a transfer.` : null,
    materials: t.required_materials
      ? (Object.keys(MATERIAL_LABELS) as (keyof TransferMaterials)[]).flatMap((k) => {
          const level = t.required_materials![k];
          return level ? [{ key: k, label: MATERIAL_LABELS[k], level }] : [];
        })
      : [],
    gpa: { hs: t.min_hs_gpa, college: t.min_college_gpa },
    dates: t.dates ? order.flatMap((term) => (t.dates![term] ? [{ term, sentence: datesSentence(term, t.dates![term]!) }] : [])) : [],
  };
}

/* ------------------------------------------------------------------ */
/* Compare: "All the numbers"                                          */
/* ------------------------------------------------------------------ */

/** "12%", or null (shown blank, never 0) without a CDS transfer funnel. */
export function compareTransferAdmitRate(s: Pick<School, "reported">): string | null {
  const r = s.reported?.transfer?.admit_rate;
  return r == null ? null : pctSmart(r);
}

/* ------------------------------------------------------------------ */
/* Explore: "Admits transfers" (boolean only)                          */
/* ------------------------------------------------------------------ */

/**
 * The college's CDS answer when it has one (D1, or D2's inference); for a college without one, whether the federal
 * survey counted any new transfer-ins this fall (a college enrolling transfers almost certainly admits them).
 */
export function admitsTransfers(s: Pick<School, "reported" | "demographics">): boolean {
  const cds = s.reported?.transfer?.enrolls_transfers;
  if (cds === true || cds === false) return cds;
  return (s.demographics.transfer_in?.count ?? 0) > 0;
}

export const TRANSFER_FILTER = { param: "transfers", label: "Admits transfer students", test: admitsTransfers } as const;
