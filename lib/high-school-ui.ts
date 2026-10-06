/**
 * Pure display helpers for the high school pages (specs/product/high-school-data.md "Display"), kept separate from
 * lib/high-school-core.ts (the data-layer helpers every unit shares) so this unit's own formatting and wording can
 * change without touching the shared contract. No React, no Next.js: safe for tests and the page alike.
 */
import type { HighSchool, HighSchoolDetail, HsGradHistoryEntry } from "./high-school-types.ts";
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

/* ------------------------------------------------------------------ */
/* Graduation rate by class (grad_history)                             */
/* ------------------------------------------------------------------ */

/** One class on the graduation-rate trend. `kind` says how to draw it; a class missing from the files is a gap. */
export interface GradTrendPoint {
  /** 2021 for "Class of 2021". */
  year: number;
  label: string;
  kind: "exact" | "range" | "suppressed" | "missing";
  value: number | null;
  low: number | null;
  high: number | null;
  cohort: number | null;
}

const classNum = (label: string): number | null => {
  const m = /^Class of (\d{4})$/.exec(label);
  return m ? Number(m[1]) : null;
};

/**
 * Every class from the oldest to the newest in the history, one point each: classes the files skip come back as
 * `missing` so the chart leaves a gap there instead of joining across it.
 */
export function gradTrendPoints(history: readonly HsGradHistoryEntry[] | null | undefined): GradTrendPoint[] {
  const known = new Map<number, HsGradHistoryEntry>();
  for (const e of history ?? []) {
    const y = classNum(e.year);
    if (y !== null) known.set(y, e);
  }
  if (!known.size) return [];
  const years = [...known.keys()];
  const out: GradTrendPoint[] = [];
  for (let y = Math.min(...years); y <= Math.max(...years); y++) {
    const e = known.get(y);
    const label = `Class of ${y}`;
    if (!e) out.push({ year: y, label, kind: "missing", value: null, low: null, high: null, cohort: null });
    else {
      const kind = e.suppressed ? "suppressed" : e.value !== null ? "exact" : e.low !== null && e.high !== null ? "range" : "missing";
      out.push({ year: y, label, kind, value: e.value, low: e.low, high: e.high, cohort: e.cohort });
    }
  }
  return out;
}

/** A trend is drawn only when at least two classes have a rate (exact or a range); otherwise the stat stands alone. */
export function hasGradTrend(history: readonly HsGradHistoryEntry[] | null | undefined): boolean {
  return gradTrendPoints(history).filter((p) => p.kind === "exact" || p.kind === "range").length >= 2;
}

/** A class's rate in words: "93%", "between 80% and 84%", "90% or higher", "10% or lower". */
export function gradPointWords(p: Pick<GradTrendPoint, "kind" | "value" | "low" | "high">): string {
  if (p.kind === "exact" && p.value !== null) return pctSmart(p.value);
  if (p.kind === "range" && p.low !== null && p.high !== null) {
    if (p.high >= 1) return `${Math.round(p.low * 100)}% or higher`;
    if (p.low <= 0) return `${Math.round(p.high * 100)}% or lower`;
    return `between ${Math.round(p.low * 100)}% and ${Math.round(p.high * 100)}%`;
  }
  if (p.kind === "suppressed") return "suppressed for privacy";
  return "not reported";
}

/** A class's rate as a short mark label: "93%", "80–84%", "≥90%", "≤10%". */
export function gradPointShort(p: Pick<GradTrendPoint, "kind" | "value" | "low" | "high">): string {
  if (p.kind === "exact" && p.value !== null) return pctSmart(p.value);
  if (p.kind === "range" && p.low !== null && p.high !== null) {
    if (p.high >= 1) return `≥${Math.round(p.low * 100)}%`;
    if (p.low <= 0) return `≤${Math.round(p.high * 100)}%`;
    return formatRateRange(p.low, p.high);
  }
  return p.kind === "suppressed" ? "Suppressed" : "—";
}

const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * The trend in one or two sentences, for screen readers and the caption: "From 86% (Class of 2019) to between 90% and
 * 94% (Class of 2023). Suppressed for privacy: Class of 2020. Not reported: Class of 2021." Null without a trend.
 */
