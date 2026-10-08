/**
 * The `cycle` generator (U5; specs/planner/timeline.md "The cycle file"): one task per entry of the student's cycle in
 * data/application-cycle.json that applies() to them, once per student (key `{list}:cycle:{entry key}`), with the
 * assignee the file gives. A fixed date is the due date; a window becomes window_start/window_end; a test date with a
 * registration deadline becomes "Register for the SAT (test day Oct 3)" due on the deadline.
 *
 * Two rules keep the plan honest:
 * - Entries with `applies: "committed"` (the summer list) are the offers unit's `summer` tasks
 *   (lib/planner/generators/offers.ts), not generated here, so they aren't listed twice.
 * - An entry whose date passed more than STALE_DAYS ago isn't generated: a senior who joins in October doesn't start
 *   with "Ask two teachers before summer" overdue. A stored task that ages out this way is marked orphaned and the
 *   month view hides it silently (its date is past; there's nothing to tell).
 *
 * Student lists only (generateTasks also drops `cycle` tasks on a guardian's own list). Pure; no I/O.
 */
import { applies, type CycleEntry } from "../cycle.ts";
import { addDays } from "../stage.ts";
import { taskKey } from "../tasks.ts";
import type { GeneratedTask, GeneratorInput } from "../types.ts";
import { shortDay } from "./college.ts";

/** How long after its date a cycle entry stays on the plan (overdue) before it stops being generated. */
export const STALE_DAYS = 30;

/** The task one cycle entry becomes (without the applies/staleness checks). */
export function cycleTask(entry: CycleEntry, listId: string, position: number): GeneratedTask {
  const register = entry.register_by && entry.date ? entry.register_by : null;
  const title = register ? `Register for the ${entry.label} (test day ${shortDay(entry.date!)})` : entry.label;
  return {
    key: taskKey(listId, "cycle", entry.key),
    item_id: null,
    kind: "cycle",
    title: title.slice(0, 200),
    detail: entry.detail ?? null,
    due_on: register ?? entry.date ?? null,
    window_start: entry.window?.[0] ?? null,
    window_end: entry.window?.[1] ?? null,
    assignee: entry.assignee,
    source: "cycle",
    source_field: null,
    source_edition: null,
    date_note: null,
    position,
  };
}

/** The cycle-file entry a cycle task came from (its key's last part), for the source link. */
export function entryForTask(entries: readonly CycleEntry[], key: string | null): CycleEntry | null {
  if (!key) return null;
  const k = key.slice(key.lastIndexOf(":") + 1);
  return entries.find((e) => e.key === k) ?? null;
}

export function generate(input: GeneratorInput): GeneratedTask[] {
  if (input.list.student_id === null) return [];
  const facts = { items: input.items.filter((i) => !i.withdrawn_on), schools: input.schools, profile: input.profile };
  const cutoff = addDays(input.today, -STALE_DAYS);
  const out: GeneratedTask[] = [];
  input.cycle.entries.forEach((entry, i) => {
    if (entry.applies === "committed") return;
    if (!applies(entry, facts)) return;
    const t = cycleTask(entry, input.list.id, i);
    const last = t.due_on ?? t.window_end;
    if (last !== null && last < cutoff) return;
    out.push(t);
  });
  return out;
}
