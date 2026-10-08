import type { PlanItem, PlanSchool } from "@/lib/planner/types";
import type { StudentProfileData } from "@/lib/student-profile";

/** What each list-row planner control gets (components/planner/RowControls.tsx). Serializable. */
export interface RowControlProps {
  item: PlanItem;
  school: PlanSchool;
  canEdit: boolean;
  /** yyyy-mm-dd, the family's today (lib/planner/context.ts todayIso). */
  today: string;
  /** Whether the viewer is a guardian (some controls are the student's: a follow; others anyone's: a visit). */
  viewerIsGuardian: boolean;
  /**
   * U2 addition (list-building.md "Suggested category"): the student's numbers, for `row/list.tsx`'s suggestion
   * line (`suggestCategory`, lib/planner/suggest.ts). Null for a guardian's own list (no numbers) or when the
   * caller hasn't loaded it; optional so the other row/* modules that don't need it can ignore it.
   */
  profile?: StudentProfileData | null;
  /**
   * U7 addition (offers.md "List row"): the college's entered offer, for "Offer: $X net". `net` is the letter's cost
   * minus its gift aid (null when the letter stated no cost); optional so the other row modules can ignore it.
   */
  offer?: { net: number | null; gift: number } | null;
}
