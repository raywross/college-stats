/**
 * The `season` generator (specs/planner/next-steps/seasons.md "Moves"; build-plan.md "Applies vocabulary"): the
 * playbook's own entries (lib/planner/moves-catalog.ts) for this season and the next, earlier seasons' entries that
 * carry and still apply, then the rule modules' moves (ED, interest, the list's shape). Registered last in
 * generators/index.ts, so a built generator's key always wins.
 *
 * - Keys `{list}:playbook:{entry.key}`; kind `playbook` (or the entry's own kind); source `season`; `season` set;
 *   `action` from the entry. A dated entry's window comes from its season's bounds (seasonBounds).
 * - What a late joiner sees: only this season's and next season's entries, plus earlier ones with `carries: true`
 *   that still apply. Nothing dated before `today − 30 days` (the built staleness rule, generators/cycle.ts), so
 *   nothing is overdue from before the person joined.
 * - An entry with `builtBy` is skipped when the student's cycle has that cycle-file entry inside its window (the
 *   built task is the move); an entry with `replaces` hides the earlier entry it names.
 * - A plan with no class year gets the `unknown` season's one move. Student lists only. Never ticks a move.
 * Pure; no I/O.
 */
import type { EstimateResult, StandingLevel } from "../../chances/types.ts";
import { edMoves, edOpportunities, type EdCandidate } from "../ed-opportunities.ts";
import { interestMoves, interestTasks, type InterestMove } from "../interest.ts";
import { hooksFromPlan } from "../hooks.ts";
import { affordabilityFor, dreamAtHighReach, shapeGaps, shapeTasks, type ShapeGap } from "../list-shape.ts";
import { PLAYBOOK, type PlaybookEntry } from "../moves-catalog.ts";
import { firstMissingSection, PROFILE_SECTIONS, sectionDone, type ProfileSection } from "../profile-progress.ts";
import { nextSeason, seasonBounds, seasonRank, type Season } from "../seasons.ts";
import { addDays } from "../stage.ts";
import { taskKey } from "../tasks.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool, PlanVisit } from "../types.ts";
import { recommendersAsked, storyMissing, type StudentProfileData } from "../../student-profile.ts";
import { STALE_DAYS } from "./cycle.ts";

export type MoveApplies =
  | "always"
  | "has_dream"
  | "no_dream"
  | "list_empty"
  | "list_nonempty"
  | `profile_missing:${ProfileSection}`
  | "story_missing"
  | "no_visit_logged"
  | "tests_focus_null"
  | "ed_candidate"
  | "interest_candidate"
  | "shape_gap"
  | "cost_limit_unset"
  // Additions beyond the brief (U1): any profile section missing; a chosen test with no date picked yet.
  | "profile_incomplete"
  | "test_unplanned"
  // Plan v3 (build-plan.md "Catalog and applies"): no real SAT/ACT score yet; a score below the student's own target;
  // fewer than two recommenders asked.
  | "no_real_score"
  | "below_target"
  | "recommenders_open";

export const MOVE_APPLIES: readonly MoveApplies[] = [
  "always",
  "has_dream",
  "no_dream",
  "list_empty",
  "list_nonempty",
  ...PROFILE_SECTIONS.map((s) => `profile_missing:${s}` as const),
  "story_missing",
  "no_visit_logged",
  "tests_focus_null",
  "ed_candidate",
  "interest_candidate",
  "shape_gap",
  "cost_limit_unset",
  "profile_incomplete",
  "test_unplanned",
  "no_real_score",
  "below_target",
  "recommenders_open",
];

/** What `moveApplies` reads, built once per regeneration. */
export interface MoveFacts {
  /** The list's open rows (withdrawn ones left out). */
  items: readonly PlanItem[];
  schools: Record<string, PlanSchool>;
  profile: StudentProfileData | null;
  visits: readonly PlanVisit[];
  estimates: Record<string, EstimateResult>;
  edCandidates: EdCandidate[];
  shapeGaps: ShapeGap[];
  interest: InterestMove[];
  /** The list's counts by level (`levelCounts`), null while nothing has an estimate yet (plan-v3-fix-cards,
   *  `build_list`/`long_list`'s `titleFor`). */
  counts: Record<StandingLevel, number> | null;
}

