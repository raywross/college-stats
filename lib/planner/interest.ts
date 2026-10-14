/**
 * Interest and visits (specs/planner/next-steps/interest-and-visits.md). Pure; no I/O. Replaces U1's stub; the
 * season generator (lib/planner/generators/season.ts) calls `interestMoves` once per regeneration and
 * `interestTasks` for the moves themselves.
 *
 * Who gets a move, at most one per college, in this order (spec "Who gets a move"):
 * 1. Every ED candidate from part 2 (`edOpportunities`'s own result), plus a row the student dismissed from ED
 *    ("Not for me") that would still qualify as one, kept only for the season the dismissal happened in (compared
 *    by calendar month, not by graduation year, so no `gradYear` is needed here — see `sameSeasonWindow`): a
 *    `visit_ed` move while the college shows no demonstrated interest yet.
 * 2. A college whose C7 ("level of applicant's interest") is important or very important, at any Reach or Target,
 *    while no interest is shown. From junior fall.
 * 3. A college whose C7 is "considered", at Reach closeness 3 or 2, or Target closeness 0 or 1 (the owner's
 *    upper-Target / lower-Reach band), while no interest is shown. From junior spring, alongside rule 1.
 * Never for not_considered, no C7, High reach, Likely, Safe, or a college the estimate labels "elite". At most
 * three open at a time: rule 1 first (its own ED rank order, the dismissed ones after), then rule 2, then rule 3,
 * each ordered by the owner's closeness order; the rest wait until one closes.
 *
 * "Closes" (interest-and-visits.md "The move"): the spec's own implementation note is that the generator reads
 * `hooks.interest` — true once the family has visited (logged or merely planned), requested information, or
 * followed the college — so any one of those acts stops EVERY rule's move for that college, not only the one a
 * family happened to use. This also covers "a planned future visit counts as logged" (hooksFromPlan counts any
 * `plan_visits` row, past or future).
 */
import type { CollegeHooks, EstimateResult, StandingLevel } from "../chances/types.ts";
import type { FactorImportance } from "../types.ts";
import { ED_FIRST_SEASON, edDismissedItemIds, type EdCandidate } from "./ed-opportunities.ts";
import { MOVE_TEXT } from "./moves-catalog.ts";
import { isOffered, roundDates } from "./rounds.ts";
import { seasonRank, type Season } from "./seasons.ts";
import { addDays } from "./stage.ts";
import { taskKey } from "./tasks.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool } from "./types.ts";

export interface InterestMove { itemId: string; rule: "visit_ed" | "important" | "considered"; kind: "visit_ed" | "show_interest" }

/** The most open interest moves at a time (interest-and-visits.md "Who gets a move"). */
export const INTEREST_MAX = 3;
/** The first season rule 2 (important / very important) can show, per the Timing table. Rules 1 and 3 wait for
 *  `ED_FIRST_SEASON` (junior spring), the same gate as the ED opportunities they read from. */
export const INTEREST_FIRST_SEASON: Season = "junior_fall";

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

const FACTOR_WORD: Record<"very_important" | "important" | "considered", string> = {
  very_important: "very important",
  important: "important",
  considered: "considered",
};

/** C7's field and the edition it was published in, for citing the "applicant interest is {label}" sentence. */
export const INTEREST_FIELD = "reported.admission_profile.factors.interest";

/** Whether a college shows demonstrated interest by any logged act (module comment: the spec's own closing rule). */
function hasShownInterest(unitId: string, hooks: Record<string, CollegeHooks>): boolean {
  return hooks[unitId]?.interest === true;
}

/** The owner's closeness order, reused from ed-opportunities.ts' ranking idea (Reach 3,2,1,0; Target 0,1,2,3; no
 *  closeness last). Lower sorts first; duplicated in small here since ed-opportunities.ts doesn't export it. */
function closenessOrder(level: StandingLevel, closeness: EstimateResult["closeness"]): number {
  if (closeness == null) return 9;
  return level === "reach" ? 3 - closeness : closeness;
}

/** Whether a row would be an ED candidate on its estimate and the college's own record alone, ignoring any
 *  dismissal (ed-opportunities.ts' own candidate test, duplicated in small: that module only hands this one the
 *  final, already-dismissal-filtered `edCandidates`, per the build brief's contract). */
