/**
 * The timeline's pure rules (specs/planner/timeline.md "The plan by grade", "Display", "Reminders"): the fold by grade
 * ("Later"), windows as bars, titles for the calendar feed and reminders, the feed's events, and which tasks a reminder
 * mentions. No I/O: the month and college views, the feed route, the digest, Your week, and texts all call these.
 *
 * Everything that leaves the site (the feed, an email line, a text) is built from a task's title, its college's name,
 * and its date: never a detail, a note, or a number from the student's profile.
 */
import type { IcsEvent } from "../ics.ts";
import type { Grade } from "./cycle.ts";
import { nowMoves } from "./moves.ts";
import { seasonBounds, type Season } from "./seasons.ts";
import { addDays } from "./stage.ts";
import { compareTasks, isOpen, taskDate } from "./tasks.ts";
import type { PlanItem, PlanTask, PlanVisit, VisitKind } from "./types.ts";

/* ------------------------------------------------------------------ */
/* The fold by grade                                                   */
/* ------------------------------------------------------------------ */

/**
 * How far ahead the plan shows tasks for each grade before folding the rest under "Later" (days). Earlier grades see
 * less of the far future; a senior in season sees the next couple of months. Null: nothing folds.
 */
export const FOLD_DAYS: Record<Grade, number | null> = {
  earlier: 60,
  junior_fall: 120,
  junior_spring: 90,
  summer_before_senior: 90,
  senior_fall: 75,
  senior_winter: 75,
  senior_spring: 60,
  summer_after: 90,
  graduated: null,
  unknown: 120,
};

/** The last day shown above the fold (inclusive), or null when nothing folds. */
export function foldAfter(grade: Grade, today: string): string | null {
  const days = FOLD_DAYS[grade];
  return days === null ? null : addDays(today, days);
}

/** Whether a task sits under "Later": it starts after the fold, and it isn't done (done tasks stay in their month). */
export function isFolded(t: Pick<PlanTask, "due_on" | "window_start" | "done_at">, grade: Grade, today: string): boolean {
  const after = foldAfter(grade, today);
  if (after === null || t.done_at !== null) return false;
  const start = t.window_start ?? t.due_on;
  return start !== null && start > after;
}

/** Tasks split for the month view: shown now, and "Later". */
export function splitFold<T extends Pick<PlanTask, "due_on" | "window_start" | "done_at">>(tasks: T[], grade: Grade, today: string): { now: T[]; later: T[] } {
  const now: T[] = [];
  const later: T[] = [];
  for (const t of tasks) (isFolded(t, grade, today) ? later : now).push(t);
  return { now, later };
}

/* ------------------------------------------------------------------ */
/* Orphans                                                             */
/* ------------------------------------------------------------------ */

/**
 * Orphaned tasks worth one line ("no longer in the college's data"): not done, not dismissed, and not past (a cycle
 * date that aged out says nothing). The line has a "Got it" that dismisses it, so it shows until acknowledged.
 */
export function orphansToShow(tasks: PlanTask[], today: string): PlanTask[] {
  return tasks.filter((t) => {
    if (!t.orphaned || t.done_at !== null || t.dismissed) return false;
    const d = taskDate(t);
    return d === null || d >= today;
  });
}

