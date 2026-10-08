import { ComingSoon } from "@/components/planner/StagePanel";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 5 (specs/planner/applications.md), filled by U6. A server component that receives the whole PlanContext and may render client
 * children with the parts they need (no functions across the boundary). A U1 stub until then.
 */
export default function ApplyStage({ ctx }: { ctx: PlanContext }) {
  return <ComingSoon stage={5} ctx={ctx} what="What each college needs, what's submitted and complete, the portal, and the follow-ups." />;
}
