/**
 * The seven automated checks (specs/college-reported-data.md#automated-checks) and the conversion from a passing
 * extraction to a published entry. Pure module: no runtime imports besides lib/reported.ts and lib/fields.ts, so the
 * pipeline (scripts/sync-college-reported.mts, built separately) and the sync can both depend on it without pulling
 * in the rest of the app. Exports are named exactly as the pipeline imports them: `runChecks`, `toReportedEntry`,
 * `reportedToPatch`.
 */
import type { LineageRecord, ReportedAdmissions, ReportedData, ReportedSourceKind, School } from "./types";
import { fallYear, type CheckFailure, type CheckId, type Extraction, type ReportedEntry, type ReportedValuePath } from "./reported.ts";
import type { FieldPath } from "./fields.ts";

function fail(check: CheckId, detail: string): CheckFailure {
  return { check, detail };
}

/** The rate a value implies: as stated, or admitted ÷ applicants when both counts are known. */
function effectiveRate(x: Pick<Extraction, "acceptance_rate" | "admitted" | "applicants">): number | null {
  if (x.acceptance_rate !== null) return x.acceptance_rate;
  if (x.admitted !== null && x.applicants !== null && x.applicants > 0) return x.admitted / x.applicants;
  return null;
}

/** "46,618" or "46618" → true for value 46618; tolerant of thousands separators. */
function countAppearsInQuote(value: number, quote: string): boolean {
  const normalized = quote.replace(/,/g, "");
  return normalized.includes(String(value));
}

/** "4.0%" or "4 percent" → true for the fraction 0.04 (tolerant of rounding to the quoted precision). */
function rateAppearsInQuote(value: number, quote: string): boolean {
  const pct = value * 100;
  const matches = quote.match(/(\d+(?:\.\d+)?)\s*(%|percent)/gi);
  if (!matches) return false;
  return matches.some((m) => {
    const num = parseFloat(m);
    return Number.isFinite(num) && Math.abs(num - pct) < 0.05;
  });
}

/** All seven checks, numbered as in the spec. `others` are extractions of the same college for the same run (check 7). */
export function runChecks(x: Extraction, school: School, others?: Extraction[]): CheckFailure[] {
  const failures: CheckFailure[] = [];

  // 1. Cohort is first-year and scope is all rounds (not early decision only).
  if (x.cohort !== "first-year" || x.scope !== "all-rounds") {
    failures.push(fail("cohort-and-scope", `cohort="${x.cohort}", scope="${x.scope}" (need first-year, all-rounds)`));
  }

  // 2. Every published number has a quote, and the number appears in the quote.
  const numberFields: { key: "applicants" | "admitted" | "enrolled" | "acceptance_rate"; isRate: boolean }[] = [
    { key: "applicants", isRate: false },
    { key: "admitted", isRate: false },
    { key: "enrolled", isRate: false },
    { key: "acceptance_rate", isRate: true },
  ];
  for (const { key, isRate } of numberFields) {
    const value = x[key];
    if (value === null) continue;
    const quote = x.quotes[key];
    if (!quote) {
      failures.push(fail("quote-present", `${key}=${value} has no quote`));
      continue;
    }
    const present = isRate ? rateAppearsInQuote(value, quote) : countAppearsInQuote(value, quote);
    if (!present) failures.push(fail("quote-present", `${key}=${value} doesn't appear in its quote "${quote}"`));
  }

  // 3. admitted ≤ applicants, enrolled ≤ admitted.
  if (x.admitted !== null && x.applicants !== null && x.admitted > x.applicants) {
    failures.push(fail("funnel-order", `admitted ${x.admitted} > applicants ${x.applicants}`));
  }
  if (x.enrolled !== null && x.admitted !== null && x.enrolled > x.admitted) {
    failures.push(fail("funnel-order", `enrolled ${x.enrolled} > admitted ${x.admitted}`));
  }

  // 4. Stated rate matches admitted ÷ applicants, when both are given, within the precision the college printed:
  //    "42%" allows 0.5 pt (Clemson states 42% for 42.43%), "4.0%" allows 0.1 pt, "4.18%" 0.05 pt. Otherwise nothing
  //    to check (the rate is computed instead, in toReportedEntry).
  if (x.acceptance_rate !== null && x.admitted !== null && x.applicants !== null && x.applicants > 0) {
    const computed = x.admitted / x.applicants;
    const diffPts = Math.abs(x.acceptance_rate - computed) * 100;
    const tolerance = rateTolerancePts(x.quotes.acceptance_rate);
    if (diffPts > tolerance) {
      failures.push(
        fail("rate-matches", `stated rate ${(x.acceptance_rate * 100).toFixed(2)}% vs admitted ÷ applicants ${(computed * 100).toFixed(2)}% (diff ${diffPts.toFixed(2)} pt, allowed ${tolerance} for a rate printed as "${quotedRate(x.quotes.acceptance_rate) ?? "?"}")`),
      );
    }
  }

  // 5. Entering term is newer than the college's federal admissions year. A null term fails.
  const year = fallYear(x.entering_term);
  if (year === null) {
    failures.push(fail("newer-than-federal", `entering_term "${x.entering_term}" isn't a recognizable "Fall YYYY"`));
  } else if (school.admissions.year !== null && year <= school.admissions.year) {
    failures.push(fail("newer-than-federal", `entering term ${year} isn't newer than the federal admissions year ${school.admissions.year}`));
  }

  // 6. Plausible change vs the latest federal year: applicants ×0.5–×2, admit rate ±15 pts (±50% relative under 10%).
  const federalApplicants = school.admissions.applicants;
  if (x.applicants !== null && federalApplicants !== null && federalApplicants > 0) {
    const ratio = x.applicants / federalApplicants;
    if (ratio < 0.5 || ratio > 2) {
      failures.push(fail("plausible-change", `applicants ${x.applicants} vs federal ${federalApplicants} (×${ratio.toFixed(2)}, need ×0.5–×2)`));
    }
  }
  const rate = effectiveRate(x);
  const federalRate = school.admissions.acceptance_rate;
  if (rate !== null && federalRate !== null) {
    const diffPts = Math.abs(rate - federalRate) * 100;
    const limit = federalRate < 0.1 ? federalRate * 0.5 * 100 : 15;
    if (diffPts > limit) {
      failures.push(
        fail("plausible-change", `acceptance rate ${(rate * 100).toFixed(2)}% vs federal ${(federalRate * 100).toFixed(2)}% (diff ${diffPts.toFixed(2)} pt, limit ${limit.toFixed(2)} pt)`),
      );
    }
  }

  // 7. Two sources for the same term agree within 1% on every number both have.
  for (const other of others ?? []) {
    if (other.entering_term !== x.entering_term) continue;
    for (const key of ["applicants", "admitted", "enrolled"] as const) {
      const a = x[key];
      const b = other[key];
      if (a === null || b === null) continue;
      const denom = Math.max(Math.abs(a), Math.abs(b), 1);
      const rel = Math.abs(a - b) / denom;
      if (rel > 0.01) failures.push(fail("sources-agree", `${key} ${a} vs other source's ${b} (${(rel * 100).toFixed(1)}% apart)`));
    }
    const ra = effectiveRate(x);
    const rb = effectiveRate(other);
    if (ra !== null && rb !== null) {
      const denom = Math.max(Math.abs(ra), Math.abs(rb), 0.0001);
      const rel = Math.abs(ra - rb) / denom;
      if (rel > 0.01) failures.push(fail("sources-agree", `acceptance_rate ${(ra * 100).toFixed(2)}% vs other source's ${(rb * 100).toFixed(2)}% (${(rel * 100).toFixed(1)}% apart)`));
    }
  }

  return failures;
}

