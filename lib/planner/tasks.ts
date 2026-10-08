/**
 * Tasks (specs/planner/model.md "Shared code"; timeline.md "Generators"). Pure: keys, generation, the idempotent
 * merge, and the views every stage reads (next task per college, This week, by month, by college).
 *
 * Generation is idempotent by key. A regeneration (a data publish, a round change, opening the Plan tab) updates a
 * generated task's text, dates, assignee, and lineage, and never touches done_at, snoozed_until, dismissed, or
 * position; a key that stops being generated is marked orphaned, never deleted; the family's own tasks (no key) are
 * never touched.
 */
import { GENERATORS } from "./generators/index.ts";
import { addDays } from "./stage.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanTask, TaskKind } from "./types.ts";

/** `${scope}:${kind}:${suffix}`, the suffix `-` when none: scope is an item id (a college's task) or the list id. */
export function taskKey(scope: string, kind: TaskKind, suffix?: string | number | null): string {
  const s = suffix === undefined || suffix === null || suffix === "" ? "-" : String(suffix);
  return `${scope}:${kind}:${s}`;
}

/** Every task the generators want, in generator order, one per key (the first wins); none from `cycle` on a guardian's own list. */
export function generateTasks(input: GeneratorInput, generators = GENERATORS): GeneratedTask[] {
  const out: GeneratedTask[] = [];
  const seen = new Set<string>();
  const studentList = input.list.student_id !== null;
  for (const g of generators) {
    for (const task of g.generate(input)) {
      if (!task.key || seen.has(task.key)) continue;
      if (task.source === "cycle" && !studentList) continue;
      if (task.source === "own") continue;
      seen.add(task.key);
      out.push(task);
    }
  }
  return out;
}

/** The generated fields a regeneration may change (everything a generator emits but the key). */
export const GENERATED_FIELDS = [
  "item_id",
  "kind",
  "title",
  "detail",
  "due_on",
  "window_start",
  "window_end",
  "assignee",
  "source",
  "source_field",
  "source_edition",
  "date_note",
  "position",
] as const satisfies readonly (keyof GeneratedTask)[];

/** One row to write (an upsert on (list_id, key), list_id added by the writer): only generated fields, so a tick or snooze is never overwritten. */
export type TaskUpsert = GeneratedTask & { orphaned: false };

export interface MergeResult {
  /** New keys, and existing keys whose generated fields changed (or that come back from orphaned). */
  upserts: TaskUpsert[];
  /** Ids of generated tasks whose key wasn't generated this time and aren't marked yet. */
  orphans: string[];
}

function sameGenerated(a: Pick<PlanTask, (typeof GENERATED_FIELDS)[number]>, b: GeneratedTask, keepPosition: boolean): boolean {
  return GENERATED_FIELDS.every((f) => (f === "position" && keepPosition) || (a[f] ?? null) === (b[f] ?? null));
}

/**
 * Compares what's stored with what the generators want. Same key: an upsert only when a generated field changed (the
 * stored position is kept: it's the family's order) or the task was orphaned; new key: an insert; a stored generated
 * key that's missing: an orphan. Own tasks are left alone. Running it again after applying the result returns nothing.
 */
export function mergeTasks(existing: PlanTask[], generated: GeneratedTask[]): MergeResult {
  const byKey = new Map(existing.filter((t) => t.key !== null).map((t) => [t.key!, t]));
  const wanted = new Set(generated.map((g) => g.key));
  const upserts: TaskUpsert[] = [];
  for (const g of generated) {
    const current = byKey.get(g.key);
    if (current && !current.orphaned && sameGenerated(current, g, true)) continue;
    upserts.push({ ...g, position: current ? current.position : g.position, orphaned: false });
  }
  const orphans = existing.filter((t) => t.key !== null && t.source !== "own" && !t.orphaned && !wanted.has(t.key)).map((t) => t.id);
  return { upserts, orphans };
}

/**
 * The stored tasks after a merge is written (what the database holds next): for tests and for a page that renders
 * before re-reading. New rows get `newId(key)` and `now` as their creation time.
 */
export function applyMerge(
  listId: string,
  existing: PlanTask[],
  merge: MergeResult,
  now: string,
  newId: (key: string) => string = (k) => `new:${k}`,
): PlanTask[] {
  const orphaned = new Set(merge.orphans);
  const out = existing.map((t) => (orphaned.has(t.id) ? { ...t, orphaned: true } : t));
  for (const u of merge.upserts) {
    const i = out.findIndex((t) => t.key === u.key);
    if (i >= 0) out[i] = { ...out[i], ...pickGenerated(u), orphaned: false };
    else
      out.push({
        ...pickGenerated(u),
        key: u.key,
        id: newId(u.key),
        list_id: listId,
        done_at: null,
        done_by: null,
        snoozed_until: null,
        dismissed: false,
        orphaned: false,
        created_by: null,
        created_at: now,
      });
  }
  return out;
}

