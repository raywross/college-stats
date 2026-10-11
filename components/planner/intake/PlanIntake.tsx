"use client";
/**
 * The Plan's intake guide (specs/planner/redesign/intake.md): grades, test, AP courses, review, then Done; one save
 * at the end through `saveIntake` (lib/planner/store-plan.ts), every rule from lib/planner/intake.ts.
 *
 * TODO(U2 Intake UI): stub from U1 Foundation; the props are the contract. Build screens 1a (phone) and 2a (desktop).
 */
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

export default function PlanIntake({
  ctx,
  view,
  mode,
  relation,
  firstName,
}: {
  ctx: PlanContext;
  view: PlanView;
  /** "first": no numbers yet, ends on Done. "edit": opened from the ✎ on the numbers line, starts at Review. */
  mode: "first" | "edit";
  relation: "self" | "guardian";
  /** The student's first name, for a guardian's copy. */
  firstName: string | null;
}) {
  void ctx;
  void view;
  void mode;
  void relation;
  void firstName;
  return null;
}
