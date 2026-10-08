/**
 * The `rounds` generator (U3; specs/planner/early-rounds.md): decide_rounds six weeks before the earliest early deadline, in season.
 *
 * Contract (lib/planner/tasks.ts): pure, no I/O; return every task this module wants to exist right now, each with a
 * key from taskKey() (`{item_id}:{kind}:{suffix}` for a college's task, `{list_id}:{kind}:{suffix}` for a
 * student-wide one). mergeTasks() keeps ticks, snoozes, and dismissals across runs and marks a task whose key stops
 * being generated as orphaned. A U1 stub until U3 fills it: generates nothing.
 */
import type { GeneratedTask, GeneratorInput } from "../types.ts";

export function generate(input: GeneratorInput): GeneratedTask[] {
  void input;
  return [];
}