function looksLikeEdCandidate(unitId: string, estimates: Record<string, EstimateResult>, schools: Record<string, PlanSchool>): StandingLevel | null {
  const est = estimates[unitId];
  const level = est?.group ?? null;
  if (!est || est.ed !== "helps" || (level !== "reach" && level !== "target")) return null;
  if (isOffered(schools[unitId], "ed") !== true) return null;
  return level;
}

/** "YYYY-fall" / "-winter" / "-spring" / "-summer": the same four fixed-month windows every season boundary uses
 *  (seasons.ts STARTS: Aug, Jan, Mar, Jun), read straight off the calendar so two dates compare as "the same
 *  season" without needing the student's graduation year. */
function quarterOf(iso: string): string {
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  if (m >= 8) return `${y}-fall`;
  if (m <= 2) return `${y}-winter`;
  if (m <= 5) return `${y}-spring`;
  return `${y}-summer`;
}

/** Open question 1 (interest-and-visits.md), adopted: a dismissed ED candidate's visit move persists for the
 *  season the dismissal happened in, then it follows the interest rules only. */
function sameSeasonWindow(dismissedAt: string, today: string): boolean {
  return quarterOf(dismissedAt) === quarterOf(today);
}

export function interestMoves(
  rows: readonly PlanItem[],
  estimates: Record<string, EstimateResult>,
  schools: Record<string, PlanSchool>,
  hooks: Record<string, CollegeHooks>,
  edCandidates: readonly EdCandidate[],
  opts: { season: Season; today: string },
): InterestMove[] {
  const live = rows.filter((r) => !r.withdrawn_on);
  const rank = seasonRank(opts.season);
  const used = new Set<string>();
  const out: InterestMove[] = [];

  /* Rule 1: every ED candidate, dismissed or not, while no interest is shown. */
  if (rank >= seasonRank(ED_FIRST_SEASON)) {
    const pool: { itemId: string; unitId: string; order: number }[] = edCandidates.map((c) => ({ itemId: c.itemId, unitId: c.unitId, order: c.rank }));
    const already = new Set(pool.map((p) => p.itemId));
    let next = pool.length;
    for (const id of edDismissedItemIds(live)) {
      if (already.has(id)) continue;
      const row = live.find((r) => r.id === id);
      if (!row || !row.ed_dismissed_at || !sameSeasonWindow(row.ed_dismissed_at, opts.today)) continue;
      if (looksLikeEdCandidate(row.unit_id, estimates, schools)) pool.push({ itemId: id, unitId: row.unit_id, order: next++ });
    }
    pool.sort((a, b) => a.order - b.order);
    for (const p of pool) {
      if (hasShownInterest(p.unitId, hooks)) continue;
      used.add(p.itemId);
      out.push({ itemId: p.itemId, rule: "visit_ed", kind: "visit_ed" });
    }
  }

  /* Rules 2 and 3: C7 important/very important (any Reach or Target), or considered (the upper-Target /
     lower-Reach band), while no interest is shown. Never not_considered, unpublished, or an elite label. */
  const important: { itemId: string; order: number }[] = [];
  const considered: { itemId: string; order: number }[] = [];
  for (const row of live) {
    if (used.has(row.id)) continue;
    const est = estimates[row.unit_id];
    const level = est?.group ?? null;
    if (level !== "reach" && level !== "target") continue;
    if (est?.label === "elite") continue;
    if (hasShownInterest(row.unit_id, hooks)) continue;
    const factor: FactorImportance | null = schools[row.unit_id]?.profile?.factors?.interest ?? null;
    if (!factor || factor === "not_considered") continue;
    const order = closenessOrder(level, est?.closeness ?? null);
    if (factor === "important" || factor === "very_important") {
      if (rank >= seasonRank(INTEREST_FIRST_SEASON)) important.push({ itemId: row.id, order });
    } else if (order <= 1 && rank >= seasonRank(ED_FIRST_SEASON)) {
      considered.push({ itemId: row.id, order });
    }
  }
  important.sort((a, b) => a.order - b.order);
  considered.sort((a, b) => a.order - b.order);
  for (const p of important) out.push({ itemId: p.itemId, rule: "important", kind: "show_interest" });
  for (const p of considered) out.push({ itemId: p.itemId, rule: "considered", kind: "show_interest" });

  return out.slice(0, INTEREST_MAX);
}

