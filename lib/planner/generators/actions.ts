/**
 * The `actions` generator (U4; specs/planner/actions.md): follow and request_info (undated, in season); write_visit_notes for a past visit with no notes.
 *
 * Contract (lib/planner/tasks.ts): pure, no I/O; return every task this module wants to exist right now, each with a
 * key from taskKey() (`{item_id}:{kind}:{suffix}` for a college's task, `{list_id}:{kind}:{suffix}` for a
 * student-wide one). mergeTasks() keeps ticks, snoozes, and dismissals across runs and marks a task whose key stops
 * being generated as orphaned. A U1 stub until U4 fills it: generates nothing.
 */
import type { GeneratedTask, GeneratorInput } from "../types.ts";

export function generate(input: GeneratorInput): GeneratedTask[] {
  void input;
  return [];
}
