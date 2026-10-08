import { ComingSoon } from "@/components/planner/StagePanel";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 2 (specs/planner/early-rounds.md), filled by U3. A server component that receives the whole PlanContext and may render client
 * children with the parts they need (no functions across the boundary). A U1 stub until then.
 */
export default function RoundsStage({ ctx }: { ctx: PlanContext }) {
  return <ComingSoon stage={2} ctx={ctx} what="Which rounds each college offers and when, the early-round advantage with its caveats, conflicts, and a proposed plan to edit." />;
}
