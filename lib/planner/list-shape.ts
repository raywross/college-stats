/**
 * The list's shape by season (specs/planner/next-steps/list-shape.md). The senior shape (12–15: 0–2 High reach,
 * 2–3 Reach, 5–8 Target, 2–3 Likely, 2–3 Safe) is also the junior-spring/summer target ("by August", gentle
 * wording); the junior long list (15–20, at least 3 Likely-or-Safe, no maxima) is its own, looser shape; freshmen
 * and sophomores have none. `shapeGaps` reads the counts in priority order and returns every gap that applies (not
 * just the first); the season generator (lib/planner/generators/season.ts) and `balanceLineFor`
 * (lib/planner/plan-view.ts) both read the same list and use only `[0]`, so the move and the notice never disagree.
 * Pure; no I/O.
 */
import { STANDING_LEVELS } from "../chances/levels.ts";
import type { EstimateResult, StandingLevel } from "../chances/types.ts";
import { MOVE_TEXT } from "./moves-catalog.ts";
import { addDays } from "./stage.ts";
import { roundDates } from "./rounds.ts";
import type { Season } from "./seasons.ts";
import { taskKey } from "./tasks.ts";
import type { Assignee, GeneratedTask, GeneratorInput, PlanItem, PlanSchool } from "./types.ts";

export type ShapeGapKind = "likely_min" | "affordable" | "target_min" | "reach_min" | "over_max" | "total_off";
export interface ShapeGap {
  kind: ShapeGapKind;
  /** The level the move's rail should search, when its action is `show_rail`; null for the informational gaps and
   * the parent's cost-check (which opens a calculator, not the rail). */
  level: StandingLevel | null;
  who: Assignee;
  line: string;
}

/**
 * A season's shape: the total range, each level's range where the season defines one (`levels` is empty or partial
 * for the junior long list, which only bounds the total and the combined Likely-or-Safe minimum — "no maxima on
 * the upper levels"), and `minLikelyOrSafe`: the combined Likely+Safe floor for gap #1 ("Below the Likely/Safe
 * minimum"). It's kept separate from `levels.likely`/`levels.safe` because the check is a combined count (the
 * senior shape's "at least two Likelies", README.md "Research"; the junior long list's own "at least 3"), not each
 * level's own range.
 */
export interface Shape {
  total: [number, number];
  levels: Partial<Record<StandingLevel, [number, number]>>;
  minLikelyOrSafe: number;
}

/** The owner's senior shape (2026-10-14): 12–15 total, 0–2 High reach, 2–3 Reach, 5–8 Target, 2–3 Likely, 2–3 Safe. */
const SENIOR_SHAPE: Shape = {
  total: [12, 15],
  levels: { high_reach: [0, 2], reach: [2, 3], target: [5, 8], likely: [2, 3], safe: [2, 3] },
  minLikelyOrSafe: 2,
};

/** The junior long list (seasons.md, list-shape.md): wider, no per-level maxima, a looser combined minimum. */
const LONG_LIST_SHAPE: Shape = {
  total: [15, 20],
  levels: {},
  minLikelyOrSafe: 3,
};

export const LIST_SHAPE: Partial<Record<Season, Shape>> = {
  junior_fall: LONG_LIST_SHAPE,
  junior_winter: LONG_LIST_SHAPE,
  // "The senior shape as the target to reach by August" (list-shape.md): same numbers, gentler dating and wording,
  // handled by shapeTasks/balanceLineFor reading the season, not by a different Shape.
  junior_spring: SENIOR_SHAPE,
  summer_before_senior: SENIOR_SHAPE,
  senior_fall: SENIOR_SHAPE,
  senior_winter: SENIOR_SHAPE,
  senior_spring: SENIOR_SHAPE,
};

/** Freshman, sophomore, and anything after senior spring have no shape (list-shape.md "By season"). */
export function shapeFor(season: Season): Shape | null {
  return LIST_SHAPE[season] ?? null;
}

const SENIOR_SEASONS: ReadonlySet<Season> = new Set(["senior_fall", "senior_winter", "senior_spring"]);
const LONG_LIST_SEASONS: ReadonlySet<Season> = new Set(["junior_fall", "junior_winter"]);
/** The gentler wording and no firm date (list-shape.md "By season": "by summer's end"). */
const GENTLE_SEASONS: ReadonlySet<Season> = new Set(["junior_spring", "summer_before_senior"]);