export function gradTrendSummary(history: readonly HsGradHistoryEntry[] | null | undefined): string | null {
  if (!hasGradTrend(history)) return null;
  const pts = gradTrendPoints(history);
  const rated = pts.filter((p) => p.kind === "exact" || p.kind === "range");
  const first = rated[0];
  const last = rated[rated.length - 1];
  const parts = [`From ${gradPointWords(first)} (${first.label}) to ${gradPointWords(last)} (${last.label}).`];
  const sup = pts.filter((p) => p.kind === "suppressed").map((p) => p.label);
  const miss = pts.filter((p) => p.kind === "missing").map((p) => p.label);
  if (sup.length) parts.push(`Suppressed for privacy: ${joinWords(sup)}.`);
  if (miss.length) parts.push(`Not reported: ${joinWords(miss)}.`);
  return parts.join(" ");
}

/**
 * The y-range for the trend: from the nearest 10% at or below the lowest bound shown (never above 50%, so a typical
 * school isn't flattened against the top) up to 100%, the most any rate or open range can reach.
 */
export function gradTrendDomain(points: readonly GradTrendPoint[]): [number, number] {
  const lows = points.flatMap((p) => (p.kind === "exact" ? [p.value!] : p.kind === "range" ? [p.low!] : []));
  if (!lows.length) return [0.5, 1];
  const lo = Math.floor(Math.min(...lows) * 10 + 1e-9) / 10;
  return [Math.min(0.5, Math.max(0, lo)), 1];
}

/**
 * The school's grading scale in words. `kind` is the base scale; `weighted` means the school also reports a weighted
 * GPA (honors/AP points), so a 4.0 base with honors points reads "4.0 scale, weighted GPA reported".
 */
export function gpaScaleLabel(scale: NonNullable<HighSchoolDetail["gpa_scale"]>): string {
  const base =
    scale.kind === "100-point" ? "100-point scale"
    : scale.kind === "unweighted-4" ? "4.0 scale"
    : scale.kind === "weighted-5" ? "5.0 weighted scale"
    : scale.max ? `${scale.max % 1 === 0 ? scale.max.toFixed(1) : scale.max} scale`
    : "School's own scale";
  return scale.weighted && scale.kind !== "weighted-5" ? `${base}, weighted GPA reported` : base;
}

/**
 * The profile's test scores as a label and value: means when the school prints means ("Mean SAT and ACT",
 * "SAT 1298 · ACT 31", with the sections underneath), middle-50% ranges otherwise. Null when it prints neither.
 */
export function scoresDisplay(scores: HighSchoolDetail["scores"]): { label: string; value: string; sub: string | null } | null {
  if (!scores) return null;
  const parts: string[] = [];
  const subs: string[] = [];
  const mean = !!(scores.sat_mean || (scores.act_mean !== null && scores.act_mean !== undefined));
  if (scores.sat_mean) {
    parts.push(`SAT ${scores.sat_mean.erw + scores.sat_mean.math}`);
    subs.push(`Reading and writing ${scores.sat_mean.erw}, math ${scores.sat_mean.math}`);
  } else if (scores.sat_mid50) parts.push(`SAT ${scores.sat_mid50[0]}–${scores.sat_mid50[1]}`);
  if (scores.act_mean !== null && scores.act_mean !== undefined) parts.push(`ACT ${scores.act_mean}`);
  else if (scores.act_mid50) parts.push(`ACT ${scores.act_mid50[0]}–${scores.act_mid50[1]}`);
  if (!parts.length) return null;
  return { label: mean ? "Mean SAT and ACT" : "SAT and ACT, middle 50%", value: parts.join(" · "), sub: subs.length ? subs.join("; ") : null };
}

/** "141 of 144 link to their college pages" style summary for the admitted list. */
export function admittedSummary(admitted: NonNullable<HighSchoolDetail["admitted"]>): string {
  const n = admitted.entries.length;
  return `${n.toLocaleString("en-US")} ${n === 1 ? "college" : "colleges"} admitted at least one member of the ${admitted.classes.replace(/^Class/, "class")}. This is where students were admitted, not where they enrolled.`;
}

export { pct, pctSmart };
