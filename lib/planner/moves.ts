/**
 * The Next steps view (specs/planner/next-steps/seasons.md "The Next steps tab"; build-plan.md "The Next steps view"):
 * which of a plan's tasks are this season's moves, in what order, and how they fold. A move is any plan_tasks row
 * (review note 1); its season is `task.season` when set, else the season its date falls in, else the current one
 * (review note 2).
 *
 * - Now: at most six, in order: overdue dated moves, dated moves within 14 days, ED decide moves inside their window,
 *   then the playbook's own order (the catalog's position), then the rest by date.
 * - More this season: the rest of this season's open moves. A skipped move ("Not now" = dismissed) and a snoozed one
 *   show nowhere; an orphan is never a move.
 * - Coming up: next season's open moves, titles and dates only.
 * - Done: this season's done moves.
 * - A guardian's own moves (assignee guardian or either) are their Your part (yourPartMoves), shown first and not again
 *   in Now.
 * Pure; safe in client components.
 */
import { addDays } from "./stage.ts";
import { yourPart } from "./summary.ts";
import { compareTasks, isOpen, taskDate } from "./tasks.ts";
import { nextSeason, seasonOfDate, type Season } from "./seasons.ts";
import type { PlanTask } from "./types.ts";

export const NOW_MAX = 6;
/** A dated move this close (days) is in Now. */
export const SOON_DAYS = 14;

export interface MoveGroups {
  now: PlanTask[];
  more: PlanTask[];
  comingUp: { title: string; date: string | null }[];
  done: PlanTask[];
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

const isEdDecide = (t: PlanTask) => t.kind === "ed_decide" || t.kind === "ed2_decide";

/** Now's buckets, lowest first: overdue, due soon, ED decide in window, the rest. */
function bucket(t: PlanTask, today: string): number {
  const d = taskDate(t);
  if (d !== null && d < today) return 0;
  if (d !== null && d <= addDays(today, SOON_DAYS)) return 1;
  if (isEdDecide(t) && (t.window_start === null || t.window_start <= today)) return 2;
  return 3;
}

/** Inside a bucket: dated ones by date; in the last, playbook rows by the catalog's position, then the rest by date. */
function compareMoves(a: PlanTask, b: PlanTask, today: string): number {
  const ba = bucket(a, today);
  const bb = bucket(b, today);
  if (ba !== bb) return ba - bb;
  if (ba === 3) {
    const pa = a.source === "season" ? 0 : 1;
    const pb = b.source === "season" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (pa === 0 && a.position !== b.position) return a.position - b.position;
  }
  return compareTasks(a, b);
}

const isMine = (t: PlanTask) => t.assignee === "guardian" || t.assignee === "either";

/**
 * The old stage-3 to-dos (lib/planner/generators/actions.ts: a follow, an information request, and visit notes for
 * every college) are not moves: the row's "Details" count already marks them (lib/planner/capture.ts rowToDo), and
 * interest-and-visits.md gives the plan its own interest moves only where the college says interest counts. They stay
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

export function nowMoves(
  tasks: PlanTask[],
  opts: { season: Season; gradYear: number | null; today: string; viewer: "student" | "guardian"; max?: number },
): MoveGroups {
  const { season, gradYear, today } = opts;
  const max = opts.max ?? NOW_MAX;
  const next = nextSeason(season);
  const live = tasks.filter(isMove);
  const seasonOf = (t: PlanTask) => taskSeason(t, gradYear, season);
  const open = live
    .filter((t) => isOpen(t, today))
    .filter((t) => !(opts.viewer === "guardian" && isMine(t)))
    .filter((t) => {
      const d = taskDate(t);
      return seasonOf(t) === season || (d !== null && d < today);
    })
    .sort((a, b) => compareMoves(a, b, today));
  const comingUp = next
    ? live
        .filter((t) => isOpen(t, today) && seasonOf(t) === next)
        .sort(compareTasks)
        .map((t) => ({ title: t.title, date: taskDate(t) }))
    : [];
  const done = live.filter((t) => t.done_at !== null && seasonOf(t) === season).sort(compareTasks);
  return { now: open.slice(0, max), more: open.slice(max), comingUp, done, season };
}

/** A guardian's own open moves for this child (assignee guardian or either), as parents.md's Your part orders them. */
export function yourPartMoves(tasks: PlanTask[], today: string): PlanTask[] {
  const moves = tasks.filter(isMove);
  return yourPart([{ studentId: "", name: null, tasks: moves }], today)[0]?.tasks ?? [];
}

/** The people line's "Next:": Now's first card. */
export function topMove(groups: MoveGroups): PlanTask | null {
  return groups.now[0] ?? null;
}
