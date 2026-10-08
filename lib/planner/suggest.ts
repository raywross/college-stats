/**
 * Stage 1's suggested category (specs/planner/list-building.md "Suggested category") and the sorts that read it
 * (list-building.md "Sorting"). Pure: a `PlanSchool` and the student's profile in, a category and a cited reason out.
 * `chances-and-fit.md` isn't built yet (specs/planner/README.md "Dependencies not built"), so the first rule in the
 * spec's table is skipped and the admit-rate/score rules below stand in; a `standing` seam can take over later
 * without changing this module's shape.
 *
 * Every reason that names a year takes it from the citation on the value it's about (`PlanSchool.admitRateCite`,
 * `.cites["derived.sat_total"]`, `.cites["admissions.act_composite_25_75"]`) — never a literal year in this file
 * (tests/citation-guards.test.mts scans for that).
 */
import type { Cited } from "../lineage";
import type { StudentProfileData } from "../student-profile";
import type { ListCategory } from "../list-rules";
import type { ListSort, PlanSchool } from "./types";

export type Suggestion = "reach" | "target" | "likely" | "none";

export interface SuggestResult {
  category: Suggestion;
  /** One line, e.g. "Admits fewer than 1 in 5 applicants (fall 2024)."; null for "none". */
  reason: string | null;
  /** The citation behind the reason (an InfoTip's `cited`), when the reason names a college value. */
  cite: Cited | null;
}

/** Below this admit rate, the rule suggests Reach regardless of the student's own numbers (list-building.md table row 2). */
export const REACH_ADMIT_RATE_MAX = 0.2;
/** At or above this admit rate, a score above the middle 50% suggests Likely rather than Target (table row 4). */
export const LIKELY_ADMIT_RATE_MIN = 0.5;

const SUGGESTION_LABELS: Record<Suggestion, string> = { reach: "Reach", target: "Target", likely: "Likely", none: "" };

export function suggestionLabel(s: Suggestion): string {
  return SUGGESTION_LABELS[s];
}

function yearOf(cite: unknown): string | null {
  return cite && typeof cite === "object" && "year" in (cite as object) ? ((cite as { year: string | null }).year ?? null) : null;
}

function fallYear(cite: unknown): string {
  const y = yearOf(cite);
  if (!y) return "";
  // Lineage years are usually labels already ("Fall 2024"); only a bare year gets the season word.
  return /^\d{4}$/.test(y) ? ` (fall ${y})` : ` (${y.charAt(0).toLowerCase()}${y.slice(1)})`;
}

interface ScoreCheck {
  which: "SAT" | "ACT";
  score: number;
  range: [number, number];
  cite: Cited | null;
}

/** The student's score(s) the college also reports a range for — SAT first when both apply (score-bands.ts shows SAT first too). */
function scoreChecks(school: PlanSchool, profile: StudentProfileData): ScoreCheck[] {
  const out: ScoreCheck[] = [];
  if (profile.tests.satTotal !== null && school.satRange) out.push({ which: "SAT", score: profile.tests.satTotal, range: school.satRange, cite: (school.cites["derived.sat_total"] as Cited | undefined) ?? null });
  if (profile.tests.actComposite !== null && school.actRange) out.push({ which: "ACT", score: profile.tests.actComposite, range: school.actRange, cite: (school.cites["admissions.act_composite_25_75"] as Cited | undefined) ?? null });
  return out;
}

type Position = "above" | "inside" | "below";

function positionOf(score: number, range: [number, number]): Position {
  if (score > range[1]) return "above";
  if (score < range[0]) return "below";
  return "inside";
}

/**
 * The suggested category for one college (list-building.md's rule table, minus the not-yet-built `chances-and-fit`
 * row), in order: a low admit rate suggests Reach; no reported admit rate suggests Likely (usually open admission,
 * same convention as `components/profile/AdmissionsCard.tsx`); a reported score range positions the student's SAT
 * or ACT within it; otherwise there's nothing to suggest from yet.
 */
export function suggestCategory(school: PlanSchool, profile: StudentProfileData | null): SuggestResult {
  if (school.admitRate !== null && school.admitRate < REACH_ADMIT_RATE_MAX) {
    return { category: "reach", reason: `Admits fewer than 1 in 5 applicants${fallYear(school.admitRateCite)}.`, cite: (school.admitRateCite as Cited | null) ?? null };
  }
  if (school.admitRate === null) {
    return { category: "likely", reason: "Admits everyone who applies.", cite: null };
  }
  if (profile) {
    const checks = scoreChecks(school, profile);
    if (checks.length > 0) {
      const check = checks[0];
      const position = positionOf(check.score, check.range);
      const range = `${check.range[0]}–${check.range[1]}${fallYear(check.cite)}`;
      if (position === "above") {
        const category: Suggestion = school.admitRate >= LIKELY_ADMIT_RATE_MIN ? "likely" : "target";
        return { category, reason: `Your ${check.which} ${check.score} is above this college's middle 50% (${range}).`, cite: check.cite };
      }
      if (position === "below") {
        return { category: "reach", reason: `Your ${check.which} ${check.score} is below this college's middle 50% (${range}).`, cite: check.cite };
      }
      return { category: "target", reason: `Your ${check.which} ${check.score} is within this college's middle 50% (${range}).`, cite: check.cite };
    }
  }
  return { category: "none", reason: "Add a score or GPA to see a suggestion.", cite: null };
}

/* ------------------------------------------------------------------ */
/* Sorting (list-building.md "Sorting")                                */
/* ------------------------------------------------------------------ */

