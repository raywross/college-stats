/**
 * Types and pure rules for following colleges (specs/product/follow-colleges.md), shared by the Server Actions in
 * lib/follows.ts, the Follow button and /me pages, and tests. Pure module: no runtime imports.
 */

/** How a follow came about: the Follow button (`manual`) or a saved list (`list`, kept in step by the lists trigger). */
export type FollowSource = "manual" | "list";

export interface FollowRow {
  unit_id: string;
  source: FollowSource;
  created: string;
}

/** What the Follow button needs to render. `available: false` when sign-in isn't configured on this deployment. */
export type FollowState =
  | { available: false }
  | { available: true; signedIn: false }
  | { available: true; signedIn: true; following: boolean; source: FollowSource | null };

export type FollowFailure = "signed-out" | "not-configured" | "unknown-college" | "not-set-up" | "error";

/** A follow/unfollow result: the new state, or why it failed with a sentence the UI can show. */
export type FollowResult = { ok: true; state: FollowState } | { ok: false; reason: FollowFailure; message: string };

/** IPEDS unit ids are digits only (the follows table checks the same). */
export function isUnitId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,10}$/.test(value);
}

/**
 * What an explicit Follow does to an existing row: none → insert `manual`; a `list` follow → becomes `manual`, so
 * taking the college off the list later never silently unfollows it; already `manual` → nothing.
 */
export function followWrite(existing: FollowSource | null): "insert" | "upgrade" | "none" {
  return existing === null ? "insert" : existing === "list" ? "upgrade" : "none";
}

export const FOLLOW_MESSAGES: Record<FollowFailure, string> = {
  "signed-out": "Sign in to follow colleges.",
  "not-configured": "Sign-in isn't available here.",
  "unknown-college": "We couldn't find that college.",
  "not-set-up": "Following isn't set up on this site yet.",
  error: "We couldn't save that. Try again in a moment.",
};
