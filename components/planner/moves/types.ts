/**
 * A move card's props (specs/planner/next-steps/build-plan.md "Cards"). Every card in components/planner/moves/ takes
 * these; the registry (registry.tsx) maps a task kind to its card, MoveCard.tsx is the default. Types only.
 */
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext, PlanTask } from "@/lib/planner/types";

export interface MoveCardProps {
  task: PlanTask;
  ctx: PlanContext;
  view: PlanView;
  /** Done: ticks the move (the built `tick`). */
  onDone: (t: PlanTask) => void;
  /** Not now: skips it for good (the built `dismiss`). */
  onSkip: (t: PlanTask) => void;
  /** A write for this card is in flight. */
  pending: boolean;
}
