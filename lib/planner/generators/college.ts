/**
 * The `college` generator (U5; specs/planner/timeline.md "Generators"): the six college tasks (apply, decision_expected, aid_forms, reply_by, housing_deposit, ed2_conditional) from the college's own dates.
 *
 * Contract (lib/planner/tasks.ts): pure, no I/O; return every task this module wants to exist right now, each with a
 * key from taskKey() (`{item_id}:{kind}:{suffix}` for a college's task, `{list_id}:{kind}:{suffix}` for a
 * student-wide one). mergeTasks() keeps ticks, snoozes, and dismissals across runs and marks a task whose key stops
 * being generated as orphaned. A U1 stub until U5 fills it: generates nothing.
 */
import type { GeneratedTask, GeneratorInput } from "../types.ts";

export function generate(input: GeneratorInput): GeneratedTask[] {
  void input;
  return [];
}
