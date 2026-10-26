/**
 * "This season on the Common App" (specs/data-expansion/common-app.md "National and state figures";
 * common-app-build/brief.md "U5"): national figures hand-typed from the key-findings text of Common App's own
 * End-of-Season reports, one row per season per measure, each with its report, page, and a verbatim quote. Pure:
 * the schema check (scripts/check-common-app-trends.mts, `npm run verify`) and the component
 * (components/trends/CommonAppSeason.tsx) both read through this module, never the JSON file directly.
 *
 * The file itself, data/trends/common-app.json, is reviewed by hand per release (like data/overrides.json), not
 * produced by a sync script: the reports' key findings are text, but the charts and appendix tables (state-level
 * figures) are images, so nothing here is parsed from a PDF.
 */
import type { AnyCited } from "../lineage";
import { gridVintage } from "./test-policy.ts";

/** The measures this reader understands. A row with any other measure fails validation. */
export const COMMON_APP_MEASURES = [
  "applicants",
  "applications",
  "applications_per_applicant",
  "members",
  "applicants_growth",
  "fee_waiver_eligible_growth",
  "first_generation_growth",
  /** Share of applicants who reported a test score: not stated as a share in either report's text (only growth
   * rates), so no row uses it yet. Kept in the vocabulary for a future release that states it outright. */
  "share_reporting_scores",
  /** Sibling the text does state outright ("5% of members require a test score to submit an application"): the
   * share of *members* requiring a score, not applicants reporting one. */
  "share_members_requiring_scores",
] as const;
export type CommonAppMeasure = (typeof COMMON_APP_MEASURES)[number];

/** A short label for each measure, used as the citation's `field` (the SourceTip's popover title). */
export const MEASURE_LABELS: Record<CommonAppMeasure, string> = {
  applicants: "First-year applicants",
  applications: "First-year applications",
  applications_per_applicant: "Applications per applicant",
  members: "Member institutions",
  applicants_growth: "Growth in applicants",
  fee_waiver_eligible_growth: "Growth in fee-waiver-eligible applicants",
  first_generation_growth: "Growth in first-generation applicants",
  share_reporting_scores: "Share of applicants reporting a test score",
  share_members_requiring_scores: "Share of members requiring a test score",
};

export type CommonAppUnit = "count" | "ratio" | "share" | "growth";

export interface CommonAppReport {
  /** Referenced by a row's `report`. */
  id: string;
  title: string;
  /** ISO date the report was published. */
  date: string;
  url: string;
  /** Total pages in the PDF. */
  pages: number;
}

export interface CommonAppTrendRow {
  /** "YYYY-YY". */
  season: string;
  measure: CommonAppMeasure;
  value: number;
  unit: CommonAppUnit;
  /** A `CommonAppReport.id`. */
  report: string;
  /** 1-based page of the PDF the quote is read from. */
  page: number;
  /** Verbatim text from the report containing the value. */
  quote: string;
}

