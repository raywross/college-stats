import { ComingSoon } from "@/components/planner/StagePanel";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 1 (specs/planner/list-building.md), filled by U2. A server component that receives the whole PlanContext and may render client
 * children with the parts they need (no functions across the boundary). A U1 stub until then.
 */
export default function ListStage({ ctx }: { ctx: PlanContext }) {
  return <ComingSoon stage={1} ctx={ctx} what="Suggested categories with their reasons, the Dream, sorting, the balance line, and colleges to add." />;
}
