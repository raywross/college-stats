/**
 * The 8-week dated list (specs/planner/redesign/calendar.md): the Calendar tab's default view ("tab": full width with
 * the date column) and the desktop plan's right-column card ("aside": compact, titled "Coming up", with a "Full year"
 * link).
 *
 * TODO(U4 Calendar + Scores): stub from U1 Foundation; the props are the contract.
 */
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

export function UpcomingList({
  ctx,
  view,
  studentId,
  variant,
  fullYearHref,
}: {
  ctx: PlanContext;
  view: PlanView;
  studentId: string;
  variant: "tab" | "aside";
  /** Where the aside's "Full year" link goes (the Calendar tab's full-year view). */
  fullYearHref?: string;
}) {
  void ctx;
  void view;
  void studentId;
  void variant;
  void fullYearHref;
  return null;
}