/**
 * Builds the published entry for an extraction that passed every check. Throws if `entering_term` doesn't parse to
 * a fall year — callers only reach this after `runChecks` returned no failures, which already guards that.
 */
export function toReportedEntry(x: Extraction, school: School, src: { url: string; kind: ReportedSourceKind; retrieved: string; page?: number | null }, run: string): ReportedEntry {
  const year = fallYear(x.entering_term);
  if (year === null) throw new Error(`toReportedEntry: entering_term "${x.entering_term}" isn't a recognizable "Fall YYYY"`);

  const acceptance_rate = effectiveRate(x);
  const admissions: ReportedAdmissions = {
    entering_term: x.entering_term!,
    year,
    applicants: x.applicants,
    admitted: x.admitted,
    enrolled: x.enrolled,
    acceptance_rate,
    source_kind: src.kind,
  };

  const base = {
    source: "college-site" as const,
    method: "extracted" as const,
    year: x.entering_term!,
    url: src.url,
    retrieved: src.retrieved,
    ...(src.page != null ? { page: src.page } : {}),
  };

  // Any quote in hand, for the block's own metadata (entering_term, year, source_kind): they aren't individually
  // quoted numbers, but the lineage guard (lib/lineage.ts validateSchool) requires every registered reported.* path
  // to carry its own `extracted` record, so they cite the same document via whichever number's quote is available.
  const anyQuote = x.quotes.applicants ?? x.quotes.admitted ?? x.quotes.enrolled ?? x.quotes.acceptance_rate ?? x.entering_term!;

  const lineage: Partial<Record<ReportedValuePath, LineageRecord>> = {
    "reported.admissions.entering_term": { ...base, quote: anyQuote },
    "reported.admissions.year": { ...base, quote: anyQuote },
    "reported.admissions.source_kind": { ...base, quote: anyQuote },
  };
  if (x.applicants !== null) lineage["reported.admissions.applicants"] = { ...base, quote: x.quotes.applicants! };
  if (x.admitted !== null) lineage["reported.admissions.admitted"] = { ...base, quote: x.quotes.admitted! };
  if (x.enrolled !== null) lineage["reported.admissions.enrolled"] = { ...base, quote: x.quotes.enrolled! };
  if (acceptance_rate !== null) {
    const quote = x.acceptance_rate !== null ? x.quotes.acceptance_rate! : `${x.quotes.admitted} / ${x.quotes.applicants}`;
    lineage["reported.admissions.acceptance_rate"] = { ...base, quote };
  }

  return { unit_id: school.unit_id, admissions, lineage, run };
}

/** A published entry as `school.reported` + `school.lineage` patches, for the sync to merge in. */
export function reportedToPatch(entry: ReportedEntry): { reported: ReportedData; lineage: Partial<Record<FieldPath, LineageRecord>> } {
  return {
    reported: { admissions: entry.admissions },
    lineage: entry.lineage as Partial<Record<FieldPath, LineageRecord>>,
  };
}

/** The rate as the document printed it ("42%", "4.0 percent"), from its quote; null when the quote has none. */
export function quotedRate(quote: string | undefined): string | null {
  const m = /(\d+(?:\.\d+)?)\s*(%|percent)/i.exec(quote ?? "");
  return m ? `${m[1]}%` : null;
}

/** How far a stated rate may sit from the computed one, in points, given how many decimals the document printed. */
export function rateTolerancePts(quote: string | undefined): number {
  const printed = quotedRate(quote);
  if (!printed) return 0.1;
  const decimals = (printed.split(".")[1] ?? "").replace("%", "").length;
  return decimals === 0 ? 0.5 : decimals === 1 ? 0.1 : 0.05;
}