/* ------------------------------------------------------------------ */
/* Windows as bars                                                     */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayNumber(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

/**
 * A window drawn across its months: the months it touches (at most `max`), the bar's start and end as fractions of
 * that span, and where today falls on it (null when outside). The month view draws it as a bar under the title.
 */
export function windowBar(start: string, end: string, today: string, max = 8): { months: string[]; from: number; to: number; today: number | null } {
  const [sy, sm] = start.split("-").map(Number);
  const months: string[] = [];
  let y = sy;
  let m = sm;
  const endKey = end.slice(0, 7);
  while (months.length < max) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  const spanStart = dayNumber(`${months[0]}-01`);
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  const spanEnd = dayNumber(lm === 12 ? `${ly + 1}-01-01` : `${ly}-${String(lm + 1).padStart(2, "0")}-01`);
  const len = spanEnd - spanStart;
  const frac = (iso: string) => Math.min(1, Math.max(0, (dayNumber(iso) - spanStart) / len));
  const t = dayNumber(today);
  return {
    months: months.map((k) => MONTHS[Number(k.slice(5, 7)) - 1]),
    from: frac(start),
    to: frac(addDays(end, 1)),
    today: t >= spanStart && t < spanEnd ? frac(today) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Titles that leave the site                                          */
/* ------------------------------------------------------------------ */

const MONTH_RE = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const FIGURE = new RegExp(`(?<![\\d$.,])(?<!\\b${MONTH_RE} )\\$?\\d[\\d,.]*%?`, "g");

/**
 * Removes every figure that isn't the day of a "Nov 1" date: scores, amounts, percents, counts. What leaves the site
 * (a feed event, a text) never carries a number, even when a family typed one into their own task's title.
 */
export function scrubNumbers(text: string): string {
  return text
    .replace(FIGURE, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .trim();
}

/** "Michigan: apply (ED I)": the college's name and the title with its first letter lowered; a shared task as is. */
export function outsideTitle(t: Pick<PlanTask, "title">, collegeName: string | null): string {
  const title = scrubNumbers(t.title);
  if (!collegeName) return title;
  const lowered = /^[A-Z][a-z]/.test(title) ? title[0].toLowerCase() + title.slice(1) : title;
  return `${collegeName}: ${lowered}`;
}

/** The college name for every item id, through the list's colleges. */
export function collegeNames(items: Pick<PlanItem, "id" | "unit_id">[], names: Record<string, string>): Record<string, string> {
  return Object.fromEntries(items.map((i) => [i.id, names[i.unit_id] ?? "A college"]));
}

/* ------------------------------------------------------------------ */
/* The calendar feed                                                   */
/* ------------------------------------------------------------------ */

export const VISIT_LABELS: Record<VisitKind, string> = {
  campus_tour: "campus tour",
  info_session: "information session",
  open_house: "open house",
  virtual: "virtual visit",
  interview: "interview",
  fair: "college fair",
  overnight: "overnight visit",
  other: "visit",
};

/** Feed events from the tasks and visits a list's reader may see: titles only, no details, notes, or numbers. */
export function feedEvents(
  tasks: Pick<PlanTask, "id" | "item_id" | "title" | "due_on" | "window_start" | "window_end" | "dismissed" | "orphaned">[],
  visits: Pick<PlanVisit, "id" | "item_id" | "kind" | "on_date" | "at_time">[],
  namesByItem: Record<string, string>,
  domain = "quad.plan",
): IcsEvent[] {
  const events: IcsEvent[] = [];
  for (const t of tasks) {
    if (t.dismissed || t.orphaned) continue;
    const college = t.item_id ? (namesByItem[t.item_id] ?? null) : null;
    const summary = outsideTitle(t, college);
    if (t.due_on) events.push({ uid: `task-${t.id}@${domain}`, date: t.due_on, summary });
    else if (t.window_start && t.window_end) {
      const [, m, d] = t.window_end.split("-").map(Number);
      events.push({ uid: `task-${t.id}@${domain}`, date: t.window_start, summary: `${summary} (until ${MONTHS[m - 1]} ${d})` });
    }
  }
  for (const v of visits) {
    const college = namesByItem[v.item_id] ?? "A college";
    const label = VISIT_LABELS[v.kind] ?? "visit";
    events.push({ uid: `visit-${v.id}@${domain}`, date: v.on_date, time: v.at_time, minutes: 90, summary: `${college}: ${label}` });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

/** The digest's and Your week's window: open tasks due in the next seven days (today included). */
export const REMINDER_DAYS = 7;

/** Open dated tasks due from today through `days` ahead, soonest first. */
export function dueSoon(tasks: PlanTask[], today: string, days = REMINDER_DAYS): PlanTask[] {
  const end = addDays(today, days);
  return tasks
    .filter((t) => {
      const d = taskDate(t);
      return isOpen(t, today) && d !== null && d >= today && d <= end;
    })
    .sort(compareTasks);
}

/** The first open overdue task, or null. */
export function firstOverdue(tasks: PlanTask[], today: string): PlanTask | null {
  return (
    tasks
      .filter((t) => {
        const d = taskDate(t);
        return isOpen(t, today) && d !== null && d < today;
      })
      .sort(compareTasks)[0] ?? null
  );
}

/**
 * Kinds with a hard deadline: the ones a day-before text is for (an application, a reply, a deposit, and the ED decide
 * dates: next-steps notifications.md "Channels").
 */
export const HARD_DEADLINE_KINDS: ReadonlySet<PlanTask["kind"]> = new Set(["apply", "ed2_conditional", "reply_by", "housing_deposit", "deposit", "ed_decide", "ed2_decide"]);

/** The Now list's moves that lead Your week (next-steps notifications.md "Channels"). */
export const WEEK_MOVES = 3;
/** Kinds whose new move is a line in the next Your week or summary, never an instant message (an ED or interest pill's move). */
export const NEW_MOVE_LINE_KINDS: ReadonlySet<PlanTask["kind"]> = new Set(["ed_decide", "ed2_decide", "visit_ed", "show_interest"]);

/**
 * What Your week carries for a student (notifications.md "Channels"): the Now list's first three moves, dated first;
 * a new ED or interest move from the last seven days; then the built week (due in the next seven days) and the first
 * overdue task, neither repeating a move; and what was done in the last seven days (shown once: each Sunday's mail
 * covers the days since the last). Only open moves; a skipped (dismissed) move never mails.
 */
export function yourWeekTasks(
  tasks: PlanTask[],
  opts: { season: Season; gradYear: number | null; today: string },
): { moves: PlanTask[]; fresh: PlanTask[]; week: PlanTask[]; overdue: PlanTask | null; done: PlanTask[] } {
  const { today } = opts;
  const now = nowMoves(tasks, { ...opts, viewer: "student" }).now.slice(0, WEEK_MOVES);
  const moves = [...now].sort((a, b) => Number(taskDate(a) === null) - Number(taskDate(b) === null));
  const shown = new Set(moves.map((t) => t.id));
  const weekAgo = addDays(today, -REMINDER_DAYS);
  const fresh = tasks.filter((t) => !shown.has(t.id) && NEW_MOVE_LINE_KINDS.has(t.kind) && isOpen(t, today) && t.created_at.slice(0, 10) > weekAgo);
  for (const t of fresh) shown.add(t.id);
  const week = dueSoon(tasks, today).filter((t) => !shown.has(t.id));
  const first = firstOverdue(tasks, today);
  const overdue = first && !shown.has(first.id) ? first : null;
  const done = tasks.filter((t) => !t.orphaned && t.done_at !== null && t.done_at.slice(0, 10) > weekAgo && t.done_at.slice(0, 10) <= today).sort(compareTasks);
  return { moves, fresh, week, overdue, done };
}

/**
 * The digest's changed-college move lines (notifications.md "Channels"): for the colleges that changed in a publish,
 * the open moves created since it (the change created them) and the moves it orphaned and no one has acknowledged
 * (the change closed them), soonest first.
 */
export function changedCollegeMoves(
  tasks: PlanTask[],
  unitByItem: Record<string, string>,
  changedUnitIds: ReadonlySet<string>,
  since: string,
  today: string,
): { task: PlanTask; closed: boolean }[] {
  const sinceMs = Date.parse(since);
  const out: { task: PlanTask; closed: boolean }[] = [];
  for (const t of tasks) {
    const unit = t.item_id ? unitByItem[t.item_id] : undefined;
    if (!unit || !changedUnitIds.has(unit)) continue;
    if (t.orphaned && !t.dismissed && t.done_at === null) out.push({ task: t, closed: true });
    else if (isOpen(t, today) && Date.parse(t.created_at) >= sinceMs) out.push({ task: t, closed: false });
  }
  return out.sort((a, b) => compareTasks(a.task, b.task));
}

/** Open hard-deadline tasks due exactly tomorrow. */
export function dueTomorrow(tasks: PlanTask[], today: string): PlanTask[] {
  const tomorrow = addDays(today, 1);
  return tasks.filter((t) => HARD_DEADLINE_KINDS.has(t.kind) && isOpen(t, today) && t.due_on === tomorrow).sort(compareTasks);
}

/* ------------------------------------------------------------------ */
/* Defaults by season (next-steps notifications.md "Cadence by season") */
/* ------------------------------------------------------------------ */

/** The seasons (and the older grades of the same name) where Your week and the parent summary are on by default. */
const IN_SEASON: ReadonlySet<Season | Grade> = new Set(["junior_spring", "summer_before_senior", "senior_fall", "senior_winter", "senior_spring", "summer_after"]);

/**
 * The Your week switch when the person hasn't set it: off before junior spring (and after college starts), on from it.
 * Reads the season (lib/planner/seasons.ts seasonOf); an older Grade reads the same.
 */
export function yourWeekDefault(season: Season | Grade): boolean {
  return IN_SEASON.has(season);
}

/** The switch's value: the stored choice, else the default by season. */
export function yourWeekOn(stored: boolean | null | undefined, season: Season | Grade): boolean {
  return typeof stored === "boolean" ? stored : yourWeekDefault(season);
}

/** The parent summary's default for one child: on from junior spring (the cost checks), off before. */
export function parentSummaryDefault(season: Season): boolean {
  return IN_SEASON.has(season);
}

/** Whether a guardian's weekly summary covers this child: their stored choice, else the child's season's default. */
export function parentSummaryOn(stored: boolean | null | undefined, season: Season): boolean {
  return typeof stored === "boolean" ? stored : parentSummaryDefault(season);
}

/** The season brief's switch: the stored choice, else on (wherever email goes out at all). */
export function seasonBriefOn(stored: boolean | null | undefined): boolean {
  return typeof stored === "boolean" ? stored : true;
}

/* ------------------------------------------------------------------ */
/* The season brief's schedule (notifications.md "The season brief")   */
/* ------------------------------------------------------------------ */

/** A brief's turn: a season, or February of freshman or sophomore year (the mid-year brief). */
export type BriefKey = Exclude<Season, "graduated" | "unknown"> | "freshman_feb" | "sophomore_feb";

/** Every brief turn in calendar order: ten seasons and two Februaries, at most twelve across high school. */
export const BRIEF_KEYS: readonly BriefKey[] = [
  "freshman",
  "freshman_feb",
  "sophomore",
  "sophomore_feb",
  "junior_fall",
  "junior_winter",
  "junior_spring",
  "summer_before_senior",
  "senior_fall",
  "senior_winter",
  "senior_spring",
  "summer_after",
];

/** The Season a brief belongs to (a February brief is its school year's). */
export function briefSeason(key: BriefKey): Season {
  return key === "freshman_feb" ? "freshman" : key === "sophomore_feb" ? "sophomore" : key;
}

/** The first day of a brief's turn: the season's start, or February 1 inside the freshman or sophomore year. */
export function briefStart(key: BriefKey, gradYear: number): string | null {
  const bounds = seasonBounds(briefSeason(key), gradYear);
  if (!bounds) return null;
  if (key === "freshman_feb" || key === "sophomore_feb") return `${Number(bounds.start.slice(0, 4)) + 1}-02-01`;
  return bounds.start;
}

/** The first Sunday on or after an ISO day (the weekly job runs on Sundays). */
export function firstSundayOnOrAfter(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, (7 - day) % 7);
}

/** The school year a day falls in, by its August start ("2027-02-01" → 2026): season_briefs_sent's `cycle_start`. */
export function cycleStartOf(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 8 ? y : y - 1;
}

export interface BriefTurn {
  key: BriefKey;
  /** The Season it belongs to (telemetry's `brief_sent.season`). */
  season: Season;
  /** The turn's first day (ISO). */
  start: string;
  cycleStart: number;
}

/**
 * The brief turn under way on `today` for the class of `gradYear`: the latest whose start is on or before it. Null
 * without a class year, before freshman year, and once the summer after senior year is over.
 */
export function currentBriefTurn(gradYear: number | null, today: string): BriefTurn | null {
  if (gradYear === null || !Number.isFinite(gradYear)) return null;
  const last = seasonBounds("summer_after", gradYear);
  if (last && today > last.end) return null;
  let found: BriefTurn | null = null;
  for (const key of BRIEF_KEYS) {
    const start = briefStart(key, gradYear);
    if (start && start <= today) found = { key, season: briefSeason(key), start, cycleStart: cycleStartOf(start) };
  }
  return found;
}

/** A sent brief's identity for one person and student (season_briefs_sent's key without the two ids). */
export function briefSentKey(t: Pick<BriefTurn, "key" | "cycleStart">): string {
  return `${t.key}:${t.cycleStart}`;
}

/**
 * The brief due for one person and student on `today`, or null: the turn under way, once the first Sunday on or after
 * its start has come, and not already sent (`sent` holds briefSentKey()s read from season_briefs_sent). A late joiner
 * gets the turn under way on their first Sunday; a turn that was missed isn't sent once the next one has started.
 */
export function briefDue(gradYear: number | null, today: string, sent: ReadonlySet<string>): BriefTurn | null {
  const turn = currentBriefTurn(gradYear, today);
  if (!turn) return null;
  if (firstSundayOnOrAfter(turn.start) > today) return null;
  return sent.has(briefSentKey(turn)) ? null : turn;
}