/** What `sortItems` needs about one row; `BoardItem` (ListBoard) and `PlanItem` + `PlanSchool` both fit this. */
export interface SortableItem {
  id: string;
  category: ListCategory;
  position: number;
  dream?: boolean;
  priority?: number | null;
  admitRate: number | null;
  avgCost: number | null;
  distanceMiles: number | null;
  /** The next dated task's due date (yyyy-mm-dd), when there is one. */
  nextDate?: string | null;
  /** This row's suggested category (suggestCategory), for "Where I stand". */
  standing?: Suggestion | null;
}

const CATEGORY_RANK: Record<ListCategory, number> = { reach: 0, target: 1, likely: 2, unsorted: 3 };
const STANDING_RANK: Record<Suggestion, number> = { likely: 0, target: 1, reach: 2, none: 3 };

const num = (n: number | null | undefined): number => (n === null || n === undefined ? Infinity : n);
const rank = (n: number | null | undefined): number => (n === null || n === undefined ? Infinity : n);
const date = (d: string | null | undefined): number => (d ? Date.parse(d) : Infinity);
const byPosition = (a: SortableItem, b: SortableItem) => a.position - b.position;

/**
 * Orders a list's rows by the chosen sort (list-building.md "Sorting"); never hides a row, and a row missing the
 * sort's own field sorts to the end ("not reported"), ties broken by the student's own order. `lists.sort` is read
 * by the caller; "mine" (the default) is just the student's order.
 */
export function sortItems<T extends SortableItem>(items: T[], sort: ListSort): T[] {
  const out = [...items];
  switch (sort) {
    case "mine":
      return out.sort(byPosition);
    case "category":
      return out.sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || byPosition(a, b));
    case "dream_priority":
      return out.sort((a, b) => Number(Boolean(b.dream)) - Number(Boolean(a.dream)) || rank(a.priority) - rank(b.priority) || byPosition(a, b));
    case "next_date":
      return out.sort((a, b) => date(a.nextDate) - date(b.nextDate) || byPosition(a, b));
    case "admit_rate":
      return out.sort((a, b) => num(a.admitRate) - num(b.admitRate) || byPosition(a, b));
    case "avg_cost":
      return out.sort((a, b) => num(a.avgCost) - num(b.avgCost) || byPosition(a, b));
    case "distance":
      return out.sort((a, b) => num(a.distanceMiles) - num(b.distanceMiles) || byPosition(a, b));
    case "standing":
      return out.sort((a, b) => STANDING_RANK[a.standing ?? "none"] - STANDING_RANK[b.standing ?? "none"] || byPosition(a, b));
    default:
      return out.sort(byPosition);
  }
}

export interface SortOption {
  value: ListSort;
  label: string;
  /** What the option needs to make sense, shown as a hint when it's unavailable. */
  needs?: string;
}

/** Every sort, in menu order (list-building.md "Sorting" table). `SortMenu` filters to what the list has data for. */
export const SORT_OPTIONS: readonly SortOption[] = [
  { value: "mine", label: "My order" },
  { value: "category", label: "Category" },
  { value: "dream_priority", label: "Dream and priority" },
  { value: "next_date", label: "Next date" },
  { value: "admit_rate", label: "Admit rate" },
  { value: "avg_cost", label: "Average cost" },
  { value: "distance", label: "Distance", needs: "a home address" },
  { value: "standing", label: "Where I stand", needs: "your numbers" },
];

/* ------------------------------------------------------------------ */
/* The balance line, extended (list-building.md "The balance line, extended") */
/* ------------------------------------------------------------------ */

/**
 * Common App's reported average applications per applicant (specs/planner/README.md "Research"): a one-time
 * external research citation, not a dataset field, so it carries no edition here (tests/citation-guards.test.mts
 * forbids a literal data year in this file; the edition is in the spec's research note instead).
 */
export const COMMON_APP_AVERAGE_LIST_SIZE = 7;
/** Above this many colleges, the balance line notes it against Common App's average (list-building.md). */
export const LARGE_LIST_SIZE = 12;

export interface BalanceExtra {
  text: string;
  /** "fact" lines never read as a warning; this module only produces facts. */
  kind: "fact";
}

/**
 * The facts `balanceLine` (lib/list-rules.ts) doesn't say, each shown only when true (list-building.md "The balance
 * line, extended"): no Likely/Target/only Reach, the family's cost limit, and a large list against Common App's own
 * average. The "colleges don't match your preferences" and worst-plausible-spring lines wait on `chances-and-fit.md`
 * and the stress-test idea; this leaves their slot empty rather than guessing at them.
 */
export function extendedBalanceLines(
  items: Pick<SortableItem, "category" | "avgCost">[],
  opts: { maxAverageCost?: number | null } = {},
): BalanceExtra[] {
  const out: BalanceExtra[] = [];
  const counts = { reach: 0, target: 0, likely: 0, unsorted: 0 } as Record<ListCategory, number>;
  for (const i of items) counts[i.category]++;
  const placed = counts.reach + counts.target + counts.likely;
  if (placed > 0) {
    if (counts.likely === 0 && counts.target === 0) out.push({ text: "Only Reaches so far.", kind: "fact" });
    else if (counts.likely === 0) out.push({ text: "No Likely yet.", kind: "fact" });
    else if (counts.target === 0) out.push({ text: "No Target yet.", kind: "fact" });
  }
  if (opts.maxAverageCost != null) {
    const over = items.filter((i) => i.avgCost !== null && i.avgCost > opts.maxAverageCost!).length;
    if (over > 0) out.push({ text: `Average cost above your family's limit at ${over} ${over === 1 ? "college" : "colleges"}.`, kind: "fact" });
  }
  if (items.length > LARGE_LIST_SIZE) {
    out.push({ text: `${items.length} colleges: Common App's average is ${COMMON_APP_AVERAGE_LIST_SIZE}.`, kind: "fact" });
  }
  return out;
}
