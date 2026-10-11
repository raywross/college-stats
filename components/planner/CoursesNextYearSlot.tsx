import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";

/**
 * The slot in the Scores tab's Courses section where the course plan's suggestions for next year go
 * (specs/chances/course-plan.md, unit U6). It renders nothing until that unit replaces the body with
 * `<NextYearCard ctx={ctx} view={view} />`; CoursesSection already places it after the list and the school's offering.
 */
export function CoursesNextYearSlot(props: { ctx: PlanContext; view: PlanView }) {
  void props;
  return null;
}
