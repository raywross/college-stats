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
];

/** Whether `user` may use `capability`. Nothing is gated yet (README "Owner decisions": tiers come after the build). */
export async function allowed(user: { id: string } | null, capability: Capability): Promise<boolean> {
  void user;
  void capability;
  return true;
}

/** The message a Server Action returns when a capability isn't allowed. */
export const NOT_ALLOWED_MESSAGE = "That part of the planner isn't available on your account.";
