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
  {
    slug: "shrinking-colleges",
    number: 2,
    title: "Shrinking colleges",
    question: "How many colleges are smaller than they were ten years ago, by how much, and which kinds grew instead?",
    series: ["undergrads", "applicants", "enrolled"],
    yearKind: "fall",
    window: 10,
    groupings: ["region", "control", "size", "selectivity", "setting", "research"],
    panelRule: "Colleges with 300 or more undergraduates in both the window's first and last fall",
    fields: ["demographics.undergrad_enrollment", "admissions.applicants", "admissions.enrolled"],
    added: 20261004,
    explore: { href: "/explore?sortBy=size_change", label: "Colleges by undergraduate change over 10 years" },
    spec: "specs/trends/shrinking-colleges.md",
    color: "var(--d-size)",
  },
  {
    slug: "price-gap",
    number: 3,
    title: "The price gap, by who is discounting",
    question: "Full price held roughly steady after inflation while what students paid fell. Where, and for whom?",
    series: ["full_price", "avg_paid_all", "aid_generosity", "grant_pct", "grant_avg", "net_price_income_1", "net_price_income_2", "net_price_income_3", "net_price_income_4", "net_price_income_5"],
    yearKind: "academic",
    window: 10,
    groupings: ["region", "control", "size", "selectivity", "setting", "research"],
    panelRule: "Colleges reporting both full price and average total cost in both years",
    fields: ["cost.breakdown", "cost.avg_paid_all", "derived.aid_generosity", "aid.grant_pct", "aid.grant_avg", "cost.net_price_by_income"],
    added: 20261004,
    explore: { href: "/explore?sortBy=avg_cost_change", label: "Colleges by the change in what students pay" },
    spec: "specs/trends/price-gap.md",
    color: "var(--d-value)",
  },
  {
    slug: "out-of-state",
    number: 4,
    title: "Public colleges and students from other states",
    question: "Are public colleges enrolling more first-years from other states, and which ones?",
    series: ["out_of_state_share", "international_share", "enrolled", "sticker_in_state", "sticker_out_of_state"],
    yearKind: "fall",
    window: 10,
    groupings: ["region", "control", "size", "selectivity", "research", "division"],
    panelRule: "Public colleges reporting the out-of-state share in both years, with 200+ enrolled first-years at the window's start",
    fields: ["demographics.residence", "admissions.enrolled", "cost.sticker", "detail.home_states"],
    added: 20261004,
    explore: { href: "/explore?sortBy=out_of_state", label: "Public colleges by out-of-state share" },
    spec: "specs/trends/out-of-state.md",
    color: "var(--d-diversity)",
  },
  {
    slug: "pell-gap",
    number: 5,
    title: "The Pell graduation gap",
    question: "Do students with Pell Grants graduate at the same rate as classmates who had neither a Pell Grant nor a subsidized loan, and has the gap changed?",
    series: ["grad_rate_pell", "grad_rate_no_pell_no_loan", "grad_cohort_pell", "grad_cohort_no_pell_no_loan", "grad_rate", "om_award_pell", "om_award_non_pell"],
    yearKind: "cohort",
    window: 8,
    groupings: ["region", "control", "size", "selectivity", "setting", "research", "division"],
    panelRule: "Colleges reporting both groups' graduation rates, with at least 50 students in both the Pell and \"neither\" groups, in both entering classes",
    fields: ["outcomes.grad_rate_pell", "outcomes.grad_rate_no_pell_no_loan", "outcomes.grad_cohorts", "outcomes.graduation_rate", "outcomes.eight_year"],
    added: 20261004,
    explore: { href: "/explore?sortBy=pell_gap", label: "Colleges by the Pell graduation gap" },
    spec: "specs/trends/pell-gap.md",
    color: "var(--d-access)",
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
