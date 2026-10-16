/**
 * The Next steps view (specs/planner/next-steps/seasons.md "The Next steps tab"; build-plan.md "The Next steps view"):
 * which of a plan's tasks are this season's moves, in what order, and how they fold. A move is any plan_tasks row
 * (review note 1); its season is `task.season` when set, else the season its date falls in, else the current one
 * (review note 2).
 *
 * Plan v3 (specs/planner/v3/now.md "Ranking"; build-plan.md review note 6): only moves that pass the season gate
 * (`eligibleNow`: this season's, an earlier season's that carried, or one dated within SOON_DAYS) are the student's.
 *
 * Plan v3, R1b (specs/planner/record/ranking.md): Now's old buckets (overdue, soon, ED window, playbook order) are
 * gone. Every eligible move gets an importance score (`lib/planner/importance.ts`) and the set is sorted by it, ties
 * broken dated-before-undated, then the catalog's position, then title (`compareByImportance`). A move whose
 * importance is 0 (a season-gated-off rule like the story before summer, or reach-your-score once no date would
 * count) is left out of both `now` and `more`: it isn't just low-ranked, it isn't shown at all.
 *
 * - Now: at most three (NOW_MAX), by importance.
 * - More this season: the rest of the eligible open moves (the parent's view; the student's tab doesn't show it). A
 *   skipped move (dismissed) and a snoozed one are never open; an orphan is never a move.
 * - Coming up: next season's open moves, titles and dates only (the parent's view).
 * - Done: this season's done moves.
 * - Skipped: this season's skipped moves (its own season, or skipped this season), for "Done and skipped" and Bring back.
 * - A guardian's own moves (assignee guardian or either) are their Your part (yourPartMoves), shown first and not again
 *   in Now.
 * Pure; safe in client components.
 */
import { compareByImportance, importance, type ImportanceFacts } from "./importance.ts";
import { addDays } from "./stage.ts";
import { yourPart } from "./summary.ts";
import { compareTasks, dayLabel, isOpen, taskDate } from "./tasks.ts";
import { nextSeason, seasonOfDate, seasonRank, type Season } from "./seasons.ts";
import type { PlanTask } from "./types.ts";

/** Plan v3 (now.md "The tab"): at most three cards. */
export const NOW_MAX = 3;
/** A dated move this close (days) is in Now, whatever its season. */
export const SOON_DAYS = 14;

export interface MoveGroups {
  now: PlanTask[];
  more: PlanTask[];
  comingUp: { title: string; date: string | null }[];
  done: PlanTask[];
  skipped: PlanTask[];
  season: Season;
}

/**
 * A move's season: its own (the season generator's), else the season its date falls in (a window by its start: it is
 * under way from then), else the current season (an undated built task).
 */
export function taskSeason(t: Pick<PlanTask, "season" | "due_on" | "window_start" | "window_end">, gradYear: number | null, current: Season): Season {
  if (t.season) return t.season;
  const d = t.due_on ?? t.window_start;
  if (d && gradYear !== null) return seasonOfDate(d, gradYear);
  return current;
}

/**
 * The season gate (now.md "Ranking" 1; review note 6): a move is the student's now when its season is the current one
 * or an earlier one (the generators only emit earlier entries that carry), or it is dated within SOON_DAYS ("Common
 * App opens Aug 1" shows from Jul 18). A later season's move is otherwise invisible: not in Now, not in a fold.
 */
export function eligibleNow(t: PlanTask, opts: { season: Season; gradYear: number | null; today: string }): boolean {
  if (seasonRank(taskSeason(t, opts.gradYear, opts.season)) <= seasonRank(opts.season)) return true;
  const d = taskDate(t);
  return d !== null && d <= addDays(opts.today, SOON_DAYS);
}

const isMine = (t: PlanTask) => t.assignee === "guardian" || t.assignee === "either";

/**
 * The old stage-3 to-dos (lib/planner/generators/actions.ts: a follow, an information request, and visit notes for
 * every college) are not moves, and interest-and-visits.md gives the plan its own interest moves only where the
 * college says interest counts. They stay
 * on the calendar as before; the Next steps tab leaves them out (QA 2026-10-14: a "Follow" and a "Request
 * information" card for every college, Emory included).
 */
export const LEGACY_TODO_KINDS: ReadonlySet<PlanTask["kind"]> = new Set(["follow", "request_info", "write_visit_notes"]);

/**
 * Financial aid is its own body of work, set aside for now (owner, 2026-10-15: "too much stuff in the list on
 * financial aid; hide the financial aid tasks, we can come back to them"): the aid-form, cost-check, and
 * affordability moves, the cycle's FAFSA / CSS Profile / aid-offer entries, and the playbook's money entries stay off
 * the Next steps tab and out of Your part (they remain on the calendar as before). A kind, or a key suffix for the
 * cycle, playbook, and shape entries.
 */