const LEVEL_WORD: Record<StandingLevel, { one: string; many: string }> = {
  high_reach: { one: "High reach", many: "High reaches" },
  reach: { one: "Reach", many: "Reaches" },
  target: { one: "Target", many: "Targets" },
  likely: { one: "Likely", many: "Likelies" },
  safe: { one: "Safe", many: "Safes" },
};

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * "Your list has 3 Reaches, 2 Targets, and no Likely yet." (list-shape.md "Gap moves"): High reach, Reach, and
 * Target are named only when there's at least one; Likely is always named, as a count or "no Likely yet", since
 * it's the one counselors check first. `hasDreamAtHighReach` adds "(including your Dream)" to the High reach count
 * (open question 2: yes, a Dream counts toward the High-reach maximum).
 */
export function countLine(counts: Record<StandingLevel, number>, hasDreamAtHighReach = false): string {
  const parts: string[] = [];
  if (counts.high_reach > 0) {
    const n = counts.high_reach;
    const base = `${n} ${n === 1 ? LEVEL_WORD.high_reach.one : LEVEL_WORD.high_reach.many}`;
    parts.push(hasDreamAtHighReach ? `${base} (including your Dream)` : base);
  }
  if (counts.reach > 0) parts.push(`${counts.reach} ${counts.reach === 1 ? LEVEL_WORD.reach.one : LEVEL_WORD.reach.many}`);
  if (counts.target > 0) parts.push(`${counts.target} ${counts.target === 1 ? LEVEL_WORD.target.one : LEVEL_WORD.target.many}`);
  parts.push(counts.likely > 0 ? `${counts.likely} ${counts.likely === 1 ? LEVEL_WORD.likely.one : LEVEL_WORD.likely.many}` : "no Likely yet");
  return `Your list has ${joinWithAnd(parts)}.`;
}

/**
 * The gaps that apply, in the spec's priority order (list-shape.md "Gap moves" 1–6): below the combined
 * Likely-or-Safe minimum; no affordable Likely or Safe (a parent move while the limit is unset, else a student
 * one); below the Target minimum; below the Reach minimum (seniors only); High reach over its maximum
 * (informational, "Review the list"); the total out of range with no level gap behind it (the fact line only). The
 * junior long list has no shape-driven total check at all — its own "20 is plenty" line is `balanceLineFor`'s, not
 * a move (open question 1). Every applicable gap is returned, in order; callers use only the first.
 */
export function shapeGaps(
  counts: Record<StandingLevel, number>,
  unsorted: number,
  season: Season,
  affordability: "ok" | "none" | "unknown",
  hasDreamAtHighReach = false,
): ShapeGap[] {
  const shape = shapeFor(season);
  if (!shape) return [];
  // An empty list (no colleges at all, sorted or not) has nothing to judge: no gap, no soft line, nothing (the
  // generic "add a college" moves cover it instead).
  if (STANDING_LEVELS.reduce((n, l) => n + counts[l], 0) + unsorted === 0) return [];
  const gaps: ShapeGap[] = [];
  const line = countLine(counts, hasDreamAtHighReach);

  if (counts.likely + counts.safe < shape.minLikelyOrSafe) {
    gaps.push({ kind: "likely_min", level: "likely", who: "student", line });
  }
  if (affordability === "unknown") {
    gaps.push({ kind: "affordable", level: null, who: "guardian", line });
  } else if (affordability === "none") {
    gaps.push({ kind: "affordable", level: "likely", who: "student", line });
  }
  const targetMin = shape.levels.target?.[0];
  if (targetMin !== undefined && counts.target < targetMin) {
    gaps.push({ kind: "target_min", level: "target", who: "student", line });
  }
  const reachMin = shape.levels.reach?.[0];
  if (SENIOR_SEASONS.has(season) && reachMin !== undefined && counts.reach < reachMin) {
    gaps.push({ kind: "reach_min", level: "reach", who: "student", line });
  }
  const highReachMax = shape.levels.high_reach?.[1];
  if (highReachMax !== undefined && counts.high_reach > highReachMax) {
    gaps.push({ kind: "over_max", level: "high_reach", who: "student", line: MOVE_TEXT["shape_gap:over_max"].why });
  }
  if (!LONG_LIST_SEASONS.has(season)) {
    const total = STANDING_LEVELS.reduce((n, l) => n + counts[l], 0) + unsorted;
    if (total < shape.total[0] || total > shape.total[1]) {
      gaps.push({ kind: "total_off", level: null, who: "student", line: MOVE_TEXT["shape_gap:total_off"].why });
    }
  }
  return gaps;
}