function pickGenerated(g: GeneratedTask): Pick<PlanTask, (typeof GENERATED_FIELDS)[number]> {
  return Object.fromEntries(GENERATED_FIELDS.map((f) => [f, g[f] ?? null])) as Pick<PlanTask, (typeof GENERATED_FIELDS)[number]>;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** The date a task is placed by: its due date, else its window's end, else null (undated). */
export function taskDate(t: Pick<PlanTask, "due_on" | "window_start" | "window_end">): string | null {
  return t.due_on ?? t.window_end ?? null;
}

/** Not done, not dismissed, not snoozed past `today`, and not an orphan (an orphan shows once, in its own line). */
export function isOpen(t: Pick<PlanTask, "done_at" | "dismissed" | "snoozed_until" | "orphaned">, today: string): boolean {
  return t.done_at === null && !t.dismissed && !t.orphaned && !(t.snoozed_until !== null && t.snoozed_until > today);
}

export function isOverdue(t: PlanTask, today: string): boolean {
  const d = taskDate(t);
  return isOpen(t, today) && d !== null && d < today;
}

/** Dated before undated, then by date, then by position, then title: the order every task list uses. */
export function compareTasks(a: PlanTask, b: PlanTask): number {
  const da = taskDate(a);
  const db = taskDate(b);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  return a.position - b.position || a.title.localeCompare(b.title);
}

/** The next open dated task, for one college (`itemId`) or overall (omit it); null when none. */
export function nextTask(tasks: PlanTask[], today: string, itemId?: string): PlanTask | null {
  const open = tasks.filter((t) => (itemId === undefined || t.item_id === itemId) && isOpen(t, today) && taskDate(t) !== null);
  return open.sort(compareTasks)[0] ?? null;
}

/** nextTask() for every item on the list, by item id (the list rows' facts line). */
export function nextTaskByItem(items: Pick<PlanItem, "id">[], tasks: PlanTask[], today: string): Record<string, PlanTask | null> {
  return Object.fromEntries(items.map((i) => [i.id, nextTask(tasks, today, i.id)]));
}

export const THIS_WEEK_MAX = 8;

/** This week (model.md "Where it lives"): open tasks overdue or due in the next seven days, overdue first, at most eight. */
export function thisWeek(tasks: PlanTask[], today: string, max = THIS_WEEK_MAX): { tasks: PlanTask[]; more: number } {
  const end = addDays(today, 7);
  const due = tasks
    .filter((t) => {
      const d = taskDate(t);
      return isOpen(t, today) && d !== null && d <= end;
    })
    .sort(compareTasks);
  return { tasks: due.slice(0, max), more: Math.max(0, due.length - max) };
}

export interface MonthGroup {
  /** "overdue", "yyyy-mm", or "undated". */
  key: string;
  tasks: PlanTask[];
}

/**
 * Tasks by month for the month view: open overdue tasks first, then every other task by the month of its date (a
 * window by the month it opens), then the undated ones. Done tasks stay in their month (the view collapses them).
 */
export function groupByMonth(tasks: PlanTask[], today: string): MonthGroup[] {
  const overdue: PlanTask[] = [];
  const months = new Map<string, PlanTask[]>();
  const undated: PlanTask[] = [];
  for (const t of [...tasks].sort(compareTasks)) {
    if (isOverdue(t, today)) overdue.push(t);
    else {
      const d = t.window_start ?? t.due_on;
      if (d === null) undated.push(t);
      else {
        const k = d.slice(0, 7);
        if (!months.has(k)) months.set(k, []);
        months.get(k)!.push(t);
      }
    }
  }
  const groups: MonthGroup[] = [];
  if (overdue.length) groups.push({ key: "overdue", tasks: overdue });
  for (const k of [...months.keys()].sort()) groups.push({ key: k, tasks: months.get(k)! });
  if (undated.length) groups.push({ key: "undated", tasks: undated });
  return groups;
}

/** Tasks by college for the college view: the shared ones (no item) first, then one group per item in list order. */
export function groupByCollege(tasks: PlanTask[], items: Pick<PlanItem, "id" | "position">[]): { shared: PlanTask[]; byItem: { itemId: string; tasks: PlanTask[] }[] } {
  const shared = tasks.filter((t) => t.item_id === null).sort(compareTasks);
  const byItem = [...items]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({ itemId: i.id, tasks: tasks.filter((t) => t.item_id === i.id).sort(compareTasks) }))
    .filter((g) => g.tasks.length > 0);
  return { shared, byItem };
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 1", with the year when it isn't `today`'s ("Jan 5, 2028"). */
export function dayLabel(iso: string, today: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return today.slice(0, 4) === String(y) ? base : `${base}, ${y}`;
}

/** A task's date as a phrase: "Nov 1", "Oct 1 – Nov 15" for a window, or null when undated. */
export function taskDateLabel(t: Pick<PlanTask, "due_on" | "window_start" | "window_end">, today: string): string | null {
  if (t.due_on) return dayLabel(t.due_on, today);
  if (t.window_start && t.window_end) return `${dayLabel(t.window_start, today)} – ${dayLabel(t.window_end, today)}`;
  return null;
}

/**
 * Whose task, from the viewer's side (timeline.md "Display": the assignee chip): the student sees "You" on their own
 * tasks and "Parent" on a guardian's; a guardian sees the student's first name and "Parent"; "Either" either way.
 */
export function assigneeLabel(assignee: PlanTask["assignee"], viewer: { isGuardian: boolean }, studentFirstName: string | null): string {
  if (assignee === "either") return "Either";
  if (assignee === "guardian") return "Parent";
  return viewer.isGuardian ? (studentFirstName ?? "Student") : "You";
}

/** The line under a dated task that says where its date stands (timeline.md "Rules"); null for a plain college or cycle date. */
export function dateNoteLabel(t: Pick<PlanTask, "date_note" | "source_edition">): string | null {
  if (t.date_note === "own") return "Your date";
  if (t.date_note !== "last_cycle") return null;
  const from = t.source_edition ? `the ${t.source_edition} edition` : "last year's edition";
  return `Date from ${from}: confirm on the college's page`;
}
