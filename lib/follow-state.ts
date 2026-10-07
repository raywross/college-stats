/**
 * Types and pure rules for follows (specs/product/follow-colleges.md), shared by lib/follows.ts, the lists actions,
 * the digest, and tests. Pure module: no runtime imports.
 */

/**
 * How a follow came about. Always `list` since 20261006150000_household_hub.sql: a follow exists while a college is
 * on a list with Updates on, and the database's trigger is the only writer (the `manual` source and the Follow button
 * are gone; household-hub.md "What goes").
 */
export type FollowSource = "list";

export interface FollowRow {
  unit_id: string;
  source: FollowSource;
  created: string;
}

/** IPEDS unit ids are digits only (the follows and list_items tables check the same). */
export function isUnitId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,10}$/.test(value);
}

/** notification_prefs.unsubscribe_token: two UUIDs without dashes (supabase/migrations/20261005140000_follows.sql). */
export const UNSUBSCRIBE_TOKEN_RE = /^[0-9a-f]{64}$/;

export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && UNSUBSCRIBE_TOKEN_RE.test(value);
}
