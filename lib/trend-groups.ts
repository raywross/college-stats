/**
 * The groupings national trend studies break colleges into (specs/national-trends.md#standard-breakdowns): one
 * function per grouping from a `School`, with labels, a fixed order, and the floor a group must clear before it gets a
 * value. Groups use today's classification (hub rule 3): a college that grew past 10,000 counts as 10,000+ throughout.
 *
 * Pure module (type-only imports from types.ts), so the build (scripts/trends/), pages, and tests all share it.
 */
import type { FieldPath } from "./fields";
import type { TermKey } from "./glossary";
import type { School } from "./types";
import { DESIGNATION_LABELS, RESEARCH_LABELS, SETTING_GROUPS, designationsOf } from "./campus-profile.ts";
import { conferenceName } from "./conferences.ts";
import { stateName } from "./states.ts";

/** At least this many colleges in a study's panel, or the group shows "too few colleges to say" (hub rule 4). */
export const GROUP_FLOOR = 30;
/** States are a fixed set readers expect to find; most have fewer than 30 colleges (specs/trends/states.md). */
export const STATE_FLOOR = 10;
/** Conference medians need 8 members (specs/trends/conferences.md). */
export const CONFERENCE_FLOOR = 8;

export type GroupingKey = "region" | "control" | "size" | "selectivity" | "setting" | "division" | "research" | "designation" | "state" | "conference";

/** The four every study offers, in this order (hub: standard breakdowns). */
export const STANDARD_GROUPINGS = ["region", "control", "size", "selectivity"] as const satisfies readonly GroupingKey[];

/* ------------------------------------------------------------------ */
/* One function per grouping: a college's group key(s), today          */
/* ------------------------------------------------------------------ */

/** "Northeast", "Southeast", "Midwest", "Southwest", "West", "Territories" (`location.region`). */
export const region = (s: School): string | null => s.location.region || null;

/** "public", "private-nonprofit", "private-forprofit". */
export const control = (s: School): string | null => s.type;

/** Undergraduates today: "small" under 2,000 · "medium" 2,000–9,999 · "large" 10,000+. */
export function size(s: School): string | null {
  const n = s.demographics.undergrad_enrollment;
  if (n === null || n === undefined) return null;
  return n < 2000 ? "small" : n < 10_000 ? "medium" : "large";
}

/** Today's acceptance rate: "most" under 25% · "more" 25–59% · "less" 60% or more. Null without a rate. */
export function selectivity(s: School): string | null {
  const r = s.admissions.acceptance_rate;
  if (r === null || r === undefined) return null;
  return r < 0.25 ? "most" : r < 0.6 ? "more" : "less";
}

/** NCES locale group: "city", "suburb", "town", "rural". */
export const setting = (s: School): string | null => s.campus?.setting?.group ?? null;

/** NCAA division ("I-FBS", "I-FCS", "I", "II", "III"), or "none" (NAIA or no NCAA membership). */
export const division = (s: School): string | null => s.campus?.athletics?.division ?? "none";

/** Carnegie 2025 research tier ("R1", "R2", "RCU"), or "other". */
export const research = (s: School): string | null => s.campus?.carnegie?.research ?? "other";

/** Designations (HBCU, HSI, land-grant, women's, …). A college can have several, or none. */
export const designation = (s: School): string[] => designationsOf(s);

/** USPS state code. */
export const state = (s: School): string | null => s.location.state || null;

