import { ComingSoon } from "@/components/planner/StagePanel";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 6 (specs/planner/offers.md), filled by U7. A server component that receives the whole PlanContext and may render client
 * children with the parts they need (no functions across the boundary). A U1 stub until then.
 */
export default function OffersStage({ ctx }: { ctx: PlanContext }) {
  return <ComingSoon stage={6} ctx={ctx} what="Decisions, offers side by side with four-year totals, and the choice with its deposit and withdrawal steps." />;
}
