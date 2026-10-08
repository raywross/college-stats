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

/** Kinds with a hard deadline: the ones a day-before text is for (an application, a reply, a deposit). */
export const HARD_DEADLINE_KINDS: ReadonlySet<PlanTask["kind"]> = new Set(["apply", "ed2_conditional", "reply_by", "housing_deposit", "deposit"]);

/** Open hard-deadline tasks due exactly tomorrow. */
export function dueTomorrow(tasks: PlanTask[], today: string): PlanTask[] {
  const tomorrow = addDays(today, 1);
  return tasks.filter((t) => HARD_DEADLINE_KINDS.has(t.kind) && isOpen(t, today) && t.due_on === tomorrow).sort(compareTasks);
}

/* ------------------------------------------------------------------ */
/* Your week's default                                                 */
/* ------------------------------------------------------------------ */

/** The Your week switch when the person hasn't set it: off before junior spring (and after college starts), on in season. */
export function yourWeekDefault(grade: Grade): boolean {
  return grade === "junior_spring" || grade === "summer_before_senior" || grade === "senior_fall" || grade === "senior_winter" || grade === "senior_spring" || grade === "summer_after";
}

/** The switch's value: the stored choice, else the default by grade. */
export function yourWeekOn(stored: boolean | null | undefined, grade: Grade): boolean {
  return typeof stored === "boolean" ? stored : yourWeekDefault(grade);
}
