import { ComingSoon } from "@/components/planner/StagePanel";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 4 (specs/planner/timeline.md), filled by U5. A server component that receives the whole PlanContext and may render client
 * children with the parts they need (no functions across the boundary). A U1 stub until then.
 */
export default function TimelineStage({ ctx }: { ctx: PlanContext }) {
  return <ComingSoon stage={4} ctx={ctx} what="Every dated step by month or by college, the calendar feed, and reminders." />;
}
