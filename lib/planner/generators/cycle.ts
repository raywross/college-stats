/**
 * The `cycle` generator (U5, redesign U6; specs/planner/timeline.md "The cycle file"; specs/planner/redesign/scores.md
 * "Test dates"): one task per entry of the student's cycle in data/application-cycle.json that applies() to them,
 * once per student (key `{list}:cycle:{entry key}`), with the assignee the file gives. A fixed date is the due date;
 * a window becomes window_start/window_end.
 *
 * An entry with `applies: "plans_tests"` (a national SAT/ACT date) is different since the redesign: it's no longer a
 * task for everyone. It becomes a task only once the student taps "I'll take it" on that date (stored as the entry's
 * key in `profile.tests.plannedDates`, scores.md "Test dates") — and then it's two: `test_register` ("Register for
 * the SAT on Nov 7", due the registration deadline, skipped when the entry has none) and `test_day` ("SAT test day",
 * due the date itself), each keyed by kind and the entry's key so they orphan independently. An untapped date never
 * becomes a task or a reminder.
 *
 * Two more rules keep the plan honest:
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

/** The task one (non test-date) cycle entry becomes (without the applies/staleness checks). */
export function cycleTask(entry: CycleEntry, listId: string, position: number): GeneratedTask {
  return {
    key: taskKey(listId, "cycle", entry.key),
    item_id: null,
    kind: "cycle",
    title: entry.label.slice(0, 200),
    detail: entry.detail ?? null,
    due_on: entry.date ?? null,
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

/** The two tasks a picked test date becomes ("I'll take it"): register (when there's a deadline) and test day. */
export function testDateTasks(entry: CycleEntry, listId: string, position: number): GeneratedTask[] {
  const base = {
    item_id: null,
    window_start: null,
    window_end: null,
    assignee: entry.assignee,
    source: "cycle" as const,
    source_field: null,
    source_edition: null,
    date_note: null,
    position,
  };
  const out: GeneratedTask[] = [];
  if (entry.register_by) {
    out.push({
      ...base,
      key: taskKey(listId, "test_register", entry.key),
      kind: "test_register",
      title: `Register for the ${entry.label} on ${shortDay(entry.date!)}`.slice(0, 200),
      detail: entry.detail ?? null,
      due_on: entry.register_by,
    });
  }
  out.push({
    ...base,
    key: taskKey(listId, "test_day", entry.key),
    kind: "test_day",
    title: `${entry.label} test day`.slice(0, 200),
    detail: null,
    due_on: entry.date ?? null,
  });
  return out;
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
  const planned = new Set(input.profile?.tests.plannedDates ?? []);
  const out: GeneratedTask[] = [];
  input.cycle.entries.forEach((entry, i) => {
    if (entry.applies === "committed") return;
    if (!applies(entry, facts)) return;
    if (entry.applies === "plans_tests") {
      if (!planned.has(entry.key)) return;
      for (const t of testDateTasks(entry, input.list.id, i)) {
        const last = t.due_on ?? t.window_end;
        if (last !== null && last < cutoff) continue;
        out.push(t);
      }
      return;
    }
    const t = cycleTask(entry, input.list.id, i);
    const last = t.due_on ?? t.window_end;
    if (last !== null && last < cutoff) return;
    out.push(t);
  });
  return out;
}