export const FINANCIAL_KINDS: ReadonlySet<PlanTask["kind"]> = new Set(["aid_forms", "cost_check", "shape_cost"]);
export const FINANCIAL_KEY_SUFFIXES: readonly string[] = [
  ":cycle:fafsa_opens", ":cycle:css_profile_opens", ":cycle:accept_aid",
  ":playbook:money_talk", ":playbook:net_price", ":playbook:walk_away", ":playbook:fsa_ids", ":playbook:list_cost",
  ":shape_gap:affordable",
];
export function isFinancialMove(t: Pick<PlanTask, "kind" | "key">): boolean {
  if (FINANCIAL_KINDS.has(t.kind)) return true;
  return t.key !== null && FINANCIAL_KEY_SUFFIXES.some((s) => t.key!.endsWith(s));
}

/** What the Next steps tab counts as a move at all: a live row that isn't a legacy to-do or a financial task. */
export function isMove(t: Pick<PlanTask, "kind" | "key" | "orphaned">): boolean {
  return !t.orphaned && !LEGACY_TODO_KINDS.has(t.kind) && !isFinancialMove(t);
}

/** The "Work toward your {target}" move (the catalog's `reach_score_{season}` entries). */
export const isReachScoreMove = (t: Pick<PlanTask, "key">): boolean => t.key !== null && /:playbook:reach_score_/.test(t.key);
/** A picked test date's own moves: register by its deadline, and the day itself. */
export const isTestDateMove = (t: Pick<PlanTask, "kind">): boolean => t.kind === "test_register" || t.kind === "test_day";

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The italic line on the "Work toward your {target}" card (owner, 2026-10-16: "merge the card that shows an upcoming
 * test with the work-toward-your-target card… if more than one, just show the soonest"): the soonest picked test date
 * still ahead, and its registration deadline while it isn't registered. Null with no test date picked. Dates only,
 * never a score, so it reads the same to a parent.
 */
export function nextTestNote(tasks: readonly PlanTask[], today: string, registeredKeys: readonly string[] = []): string | null {
  const days = tasks
    .filter((t) => t.kind === "test_day" && t.due_on !== null && t.due_on >= today && t.done_at === null && !t.orphaned)
    .sort((a, b) => a.due_on!.localeCompare(b.due_on!));
  const day = days[0];
  if (!day) return null;
  const entryKey = day.key?.slice(day.key.lastIndexOf(":") + 1) ?? "";
  const label = day.title.replace(/ test day$/, "").replace(/\s*\(projected date\)/, "");
  const reg = tasks.find((t) => t.kind === "test_register" && t.key?.endsWith(`:${entryKey}`));
  const registered = registeredKeys.includes(entryKey) || (reg?.done_at ?? null) !== null;
  const registerBy = !registered && reg?.due_on && reg.due_on >= today ? ` Register by ${shortDate(reg.due_on)}.` : "";
  return `Your next test: the ${label} on ${shortDate(day.due_on!)}${registered ? " (registered)" : ""}.${registerBy}`;
}

export function nowMoves(
  tasks: PlanTask[],
  opts: { season: Season; gradYear: number | null; today: string; viewer: "student" | "guardian"; max?: number; facts: ImportanceFacts },
): MoveGroups {
  const { season, gradYear, today, facts } = opts;
  const max = opts.max ?? NOW_MAX;
  const next = nextSeason(season);
  const live = tasks.filter(isMove);
  const seasonOf = (t: PlanTask) => taskSeason(t, gradYear, season);
  const forViewer = (t: PlanTask) => !(opts.viewer === "guardian" && isMine(t));
  const eligible = live
    .filter((t) => isOpen(t, today))
    .filter(forViewer)
    .filter((t) => eligibleNow(t, { season, gradYear, today }))
    // R1b (ranking.md): a move whose importance is 0 doesn't show at all, not even folded into More.
    .filter((t) => importance(t, facts) > 0)
    .sort((a, b) => compareByImportance(a, b, facts));
  // A picked test's register and test-day moves fold into "Work toward your {target}" when that card is up (owner,
  // 2026-10-16): its italic line names the soonest test (nextTestNote), the guide schedules another, and the dates
  // stay on the calendar. Without the target card they show on their own as before.
  const open = eligible.some(isReachScoreMove) ? eligible.filter((t) => !isTestDateMove(t)) : eligible;
  const comingUp = next
    ? live
        .filter((t) => isOpen(t, today) && seasonOf(t) === next)
        .sort(compareTasks)
        .map((t) => ({ title: t.title, date: taskDate(t) }))
    : [];
  const done = live.filter((t) => t.done_at !== null && seasonOf(t) === season).sort(compareTasks);
  // A carried move keeps its own (earlier) season, so one skipped this season counts by its skip date too.
  const skippedThisSeason = (t: PlanTask) => seasonOf(t) === season || (t.dismissed_at != null && gradYear !== null && seasonOfDate(t.dismissed_at.slice(0, 10), gradYear) === season);
  const skipped = live.filter((t) => t.dismissed && t.done_at === null && forViewer(t) && skippedThisSeason(t)).sort(compareTasks);
  return { now: open.slice(0, max), more: open.slice(max), comingUp, done, skipped, season };
}

/** A guardian's own open moves for this child (assignee guardian or either), as parents.md's Your part orders them. */
export function yourPartMoves(tasks: PlanTask[], today: string): PlanTask[] {
  const moves = tasks.filter(isMove);
  return yourPart([{ studentId: "", name: null, tasks: moves }], today)[0]?.tasks ?? [];
}

/** "Skipped Oct 12" for the Done and skipped fold, or "Skipped" for a skip made before the skip record existed. */
export function skippedLabel(t: Pick<PlanTask, "dismissed_at">, today: string): string {
  return t.dismissed_at ? `Skipped ${dayLabel(t.dismissed_at.slice(0, 10), today)}` : "Skipped";
}

/** "Done Oct 3": the day a done move was ticked, or null. */
export function doneLabel(t: Pick<PlanTask, "done_at">, today: string): string | null {
  return t.done_at ? `Done ${dayLabel(t.done_at.slice(0, 10), today)}` : null;
}

/** The people line's "Next:": Now's first card. */
export function topMove(groups: MoveGroups): PlanTask | null {
  return groups.now[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Plan v3 (parents.md "The tab"; build-plan.md "U9 The parent's Next steps")                                       */
/* ------------------------------------------------------------------ */

export type SeasonRowState = "now" | "next" | "done" | "skipped";
export interface SeasonRow {
  task: PlanTask;
  state: SeasonRowState;
  /** The row's date (ISO): the task's own date for now/next, `done_at` for done, `dismissed_at` for skipped; null
   *  when undated ("this season"). The component formats it (dayLabel, doneLabel, skippedLabel). */
  when: string | null;
}

/**
 * The season's rows for a guardian's view (parents.md "The tab" 2): the season's moves the student would see or has
 * seen, in Now's order — the three in `now` as "now", the rest of the eligible open set (`more`) as "next", this
 * season's done moves as "done", its skipped moves as "skipped". The guardian's own moves (Your part) are left out:
 * `nowMoves` is called with `viewer: "student"` to get the student's full set (including past NOW_MAX and the done/
 * skipped groups, which `nowMoves` doesn't trim for a guardian viewer), and the guardian-assigned ones are dropped
 * here instead.
 */
export function seasonRows(tasks: PlanTask[], opts: { season: Season; gradYear: number | null; today: string; facts: ImportanceFacts }): SeasonRow[] {
  const groups = nowMoves(tasks, { ...opts, viewer: "student" });
  const theirs = (t: PlanTask) => !isMine(t);
  const rows: SeasonRow[] = [];
  for (const t of groups.now.filter(theirs)) rows.push({ task: t, state: "now", when: taskDate(t) });
  for (const t of groups.more.filter(theirs)) rows.push({ task: t, state: "next", when: taskDate(t) });
  for (const t of groups.done.filter(theirs)) rows.push({ task: t, state: "done", when: t.done_at });
  for (const t of groups.skipped.filter(theirs)) rows.push({ task: t, state: "skipped", when: t.dismissed_at });
  return rows;
}

/** Next season's open moves (titles, dates): `nowMoves`'s own `comingUp` (the parent's view; now.md "Ranking"). */
export function comingUpRows(tasks: PlanTask[], opts: { season: Season; gradYear: number | null; today: string; facts: ImportanceFacts }): { title: string; date: string | null }[] {
  return nowMoves(tasks, { ...opts, viewer: "student" }).comingUp;
}

/** A `reach_score_*` playbook move's key suffix ("Work toward your {target}"). */
const REACH_SCORE_KEY_RE = /:playbook:reach_score_[a-z_]+$/;

/**
 * Plan v3 (build-plan.md, U1's "As built" note on U9): a `reach_score_*` move's title holds the student's own target
 * score ("Work toward your 1400"); a parent must never see it. The parent's row reads this instead of `task.title`.
 */
export function parentSafeTitle(t: Pick<PlanTask, "key" | "title">): string {
  return t.key && REACH_SCORE_KEY_RE.test(t.key) ? "Work toward the target score" : t.title;
}
