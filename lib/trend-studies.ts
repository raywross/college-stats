/**
 * Study registry (specs/national-trends.md#shared-computation-and-tests): one entry per national trend study. The
 * build (scripts/trends/), the /trends index, each study page, the tests, and lineage all read it.
 *
 * Adding a study: add ONE entry to STUDIES (its slug is its route, /trends/{slug}, and its output file name,
 * data/history/trends/{slug}.json). `series` is typed against SeriesKey, so a study can't name a series history
 * doesn't store; `fields` must cover every series' registered field (tests/trends-foundation.test.mts checks).
 */
import type { FieldPath } from "./fields";
import type { SeriesKey, YearKind } from "./history";
import type { GroupingKey } from "./trend-groups";

export interface StudyDef {
  slug: string;
  /** "Study 1" in the hub. */
  number: number;
  title: string;
  /** The plain-language question the page answers. */
  question: string;
  /** History series the study reads (and cites). */
  series: readonly SeriesKey[];
  yearKind: YearKind;
  /** Years between "then" and "now" (the window ends at history's newest year of `yearKind`). */
  window: number;
  /** Groupings offered, the four standard ones first, then any extra the study needs. */
  groupings: readonly GroupingKey[];
  /** Who is in the panel, in a sentence for the method note. */
  panelRule: string;
  /** Registered fields behind the series (lib/fields.ts), for lineage. */
  fields: readonly FieldPath[];
  /** Date the study shipped as YYYYMMDD (a number: date strings trip the hard-coded-year guard); /trends lists the newest first. */
  added: number;
  /** Where Explore shows the colleges behind the pattern. */
  explore?: { href: string; label: string };
  /** The spec, for the method note's "How this was built". */
  spec: string;
  /** The study's domain color (a CSS variable from specs/design-system.md), for its card and headline series. */
  color: string;
}

export const STUDIES = [
  {
    slug: "men-and-women",
    number: 1,
    title: "Men and women in admissions",
    question: "Are colleges admitting men and women at different rates, and is that changing?",
    series: ["admit_rate_men", "admit_rate_women", "applicants"],
    yearKind: "fall",
    window: 20,
    groupings: ["region", "control", "size", "selectivity", "research"],
    panelRule: "Colleges reporting both men's and women's acceptance rates, with at least 1,000 applicants, in both years",
    fields: ["derived.admit_rate_men", "derived.admit_rate_women", "admissions.applicants"],
    added: 20261004,
    explore: { href: "/explore?sortBy=admit_gap", label: "Colleges by the gap between men's and women's acceptance rates" },
    spec: "specs/national-trends.md",
    color: "var(--d-admissions)",
  },
  // ↑ One entry per study. Studies 2–6 add theirs here (copy Study 1's shape).
] as const satisfies readonly StudyDef[];

export type StudySlug = (typeof STUDIES)[number]["slug"];

export function studyBySlug(slug: string): StudyDef | null {
  return (STUDIES as readonly StudyDef[]).find((s) => s.slug === slug) ?? null;
}

/** The study's window ends: `window` years back from history's newest year of its kind. */
export function studyWindow(study: Pick<StudyDef, "yearKind" | "window">, latest: Record<YearKind, number>): [number, number] {
  const to = latest[study.yearKind];
  return [to - study.window, to];
}
