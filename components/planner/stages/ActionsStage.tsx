import { ComingSoon } from "@/components/planner/StagePanel";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 3 (specs/planner/actions.md), filled by U4. A server component that receives the whole PlanContext and may render client
 * children with the parts they need (no functions across the boundary). A U1 stub until then.
 */
export default function ActionsStage({ ctx }: { ctx: PlanContext }) {
  return <ComingSoon stage={3} ctx={ctx} what="Follow each admissions office, request information, and book and log visits, with where interest counts." />;
}