/** Whether a move's condition holds. Missing facts lean toward showing the move (a family can dismiss it). */
export function moveApplies(a: MoveApplies, facts: MoveFacts): boolean {
  const p = facts.profile;
  if (a.startsWith("profile_missing:")) {
    const section = a.slice("profile_missing:".length) as ProfileSection;
    return !p || !sectionDone(p, section);
  }
  switch (a) {
    case "always":
      return true;
    case "has_dream":
      return facts.items.some((i) => i.dream);
    case "no_dream":
      return !facts.items.some((i) => i.dream);
    case "list_empty":
      return facts.items.length === 0;
    case "list_nonempty":
      return facts.items.length > 0;
    case "profile_incomplete":
      return firstMissingSection(p) !== null;
    case "story_missing":
      // guides/your-story.md: the narrative under STORY_DONE_CHARS characters.
      return storyMissing(p);
    case "no_visit_logged":
      return !facts.items.some((i) => i.visited_on !== null) && facts.visits.length === 0;
    case "tests_focus_null":
      return (p?.tests.focus ?? null) === null;
    case "test_unplanned":
      return p !== null && (p.tests.focus === "sat" || p.tests.focus === "act") && !p.tests.plansTestOptional && p.tests.plannedDates.length === 0;
    case "ed_candidate":
      return facts.edCandidates.length > 0;
    case "interest_candidate":
      return facts.interest.length > 0;
    case "shape_gap":
      return facts.shapeGaps.length > 0;
    case "cost_limit_unset":
      return (p?.preferences.maxAverageCost ?? null) === null;
    case "no_real_score":
      // now.md "Timing rules": an SAT total or ACT composite that isn't marked practice is a real score.
      return !(p && (p.tests.satTotal !== null || p.tests.actComposite !== null) && !p.tests.practice);
    case "below_target":
      return belowTarget(p);
    case "recommenders_open":
      return recommendersAsked(p) < 2;
  }
  return false;
}

/**
 * The `below_target` rule: the focus test is the SAT or ACT, its score is set (practice or real), the student has a
 * target, and the score is below it.
 */
export function belowTarget(p: Pick<StudentProfileData, "tests"> | null): boolean {
  if (!p || p.tests.target === null) return false;
  const score = p.tests.focus === "sat" ? p.tests.satTotal : p.tests.focus === "act" ? p.tests.actComposite : null;
  return score !== null && score < p.tests.target;
}

/**
 * An entry's title with its placeholders filled (`{target}` from the profile's target), or null when one can't be
 * filled: a title with an unfilled placeholder is never emitted (build-plan.md "Catalog and applies").
 */
export function fillTitle(title: string, profile: Pick<StudentProfileData, "tests"> | null): string | null {
  const target = profile?.tests.target ?? null;
  const filled = target === null ? title : title.replaceAll("{target}", String(target));
  return /\{[a-zA-Z]+\}/.test(filled) ? null : filled;
}

/** Counts by level for the shape rules: every open row with an estimate's level; the rest are unsorted. */
function levelCounts(items: readonly PlanItem[], estimates: Record<string, EstimateResult>) {
  const counts = { high_reach: 0, reach: 0, target: 0, likely: 0, safe: 0 };
  let unsorted = 0;
  for (const i of items) {
    const g = estimates[i.unit_id]?.group ?? null;
    if (g) counts[g] += 1;
    else unsorted += 1;
  }
  return { counts, unsorted };
}

/** Builds the facts once: the open rows, then the three rule modules (U2, U3, U4; stubs until they land). */
export function moveFacts(input: GeneratorInput): MoveFacts {
  const items = input.items.filter((i) => !i.withdrawn_on);
  const opts = { season: input.season, today: input.today };
  const edCandidates = edOpportunities(items, input.estimates, input.schools, opts);
  const hooks = hooksFromPlan(items, input.visits, input.profile);
  const interest = interestMoves(items, input.estimates, input.schools, hooks, edCandidates, opts);
  const { counts, unsorted } = levelCounts(items, input.estimates);
  // The same three-state affordability and Dream clause the Colleges tab's notice reads (lib/planner/plan-view.ts
  // balanceLineFor), so the shape_gap/shape_cost move and the notice never disagree (list-shape.md "Gap moves").
  const affordability = affordabilityFor(items, input.schools, input.profile, input.estimates);
  const gaps = shapeGaps(counts, unsorted, input.season, affordability, dreamAtHighReach(items, input.estimates));
  // Null while nothing has an estimate yet (plan-v3-fix-cards): `listGapTitle` keeps the built title rather than
  // reading every level as a shortfall.
  const sorted = Object.values(counts).some((n) => n > 0);
  return { items, schools: input.schools, profile: input.profile, visits: input.visits, estimates: input.estimates, edCandidates, shapeGaps: gaps, interest, counts: sorted ? counts : null };
}