/* ------------------------------------------------------------------ */
/* The move's text                                                     */
/* ------------------------------------------------------------------ */

export interface InterestMoveText {
  title: string;
  why: string;
  sourceField: string | null;
  sourceEdition: string | null;
}

/** Title and why for one move, shared by `interestTasks`, InterestCard, and RowDrawer's "capture" panel why line, so
 *  all three say exactly the same thing. */
export function interestMoveText(move: Pick<InterestMove, "kind">, school: Pick<PlanSchool, "name" | "profile" | "cites"> | undefined): InterestMoveText {
  const name = school?.name ?? "the college";
  if (move.kind === "visit_ed") {
    const text = MOVE_TEXT.visit_ed;
    return { title: fill(text.title, { college: name }), why: fill(text.why, { college: name }), sourceField: null, sourceEdition: null };
  }
  const text = MOVE_TEXT.show_interest;
  const factor = school?.profile?.factors?.interest ?? null;
  const label = factor && factor !== "not_considered" ? FACTOR_WORD[factor] : "important";
  const edition = (school?.cites[INTEREST_FIELD] as { cdsEdition?: string } | undefined)?.cdsEdition ?? null;
  return {
    title: fill(text.title, { college: name }),
    why: fill(text.why, { college: name, label, edition: edition ?? "its most recent report" }),
    sourceField: INTEREST_FIELD,
    sourceEdition: edition,
  };
}

/* ------------------------------------------------------------------ */
/* The moves' tasks                                                    */
/* ------------------------------------------------------------------ */

/** Senior-fall dating (interest-and-visits.md "Timing"): 14 days before the college's deadline in the chosen round;
 *  closed once that deadline has passed. Undated (no chosen round, or no published deadline) while it isn't senior
 *  fall yet, or when the round has no published date. */
function dueDate(
  item: Pick<PlanItem, "round">,
  school: PlanSchool | undefined,
  season: Season,
  today: string,
): { due: string | null; field: string | null; edition: string | null; lastCycle: boolean; closed: boolean } {
  const none = { due: null, field: null, edition: null, lastCycle: false, closed: false };
  if (seasonRank(season) < seasonRank("senior_fall") || !item.round || !school) return none;
  const dates = roundDates(school, item.round);
  if (!dates.closing) return none;
  if (dates.closing.iso < today) return { ...none, closed: true };
  return { due: addDays(dates.closing.iso, -14), field: dates.closing.field, edition: dates.edition, lastCycle: dates.lastCycle, closed: false };
}

/**
 * The moves' tasks (interest-and-visits.md "The move"): keyed by item and season, so "Not now" dismisses it only
 * for the season it's in — the next season's regeneration has a fresh key, which isn't dismissed, while the
 * condition holds (`interestMoves` recomputes from scratch each time; nothing here remembers a skip). The generator
 * ticks nothing itself: once `interestMoves` stops including a college (any logged act, or the condition going
 * away), its key stops being emitted and `mergeTasks` orphans the row, which the Next steps tab hides.
 */
export function interestTasks(input: GeneratorInput, moves: readonly InterestMove[]): GeneratedTask[] {
  if (input.list.student_id === null) return [];
  const out: GeneratedTask[] = [];
  for (const move of moves) {
    const item = input.items.find((i) => i.id === move.itemId);
    if (!item) continue;
    const school = input.schools[item.unit_id];
    const { due, field, edition, lastCycle, closed } = dueDate(item, school, input.season, input.today);
    if (closed) continue;
    const text = interestMoveText(move, school);
    out.push({
      key: taskKey(input.list.id, move.kind, `${move.itemId}:${input.season}`),
      item_id: move.itemId,
      kind: move.kind,
      title: text.title,
      detail: text.why,
      due_on: due,
      window_start: null,
      window_end: null,
      assignee: "either",
      source: "season",
      source_field: field ?? text.sourceField,
      source_edition: edition ?? text.sourceEdition,
      date_note: due && lastCycle ? "last_cycle" : null,
      position: 0,
      season: input.season,
      action: { kind: "open_row", itemId: move.itemId, panel: "capture" },
    });
  }
  return out;
}
