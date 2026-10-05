/**
 * The compare pages (specs/compare-redesign.md): their keys, labels, colors, routes, and the metrics whose Key
 * differences open each topic page. lib/compare-topics.ts re-exports all of this and adds the "All the numbers" rows
 * and the fields each page cites; import from there. This file stays apart only so the client header
 * (components/compare/CompareHeader.tsx) can build its pills and links without bundling the table rows.
 *
 * Pure module (type-only imports besides profile-topics), so tests load it directly.
 */
import type { Domain, MetricKey } from "./metrics";
import { PROFILE_TOPICS, type TopicKey } from "./profile-topics.ts";

/** The profile's six topics plus the compare-only table. */
export type CompareTopicKey = TopicKey | "table";
/** Every compare route: the overview (`/compare`) and one per topic (`/compare/{key}`). */
export type ComparePage = "overview" | CompareTopicKey;

export interface CompareTopic {
  key: CompareTopicKey;
  /** Pill, card, and page-title text. */
  label: string;
  /** Eyebrow above the page title. */
  eyebrow: string;
  /** Color domain of the pill dot and eyebrow; null uses the site primary (history, table). */
  domain: Domain | null;
  /** One line for the overview's topic links and the page's metadata description. */
  description: string;
}

/** What each topic page holds when it compares colleges (the profile's descriptions are about one college). */
const DESCRIPTIONS: Record<TopicKey, string> = {
  admissions: "Acceptance and yield, test score ranges, test policy, and what each college weighs.",
  students: "Who's on each campus, how many get Pell Grants or are the first in their family, and campus life.",
  academics: "Students per faculty member, faculty, spending, popular majors, and your major side by side.",
  cost: "Average cost, aid generosity, net price by family income, sticker prices, and grants.",
  outcomes: "Earnings, graduation and retention, debt and loans, and graduation by group.",
  history: "Ten years of direction for each college, and then and now side by side.",
};

/** The six profile topics (same key, label, eyebrow, and domain, so the two maps match), then the table. */
export const COMPARE_TOPICS: readonly CompareTopic[] = [
  ...PROFILE_TOPICS.map((t) => ({ key: t.key, label: t.label, eyebrow: t.eyebrow, domain: t.domain, description: DESCRIPTIONS[t.key] })),
  { key: "table", label: "All the numbers", eyebrow: "All the numbers", domain: null, description: "Every figure for these colleges in one table, with differences highlighted." },
];

export const COMPARE_TOPIC_KEYS: readonly CompareTopicKey[] = COMPARE_TOPICS.map((t) => t.key);

export function isCompareTopic(key: string): key is CompareTopicKey {
  return (COMPARE_TOPIC_KEYS as readonly string[]).includes(key);
}

export function compareTopicOf(key: CompareTopicKey): CompareTopic {
  return COMPARE_TOPICS.find((t) => t.key === key)!;
}

/**
 * A compare URL, ids first and comma-joined: "/compare?ids=a,b" · "/compare/cost?ids=a,b" ·
 * "/compare/table?ids=a,b#cost" · "/compare/academics?ids=a,b&major=11". No ids gives the bare route ("/compare").
 */
export function compareHref(ids: readonly string[], page: ComparePage = "overview", opts: { query?: Record<string, string>; hash?: string } = {}): string {
  const params = [
    ...(ids.length ? [`ids=${ids.map(encodeURIComponent).join(",")}`] : []),
    ...Object.entries(opts.query ?? {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`),
  ];
  return `/compare${page === "overview" ? "" : `/${page}`}${params.length ? `?${params.join("&")}` : ""}${opts.hash ? `#${opts.hash}` : ""}`;
}

/** Previous/next among all seven topics in COMPARE_TOPICS order (the overview is "before" the first). */
export function adjacentCompareTopics(key: CompareTopicKey): { prev: CompareTopic | null; next: CompareTopic | null } {
  const i = COMPARE_TOPICS.findIndex((t) => t.key === key);
  return { prev: i > 0 ? COMPARE_TOPICS[i - 1] : null, next: i >= 0 && i < COMPARE_TOPICS.length - 1 ? COMPARE_TOPICS[i + 1] : null };
}

/**
 * The metrics whose Key differences sentences (lib/insights.ts#keyDifferences) open each topic page. Academics and Over
 * time have none: keyDifferences has no academics metric, and history compares directions, not values.
 */
export const TOPIC_DIFF_METRICS: Record<Exclude<CompareTopicKey, "table">, readonly MetricKey[]> = {
  admissions: ["acceptance", "yield", "sat"],
  students: ["enrollment", "pell", "firstGen", "diversity"],
  academics: [],
  cost: ["avgCost", "aidGenerosity"],
  outcomes: ["earnings", "gradRate"],
  history: [],
};