/** The playbook entries a season shows: this season's and the next's, plus earlier seasons' carried ones. */
export function entriesFor(season: Season, playbook: readonly PlaybookEntry[] = PLAYBOOK): PlaybookEntry[] {
  if (season === "unknown") return playbook.filter((e) => e.season === "unknown");
  // After senior spring nothing carries: the summer after is the offers unit's summer list, then college.
  if (season === "summer_after" || season === "graduated") return playbook.filter((e) => e.season === season);
  const next = nextSeason(season);
  const rank = seasonRank(season);
  return playbook.filter((e) => {
    if (e.season === "unknown") return false;
    if (e.season === season || e.season === next) return true;
    return e.carries && seasonRank(e.season) < rank;
  });
}

/** Whether the cycle file already has the entry's move inside its window (`builtBy`). */
function builtInCycle(entry: PlaybookEntry, window: { start: string; end: string } | null, input: GeneratorInput): boolean {
  if (!entry.builtBy) return false;
  return input.cycle.entries.some((c) => {
    if (!c.key.startsWith(entry.builtBy!)) return false;
    if (!window) return true;
    const start = c.window?.[0] ?? c.date ?? "";
    const end = c.window?.[1] ?? c.date ?? "";
    return start <= window.end && end >= window.start;
  });
}

/** The task one playbook entry becomes for this plan (dates from its season's bounds), or null when it shouldn't exist.
 *  `counts` (plan-v3-fix-cards) threads the list's level counts into both `titleFor` and `action`, the way `generateFrom`
 *  has it ready from `moveFacts`; callers outside this module (none today) get `null`. */
export function playbookTask(entry: PlaybookEntry, input: GeneratorInput, position: number, counts: Record<StandingLevel, number> | null = null): GeneratedTask | null {
  const bounds = input.gradYear !== null ? seasonBounds(entry.season, input.gradYear) : null;
  const w = entry.window && bounds ? entry.window(bounds) : null;
  if (entry.window && !w) return null;
  const range = w ? ("due" in w ? { start: w.due, end: w.due } : w) : null;
  if (builtInCycle(entry, range, input)) return null;
  const last = w ? ("due" in w ? w.due : w.end) : null;
  if (!input.allMoves && last !== null && last < addDays(input.today, -STALE_DAYS)) return null;
  const actionCtx = { studentId: input.list.student_id, items: input.items, schools: input.schools, profile: input.profile, counts };
  const filled = entry.titleFor ? (entry.titleFor(actionCtx) ?? fillTitle(entry.title, input.profile)) : fillTitle(entry.title, input.profile);
  // The preview shows an entry it can't fill too ("Work toward your target score" with no target set).
  const title = filled ?? (input.allMoves ? entry.title.replaceAll("{target}", "target score") : null);
  if (title === null) return null;
  return {
    key: taskKey(input.list.id, "playbook", entry.key),
    item_id: null,
    kind: entry.kind ?? "playbook",
    title,
    detail: entry.why,
    due_on: w && "due" in w ? w.due : null,
    window_start: w && !("due" in w) ? w.start : null,
    window_end: w && !("due" in w) ? w.end : null,
    assignee: entry.who,
    source: "season",
    source_field: null,
    source_edition: null,
    date_note: null,
    position,
    season: entry.season,
    action: entry.action(actionCtx),
  };
}

/**
 * The all-moves preview (lib/planner/all-moves.ts): every season's entries, whatever applies and whatever replaces
 * what. The class-year move only without a class year.
 */
function allEntries(season: Season, playbook: readonly PlaybookEntry[]): PlaybookEntry[] {
  return playbook.filter((e) => e.season !== "unknown" || season === "unknown");
}

/** generate() over a given playbook (tests plant entries; the app uses PLAYBOOK). */
export function generateFrom(input: GeneratorInput, playbook: readonly PlaybookEntry[]): GeneratedTask[] {
  if (input.list.student_id === null) return [];
  const facts = moveFacts(input);
  const entries = input.allMoves ? allEntries(input.season, playbook) : entriesFor(input.season, playbook).filter((e) => moveApplies(e.applies, facts));
  const replaced = new Set(input.allMoves ? [] : entries.map((e) => e.replaces).filter((k): k is string => Boolean(k)));
  const out: GeneratedTask[] = [];
  for (const entry of entries) {
    if (replaced.has(entry.key)) continue;
    const t = playbookTask(entry, input, playbook.indexOf(entry), facts.counts);
    if (t) out.push(t);
  }
  out.push(...edMoves(input, facts.edCandidates), ...interestTasks(input, facts.interest), ...shapeTasks(input, facts.shapeGaps));
  return out;
}

export function generate(input: GeneratorInput): GeneratedTask[] {
  return generateFrom(input, PLAYBOOK);
}
