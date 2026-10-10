/**
 * Props the redesigned Plan page's tabs take (specs/planner/redesign/build-plan.md "Tab component props"). Types
 * only. Every tab gets the server-built PlanContext and the view model (lib/planner/plan-view.ts) and recomputes
 * neither.
 */
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

export interface PlanTabProps {
  ctx: PlanContext;
  view: PlanView;
}

/** One child on the family calendar (one lane group per child; Everyone stacks them). */
export interface CalendarChild {
  studentId: string;
  name: string;
  /** Household color slot, in the order the children were added (KID_VARS in lib/planner/colors.ts). */
  colorSlot: 0 | 1 | 2;
  /** The child whose plan is open (drawn with a ring in the switcher). */
  ring: boolean;
  gradYear: number | null;
  ctx: PlanContext;
  view: PlanView;
}

export interface CalendarTabProps {
  children: CalendarChild[];
  viewer: "student" | "guardian";
  everyone: boolean;
}

/** The numbers form and the first-time setup (U3). */
export interface NumbersFormProps {
  ctx: PlanContext;
  view: PlanView;
  onClose?: () => void;
}