/** Main athletic conference's IPEDS code, as a string. */
export const conference = (s: School): string | null => {
  const c = s.campus?.athletics?.conference;
  return c ? String(c.code) : null;
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export interface GroupDef {
  key: string;
  label: string;
}

export interface Grouping {
  key: GroupingKey;
  /** The switch's label ("Region", "Public or private"). */
  label: string;
  floor: number;
  /** Groups in display order; null for open-ended groupings (state, conference), ordered by label. */
  groups: readonly GroupDef[] | null;
  /** A college's group keys today (several for designation, none when unclassified). */
  of: (s: School) => string[];
  /** The stored field the grouping reads (for the method note's lineage). */
  field: FieldPath;
  term?: TermKey;
}

const one = (f: (s: School) => string | null) => (s: School) => {
  const k = f(s);
  return k === null ? [] : [k];
};

export const GROUPINGS: Record<GroupingKey, Grouping> = {
  region: {
    key: "region",
    label: "Region",
    floor: GROUP_FLOOR,
    groups: ["Northeast", "Southeast", "Midwest", "Southwest", "West", "Territories"].map((k) => ({ key: k, label: k })),
    of: one(region),
    field: "location.region",
  },
  control: {
    key: "control",
    label: "Public or private",
    floor: GROUP_FLOOR,
    groups: [
      { key: "public", label: "Public" },
      { key: "private-nonprofit", label: "Private nonprofit" },
      { key: "private-forprofit", label: "For-profit" },
    ],
    of: one(control),
    field: "type",
  },
  size: {
    key: "size",
    label: "Size",
    floor: GROUP_FLOOR,
    groups: [
      { key: "small", label: "Under 2,000 undergrads" },
      { key: "medium", label: "2,000–9,999" },
      { key: "large", label: "10,000+" },
    ],
    of: one(size),
    field: "demographics.undergrad_enrollment",
    term: "undergrad-enrollment",
  },
  selectivity: {
    key: "selectivity",
    label: "Selectivity",
    floor: GROUP_FLOOR,
    groups: [
      { key: "most", label: "Under 25% admitted" },
      { key: "more", label: "25–59% admitted" },
      { key: "less", label: "60% or more" },
    ],
    of: one(selectivity),
    field: "admissions.acceptance_rate",
    term: "acceptance-rate",
  },
  setting: {
    key: "setting",
    label: "Setting",
    floor: GROUP_FLOOR,
    groups: SETTING_GROUPS.map((g) => ({ key: g.key, label: g.label })),
    of: one(setting),
    field: "campus.setting",
  },
  division: {
    key: "division",
    label: "Athletic division",
    floor: GROUP_FLOOR,
    groups: [
      { key: "I-FBS", label: "D-I FBS" },
      { key: "I-FCS", label: "D-I FCS" },
      { key: "I", label: "D-I, no football" },
      { key: "II", label: "D-II" },
      { key: "III", label: "D-III" },
      { key: "none", label: "NAIA or none" },
    ],
    of: one(division),
    field: "campus.athletics",
    term: "ncaa-division",
  },
  research: {
    key: "research",
    label: "Research",
    floor: GROUP_FLOOR,
    groups: [
      { key: "R1", label: "R1 universities" },
      { key: "R2", label: "R2 universities" },
      { key: "RCU", label: RESEARCH_LABELS.RCU },
      { key: "other", label: "Other colleges" },
    ],
    of: one(research),
    field: "campus.carnegie",
  },
  designation: {
    key: "designation",
    label: "Designation",
    floor: GROUP_FLOOR,
    groups: (["hbcu", "hsi", "land_grant", "aanapisi", "pbi", "women", "men", "tribal", "annh", "nasnti"] as const).map((k) => ({ key: k, label: DESIGNATION_LABELS[k] })),
    of: designation,
    field: "campus.designations",
  },
  state: {
    key: "state",
    label: "State",
    floor: STATE_FLOOR,
    groups: null,
    of: one(state),
    field: "location.state",
  },
  conference: {
    key: "conference",
    label: "Athletic conference",
    floor: CONFERENCE_FLOOR,
    groups: null,
    of: one(conference),
    field: "campus.athletics",
    term: "athletic-conference",
  },
};

export const GROUPING_KEYS = Object.keys(GROUPINGS) as GroupingKey[];

/** A group's display label ("Under 2,000 undergrads", "Tennessee", "Southeastern Conference"). */
export function groupLabel(grouping: GroupingKey, key: string): string {
  const def = GROUPINGS[grouping].groups?.find((g) => g.key === key);
  if (def) return def.label;
  if (grouping === "state") return stateName(key);
  if (grouping === "conference") return conferenceName(Number(key)) ?? key;
  return key;
}

/**
 * Split colleges into a grouping's groups, in display order (open-ended groupings by label). Groups nobody falls in
 * are left out; colleges with no group (no acceptance rate, for selectivity) are left out of every group.
 */
export function splitBy<T>(items: readonly T[], grouping: GroupingKey, schoolOf: (item: T) => School): { key: string; label: string; items: T[] }[] {
  const g = GROUPINGS[grouping];
  const buckets = new Map<string, T[]>();
  for (const item of items) for (const k of g.of(schoolOf(item))) buckets.set(k, [...(buckets.get(k) ?? []), item]);
  const order = g.groups
    ? g.groups.map((d) => d.key).filter((k) => buckets.has(k))
    : [...buckets.keys()].sort((a, b) => groupLabel(grouping, a).localeCompare(groupLabel(grouping, b)) || a.localeCompare(b));
  return order.map((key) => ({ key, label: groupLabel(grouping, key), items: buckets.get(key)! }));
}