/** How much a family is paying for the colleges they'd get into (list-shape.md "The shape"): the plan's own
 * avg_paid_all figure (lib/planner/context.ts planSchoolFor), never a broader cost fallback — the same number the
 * list itself shows. */
function likelyOrSafeAffordable(
  items: readonly Pick<PlanItem, "unit_id">[],
  schools: Record<string, Pick<PlanSchool, "avgCost">>,
  estimates: Record<string, Pick<EstimateResult, "group">>,
  limit: number,
): boolean {
  return items.some((i) => {
    const group = estimates[i.unit_id]?.group;
    if (group !== "likely" && group !== "safe") return false;
    const cost = schools[i.unit_id]?.avgCost ?? null;
    return cost !== null && cost <= limit;
  });
}

/**
 * Affordability (list-shape.md "The shape"): "ok" when a Likely or Safe's average cost is within the profile's
 * `maxAverageCost`; "none" when the limit is set and no Likely or Safe fits; "unknown" with no limit set at all
 * (the parent's move, not the student's). `plan-view.ts` calls this for `balanceLineFor`, and the season generator
 * (lib/planner/generators/season.ts moveFacts) for the shape_gap/shape_cost move, so the two never disagree.
 */
export function affordabilityFor(
  items: readonly Pick<PlanItem, "unit_id">[],
  schools: Record<string, Pick<PlanSchool, "avgCost">>,
  profile: { preferences: { maxAverageCost: number | null } } | null,
  estimates: Record<string, Pick<EstimateResult, "group">>,
): "ok" | "none" | "unknown" {
  const limit = profile?.preferences.maxAverageCost ?? null;
  if (limit === null) return "unknown";
  return likelyOrSafeAffordable(items, schools, estimates, limit) ? "ok" : "none";
}

/** Whether any item marked `dream` sits at High reach (open question 2: the count line and the over_max gap both
 * say "including your Dream"). */
export function dreamAtHighReach(items: readonly Pick<PlanItem, "unit_id" | "dream">[], estimates: Record<string, Pick<EstimateResult, "group">>): boolean {
  return items.some((i) => i.dream && estimates[i.unit_id]?.group === "high_reach");
}

/**
 * The level with the thinnest list, against the senior shape's minimums (plan-v3-fix-cards, 2026-10-16; owner:
 * "Same as above for filling out your list, it should say 'add a few reach schools'."): the shortfall per level
 * (minimum minus the current count; High reach has no minimum and is never checked), the largest shortfall wins,
 * ties broken in the order Likely, Target, Reach, Safe. Null counts (no estimates yet) or no shortfall at all keeps
 * the built title (`moves-catalog.ts`'s `build_list`/`long_list` entries fall back to their static title).
 */
const LIST_GAP_TIE_ORDER: readonly StandingLevel[] = ["likely", "target", "reach", "safe"];

export function listGapTitle(counts: Record<StandingLevel, number> | null, shape: Shape): string | null {
  if (!counts) return null;
  let bestLevel: StandingLevel | null = null;
  let bestShortfall = 0;
  for (const level of LIST_GAP_TIE_ORDER) {
    const min = shape.levels[level]?.[0];
    if (min === undefined) continue;
    const shortfall = min - counts[level];
    if (shortfall > bestShortfall) {
      bestShortfall = shortfall;
      bestLevel = level;
    }
  }
  if (bestLevel === null) return null;
  const word = LEVEL_WORD[bestLevel].one;
  return bestShortfall >= 2 ? `Add a few ${word} schools` : `Add a ${word} school`;
}

function fillCount(text: string, n: number): string {
  return text.replace("{count}", String(n));
}

/** The unsorted move's title, filled with the count (list-shape.md "The shape"): shared by `shapeTasks` and
 * `balanceLineFor` (lib/planner/plan-view.ts) so the notice and the move agree while any rows are unsorted — the
 * one case `shapeGaps`'s own list doesn't cover, since unsorted rows aren't a level gap. */
export function unsortedLine(unsorted: number): string {
  return fillCount(MOVE_TEXT["shape_gap:unsorted"].title, unsorted);
}

