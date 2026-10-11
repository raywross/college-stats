import { NextYearCard } from "@/components/planner/NextYearCard";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";

/**
 * The slot in the Scores tab's Courses section where the course plan's suggestions for next year go
 * (specs/chances/course-plan.md): CoursesSection places it after the list and the school's offering.
 */
export function CoursesNextYearSlot(props: { ctx: PlanContext; view: PlanView }) {
  return <NextYearCard ctx={props.ctx} view={props.view} />;
}
