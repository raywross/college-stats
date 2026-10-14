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

export function nowMoves(
  tasks: PlanTask[],
  opts: { season: Season; gradYear: number | null; today: string; viewer: "student" | "guardian"; max?: number },
): MoveGroups {
  const { season, gradYear, today } = opts;
  const max = opts.max ?? NOW_MAX;
  const next = nextSeason(season);
  const live = tasks.filter((t) => !t.orphaned);
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
  return yourPart([{ studentId: "", name: null, tasks }], today)[0]?.tasks ?? [];
}

/** The people line's "Next:": Now's first card. */
export function topMove(groups: MoveGroups): PlanTask | null {
  return groups.now[0] ?? null;
}
