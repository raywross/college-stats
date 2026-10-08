import type { PlanItem, PlanSchool } from "@/lib/planner/types";

/** What each list-row planner control gets (components/planner/RowControls.tsx). Serializable. */
export interface RowControlProps {
  item: PlanItem;
  school: PlanSchool;
  canEdit: boolean;
  /** yyyy-mm-dd, the family's today (lib/planner/context.ts todayIso). */
  today: string;
  /** Whether the viewer is a guardian (some controls are the student's: a follow; others anyone's: a visit). */
  viewerIsGuardian: boolean;
}