export interface CommonAppTrendsFile {
  description: string;
  reports: CommonAppReport[];
  rows: CommonAppTrendRow[];
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** Every season the file has, oldest first ("YYYY-YY" sorts correctly as text). */
export function seasonsIn(file: CommonAppTrendsFile): string[] {
  return [...new Set(file.rows.map((r) => r.season))].sort();
}

/** The newest season the file has, or null when it has none. */
export function newestSeason(file: CommonAppTrendsFile): string | null {
  const seasons = seasonsIn(file);
  return seasons.length ? seasons[seasons.length - 1] : null;
}

/** One row, or undefined when the season/measure pair isn't in the file. */
export function rowFor(file: CommonAppTrendsFile, season: string, measure: CommonAppMeasure): CommonAppTrendRow | undefined {
  return file.rows.find((r) => r.season === season && r.measure === measure);
}

/** "Month D, YYYY" from an ISO date, for the citation's year label. */
function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * The `AnyCited`-shaped object a `SourceTip` needs for one row: source label "Common App", the report's title as
 * the document, its publication date as the year label, the row's page and quote, and a link to the Common App
 * homepage only (never the PDF itself; specs/data-expansion/common-app.md "Permission").
 */
export function citationFor(row: CommonAppTrendRow, file: CommonAppTrendsFile): AnyCited {
  const report = file.reports.find((r) => r.id === row.report);
  const year = report ? longDate(report.date) : null;
  return {
    key: "common-app" as const,
    label: "Common App",
    publisher: "Common App, Inc.",
    year,
    url: "https://www.commonapp.org",
    retrieved: year ?? "",
    path: `common-app-trends.${row.season}.${row.measure}`,
    field: MEASURE_LABELS[row.measure],
    method: "reported" as const,
    isDefault: true,
    quote: row.quote,
    page: row.page,
    document: report?.title,
  };
}

/**
 * The `AnyCited` a SourceTip needs for a figure read off the Requirements Grid itself (the test-optional study's
 * "this cycle" block, app/trends/test-optional/page.tsx): "Common App", the grid's cycle and stamp as the year label
 * (never typed), the homepage as the only link.
 */
export function gridCitation(edition: { cycle: string; updated: string }, field: string, label: string): AnyCited {
  return {
    key: "common-app" as const,
    label: "Common App",
    publisher: "Common App, Inc.",
    year: gridVintage(edition),
    url: "https://www.commonapp.org",
    retrieved: edition.updated,
    path: `common-app-grid.${field}`,
    field: label,
    method: "reported" as const,
    isDefault: true,
    document: `Requirements Grid, ${edition.cycle}`,
  };
}

/* ------------------------------------------------------------------ */
/* Validation (scripts/check-common-app-trends.mts, npm run verify)   */
/* ------------------------------------------------------------------ */

const SEASON_RE = /^\d{4}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isSeason(v: unknown): v is string {
  if (typeof v !== "string" || !SEASON_RE.test(v)) return false;
  const [a, b] = v.split("-").map(Number);
  return (a + 1) % 100 === b;
}

function isIsoDate(v: unknown): boolean {
  if (typeof v !== "string" || !ISO_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Whether `quote` contains `value`'s digits (commas stripped on both sides; a share/growth value as "N%"). */
function quoteHasValue(value: number, unit: CommonAppUnit, quote: string): boolean {
  if (unit === "ratio") return quote.includes(value.toFixed(2)) || quote.includes(String(value));
  if (unit === "growth" || unit === "share") return quote.includes(`${value}%`);
  // count
  return quote.replace(/,/g, "").includes(String(Math.trunc(value)));
}

/**
 * Every problem with the trends file; empty when it's valid (scripts/check-common-app-trends.mts). Checks: shape,
 * every report has an id/title/ISO date/commonapp.org url/page count ≥ 1, every row's measure is in the
 * vocabulary, its report id resolves, its page is ≥ 1 and at most the report's page count, its unit matches its
 * measure's kind, its quote contains the value's digits, its season is "YYYY-YY", and no season×measure pair
 * repeats.
 */
export function validateCommonAppTrends(raw: unknown): string[] {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") return ["the file must be an object"];
  const file = raw as Partial<CommonAppTrendsFile>;
  if (typeof file.description !== "string" || !file.description.trim()) problems.push("description is required");
  if (!Array.isArray(file.reports)) return [...problems, "reports must be an array"];
  if (!Array.isArray(file.rows)) return [...problems, "rows must be an array"];

  const reportIds = new Set<string>();
  for (const [i, r] of file.reports.entries()) {
    const where = `reports[${i}]`;
    if (!r || typeof r !== "object") {
      problems.push(`${where}: not an object`);
      continue;
    }
    if (typeof r.id !== "string" || !r.id.trim()) problems.push(`${where}: id is required`);
    else if (reportIds.has(r.id)) problems.push(`${where}: id "${r.id}" listed twice`);
    else reportIds.add(r.id);
    if (typeof r.title !== "string" || !r.title.trim()) problems.push(`${where}: title is required`);
    if (!isIsoDate(r.date)) problems.push(`${where}: date must be a real yyyy-mm-dd`);
    if (typeof r.url !== "string" || !/^https:\/\/(www\.)?commonapp\.org\//.test(r.url)) problems.push(`${where}: url must be a commonapp.org link`);
    if (typeof r.pages !== "number" || !Number.isInteger(r.pages) || r.pages < 1) problems.push(`${where}: pages must be an integer ≥ 1`);
  }

  const seen = new Set<string>();
  for (const [i, row] of file.rows.entries()) {
    const where = `rows[${i}]`;
    if (!row || typeof row !== "object") {
      problems.push(`${where}: not an object`);
      continue;
    }
    if (!isSeason(row.season)) problems.push(`${where}: season must be "YYYY-YY" with consecutive years`);
    if (!(COMMON_APP_MEASURES as readonly string[]).includes(row.measure)) problems.push(`${where}: measure "${String(row.measure)}" is not in the vocabulary`);
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) problems.push(`${where}: value must be a number`);
    if (!["count", "ratio", "share", "growth"].includes(row.unit)) problems.push(`${where}: unit "${String(row.unit)}" is not count/ratio/share/growth`);
    const report = file.reports.find((r) => r && typeof r === "object" && r.id === row.report);
    if (!report) problems.push(`${where}: report "${String(row.report)}" does not resolve`);
    if (typeof row.page !== "number" || !Number.isInteger(row.page) || row.page < 1) problems.push(`${where}: page must be an integer ≥ 1`);
    else if (report && typeof report.pages === "number" && row.page > report.pages) problems.push(`${where}: page ${row.page} is past the report's ${report.pages} pages`);
    if (typeof row.quote !== "string" || !row.quote.trim()) problems.push(`${where}: quote is required`);
    else if (typeof row.value === "number" && typeof row.unit === "string" && !quoteHasValue(row.value, row.unit as CommonAppUnit, row.quote)) {
      problems.push(`${where}: quote does not contain the value's digits`);
    }
    if (isSeason(row.season) && typeof row.measure === "string") {
      const key = `${row.season}|${row.measure}`;
      if (seen.has(key)) problems.push(`${where}: duplicate season×measure "${key}"`);
      else seen.add(key);
    }
  }
  return problems;
}
