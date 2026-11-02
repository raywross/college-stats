/**
 * Entitlements (specs/planner/model.md "Entitlements"): the one hook a paid tier will fill. Every planner Server
 * Action asks `allowed(user, capability)` before it writes; today everything is allowed, as it is for lists. When
 * specs/product/commercialization.md is built, the map from a user's plan to capabilities goes here and the stages
 * don't change. Async so that lookup can read the database later without touching callers.
 */
import type { Capability } from "./planner/types.ts";

export type { Capability };

/** Every capability the planner names, in the spec's order (the planner's contribution to the commercial model). */
export const CAPABILITIES: readonly Capability[] = [
  "planner.tab",
  "planner.rounds",
  "planner.actions.visits",
  "planner.calendar",
  "planner.reminders",
  "planner.texts",
  "planner.parents.nudge",
  "planner.offers",
  "advisor.essays",
  "advisor.reviews",
];

/** Whether `user` may use `capability`. Nothing is gated yet (README "Owner decisions": tiers come after the build). */
export async function allowed(user: { id: string } | null, capability: Capability): Promise<boolean> {
  void user;
  void capability;
  return true;
}

/** The message a Server Action returns when a capability isn't allowed. */
export const NOT_ALLOWED_MESSAGE = "That part of the planner isn't available on your account.";

/**
 * A student's advisor status, the one fact about money a counselor sees (specs/product/counselor-portal.md "The
 * caseload", "The channel"): a quiet chip on the caseload row, never a price. "preview" for everyone until billing
 * ships (specs/product/commercialization.md); then Advisor, Trial ends {date}, Not yet, or Lapsed.
 */
export type AdvisorStatus = "preview" | "trial" | "active" | "none" | "lapsed";

/** The chip's words. Once billing ships, "trial" carries its end date on the chip ("Trial ends Nov 14"). */
export const ADVISOR_STATUS_LABEL: Record<AdvisorStatus, string> = {
  preview: "Preview",
  trial: "Trial",
  active: "Advisor",
  none: "Not yet",
  lapsed: "Lapsed",
};

/** Each student's advisor status, by student id. Every student is in the preview until billing ships. */
export async function advisorStatusFor(studentIds: string[]): Promise<Record<string, AdvisorStatus>> {
  return Object.fromEntries(studentIds.map((id) => [id, "preview" as const]));
}
