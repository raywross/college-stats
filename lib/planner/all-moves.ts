/**
 * The all-moves preview (owner, 2026-10-20: "show all possible tasks for a student organized by the season we'd
 * recommend… off by default, but on for now", to walk each move's workflow with the students loaded on dev). Turned on
 * by the `planner.all_moves` site setting, switched on /admin/settings (lib/planner/all-moves-server.ts), which sets
 * `allMoves` on the generator input and the PlanContext. With it on:
 *
 * - The season generator emits every playbook entry of every season, whatever its `applies`, `replaces`, or staleness
 *   says (generators/season.ts), and the cycle generator every entry of the student's cycle whatever applies and however
 *   old (national test dates still only once picked). They are real plan_tasks rows, so Done, Skip, and each guide work
 *   as they do for real. Turning the setting off orphans the extra rows on the next open (mergeTasks); turning it back
 *   on brings them back with their done and skipped state.
 * - The Next steps tab lists every move by its season (`allMovesBySeason`), the current season first open, instead of
 *   Now's three. Financial-aid moves, which the real tab hides for now, show with a note saying so.
 * - The rule units' moves that depend on the list (ED, interest, the list's shape, a college's confirm and decision
 *   moves) appear only when their rule fires, as before; `conditionalMoves` names the ones this plan doesn't have.
 *
 * Off, nothing here runs. Pure; safe in client components.
 */
import { MOVE_TEXT } from "./moves-catalog.ts";
import { isFinancialMove, LEGACY_TODO_KINDS, taskSeason } from "./moves.ts";
import { SEASONS, type Season } from "./seasons.ts";
import { compareTasks, isOpen } from "./tasks.ts";
import type { PlanTask } from "./types.ts";

export interface AllMovesSection {
  season: Season;
  open: PlanTask[];
  done: PlanTask[];
  skipped: PlanTask[];
}

/** Every live move (not a legacy to-do, not orphaned) by its season, in calendar order, each season's rows by date. */
export function allMovesBySeason(tasks: readonly PlanTask[], opts: { season: Season; gradYear: number | null; today: string }): AllMovesSection[] {
  const by = new Map<Season, AllMovesSection>();
  const live = tasks.filter((t) => !t.orphaned && !LEGACY_TODO_KINDS.has(t.kind)).sort(compareTasks);
  for (const t of live) {
    const s = taskSeason(t, opts.gradYear, opts.season);
    let section = by.get(s);
    if (!section) by.set(s, (section = { season: s, open: [], done: [], skipped: [] }));
    if (t.done_at !== null) section.done.push(t);
    else if (t.dismissed) section.skipped.push(t);
    else if (isOpen(t, opts.today)) section.open.push(t);
  }
  return SEASONS.flatMap((s) => (by.has(s) ? [by.get(s)!] : []));
}

/** Why a move wouldn't show on the real tab even in its season, or null. */
export function hiddenNote(t: Pick<PlanTask, "kind" | "key">): string | null {
  return isFinancialMove(t) ? "Hidden from the real tab for now (financial aid)" : null;
}

/**
 * The rule units' moves (MOVE_TEXT) this plan has no row for: they appear once the list calls for them. Titles with
 * their placeholders read as plain words.
 */
export function conditionalMoves(tasks: readonly Pick<PlanTask, "kind" | "key" | "orphaned">[]): { key: string; title: string; why: string }[] {
  const has = (k: string) => {
    const [kind, variant] = k.split(":");
    return tasks.some((t) => !t.orphaned && t.kind === kind && (!variant || (t.key ?? "").includes(`:${kind}:${variant}`)));
  };
  const plain = (s: string) =>
    s
      .replaceAll("{college}", "a college")
      .replaceAll("{edCollege}", "the ED college")
      .replaceAll("{date}", "its date")
      .replaceAll("{count}", "the")
      .replaceAll("{label}", "considered")
      .replaceAll("{counts}", "The list's counts by level.");
  return Object.entries(MOVE_TEXT)
    .filter(([k]) => !has(k))
    .map(([k, v]) => ({ key: k, title: plain(v.title), why: plain(v.why) }));
}
