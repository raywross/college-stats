/**
 * Labels, formats, glossary terms, and colors for the conference pages' measures (specs/trends/conferences.md). Plain
 * module (no "use client"), so server pages and client charts both import it.
 */
import type { FormatKind } from "@/lib/format";
import type { TermKey } from "@/lib/glossary";
import { SERIES } from "@/lib/history";
import type { ConferenceGlanceKey, ConferenceMeasureKey } from "@/lib/trends";

export interface MeasureInfo {
  label: string;
  /** Short, for the segmented control. */
  short: string;
  format: FormatKind;
  term: TermKey;
  /** Domain color token for the conference's line and dots. */
  color: string;
  /** Whether the at-a-glance scale starts at zero and ends at 100% (shares). */
  share: boolean;
}

const COLORS: Record<ConferenceGlanceKey, string> = {
  applicants: "var(--d-admissions)",
  acceptance_rate: "var(--d-admissions)",
  undergrads: "var(--d-size)",
  avg_paid_all: "var(--d-value)",
  out_of_state_share: "var(--d-diversity)",
  grad_rate: "var(--d-value)",
  pell: "var(--d-access)",
};

const SHORT: Record<ConferenceMeasureKey, string> = {
  applicants: "Applicants",
  acceptance_rate: "Acceptance rate",
  undergrads: "Undergraduates",
  avg_paid_all: "Average cost",
  out_of_state_share: "Out-of-state",
};

export function measureInfo(key: ConferenceGlanceKey): MeasureInfo {
  if (key === "pell") return { label: "Pell Grant recipients", short: "Pell", format: "pct", term: "pell-grant", color: COLORS.pell, share: true };
  const s = SERIES[key];
  return {
    label: key === "avg_paid_all" ? "Average total cost" : s.label,
    short: key in SHORT ? SHORT[key as ConferenceMeasureKey] : s.short,
    format: s.format === "pctSmart" ? "pct" : s.format,
    term: s.term as TermKey,
    color: COLORS[key],
    share: s.unit === "share",
  };
}
