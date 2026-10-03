/**
 * The newest admissions figures a college has published, federal or its own (specs/college-reported-round-2.md,
 * Decision 1): the admissions topic page, the overview admissions card, the admit-ratio headline, the takeaway, and
 * the yield ring all read from here instead of `school.admissions` directly, so the newest class a college has
 * published anywhere shows up everywhere its headline figures do.
 *
 * Pure (type-only imports), so `lib/metrics.ts`, `lib/dataset.ts`, `lib/compare.ts`, `lib/indicators.ts`, Explore,
 * Compare, Home, and the chart components must never import it (tests/reported-guards.test.mts) — those compare
 * colleges against one another and need every college on the same federal year.
 */
import type { FieldPath } from "./fields";
import type { School } from "./types";

export interface NewestFunnelPaths {
  applicants: FieldPath;
  admitted: FieldPath;
  enrolled: FieldPath;
  acceptance_rate: FieldPath;
}

/** A newer figure the college published that doesn't qualify as a full funnel (e.g. applicants only). */
export interface PartialAdmissions {
  applicants?: number;
  admitted?: number;
  enrolled?: number;
  acceptance_rate?: number;
  paths: Partial<NewestFunnelPaths>;
  /** Entering term as the college stated it, e.g. "Fall 2026". */
  term: string;
}

export interface NewestAdmissions {
  /** Which source supplies the funnel shown as the headline. */
  source: "reported" | "federal";
  /** The fall year the headline funnel describes; null when federal has none. */
  year: number | null;
  /** "Fall 2025", or null when `year` is null. */
  term: string | null;
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
  acceptance_rate: number | null;
  /** Enrolled ÷ admitted, from the same source as the funnel; null when either is missing or enrolled > admitted. */
  yield: number | null;
  /** Field paths to cite for each value above, all from the same source (the funnel never mixes sources). */
  paths: NewestFunnelPaths;
  /** A newer figure the college published that isn't a full funnel, shown as a line under the federal funnel. */
  partial: PartialAdmissions | null;
}

const FEDERAL_PATHS: NewestFunnelPaths = {
  applicants: "admissions.applicants",
  admitted: "admissions.admitted",
  enrolled: "admissions.enrolled",
  acceptance_rate: "admissions.acceptance_rate",
};

const REPORTED_PATHS: NewestFunnelPaths = {
  applicants: "reported.admissions.applicants",
  admitted: "reported.admissions.admitted",
  enrolled: "reported.admissions.enrolled",
  acceptance_rate: "reported.admissions.acceptance_rate",
};

const REPORTED_PARTIAL_PATHS: Record<keyof NewestFunnelPaths, FieldPath> = REPORTED_PATHS;

/** Enrolled ÷ admitted; null when nobody was admitted or enrolled exceeds admitted (reimplemented, see lib/derive.ts). */
function yieldOf(admitted: number | null, enrolled: number | null): number | null {
  if (!admitted || enrolled === null || enrolled > admitted) return null;
  return enrolled / admitted;
}

function federalOnly(school: Pick<School, "admissions">, partial: PartialAdmissions | null = null): NewestAdmissions {
  const fed = school.admissions;
  return {
    source: "federal",
    year: fed.year,
    term: fed.year !== null ? `Fall ${fed.year}` : null,
    applicants: fed.applicants,
    admitted: fed.admitted,
    enrolled: fed.enrolled,
    acceptance_rate: fed.acceptance_rate,
    yield: yieldOf(fed.admitted, fed.enrolled),
    paths: FEDERAL_PATHS,
    partial,
  };
}

/**
 * The newest class a college has published: its own reported funnel when it's newer than the federal year and has
 * either a full applicants/admitted count or a stated rate, otherwise the federal funnel. A reported value that's
 * newer but doesn't clear that bar (e.g. applicants only) rides along as `partial`, to show as a line under the
 * federal funnel rather than replacing it.
 */
export function newestAdmissions(school: Pick<School, "admissions" | "reported">): NewestAdmissions {
  const r = school.reported?.admissions;
  if (!r) return federalOnly(school);

  const fed = school.admissions;
  const isNewer = fed.year === null || r.year > fed.year;
  if (!isNewer) return federalOnly(school);

  const hasFunnel = r.applicants != null && r.admitted != null;
  const hasRate = r.acceptance_rate != null;
  if (hasFunnel || hasRate) {
    return {
      source: "reported",
      year: r.year,
      term: r.entering_term,
      applicants: r.applicants,
      admitted: r.admitted,
      enrolled: r.enrolled,
      acceptance_rate: r.acceptance_rate,
      yield: yieldOf(r.admitted, r.enrolled),
      paths: REPORTED_PATHS,
      partial: null,
    };
  }

  // Newer, but not enough for a funnel (e.g. applicants only): a line under the federal funnel, not the headline.
  const paths: Partial<NewestFunnelPaths> = {};
  const partial: PartialAdmissions = { term: r.entering_term, paths };
  if (r.applicants != null) {
    partial.applicants = r.applicants;
    paths.applicants = REPORTED_PARTIAL_PATHS.applicants;
  }
  if (r.admitted != null) {
    partial.admitted = r.admitted;
    paths.admitted = REPORTED_PARTIAL_PATHS.admitted;
  }
  if (r.enrolled != null) {
    partial.enrolled = r.enrolled;
    paths.enrolled = REPORTED_PARTIAL_PATHS.enrolled;
  }
  if (r.acceptance_rate != null) {
    partial.acceptance_rate = r.acceptance_rate;
    paths.acceptance_rate = REPORTED_PARTIAL_PATHS.acceptance_rate;
  }
  // Nothing at all to show (shouldn't happen for validated data, which requires at least one figure): plain federal.
  if (partial.applicants == null && partial.admitted == null && partial.enrolled == null && partial.acceptance_rate == null) {
    return federalOnly(school);
  }
  return federalOnly(school, partial);
}