/** The first listed college's net price calculator, else null (list-shape.md "Gap moves" 2, the parent move). */
function firstCalculatorHref(input: GeneratorInput): string | null {
  const open = input.items.filter((i) => !i.withdrawn_on).sort((a, b) => a.position - b.position);
  for (const i of open) {
    const href = input.schools[i.unit_id]?.links?.price_calculator;
    if (href) return href;
  }
  return null;
}

/** The earliest closing deadline still open among the listed colleges (list-shape.md "By season": senior fall
 * onward dates the move to this minus 30 days), with the field to cite. Null when nothing's dated yet. */
function earliestOpenDeadline(input: GeneratorInput): { iso: string; field: string } | null {
  let best: { iso: string; field: string } | null = null;
  for (const i of input.items) {
    if (i.withdrawn_on || i.status === "applied" || i.status === "decided") continue;
    const school = input.schools[i.unit_id];
    if (!school) continue;
    const dates = roundDates(school, i.round ?? "rd");
    if (!dates.closing) continue;
    if (!best || dates.closing.iso < best.iso) best = { iso: dates.closing.iso, field: dates.closing.field };
  }
  return best;
}

/** How many open, listed rows have no level yet (list-shape.md "The shape": "unsorted rows ... don't count toward
 * any level"): no estimate, or an estimate with no group. */
function unsortedCount(input: GeneratorInput): number {
  return input.items.filter((i) => !i.withdrawn_on && !input.estimates[i.unit_id]?.group).length;
}

/**
 * The one move the shape rules show at a time (list-shape.md "Gap moves"): the unsorted move first (nothing about
 * the shape can be judged with unsorted colleges on it), else the first gap — kind `shape_gap` for a student move,
 * `shape_cost` for the parent's affordability check — keyed `{list}:shape_gap:{kind}` either way (so a resolved gap
 * orphans cleanly and the next one takes its place on regeneration, build-plan.md "Keys"). Dated from senior fall
 * on (the earliest open deadline minus 30 days, citing that deadline's field); undated before, with gentler
 * ("by summer's end") wording in junior spring and the summer before senior year.
 */
export function shapeTasks(input: GeneratorInput, gaps: readonly ShapeGap[]): GeneratedTask[] {
  const unsorted = unsortedCount(input);
  const gentle = GENTLE_SEASONS.has(input.season);
  const dated = SENIOR_SEASONS.has(input.season);

  if (unsorted > 0) {
    const text = MOVE_TEXT["shape_gap:unsorted"];
    return [
      {
        key: taskKey(input.list.id, "shape_gap", "unsorted"),
        item_id: null,
        kind: "shape_gap",
        title: fillCount(text.title, unsorted),
        detail: text.why,
        due_on: null,
        window_start: null,
        window_end: null,
        assignee: "student",
        source: "season",
        source_field: null,
        source_edition: null,
        date_note: null,
        position: 0,
        season: input.season,
        action: { kind: "open_intake", step: 0 },
      },
    ];
  }

  if (gaps.length === 0) return [];
  const first = gaps[0];
  const isParentMove = first.kind === "affordable" && first.who === "guardian";
  const kind = isParentMove ? "shape_cost" : "shape_gap";
  const text = isParentMove ? MOVE_TEXT.shape_cost : MOVE_TEXT[`shape_gap:${first.kind}`];
  const title = gentle ? `${text.title} by summer's end` : text.title;
  // The parent's cost check is about affordability, not the list's counts, so it keeps its own fixed why
  // (MOVE_TEXT.shape_cost); every other gap's why is the count line (list-shape.md "Each gap move's why").
  const detail = isParentMove ? text.why : first.line;

  let action: GeneratedTask["action"] = null;
  if (first.kind === "over_max") action = { kind: "open_tab", tab: "colleges" };
  else if (isParentMove) {
    const href = firstCalculatorHref(input);
    action = href ? { kind: "href", href } : { kind: "open_tab", tab: "colleges" };
  } else if (first.level) {
    action = { kind: "show_rail", level: first.level, gap: first.kind };
  }

  const deadline = dated ? earliestOpenDeadline(input) : null;
  const dueOn = deadline ? addDays(deadline.iso, -30) : null;

  return [
    {
      key: taskKey(input.list.id, "shape_gap", first.kind),
      item_id: null,
      kind,
      title,
      detail,
      due_on: dueOn,
      window_start: null,
      window_end: null,
      assignee: first.who,
      source: "season",
      source_field: deadline ? deadline.field : null,
      source_edition: null,
      date_note: null,
      position: 0,
      season: input.season,
      action,
    },
  ];
}
