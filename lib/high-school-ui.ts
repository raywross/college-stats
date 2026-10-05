/**
 * Pure display helpers for the high school pages (specs/product/high-school-data.md "Display"), kept separate from
 * lib/high-school-core.ts (the data-layer helpers every unit shares) so this unit's own formatting and wording can
 * change without touching the shared contract. No React, no Next.js: safe for tests and the page alike.
 */
import type { HighSchool, HighSchoolDetail } from "./high-school-types.ts";
import { pct, pctSmart } from "./format.ts";
import { STATES } from "./states.ts";

/** "California" for "CA"; the USPS code itself when it isn't one of the 50 states + DC (shouldn't happen for a high school row). */
export function hsStateName(usps: string): string {
  for (const s of STATES.values()) if (s.postal === usps) return s.name;
  return usps;
}

/**
 * Describe, don't grade (specs/product/high-school-data.md "Rules"): how a value sits next to the state median, in
 * neutral words — never "better"/"worse". `null` when either side is missing (nothing to compare).
 */
export type MedianComparison = "above" | "below" | "about-the-same" | null;

/** Within this fraction of the median counts as "about the same" (describing, not grading, means not over-reading noise). */
export const MEDIAN_SAME_BAND = 0.05;

export function compareToMedian(value: number | null, median: number | null): MedianComparison {
  if (value === null || median === null) return null;
  if (median === 0) return value === 0 ? "about-the-same" : "above";
  const diff = (value - median) / Math.abs(median);
  if (Math.abs(diff) <= MEDIAN_SAME_BAND) return "about-the-same";
  return diff > 0 ? "above" : "below";
}

/** "above the state median", "about the same as the state median", "below the state median". */
export function medianComparisonWords(cmp: MedianComparison): string | null {
  if (cmp === "above") return "above the state median";
  if (cmp === "below") return "below the state median";
  if (cmp === "about-the-same") return "about the same as the state median";
  return null;
}

/** "22 — above the state median (18)": a value, how it sits next to the median, and the median itself, one sentence. */
export function medianSentence(value: number | null, median: number | null, format: (n: number) => string): string | null {
  if (value === null) return null;
  const words = medianComparisonWords(compareToMedian(value, median));
  if (!words || median === null) return null;
  return `${format(value)} — ${words} (${format(median)})`;
}

/** A count suppressed for privacy ("fewer than 5"); a share suppressed by the source's own privacy rule. */
export function hsValueText(value: number | null, suppressed: boolean, format: (n: number) => string, kind: "count" | "share" = "share"): string {
  if (value !== null) return format(value);
  if (!suppressed) return "Not reported";
  return kind === "count" ? "Fewer than 5" : "Not reported (suppressed for privacy)";
}

/** An EDFacts-style range the source published instead of an exact rate: "90–94%" (never a midpoint; see parseRateRange). */
export function formatRateRange(low: number, high: number): string {
  return `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
}

/** A high school's graduation rate, however the source gave it: an exact share, a range, suppressed, or not reported. */
export function gradRateText(g: HighSchool["grad_rate"], suppressed = false): string {
  if (!g) return "Not reported";
  if (g.value !== null) return pctSmart(g.value);
  if (g.low !== null && g.high !== null) return formatRateRange(g.low, g.high);
  return suppressed ? "Fewer than 5 in the cohort" : "Not reported";
}

/** "9–12" style grade span already lives in lib/high-school-core.ts (gradeSpan); this is enrollment-count formatting. */
export function enrollmentText(total: number | null): string {
  return total === null ? "Not reported" : `${total.toLocaleString("en-US")} students`;
}

export interface HsTypeBadge {
  key: "charter" | "magnet" | "title_i" | "virtual";
  label: string;
}

/** Status badges a school's header shows, in a fixed order; only the ones that are true (null/false are skipped). */
export function hsTypeBadges(status: HighSchool["status"]): HsTypeBadge[] {
  const out: HsTypeBadge[] = [];
  if (status.charter) out.push({ key: "charter", label: "Charter" });
  if (status.magnet) out.push({ key: "magnet", label: "Magnet" });
  if (status.title_i) out.push({ key: "title_i", label: "Title I" });
  if (status.virtual) out.push({ key: "virtual", label: "Virtual" });
  return out;
}

/** "6 enrolled in 2023–2025 (school profile, 2025–26)": the quiet line on a college profile (specs "Display"). */
export function matriculationLine(count: number, classes: string, edition: string): string {
  return `${count} enrolled in ${classes} (school profile, ${edition})`;
}

/**
 * Total enrolled across every matriculation entry, with the line above (specs/product/high-school-data.md
 * "Display"): kept here, not in app/components, so reading the profile's own edition stays out of the UI-code
 * citation guard (tests/citation-guards.test.mts) — the ⓘ popover cites it separately via citeHsField.
 */
export function matriculationSummaryLine(detail: Pick<HighSchoolDetail, "matriculation" | "profile">): string | null {
  const m = detail.matriculation;
  if (!m) return null;
  const total = m.entries.reduce((a, e) => a + (e.count ?? 0), 0);
  return matriculationLine(total, m.classes, detail.profile.edition);
}

/** AP/IB/dual-enrollment shares formatted as a percent, or a share's suppression text when the inputs were suppressed. */
export function shareText(value: number | null, suppressed: boolean): string {
  return hsValueText(value, suppressed, pct, "share");
}

export { pct, pctSmart };
