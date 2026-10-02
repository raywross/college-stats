/**
 * STAND-IN for lib/reported-checks.ts, which another branch (feature/college-reported-checks) is writing with the
 * same two signatures. Implements the spec's 7 checks well enough for the pipeline and its tests. When that module
 * lands, scripts/lib/college-reported/checks.mts re-exports it instead and this file is deleted.
 */
import { fallYear, type CheckFailure, type Extraction, type ReportedEntry, type ReportedValuePath } from "../../../lib/reported.ts";
import type { LineageRecord, ReportedSourceKind, School } from "../../../lib/types";

const COUNTS = ["applicants", "admitted", "enrolled"] as const;

/** Every number written in `quote` (commas and spaces in thousands removed). */
function numbersIn(quote: string): number[] {
  return [...quote.replace(/(\d)[,  ](?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

function quoteHasCount(quote: string | undefined, n: number): boolean {
  return !!quote && numbersIn(quote).includes(n);
}

/** A rate quote holds the rate as a percent (4.0 or 4) or a fraction (0.04), to the precision written. */
function quoteHasRate(quote: string | undefined, rate: number): boolean {
  if (!quote) return false;
  return numbersIn(quote).some((v) => Math.abs(v - rate * 100) < 0.051 || Math.abs(v - rate) < 0.00051);
}

const rateOf = (e: Extraction): number | null =>
  e.acceptance_rate ?? (e.applicants && e.admitted !== null ? e.admitted / e.applicants : null);

export function runChecks(extraction: Extraction, school: School, others: Extraction[]): CheckFailure[] {
  const f: CheckFailure[] = [];
  const e = extraction;
  if (e.cohort !== "first-year" || e.scope !== "all-rounds") {
    f.push({ check: "cohort-and-scope", detail: `cohort ${e.cohort}, scope ${e.scope}; need first-year, all rounds` });
  }
  for (const k of COUNTS) {
    const v = e[k];
    if (v !== null && !quoteHasCount(e.quotes[k], v)) f.push({ check: "quote-present", detail: `${k} ${v} has no quote containing it` });
  }
  if (e.acceptance_rate !== null && !quoteHasRate(e.quotes.acceptance_rate, e.acceptance_rate)) {
    f.push({ check: "quote-present", detail: `acceptance rate ${e.acceptance_rate} has no quote containing it` });
  }
  if (e.applicants !== null && e.admitted !== null && e.admitted > e.applicants) {
    f.push({ check: "funnel-order", detail: `admitted ${e.admitted} > applicants ${e.applicants}` });
  }
  if (e.admitted !== null && e.enrolled !== null && e.enrolled > e.admitted) {
    f.push({ check: "funnel-order", detail: `enrolled ${e.enrolled} > admitted ${e.admitted}` });
  }
  if (e.acceptance_rate !== null && e.applicants && e.admitted !== null && Math.abs(e.acceptance_rate - e.admitted / e.applicants) > 0.001) {
    f.push({ check: "rate-matches", detail: `stated ${e.acceptance_rate} vs computed ${(e.admitted / e.applicants).toFixed(4)}` });
  }
  const year = fallYear(e.entering_term);
  const federal = school.admissions.year;
  if (year === null || (federal !== null && year <= federal)) {
    f.push({ check: "newer-than-federal", detail: `entering term ${e.entering_term ?? "unknown"} vs federal fall ${federal}` });
  }
  const fa = school.admissions.applicants;
  if (e.applicants !== null && fa) {
    const ratio = e.applicants / fa;
    if (ratio < 0.5 || ratio > 2) f.push({ check: "plausible-change", detail: `applicants ${e.applicants} vs federal ${fa} (×${ratio.toFixed(2)})` });
  }
  const r = rateOf(e);
  const fr = school.admissions.acceptance_rate;
  if (r !== null && fr !== null) {
    const ok = fr < 0.1 ? Math.abs(r - fr) / fr <= 0.5 : Math.abs(r - fr) <= 0.15;
    if (!ok) f.push({ check: "plausible-change", detail: `admit rate ${(r * 100).toFixed(1)}% vs federal ${(fr * 100).toFixed(1)}%` });
  }
  for (const o of others) {
    if (o === e || o.entering_term !== e.entering_term) continue;
    for (const k of COUNTS) {
      const a = e[k];
      const b = o[k];
      if (a !== null && b !== null && Math.abs(a - b) / Math.max(a, b) > 0.01) {
        f.push({ check: "sources-agree", detail: `${k}: ${a} here vs ${b} in another document for ${e.entering_term}` });
      }
    }
  }
  return f;
}

export function toReportedEntry(
  extraction: Extraction,
  school: School,
  source: { url: string; kind: ReportedSourceKind; retrieved: string; page?: number | null },
  run: string
): ReportedEntry {
  const e = extraction;
  const term = e.entering_term!;
  const computed = e.acceptance_rate === null && e.applicants && e.admitted !== null;
  const rate = e.acceptance_rate ?? (computed ? Math.round((e.admitted! / e.applicants!) * 1e4) / 1e4 : null);
  const page = source.page ?? e.page ?? undefined;
  const rec = (quote: string): LineageRecord => ({
    source: "college-site",
    method: "extracted",
    year: term,
    url: source.url,
    retrieved: source.retrieved,
    quote,
    ...(page ? { page } : {}),
  });
  const lineage: ReportedEntry["lineage"] = {};
  for (const k of COUNTS) if (e[k] !== null) lineage[`reported.admissions.${k}` as ReportedValuePath] = rec(e.quotes[k]!);
  if (rate !== null) {
    lineage["reported.admissions.acceptance_rate"] = rec(e.quotes.acceptance_rate ?? `Computed: admitted ÷ applicants (${e.quotes.admitted} / ${e.quotes.applicants})`);
  }
  return {
    unit_id: school.unit_id,
    admissions: {
      entering_term: term,
      year: fallYear(term)!,
      applicants: e.applicants,
      admitted: e.admitted,
      enrolled: e.enrolled,
      acceptance_rate: rate,
      source_kind: source.kind,
    },
    lineage,
    run,
  };
}
